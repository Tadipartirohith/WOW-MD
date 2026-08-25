import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { VendorServicesService } from './vendor-services.service';
import { VendorService } from './entities/vendor-service.entity';
import { ServiceOffering } from './entities/service-offering.entity';
import { ServiceDefinition } from './entities/service-definition.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { CatalogService } from './catalog.service';
import { AppConfigService } from '../../config/app-config.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { BusinessStatus, PricingModel, UserRole } from '../../common/enums';

const owner: AuthUser = {
  userId: 'owner',
  email: 'owner@example.com',
  role: UserRole.VENDOR,
  managedByAgentId: null,
};

/**
 * Holding a big price change on a live listing.
 *
 * Unit-tested rather than exercised live because the feature is off by default,
 * and the interesting behaviour is the arithmetic around the threshold — where
 * exactly a change stops being routine. A live suite would have to run a second
 * stack to see any of it.
 */
describe('catalog price review', () => {
  let service: VendorServicesService;
  let offering: ServiceOffering;
  let businessStatus: BusinessStatus;
  let threshold: number;

  const offerings = {
    findOne: jest.fn(async () => offering),
    find: jest.fn(async () => []),
    save: jest.fn(async (o) => o as ServiceOffering),
  };

  const upsert = {
    name: 'Silver package',
    pricingModel: PricingModel.FIXED,
    price: '20000.00',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    businessStatus = BusinessStatus.LIVE;
    threshold = 50;
    offering = {
      id: 'o1',
      vendorServiceId: 'vs1',
      name: 'Silver package',
      price: '10000.00',
      pendingPrice: null,
      pendingSince: null,
      currency: 'INR',
      active: true,
      sortOrder: 0,
    } as ServiceOffering;

    const moduleRef = await Test.createTestingModule({
      providers: [
        VendorServicesService,
        {
          provide: getRepositoryToken(VendorService),
          useValue: { findOne: jest.fn(async () => ({ id: 'vs1', vendorId: 'v1', definitionId: 'd1' })), find: jest.fn(async () => []) },
        },
        { provide: getRepositoryToken(ServiceOffering), useValue: offerings },
        { provide: getRepositoryToken(ServiceDefinition), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(ServiceCategory), useValue: { findOne: jest.fn() } },
        {
          provide: getRepositoryToken(Vendor),
          useValue: {
            findOne: jest.fn(async () => ({
              id: 'v1',
              ownerUserId: 'owner',
              status: businessStatus,
            })),
          },
        },
        {
          provide: CatalogService,
          useValue: {
            getDefinition: jest.fn(async () => ({
              id: 'd1',
              allowedPricingModels: [PricingModel.FIXED],
              packagesAllowed: true,
            })),
          },
        },
        {
          provide: AppConfigService,
          useValue: { features: { get catalogReviewThresholdPercent() { return threshold; } } },
        },
      ],
    }).compile();

    service = moduleRef.get(VendorServicesService);
  });

  const update = (price: string) =>
    service.updateOffering(owner, 'v1', 'vs1', 'o1', { ...upsert, price });

  it('holds a doubling on a live listing and keeps the old price selling', async () => {
    const saved = await update('20000.00');
    expect(saved.price).toBe('10000.00');
    expect(saved.pendingPrice).toBe('20000.00');
    expect(saved.pendingSince).toBeInstanceOf(Date);
  });

  it('lets an ordinary change through untouched', async () => {
    // Ten per cent is a vendor keeping up with their own costs. Putting a queue
    // in front of that would put one between a business and its shop floor.
    const saved = await update('11000.00');
    expect(saved.price).toBe('11000.00');
    expect(saved.pendingPrice).toBeNull();
  });

  it('measures the movement in both directions', async () => {
    const saved = await update('4000.00');
    expect(saved.price).toBe('10000.00');
    expect(saved.pendingPrice).toBe('4000.00');
  });

  it('does nothing at all when review is switched off', async () => {
    threshold = 0;
    const saved = await update('1000000.00');
    expect(saved.price).toBe('1000000.00');
    expect(saved.pendingPrice).toBeNull();
  });

  it('leaves a listing that is not yet live alone', async () => {
    // Nothing is being sold from it, so there are no customers to protect —
    // and holding a vendor's first prices for review is a queue in front of a
    // form.
    businessStatus = BusinessStatus.DRAFT;
    const saved = await update('999999.00');
    expect(saved.price).toBe('999999.00');
    expect(saved.pendingPrice).toBeNull();
  });

  it('applies a held change when it is approved', async () => {
    offering.pendingPrice = '20000.00';
    offering.pendingSince = new Date();
    const saved = await service.decidePriceChange('o1', true);
    expect(saved.price).toBe('20000.00');
    expect(saved.pendingPrice).toBeNull();
  });

  it('discards it when it is refused, leaving the price where it was', async () => {
    offering.pendingPrice = '20000.00';
    const saved = await service.decidePriceChange('o1', false);
    expect(saved.price).toBe('10000.00');
    expect(saved.pendingPrice).toBeNull();
  });

  it('refuses to decide an offering with nothing waiting on it', async () => {
    await expect(service.decidePriceChange('o1', true)).rejects.toBeInstanceOf(BadRequestException);
  });
});

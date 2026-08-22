import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { VendorService } from './entities/vendor-service.entity';
import { ServiceOffering } from './entities/service-offering.entity';
import { ServiceDefinition } from './entities/service-definition.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { CatalogService } from './catalog.service';
import { UpsertOfferingDto, UpsertVendorServiceDto } from './dto/catalog.dto';
import { describeForm, validateAttributes } from './attribute-validation';
import { AttributeScope, PricingModel, UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/** The two models that carry no published amount — the vendor quotes instead. */
const QUOTE_ONLY: PricingModel[] = [PricingModel.CUSTOM_QUOTE, PricingModel.NO_PUBLIC_PRICE];

/** The models where a quantity is part of the price rather than decoration. */
const QUANTITY_MODELS: PricingModel[] = [
  PricingModel.PER_PERSON,
  PricingModel.PER_ITEM,
  PricingModel.PER_HOUR,
  PricingModel.PER_DAY,
  PricingModel.PER_SESSION,
];

/**
 * The vendor's half of the catalog: which services they offer, how they have
 * answered each one's questions, and what they charge for them.
 *
 * Everything a vendor writes here is checked against the definition the
 * administrator configured — the attribute answers by the validator, the
 * pricing model against `allowedPricingModels`, packages against
 * `packagesAllowed`. That is the whole trade the catalog makes: configuration
 * is free to change, and the validator is what keeps it from becoming a mess.
 */
@Injectable()
export class VendorServicesService {
  constructor(
    @InjectRepository(VendorService)
    private readonly services: Repository<VendorService>,
    @InjectRepository(ServiceOffering)
    private readonly offerings: Repository<ServiceOffering>,
    @InjectRepository(ServiceDefinition)
    private readonly definitions: Repository<ServiceDefinition>,
    @InjectRepository(ServiceCategory)
    private readonly categories: Repository<ServiceCategory>,
    @InjectRepository(Vendor)
    private readonly vendors: Repository<Vendor>,
    private readonly catalog: CatalogService,
  ) {}

  // ------------------------------------------------------------- ownership

  private async assertOwner(actor: AuthUser, vendorId: string): Promise<Vendor> {
    const vendor = await this.vendors.findOne({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Business not found');
    if (actor.role !== UserRole.ADMIN && vendor.ownerUserId !== actor.userId) {
      throw new ForbiddenException('That business is not yours');
    }
    return vendor;
  }

  /**
   * Whether this caller owns the business, without refusing if they do not.
   *
   * The listing read is open to every signed-in account — a buyer choosing a
   * service and a vendor editing one look at the same rows — so the answer
   * decides how much of it comes back rather than whether anything does.
   */
  async ownsVendor(actor: AuthUser, vendorId: string): Promise<boolean> {
    const vendor = await this.vendors.findOne({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Business not found');
    return actor.role === UserRole.ADMIN || vendor.ownerUserId === actor.userId;
  }

  /**
   * Loads a vendor service and proves it belongs to the caller.
   *
   * Offerings are addressed by their own id, so without this an offering id
   * from one vendor could be edited under another vendor's path — the same
   * class of hole the booking routes had.
   */
  private async ownedService(actor: AuthUser, vendorId: string, id: string): Promise<VendorService> {
    await this.assertOwner(actor, vendorId);
    const service = await this.services.findOne({ where: { id, vendorId } });
    if (!service) throw new NotFoundException('That service is not on this business');
    return service;
  }

  // -------------------------------------------------------- vendor services

  /**
   * Everything this business sells, each expanded with its definition, its
   * category, the form its buyers will be asked, and its live offerings.
   *
   * Returned whole because every caller needs all of it: the vendor console to
   * render the editor, the directory to render the listing, and the booking
   * form to know what to ask.
   */
  async listForVendor(vendorId: string, activeOnly = false) {
    const services = await this.services.find({
      where: activeOnly ? { vendorId, active: true } : { vendorId },
      order: { createdAt: 'ASC' },
    });
    if (services.length === 0) return [];

    const definitionIds = services.map((s) => s.definitionId);
    const [definitions, attributesByDefinition, offerings] = await Promise.all([
      this.definitions.find({ where: { id: In(definitionIds) } }),
      this.catalog.attributesForMany(definitionIds),
      this.offerings.find({
        where: { vendorServiceId: In(services.map((s) => s.id)) },
        order: { sortOrder: 'ASC', name: 'ASC' },
      }),
    ]);

    const categories = await this.categories.find({
      where: { id: In(Array.from(new Set(definitions.map((d) => d.categoryId)))) },
    });
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const definitionById = new Map(definitions.map((d) => [d.id, d]));

    return services.map((service) => {
      const definition = definitionById.get(service.definitionId) ?? null;
      const attributes = attributesByDefinition.get(service.definitionId) ?? [];
      const mine = offerings.filter((o) => o.vendorServiceId === service.id);

      return {
        ...service,
        definition,
        category: definition ? (categoryById.get(definition.categoryId) ?? null) : null,
        serviceForm: describeForm(attributes, AttributeScope.SERVICE),
        bookingForm: describeForm(attributes, AttributeScope.BOOKING),
        offerings: activeOnly ? mine.filter((o) => o.active) : mine,
        /**
         * Whether a buyer could actually book this today. A service with no
         * live offering is a description with no price, and the request form
         * has nothing to submit — so say so here rather than letting the
         * buyer find out at the end.
         */
        bookable: service.active && mine.some((o) => o.active),
      };
    });
  }

  async addService(actor: AuthUser, vendorId: string, dto: UpsertVendorServiceDto) {
    await this.assertOwner(actor, vendorId);

    const definition = await this.catalog.getDefinition(dto.definitionId);
    if (!definition.active) {
      throw new BadRequestException('That service is no longer offered in the catalog');
    }

    const existing = await this.services.findOne({
      where: { vendorId, definitionId: definition.id },
    });
    if (existing) {
      throw new BadRequestException(
        `You already offer ${definition.name}. Edit it rather than adding it twice.`,
      );
    }

    const attributes = await this.catalog.attributesFor(definition.id);
    const validated = validateAttributes(attributes, AttributeScope.SERVICE, dto.attributes);

    return this.services.save(
      this.services.create({
        vendorId,
        definitionId: definition.id,
        displayName: dto.displayName ?? null,
        description: dto.description ?? null,
        attributes: validated,
        // The definition's default is the sensible starting point — a venue
        // definition says one, a catering definition says however many teams
        // the business usually runs.
        concurrentCapacity: dto.concurrentCapacity ?? definition.defaultCapacity,
        active: dto.active ?? true,
      }),
    );
  }

  async updateService(
    actor: AuthUser,
    vendorId: string,
    id: string,
    dto: UpsertVendorServiceDto,
  ): Promise<VendorService> {
    const service = await this.ownedService(actor, vendorId, id);

    // The definition is what all the validation hangs off, so it is not
    // something an update may quietly swap. Changing it means a new service.
    if (dto.definitionId && dto.definitionId !== service.definitionId) {
      throw new BadRequestException(
        'A service cannot be changed into a different one. Add the new service instead.',
      );
    }

    if (dto.attributes !== undefined) {
      const attributes = await this.catalog.attributesFor(service.definitionId);
      service.attributes = validateAttributes(attributes, AttributeScope.SERVICE, dto.attributes);
    }

    if (dto.displayName !== undefined) service.displayName = dto.displayName || null;
    if (dto.description !== undefined) service.description = dto.description || null;
    if (dto.concurrentCapacity !== undefined) service.concurrentCapacity = dto.concurrentCapacity;
    if (dto.active !== undefined) service.active = dto.active;

    return this.services.save(service);
  }

  /**
   * Takes a service off the business.
   *
   * Refused while any offering under it is still live, because a booking in
   * flight refers to the offering it was priced from. Deactivating is the
   * usual answer and is what the message points at.
   */
  async removeService(actor: AuthUser, vendorId: string, id: string): Promise<{ success: true }> {
    const service = await this.ownedService(actor, vendorId, id);

    const live = await this.offerings.count({ where: { vendorServiceId: id, active: true } });
    if (live > 0) {
      throw new BadRequestException(
        'Retire the prices under this service first, or switch the service off instead of removing it.',
      );
    }

    await this.offerings.delete({ vendorServiceId: id });
    await this.services.remove(service);
    return { success: true };
  }

  // -------------------------------------------------------------- offerings

  async addOffering(
    actor: AuthUser,
    vendorId: string,
    serviceId: string,
    dto: UpsertOfferingDto,
  ): Promise<ServiceOffering> {
    const service = await this.ownedService(actor, vendorId, serviceId);
    const definition = await this.catalog.getDefinition(service.definitionId);
    this.assertPricingAllowed(definition, dto);

    return this.offerings.save(
      this.offerings.create({
        vendorServiceId: service.id,
        name: dto.name,
        description: dto.description ?? null,
        pricingModel: dto.pricingModel,
        price: QUOTE_ONLY.includes(dto.pricingModel) ? null : (dto.price ?? null),
        currency: dto.currency ?? 'INR',
        unitLabel: dto.unitLabel ?? null,
        minQuantity: dto.minQuantity ?? null,
        maxQuantity: dto.maxQuantity ?? null,
        isPackage: dto.isPackage ?? false,
        inclusions: dto.inclusions ?? [],
        active: dto.active ?? true,
        sortOrder: dto.sortOrder ?? 0,
      }),
    );
  }

  async updateOffering(
    actor: AuthUser,
    vendorId: string,
    serviceId: string,
    offeringId: string,
    dto: UpsertOfferingDto,
  ): Promise<ServiceOffering> {
    const service = await this.ownedService(actor, vendorId, serviceId);
    const offering = await this.offerings.findOne({
      where: { id: offeringId, vendorServiceId: service.id },
    });
    if (!offering) throw new NotFoundException('That price is not on this service');

    const definition = await this.catalog.getDefinition(service.definitionId);
    this.assertPricingAllowed(definition, dto);

    Object.assign(offering, {
      name: dto.name,
      description: dto.description ?? null,
      pricingModel: dto.pricingModel,
      price: QUOTE_ONLY.includes(dto.pricingModel) ? null : (dto.price ?? null),
      currency: dto.currency ?? offering.currency,
      unitLabel: dto.unitLabel ?? null,
      minQuantity: dto.minQuantity ?? null,
      maxQuantity: dto.maxQuantity ?? null,
      isPackage: dto.isPackage ?? false,
      inclusions: dto.inclusions ?? [],
      active: dto.active ?? offering.active,
      sortOrder: dto.sortOrder ?? offering.sortOrder,
    });
    return this.offerings.save(offering);
  }

  async removeOffering(
    actor: AuthUser,
    vendorId: string,
    serviceId: string,
    offeringId: string,
  ): Promise<{ success: true }> {
    const service = await this.ownedService(actor, vendorId, serviceId);
    const offering = await this.offerings.findOne({
      where: { id: offeringId, vendorServiceId: service.id },
    });
    if (!offering) throw new NotFoundException('That price is not on this service');

    await this.offerings.remove(offering);
    return { success: true };
  }

  /**
   * The rules the administrator's configuration imposes on a price.
   *
   * All four are the same kind of check: the catalog said what this service
   * may do, and the vendor is being held to it.
   */
  private assertPricingAllowed(definition: ServiceDefinition, dto: UpsertOfferingDto): void {
    if (!definition.allowedPricingModels.includes(dto.pricingModel)) {
      throw new BadRequestException(
        `${definition.name} cannot be priced ${dto.pricingModel.replace(/_/g, ' ')}. ` +
          `Allowed: ${definition.allowedPricingModels.join(', ')}.`,
      );
    }

    if (dto.isPackage && !definition.packagesAllowed) {
      throw new BadRequestException(`${definition.name} is not sold as a package`);
    }

    const quoteOnly = QUOTE_ONLY.includes(dto.pricingModel);
    if (!quoteOnly && (dto.price === undefined || dto.price === null || dto.price === '')) {
      throw new BadRequestException('Give a price, or choose Custom Quote if you quote per job');
    }
    if (!quoteOnly && Number(dto.price) < 0) {
      throw new BadRequestException('A price cannot be negative');
    }

    if (
      dto.minQuantity !== undefined &&
      dto.maxQuantity !== undefined &&
      dto.minQuantity > dto.maxQuantity
    ) {
      throw new BadRequestException('The minimum quantity is above the maximum');
    }
    if (
      (dto.minQuantity !== undefined || dto.maxQuantity !== undefined) &&
      !QUANTITY_MODELS.includes(dto.pricingModel)
    ) {
      throw new BadRequestException(
        'Minimum and maximum quantity only mean something on a per-unit price',
      );
    }
  }

  // ------------------------------------------------------------ buyer side

  /**
   * What a buyer needs to make a request against one service: the questions to
   * ask them, and the prices they can choose from.
   *
   * This is the route that replaces a hand-written booking form per vendor
   * type. The form is generated from the definition the vendor picked.
   */
  async bookingContext(vendorServiceId: string) {
    const service = await this.services.findOne({ where: { id: vendorServiceId } });
    if (!service) throw new NotFoundException('That service is not available');
    if (!service.active) throw new BadRequestException('That service is not currently offered');

    const [definition, attributes, offerings, vendor] = await Promise.all([
      this.catalog.getDefinition(service.definitionId),
      this.catalog.attributesFor(service.definitionId),
      this.offerings.find({
        where: { vendorServiceId, active: true },
        order: { sortOrder: 'ASC', name: 'ASC' },
      }),
      this.vendors.findOne({ where: { id: service.vendorId } }),
    ]);

    if (offerings.length === 0) {
      throw new BadRequestException('This service has no published prices yet');
    }

    return {
      vendorService: service,
      vendorId: service.vendorId,
      vendorName: vendor?.name ?? null,
      definition,
      availabilityModel: definition.availabilityModel,
      bookingForm: describeForm(attributes, AttributeScope.BOOKING),
      offerings,
    };
  }

  /**
   * Validates a buyer's answers to a service's booking form.
   *
   * Lives here rather than in the bookings module so that the rules a form was
   * generated from and the rules its submission is checked against are the
   * same code. The bookings module calls this and stores what comes back.
   */
  async validateBookingAnswers(
    vendorServiceId: string,
    answers: Record<string, unknown> | undefined,
  ): Promise<{ service: VendorService; answers: Record<string, unknown> }> {
    const service = await this.services.findOne({ where: { id: vendorServiceId } });
    if (!service) throw new NotFoundException('That service is not available');
    if (!service.active) throw new BadRequestException('That service is not currently offered');

    const attributes = await this.catalog.attributesFor(service.definitionId);
    return {
      service,
      answers: validateAttributes(attributes, AttributeScope.BOOKING, answers),
    };
  }

  async findOffering(id: string): Promise<ServiceOffering | null> {
    return this.offerings.findOne({ where: { id } });
  }

  async findService(id: string): Promise<VendorService | null> {
    return this.services.findOne({ where: { id } });
  }
}

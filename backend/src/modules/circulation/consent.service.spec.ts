import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConsentService } from './consent.service';
import { ProfileConsent } from './entities/profile-consent.entity';
import { Profile } from '../users/entities/profile.entity';
import { AppConfigService } from '../../config/app-config.service';
import { AuditService } from '../../platform/audit/audit.service';
import {
  ConsentMethod,
  ConsentRelation,
  ConsentScope,
  ProfileClaimStatus,
  UserRole,
} from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const agent: AuthUser = {
  userId: 'agent-1',
  email: 'agent@example.com',
  role: UserRole.AGENT,
  managedByAgentId: null,
};

const consentRow = (over: Partial<ProfileConsent> = {}): ProfileConsent =>
  ({
    id: 'c1',
    profileId: 'p1',
    scope: ConsentScope.INTAKE,
    method: ConsentMethod.IN_PERSON,
    givenByRelation: ConsentRelation.FATHER,
    givenByName: 'Ramesh',
    givenByPhone: null,
    givenAt: '2026-08-01',
    capturedByUserId: 'agent-1',
    notes: null,
    expiresAt: null,
    revokedAt: null,
    revokedReason: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    ...over,
  }) as ProfileConsent;

const managedProfile = (over: Partial<Profile> = {}): Profile =>
  ({
    id: 'p1',
    userId: null,
    managedByUserId: 'agent-1',
    claimStatus: ProfileClaimStatus.UNCLAIMED,
    displayName: 'Priya',
    ...over,
  }) as Profile;

describe('ConsentService', () => {
  let service: ConsentService;
  let rows: ProfileConsent[] = [];

  const consentRepo = {
    find: jest.fn(async () => rows),
    findOne: jest.fn(async () => rows[0] ?? null),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => {
      const saved = { id: `c${rows.length + 1}`, createdAt: new Date(), ...x };
      rows = [...rows.filter((r) => r.id !== saved.id), saved];
      return saved;
    }),
    createQueryBuilder: jest.fn(),
  };
  const profileRepo = {
    findOne: jest.fn(async () => managedProfile()),
    save: jest.fn(async (x) => x),
  };
  const cfg = {
    stewardship: { circulationConsentValidityDays: 365 },
  } as unknown as AppConfigService;
  const audit = { record: jest.fn() } as unknown as AuditService;

  beforeEach(async () => {
    jest.clearAllMocks();
    rows = [];
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConsentService,
        { provide: getRepositoryToken(ProfileConsent), useValue: consentRepo },
        { provide: getRepositoryToken(Profile), useValue: profileRepo },
        { provide: AppConfigService, useValue: cfg },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(ConsentService);
  });

  describe('state', () => {
    it('reports nothing recorded on a fresh profile', async () => {
      const state = await service.stateFor('p1');
      expect(state.intake).toBeNull();
      expect(state.mayCirculate).toBe(false);
      expect(state.reason).toMatch(/no intake consent/i);
    });

    // The distinction the product asked for: holding details is one agreement,
    // passing them around is another.
    it('does not treat intake consent as permission to circulate', async () => {
      rows = [consentRow({ scope: ConsentScope.INTAKE })];
      const state = await service.stateFor('p1');
      expect(state.intake).not.toBeNull();
      expect(state.mayCirculate).toBe(false);
      expect(state.reason).toMatch(/circulation consent/i);
    });

    it('allows circulation once both are recorded', async () => {
      rows = [
        consentRow({ id: 'c1', scope: ConsentScope.INTAKE }),
        consentRow({
          id: 'c2',
          scope: ConsentScope.CIRCULATION,
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      ];
      const state = await service.stateFor('p1');
      expect(state.mayCirculate).toBe(true);
      expect(state.needsReconfirmation).toBe(false);
    });

    it('asks for re-confirmation once circulation consent has lapsed', async () => {
      rows = [
        consentRow({ id: 'c1', scope: ConsentScope.INTAKE }),
        consentRow({
          id: 'c2',
          scope: ConsentScope.CIRCULATION,
          expiresAt: new Date(Date.now() - 1000),
        }),
      ];
      const state = await service.stateFor('p1');
      expect(state.mayCirculate).toBe(false);
      expect(state.needsReconfirmation).toBe(true);
      expect(state.reason).toMatch(/lapsed/i);
    });

    it('ignores revoked consent', async () => {
      rows = [
        consentRow({ id: 'c1', scope: ConsentScope.INTAKE }),
        consentRow({
          id: 'c2',
          scope: ConsentScope.CIRCULATION,
          expiresAt: new Date(Date.now() + 86_400_000),
          revokedAt: new Date(),
        }),
      ];
      const state = await service.stateFor('p1');
      expect(state.mayCirculate).toBe(false);
      expect(state.needsReconfirmation).toBe(true);
    });

    it('takes the newest record when consent has been re-confirmed', async () => {
      rows = [
        consentRow({ id: 'c1', scope: ConsentScope.INTAKE }),
        consentRow({
          id: 'c2',
          scope: ConsentScope.CIRCULATION,
          expiresAt: new Date(Date.now() - 1000),
          createdAt: new Date('2025-01-01T00:00:00Z'),
        }),
        consentRow({
          id: 'c3',
          scope: ConsentScope.CIRCULATION,
          expiresAt: new Date(Date.now() + 86_400_000),
          createdAt: new Date('2026-08-01T00:00:00Z'),
        }),
      ];
      const state = await service.stateFor('p1');
      expect(state.mayCirculate).toBe(true);
      expect(state.circulation?.id).toBe('c3');
    });
  });

  describe('assertMayCirculate', () => {
    it('refuses an agency-built profile with no circulation consent', async () => {
      rows = [consentRow({ scope: ConsentScope.INTAKE })];
      await expect(service.assertMayCirculate(managedProfile())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('allows it once circulation consent is live', async () => {
      rows = [
        consentRow({ id: 'c1', scope: ConsentScope.INTAKE }),
        consentRow({
          id: 'c2',
          scope: ConsentScope.CIRCULATION,
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      ];
      await expect(service.assertMayCirculate(managedProfile())).resolves.toBeUndefined();
    });

    // Somebody sharing their own details needs no agency consent record.
    it('never blocks a self-managed profile', async () => {
      rows = [];
      await expect(
        service.assertMayCirculate(managedProfile({ claimStatus: ProfileClaimStatus.SELF })),
      ).resolves.toBeUndefined();
      await expect(
        service.assertMayCirculate(managedProfile({ claimStatus: ProfileClaimStatus.CLAIMED })),
      ).resolves.toBeUndefined();
    });
  });

  describe('recording', () => {
    it('expires circulation consent but not intake consent', async () => {
      await service.record(agent, 'p1', {
        scope: ConsentScope.INTAKE,
        method: ConsentMethod.IN_PERSON,
        givenByRelation: ConsentRelation.FATHER,
        givenByName: 'Ramesh',
        givenAt: '2026-08-01',
      });
      expect(consentRepo.create.mock.calls[0][0].expiresAt).toBeNull();

      await service.record(agent, 'p1', {
        scope: ConsentScope.CIRCULATION,
        method: ConsentMethod.PHONE,
        givenByRelation: ConsentRelation.SELF,
        givenByName: 'Priya',
        givenAt: '2026-08-01',
      });
      expect(consentRepo.create.mock.calls[1][0].expiresAt).toBeInstanceOf(Date);
    });

    it('refuses to record consent on a profile the caller does not manage', async () => {
      profileRepo.findOne.mockResolvedValueOnce(managedProfile({ managedByUserId: 'other-agent' }));
      await expect(
        service.record(agent, 'p1', {
          scope: ConsentScope.INTAKE,
          method: ConsentMethod.IN_PERSON,
          givenByRelation: ConsentRelation.SELF,
          givenByName: 'X',
          givenAt: '2026-08-01',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});

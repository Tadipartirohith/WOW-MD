import { Injectable, NotFoundException } from '@nestjs/common';
import { Interest } from '../matchmaking/entities/interest.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Not, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Payment } from '../bookings/entities/payment.entity';
import { WeddingEvent } from '../events/entities/event.entity';
import { Profile } from '../users/entities/profile.entity';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { ServiceOffering } from '../catalog/entities/service-offering.entity';
import { OfficerServiceArea } from '../verification/entities/officer-service-area.entity';
import { SupportCase } from '../verification/entities/support-case.entity';
import { VerificationRequest } from '../verification/entities/verification-request.entity';
import { RefreshSession } from '../auth/entities/refresh-session.entity';
import {
  OfficerAvailability,
  availabilityView,
} from '../verification/entities/officer-availability.entity';
import { AgentCharge } from '../agents/entities/agent-charge.entity';
import {
  ActivityQueryDto,
  AdminBookingQueryDto,
  AdminTransactionQueryDto,
  DirectoryQueryDto,
  ReportQueryDto,
} from './dto/console.dto';
import {
  BookingStatus,
  BusinessStatus,
  CaseStatus,
  InterestStatus,
  MatchFixedState,
  NetworkVisibility,
  PaymentStatus,
  ProfileLifecycle,
  ProviderType,
  UserRole,
  VerificationStatus,
} from '../../common/enums';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import { AppConfigService } from '../../config/app-config.service';

/** The names hung on a booking row so a list answers who/whom/what (EZ1-I173). */
export interface AdminBookingParties {
  buyerName: string | null;
  providerName: string | null;
  serviceName: string | null;
  amountPaid: string;
}

/** One line in the activity feed. Deliberately uniform across every source. */
export interface ActivityItem {
  at: Date;
  /** What happened, in the platform's own vocabulary. */
  kind: string;
  /** A sentence somebody can read without opening anything. */
  summary: string;
  resourceType: string;
  resourceId: string;
}

@Injectable()
export class AdminConsoleService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(WeddingEvent) private readonly events: Repository<WeddingEvent>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(ProfileDetails) private readonly profileDetails: Repository<ProfileDetails>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    @InjectRepository(VendorService) private readonly vendorServices: Repository<VendorService>,
    @InjectRepository(ServiceOffering) private readonly offerings: Repository<ServiceOffering>,
    @InjectRepository(OfficerServiceArea)
    private readonly serviceAreas: Repository<OfficerServiceArea>,
    @InjectRepository(SupportCase) private readonly cases: Repository<SupportCase>,
    @InjectRepository(VerificationRequest)
    private readonly verifications: Repository<VerificationRequest>,
    // Read-only, for whether an officer is reachable right now and when they
    // were last seen — the roster question a bare account row cannot answer.
    @InjectRepository(RefreshSession) private readonly sessions: Repository<RefreshSession>,
    @InjectRepository(AgentCharge) private readonly charges: Repository<AgentCharge>,
    // Read-only, for the matchmaking half of an individual's history.
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
    // Read-only, for an officer's leave state (EZ1-I210) on the roster.
    @InjectRepository(OfficerAvailability)
    private readonly availability: Repository<OfficerAvailability>,
    private readonly cfg: AppConfigService,
  ) {}

  /**
   * What has been happening, across the whole platform.
   *
   * Distinct from the audit trail, which records *privileged* actions — who
   * approved what, who moved money. This is the ordinary life of the platform:
   * people signing up, listings being submitted, bookings arriving, complaints
   * being raised. An administrator opening the console wants to know whether
   * anything is happening at all before they want to know who did what to whom.
   *
   * Assembled by taking the newest few rows from each source and merging them
   * rather than by a SQL UNION. The union would be one query and several
   * hundred lines of hand-written column aliasing across tables that share
   * almost no shape; this is six small indexed reads on `createdAt` and a sort
   * of at most a few dozen rows. When the feed grows a source, it grows by four
   * lines here instead of by a rewrite.
   */
  async activity(q: ActivityQueryDto): Promise<ActivityItem[]> {
    const take = q.limit;

    const [users, listings, bookings, cases, verifications, clients] = await Promise.all([
      this.users.find({ order: { createdAt: 'DESC' }, take, select: ['id', 'role', 'createdAt'] }),
      this.vendors.find({ order: { createdAt: 'DESC' }, take }),
      this.bookings.find({ order: { createdAt: 'DESC' }, take }),
      this.cases.find({ order: { createdAt: 'DESC' }, take }),
      this.verifications.find({ order: { createdAt: 'DESC' }, take }),
      this.users.find({
        where: { managedByAgentId: Not(IsNull()) },
        order: { createdAt: 'DESC' },
        take,
        select: ['id', 'createdAt'],
      }),
    ]);

    const items: ActivityItem[] = [
      ...users.map((u) => ({
        at: u.createdAt,
        kind: 'account.registered',
        summary: `A ${u.role.replace(/_/g, ' ')} account was created`,
        resourceType: 'user',
        resourceId: u.id,
      })),
      ...listings.map((v) => ({
        at: v.createdAt,
        kind: 'business.created',
        summary: `${v.name} was listed under ${v.category}`,
        resourceType: 'vendor',
        resourceId: v.id,
      })),
      ...bookings.map((b) => ({
        at: b.createdAt,
        kind: 'booking.placed',
        summary: `A booking was placed${b.eventDate ? ` for ${b.eventDate}` : ''}`,
        resourceType: 'booking',
        resourceId: b.id,
      })),
      ...cases.map((c) => ({
        at: c.createdAt,
        kind: 'case.raised',
        // The title is what the complainant wrote, so it is quoted rather than
        // paraphrased — a feed that summarises complaints in its own words is
        // a feed nobody trusts.
        summary: `Case raised: ${c.title}`,
        resourceType: 'support_case',
        resourceId: c.id,
      })),
      ...verifications.map((v) => ({
        at: v.createdAt,
        kind: 'verification.raised',
        summary: `A ${v.applicantType} verification entered the queue`,
        resourceType: 'verification_request',
        resourceId: v.id,
      })),
      ...clients.map((c) => ({
        at: c.createdAt,
        kind: 'client.onboarded',
        summary: 'An agency took on a client',
        resourceType: 'agent_client',
        resourceId: c.id,
      })),
    ];

    return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, take);
  }

  /**
   * The accounts directory, filtered the way an administrator actually looks.
   *
   * `listUsers` already pages by role. What it could not do is answer "show me
   * the suspended ones" or "find this email", which is how somebody arrives
   * here — from a complaint naming a person, not from a wish to browse.
   */
  async directory(q: DirectoryQueryDto): Promise<PaginatedResult<Record<string, unknown>>> {
    const qb = this.users
      .createQueryBuilder('u')
      .select([
        'u.id',
        'u.email',
        'u.role',
        'u.isActive',
        'u.isVerified',
        'u.managedByAgentId',
        'u.createdAt',
      ]);

    if (q.role) qb.andWhere('u.role = :role', { role: q.role });
    if (q.active !== undefined) {
      qb.andWhere('u.isActive = :active', { active: q.active === true });
    }
    if (q.q) {
      qb.andWhere('LOWER(u.email) LIKE :needle', { needle: `%${q.q.toLowerCase()}%` });
    }

    qb.orderBy('u.createdAt', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();
    return paginate(data as unknown as Record<string, unknown>[], total, q.page, q.limit);
  }

  /**
   * One account and everything hanging off it.
   *
   * The screen this feeds exists because the alternative — an administrator
   * opening six lists and filtering each by a uuid — is how the wrong account
   * gets suspended. Password and MFA columns are never selected: there is
   * nothing an administrator can do with a hash except leak it.
   */
  async accountDetail(userId: string) {
    const user = await this.users.findOne({
      where: { id: userId },
      select: [
        'id',
        'email',
        'role',
        'isActive',
        'isVerified',
        'managedByAgentId',
        'phone',
        'createdAt',
      ],
    });
    if (!user) throw new NotFoundException('Account not found');

    const [profiles, listings, placed, raised, against, verifications] = await Promise.all([
      this.profiles.find({ where: [{ userId }, { managedByUserId: userId }] }),
      this.vendors.find({ where: { ownerUserId: userId } }),
      this.bookings.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 20 }),
      this.cases.find({ where: { raisedByUserId: userId }, order: { createdAt: 'DESC' }, take: 20 }),
      this.cases.find({
        where: { assignedToUserId: userId },
        order: { createdAt: 'DESC' },
        take: 20,
      }),
      this.verifications.find({ where: { applicantUserId: userId } }),
    ]);

    const profileIds = profiles.map((p) => p.id);

    /*
     * The provider side (EZ1-I172).
     *
     * `placed` above is what this account booked as a buyer. A vendor or
     * planner account also has bookings made *with* them — keyed by their
     * business/profile id, not their user id — which is the list their detail
     * page is actually about. Fetched here so the same read serves both.
     */
    const plannerBusinesses = await this.planners.find({ where: { ownerUserId: userId } });
    const providerIds = [...listings.map((v) => v.id), ...plannerBusinesses.map((p) => p.id)];
    const providerBookings = providerIds.length
      ? await this.attachParties(
          await this.bookings.find({
            where: { providerId: In(providerIds) },
            order: { createdAt: 'DESC' },
            take: 20,
          }),
        )
      : [];

    /*
     * The parts that only make sense for some accounts.
     *
     * Asked conditionally rather than always, because the honest answer for an
     * officer's matchmaking history is not an empty array — it is that the
     * question does not apply, and a screen showing four empty sections
     * teaches an administrator to stop reading it.
     */
    const [interests, money, agencyClients, officerLoad, officerAreas, officerDecisions] =
      await Promise.all([
        profileIds.length
          ? this.interests.find({
              where: [{ fromProfileId: In(profileIds) }, { toProfileId: In(profileIds) }],
              order: { createdAt: 'DESC' },
              take: 50,
            })
          : Promise.resolve([]),
        this.payments.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 50 }),
        user.role === UserRole.AGENT
          ? this.users.find({
              where: { managedByAgentId: userId },
              select: ['id', 'email', 'role', 'isActive', 'createdAt'],
            })
          : Promise.resolve([]),
        user.role === UserRole.IN_PERSON
          ? this.verifications.find({
              where: { assignedToUserId: userId },
              order: { createdAt: 'DESC' },
            })
          : Promise.resolve([]),
        // Where this officer travels (EZ1-I188), and the visits they have
        // actually decided — assigned work is the queue, decisions are the record.
        user.role === UserRole.IN_PERSON
          ? this.serviceAreas.find({ where: { officerUserId: userId }, order: { createdAt: 'ASC' } })
          : Promise.resolve([]),
        user.role === UserRole.IN_PERSON
          ? this.verifications.find({
              where: { decidedByUserId: userId },
              order: { decidedAt: 'DESC' },
              take: 20,
            })
          : Promise.resolve([]),
      ]);

    // The matchmaking story as counts, because fifty interest rows is not an
    // answer to "where is this person up to".
    const matchmaking = profileIds.length
      ? {
          sent: interests.filter((i) => profileIds.includes(i.fromProfileId)).length,
          received: interests.filter((i) => profileIds.includes(i.toProfileId)).length,
          accepted: interests.filter((i) => i.status === InterestStatus.ACCEPTED).length,
          fixed: interests.filter((i) => i.matchFixedState === MatchFixedState.CONFIRMED).length,
          history: interests.slice(0, 20),
        }
      : null;

    const sum = (rows: { amount: string }[]) =>
      rows.reduce((n, r) => n + Number(r.amount ?? 0), 0).toFixed(2);

    return {
      user,
      profiles: profiles.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        lifecycle: p.lifecycle,
        city: p.city,
      })),
      businesses: listings.map((v) => ({
        id: v.id,
        name: v.name,
        category: v.category,
        status: v.status,
        isApproved: v.isApproved,
      })),
      bookings: placed,
      /** Bookings made *with* this account (vendor/planner), newest first. */
      providerBookings,
      /**
       * A planner's own agency record(s) — the vendor equivalent is `businesses`.
       * The full agency detail (packages, coverage, contact) rides along so the
       * planner detail page can show everything without a second read (EZ1-I188).
       */
      plannerBusinesses: plannerBusinesses.map((p) => ({
        id: p.id,
        name: p.agencyName,
        city: p.city,
        isApproved: p.isApproved,
        bio: p.bio,
        servesCities: p.servesCities,
        packages: p.packages,
        yearsExperience: p.yearsExperience,
        contactPerson: p.contactPerson,
        contactPhone: p.contactPhone,
        contactEmail: p.contactEmail,
        address: p.address,
        state: p.state,
        pincode: p.pincode,
        website: p.website,
        ratingAvg: p.ratingAvg,
        ratingCount: p.ratingCount,
      })),
      casesRaised: raised,
      casesAssigned: against,
      verifications,

      matchmaking,

      /** What this account has paid, and what state it is in. */
      payments: {
        total: sum(money),
        inEscrow: sum(money.filter((p) => p.status === PaymentStatus.HELD_IN_ESCROW)),
        released: sum(money.filter((p) => p.status === PaymentStatus.RELEASED)),
        refunded: sum(money.filter((p) => p.status === PaymentStatus.REFUNDED)),
        history: money.slice(0, 20),
      },

      /** Only for an agency: the accounts they brought on. */
      agency:
        user.role === UserRole.AGENT
          ? {
              clients: agencyClients,
              charges: await this.charges.find({
                where: { agentUserId: userId },
                order: { createdAt: 'DESC' },
                take: 20,
              }),
            }
          : null,

      /**
       * Only for an officer: the workload, which is the thing an administrator
       * reallocating work needs and cannot get from anywhere else.
       */
      officer:
        user.role === UserRole.IN_PERSON
          ? {
              assigned: officerLoad.length,
              open: officerLoad.filter(
                (v) => !['approved', 'rejected'].includes(String(v.status)),
              ).length,
              overdue: officerLoad.filter(
                (v) => v.slaBreachedAt || (v.slaDeadline && new Date(v.slaDeadline) < new Date()),
              ).length,
              queue: officerLoad.slice(0, 20),
              /** The regions this officer will actually travel to (EZ1-I188). */
              serviceAreas: officerAreas.map((a) => ({
                id: a.id,
                label: a.label,
                city: a.city,
                state: a.state,
                primary: a.primary,
              })),
              /** Visits this officer has closed out — the record behind the queue. */
              decisions: officerDecisions.map((v) => ({
                id: v.id,
                applicantType: v.applicantType,
                status: v.status,
                decidedAt: v.decidedAt,
                createdAt: v.createdAt,
              })),
            }
          : null,
    };
  }

  /**
   * One marriage profile in full (EZ1-I185).
   *
   * The account drill-down lists an agency's associated profiles by name; this
   * is what opens when an administrator clicks one — the whole profile, not the
   * matchmaking-facing subset. The government id *number* is never stored and
   * never returned; only the last four and whether an officer verified it.
   */
  async profileDetail(profileId: string) {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');

    const [owner, steward, interests, verifier, details] = await Promise.all([
      profile.userId
        ? this.users.findOne({
            where: { id: profile.userId },
            select: ['id', 'email', 'role', 'isActive', 'isVerified', 'phone', 'createdAt'],
          })
        : Promise.resolve(null),
      profile.managedByUserId
        ? this.users.findOne({
            where: { id: profile.managedByUserId },
            select: ['id', 'email', 'role'],
          })
        : Promise.resolve(null),
      this.interests.find({
        where: [{ fromProfileId: profileId }, { toProfileId: profileId }],
        order: { createdAt: 'DESC' },
        take: 50,
      }),
      profile.idVerifiedByUserId
        ? this.users.findOne({
            where: { id: profile.idVerifiedByUserId },
            select: ['id', 'email'],
          })
        : Promise.resolve(null),
      // The matrimonial biodata behind the profile, for the personal facts the
      // profile row itself does not carry — marital status, height, education
      // and occupation (EZ1-I194).
      this.profileDetails.findOne({ where: { profileId } }),
    ]);

    return {
      profile: {
        id: profile.id,
        profileCode: profile.profileCode,
        displayName: profile.displayName,
        gender: profile.gender,
        dateOfBirth: profile.dateOfBirth,
        city: profile.city,
        address: profile.address,
        bio: profile.bio,
        photos: profile.photos ?? [],
        preferences: profile.preferences ?? {},
        // Contact and stewardship.
        contactEmail: profile.contactEmail,
        contactPhone: profile.contactPhone,
        stewardRelation: profile.stewardRelation,
        managingFor: profile.managingFor,
        claimStatus: profile.claimStatus,
        // Circulation and lifecycle.
        networkVisibility: profile.networkVisibility,
        visibility: profile.visibility,
        lifecycle: profile.lifecycle,
        lifecycleReason: profile.lifecycleReason,
        profileCompleted: profile.profileCompleted,
        lastActiveAt: profile.lastActiveAt,
        pooledAt: profile.pooledAt,
        // Identity verification, number excluded by design.
        governmentIdType: profile.governmentIdType,
        governmentIdLast4: profile.governmentIdLast4,
        idSubmittedAt: profile.idSubmittedAt,
        idVerifiedAt: profile.idVerifiedAt,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
      owner,
      steward,
      verifiedBy: verifier,
      // Personal facts kept on the biodata table, not the profile row (EZ1-I194).
      details: details
        ? {
            maritalStatus: details.maritalStatus,
            heightCm: details.heightCm,
            highestQualification: details.highestQualification,
            occupationStatus: details.occupationStatus,
          }
        : null,
      matchmaking: {
        sent: interests.filter((i) => i.fromProfileId === profileId).length,
        received: interests.filter((i) => i.toProfileId === profileId).length,
        accepted: interests.filter((i) => i.status === InterestStatus.ACCEPTED).length,
        fixed: interests.filter((i) => i.matchFixedState === MatchFixedState.CONFIRMED).length,
      },
    };
  }

  /**
   * One vendor business in full (EZ1-I188).
   *
   * The vendor account drill-down lists a vendor's businesses by name and
   * status; this is what opens when an administrator clicks one — the
   * registration and compliance details, every service in the catalogue with
   * its offerings and concurrency, the uploaded documents, the verification
   * history, and the bookings taken against it.
   */
  async businessDetail(vendorId: string) {
    const vendor = await this.vendors.findOne({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Business not found');

    const [owner, services, verifications, receivedRaw] = await Promise.all([
      this.users.findOne({
        where: { id: vendor.ownerUserId },
        select: ['id', 'email', 'role', 'isActive', 'phone', 'createdAt'],
      }),
      this.vendorServices.find({ where: { vendorId }, order: { createdAt: 'ASC' } }),
      this.verifications.find({ where: { subjectId: vendorId }, order: { createdAt: 'DESC' } }),
      this.bookings.find({
        where: { providerId: vendorId },
        order: { createdAt: 'DESC' },
        take: 20,
      }),
    ]);

    const serviceIds = services.map((s) => s.id);
    const offerings = serviceIds.length
      ? await this.offerings.find({
          where: { vendorServiceId: In(serviceIds) },
          order: { sortOrder: 'ASC' },
        })
      : [];
    const offeringsByService = new Map<string, ServiceOffering[]>();
    for (const o of offerings) {
      const list = offeringsByService.get(o.vendorServiceId) ?? [];
      list.push(o);
      offeringsByService.set(o.vendorServiceId, list);
    }

    const bookings = await this.attachParties(receivedRaw);

    return {
      business: {
        id: vendor.id,
        name: vendor.name,
        category: vendor.category,
        otherCategory: vendor.otherCategory,
        description: vendor.description,
        city: vendor.city,
        pricing: vendor.pricing ?? {},
        portfolio: vendor.portfolio ?? [],
        ratingAvg: vendor.ratingAvg,
        ratingCount: vendor.ratingCount,
        // Registration & compliance.
        gstNumber: vendor.gstNumber,
        panNumber: vendor.panNumber,
        registrationNumber: vendor.registrationNumber,
        tradingSince: vendor.tradingSince,
        registeredAddress: vendor.registeredAddress,
        contactPhone: vendor.contactPhone,
        complianceDocuments: vendor.complianceDocuments ?? [],
        // Lifecycle.
        status: vendor.status,
        isApproved: vendor.isApproved,
        submittedAt: vendor.submittedAt,
        verifiedAt: vendor.verifiedAt,
        decisionReason: vendor.decisionReason,
        revisionCount: vendor.revisionCount,
        archivedAt: vendor.archivedAt,
        payoutAccountId: vendor.payoutAccountId,
        createdAt: vendor.createdAt,
        updatedAt: vendor.updatedAt,
      },
      owner,
      /** Services & catalogue, each with its priced offerings and concurrency. */
      services: services.map((s) => ({
        id: s.id,
        displayName: s.displayName,
        description: s.description,
        concurrentCapacity: s.concurrentCapacity,
        active: s.active,
        offerings: (offeringsByService.get(s.id) ?? []).map((o) => ({
          id: o.id,
          name: o.name,
          pricingModel: o.pricingModel,
          price: o.price,
          currency: o.currency,
          unitLabel: o.unitLabel,
          isPackage: o.isPackage,
          inclusions: o.inclusions,
          active: o.active,
        })),
      })),
      verifications: verifications.map((v) => ({
        id: v.id,
        status: v.status,
        applicantType: v.applicantType,
        remarks: v.remarks,
        findings: v.findings,
        decidedAt: v.decidedAt,
        submittedAt: v.submittedAt,
        createdAt: v.createdAt,
      })),
      bookings,
    };
  }

  /**
   * One booking, with everybody and everything attached to it.
   *
   * A dispute is argued over exactly this: who booked, from whom, for which
   * day, at what price, what was quoted, what was paid and where that money is
   * now. It was six lookups by uuid, which is slow and is how the wrong
   * booking gets refunded.
   */
  async bookingDetail(bookingId: string) {
    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');

    const [client, payments, cases, vendor, planner, service] = await Promise.all([
      this.users.findOne({
        where: { id: booking.userId },
        select: ['id', 'email', 'phone', 'role', 'managedByAgentId'],
      }),
      this.payments.find({ where: { bookingId }, order: { createdAt: 'ASC' } }),
      this.cases.find({ where: { subjectId: bookingId }, order: { createdAt: 'DESC' } }),
      booking.providerType === ProviderType.VENDOR
        ? this.vendors.findOne({ where: { id: booking.providerId } })
        : Promise.resolve(null),
      booking.providerType === ProviderType.PLANNER
        ? this.planners.findOne({ where: { id: booking.providerId } })
        : Promise.resolve(null),
      booking.vendorServiceId
        ? this.vendorServices.findOne({ where: { id: booking.vendorServiceId } })
        : Promise.resolve(null),
    ]);

    const agent = client?.managedByAgentId
      ? await this.users.findOne({
          where: { id: client.managedByAgentId },
          select: ['id', 'email'],
        })
      : null;

    return {
      booking,
      client,
      // The agency behind the client, when there is one: an administrator
      // asking why a booking was made often has to ask who made it.
      agent,
      provider: vendor
        ? {
            id: vendor.id,
            ownerUserId: vendor.ownerUserId,
            name: vendor.name,
            category: vendor.category,
            status: vendor.status,
            type: booking.providerType,
          }
        : planner
          ? {
              id: planner.id,
              ownerUserId: planner.ownerUserId,
              name: planner.agencyName,
              category: 'Wedding planner',
              status: null,
              type: booking.providerType,
            }
          : { id: booking.providerId, type: booking.providerType },
      service: service ? { id: service.id, name: service.displayName } : null,
      payments,
      disputes: cases,
    };
  }

  /**
   * Every business on the platform, by state.
   *
   * A vendor's *account* and their *businesses* are different rows, and this
   * lists the businesses — which is what a question like "how many listings are
   * stuck in first review" is actually about.
   */
  async businesses(q: DirectoryQueryDto): Promise<PaginatedResult<Vendor>> {
    const qb = this.vendors.createQueryBuilder('v');
    if (q.status) qb.andWhere('v.status = :status', { status: q.status });
    if (q.q) qb.andWhere('LOWER(v.name) LIKE :needle', { needle: `%${q.q.toLowerCase()}%` });
    if (q.city) qb.andWhere('LOWER(v.city) = LOWER(:city)', { city: q.city });

    qb.orderBy('v.createdAt', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, q.page, q.limit);
  }

  /**
   * Every booking on the platform, across all thirteen stages.
   *
   * The vendor sees their incoming work and the buyer sees their own; nobody
   * could see the whole book. That is the view a dispute starts from — "what
   * else has this vendor got in flight" — and it is also the only way to notice
   * that forty bookings have been sitting in `payment_pending` for a fortnight.
   */
  async allBookings(
    q: AdminBookingQueryDto,
  ): Promise<PaginatedResult<Booking & AdminBookingParties>> {
    const qb = this.bookings.createQueryBuilder('b');
    if (q.status) qb.andWhere('b.status = :status', { status: q.status });
    if (q.providerId) qb.andWhere('b.providerId = :providerId', { providerId: q.providerId });
    if (q.userId) qb.andWhere('b.userId = :userId', { userId: q.userId });
    if (q.from) qb.andWhere('b.createdAt >= :from', { from: new Date(q.from) });
    if (q.to) qb.andWhere('b.createdAt <= :to', { to: new Date(q.to) });

    qb.orderBy('b.createdAt', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();
    const enriched = await this.attachParties(data);
    return paginate(enriched, total, q.page, q.limit);
  }

  /**
   * Put a name on every side of a booking (EZ1-I173).
   *
   * The list row has to answer "who booked whom, for what" without the admin
   * opening it: the buyer's display name, the provider's business name whether
   * it is a vendor or a planner, the service, and how much of the money has
   * actually been captured. Resolved in one batched read per kind rather than
   * per row, the same shape `transactions` already uses.
   */
  private async attachParties(rows: Booking[]): Promise<(Booking & AdminBookingParties)[]> {
    if (rows.length === 0) return [];

    const buyerIds = [...new Set(rows.map((b) => b.userId))];
    const vendorIds = [
      ...new Set(rows.filter((b) => b.providerType === ProviderType.VENDOR).map((b) => b.providerId)),
    ];
    const plannerIds = [
      ...new Set(rows.filter((b) => b.providerType === ProviderType.PLANNER).map((b) => b.providerId)),
    ];
    const serviceIds = [...new Set(rows.map((b) => b.vendorServiceId).filter(Boolean))] as string[];
    const bookingIds = rows.map((b) => b.id);

    const [profiles, vendors, planners, services, payments] = await Promise.all([
      buyerIds.length ? this.profiles.find({ where: { userId: In(buyerIds) } }) : Promise.resolve([]),
      vendorIds.length ? this.vendors.find({ where: { id: In(vendorIds) } }) : Promise.resolve([]),
      plannerIds.length ? this.planners.find({ where: { id: In(plannerIds) } }) : Promise.resolve([]),
      serviceIds.length
        ? this.vendorServices.find({ where: { id: In(serviceIds) } })
        : Promise.resolve([]),
      this.payments.find({ where: { bookingId: In(bookingIds) } }),
    ]);

    const buyerName = new Map(profiles.map((p) => [p.userId as string, p.displayName]));
    const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
    const plannerName = new Map(planners.map((p) => [p.id, p.agencyName]));
    const serviceName = new Map(services.map((s) => [s.id, s.displayName]));

    // Money captured so far, per booking. INITIATED has not been taken and
    // REFUNDED has gone back, so neither counts as paid.
    const paidByBooking = new Map<string, number>();
    for (const p of payments) {
      if (p.status === PaymentStatus.INITIATED || p.status === PaymentStatus.REFUNDED) continue;
      paidByBooking.set(p.bookingId, (paidByBooking.get(p.bookingId) ?? 0) + Number(p.amount ?? 0));
    }

    return rows.map((b) => ({
      ...b,
      buyerName: buyerName.get(b.userId) ?? null,
      providerName:
        b.providerType === ProviderType.VENDOR
          ? (vendorName.get(b.providerId) ?? null)
          : (plannerName.get(b.providerId) ?? null),
      serviceName: b.vendorServiceId ? (serviceName.get(b.vendorServiceId) ?? null) : null,
      amountPaid: (paidByBooking.get(b.id) ?? 0).toFixed(2),
    }));
  }

  /**
   * Every payment on the platform, for the admin Payments/Transactions page
   * (EZ1-I111): the booking it is on, the customer and provider, the instalment,
   * amount, escrow/payout status and date. One row per payment, newest first.
   */
  async transactions(q: AdminTransactionQueryDto): Promise<
    PaginatedResult<{
      paymentId: string;
      bookingId: string;
      milestone: string;
      status: string;
      amount: string;
      commissionAmount: string;
      payoutAmount: string;
      currency: string;
      createdAt: Date;
      buyerName: string | null;
      providerName: string | null;
      providerType: string | null;
    }>
  > {
    const qb = this.payments.createQueryBuilder('p');
    if (q.status) qb.andWhere('p.status = :status', { status: q.status });
    qb.orderBy('p.createdAt', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);
    const [rows, total] = await qb.getManyAndCount();
    if (rows.length === 0) return paginate([], total, q.page, q.limit);

    const bookings = await this.bookings.find({
      where: { id: In([...new Set(rows.map((r) => r.bookingId))]) },
    });
    const bookingById = new Map(bookings.map((b) => [b.id, b]));
    const buyerIds = [...new Set(bookings.map((b) => b.userId))];
    const vendorIds = [
      ...new Set(bookings.filter((b) => b.providerType === 'vendor').map((b) => b.providerId)),
    ];
    const [profiles, vendors] = await Promise.all([
      buyerIds.length ? this.profiles.find({ where: { userId: In(buyerIds) } }) : Promise.resolve([]),
      vendorIds.length ? this.vendors.find({ where: { id: In(vendorIds) } }) : Promise.resolve([]),
    ]);
    const buyerName = new Map(profiles.map((p) => [p.userId as string, p.displayName]));
    const vendorName = new Map(vendors.map((v) => [v.id, v.name]));

    const data = rows.map((p) => {
      const b = bookingById.get(p.bookingId);
      return {
        paymentId: p.id,
        bookingId: p.bookingId,
        milestone: p.milestone,
        status: p.status,
        amount: p.amount,
        commissionAmount: p.commissionAmount,
        payoutAmount: p.payoutAmount,
        currency: p.currency,
        createdAt: p.createdAt,
        buyerName: b ? (buyerName.get(b.userId) ?? null) : null,
        providerName: b?.providerType === 'vendor' ? (vendorName.get(b.providerId) ?? null) : null,
        providerType: b?.providerType ?? null,
      };
    });
    return paginate(data, total, q.page, q.limit);
  }

  /**
   * One payment in full, for the admin Payment Details view (EZ1-I202).
   *
   * A single transaction row only makes sense against the whole booking it sits
   * on: the customer and provider it is between, the service and event it paid
   * for, and its sibling instalments — because "the advance released but the
   * balance is still in escrow" is the sentence an administrator is actually
   * reading. Gathered in one read the way `bookingDetail` already is, and the
   * escrow position is summed across every payment on the booking so the
   * numbers agree with the dashboard's cards.
   */
  async transactionDetail(paymentId: string) {
    const payment = await this.payments.findOne({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');

    const booking = await this.bookings.findOne({ where: { id: payment.bookingId } });

    const [siblings, client, vendor, planner, service, event] = await Promise.all([
      this.payments.find({ where: { bookingId: payment.bookingId }, order: { createdAt: 'ASC' } }),
      booking
        ? this.users.findOne({
            where: { id: booking.userId },
            select: ['id', 'email', 'phone', 'role'],
          })
        : Promise.resolve(null),
      booking?.providerType === ProviderType.VENDOR
        ? this.vendors.findOne({ where: { id: booking.providerId } })
        : Promise.resolve(null),
      booking?.providerType === ProviderType.PLANNER
        ? this.planners.findOne({ where: { id: booking.providerId } })
        : Promise.resolve(null),
      booking?.vendorServiceId
        ? this.vendorServices.findOne({ where: { id: booking.vendorServiceId } })
        : Promise.resolve(null),
      booking?.eventId
        ? this.events.findOne({ where: { id: booking.eventId } })
        : Promise.resolve(null),
    ]);

    const clientProfile = booking
      ? await this.profiles.findOne({ where: { userId: booking.userId } })
      : null;

    // The escrow position across the whole booking, summed the same way the
    // dashboard's cards are: held/released count `amount`, the provider's share
    // and commission come off the released rows, refunded counts `amount`.
    const sum = (predicate: (p: Payment) => boolean, column: keyof Payment) =>
      siblings
        .filter(predicate)
        .reduce((t, p) => t + Number((p[column] as string) ?? 0), 0)
        .toFixed(2);

    return {
      payment,
      booking: booking
        ? {
            id: booking.id,
            status: booking.status,
            amount: booking.amount,
            currency: booking.currency,
            eventDate: booking.eventDate,
            createdAt: booking.createdAt,
          }
        : null,
      customer: client
        ? {
            id: client.id,
            name: clientProfile?.displayName ?? null,
            email: client.email,
            phone: client.phone,
            role: client.role,
          }
        : null,
      provider: vendor
        ? {
            id: vendor.id,
            ownerUserId: vendor.ownerUserId,
            name: vendor.name,
            category: vendor.category,
            type: ProviderType.VENDOR,
          }
        : planner
          ? {
              id: planner.id,
              ownerUserId: planner.ownerUserId,
              name: planner.agencyName,
              category: 'Wedding planner',
              type: ProviderType.PLANNER,
            }
          : booking
            ? { id: booking.providerId, type: booking.providerType }
            : null,
      service: service ? { id: service.id, name: service.displayName } : null,
      event: event
        ? {
            id: event.id,
            name: event.name,
            venue: event.venue ?? null,
            city: event.city,
            eventDate: event.eventDate,
            startTime: event.startTime,
          }
        : null,
      // Every instalment on the booking, oldest first: the milestone breakdown
      // (advance/second/final) and the payment history/timeline are both read
      // off this list on the client.
      payments: siblings,
      summary: {
        total: booking?.amount ?? payment.amount,
        held: sum((p) => p.status === PaymentStatus.HELD_IN_ESCROW, 'amount'),
        released: sum((p) => p.status === PaymentStatus.RELEASED, 'amount'),
        refunded: sum((p) => p.status === PaymentStatus.REFUNDED, 'amount'),
        commission: sum((p) => p.status === PaymentStatus.RELEASED, 'commissionAmount'),
        payout: sum((p) => p.status === PaymentStatus.RELEASED, 'payoutAmount'),
      },
    };
  }

  /**
   * The six reports, over a window.
   *
   * One route rather than six, because they differ only in which counts they
   * ask for and every one of them wants the same date window applied the same
   * way. Six near-identical endpoints is six places for the window handling to
   * drift, and it already has a history of doing that.
   *
   * Dates are inclusive at both ends and default to the last thirty days. A
   * report with no window silently means "everything ever", which reads as a
   * catastrophic month the first time somebody screenshots it.
   */
  async report(q: ReportQueryDto) {
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from
      ? new Date(q.from)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    // Inclusive of the closing day rather than of midnight on it, which is the
    // difference between "this month" and "this month minus its last day".
    to.setHours(23, 59, 59, 999);
    const window = Between(from, to);

    switch (q.kind) {
      case 'users': {
        const rows = await this.users.find({ where: { createdAt: window }, select: ['role'] });
        const byRole: Record<string, number> = {};
        for (const role of Object.values(UserRole)) byRole[role] = 0;
        for (const r of rows) byRole[r.role] += 1;
        return { kind: q.kind, from, to, total: rows.length, byRole };
      }

      case 'agents': {
        const [agents, onboarded, charges] = await Promise.all([
          this.users.count({ where: { role: UserRole.AGENT, createdAt: window } }),
          this.users.count({ where: { managedByAgentId: Not(IsNull()), createdAt: window } }),
          this.charges.find({ where: { createdAt: window } }),
        ]);
        const money = (status: PaymentStatus) =>
          charges
            .filter((c) => c.status === status)
            .reduce((t, c) => t + Number(c.amount), 0)
            .toFixed(2);
        return {
          kind: q.kind,
          from,
          to,
          agentsRegistered: agents,
          clientsOnboarded: onboarded,
          fees: {
            outstanding: money(PaymentStatus.INITIATED),
            held: money(PaymentStatus.HELD_IN_ESCROW),
            released: money(PaymentStatus.RELEASED),
          },
        };
      }

      case 'vendors': {
        const rows = await this.vendors.find({ where: { createdAt: window } });
        const byStatus: Record<string, number> = {};
        for (const status of Object.values(BusinessStatus)) byStatus[status] = 0;
        for (const v of rows) byStatus[v.status] += 1;
        return {
          kind: q.kind,
          from,
          to,
          listed: rows.length,
          live: rows.filter((v) => v.isApproved).length,
          byStatus,
        };
      }

      case 'bookings': {
        const rows = await this.bookings.find({ where: { createdAt: window } });
        const byStatus: Record<string, number> = {};
        for (const status of Object.values(BookingStatus)) byStatus[status] = 0;
        for (const b of rows) byStatus[b.status] += 1;
        const value = rows.reduce((t, b) => t + Number(b.amount), 0);
        return {
          kind: q.kind,
          from,
          to,
          placed: rows.length,
          byStatus,
          grossValue: value.toFixed(2),
          // Requests that were never priced drag the average to nonsense, so
          // it is taken over the ones that reached a price.
          averageValue: (() => {
            const priced = rows.filter((b) => Number(b.amount) > 0);
            return priced.length ? (value / priced.length).toFixed(2) : '0.00';
          })(),
        };
      }

      case 'financial': {
        const rows = await this.payments.find({ where: { createdAt: window } });
        const sum = (status: PaymentStatus, column: 'amount' | 'payoutAmount' | 'commissionAmount') =>
          rows
            .filter((p) => p.status === status)
            .reduce((t, p) => t + Number(p[column] ?? 0), 0)
            .toFixed(2);
        return {
          kind: q.kind,
          from,
          to,
          collected: rows.reduce((t, p) => t + Number(p.amount), 0).toFixed(2),
          held: sum(PaymentStatus.HELD_IN_ESCROW, 'amount'),
          disputed: sum(PaymentStatus.DISPUTED, 'amount'),
          releasedToProviders: sum(PaymentStatus.RELEASED, 'payoutAmount'),
          commission: sum(PaymentStatus.RELEASED, 'commissionAmount'),
          refunded: sum(PaymentStatus.REFUNDED, 'amount'),
          // Owed and not yet moved. Reported separately because it is neither
          // the platform's money nor the provider's yet, and folding it into
          // either makes one of the two wrong.
          awaitingPayout: sum(PaymentStatus.PENDING_PAYOUT, 'payoutAmount'),
        };
      }

      /*
       * M2 asks for the agent profile-sharing limit to be "reviewed so users
       * get enough relevant profiles". The number itself is a product decision
       * and not one to invent from here — but it is currently being made with
       * no evidence at all, which is the part that can be fixed.
       *
       * So this reports what the limit is actually doing: how much of the
       * network is reachable, how many stewards are up against their quota,
       * and — the figure that decides it — how many active profiles are being
       * shown fewer suggestions than are worth opening the app for.
       */
      case 'matchmaking': {
        const [active, pooled, agents, familyStewards] = await Promise.all([
          this.profiles.count({ where: { lifecycle: ProfileLifecycle.ACTIVE } }),
          this.profiles.count({
            where: {
              lifecycle: ProfileLifecycle.ACTIVE,
              networkVisibility: NetworkVisibility.POOL,
            },
          }),
          this.users.count({ where: { role: UserRole.AGENT } }),
          this.users.count({ where: { role: UserRole.FAMILY } }),
        ]);

        // How full each steward's book is. The quota only bites for the ones
        // at it, and an average hides that: ten agencies at two profiles and
        // one at its ceiling is a very different picture from all eleven at
        // half.
        const managed = await this.profiles
          .createQueryBuilder('p')
          .select('p."managedByUserId"', 'steward')
          .addSelect('COUNT(p.id)', 'held')
          .where('p."managedByUserId" IS NOT NULL')
          .groupBy('p."managedByUserId"')
          .getRawMany<{ steward: string; held: string }>();

        const held = managed.map((r) => Number(r.held)).sort((a, b) => b - a);
        const ceiling = this.cfg.stewardship.maxManagedProfiles;

        return {
          kind: q.kind,
          from,
          to,
          profiles: {
            active,
            // What another agency can actually reach. A pool nobody has opted
            // into is a limit that no quota change would loosen.
            pooled,
            private: active - pooled,
            reachableShare: active ? Number(((pooled / active) * 100).toFixed(1)) : 0,
          },
          stewards: {
            agencies: agents,
            familyMembers: familyStewards,
            withProfiles: held.length,
            ceiling,
            atCeiling: held.filter((n) => n >= ceiling).length,
            busiest: held[0] ?? 0,
            median: held.length ? held[Math.floor(held.length / 2)] : 0,
          },
        };
      }

      case 'verification':
      default: {
        const [requests, cases] = await Promise.all([
          this.verifications.find({ where: { createdAt: window } }),
          this.cases.find({ where: { createdAt: window } }),
        ]);
        const byStatus: Record<string, number> = {};
        for (const status of Object.values(VerificationStatus)) byStatus[status] = 0;
        for (const r of requests) byStatus[r.status] += 1;

        const caseByStatus: Record<string, number> = {};
        for (const status of Object.values(CaseStatus)) caseByStatus[status] = 0;
        for (const c of cases) caseByStatus[c.status] += 1;

        // How long the desk actually takes, over the cases it finished in the
        // window. Measured to resolution rather than to closure, because
        // closure waits on the complainant and would report their silence as
        // the platform being slow.
        const decided = cases.filter((c) => c.resolvedAt);
        const hours = decided.map(
          (c) => (c.resolvedAt!.getTime() - c.createdAt.getTime()) / 3_600_000,
        );
        return {
          kind: 'verification',
          from,
          to,
          requests: requests.length,
          byStatus,
          cases: cases.length,
          caseByStatus,
          medianHoursToResolution: hours.length
            ? Number(hours.sort((a, b) => a - b)[Math.floor(hours.length / 2)].toFixed(1))
            : null,
          stillOpen: cases.filter(
            (c) => c.status !== CaseStatus.CLOSED && c.status !== CaseStatus.RESOLVED,
          ).length,
        };
      }
    }
  }

  /**
   * New users and new bookings per calendar day over the window (EZ1-I198).
   *
   * `report()` answers "how many in total"; a growth line needs the shape of
   * that total over time, which no existing route gives. Bucketed in memory by
   * UTC day rather than with a dialect-specific `date_trunc` — the same choice
   * `activity()` makes — because the window is at most a month, so it is two
   * indexed reads on `createdAt` and a group of a few dozen rows.
   *
   * Every day in the window gets a bucket, so a quiet day is a zero on the line
   * rather than a gap the eye misreads as missing data.
   */
  async growthSeries(q: { from?: string; to?: string }) {
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    to.setHours(23, 59, 59, 999);
    const window = Between(from, to);

    const [users, bookings] = await Promise.all([
      this.users.find({ where: { createdAt: window }, select: ['createdAt'] }),
      this.bookings.find({ where: { createdAt: window }, select: ['createdAt'] }),
    ]);

    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const points = new Map<string, { date: string; users: number; bookings: number }>();
    // Iterate in UTC so the generated keys align exactly with the UTC keys the
    // row timestamps produce; mixing local and UTC days drops a bucket at the edge.
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
    while (cursor <= end) {
      const key = dayKey(cursor);
      points.set(key, { date: key, users: 0, bookings: 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    for (const u of users) {
      const bucket = points.get(dayKey(u.createdAt));
      if (bucket) bucket.users += 1;
    }
    for (const b of bookings) {
      const bucket = points.get(dayKey(b.createdAt));
      if (bucket) bucket.bookings += 1;
    }

    return { from, to, points: [...points.values()] };
  }

  /**
   * The two staff directories, kept apart.
   *
   * An administrator and a field officer are not variants of one thing. One
   * decides who gets access; the other goes to an address and writes down what
   * they saw. Listing them together is how somebody gets given the wrong one —
   * and the officer rows carry a workload the admin rows have no meaning for.
   */
  async staff(kind: 'admin' | 'in_person') {
    const role = kind === 'admin' ? UserRole.ADMIN : UserRole.IN_PERSON;
    const rows = await this.users.find({
      where: { role },
      select: ['id', 'email', 'isActive', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
    if (kind === 'admin') {
      return rows.map((u) => ({ ...u, role, openCases: 0, openVisits: 0 }));
    }

    const ids = rows.map((u) => u.id);
    const [openCases, openVisits] = await Promise.all([
      ids.length
        ? this.cases.find({
            where: {
              assignedToUserId: In(ids),
              status: In([
                CaseStatus.ALLOCATED,
                CaseStatus.IN_PROGRESS,
                CaseStatus.WAITING_FOR_INFORMATION,
                CaseStatus.ESCALATED,
                CaseStatus.REASSIGNED,
              ]),
            },
          })
        : ([] as SupportCase[]),
      ids.length
        ? this.verifications.find({
            where: {
              assignedToUserId: In(ids),
              status: In([VerificationStatus.ASSIGNED, VerificationStatus.IN_PROGRESS]),
            },
          })
        : ([] as VerificationRequest[]),
    ]);

    return rows.map((u) => ({
      ...u,
      role,
      // Deliberately two numbers rather than one total: a queue of six visits
      // and a queue of six disputes are different amounts of work, and an
      // allocator choosing on the sum picks the wrong officer.
      openCases: openCases.filter((c) => c.assignedToUserId === u.id).length,
      openVisits: openVisits.filter((v) => v.assignedToUserId === u.id).length,
    }));
  }

  /**
   * The verification officers as a roster an administrator can actually run
   * (EZ1-I212).
   *
   * `staff()` above answers "who is carrying what" in one line each; this
   * answers the question before it — "is this a person I can send a visit to
   * right now": their coverage, whether the account is live, whether they are
   * online, and the shape of their queue split into verifications and cases.
   * Built from the aggregates allocation already trusts — the same verification
   * status counts and `officer_service_areas` rows the allocator ranks on — so
   * a number here can never disagree with a number the allocator saw.
   *
   * Availability (Available / On Leave / Unavailable) is a separate change
   * (EZ1-I210) that introduces the field. Until it lands every officer reads as
   * `available`, so the column and its filter exist now and start telling the
   * truth the day the field arrives — no second pass on this screen.
   */
  async officers() {
    const rows = await this.users.find({
      where: { role: UserRole.IN_PERSON },
      select: ['id', 'email', 'isActive', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
    const ids = rows.map((u) => u.id);
    if (ids.length === 0) return [];

    const now = Date.now();
    // A live session touched inside this window is somebody at their desk; an
    // older one is a login they never signed out of. Presence, not history.
    const ONLINE_WINDOW_MS = 5 * 60 * 1000;

    const [profiles, areas, verifRows, caseRows, sessions, availabilityRows] = await Promise.all([
      this.profiles.find({
        where: { userId: In(ids) },
        select: ['userId', 'displayName', 'city'],
      }),
      this.serviceAreas.find({
        where: { officerUserId: In(ids) },
        order: { primary: 'DESC', createdAt: 'ASC' },
      }),
      this.verifications
        .createQueryBuilder('r')
        .select('r."assignedToUserId"', 'officerUserId')
        .addSelect('r.status', 'status')
        .addSelect('COUNT(r.id)', 'count')
        .where('r."assignedToUserId" IN (:...ids)', { ids })
        .groupBy('r."assignedToUserId"')
        .addGroupBy('r.status')
        .getRawMany<{ officerUserId: string; status: string; count: string }>(),
      this.cases
        .createQueryBuilder('c')
        .select('c."assignedToUserId"', 'officerUserId')
        .addSelect('c.status', 'status')
        .addSelect('COUNT(c.id)', 'count')
        .where('c."assignedToUserId" IN (:...ids)', { ids })
        .groupBy('c."assignedToUserId"')
        .addGroupBy('c.status')
        .getRawMany<{ officerUserId: string; status: string; count: string }>(),
      this.sessions.find({
        where: { userId: In(ids), revokedAt: IsNull() },
        select: ['userId', 'lastUsedAt', 'expiresAt', 'createdAt'],
      }),
      this.availability.find({ where: { officerUserId: In(ids) } }),
    ]);

    const profileFor = new Map(profiles.map((p) => [p.userId as string, p]));
    const availabilityFor = new Map(availabilityRows.map((a) => [a.officerUserId, a]));

    // A visit that is written up and on an administrator's desk is off the
    // officer's plate — counted as completed, not pending, exactly as the
    // allocator's workload() treats it.
    const V_PENDING: string[] = [
      VerificationStatus.ASSIGNED,
      VerificationStatus.ADDITIONAL_REVIEW,
      VerificationStatus.ISSUE,
    ];
    const V_PROGRESS: string[] = [VerificationStatus.IN_PROGRESS];
    const V_DONE: string[] = [
      VerificationStatus.SUBMITTED,
      VerificationStatus.ADMIN_REVIEW,
      VerificationStatus.APPROVED,
      VerificationStatus.REJECTED,
    ];

    const C_PENDING: string[] = [
      CaseStatus.OPEN,
      CaseStatus.TRIAGED,
      CaseStatus.ALLOCATED,
      CaseStatus.REASSIGNED,
      CaseStatus.ESCALATED,
      CaseStatus.WAITING_FOR_INFORMATION,
    ];
    const C_PROGRESS: string[] = [CaseStatus.IN_PROGRESS];
    const C_DONE: string[] = [
      CaseStatus.RESOLUTION_SUBMITTED,
      CaseStatus.ADMIN_REVIEW,
      CaseStatus.RESOLVED,
      CaseStatus.REJECTED,
      CaseStatus.CLOSED,
    ];

    const tally = (
      list: { officerUserId: string; status: string; count: string }[],
      id: string,
      statuses: string[],
    ) =>
      list
        .filter((r) => r.officerUserId === id && statuses.includes(r.status))
        .reduce((n, r) => n + Number(r.count), 0);

    return rows.map((u) => {
      const mine = sessions.filter((s) => s.userId === u.id);
      const lastActiveAt = mine.reduce<Date | null>((latest, s) => {
        const at = s.lastUsedAt ?? s.createdAt;
        return !latest || at > latest ? at : latest;
      }, null);
      const online = mine.some(
        (s) =>
          s.lastUsedAt &&
          new Date(s.expiresAt).getTime() > now &&
          now - new Date(s.lastUsedAt).getTime() < ONLINE_WINDOW_MS,
      );

      const verifications = {
        pending: tally(verifRows, u.id, V_PENDING),
        inProgress: tally(verifRows, u.id, V_PROGRESS),
        completed: tally(verifRows, u.id, V_DONE),
      };
      const supportCases = {
        pending: tally(caseRows, u.id, C_PENDING),
        inProgress: tally(caseRows, u.id, C_PROGRESS),
        completed: tally(caseRows, u.id, C_DONE),
      };

      return {
        id: u.id,
        email: u.email,
        name: profileFor.get(u.id)?.displayName ?? null,
        city: profileFor.get(u.id)?.city ?? null,
        isActive: u.isActive,
        // Real leave state from EZ1-I210: an officer with no row has never set
        // availability and is treated as available.
        availability: availabilityView(availabilityFor.get(u.id)).status,
        online,
        lastActiveAt,
        serviceAreas: areas
          .filter((a) => a.officerUserId === u.id)
          .map((a) => ({ label: a.label, primary: a.primary })),
        verifications,
        cases: supportCases,
        /** Visits closed out on the ground — the completed half of the queue. */
        visitsCompleted: verifications.completed,
        joinedAt: u.createdAt,
      };
    });
  }
}

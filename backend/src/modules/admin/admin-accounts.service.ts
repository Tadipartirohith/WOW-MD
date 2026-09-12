import { Injectable, NotFoundException } from '@nestjs/common';
import { Interest } from '../matchmaking/entities/interest.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Payment } from '../bookings/entities/payment.entity';
import { Profile } from '../users/entities/profile.entity';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { OfficerServiceArea } from '../verification/entities/officer-service-area.entity';
import { SupportCase } from '../verification/entities/support-case.entity';
import { VerificationRequest } from '../verification/entities/verification-request.entity';
import { AgentCharge } from '../agents/entities/agent-charge.entity';
import { DirectoryQueryDto } from './dto/console.dto';
import { InterestStatus, MatchFixedState, PaymentStatus, UserRole } from '../../common/enums';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import { AdminBookingsService } from './admin-bookings.service';

/**
 * The admin directory, and one account or profile in full.
 *
 * Split out of AdminConsoleService, which had grown past 1,600 lines; the
 * methods moved unchanged.
 */
@Injectable()
export class AdminAccountsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(ProfileDetails) private readonly profileDetails: Repository<ProfileDetails>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    @InjectRepository(OfficerServiceArea)
    private readonly serviceAreas: Repository<OfficerServiceArea>,
    @InjectRepository(SupportCase) private readonly cases: Repository<SupportCase>,
    @InjectRepository(VerificationRequest)
    private readonly verifications: Repository<VerificationRequest>,
    @InjectRepository(AgentCharge) private readonly charges: Repository<AgentCharge>,
    // Read-only, for the matchmaking half of an individual's history.
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
    private readonly adminBookings: AdminBookingsService,
  ) {}

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
      this.cases.find({
        where: { raisedByUserId: userId },
        order: { createdAt: 'DESC' },
        take: 20,
      }),
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
      ? await this.adminBookings.attachParties(
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
          ? this.serviceAreas.find({
              where: { officerUserId: userId },
              order: { createdAt: 'ASC' },
            })
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
              open: officerLoad.filter((v) => !['approved', 'rejected'].includes(String(v.status)))
                .length,
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
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Profile } from '../users/entities/profile.entity';
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
import { DirectoryQueryDto } from './dto/console.dto';
import { CaseStatus, UserRole, VerificationStatus } from '../../common/enums';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import { AdminBookingsService } from './admin-bookings.service';

/**
 * Businesses and staff on the admin console.
 *
 * The activity feed, the account directory, bookings and payments, and the
 * reports each moved to their own service when this file passed 1,600 lines.
 */
@Injectable()
export class AdminConsoleService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
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
    // Read-only, for an officer's leave state (EZ1-I210) on the roster.
    @InjectRepository(OfficerAvailability)
    private readonly availability: Repository<OfficerAvailability>,
    private readonly adminBookings: AdminBookingsService,
  ) {}

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

    const bookings = await this.adminBookings.attachParties(receivedRaw);

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

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { VerificationRequest } from './entities/verification-request.entity';
import { OfficerServiceArea } from './entities/officer-service-area.entity';
import { canonicalCity, normalisePlace, stateOf } from './service-area';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../auth/entities/user.entity';
import { AgentProfile } from '../agents/entities/agent-profile.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import {
  AllocateRequestDto,
  DecideVerificationDto,
  SubmitFindingsDto,
  VerificationQueryDto,
} from './dto/verification.dto';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { MailService } from '../../platform/mail/mail.service';
import { AppConfigService } from '../../config/app-config.service';
import { BusinessLifecycleService } from '../vendors/business-lifecycle.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { Permission, roleHasPermission } from '../../common/authz/permissions';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import {
  ApplicantType,
  NotificationType,
  UserRole,
  VerificationStatus,
} from '../../common/enums';

/** Outcomes that leave the applicant unable to operate. */
const BLOCKING = [
  VerificationStatus.REJECTED,
  VerificationStatus.ISSUE,
  VerificationStatus.ADDITIONAL_REVIEW,
];

/**
 * Field verification for Agents and Vendors.
 *
 * Registration alone never grants operational access. It creates a restricted
 * account and raises a request here; an administrator allocates it, a
 * verification officer visits and decides, and only an APPROVED decision flips
 * the applicant's record to active.
 *
 * The officer is the only one who can decide, and only on requests allocated to
 * them — otherwise "allocation" would be advisory rather than a control.
 */
@Injectable()
export class VerificationService {
  constructor(
    @InjectRepository(VerificationRequest)
    private readonly requests: Repository<VerificationRequest>,
    @InjectRepository(OfficerServiceArea)
    private readonly areas: Repository<OfficerServiceArea>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AgentProfile) private readonly agencies: Repository<AgentProfile>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly cfg: AppConfigService,
    @Inject(forwardRef(() => BusinessLifecycleService))
    private readonly lifecycle: BusinessLifecycleService,
  ) {}

  /**
   * Raised automatically when an agent or vendor puts their details forward.
   * Idempotent: re-submitting details while a request is open reuses it rather
   * than flooding the queue.
   */
  async raise(
    applicantType: ApplicantType,
    applicantUserId: string,
    subjectId: string | null,
  ): Promise<VerificationRequest> {
    // Idempotent per *business*, not per applicant.
    //
    // It used to be per applicant, and re-pointed the open request at whatever
    // subject came in last. One vendor account with two businesses therefore
    // ended up with a single request pointing at the second — the first could
    // not be verified, was in nobody's queue, and nothing said so. If it had
    // already been allocated, that officer's visit silently became a visit to a
    // different business.
    //
    // That was defensible while one account meant one business. It is not now.
    const openStatuses = [
      VerificationStatus.NEW,
      VerificationStatus.ASSIGNED,
      VerificationStatus.IN_PROGRESS,
      VerificationStatus.SUBMITTED,
      VerificationStatus.ADMIN_REVIEW,
      VerificationStatus.ADDITIONAL_REVIEW,
      VerificationStatus.ISSUE,
    ];

    const open = await this.requests.findOne({
      where: openStatuses.map((status) =>
        // A null subject is the applicant themselves — an agency, which has
        // exactly one. Matching on null there keeps that path idempotent.
        subjectId
          ? { applicantUserId, subjectId, status }
          : { applicantUserId, subjectId: IsNull(), status },
      ),
    });
    if (open) return open;

    const request = await this.requests.save(
      this.requests.create({
        applicantType,
        applicantUserId,
        subjectId,
        status: VerificationStatus.NEW,
        history: [],
      }),
    );
    await this.audit.record({
      action: AuditAction.VERIFICATION_REQUESTED,
      actor: { userId: applicantUserId, role: applicantType as unknown as UserRole },
      resourceType: 'verification_request',
      resourceId: request.id,
      metadata: { applicantType },
    });

    /*
     * Tell the administrators something is waiting.
     *
     * Until now this wrote a row and an audit entry and told nobody, so the
     * only way anyone learned a business had applied was by opening the queue
     * on the off-chance. That is fine on the day somebody is watching it and
     * indistinguishable from the platform being broken on every other day —
     * an applicant sits unallocated and concludes their submission never
     * arrived.
     *
     * Not awaited: an applicant's submission must not fail because a
     * notification could not be written. The request is saved either way, and
     * the queue remains the record — this only means nobody has to guess when
     * to look at it.
     */
    void this.notifications
      .createForRole(UserRole.ADMIN, NotificationType.VERIFICATION_REQUESTED, {
        requestId: request.id,
        applicantType,
        awaitingAllocation: true,
      })
      .catch(() => undefined);

    return request;
  }

  // ------------------------------------------------------------ admin side

  async allocate(
    actor: AuthUser,
    requestId: string,
    dto: AllocateRequestDto,
  ): Promise<VerificationRequest> {
    const request = await this.loadOrFail(requestId);
    if (request.status === VerificationStatus.APPROVED) {
      throw new BadRequestException('That request has already been approved');
    }

    // Named officer, or the best automatic pick. Allocation is the
    // administrator's decision either way; this only saves them the arithmetic.
    //
    // The automatic pick now considers where the applicant actually is, and
    // records what it went on — an allocation made on workload alone because
    // nobody covers that city is a staffing gap somebody should see.
    const city = await this.applicantCity(request);
    const suggestion = dto.officerUserId
      ? null
      : await this.suggestOfficerWithReason(city);
    const officerUserId = dto.officerUserId ?? suggestion?.officerUserId ?? null;
    if (!officerUserId) {
      throw new BadRequestException(
        'There are no active verification officers to allocate this to',
      );
    }

    const officer = await this.users.findOne({ where: { id: officerUserId } });
    if (!officer || !officer.isActive) throw new NotFoundException('Verification officer not found');
    if (officer.role !== UserRole.IN_PERSON && officer.role !== UserRole.AGENT) {
      throw new BadRequestException('That account cannot carry out verification');
    }
    if (officer.role === UserRole.AGENT) await this.refuseIfConflicted(officer, request);

    request.assignedToUserId = officer.id;
    request.allocatedByUserId = actor.userId;
    request.allocatedAt = new Date();
    // Re-allocating a request that was parked on an issue reopens it.
    request.status = VerificationStatus.ASSIGNED;
    request.history = [
      ...request.history,
      {
        at: new Date().toISOString(),
        byUserId: actor.userId,
        status: VerificationStatus.ASSIGNED,
        remarks: dto.note,
      },
    ];
    request.allocationBasis = dto.officerUserId ? 'named' : (suggestion?.basis ?? 'workload_only');
    request.applicantCity = city;
    const saved = await this.requests.save(request);

    await this.audit.record({
      action: AuditAction.VERIFICATION_ALLOCATED,
      actor,
      resourceType: 'verification_request',
      resourceId: request.id,
      metadata: { officerUserId: officer.id },
    });

    // Told *after* the allocation is stored, never before. A notification for
    // work that then failed to save sends an officer looking for a visit that
    // is not on their queue, which is worse than no notification at all.
    await this.notifications.create(officer.id, NotificationType.VERIFICATION_ASSIGNED, {
      requestId: saved.id,
      applicantType: saved.applicantType,
      subjectId: saved.subjectId,
      allocatedByUserId: actor.userId,
      note: dto.note ?? null,
    });

    return saved;
  }

  // ----------------------------------------------------------- officer side

  /**
   * Records the decision and, on approval, activates the applicant.
   *
   * Activation happens here rather than in a separate admin step so there is
   * exactly one place where "verified" becomes true, and it always carries the
   * request that justified it.
   */
  async decide(
    actor: AuthUser,
    requestId: string,
    dto: DecideVerificationDto,
  ): Promise<VerificationRequest> {
    const request = await this.loadOrFail(requestId);

    if (actor.role !== UserRole.ADMIN && request.assignedToUserId !== actor.userId) {
      throw new ForbiddenException('That request is not allocated to you');
    }
    if (request.status === VerificationStatus.APPROVED) {
      throw new BadRequestException('That request has already been approved');
    }
    if (dto.status !== VerificationStatus.APPROVED && !dto.remarks) {
      throw new BadRequestException('Record the reason for anything other than an approval');
    }

    // An approval has to rest on a visit somebody actually made and wrote up.
    // Without this an officer could approve a business straight from ASSIGNED,
    // which makes the whole verification step a checkbox.
    if (dto.status === VerificationStatus.APPROVED && !request.findings) {
      throw new BadRequestException(
        'Nobody has submitted findings for this request yet. It cannot be approved.',
      );
    }
    if (
      dto.status === VerificationStatus.ADDITIONAL_REVIEW &&
      request.status === VerificationStatus.NEW
    ) {
      throw new BadRequestException('Allocate this request before sending it back for a revisit');
    }

    // Asked before anything is written. This used to save the decision and then
    // try to move the business; when the move was refused the request was
    // already marked decided and the business was not — the queue saying done
    // while the vendor is still waiting.
    if (request.applicantType === ApplicantType.VENDOR && request.subjectId) {
      const outcome =
        dto.status === VerificationStatus.APPROVED
          ? 'approve'
          : dto.status === VerificationStatus.ADDITIONAL_REVIEW
            ? 'revisit'
            : 'reject';
      const check = await this.lifecycle.canDecide(request.subjectId, outcome);
      if (!check.ok) throw new BadRequestException(check.reason ?? 'That decision cannot be made yet');
    }

    request.status = dto.status;
    request.remarks = dto.remarks ?? null;
    request.decidedAt = new Date();
    request.decidedByUserId = actor.userId;
    request.reviewedByUserId = actor.userId;
    if (dto.status === VerificationStatus.ADDITIONAL_REVIEW) {
      // Sending it back is a real workflow step, not a dead end: the request
      // returns to the officer's queue and the count says how many times.
      request.revisitCount += 1;
      request.assignedToUserId = request.assignedToUserId ?? null;
      request.findings = null;
    }
    request.history = [
      ...request.history,
      {
        at: new Date().toISOString(),
        byUserId: actor.userId,
        status: dto.status,
        remarks: dto.remarks,
      },
    ];
    const saved = await this.requests.save(request);

    if (dto.status === VerificationStatus.APPROVED) {
      await this.activateApplicant(request);
    } else if (BLOCKING.includes(dto.status)) {
      await this.deactivateApplicant(request);
    }

    await this.audit.record({
      action:
        dto.status === VerificationStatus.APPROVED
          ? AuditAction.VERIFICATION_APPROVED
          : AuditAction.VERIFICATION_REJECTED,
      actor,
      resourceType: 'verification_request',
      resourceId: request.id,
      metadata: { status: dto.status, applicantType: request.applicantType },
    });

    await this.notifyApplicant(request);
    return saved;
  }

  /**
   * The officer writes up what they found.
   *
   * This is the step the old chain was missing. An officer reports; an
   * administrator decides. Keeping those apart is the whole point of having a
   * verification step rather than a checkbox, and it is what makes an approval
   * something you can audit six months later.
   */
  async submitFindings(
    actor: AuthUser,
    requestId: string,
    dto: SubmitFindingsDto,
  ): Promise<VerificationRequest> {
    const request = await this.loadOrFail(requestId);

    if (actor.role !== UserRole.ADMIN && request.assignedToUserId !== actor.userId) {
      throw new ForbiddenException('That request is not allocated to you');
    }
    if (
      request.status !== VerificationStatus.ASSIGNED &&
      request.status !== VerificationStatus.IN_PROGRESS &&
      request.status !== VerificationStatus.ADDITIONAL_REVIEW
    ) {
      throw new BadRequestException(
        `Findings can only be submitted on a request you are working on — this one is ${request.status}`,
      );
    }
    // A recommendation to reject or revisit has to say what went wrong, or the
    // administrator reviewing it has nothing to act on.
    if (dto.recommendation !== 'approve' && dto.issues.length === 0) {
      throw new BadRequestException('List what did not check out');
    }

    request.findings = {
      visited: dto.visited,
      observations: dto.observations,
      issues: dto.issues,
      evidence: dto.evidence ?? [],
      recommendation: dto.recommendation,
    };
    request.status = VerificationStatus.SUBMITTED;
    request.submittedAt = new Date();
    request.submittedByUserId = actor.userId;
    request.history = [
      ...request.history,
      {
        at: new Date().toISOString(),
        byUserId: actor.userId,
        status: VerificationStatus.SUBMITTED,
        remarks: dto.observations.slice(0, 500),
      },
    ];
    const saved = await this.requests.save(request);

    // Whoever allocated it is the person waiting on the answer.
    if (request.allocatedByUserId) {
      await this.notifications.create(
        request.allocatedByUserId,
        NotificationType.VERIFICATION_SUBMITTED,
        {
          requestId: saved.id,
          applicantType: saved.applicantType,
          recommendation: dto.recommendation,
          issues: dto.issues.length,
        },
      );
    }
    return saved;
  }

  /**
   * An administrator picks the findings up.
   *
   * Purely a signal, like `start` on the officer side, but it is the one that
   * stops two administrators reviewing the same report and reaching different
   * conclusions ten seconds apart.
   */
  async beginReview(actor: AuthUser, requestId: string): Promise<VerificationRequest> {
    const request = await this.loadOrFail(requestId);
    if (request.status !== VerificationStatus.SUBMITTED) {
      throw new BadRequestException('There are no findings waiting on this request');
    }

    request.status = VerificationStatus.ADMIN_REVIEW;
    request.reviewStartedAt = new Date();
    request.reviewedByUserId = actor.userId;
    request.history = [
      ...request.history,
      {
        at: new Date().toISOString(),
        byUserId: actor.userId,
        status: VerificationStatus.ADMIN_REVIEW,
      },
    ];
    return this.requests.save(request);
  }

  /** Officer picks up an allocated request. Purely a workload signal. */
  async start(actor: AuthUser, requestId: string): Promise<VerificationRequest> {
    const request = await this.loadOrFail(requestId);
    if (request.assignedToUserId !== actor.userId && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('That request is not allocated to you');
    }
    if (
      request.status !== VerificationStatus.ASSIGNED &&
      request.status !== VerificationStatus.ADDITIONAL_REVIEW
    ) {
      return request;
    }

    request.status = VerificationStatus.IN_PROGRESS;
    request.verificationStartedAt = request.verificationStartedAt ?? new Date();
    // The business follows the request, so the vendor sees the same thing the
    // officer does rather than a status that stopped at "submitted".
    if (request.subjectId && request.applicantType === ApplicantType.VENDOR) {
      await this.lifecycle.markInProgress(request.subjectId);
    }
    request.history = [
      ...request.history,
      {
        at: new Date().toISOString(),
        byUserId: actor.userId,
        status: VerificationStatus.IN_PROGRESS,
      },
    ];
    return this.requests.save(request);
  }

  private async activateApplicant(request: VerificationRequest): Promise<void> {
    if (request.applicantType === ApplicantType.AGENT) {
      const agency = await this.agencies.findOne({
        where: { ownerUserId: request.applicantUserId },
      });
      if (agency) {
        agency.isApproved = true;
        agency.approvedAt = new Date();
        agency.approvedByUserId = request.decidedByUserId;
        agency.rejectionReason = null;
        await this.agencies.save(agency);
      }
    } else if (request.applicantType === ApplicantType.PLANNER) {
      // A planner listing has no draft/submit lifecycle of its own; approval is
      // the single flag that puts it in the directory.
      if (request.subjectId) {
        await this.planners.update(request.subjectId, { isApproved: true });
      }
    } else if (request.subjectId) {
      // Exactly the business that was verified, and no other.
      //
      // This used to approve every listing the vendor owned, on the reasoning
      // that "the verification is of the business, not of an individual
      // listing". That was true while one account meant one business. It is now
      // the same bug as the one in `raise()` wearing different clothes:
      // verifying a caterer would quietly put their photography listing live,
      // which nobody has been to see.
      await this.lifecycle.approve(request.subjectId, undefined);
    }
    // The *account* is verified either way: the person has been met.
    await this.users.update(request.applicantUserId, { isVerified: true });
  }

  private async deactivateApplicant(request: VerificationRequest): Promise<void> {
    if (request.applicantType === ApplicantType.AGENT) {
      const agency = await this.agencies.findOne({
        where: { ownerUserId: request.applicantUserId },
      });
      if (agency) {
        agency.isApproved = false;
        agency.rejectionReason = request.remarks ?? null;
        await this.agencies.save(agency);
      }
      return;
    }

    if (request.applicantType === ApplicantType.PLANNER) {
      if (request.subjectId) {
        await this.planners.update(request.subjectId, { isApproved: false });
      }
      return;
    }

    if (!request.subjectId) return;

    // Which of the two outcomes this is matters more than it looks. Sending a
    // listing back says "fix this and come back" and returns edit access;
    // rejecting says "no" and is terminal. Collapsing them leaves a vendor
    // either stuck with no route forward or able to edit around a refusal.
    const reason = request.remarks ?? 'Verification could not be completed.';
    if (request.status === VerificationStatus.REJECTED) {
      await this.lifecycle.reject(request.subjectId, reason, undefined);
    } else {
      await this.lifecycle.requireReverification(request.subjectId, reason, undefined);
    }
  }


  private async notifyApplicant(request: VerificationRequest): Promise<void> {
    const applicant = await this.users.findOne({ where: { id: request.applicantUserId } });
    if (!applicant) return;
    await this.mail.sendVerificationOutcome({
      to: applicant.email,
      applicantType: request.applicantType,
      status: request.status,
      remarks: request.remarks,
    });
  }

  // --------------------------------------------------------------- queries

  async list(
    actor: AuthUser,
    q: VerificationQueryDto,
  ): Promise<PaginatedResult<VerificationRequest>> {
    const qb = this.requests.createQueryBuilder('r');

    /*
     * You see the whole queue only if you are the one who hands it out.
     *
     * This used to read `role === IN_PERSON`, which was right while officers
     * were the only people doing fieldwork. Agents now hold
     * VERIFICATION_FIELDWORK too, and a role test put them in the other branch
     * — so an agent could read every open application on the platform,
     * including their competitors' and their own clients'. That is a
     * commercial participant reading the regulator's inbox.
     *
     * Keyed on VERIFICATION_ALLOCATE rather than on a list of roles, because
     * the rule being expressed is "if you cannot allocate work, you only see
     * what was allocated to you" — which stays true for whatever role is added
     * next, and would not have needed changing here in the first place.
     */
    const allocatesWork = roleHasPermission(actor.role, Permission.VERIFICATION_ALLOCATE);
    if (allocatesWork) {
      qb.where('1 = 1');
    } else {
      qb.where('r."assignedToUserId" = :me', { me: actor.userId });
    }
    if (q.status) qb.andWhere('r.status = :status', { status: q.status });
    if (q.applicantType) qb.andWhere('r."applicantType" = :t', { t: q.applicantType });
    if (q.officerUserId) qb.andWhere('r."assignedToUserId" = :o', { o: q.officerUserId });

    qb.orderBy('r."createdAt"', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();
    return paginate(await this.withIdentity(data), total, q.page, q.limit);
  }

  /**
   * Puts a name on each row.
   *
   * Without this the queue is a column of identical cards — "planner
   * verification", "planner verification", "planner verification" — and the
   * only way to tell them apart is to open each one. Which planner it is
   * decides whether an administrator has already dealt with this applicant
   * this week, and it is the first thing they look for.
   */
  private async withIdentity(rows: VerificationRequest[]): Promise<VerificationRequest[]> {
    if (rows.length === 0) return rows;
    const userIds = [...new Set(rows.map((r) => r.applicantUserId))];

    const [users, agencies, planners, vendors] = await Promise.all([
      this.users.find({ where: { id: In(userIds) }, select: ['id', 'email', 'phone'] }),
      this.agencies.find({ where: { ownerUserId: In(userIds) } }),
      this.planners.find({ where: { ownerUserId: In(userIds) } }),
      this.vendors.find({ where: { ownerUserId: In(userIds) } }),
    ]);

    const byUser = new Map(users.map((u) => [u.id, u]));
    const agencyBy = new Map(agencies.map((a) => [a.ownerUserId, a.agencyName]));
    const plannerBy = new Map(planners.map((a) => [a.ownerUserId, a.agencyName]));
    const vendorBy = new Map(vendors.map((v) => [v.ownerUserId, v.name]));

    for (const row of rows) {
      const user = byUser.get(row.applicantUserId);
      row.applicantEmail = user?.email ?? null;
      row.applicantPhone = user?.phone ?? null;
      row.subjectName =
        (row.applicantType === ApplicantType.AGENT
          ? agencyBy.get(row.applicantUserId)
          : row.applicantType === ApplicantType.PLANNER
            ? plannerBy.get(row.applicantUserId)
            : vendorBy.get(row.applicantUserId)) ?? null;
    }
    return rows;
  }

  /**
   * The request, plus the record it is about.
   *
   * An officer sent to verify a business needs the business: its name, trade,
   * registration numbers and the address they are going to stand outside. A
   * queue row alone tells them nothing they can check.
   */
  async findOne(
    actor: AuthUser,
    id: string,
  ): Promise<VerificationRequest & { applicant: unknown; subject: unknown }> {
    const request = await this.loadOrFail(id);
    // The same rule the queue uses, and for the same reason: a role test let an
    // agent open any request by id even once the list stopped offering them.
    // Filtering a list without guarding the record it links to is not a
    // restriction, it is a longer path to the same data.
    if (
      !roleHasPermission(actor.role, Permission.VERIFICATION_ALLOCATE) &&
      request.assignedToUserId !== actor.userId
    ) {
      throw new ForbiddenException('That request is not allocated to you');
    }

    const applicant = await this.users.findOne({
      where: { id: request.applicantUserId },
      select: ['id', 'email', 'phone', 'role', 'isActive', 'createdAt'],
    });

    /*
     * The record being verified, resolved by what kind of applicant this is.
     *
     * It used to be "agency if AGENT, otherwise vendors" — so a planner's
     * subject was looked for in the vendors table, found nothing, and came
     * back null. The officer opened "Show the business details" and got a
     * panel of dashes; the administrator got a queue of planner cards that
     * were identical because none of them had a name to show. Two reports, one
     * missing branch. The planners repository was already injected here.
     */
    const subject = await this.subjectFor(request);

    return { ...request, applicant: applicant ?? null, subject: subject ?? null };
  }

  /**
   * The business, agency or planning practice a request is about.
   *
   * `subjectId` is preferred wherever it is set, because one account may hold
   * two businesses and the request names which of them is being verified;
   * falling back to the owner is for the older rows that predate that column.
   */
  /**
   * Stops an agent being sent to inspect something they have a stake in.
   *
   * An agent earns fees from the accounts they introduce, so verifying one of
   * their own is marking their own homework; and an agency inspecting another
   * agency is a competitor deciding whether a rival gets to trade. Neither is
   * a judgement call an administrator should have to remember to make at the
   * moment they are clearing a queue, so it is refused here.
   *
   * An officer is subject to none of this, which is the difference between
   * staff and a participant and the reason both appear in the roster labelled.
   */
  private async refuseIfConflicted(agent: User, request: VerificationRequest): Promise<void> {
    if (request.applicantType === ApplicantType.AGENT) {
      throw new BadRequestException(
        'An agency cannot verify another agency. Allocate this one to an officer.',
      );
    }

    const applicant = await this.users.findOne({
      where: { id: request.applicantUserId },
      select: ['id', 'managedByAgentId'],
    });
    if (applicant?.managedByAgentId === agent.id) {
      throw new BadRequestException(
        'That agent introduced this applicant, so cannot verify them. Allocate to somebody else.',
      );
    }
  }

  private async subjectFor(request: VerificationRequest): Promise<object | null> {
    const byOwner = { ownerUserId: request.applicantUserId };
    switch (request.applicantType) {
      case ApplicantType.AGENT:
        return (await this.agencies.findOne({ where: byOwner })) ?? null;
      case ApplicantType.PLANNER:
        return (await this.planners.findOne({ where: byOwner })) ?? null;
      default:
        return (
          (await this.vendors.findOne({
            where: request.subjectId ? { id: request.subjectId } : byOwner,
          })) ?? null
        );
    }
  }

  /** The applicant's own view: status and reason, nothing about the officer. */
  async myStatus(userId: string): Promise<{
    id: string | null;
    applicantType: ApplicantType | null;
    status: VerificationStatus | null;
    remarks: string | null;
    submittedAt: Date | null;
    decidedAt: Date | null;
  }> {
    const request = await this.requests.findOne({
      where: { applicantUserId: userId },
      order: { createdAt: 'DESC' },
    });
    return {
      id: request?.id ?? null,
      applicantType: request?.applicantType ?? null,
      status: request?.status ?? null,
      remarks: request?.remarks ?? null,
      submittedAt: request?.createdAt ?? null,
      decidedAt: request?.decidedAt ?? null,
    };
  }

  /** Workload and outcome counters for the admin and officer dashboards. */
  async metrics(officerUserId?: string): Promise<Record<string, number>> {
    const qb = this.requests.createQueryBuilder('r').select('r.status', 'status').addSelect('COUNT(r.id)', 'count');
    if (officerUserId) qb.where('r."assignedToUserId" = :o', { o: officerUserId });
    qb.groupBy('r.status');

    const rows = await qb.getRawMany<{ status: string; count: string }>();
    const out: Record<string, number> = {
      new: 0,
      assigned: 0,
      in_progress: 0,
      approved: 0,
      rejected: 0,
      issue: 0,
      additional_review: 0,
    };
    for (const r of rows) out[r.status] = Number(r.count);
    out.total = Object.values(out).reduce((a, b) => a + b, 0);
    return out;
  }

  /** Per-officer workload, for allocation decisions. */
  /**
   * Every active officer with what they are carrying, lightest first.
   *
   * Officers with nothing on are included — they are precisely the ones an
   * allocation should go to, and a query that only counts existing work would
   * leave them invisible.
   */
  async workload(): Promise<
    {
      officerUserId: string;
      open: number;
      inProgress: number;
      completed: number;
      total: number;
    }[]
  > {
    const officers = await this.users.find({
      where: { role: UserRole.IN_PERSON, isActive: true },
      select: ['id'],
    });
    if (officers.length === 0) return [];

    const rows = await this.requests
      .createQueryBuilder('r')
      .select('r."assignedToUserId"', 'officerUserId')
      .addSelect('r.status', 'status')
      .addSelect('COUNT(r.id)', 'count')
      .where('r."assignedToUserId" IS NOT NULL')
      .groupBy('r."assignedToUserId"')
      .addGroupBy('r.status')
      .getRawMany<{ officerUserId: string; status: VerificationStatus; count: string }>();

    const OPEN = [
      VerificationStatus.ASSIGNED,
      VerificationStatus.ADDITIONAL_REVIEW,
      VerificationStatus.ISSUE,
    ];

    const summary = officers.map((officer) => {
      const mine = rows.filter((r) => r.officerUserId === officer.id);
      const count = (statuses: VerificationStatus[]) =>
        mine
          .filter((r) => statuses.includes(r.status))
          .reduce((total, r) => total + Number(r.count), 0);

      const open = count(OPEN);
      const inProgress = count([VerificationStatus.IN_PROGRESS]);
      return {
        officerUserId: officer.id,
        open,
        inProgress,
        // Written up and waiting on an administrator. Reported, but deliberately
        // not counted below: the officer's part is finished, and holding it
        // against them would starve the busiest officer of new work while an
        // administrator sat on a backlog.
        submitted: count([VerificationStatus.SUBMITTED, VerificationStatus.ADMIN_REVIEW]),
        completed: count([VerificationStatus.APPROVED, VerificationStatus.REJECTED]),
        // What allocation actually ranks on: work still on their plate.
        total: open + inProgress,
      };
    });

    return summary.sort((a, b) => a.total - b.total);
  }

  /**
   * Who the next request should go to.
   *
   * Workload alone sends the lightest-loaded officer four hundred kilometres to
   * look at a catering kitchen. Geography alone sends every visit in a city to
   * whoever happens to cover it, however buried they already are. So coverage
   * decides the *pool* and workload decides within it:
   *
   * 1. Officers whose primary areas cover the applicant's city.
   * 2. Failing that, officers who cover it as a secondary area.
   * 3. Failing that, officers covering the whole state.
   * 4. Failing that, everyone — and `basis` says so, because an administrator
   *    who can see that nobody covers Warangal can go and fix that, whereas a
   *    silent fallback just looks like a bad allocation.
   *
   * Returning the basis rather than only the id is the part that matters: this
   * was deferred precisely because a geography guess that fails quietly is
   * worse than no geography at all.
   */
  async suggestOfficer(applicantCity?: string | null): Promise<string | null> {
    const { officerUserId } = await this.suggestOfficerWithReason(applicantCity);
    return officerUserId;
  }

  async suggestOfficerWithReason(applicantCity?: string | null): Promise<{
    officerUserId: string | null;
    basis: 'primary_area' | 'secondary_area' | 'state' | 'workload_only';
    city: string | null;
  }> {
    const ranked = await this.workload();
    if (ranked.length === 0) return { officerUserId: null, basis: 'workload_only', city: null };

    const city = canonicalCity(applicantCity);
    if (!city) {
      return { officerUserId: ranked[0].officerUserId, basis: 'workload_only', city: null };
    }

    const covering = await this.officersCovering(applicantCity);

    // `ranked` is already sorted lightest-first, so the first match in each
    // tier is both covered and least loaded.
    for (const [tier, ids] of [
      ['primary_area', covering.primary],
      ['secondary_area', covering.secondary],
      ['state', covering.state],
    ] as const) {
      const pick = ranked.find((r) => ids.has(r.officerUserId));
      if (pick) return { officerUserId: pick.officerUserId, basis: tier, city };
    }

    return { officerUserId: ranked[0].officerUserId, basis: 'workload_only', city };
  }

  /** Which officers cover a place, split by how directly they cover it. */
  private async officersCovering(place: string | null | undefined): Promise<{
    primary: Set<string>;
    secondary: Set<string>;
    state: Set<string>;
  }> {
    const city = canonicalCity(place);
    const state = stateOf(place);
    const out = { primary: new Set<string>(), secondary: new Set<string>(), state: new Set<string>() };
    if (!city) return out;

    const rows = await this.areas.find();
    for (const area of rows) {
      // A city row is matched through the same canonicaliser both sides went
      // through, so a rename or a trailing state does not read as a miss.
      if (area.city && canonicalCity(area.city) === city) {
        (area.primary ? out.primary : out.secondary).add(area.officerUserId);
        continue;
      }
      if (area.state && state && normalisePlace(area.state) === state) {
        out.state.add(area.officerUserId);
      }
    }

    // An officer who covers the city directly should not also be offered as a
    // state-level fallback for the same request.
    for (const id of [...out.primary, ...out.secondary]) out.state.delete(id);
    for (const id of out.primary) out.secondary.delete(id);
    return out;
  }

  // ------------------------------------------------------------ service areas

  async listAreas(officerUserId: string): Promise<OfficerServiceArea[]> {
    return this.areas.find({
      where: { officerUserId },
      order: { primary: 'DESC', label: 'ASC' },
    });
  }

  async addArea(
    actor: AuthUser,
    officerUserId: string,
    dto: { city?: string; state?: string; primary?: boolean },
  ): Promise<OfficerServiceArea> {
    const officer = await this.users.findOne({ where: { id: officerUserId } });
    if (!officer || officer.role !== UserRole.IN_PERSON) {
      throw new NotFoundException('Verification officer not found');
    }
    if (!dto.city && !dto.state) {
      throw new BadRequestException('Give a city, or a state for somebody who covers a whole one');
    }

    const label = dto.city?.trim() || dto.state?.trim() || '';
    const row = this.areas.create({
      officerUserId,
      city: dto.city ? canonicalCity(dto.city) : null,
      state: dto.state ? normalisePlace(dto.state) : null,
      label,
      primary: dto.primary ?? true,
    });

    // The unique index is on the normalised pair, so adding "Bangalore" to an
    // officer who already covers "Bengaluru" is caught rather than duplicated.
    // TypeORM's `where` cannot express "this column IS NULL" through a plain
    // null, so the comparison is done over the officer's own rows instead.
    const existing = await this.areas.find({ where: { officerUserId } });
    const clash = existing.find((a) => a.city === row.city && a.state === row.state);
    if (clash) {
      throw new BadRequestException(`They already cover ${clash.label}`);
    }

    const saved = await this.areas.save(row);
    await this.audit.record({
      action: AuditAction.VERIFICATION_ALLOCATED,
      actor,
      resourceType: 'officer_service_area',
      resourceId: saved.id,
      metadata: { officerUserId, label, primary: saved.primary },
    });
    return saved;
  }

  async removeArea(actor: AuthUser, areaId: string): Promise<{ success: true }> {
    const area = await this.areas.findOne({ where: { id: areaId } });
    if (!area) throw new NotFoundException('That service area does not exist');
    await this.areas.remove(area);
    await this.audit.record({
      action: AuditAction.VERIFICATION_ALLOCATED,
      actor,
      resourceType: 'officer_service_area',
      resourceId: areaId,
      metadata: { removed: true, officerUserId: area.officerUserId },
    });
    return { success: true };
  }

  /** Where the applicant on a request actually is. */
  async applicantCity(request: VerificationRequest): Promise<string | null> {
    if (request.applicantType === ApplicantType.VENDOR && request.subjectId) {
      const vendor = await this.vendors.findOne({ where: { id: request.subjectId } });
      return vendor?.city ?? null;
    }
    if (request.applicantType === ApplicantType.AGENT && request.subjectId) {
      const agency = await this.agencies.findOne({ where: { id: request.subjectId } });
      return agency?.city ?? null;
    }
    return null;
  }

  // ------------------------------------------------------------------ SLA

  /**
   * Starts the 72-hour clock.
   *
   * Called when a business is submitted, not when it is created. The clock is
   * about how long the *platform* takes once it has been asked — a vendor
   * sitting on a draft for a month is not a breach, and starting it any earlier
   * would make every slow vendor look like a slow platform.
   */
  async startSla(requestId: string): Promise<VerificationRequest | null> {
    const request = await this.requests.findOne({ where: { id: requestId } });
    if (!request) return null;
    if (request.slaDeadline) return request;

    const hours = this.cfg.verification.slaHours;
    request.slaDeadline = new Date(Date.now() + hours * 60 * 60 * 1000);
    return this.requests.save(request);
  }

  /**
   * Finds requests the platform has run out of time on.
   *
   * The agreed rule is that a breach expires the verification and the vendor
   * may create a new listing. That is a real decision with a real consequence,
   * so it is recorded as one: the request is closed with a stated reason, the
   * business is told, and the breach timestamp is kept so the same request is
   * never swept twice.
   *
   * Deliberately does *not* touch a request an officer has already submitted
   * findings for. The work was done in time; an administrator being slow to
   * read it is not the vendor's fault to carry.
   */
  async sweepSlaBreaches(): Promise<{ checked: number; breached: number }> {
    const now = new Date();
    const candidates = await this.requests.find({
      where: {
        slaBreachedAt: IsNull(),
        slaDeadline: LessThan(now),
      },
    });

    const OPEN_AND_UNWORKED = [
      VerificationStatus.NEW,
      VerificationStatus.ASSIGNED,
      VerificationStatus.IN_PROGRESS,
      VerificationStatus.ADDITIONAL_REVIEW,
    ];

    let breached = 0;
    for (const request of candidates) {
      if (!OPEN_AND_UNWORKED.includes(request.status)) continue;

      request.slaBreachedAt = now;
      request.status = VerificationStatus.REJECTED;
      request.remarks =
        `Verification was not completed within ${this.cfg.verification.slaHours} hours. ` +
        'The listing has been closed; a new one can be created.';
      request.decidedAt = now;
      request.history = [
        ...request.history,
        {
          at: now.toISOString(),
          byUserId: 'system',
          status: VerificationStatus.REJECTED,
          remarks: 'SLA breach',
        },
      ];
      await this.requests.save(request);
      breached += 1;

      await this.notifications.create(
        request.applicantUserId,
        NotificationType.VERIFICATION_DECIDED,
        {
          requestId: request.id,
          subjectId: request.subjectId,
          status: VerificationStatus.REJECTED,
          reason: 'sla_breach',
          slaHours: this.cfg.verification.slaHours,
        },
      );
    }

    return { checked: candidates.length, breached };
  }

  /** How long is left, for anything that wants to show a clock. */
  slaState(request: VerificationRequest): {
    deadline: Date | null;
    hoursLeft: number | null;
    breached: boolean;
  } {
    if (!request.slaDeadline) return { deadline: null, hoursLeft: null, breached: false };
    const ms = request.slaDeadline.getTime() - Date.now();
    return {
      deadline: request.slaDeadline,
      hoursLeft: Math.round((ms / 3_600_000) * 10) / 10,
      breached: Boolean(request.slaBreachedAt) || ms <= 0,
    };
  }

  private async loadOrFail(id: string): Promise<VerificationRequest> {
    const request = await this.requests.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Verification request not found');
    return request;
  }
}

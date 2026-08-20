import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VerificationRequest } from './entities/verification-request.entity';
import { User } from '../auth/entities/user.entity';
import { AgentProfile } from '../agents/entities/agent-profile.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import {
  AllocateRequestDto,
  DecideVerificationDto,
  VerificationQueryDto,
} from './dto/verification.dto';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { MailService } from '../../platform/mail/mail.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import {
  ApplicantType,
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
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AgentProfile) private readonly agencies: Repository<AgentProfile>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    private readonly audit: AuditService,
    private readonly mail: MailService,
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
    const open = await this.requests.findOne({
      where: [
        { applicantUserId, status: VerificationStatus.NEW },
        { applicantUserId, status: VerificationStatus.ASSIGNED },
        { applicantUserId, status: VerificationStatus.IN_PROGRESS },
        { applicantUserId, status: VerificationStatus.ADDITIONAL_REVIEW },
        { applicantUserId, status: VerificationStatus.ISSUE },
      ],
    });
    if (open) {
      if (subjectId && open.subjectId !== subjectId) {
        open.subjectId = subjectId;
        await this.requests.save(open);
      }
      return open;
    }

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

    const officer = await this.users.findOne({ where: { id: dto.officerUserId } });
    if (!officer || !officer.isActive) throw new NotFoundException('Verification officer not found');
    if (officer.role !== UserRole.IN_PERSON) {
      throw new BadRequestException('That account is not a verification officer');
    }

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
    const saved = await this.requests.save(request);

    await this.audit.record({
      action: AuditAction.VERIFICATION_ALLOCATED,
      actor,
      resourceType: 'verification_request',
      resourceId: request.id,
      metadata: { officerUserId: officer.id },
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

    request.status = dto.status;
    request.remarks = dto.remarks ?? null;
    request.decidedAt = new Date();
    request.decidedByUserId = actor.userId;
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

  /** Officer picks up an allocated request. Purely a workload signal. */
  async start(actor: AuthUser, requestId: string): Promise<VerificationRequest> {
    const request = await this.loadOrFail(requestId);
    if (request.assignedToUserId !== actor.userId && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('That request is not allocated to you');
    }
    if (request.status !== VerificationStatus.ASSIGNED) return request;

    request.status = VerificationStatus.IN_PROGRESS;
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
    } else {
      // Every listing the vendor owns becomes publishable at once: the
      // verification is of the business, not of an individual listing.
      const listings = await this.vendors.find({
        where: { ownerUserId: request.applicantUserId },
      });
      for (const listing of listings) {
        listing.isApproved = true;
        await this.vendors.save(listing);
      }
    }
    await this.users.update(request.applicantUserId, { isVerified: true });
  }

  private async deactivateApplicant(request: VerificationRequest): Promise<void> {
    if (request.applicantType === ApplicantType.AGENT) {
      const agency = await this.agencies.findOne({
        where: { ownerUserId: request.applicantUserId },
      });
      if (agency) {
        agency.isApproved = false;
        agency.rejectionReason = request.remarks;
        await this.agencies.save(agency);
      }
    } else {
      const listings = await this.vendors.find({
        where: { ownerUserId: request.applicantUserId },
      });
      for (const listing of listings) {
        listing.isApproved = false;
        await this.vendors.save(listing);
      }
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

    // An officer sees their own queue; an admin sees everything.
    if (actor.role === UserRole.IN_PERSON) {
      qb.where('r."assignedToUserId" = :me', { me: actor.userId });
    } else {
      qb.where('1 = 1');
    }
    if (q.status) qb.andWhere('r.status = :status', { status: q.status });
    if (q.applicantType) qb.andWhere('r."applicantType" = :t', { t: q.applicantType });
    if (q.officerUserId) qb.andWhere('r."assignedToUserId" = :o', { o: q.officerUserId });

    qb.orderBy('r."createdAt"', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, q.page, q.limit);
  }

  async findOne(actor: AuthUser, id: string): Promise<VerificationRequest> {
    const request = await this.loadOrFail(id);
    if (actor.role === UserRole.IN_PERSON && request.assignedToUserId !== actor.userId) {
      throw new ForbiddenException('That request is not allocated to you');
    }
    return request;
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
  async workload(): Promise<{ officerUserId: string; open: number }[]> {
    const rows = await this.requests
      .createQueryBuilder('r')
      .select('r."assignedToUserId"', 'officerUserId')
      .addSelect('COUNT(r.id)', 'open')
      .where('r."assignedToUserId" IS NOT NULL')
      .andWhere('r.status IN (:...open)', {
        open: [
          VerificationStatus.ASSIGNED,
          VerificationStatus.IN_PROGRESS,
          VerificationStatus.ADDITIONAL_REVIEW,
          VerificationStatus.ISSUE,
        ],
      })
      .groupBy('r."assignedToUserId"')
      .getRawMany<{ officerUserId: string; open: string }>();
    return rows.map((r) => ({ officerUserId: r.officerUserId, open: Number(r.open) }));
  }

  private async loadOrFail(id: string): Promise<VerificationRequest> {
    const request = await this.requests.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Verification request not found');
    return request;
  }
}

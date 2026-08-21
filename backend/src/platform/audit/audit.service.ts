import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditEvent } from './entities/audit-event.entity';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';

/** Stable action names. Grep-able, and safe to build dashboards on. */
export const AuditAction = {
  AUTH_LOGIN_SUCCEEDED: 'auth.login_succeeded',
  AUTH_LOGIN_FAILED: 'auth.login_failed',
  AUTH_ACCOUNT_LOCKED: 'auth.account_locked',
  AUTH_PASSWORD_RESET: 'auth.password_reset',
  AUTH_EMAIL_VERIFIED: 'auth.email_verified',
  AUTH_MFA_ENABLED: 'auth.mfa_enabled',
  AUTH_MFA_DISABLED: 'auth.mfa_disabled',
  AUTH_REFRESH_REUSE_DETECTED: 'auth.refresh_reuse_detected',
  AUTH_SESSION_REVOKED: 'auth.session_revoked',

  PROFILE_CREATED_BY_STEWARD: 'profile.created_by_steward',
  PROFILE_INVITED: 'profile.invited',
  PROFILE_CLAIMED: 'profile.claimed',

  CONSENT_INTAKE_RECORDED: 'consent.intake_recorded',
  CONSENT_CIRCULATION_RECORDED: 'consent.circulation_recorded',
  CONSENT_REVOKED: 'consent.revoked',

  PROFILE_SHARED: 'profile.shared',
  PROFILE_SHARE_REVOKED: 'profile.share_revoked',
  PROFILE_POOLED: 'profile.pooled',
  PROFILE_UNPOOLED: 'profile.unpooled',

  VERIFICATION_REQUESTED: 'verification.requested',
  VERIFICATION_ALLOCATED: 'verification.allocated',
  VERIFICATION_APPROVED: 'verification.approved',
  VERIFICATION_REJECTED: 'verification.rejected',
  OFFICER_CREATED: 'officer.created',

  CASE_RAISED: 'case.raised',
  CASE_ALLOCATED: 'case.allocated',
  CASE_SETTLED: 'case.settled',

  MATCH_FIXED_PROPOSED: 'match.fixed_proposed',
  MATCH_FIXED_CONFIRMED: 'match.fixed_confirmed',
  MATCH_UNMATCHED: 'match.unmatched',
  MATCH_BLOCKED: 'match.blocked',
  MATCH_REPORTED: 'match.reported',
  CUSTOMER_PROVISIONED: 'customer.provisioned',

  AGENT_CHARGE_RAISED: 'agent_charge.raised',
  AGENT_CHARGE_HELD: 'agent_charge.held',
  AGENT_CHARGE_RELEASED: 'agent_charge.released',

  IDENTITY_SUBMITTED: 'identity.submitted',
  IDENTITY_OTP_SENT: 'identity.otp_sent',
  IDENTITY_VERIFIED: 'identity.verified',

  PROFILE_DEACTIVATED: 'profile.deactivated',
  PROFILE_REACTIVATED: 'profile.reactivated',
  PROFILE_ARCHIVED: 'profile.archived',

  AGENT_APPROVED: 'agent.approved',
  AGENT_REJECTED: 'agent.rejected',

  VENDOR_APPROVED: 'vendor.approved',
  PLANNER_APPROVED: 'planner.approved',

  BOOKING_ESCROW_HELD: 'booking.escrow_held',
  BOOKING_ESCROW_RELEASED: 'booking.escrow_released',
  BOOKING_ESCROW_REFUNDED: 'booking.escrow_refunded',
  PAYMENT_WEBHOOK_RECEIVED: 'payment.webhook_received',
  PAYMENT_WEBHOOK_REJECTED: 'payment.webhook_rejected',
  /**
   * The gateway and our record contradict each other. Recorded rather than
   * corrected: money moving on a schedule with nobody in the loop is how a
   * reconciliation job becomes the incident.
   */
  PAYMENT_RECONCILIATION_MISMATCH: 'payment.reconciliation_mismatch',

  PROFILE_CLAIM_REQUESTED: 'profile.claim_requested',
  DATA_EXPORTED: 'data.exported',
  DATA_ERASED: 'data.erased',
  AUTH_MFA_RECOVERY_USED: 'auth.mfa_recovery_used',
  AUTH_MFA_RECOVERY_REGENERATED: 'auth.mfa_recovery_regenerated',

  USER_SUSPENDED: 'user.suspended',
  USER_REINSTATED: 'user.reinstated',
  DISPUTE_RESOLVED: 'dispute.resolved',
} as const;

export type AuditActionName = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditInput {
  action: AuditActionName;
  actor?: Pick<AuthUser, 'userId' | 'role'> | null;
  resourceType?: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Append-only audit trail.
 *
 * `record` never throws: losing an audit row must not fail the action it
 * describes. Pass a transaction manager when the action itself is
 * transactional, so the trail commits or rolls back with it.
 */
/**
 * The events worth an alert rather than a row.
 *
 * Kept deliberately short. An alert list that includes everything interesting
 * is a list nobody reads, and the two that genuinely matter are money moving
 * out of escrow and somebody losing their account.
 */
const ALERTABLE = new Set<string>([
  AuditAction.BOOKING_ESCROW_RELEASED,
  AuditAction.BOOKING_ESCROW_REFUNDED,
  AuditAction.USER_SUSPENDED,
  AuditAction.CASE_SETTLED,
  AuditAction.PAYMENT_RECONCILIATION_MISMATCH,
  AuditAction.AUTH_MFA_RECOVERY_USED,
]);

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditEvent) private readonly events: Repository<AuditEvent>,
  ) {}

  async record(input: AuditInput, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(AuditEvent) : this.events;
    try {
      await repo.save(
        repo.create({
          action: input.action,
          actorUserId: input.actor?.userId ?? null,
          actorRole: input.actor?.role ?? null,
          resourceType: input.resourceType ?? null,
          resourceId: input.resourceId ?? null,
          metadata: input.metadata ?? {},
          ip: input.ip ?? null,
        }),
      );
      this.alert(input);
    } catch (err) {
      this.logger.error(`Failed to write audit event ${input.action}`, err as Error);
    }
  }

  /**
   * Raises the handful of events somebody should hear about immediately.
   *
   * The trail was write-only in practice: everything was recorded, nothing was
   * watched, and the two events actually worth waking somebody for — money
   * leaving escrow, and an account being suspended — sat in a table alongside
   * every routine login.
   *
   * This emits a structured `warn`, which is what a log-based alerting rule
   * keys on. Doing more from inside the request would mean an outbound call on
   * the path of the very action being audited, and a paging provider that is
   * having a bad day should never be able to fail an escrow release.
   */
  private alert(input: AuditInput): void {
    if (!ALERTABLE.has(input.action)) return;

    this.logger.warn(
      JSON.stringify({
        alert: input.action,
        actorUserId: input.actor?.userId ?? null,
        actorRole: input.actor?.role ?? null,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        metadata: input.metadata ?? {},
      }),
    );
  }

  async list(
    page: number,
    limit: number,
    filters: { action?: string; actorUserId?: string; resourceId?: string } = {},
  ): Promise<PaginatedResult<AuditEvent>> {
    const qb = this.events.createQueryBuilder('a');
    if (filters.action) qb.andWhere('a.action = :action', { action: filters.action });
    if (filters.actorUserId) qb.andWhere('a."actorUserId" = :actor', { actor: filters.actorUserId });
    if (filters.resourceId) qb.andWhere('a."resourceId" = :res', { res: filters.resourceId });

    qb.orderBy('a."createdAt"', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, page, limit);
  }
}

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

  AGENT_APPROVED: 'agent.approved',
  AGENT_REJECTED: 'agent.rejected',

  VENDOR_APPROVED: 'vendor.approved',
  PLANNER_APPROVED: 'planner.approved',

  BOOKING_ESCROW_HELD: 'booking.escrow_held',
  BOOKING_ESCROW_RELEASED: 'booking.escrow_released',
  BOOKING_ESCROW_REFUNDED: 'booking.escrow_refunded',
  PAYMENT_WEBHOOK_RECEIVED: 'payment.webhook_received',
  PAYMENT_WEBHOOK_REJECTED: 'payment.webhook_rejected',

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
    } catch (err) {
      this.logger.error(`Failed to write audit event ${input.action}`, err as Error);
    }
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

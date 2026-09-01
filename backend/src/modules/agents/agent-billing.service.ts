import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AgentCharge } from './entities/agent-charge.entity';
import { Profile } from '../users/entities/profile.entity';
import { AppConfigService } from '../../config/app-config.service';
import { PAYMENT_PROVIDER, PaymentProvider } from '../bookings/payment.provider';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentChargeType, PaymentStatus, UserRole } from '../../common/enums';

/**
 * Agency fees: what a client is charged for the matchmaking work, and when the
 * agency actually gets paid.
 *
 * Two charges exist, and the difference between them is the whole point. The
 * profile fee covers building and running the profile and is due up front. The
 * settlement fee is the success fee, and it is raised only when a match is
 * fixed — the agency is paid for the outcome, not for the effort.
 *
 * Both sit in escrow until the thing they were charged for has happened, which
 * is what stops an agency collecting a success fee on a match that later turns
 * out not to be one.
 */
@Injectable()
export class AgentBillingService {
  constructor(
    @InjectRepository(AgentCharge) private readonly charges: Repository<AgentCharge>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly cfg: AppConfigService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly gateway: PaymentProvider,
  ) {}

  /** Same floor-the-commission rule the booking escrow uses. */
  private split(amount: string): { commission: string; payout: string } {
    const gross = Math.round(parseFloat(amount) * 100);
    const commission = Math.floor((gross * this.cfg.payments.commissionPercent) / 100);
    return {
      commission: (commission / 100).toFixed(2),
      payout: ((gross - commission) / 100).toFixed(2),
    };
  }

  /**
   * Raised when an agency takes on a profile.
   *
   * Idempotent per profile: an agency editing a client's details for the third
   * time is not billing them three times.
   */
  async raiseProfileFee(agentUserId: string, profile: Profile): Promise<AgentCharge | null> {
    const fee = this.cfg.payments.agentProfileFee;
    if (!fee || fee <= 0) return null;

    const existing = await this.charges.findOne({
      where: { profileId: profile.id, type: AgentChargeType.PROFILE_CREATION },
    });
    if (existing) return existing;

    return this.charges.save(
      this.charges.create({
        agentUserId,
        profileId: profile.id,
        payerUserId: profile.userId,
        type: AgentChargeType.PROFILE_CREATION,
        amount: fee.toFixed(2),
        currency: this.cfg.payments.currency,
        status: PaymentStatus.INITIATED,
      }),
    );
  }

  /**
   * Raised for the agency that brokered a fixed match, and only for an agency:
   * a match two individuals found themselves owes nobody a success fee.
   */
  async raiseSettlementFee(profile: Profile, interestId: string): Promise<AgentCharge | null> {
    if (!profile.managedByUserId) return null;
    const fee = this.cfg.payments.agentSettlementFee;
    if (!fee || fee <= 0) return null;

    const existing = await this.charges.findOne({
      where: {
        profileId: profile.id,
        type: AgentChargeType.MATCH_SETTLEMENT,
        interestId,
      },
    });
    if (existing) return existing;

    const charge = await this.charges.save(
      this.charges.create({
        agentUserId: profile.managedByUserId,
        profileId: profile.id,
        payerUserId: profile.userId,
        type: AgentChargeType.MATCH_SETTLEMENT,
        amount: fee.toFixed(2),
        currency: this.cfg.payments.currency,
        status: PaymentStatus.INITIATED,
        interestId,
      }),
    );

    await this.audit.record({
      action: AuditAction.AGENT_CHARGE_RAISED,
      resourceType: 'agent_charge',
      resourceId: charge.id,
      metadata: { type: AgentChargeType.MATCH_SETTLEMENT, profileId: profile.id, interestId },
    });
    return charge;
  }

  /**
   * The client pays a charge.
   *
   * Where it goes depends on what the charge is for, and the two are genuinely
   * different transactions rather than one with a flag.
   *
   * A match settlement is held. The agency is being paid for an outcome, the
   * outcome has not happened yet, and if it never does the money goes back —
   * which is what escrow is for and why refundHeldFor exists.
   *
   * A profile creation fee is not held, and used to be. The work is finished
   * by the time the fee is raised: the profile exists, the biodata is filled
   * in, the document has been checked. Holding it made an agency wait on
   * somebody else's wedding to be paid for a job they had already done, and
   * the ledger read "in escrow", which was accurate and misleading at the same
   * time. It settles on payment instead.
   */
  async pay(actor: AuthUser, chargeId: string): Promise<AgentCharge> {
    const charge = await this.loadOrFail(chargeId);
    await this.assertPayer(actor, charge);

    if (charge.status !== PaymentStatus.INITIATED) {
      throw new BadRequestException(`That charge is already ${charge.status}`);
    }

    const { commission, payout } = this.split(charge.amount);
    // The intent is still created: the client has to pay something, whichever
    // way it is then settled. What differs is whether the hold is kept.
    const intent = await this.gateway.createEscrowHold(charge.amount, charge.currency);

    charge.providerRef = intent.providerRef;
    charge.commissionAmount = commission;
    charge.payoutAmount = payout;
    charge.paidAt = new Date();
    charge.payerUserId = charge.payerUserId ?? actor.userId;

    const settlesNow = charge.type === AgentChargeType.PROFILE_CREATION;
    if (settlesNow) {
      // Released against the same reference, immediately. There is no linked
      // account per agency, so this releases rather than transfers and the
      // platform settles out of band — the same thing releaseForFixedMatch
      // does, at a different moment.
      const result = await this.gateway.release(
        intent.providerRef,
        payout,
        charge.currency,
        { accountId: null, label: 'agency fee' },
      );
      charge.payoutRef = result.transferRef;
      charge.payoutNote = result.reason;
      charge.status = PaymentStatus.RELEASED;
      charge.releasedAt = new Date();
    } else {
      charge.status = PaymentStatus.HELD_IN_ESCROW;
    }

    const saved = await this.charges.save(charge);

    await this.audit.record({
      action: settlesNow ? AuditAction.AGENT_CHARGE_RELEASED : AuditAction.AGENT_CHARGE_HELD,
      actor,
      resourceType: 'agent_charge',
      resourceId: charge.id,
      metadata: { amount: charge.amount, type: charge.type, escrowed: !settlesNow },
    });
    return saved;
  }

  /**
   * Releases everything held for a profile once its match is fixed.
   *
   * The settlement fee only. The profile creation fee is settled when it is
   * paid, because that work is already done by then — it is not waiting on the
   * match and never appears in escrow to be released. Anything still unpaid
   * stays owed.
   */
  async releaseForFixedMatch(profileId: string, interestId: string): Promise<AgentCharge[]> {
    const held = await this.charges.find({
      where: { profileId, status: PaymentStatus.HELD_IN_ESCROW },
    });

    const released: AgentCharge[] = [];
    for (const charge of held) {
      if (charge.providerRef) {
        // An agency fee is collected by the platform and settled to the agency
        // out of band — there is no linked account per agency, so this releases
        // the hold rather than transferring. Recorded either way, so the ledger
        // shows what the gateway actually did.
        const result = await this.gateway.release(
          charge.providerRef,
          charge.payoutAmount,
          charge.currency,
          { accountId: null, label: 'agency fee' },
        );
        charge.payoutRef = result.transferRef;
        charge.payoutNote = result.reason;
      }
      charge.status = PaymentStatus.RELEASED;
      charge.releasedAt = new Date();
      released.push(await this.charges.save(charge));

      await this.audit.record({
        action: AuditAction.AGENT_CHARGE_RELEASED,
        resourceType: 'agent_charge',
        resourceId: charge.id,
        metadata: {
          profileId,
          interestId,
          payout: charge.payoutAmount,
          commission: charge.commissionAmount,
        },
      });
    }
    return released;
  }

  /**
   * Refunds a held charge. Used when a profile is archived without ever
   * reaching a match — the agency was paid for an outcome that did not arrive.
   */
  async refundHeldFor(profileId: string, reason: string): Promise<number> {
    const held = await this.charges.find({
      where: {
        profileId,
        status: In([PaymentStatus.HELD_IN_ESCROW, PaymentStatus.INITIATED]),
      },
    });

    let refunded = 0;
    for (const charge of held) {
      if (charge.status === PaymentStatus.HELD_IN_ESCROW && charge.providerRef) {
        await this.gateway.refund(charge.providerRef, charge.amount);
        charge.status = PaymentStatus.REFUNDED;
        refunded += 1;
      } else {
        // Never paid: there is nothing to send back, so it is simply written off.
        charge.status = PaymentStatus.FAILED;
      }
      charge.notes = reason;
      await this.charges.save(charge);
    }
    return refunded;
  }

  /** The agency's own ledger. */
  async listForAgent(actor: AuthUser): Promise<{ charges: AgentCharge[]; totals: Record<string, string> }> {
    const charges = await this.charges.find({
      where: { agentUserId: actor.userId },
      order: { createdAt: 'DESC' },
    });
    return { charges, totals: this.totals(charges) };
  }

  /** What a client owes or has paid. Agents may read it for their own clients. */
  async listForProfile(actor: AuthUser, profileId: string): Promise<AgentCharge[]> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');

    const mine =
      profile.userId === actor.userId || profile.managedByUserId === actor.userId;
    if (!mine && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('That profile is not yours');
    }
    return this.charges.find({ where: { profileId }, order: { createdAt: 'DESC' } });
  }

  private totals(charges: AgentCharge[]): Record<string, string> {
    const sum = (predicate: (c: AgentCharge) => boolean) =>
      (
        charges
          .filter(predicate)
          .reduce((total, c) => total + Math.round(parseFloat(c.amount) * 100), 0) / 100
      ).toFixed(2);

    return {
      outstanding: sum((c) => c.status === PaymentStatus.INITIATED),
      inEscrow: sum((c) => c.status === PaymentStatus.HELD_IN_ESCROW),
      // What the agency actually banked, net of commission.
      earned: (
        charges
          .filter((c) => c.status === PaymentStatus.RELEASED)
          .reduce((total, c) => total + Math.round(parseFloat(c.payoutAmount) * 100), 0) / 100
      ).toFixed(2),
      refunded: sum((c) => c.status === PaymentStatus.REFUNDED),
    };
  }

  private async assertPayer(actor: AuthUser, charge: AgentCharge): Promise<void> {
    if (actor.role === UserRole.ADMIN) return;
    if (charge.payerUserId && charge.payerUserId === actor.userId) return;
    // An agency may record a walk-in client's payment against the profile it
    // manages: for a client with no account, the agent is the only one who can.
    if (charge.agentUserId === actor.userId) return;

    const profile = await this.profiles.findOne({ where: { id: charge.profileId } });
    if (profile && profile.userId === actor.userId) return;

    throw new ForbiddenException('That charge is not yours to pay');
  }

  private async loadOrFail(id: string): Promise<AgentCharge> {
    const charge = await this.charges.findOne({ where: { id } });
    if (!charge) throw new NotFoundException('Charge not found');
    return charge;
  }
}

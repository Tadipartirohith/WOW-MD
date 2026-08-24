import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vendor } from './entities/vendor.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { ServiceOffering } from '../catalog/entities/service-offering.entity';
import { VerificationService } from '../verification/verification.service';
import { BUSINESS_RULES, canTransition, rulesFor } from './business-lifecycle';
import { ApplicantType, BusinessStatus, UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../../common/enums';

export interface CompletionItem {
  key: string;
  label: string;
  complete: boolean;
  /** What is missing, when it is. Shown to the vendor verbatim. */
  missing: string | null;
}

/**
 * A business from first draft to live, and back when something is wrong.
 *
 * The rules live in `business-lifecycle.ts` as data. This service is the only
 * thing that moves a business between states, which is what makes "can I edit
 * this now?" answerable in one place rather than in ten `if` statements that
 * drift apart.
 */
@Injectable()
export class BusinessLifecycleService {
  constructor(
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(VendorService) private readonly services: Repository<VendorService>,
    @InjectRepository(ServiceOffering) private readonly offerings: Repository<ServiceOffering>,
    // The two reference each other: submitting raises a request, and a
    // decision on that request moves the business back.
    @Inject(forwardRef(() => VerificationService))
    private readonly verification: VerificationService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private async owned(actor: AuthUser, businessId: string): Promise<Vendor> {
    const business = await this.vendors.findOne({ where: { id: businessId } });
    if (!business) throw new NotFoundException('Business not found');
    if (actor.role !== UserRole.ADMIN && business.ownerUserId !== actor.userId) {
      throw new ForbiddenException('That business is not yours');
    }
    return business;
  }

  /**
   * What is filled in, and what is not.
   *
   * Computed rather than tracked. A "documents complete" flag somebody forgot
   * to clear when a document was removed is worse than no flag at all, because
   * it lets an incomplete listing through the gate.
   */
  async completion(actor: AuthUser, businessId: string) {
    const business = await this.owned(actor, businessId);
    const services = await this.services.find({ where: { vendorId: businessId } });
    const offerings = services.length
      ? await this.offerings.find({ where: { vendorServiceId: services[0].id } })
      : [];

    const missingIdentity: string[] = [];
    if (!business.name) missingIdentity.push('business name');
    if (!business.category) missingIdentity.push('category');
    if (!business.gstNumber) missingIdentity.push('GST number');
    if (!business.panNumber) missingIdentity.push('PAN number');
    if (!business.registeredAddress) missingIdentity.push('registered address');
    if (!business.city) missingIdentity.push('city');

    const priced = services.some((svc) =>
      offerings.some((o) => o.vendorServiceId === svc.id && o.active),
    );

    const items: CompletionItem[] = [
      {
        key: 'business',
        label: 'Business details',
        complete: missingIdentity.length === 0,
        missing: missingIdentity.length ? `Still needed: ${missingIdentity.join(', ')}` : null,
      },
      {
        key: 'catalog',
        label: 'Catalog services',
        complete: services.length > 0 && priced,
        missing:
          services.length === 0
            ? 'Add at least one service'
            : !priced
              ? 'One of your services needs a live price'
              : null,
      },
      {
        key: 'documents',
        label: 'Documents',
        // GST and PAN are the documents that matter for a business listing;
        // anything else an officer asks for, they ask for on the visit.
        complete: Boolean(business.gstNumber && business.panNumber),
        missing: business.gstNumber && business.panNumber ? null : 'GST and PAN are both required',
      },
      {
        key: 'portfolio',
        label: 'Portfolio',
        // Genuinely optional, and said so — a vendor should not think they are
        // blocked by something that is not blocking them.
        complete: true,
        missing: (business.portfolio?.length ?? 0) === 0 ? 'Optional, but it sells the work' : null,
      },
    ];

    const blocking = items.filter((i) => !i.complete);
    return {
      businessId,
      status: business.status,
      rules: rulesFor(business.status),
      items,
      canSubmit: blocking.length === 0 && rulesFor(business.status).submit,
      blocking: blocking.map((i) => i.label),
    };
  }

  /**
   * The vendor looks the whole thing over before anybody else does.
   *
   * Deliberately still editable at this point: the purpose of a review step is
   * to find things to change, and a review you cannot act on is a confirmation
   * dialog with extra steps.
   */
  async beginFirstReview(actor: AuthUser, businessId: string) {
    const business = await this.owned(actor, businessId);
    const state = await this.completion(actor, businessId);

    if (!state.canSubmit && state.blocking.length > 0) {
      throw new BadRequestException(
        `Finish these first: ${state.blocking.join(', ')}.`,
      );
    }
    // The chain goes DRAFT → READY_FOR_REVIEW → FIRST_REVIEW, and this walks it
    // rather than jumping. READY_FOR_REVIEW is not decoration: it is the state
    // that says everything needed is filled in, which is what makes opening the
    // review meaningful in the first place.
    if (business.status === BusinessStatus.DRAFT) {
      await this.move(business, BusinessStatus.READY_FOR_REVIEW, actor);
    }
    if (business.status !== BusinessStatus.FIRST_REVIEW) {
      await this.move(business, BusinessStatus.FIRST_REVIEW, actor);
    }
    return this.completion(actor, businessId);
  }

  /**
   * Submitted for verification. The listing locks here.
   *
   * The lock is enforced by the update APIs rather than by hiding a button:
   * a vendor who edits their GST number after an officer has been sent to check
   * it has verified nothing.
   */
  async submitForVerification(actor: AuthUser, businessId: string) {
    const business = await this.owned(actor, businessId);
    const state = await this.completion(actor, businessId);

    if (state.blocking.length > 0) {
      throw new BadRequestException(`Finish these first: ${state.blocking.join(', ')}.`);
    }
    if (!canTransition(business.status, BusinessStatus.PENDING_VERIFICATION)) {
      throw new BadRequestException(
        business.status === BusinessStatus.REJECTED
          ? 'This listing was refused and cannot be resubmitted. Create a new one.'
          : 'Look it over first — open First review, then submit.',
      );
    }

    business.submittedAt = new Date();
    await this.move(business, BusinessStatus.PENDING_VERIFICATION, actor);

    // The verification request is what starts the 72-hour clock. Raised per
    // business, so a vendor's second listing gets its own.
    const request = await this.verification.raise(
      ApplicantType.VENDOR,
      business.ownerUserId,
      business.id,
    );
    await this.verification.startSla(request.id);

    return { businessId, status: business.status, verificationRequestId: request.id };
  }

  /**
   * An officer or administrator sends it back.
   *
   * Edit access comes back with it, which is the entire difference between this
   * and a rejection.
   */
  async requireReverification(businessId: string, reason: string, actor?: AuthUser) {
    const business = await this.vendors.findOne({ where: { id: businessId } });
    if (!business) return null;

    business.decisionReason = reason;
    business.revisionCount += 1;
    await this.move(business, BusinessStatus.REVERIFICATION_REQUIRED, actor);

    await this.notifications.create(business.ownerUserId, NotificationType.VERIFICATION_DECIDED, {
      businessId,
      status: BusinessStatus.REVERIFICATION_REQUIRED,
      reason,
      round: business.revisionCount,
    });
    return business;
  }

  /** Refused. Terminal: the listing is archived and a new one is the way on. */
  async reject(businessId: string, reason: string, actor?: AuthUser) {
    const business = await this.vendors.findOne({ where: { id: businessId } });
    if (!business) return null;

    business.decisionReason = reason;
    business.archivedAt = new Date();
    business.isApproved = false;
    await this.move(business, BusinessStatus.REJECTED, actor);

    await this.notifications.create(business.ownerUserId, NotificationType.VERIFICATION_DECIDED, {
      businessId,
      status: BusinessStatus.REJECTED,
      reason,
    });
    return business;
  }

  /**
   * Whether a decision could land, asked before anything is written.
   *
   * `decide` used to save the request and then activate the applicant. When the
   * activation was refused — approving a listing that had been sent back and
   * not yet resubmitted, say — the request was already marked approved and the
   * business was not, which is the worst of both: the queue says done and the
   * vendor is still waiting.
   */
  async canDecide(
    businessId: string,
    outcome: 'approve' | 'reject' | 'revisit',
  ): Promise<{ ok: boolean; reason: string | null }> {
    const business = await this.vendors.findOne({ where: { id: businessId } });
    if (!business) return { ok: true, reason: null };

    const target =
      outcome === 'approve'
        ? BusinessStatus.VERIFIED
        : outcome === 'reject'
          ? BusinessStatus.REJECTED
          : BusinessStatus.REVERIFICATION_REQUIRED;

    if (business.status === target) return { ok: true, reason: null };
    if (canTransition(business.status, target)) return { ok: true, reason: null };

    return {
      ok: false,
      reason:
        business.status === BusinessStatus.REVERIFICATION_REQUIRED
          ? 'That listing was sent back and has not been resubmitted yet.'
          : `A ${business.status} listing cannot be ${outcome}d.`,
    };
  }

  /** Approved. Verified, then live — and the identity locks for good. */
  async approve(businessId: string, actor?: AuthUser) {
    const business = await this.vendors.findOne({ where: { id: businessId } });
    if (!business) return null;

    business.verifiedAt = new Date();
    business.decisionReason = null;
    await this.move(business, BusinessStatus.VERIFIED, actor);
    await this.move(business, BusinessStatus.LIVE, actor);

    await this.notifications.create(business.ownerUserId, NotificationType.VERIFICATION_DECIDED, {
      businessId,
      status: BusinessStatus.LIVE,
    });
    return business;
  }

  /** An officer has started; the business follows the request. */
  async markInProgress(businessId: string) {
    const business = await this.vendors.findOne({ where: { id: businessId } });
    if (!business) return null;
    if (!canTransition(business.status, BusinessStatus.VERIFICATION_IN_PROGRESS)) return business;
    await this.move(business, BusinessStatus.VERIFICATION_IN_PROGRESS);
    return business;
  }

  /**
   * The single writer for a business's status.
   *
   * `isApproved` is maintained here rather than anywhere else, so search and
   * the lifecycle cannot disagree about whether a business is live.
   */
  private async move(business: Vendor, to: BusinessStatus, actor?: AuthUser): Promise<Vendor> {
    const from = business.status;
    if (from !== to && !canTransition(from, to)) {
      throw new BadRequestException(`A ${from} listing cannot move to ${to}`);
    }

    business.status = to;
    business.isApproved = BUSINESS_RULES[to].visible;
    const saved = await this.vendors.save(business);

    await this.audit.record({
      action: AuditAction.VENDOR_APPROVED,
      actor,
      resourceType: 'vendor',
      resourceId: business.id,
      metadata: { from, to, reason: business.decisionReason },
    });
    return saved;
  }

  /** What this business may do right now. Rendered by the client as-is. */
  async rulesFor(actor: AuthUser, businessId: string) {
    const business = await this.owned(actor, businessId);
    return { businessId, status: business.status, ...rulesFor(business.status) };
  }

  /**
   * Refuses an edit the current state does not allow.
   *
   * Called by the vendor update paths. Hiding the button is not enough: the
   * whole point of a lock is that it holds when somebody posts anyway.
   */
  assertEditable(business: Vendor, what: 'identity' | 'catalog'): void {
    const rules = rulesFor(business.status);
    const allowed = what === 'identity' ? rules.editIdentity : rules.editCatalog;
    if (!allowed) {
      throw new ForbiddenException(rules.note);
    }
  }
}

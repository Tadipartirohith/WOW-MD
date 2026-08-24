import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  IMAGE_MODERATION_PROVIDER,
  ImageModerationProvider,
  ImageVerdict,
} from './image-moderation.provider';
import { AuditAction, AuditService } from '../audit/audit.service';

/**
 * The one place a photograph is checked before it is attached to anybody.
 *
 * Uploading and *attaching* are separate steps here: the browser puts the file
 * straight into storage, which is what keeps a fifty-megabyte upload off a
 * request worker, and the backend only ever sees a URL afterwards. So the check
 * lives at the attach points — profile photographs, biodata galleries, agency
 * photographs, album items — rather than in the upload itself.
 *
 * That has a consequence worth naming: a rejected file has already been stored.
 * It is never referenced, so nobody can see it, and the storage lifecycle
 * sweeps unreferenced objects. Refusing at attach time is the earliest point
 * the platform can refuse at all without proxying every byte.
 */
@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    @Inject(IMAGE_MODERATION_PROVIDER) private readonly provider: ImageModerationProvider,
    private readonly audit: AuditService,
  ) {}

  /**
   * Refuses anything that is not a photograph of a real person.
   *
   * Throws rather than returning a verdict, because every caller would
   * otherwise write the same three lines and one of them would eventually
   * forget.
   */
  async assertGenuinePhoto(url: string, context: { userId?: string; kind: string }): Promise<void> {
    const verdict = await this.check(url);
    if (verdict.allowed) return;

    // Recorded, not just refused. A run of rejections against one account is
    // worth somebody looking at, and the refusal message alone tells nobody.
    await this.audit
      .record({
        action: AuditAction.PROFILE_PHOTO_REJECTED,
        actor: context.userId ? { userId: context.userId, role: undefined as never } : undefined,
        resourceType: 'image',
        resourceId: url.slice(0, 200),
        metadata: { kind: context.kind, score: verdict.syntheticScore },
      })
      .catch((err) => this.logger.error('could not record a rejected image', err as Error));

    throw new BadRequestException(
      `${verdict.reason ?? 'That image cannot be used.'} Please upload an authentic photograph.`,
    );
  }

  check(url: string): Promise<ImageVerdict> {
    return this.provider.check(url);
  }
}

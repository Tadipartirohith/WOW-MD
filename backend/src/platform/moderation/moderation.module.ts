import { Global, Module } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import {
  HeuristicImageModerationProvider,
  HostedImageModerationProvider,
  imageModerationProviderFactory,
} from './image-moderation.provider';

/**
 * Image moderation, global for the same reason audit and mail are: a
 * photograph can be attached from four different modules, and a control that
 * some of them remember to import is not a control.
 */
@Global()
@Module({
  providers: [
    HeuristicImageModerationProvider,
    HostedImageModerationProvider,
    imageModerationProviderFactory,
    ModerationService,
  ],
  exports: [ModerationService],
})
export class ModerationModule {}

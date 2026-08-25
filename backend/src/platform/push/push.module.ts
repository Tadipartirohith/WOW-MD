import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushToken } from './push-token.entity';
import { FcmPushProvider, LogPushProvider, pushProviderFactory } from './push.provider';
import { PushService } from './push.service';

/** Global, like mail and SMS: anything that notifies can reach a phone. */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([PushToken])],
  providers: [LogPushProvider, FcmPushProvider, pushProviderFactory, PushService],
  exports: [PushService],
})
export class PushModule {}

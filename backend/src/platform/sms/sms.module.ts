import { Global, Module } from '@nestjs/common';
import { HttpSmsProvider, LogSmsProvider, smsProviderFactory } from './sms.provider';
import { SmsService } from './sms.service';

/** Global so any module can send a message without re-importing the transport. */
@Global()
@Module({
  providers: [LogSmsProvider, HttpSmsProvider, smsProviderFactory, SmsService],
  exports: [SmsService],
})
export class SmsModule {}

import { Global, Module } from '@nestjs/common';
import { LogMailProvider, SmtpMailProvider, mailProviderFactory } from './mail.provider';
import { MailService } from './mail.service';

/** Global so any module can send mail without re-importing the transport. */
@Global()
@Module({
  providers: [LogMailProvider, SmtpMailProvider, mailProviderFactory, MailService],
  exports: [MailService],
})
export class MailModule {}

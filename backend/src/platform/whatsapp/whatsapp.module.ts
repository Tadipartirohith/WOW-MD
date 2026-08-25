import { Global, Module } from '@nestjs/common';
import {
  CloudApiWhatsAppProvider,
  LogWhatsAppProvider,
  whatsappProviderFactory,
} from './whatsapp.provider';
import { WhatsAppService } from './whatsapp.service';

@Global()
@Module({
  providers: [
    LogWhatsAppProvider,
    CloudApiWhatsAppProvider,
    whatsappProviderFactory,
    WhatsAppService,
  ],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}

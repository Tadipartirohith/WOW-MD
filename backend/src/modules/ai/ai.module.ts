import { Module } from '@nestjs/common';
import { MatchmakingModule } from '../matchmaking/matchmaking.module';
import { VendorsModule } from '../vendors/vendors.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { MockAiProvider, OpenAiProvider, aiProviderFactory } from './ai.provider';

@Module({
  imports: [MatchmakingModule, VendorsModule],
  providers: [AiService, MockAiProvider, OpenAiProvider, aiProviderFactory],
  controllers: [AiController],
})
export class AiModule {}

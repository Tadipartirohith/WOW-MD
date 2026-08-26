import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { ChatBlock, ChatReport } from './entities/chat-block.entity';
import { ChatPreference } from './entities/chat-preference.entity';
import { Interest } from '../matchmaking/entities/interest.entity';
import { User } from '../auth/entities/user.entity';
import { Profile } from '../users/entities/profile.entity';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { PresenceService } from './presence.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, Message, Interest, User, Profile, ChatBlock, ChatReport, ChatPreference]),
    JwtModule.register({}),
  ],
  providers: [ChatService, ChatGateway, PresenceService],
  controllers: [ChatController],
  exports: [ChatService, PresenceService],
})
export class ChatModule {}

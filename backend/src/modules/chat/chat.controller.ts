import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { MessageHistoryQueryDto, SendMessageDto } from './dto/chat.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('chat')
@ApiBearerAuth()
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** REST fallback for sending (WebSocket is the primary path). */
  @Post('messages')
  send(@CurrentUser('userId') userId: string, @Body() dto: SendMessageDto) {
    return this.chat.persistMessage(userId, dto.toUserId, dto.body, dto.mediaUrl);
  }

  @Get('messages')
  history(@CurrentUser('userId') userId: string, @Query() q: MessageHistoryQueryDto) {
    return this.chat.history(userId, q.withUserId, q.page, q.limit);
  }
}

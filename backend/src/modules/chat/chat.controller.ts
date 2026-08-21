import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { MessageHistoryQueryDto, SendMessageDto } from './dto/chat.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

@ApiTags('chat')
@ApiBearerAuth()
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** REST fallback for sending (WebSocket is the primary path). */
  @RequirePermissions(Permission.CHAT_INQUIRE)
  @Post('messages')
  send(@CurrentUser('userId') userId: string, @Body() dto: SendMessageDto) {
    return this.chat.persistMessage(userId, dto.toUserId, dto.body, dto.mediaUrl);
  }

  @RequirePermissions(Permission.CHAT_INQUIRE)
  @Get('messages')
  history(@CurrentUser('userId') userId: string, @Query() q: MessageHistoryQueryDto) {
    return this.chat.history(userId, q.withUserId, q.page, q.limit);
  }

  @RequirePermissions(Permission.CHAT_INQUIRE)
  @Get('conversations')
  conversations(@CurrentUser('userId') userId: string) {
    return this.chat.listConversations(userId);
  }

  @RequirePermissions(Permission.CHAT_INQUIRE)
  @Put('messages/read')
  @HttpCode(200)
  markRead(@CurrentUser('userId') userId: string, @Query() q: MessageHistoryQueryDto) {
    return this.chat.markRead(userId, q.withUserId);
  }

  @RequirePermissions(Permission.CHAT_INQUIRE)
  @Get('presence')
  presence(@Query() q: MessageHistoryQueryDto) {
    return this.chat.presenceOf(q.withUserId);
  }
}

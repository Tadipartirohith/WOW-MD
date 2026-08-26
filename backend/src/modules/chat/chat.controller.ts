import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import {
  BlockUserDto,
  ConversationTargetDto,
  MessageHistoryQueryDto,
  MuteConversationDto,
  ReportUserDto,
  SearchConversationDto,
  SendMessageDto,
} from './dto/chat.dto';
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

  // ------------------------------------------------------------- blocking

  @ApiOperation({
    summary: 'Whether you have blocked this person',
    description:
      'Reports only your own block, never theirs. Knowing you have been blocked is the thing ' +
      'this is designed not to tell you.',
  })
  @RequirePermissions(Permission.CHAT_INQUIRE)
  @Get('block')
  blockState(@CurrentUser('userId') userId: string, @Query('withUserId', ParseUUIDPipe) other: string) {
    return this.chat.blockState(userId, other);
  }

  @RequirePermissions(Permission.CHAT_INQUIRE)
  @HttpCode(200)
  @Post('block')
  block(@CurrentUser('userId') userId: string, @Body() dto: BlockUserDto) {
    return this.chat.block(userId, dto.userId, dto.note);
  }

  @RequirePermissions(Permission.CHAT_INQUIRE)
  @Delete('block/:userId')
  unblock(
    @CurrentUser('userId') userId: string,
    @Param('userId', ParseUUIDPipe) other: string,
  ) {
    return this.chat.unblock(userId, other);
  }

  @ApiOperation({
    summary: 'Report somebody, and stop hearing from them',
    description:
      'The last twenty messages are copied in as evidence rather than referenced, because ' +
      'evidence that changes afterwards is not evidence. Reporting also blocks: somebody who ' +
      'reports almost always wants it to stop as well.',
  })
  @RequirePermissions(Permission.CHAT_INQUIRE)
  @Post('report')
  report(@CurrentUser('userId') userId: string, @Body() dto: ReportUserDto) {
    return this.chat.report(userId, dto.userId, dto.reason, dto.detail);
  }
  @ApiOperation({
    summary: 'Find a phrase inside one conversation',
    description:
      'Scoped to the thread, because that is the question being asked. Messages you have '
      + 'cleared stay hidden — searching a thread you emptied should not hand back what you '
      + 'removed.',
  })
  @Get('search')
  search(@CurrentUser('userId') userId: string, @Query() q: SearchConversationDto) {
    return this.chat.searchConversation(userId, q.withUserId, q.term);
  }

  @ApiOperation({
    summary: 'Mute or unmute one conversation',
    description: 'Yours alone. It still receives messages; it stops interrupting you.',
  })
  @Put('mute')
  mute(@CurrentUser('userId') userId: string, @Body() dto: MuteConversationDto) {
    return this.chat.setMuted(userId, dto.withUserId, dto.muted === true);
  }

  @ApiOperation({
    summary: 'Empty a conversation, for you',
    description:
      'A watermark rather than a delete. The other side keeps their copy, and the messages '
      + 'remain for a report or a dispute to be investigated with — which is also what the '
      + 'request means: an empty screen, not a destroyed record.',
  })
  @Put('clear')
  clear(@CurrentUser('userId') userId: string, @Body() dto: ConversationTargetDto) {
    return this.chat.clear(userId, dto.withUserId);
  }

  @ApiOperation({
    summary: 'Remove a conversation from your list',
    description: 'A new message brings it back, empty.',
  })
  @Put('delete-conversation')
  removeConversation(
    @CurrentUser('userId') userId: string,
    @Body() dto: ConversationTargetDto,
  ) {
    return this.chat.deleteConversation(userId, dto.withUserId);
  }

}

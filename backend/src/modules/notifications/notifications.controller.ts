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
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PushService } from '../../platform/push/push.service';
import { RegisterDeviceDto, WhatsAppOptInDto } from './dto/channel.dto';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly push: PushService,
  ) {}

  @Get()
  list(@CurrentUser('userId') userId: string) {
    return this.notifications.listForUser(userId);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser('userId') userId: string) {
    return this.notifications.unreadCount(userId);
  }

  @Put('read-all')
  @HttpCode(200)
  markAllRead(@CurrentUser('userId') userId: string) {
    return this.notifications.markAllRead(userId);
  }

  @Put(':id/read')
  markRead(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(userId, id);
  }

  // ------------------------------------------------------------- channels

  @ApiOperation({
    summary: 'Register this device for push notifications',
    description:
      'Registering is the consent, and signing out withdraws it. A token belongs to an app ' +
      'installation rather than to a person, so registering one already claimed by another ' +
      'account moves it — a handed-over phone must not keep receiving the last owner\'s ' +
      'notifications.',
  })
  @Post('devices')
  registerDevice(@CurrentUser('userId') userId: string, @Body() dto: RegisterDeviceDto) {
    return this.push.register(userId, dto.token, dto.platform);
  }

  @ApiOperation({ summary: 'Stop this device receiving notifications' })
  @Delete('devices/:token')
  unregisterDevice(@CurrentUser('userId') userId: string, @Param('token') token: string) {
    return this.push.unregister(userId, token);
  }

  @ApiOperation({
    summary: 'Turn WhatsApp notifications on or off',
    description:
      'Off unless asked for, and never inferred from having a phone number. A number given so ' +
      'the platform could verify it is not consent to be messaged on WhatsApp. Only the few ' +
      'notification types with an approved template go out this way — money and jobs.',
  })
  @Put('channels/whatsapp')
  setWhatsApp(@CurrentUser('userId') userId: string, @Body() dto: WhatsAppOptInDto) {
    return this.notifications.setWhatsApp(userId, dto.optIn === true);
  }

  @ApiOperation({ summary: 'Which channels this account is reachable on' })
  @Get('channels')
  async channels(@CurrentUser('userId') userId: string) {
    return this.notifications.channels(userId, await this.push.devicesFor(userId));
  }
}

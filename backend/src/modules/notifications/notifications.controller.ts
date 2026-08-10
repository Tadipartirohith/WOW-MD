import { Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser('userId') userId: string) {
    return this.notifications.listForUser(userId);
  }

  @Put(':id/read')
  markRead(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(userId, id);
  }
}

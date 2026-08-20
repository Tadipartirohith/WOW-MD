import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { Profile } from '../users/entities/profile.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsConsumer } from './notifications.consumer';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, Profile])],
  providers: [NotificationsService, NotificationsConsumer],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}

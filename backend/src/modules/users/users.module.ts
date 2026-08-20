import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Profile } from './entities/profile.entity';
import { UsersService } from './users.service';
import { IdentityService } from './identity.service';
import { UsersController } from './users.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Profile])],
  providers: [UsersService, IdentityService],
  controllers: [UsersController],
  exports: [UsersService, IdentityService, TypeOrmModule],
})
export class UsersModule {}

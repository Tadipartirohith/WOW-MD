import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateProfileDto } from './dto/profile.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

@ApiTags('users')
@ApiBearerAuth()
@RequirePermissions(Permission.PROFILE_MANAGE_OWN)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  getMe(@CurrentUser('userId') userId: string) {
    return this.users.getByUserId(userId);
  }

  @Put('me/profile')
  upsert(@CurrentUser('userId') userId: string, @Body() dto: CreateProfileDto) {
    return this.users.upsert(userId, dto);
  }
}

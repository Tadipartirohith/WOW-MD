import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateProfileDto, UpdateProfileDto } from './dto/profile.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  getMe(@CurrentUser('userId') userId: string) {
    return this.users.getByUserId(userId);
  }

  @Put('me/profile')
  upsert(@CurrentUser('userId') userId: string, @Body() dto: CreateProfileDto | UpdateProfileDto) {
    return this.users.upsert(userId, dto);
  }
}

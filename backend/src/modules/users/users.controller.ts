import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { IdentityService } from './identity.service';
import { CreateProfileDto } from './dto/profile.dto';
import { SubmitGovernmentIdDto } from './dto/identity.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

@ApiTags('users')
@ApiBearerAuth()
@RequirePermissions(Permission.PROFILE_MANAGE_OWN)
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly identity: IdentityService,
  ) {}

  @Get('me')
  getMe(@CurrentUser('userId') userId: string) {
    return this.users.getByUserId(userId);
  }

  @Put('me/profile')
  upsert(@CurrentUser('userId') userId: string, @Body() dto: CreateProfileDto) {
    return this.users.upsert(userId, dto);
  }

  // ---------------------------------------------------------------- identity

  @ApiOperation({
    summary: 'Submit a government identity document',
    description:
      'The number is validated and hashed; only the last four digits are kept. A document ' +
      'already registered against another profile is refused, which is what stops one person ' +
      'running two profiles.',
  })
  @Post('profiles/:id/identity')
  submitIdentity(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitGovernmentIdDto,
  ) {
    return this.identity.submit(actor, id, dto);
  }

  @ApiOperation({ summary: 'Whether a profile has a document on file, and whether it is verified' })
  @Get('profiles/:id/identity')
  identityStatus(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.identity.status(actor, id);
  }
}

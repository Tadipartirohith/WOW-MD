import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProfileClaimsService } from './profile-claims.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

/**
 * The subject's side of a claim request.
 *
 * Separate from the agents controller because the reader here is the person the
 * profile is about, not the agency that built it — and the permission differs
 * accordingly. An agent may ask; only the subject may answer.
 */
@ApiTags('profile-claims')
@ApiBearerAuth()
@RequirePermissions(Permission.PROFILE_MANAGE_OWN)
@Controller('profile-claims')
export class ClaimRequestsController {
  constructor(private readonly claims: ProfileClaimsService) {}

  @ApiOperation({ summary: 'Profiles an agency has offered to hand over to you' })
  @Get()
  list(@CurrentUser('userId') userId: string) {
    return this.claims.listForTarget(userId);
  }

  @ApiOperation({ summary: 'Accept a profile an agency built for you' })
  @HttpCode(200)
  @Put(':id/approve')
  approve(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.claims.approve(userId, id);
  }

  @ApiOperation({ summary: 'Decline it' })
  @HttpCode(200)
  @Put(':id/decline')
  decline(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.claims.decline(userId, id);
  }
}

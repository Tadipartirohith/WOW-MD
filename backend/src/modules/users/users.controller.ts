import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { IdentityService } from './identity.service';
import { toOwnProfile } from './dto/public-profile.dto';
import { DataRightsService } from './data-rights.service';
import { CreateProfileDto } from './dto/profile.dto';
import { SubmitGovernmentIdDto } from './dto/identity.dto';
import { EraseAccountDto } from './dto/data-rights.dto';
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
    private readonly dataRights: DataRightsService,
  ) {}

  // ------------------------------------------------------- data-subject rights

  @ApiOperation({
    summary: 'Everything held about you, as one JSON document',
    description: 'Deliberately complete rather than readable — that is the point of an export.',
  })
  @Get('me/export')
  exportData(@CurrentUser() actor: AuthUser) {
    return this.dataRights.export(actor);
  }

  @ApiOperation({
    summary: 'Delete your account and personal record',
    description:
      'Refused while money is in flight. Consent history and the financial record survive, ' +
      'because they are what the platform answers for its own conduct with.',
  })
  @HttpCode(200)
  @Post('me/erase')
  eraseData(@CurrentUser() actor: AuthUser, @Body() dto: EraseAccountDto) {
    return this.dataRights.erase(actor, dto.password);
  }


  @Get('me')
  async getMe(@CurrentUser('userId') userId: string) {
    return toOwnProfile(await this.users.getByUserId(userId));
  }

  @Put('me/profile')
  async upsert(@CurrentUser('userId') userId: string, @Body() dto: CreateProfileDto) {
    return toOwnProfile(await this.users.upsert(userId, dto));
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

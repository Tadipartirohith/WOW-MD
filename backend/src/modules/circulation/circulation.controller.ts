import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConsentService } from './consent.service';
import { SharingService } from './sharing.service';
import { ProposalsService } from './proposals.service';
import { AgentDirectoryService } from './agent-directory.service';
import { RecordConsentDto, RevokeConsentDto } from './dto/consent.dto';
import {
  AgentDirectoryDto,
  PoolSearchDto,
  PostProposalNoteDto,
  SetPoolVisibilityDto,
  ShareLinkDto,
  ShareToAgentDto,
  ShareToUserDto,
} from './dto/sharing.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';
import { toBiodata } from '../users/dto/public-profile.dto';

/**
 * Circulation: consent, sharing, the agent pool, and cross-agent pairing
 * threads. This is the agency's day job, so it lives in one place rather than
 * being scattered across the agent and matchmaking modules.
 */
@ApiTags('circulation')
@Controller('circulation')
export class CirculationController {
  constructor(
    private readonly consent: ConsentService,
    private readonly sharing: SharingService,
    private readonly proposals: ProposalsService,
    private readonly directory: AgentDirectoryService,
  ) {}

  // ------------------------------------------------------------------ consent

  @ApiBearerAuth()
  @RequirePermissions(Permission.MANAGED_PROFILE_MANAGE)
  @ApiOperation({
    summary: 'Record consent for a profile the agency built',
    description:
      'INTAKE permits holding the details; CIRCULATION permits sharing them outside the agency ' +
      'and expires, so it has to be re-confirmed with the family periodically.',
  })
  @Post('profiles/:id/consent')
  recordConsent(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordConsentDto,
  ) {
    return this.consent.record(actor, id, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.MANAGED_PROFILE_MANAGE)
  @Get('profiles/:id/consent')
  consentState(@Param('id', ParseUUIDPipe) id: string) {
    return this.consent.stateFor(id);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.MANAGED_PROFILE_MANAGE)
  @Get('profiles/:id/consent/history')
  consentHistory(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.consent.history(actor, id);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.MANAGED_PROFILE_MANAGE)
  @ApiOperation({ summary: 'Withdraw consent; also pulls the profile out of the pool' })
  @Delete('consent/:id')
  revokeConsent(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeConsentDto,
  ) {
    return this.consent.revoke(actor, id, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.MANAGED_PROFILE_MANAGE)
  @ApiOperation({ summary: 'Profiles whose circulation consent lapses soon' })
  @Get('consent/expiring')
  expiring(@CurrentUser('userId') userId: string) {
    return this.consent.expiringSoon(userId);
  }

  // ----------------------------------------------------------------- sharing

  @ApiBearerAuth()
  @RequirePermissions(Permission.PROFILE_CIRCULATE)
  @ApiOperation({ summary: 'Share a profile with another approved agent' })
  @Post('share/agent')
  shareWithAgent(@CurrentUser() actor: AuthUser, @Body() dto: ShareToAgentDto) {
    return this.sharing.shareWithAgent(actor, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.PROFILE_CIRCULATE)
  @ApiOperation({
    summary: 'Share a profile directly with a platform user',
    description: 'For a family that already has an account and is browsing themselves.',
  })
  @Post('share/user')
  shareWithUser(@CurrentUser() actor: AuthUser, @Body() dto: ShareToUserDto) {
    return this.sharing.shareWithUser(actor, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.PROFILE_CIRCULATE)
  @ApiOperation({
    summary: 'Create a shareable biodata link',
    description:
      'A signed, expiring link for someone with no account — the digital equivalent of handing ' +
      'over a biodata sheet. Revocable at any time.',
  })
  @Post('share/link')
  shareLink(@CurrentUser() actor: AuthUser, @Body() dto: ShareLinkDto) {
    return this.sharing.createShareLink(actor, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.PROFILE_CIRCULATE)
  @Put('profiles/:id/pool')
  setPool(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPoolVisibilityDto,
  ) {
    return this.sharing.setPoolVisibility(actor, id, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.PROFILE_CIRCULATE)
  @ApiOperation({ summary: 'Everyone this profile has been circulated to' })
  @Get('profiles/:id/shares')
  recipients(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sharing.recipientsOf(actor, id);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.PROFILE_CIRCULATE)
  @Delete('shares/:id')
  revokeShare(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sharing.revoke(actor, id);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.PROFILE_CIRCULATE)
  @ApiOperation({ summary: 'Withdraw every outstanding share of a profile at once' })
  @Delete('profiles/:id/shares')
  revokeAll(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sharing.revokeAllFor(actor, id);
  }

  // ------------------------------------------------------------- the receiving end

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Profiles other agents or agencies have shared with you' })
  @ApiOperation({
    summary: 'Did circulating this profile lead anywhere?',
    description:
      'Shares, opens and what came of them. "Opened but silent" is the number worth acting on.',
  })
  @Get('profiles/:id/reach')
  reach(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sharing.reach(actor, id);
  }

  @Get('shared-with-me')
  async sharedWithMe(@CurrentUser() actor: AuthUser) {
    const rows = await this.sharing.sharedWithMe(actor);
    return rows.map(({ share, profile }) => ({
      shareId: share.id,
      sharedAt: share.createdAt,
      message: share.message,
      // A recipient gets the full biodata: the point of circulating is that they
      // can assess the match. They still cannot edit it or act as it.
      profile: toBiodata(profile),
    }));
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.NETWORK_POOL_BROWSE)
  @ApiOperation({ summary: 'Search the vetted-agent pool' })
  @Get('pool')
  searchPool(@CurrentUser() actor: AuthUser, @Query() q: PoolSearchDto) {
    return this.sharing.searchPool(actor, q);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.PROFILE_CIRCULATE)
  @ApiOperation({ summary: 'Approved agents you can share with' })
  @Get('agents')
  agents(@CurrentUser() actor: AuthUser, @Query() q: AgentDirectoryDto) {
    return this.directory.list(actor, q);
  }

  /**
   * The biodata link itself. Public because the recipient has no account —
   * that is the entire point — but the token is single-purpose, expiring and
   * revocable, and consent is re-checked on every read.
   */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Open a shared biodata link' })
  @Get('biodata/:token')
  async biodata(@Param('token') token: string) {
    const profile = await this.sharing.resolveLink(token);
    return toBiodata(profile);
  }

  // --------------------------------------------------- cross-agent proposals

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'The conversation on one possible match',
    description:
      'Where the two sides are handled by different agents, this is where they negotiate — ' +
      'before the families ever speak.',
  })
  @Get('proposals/:interestId')
  thread(@CurrentUser() actor: AuthUser, @Param('interestId', ParseUUIDPipe) id: string) {
    return this.proposals.thread(actor, id);
  }

  @ApiBearerAuth()
  @Post('proposals/:interestId/notes')
  postNote(
    @CurrentUser() actor: AuthUser,
    @Param('interestId', ParseUUIDPipe) id: string,
    @Body() dto: PostProposalNoteDto,
  ) {
    return this.proposals.post(actor, id, dto);
  }

  @ApiBearerAuth()
  @Get('proposals')
  myThreads(@CurrentUser() actor: AuthUser) {
    return this.proposals.myThreads(actor);
  }
}

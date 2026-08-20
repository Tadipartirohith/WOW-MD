import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { MatchmakingService } from './matchmaking.service';
import { MatchLifecycleService } from './match-lifecycle.service';
import { SendInterestDto, SubjectQueryDto, SuggestionsQueryDto } from './dto/matchmaking.dto';
import { ConfirmMatchFixedDto, EndMatchDto, ReportMatchDto } from './dto/lifecycle.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

@ApiTags('matches')
@ApiBearerAuth()
@Controller('matches')
export class MatchmakingController {
  constructor(
    private readonly matchmaking: MatchmakingService,
    private readonly lifecycle: MatchLifecycleService,
  ) {}

  @RequirePermissions(Permission.MATCH_BROWSE)
  @ApiOperation({
    summary: 'Ranked match suggestions',
    description:
      'Acts as the caller\'s own profile by default. Agents and family members pass profileId to ' +
      'browse as a profile they manage, including one whose subject has not signed up yet. ' +
      'Vendor and planner accounts cannot reach this route.',
  })
  @Get('suggestions')
  suggestions(@CurrentUser() actor: AuthUser, @Query() q: SuggestionsQueryDto) {
    return this.matchmaking.suggestions(actor, q.page, q.limit, q.profileId);
  }

  @RequirePermissions(Permission.MATCH_SEND_INTEREST)
  @Post('interest')
  sendInterest(@CurrentUser() actor: AuthUser, @Body() dto: SendInterestDto) {
    return this.matchmaking.sendInterest(actor, dto.toProfileId, dto.profileId);
  }

  @RequirePermissions(Permission.MATCH_BROWSE)
  @Get('incoming')
  incoming(@CurrentUser() actor: AuthUser, @Query() q: SubjectQueryDto) {
    return this.matchmaking.incoming(actor, q.profileId);
  }

  @RequirePermissions(Permission.MATCH_BROWSE)
  @Get('outgoing')
  outgoing(@CurrentUser() actor: AuthUser, @Query() q: SubjectQueryDto) {
    return this.matchmaking.outgoing(actor, q.profileId);
  }

  @RequirePermissions(Permission.MATCH_RESPOND_INTEREST)
  @Put(':id/accept')
  accept(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.matchmaking.respond(actor, id, true);
  }

  @RequirePermissions(Permission.MATCH_RESPOND_INTEREST)
  @Put(':id/reject')
  reject(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.matchmaking.respond(actor, id, false);
  }

  @RequirePermissions(Permission.MATCH_BROWSE)
  @Get('accepted')
  accepted(@CurrentUser() actor: AuthUser, @Query() q: SubjectQueryDto) {
    return this.matchmaking.accepted(actor, q.profileId);
  }

  // --------------------------------------------------------- match lifecycle

  @RequirePermissions(Permission.MATCH_LIFECYCLE)
  @ApiOperation({
    summary: 'Take back an interest you sent',
    description: 'Only while it is still unanswered — a decision on the record is not erasable.',
  })
  @Put(':id/withdraw')
  withdraw(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.lifecycle.withdraw(actor, id);
  }

  @RequirePermissions(Permission.MATCH_LIFECYCLE)
  @ApiOperation({ summary: 'End an accepted match. Either side may do it.' })
  @Put(':id/unmatch')
  unmatch(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndMatchDto,
  ) {
    return this.lifecycle.unmatch(actor, id, dto.reason);
  }

  @RequirePermissions(Permission.MATCH_LIFECYCLE)
  @ApiOperation({
    summary: 'Block the other side',
    description:
      'Permanent: the two profiles never appear in one another’s suggestions again.',
  })
  @Put(':id/block')
  block(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndMatchDto,
  ) {
    return this.lifecycle.block(actor, id, dto.reason);
  }

  @RequirePermissions(Permission.MATCH_LIFECYCLE)
  @ApiOperation({
    summary: 'Report the other side',
    description: 'Raises a support case for investigation and blocks the pairing meanwhile.',
  })
  @Post(':id/report')
  report(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportMatchDto,
  ) {
    return this.lifecycle.report(actor, id, dto.reason);
  }

  @RequirePermissions(Permission.MATCH_FIX)
  @ApiOperation({
    summary: 'Confirm Match Fixed for your side',
    description:
      'The second confirmation closes matchmaking for both profiles, provisions accounts for ' +
      'anyone who did not have one, and unlocks vendor and planner services.',
  })
  @Put(':id/match-fixed')
  confirmMatchFixed(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmMatchFixedDto,
  ) {
    return this.lifecycle.confirmMatchFixed(actor, id, dto.side);
  }

  @RequirePermissions(Permission.MATCH_BROWSE)
  @ApiOperation({ summary: 'Where this profile stands: onboarding stage and any fixed match' })
  @Get('status')
  matchStatus(@CurrentUser() actor: AuthUser, @Query() q: SubjectQueryDto) {
    return this.lifecycle.status(actor, q.profileId);
  }
}

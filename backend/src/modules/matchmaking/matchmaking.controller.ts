import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { MatchmakingService } from './matchmaking.service';
import { SendInterestDto, SubjectQueryDto, SuggestionsQueryDto } from './dto/matchmaking.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

@ApiTags('matches')
@ApiBearerAuth()
@Controller('matches')
export class MatchmakingController {
  constructor(private readonly matchmaking: MatchmakingService) {}

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
}

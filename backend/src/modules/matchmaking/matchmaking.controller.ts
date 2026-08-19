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
      'Individual accounts browse their own suggestions. Agents pass onBehalfOfUserId to browse ' +
      'as one of their clients. Vendor and planner accounts cannot reach this route.',
  })
  @Get('suggestions')
  suggestions(@CurrentUser() actor: AuthUser, @Query() q: SuggestionsQueryDto) {
    return this.matchmaking.suggestions(actor, q.page, q.limit, q.onBehalfOfUserId);
  }

  @RequirePermissions(Permission.MATCH_SEND_INTEREST)
  @Post('interest')
  sendInterest(@CurrentUser() actor: AuthUser, @Body() dto: SendInterestDto) {
    return this.matchmaking.sendInterest(actor, dto.toUserId, dto.onBehalfOfUserId);
  }

  @RequirePermissions(Permission.MATCH_BROWSE)
  @Get('incoming')
  incoming(@CurrentUser() actor: AuthUser, @Query() q: SubjectQueryDto) {
    return this.matchmaking.incoming(actor, q.onBehalfOfUserId);
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
    return this.matchmaking.accepted(actor, q.onBehalfOfUserId);
  }
}

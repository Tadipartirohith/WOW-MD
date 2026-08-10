import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { MatchmakingService } from './matchmaking.service';
import { SendInterestDto, SuggestionsQueryDto } from './dto/matchmaking.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('matches')
@ApiBearerAuth()
@Controller('matches')
export class MatchmakingController {
  constructor(private readonly matchmaking: MatchmakingService) {}

  @Get('suggestions')
  suggestions(@CurrentUser('userId') userId: string, @Query() q: SuggestionsQueryDto) {
    return this.matchmaking.suggestions(userId, q.page, q.limit);
  }

  @Post('interest')
  sendInterest(@CurrentUser('userId') userId: string, @Body() dto: SendInterestDto) {
    return this.matchmaking.sendInterest(userId, dto.toUserId);
  }

  @Put(':id/accept')
  accept(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.matchmaking.respond(userId, id, true);
  }

  @Put(':id/reject')
  reject(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.matchmaking.respond(userId, id, false);
  }

  @Get('accepted')
  accepted(@CurrentUser('userId') userId: string) {
    return this.matchmaking.accepted(userId);
  }
}

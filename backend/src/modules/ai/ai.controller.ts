import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AiService } from './ai.service';
import {
  AssistantDto,
  BudgetInsightDto,
  MatchRecoQueryDto,
  VendorRecoQueryDto,
} from './dto/ai.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

@ApiTags('ai')
@ApiBearerAuth()
@RequirePermissions(Permission.AI_ASSIST)
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @ApiOperation({
    summary: 'The shortlist for a profile',
    description:
      'A steward passes the client they are browsing as. Without it this answered for the ' +
      'steward\'s own account, which for an agency means recommending marriages to the agency.',
  })
  @Get('recommendations/matches')
  matches(@CurrentUser() actor: AuthUser, @Query() q: MatchRecoQueryDto) {
    return this.ai.matchRecommendations(actor, q.profileId);
  }

  @Get('recommendations/vendors')
  vendors(@Query() q: VendorRecoQueryDto) {
    return this.ai.vendorRecommendations(q.category);
  }

  @Post('budget-insight')
  budget(@Body() dto: BudgetInsightDto) {
    return this.ai.budgetInsight(dto.totalBudget);
  }

  @Post('assistant')
  assistant(@Body() dto: AssistantDto) {
    return this.ai.assistant(dto.question);
  }
}

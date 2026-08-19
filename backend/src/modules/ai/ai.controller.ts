import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { AssistantDto, BudgetInsightDto, VendorRecoQueryDto } from './dto/ai.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

@ApiTags('ai')
@ApiBearerAuth()
@RequirePermissions(Permission.AI_ASSIST)
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('recommendations/matches')
  matches(@CurrentUser() actor: AuthUser) {
    return this.ai.matchRecommendations(actor);
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

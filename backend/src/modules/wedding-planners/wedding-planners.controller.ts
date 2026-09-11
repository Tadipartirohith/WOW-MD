import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WeddingPlannersService } from './wedding-planners.service';
import { PlannerSearchDto, UpsertPlannerProfileDto } from './dto/wedding-planner.dto';
import { PayoutAccountDto } from '../vendors/dto/vendor.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

@ApiTags('wedding-planners')
@Controller('wedding-planners')
export class WeddingPlannersController {
  constructor(private readonly planners: WeddingPlannersService) {}

  @Public()
  @Get('search')
  @ApiOperation({ summary: 'Browse approved wedding planners' })
  search(@Query() q: PlannerSearchDto) {
    return this.planners.search(q);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.PLANNER_LISTING_MANAGE)
  @Get('me')
  getOwn(@CurrentUser('userId') userId: string) {
    return this.planners.getOwn(userId);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.PLANNER_LISTING_MANAGE)
  @ApiOperation({ summary: 'Create or update your own planner listing' })
  @Put('me')
  upsertOwn(@CurrentUser('userId') userId: string, @Body() dto: UpsertPlannerProfileDto) {
    return this.planners.upsertOwn(userId, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.PLANNER_LISTING_MANAGE)
  @ApiOperation({
    summary: 'Where escrow pays out to',
    description:
      'The gateway linked account for this planner. Addressed as `me` rather than by id, like ' +
      'the rest of this controller: a planner has exactly one listing, so there is no id to get ' +
      'wrong and no other listing to aim at.',
  })
  @Put('me/payout-account')
  setPayoutAccount(@CurrentUser('userId') userId: string, @Body() dto: PayoutAccountDto) {
    return this.planners.setPayoutAccount(userId, dto.payoutAccountId);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.planners.findOne(id);
  }
}

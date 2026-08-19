import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WeddingPlannersService } from './wedding-planners.service';
import { PlannerSearchDto, UpsertPlannerProfileDto } from './dto/wedding-planner.dto';
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

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.planners.findOne(id);
  }
}

import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PlannerService } from './planner.service';
import {
  AddTaskDto,
  CreatePlanDto,
  EngagePlannerDto,
  UpdateTaskStatusDto,
} from './dto/planner.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

@ApiTags('planner')
@ApiBearerAuth()
@Controller('planner')
export class PlannerController {
  constructor(private readonly planner: PlannerService) {}

  @RequirePermissions(Permission.PLAN_MANAGE_OWN)
  @Post('plan')
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreatePlanDto) {
    return this.planner.createPlan(actor, dto);
  }

  /**
   * Reachable by hosts (PLAN_MANAGE_OWN) and by engaged planners
   * (PLAN_MANAGE_ENGAGED); the service decides what each caller actually sees.
   */
  @Get('plans')
  @ApiOperation({ summary: 'Plans you host, represent, or are engaged on' })
  myPlans(@CurrentUser() actor: AuthUser) {
    return this.planner.myPlans(actor);
  }

  @Get('plan/:id/timeline')
  timeline(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.planner.getTimeline(actor, id);
  }

  @Post('plan/:id/tasks')
  addTask(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddTaskDto,
  ) {
    return this.planner.addTask(actor, id, dto);
  }

  @Put('tasks/:id/status')
  updateStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskStatusDto,
  ) {
    return this.planner.updateTaskStatus(actor, id, dto.status);
  }

  @RequirePermissions(Permission.PLAN_MANAGE_OWN)
  @ApiOperation({ summary: 'Engage a wedding planner on this plan' })
  @Put('plan/:id/planner')
  engage(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EngagePlannerDto,
  ) {
    return this.planner.engagePlanner(actor, id, dto.plannerUserId);
  }

  @RequirePermissions(Permission.PLAN_MANAGE_OWN)
  @Delete('plan/:id/planner')
  release(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.planner.releasePlanner(actor, id);
  }
}

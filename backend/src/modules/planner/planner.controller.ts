import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PlannerService } from './planner.service';
import { AddTaskDto, CreatePlanDto, UpdateTaskStatusDto } from './dto/planner.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('planner')
@ApiBearerAuth()
@Controller('planner')
export class PlannerController {
  constructor(private readonly planner: PlannerService) {}

  @Post('plan')
  create(@CurrentUser('userId') userId: string, @Body() dto: CreatePlanDto) {
    return this.planner.createPlan(userId, dto);
  }

  @Get('plans')
  myPlans(@CurrentUser('userId') userId: string) {
    return this.planner.myPlans(userId);
  }

  @Get('plan/:id/timeline')
  timeline(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.planner.getTimeline(userId, id);
  }

  @Post('plan/:id/tasks')
  addTask(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddTaskDto,
  ) {
    return this.planner.addTask(userId, id, dto);
  }

  @Put('tasks/:id/status')
  updateStatus(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskStatusDto,
  ) {
    return this.planner.updateTaskStatus(userId, id, dto.status);
  }
}

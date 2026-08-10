import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WeddingPlan } from './entities/wedding-plan.entity';
import { PlanTask } from './entities/plan-task.entity';
import { AddTaskDto, CreatePlanDto } from './dto/planner.dto';
import { TaskStatus } from '../../common/enums';
import { DEFAULT_TIMELINE_TEMPLATE } from './timeline.template';

@Injectable()
export class PlannerService {
  constructor(
    @InjectRepository(WeddingPlan) private readonly plans: Repository<WeddingPlan>,
    @InjectRepository(PlanTask) private readonly tasks: Repository<PlanTask>,
  ) {}

  /** Creates a plan and auto-generates the timeline from the template. */
  async createPlan(userId: string, dto: CreatePlanDto): Promise<WeddingPlan> {
    const plan = await this.plans.save(
      this.plans.create({ userId, weddingDate: dto.weddingDate }),
    );

    const wedding = new Date(dto.weddingDate);
    const tasks = DEFAULT_TIMELINE_TEMPLATE.map((item) => {
      const due = new Date(wedding);
      due.setDate(due.getDate() - item.daysBefore);
      return this.tasks.create({
        planId: plan.id,
        title: item.title,
        category: item.category,
        dueDate: due.toISOString().slice(0, 10),
        status: TaskStatus.PENDING,
      });
    });
    await this.tasks.save(tasks);

    return this.getTimeline(userId, plan.id);
  }

  async getTimeline(userId: string, planId: string): Promise<WeddingPlan> {
    const plan = await this.plans.findOne({ where: { id: planId }, relations: ['tasks'] });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.userId !== userId) throw new ForbiddenException('Not your plan');
    plan.tasks.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
    return plan;
  }

  async myPlans(userId: string): Promise<WeddingPlan[]> {
    return this.plans.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async addTask(userId: string, planId: string, dto: AddTaskDto): Promise<PlanTask> {
    const plan = await this.plans.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.userId !== userId) throw new ForbiddenException('Not your plan');
    return this.tasks.save(
      this.tasks.create({
        planId,
        title: dto.title,
        category: dto.category,
        dueDate: dto.dueDate ?? null,
      }),
    );
  }

  async updateTaskStatus(userId: string, taskId: string, status: TaskStatus): Promise<PlanTask> {
    const task = await this.tasks.findOne({ where: { id: taskId }, relations: ['plan'] });
    if (!task) throw new NotFoundException('Task not found');
    if (task.plan.userId !== userId) throw new ForbiddenException('Not your task');
    task.status = status;
    return this.tasks.save(task);
  }
}

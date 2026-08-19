import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WeddingPlan } from './entities/wedding-plan.entity';
import { PlanTask } from './entities/plan-task.entity';
import { User } from '../auth/entities/user.entity';
import { AddTaskDto, CreatePlanDto } from './dto/planner.dto';
import { BookingStatus, ProviderType, TaskStatus, UserRole } from '../../common/enums';
import { DEFAULT_TIMELINE_TEMPLATE } from './timeline.template';
import { AgentsService } from '../agents/agents.service';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class PlannerService {
  constructor(
    @InjectRepository(WeddingPlan) private readonly plans: Repository<WeddingPlan>,
    @InjectRepository(PlanTask) private readonly tasks: Repository<PlanTask>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(PlannerProfile) private readonly plannerProfiles: Repository<PlannerProfile>,
    private readonly agents: AgentsService,
  ) {}

  /**
   * A plan is writable by its host, by the wedding planner engaged on it, by
   * the agent who represents the host, and by admins. Everyone else is refused.
   */
  private async assertCanManage(actor: AuthUser, plan: WeddingPlan): Promise<void> {
    if (actor.role === UserRole.ADMIN) return;
    if (plan.userId === actor.userId) return;
    if (plan.plannerUserId && plan.plannerUserId === actor.userId) return;
    if (actor.role === UserRole.AGENT) {
      await this.agents.assertManages(actor.userId, plan.userId);
      return;
    }
    throw new ForbiddenException('You do not have access to this plan');
  }

  private async loadOrFail(planId: string, withTasks = false): Promise<WeddingPlan> {
    const plan = await this.plans.findOne({
      where: { id: planId },
      relations: withTasks ? ['tasks'] : [],
    });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  /** Creates a plan and auto-generates the timeline from the template. */
  async createPlan(actor: AuthUser, dto: CreatePlanDto): Promise<WeddingPlan> {
    let hostUserId = actor.userId;
    if (dto.onBehalfOfUserId && dto.onBehalfOfUserId !== actor.userId) {
      if (actor.role !== UserRole.AGENT) {
        throw new ForbiddenException('Only agents can create a plan for another account');
      }
      await this.agents.assertManages(actor.userId, dto.onBehalfOfUserId);
      hostUserId = dto.onBehalfOfUserId;
    }

    const plan = await this.plans.save(
      this.plans.create({ userId: hostUserId, weddingDate: dto.weddingDate }),
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

    return this.getTimeline(actor, plan.id);
  }

  async getTimeline(actor: AuthUser, planId: string): Promise<WeddingPlan> {
    const plan = await this.loadOrFail(planId, true);
    await this.assertCanManage(actor, plan);
    plan.tasks.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
    return plan;
  }

  /**
   * Plans visible to the caller. A planner sees the weddings they are engaged
   * on; an agent sees their clients' plans; everyone else sees their own.
   */
  async myPlans(actor: AuthUser): Promise<WeddingPlan[]> {
    if (actor.role === UserRole.PLANNER) {
      return this.plans.find({
        where: { plannerUserId: actor.userId },
        order: { createdAt: 'DESC' },
      });
    }
    if (actor.role === UserRole.AGENT) {
      const clients = await this.users.find({
        where: { managedByAgentId: actor.userId },
        select: ['id'],
      });
      const ids = [actor.userId, ...clients.map((c) => c.id)];
      return this.plans
        .createQueryBuilder('p')
        .where('p."userId" IN (:...ids)', { ids })
        .orderBy('p."createdAt"', 'DESC')
        .getMany();
    }
    return this.plans.find({ where: { userId: actor.userId }, order: { createdAt: 'DESC' } });
  }

  async addTask(actor: AuthUser, planId: string, dto: AddTaskDto): Promise<PlanTask> {
    const plan = await this.loadOrFail(planId);
    await this.assertCanManage(actor, plan);
    return this.tasks.save(
      this.tasks.create({
        planId,
        title: dto.title,
        category: dto.category,
        dueDate: dto.dueDate ?? null,
      }),
    );
  }

  async updateTaskStatus(actor: AuthUser, taskId: string, status: TaskStatus): Promise<PlanTask> {
    const task = await this.tasks.findOne({ where: { id: taskId }, relations: ['plan'] });
    if (!task) throw new NotFoundException('Task not found');
    await this.assertCanManage(actor, task.plan);
    task.status = status;
    return this.tasks.save(task);
  }

  /**
   * The host (or their agent) engages a wedding planner, which is what grants
   * that planner write access to this plan. Only a PLANNER account qualifies.
   */
  async engagePlanner(
    actor: AuthUser,
    planId: string,
    plannerUserId: string,
  ): Promise<WeddingPlan> {
    const plan = await this.loadOrFail(planId);
    // Deliberately stricter than assertCanManage: an engaged planner must not
    // be able to replace themselves or add a peer.
    if (
      actor.role !== UserRole.ADMIN &&
      plan.userId !== actor.userId &&
      !(actor.role === UserRole.AGENT && (await this.canAgentManage(actor.userId, plan.userId)))
    ) {
      throw new ForbiddenException('Only the host can engage a planner');
    }

    const planner = await this.users.findOne({ where: { id: plannerUserId } });
    if (!planner || !planner.isActive) throw new NotFoundException('Planner not found');
    if (planner.role !== UserRole.PLANNER) {
      throw new BadRequestException('That account is not a wedding planner');
    }

    // Engagement must sit on a paid contract. Previously a host could hand any
    // approved planner write access to their plan with no booking at all, which
    // meant planner access existed outside the commercial model entirely.
    const booking = await this.findEngagementBooking(plan.userId, plannerUserId);
    if (!booking) {
      throw new BadRequestException(
        'Book this planner and have them confirm the booking before engaging them on a plan.',
      );
    }

    plan.plannerUserId = plannerUserId;
    plan.plannerBookingId = booking.id;
    return this.plans.save(plan);
  }

  async releasePlanner(actor: AuthUser, planId: string): Promise<WeddingPlan> {
    const plan = await this.loadOrFail(planId);
    if (actor.role !== UserRole.ADMIN && plan.userId !== actor.userId) {
      throw new ForbiddenException('Only the host can release a planner');
    }
    plan.plannerUserId = null;
    plan.plannerBookingId = null;
    return this.plans.save(plan);
  }

  /**
   * A confirmed or completed booking between the host and one of this planner's
   * listings. Cancelled and unpaid bookings do not grant access.
   */
  private async findEngagementBooking(
    hostUserId: string,
    plannerUserId: string,
  ): Promise<Booking | null> {
    const listings = await this.plannerProfiles.find({ where: { ownerUserId: plannerUserId } });
    if (listings.length === 0) return null;

    for (const status of [BookingStatus.CONFIRMED, BookingStatus.COMPLETED]) {
      const booking = await this.bookings.findOne({
        where: listings.map((l) => ({
          userId: hostUserId,
          providerType: ProviderType.PLANNER,
          providerId: l.id,
          status,
        })),
      });
      if (booking) return booking;
    }
    return null;
  }

  private async canAgentManage(agentId: string, clientId: string): Promise<boolean> {
    try {
      await this.agents.assertManages(agentId, clientId);
      return true;
    } catch {
      return false;
    }
  }
}

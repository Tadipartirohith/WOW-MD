import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PlannerService } from './planner.service';
import { WeddingPlan } from './entities/wedding-plan.entity';
import { PlanTask } from './entities/plan-task.entity';
import { User } from '../auth/entities/user.entity';
import { AgentsService } from '../agents/agents.service';
import { UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { DEFAULT_TIMELINE_TEMPLATE } from './timeline.template';

const host: AuthUser = {
  userId: 'u1',
  email: 'u1@example.com',
  role: UserRole.BRIDE,
  managedByAgentId: null,
};

describe('PlannerService.createPlan (auto timeline)', () => {
  let service: PlannerService;
  let savedTasks: PlanTask[] = [];

  const plansRepo = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'plan-1', ...x })),
    findOne: jest.fn(async () => ({ id: 'plan-1', userId: 'u1', tasks: savedTasks })),
  };
  const tasksRepo = {
    create: jest.fn((x) => x),
    save: jest.fn(async (arr) => {
      savedTasks = arr as PlanTask[];
      return savedTasks;
    }),
  };

  beforeEach(async () => {
    savedTasks = [];
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlannerService,
        { provide: getRepositoryToken(WeddingPlan), useValue: plansRepo },
        { provide: getRepositoryToken(PlanTask), useValue: tasksRepo },
        { provide: getRepositoryToken(User), useValue: { find: jest.fn(async () => []), findOne: jest.fn() } },
        { provide: AgentsService, useValue: { assertManages: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(PlannerService);
  });

  it('generates one task per template item, all dated before the wedding', async () => {
    const weddingDate = '2026-12-01';
    await service.createPlan(host, { weddingDate });

    expect(savedTasks).toHaveLength(DEFAULT_TIMELINE_TEMPLATE.length);
    for (const task of savedTasks) {
      expect(new Date(task.dueDate as string).getTime()).toBeLessThan(
        new Date(weddingDate).getTime(),
      );
    }
  });
});

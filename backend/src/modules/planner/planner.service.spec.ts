import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PlannerService } from './planner.service';
import { WeddingPlan } from './entities/wedding-plan.entity';
import { PlanTask } from './entities/plan-task.entity';
import { DEFAULT_TIMELINE_TEMPLATE } from './timeline.template';

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
      ],
    }).compile();
    service = moduleRef.get(PlannerService);
  });

  it('generates one task per template item, all dated before the wedding', async () => {
    const weddingDate = '2026-12-01';
    await service.createPlan('u1', { weddingDate });

    expect(savedTasks).toHaveLength(DEFAULT_TIMELINE_TEMPLATE.length);
    for (const task of savedTasks) {
      expect(new Date(task.dueDate as string).getTime()).toBeLessThan(
        new Date(weddingDate).getTime(),
      );
    }
  });
});

import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MatchmakingService } from './matchmaking.service';
import { Interest } from './entities/interest.entity';
import { CompatibilityEngine } from './compatibility.engine';
import { Profile } from '../users/entities/profile.entity';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import { ProfileShortlist } from './entities/shortlist.entity';
import { ProfileShare } from '../circulation/entities/profile-share.entity';
import { User } from '../auth/entities/user.entity';
import { AgentProfile } from '../agents/entities/agent-profile.entity';
import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../platform/redis/redis.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { Neo4jService } from '../../platform/neo4j/neo4j.service';
import { InterestStatus, ProfileVisibility, UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const agent: AuthUser = {
  userId: 'agent-1',
  email: 'agent@example.com',
  role: UserRole.AGENT,
  managedByAgentId: null,
};

const profile = (id: string, over: Partial<Profile> = {}): Profile =>
  ({
    id,
    userId: `${id}-user`,
    managedByUserId: null,
    displayName: `Profile ${id}`,
    gender: 'female',
    city: 'Hyderabad',
    dateOfBirth: '1998-04-02',
    photos: [`https://cdn.example.com/${id}-1.jpg`, `https://cdn.example.com/${id}-2.jpg`],
    visibility: ProfileVisibility.MATCHES_ONLY,
    bio: 'Written by them.',
    ...over,
  }) as Profile;

const interest = (
  id: string,
  fromProfileId: string,
  toProfileId: string,
  status: InterestStatus = InterestStatus.PENDING,
): Interest =>
  ({
    id,
    fromProfileId,
    toProfileId,
    status,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    updatedAt: new Date('2026-09-02T10:00:00Z'),
  }) as Interest;

/**
 * The agency-wide interest list (EZ1-I243).
 *
 * What is worth pinning down is not the grouping — it is a flat list — but the
 * two rules underneath it: that an agent is shown their own client in full and
 * the other family only as far as the interest has got, and that a row with the
 * agency on both ends is still one row.
 */
describe('MatchmakingService.agencyInterests', () => {
  let service: MatchmakingService;
  let clients: Profile[] = [];
  let others: Profile[] = [];
  let rows: Interest[] = [];

  const profilesRepo = {
    find: jest.fn(async (opts: { where?: { managedByUserId?: string } }) =>
      opts?.where && 'managedByUserId' in opts.where ? clients : others,
    ),
    findOne: jest.fn(async () => null),
  };
  const interestsRepo = { find: jest.fn(async () => rows) };
  const bare = { find: jest.fn(async () => []), findOne: jest.fn(async () => null) };

  beforeEach(async () => {
    jest.clearAllMocks();
    clients = [];
    others = [];
    rows = [];

    const moduleRef = await Test.createTestingModule({
      providers: [
        MatchmakingService,
        { provide: getRepositoryToken(Interest), useValue: interestsRepo },
        { provide: getRepositoryToken(Profile), useValue: profilesRepo },
        { provide: getRepositoryToken(ProfileDetails), useValue: bare },
        { provide: getRepositoryToken(ProfileShortlist), useValue: bare },
        { provide: getRepositoryToken(ProfileShare), useValue: bare },
        { provide: getRepositoryToken(User), useValue: bare },
        { provide: getRepositoryToken(AgentProfile), useValue: bare },
        { provide: CompatibilityEngine, useValue: {} as CompatibilityEngine },
        { provide: AppConfigService, useValue: {} as AppConfigService },
        { provide: RedisService, useValue: {} as RedisService },
        { provide: OutboxService, useValue: { record: jest.fn() } as unknown as OutboxService },
        { provide: Neo4jService, useValue: {} as Neo4jService },
      ],
    }).compile();
    service = moduleRef.get(MatchmakingService);
  });

  it('answers with nothing at all for an agency with no clients', async () => {
    const board = await service.agencyInterests(agent);
    expect(board.data).toEqual([]);
    expect(board.clients).toEqual([]);
    // No client profiles means no reason to read the interests table.
    expect(interestsRepo.find).not.toHaveBeenCalled();
  });

  it('returns both sides of every row, and which way it went', async () => {
    clients = [profile('c1', { managedByUserId: agent.userId })];
    others = [profile('x1')];
    rows = [interest('i1', 'c1', 'x1'), interest('i2', 'x1', 'c1')];

    const board = await service.agencyInterests(agent);

    expect(board.data).toHaveLength(2);
    const sent = board.data.find((row) => row.id === 'i1')!;
    expect(sent.direction).toBe('sent');
    expect(sent.from.id).toBe('c1');
    expect(sent.to.id).toBe('x1');

    const received = board.data.find((row) => row.id === 'i2')!;
    expect(received.direction).toBe('received');
    expect(received.from.id).toBe('x1');
    expect(received.to.id).toBe('c1');

    expect(board.counts.all).toBe(2);
    expect(board.counts.sent).toBe(1);
    expect(board.counts.received).toBe(1);
    expect(board.counts[InterestStatus.PENDING]).toBe(2);
  });

  /*
   * The rule that matters. An agent stewards their own client and sees
   * everything on them; a pending interest does not open the other family's
   * photographs or their written bio.
   */
  it('shows the client in full and the other side only as far as it has got', async () => {
    clients = [profile('c1', { managedByUserId: agent.userId })];
    others = [profile('x1')];
    rows = [interest('i1', 'c1', 'x1', InterestStatus.PENDING)];

    const [row] = (await service.agencyInterests(agent)).data;
    expect(row.from.matched).toBe(true);
    expect(row.from.photos).toHaveLength(2);
    expect(row.to.matched).toBe(false);
    expect(row.to.photos).toEqual([]);
    expect(row.to.bio).toBeUndefined();
  });

  it('opens the other side once the interest is accepted', async () => {
    clients = [profile('c1', { managedByUserId: agent.userId })];
    others = [profile('x1')];
    rows = [interest('i1', 'c1', 'x1', InterestStatus.ACCEPTED)];

    const [row] = (await service.agencyInterests(agent)).data;
    expect(row.to.matched).toBe(true);
    expect(row.to.photos).toHaveLength(2);
  });

  // One client asking about another is one interest, not two, and the agent
  // needs to be told that both ends are theirs.
  it('keeps an interest between two of its own clients as a single row', async () => {
    clients = [
      profile('c1', { managedByUserId: agent.userId }),
      profile('c2', { managedByUserId: agent.userId, gender: 'male' }),
    ];
    rows = [interest('i1', 'c1', 'c2')];

    const board = await service.agencyInterests(agent);
    expect(board.data).toHaveLength(1);
    expect(board.data[0].bothClients).toBe(true);
    // The sender's board is the one that would carry it: they are the side
    // that acted.
    expect(board.data[0].clientProfileId).toBe('c1');
    expect(board.data[0].direction).toBe('sent');
  });

  it('drops a row whose other side has been deleted rather than guessing at it', async () => {
    clients = [profile('c1', { managedByUserId: agent.userId })];
    others = [];
    rows = [interest('i1', 'c1', 'gone')];

    expect((await service.agencyInterests(agent)).data).toEqual([]);
  });
});

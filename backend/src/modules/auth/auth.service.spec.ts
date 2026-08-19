import { Test } from '@nestjs/testing';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { Profile } from '../users/entities/profile.entity';
import { AppConfigService } from '../../config/app-config.service';
import { AccountType, UserRole } from '../../common/enums';
import { RegisterDto } from './dto/auth.dto';

describe('AuthService', () => {
  let service: AuthService;
  const repo = {
    findOne: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'user-1', ...x })),
    update: jest.fn(),
  };
  const profileRepo = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'profile-1', ...x })),
    findOne: jest.fn(),
  };
  const jwt = {
    signAsync: jest.fn(async () => 'signed.jwt.token'),
    verifyAsync: jest.fn(),
  };
  const cfg = {
    auth: {
      bcryptRounds: 4,
      jwtSecret: 's',
      jwtExpiresIn: '15m',
      jwtRefreshSecret: 'r',
      jwtRefreshExpiresIn: '30d',
    },
  } as unknown as AppConfigService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: repo },
        { provide: getRepositoryToken(Profile), useValue: profileRepo },
        { provide: JwtService, useValue: jwt },
        { provide: AppConfigService, useValue: cfg },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  const individual = (over: Partial<RegisterDto> = {}): RegisterDto =>
    ({
      email: 'a@b.com',
      password: 'Password123',
      accountType: AccountType.INDIVIDUAL,
      role: UserRole.BRIDE,
      ...over,
    }) as RegisterDto;

  it('registers a new individual and returns tokens', async () => {
    repo.findOne.mockResolvedValueOnce(null);
    const result = await service.register(individual());
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.user.email).toBe('a@b.com');
    expect(result.user.role).toBe(UserRole.BRIDE);
    expect(result.user.managedByAgentId).toBeNull();
  });

  it('maps a vendor account type to the vendor role', async () => {
    repo.findOne.mockResolvedValueOnce(null);
    const result = await service.register(
      individual({ accountType: AccountType.VENDOR, role: undefined }),
    );
    expect(result.user.role).toBe(UserRole.VENDOR);
  });

  it('maps a planner account type to the planner role', async () => {
    repo.findOne.mockResolvedValueOnce(null);
    const result = await service.register(
      individual({ accountType: AccountType.PLANNER, role: undefined }),
    );
    expect(result.user.role).toBe(UserRole.PLANNER);
  });

  // The escalation that the original code allowed: role came straight off the
  // request body, so `role: 'admin'` minted an admin account.
  it('refuses to create an admin through self-registration', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(
      service.register(individual({ role: UserRole.ADMIN })),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      service.register(individual({ accountType: 'admin' as AccountType, role: undefined })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to create an agent or vendor via the individual role field', async () => {
    repo.findOne.mockResolvedValue(null);
    for (const role of [UserRole.AGENT, UserRole.VENDOR, UserRole.PLANNER]) {
      await expect(service.register(individual({ role }))).rejects.toBeInstanceOf(Error);
    }
  });

  it('stamps the agent id on an agent-created client', async () => {
    repo.findOne.mockResolvedValueOnce(null);
    const client = await service.createManagedClient('agent-9', {
      email: 'client@b.com',
      password: 'Password123',
      role: UserRole.GROOM,
      displayName: 'Client One',
    });
    expect(client.managedByAgentId).toBe('agent-9');
    expect(client.role).toBe(UserRole.GROOM);
    // A seeded profile makes the client immediately visible in matchmaking.
    expect(profileRepo.save).toHaveBeenCalled();
  });

  it('rejects duplicate email', async () => {
    repo.findOne.mockResolvedValueOnce({ id: 'existing' });
    await expect(service.register(individual())).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects login with wrong password', async () => {
    const passwordHash = await bcrypt.hash('correct', 4);
    repo.findOne.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.com',
      role: UserRole.BRIDE,
      passwordHash,
      isActive: true,
    });
    await expect(service.login({ email: 'a@b.com', password: 'wrong' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects login for a deactivated account', async () => {
    const passwordHash = await bcrypt.hash('correct', 4);
    repo.findOne.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.com',
      role: UserRole.BRIDE,
      passwordHash,
      isActive: false,
    });
    await expect(service.login({ email: 'a@b.com', password: 'correct' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('logs in with correct password', async () => {
    const passwordHash = await bcrypt.hash('correct', 4);
    repo.findOne.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.com',
      role: UserRole.BRIDE,
      passwordHash,
      isActive: true,
    });
    const result = await service.login({ email: 'a@b.com', password: 'correct' });
    expect(result.accessToken).toBeDefined();
    expect(result.user.permissions.length).toBeGreaterThan(0);
  });

  it('rejects a refresh token that does not verify', async () => {
    jwt.verifyAsync.mockRejectedValueOnce(new Error('bad signature'));
    await expect(service.refresh('tampered.token')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

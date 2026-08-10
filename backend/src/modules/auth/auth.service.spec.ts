import { Test } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { AppConfigService } from '../../config/app-config.service';
import { UserRole } from '../../common/enums';

describe('AuthService', () => {
  let service: AuthService;
  const repo = {
    findOne: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'user-1', ...x })),
    update: jest.fn(),
  };
  const jwt = { signAsync: jest.fn(async () => 'signed.jwt.token') };
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
        { provide: JwtService, useValue: jwt },
        { provide: AppConfigService, useValue: cfg },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('registers a new user and returns tokens', async () => {
    repo.findOne.mockResolvedValueOnce(null);
    const result = await service.register({
      email: 'a@b.com',
      password: 'password123',
      role: UserRole.BRIDE,
    });
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.user.email).toBe('a@b.com');
  });

  it('rejects duplicate email', async () => {
    repo.findOne.mockResolvedValueOnce({ id: 'existing' });
    await expect(
      service.register({ email: 'a@b.com', password: 'password123', role: UserRole.BRIDE }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects login with wrong password', async () => {
    const passwordHash = await bcrypt.hash('correct', 4);
    repo.findOne.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.com',
      role: UserRole.BRIDE,
      passwordHash,
    });
    await expect(service.login({ email: 'a@b.com', password: 'wrong' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('logs in with correct password', async () => {
    const passwordHash = await bcrypt.hash('correct', 4);
    repo.findOne.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.com',
      role: UserRole.BRIDE,
      passwordHash,
    });
    const result = await service.login({ email: 'a@b.com', password: 'correct' });
    expect(result.accessToken).toBeDefined();
  });
});

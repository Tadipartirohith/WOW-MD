import { Test } from '@nestjs/testing';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';
import { MfaRecoveryCode } from './entities/mfa-recovery-code.entity';
import { User } from './entities/user.entity';
import { EmailToken } from './entities/email-token.entity';
import { Profile } from '../users/entities/profile.entity';
import { AppConfigService } from '../../config/app-config.service';
import { MailService } from '../../platform/mail/mail.service';
import { AuditService } from '../../platform/audit/audit.service';
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
    // Every issued token stamps `lastActiveAt` on the profile, so the mock has
    // to answer `update` or the whole sign-in path throws.
    update: jest.fn(async () => ({ affected: 1 })),
  };
  const emailTokenRepo = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'tok-1', ...x })),
    findOne: jest.fn(),
  };
  /**
   * Recovery codes. Only the shape the service touches — nothing here exercises
   * them, so an empty `find` is the honest stub: no codes issued, none to spend.
   */
  const recoveryRepo = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => x),
    find: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    delete: jest.fn(async () => ({ affected: 0 })),
  };
  const jwt = {
    signAsync: jest.fn(async () => 'signed.jwt.token'),
    verifyAsync: jest.fn(),
    decode: jest.fn(() => ({ exp: Math.floor(Date.now() / 1000) + 2_592_000 })),
  };
  const sessions = {
    create: jest.fn(async () => ({ id: 'sess-1' })),
    rotate: jest.fn(async () => ({ id: 'sess-2' })),
    revokeAllForUser: jest.fn(),
    revokeByToken: jest.fn(),
  } as unknown as SessionsService;
  const mail = {
    sendEmailVerification: jest.fn(),
    sendPasswordReset: jest.fn(),
  } as unknown as MailService;
  const audit = { record: jest.fn() } as unknown as AuditService;

  const cfg = {
    auth: {
      bcryptRounds: 4,
      jwtSecret: 's',
      jwtExpiresIn: '15m',
      jwtRefreshSecret: 'r',
      jwtRefreshExpiresIn: '30d',
      maxFailedLogins: 3,
      lockoutMinutes: 15,
      emailVerifyTtlHours: 48,
      passwordResetTtlMinutes: 30,
      mfaIssuer: 'WOW',
      mfaRequiredForAdmin: true,
    },
    features: { individualUserEnabled: true },
  } as unknown as AppConfigService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: repo },
        { provide: getRepositoryToken(Profile), useValue: profileRepo },
        { provide: getRepositoryToken(EmailToken), useValue: emailTokenRepo },
        { provide: getRepositoryToken(MfaRecoveryCode), useValue: recoveryRepo },
        { provide: JwtService, useValue: jwt },
        { provide: AppConfigService, useValue: cfg },
        { provide: SessionsService, useValue: sessions },
        { provide: MailService, useValue: mail },
        { provide: AuditService, useValue: audit },
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

  describe('self-service registration (the solo-user path)', () => {
    it('registers a new individual and returns tokens', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      const result = await service.register(individual());
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.user.email).toBe('a@b.com');
      expect(result.user.role).toBe(UserRole.BRIDE);
      // A solo user is never tied to an agency.
      expect(result.user.managedByAgentId).toBeNull();
    });

    it('opens a session so the new account is signed in immediately', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await service.register(individual());
      expect(sessions.create).toHaveBeenCalled();
    });

    it('sends a verification email', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await service.register(individual({ displayName: 'Solo User' }));
      expect(mail.sendEmailVerification).toHaveBeenCalled();
    });

    it('maps vendor and planner account types to their roles', async () => {
      repo.findOne.mockResolvedValue(null);
      const vendor = await service.register(
        individual({ accountType: AccountType.VENDOR, role: undefined }),
      );
      expect(vendor.user.role).toBe(UserRole.VENDOR);

      const planner = await service.register(
        individual({ accountType: AccountType.PLANNER, role: undefined }),
      );
      expect(planner.user.role).toBe(UserRole.PLANNER);
    });

    // The escalation the original code allowed: role came straight off the
    // request body, so `role: 'admin'` minted an admin account.
    it('refuses to create an admin through self-registration', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.register(individual({ role: UserRole.ADMIN }))).rejects.toBeInstanceOf(
        Error,
      );
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

    it('rejects duplicate email', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 'existing' });
      await expect(service.register(individual())).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    const activeUser = async (over: Partial<User> = {}) => ({
      id: 'u1',
      email: 'a@b.com',
      role: UserRole.BRIDE,
      passwordHash: await bcrypt.hash('correct', 4),
      isActive: true,
      isVerified: true,
      mfaEnabled: false,
      mfaSecret: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      ...over,
    });

    it('signs in with the correct password', async () => {
      repo.findOne.mockResolvedValueOnce(await activeUser());
      const result = await service.login({ email: 'a@b.com', password: 'correct' });
      expect(result.accessToken).toBeDefined();
      expect(result.user.permissions.length).toBeGreaterThan(0);
    });

    it('rejects the wrong password', async () => {
      repo.findOne.mockResolvedValueOnce(await activeUser());
      await expect(service.login({ email: 'a@b.com', password: 'wrong' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('counts a failed attempt against the account', async () => {
      repo.findOne.mockResolvedValueOnce(await activeUser({ failedLoginAttempts: 0 }));
      await expect(service.login({ email: 'a@b.com', password: 'wrong' })).rejects.toThrow();
      expect(repo.update).toHaveBeenCalledWith('u1', { failedLoginAttempts: 1 });
    });

    it('locks the account once the attempt limit is reached', async () => {
      repo.findOne.mockResolvedValueOnce(await activeUser({ failedLoginAttempts: 2 }));
      await expect(service.login({ email: 'a@b.com', password: 'wrong' })).rejects.toThrow();
      const call = repo.update.mock.calls.at(-1);
      expect(call?.[1].lockedUntil).toBeInstanceOf(Date);
    });

    it('refuses a locked account even with the right password', async () => {
      repo.findOne.mockResolvedValueOnce(
        await activeUser({ lockedUntil: new Date(Date.now() + 600_000) }),
      );
      await expect(service.login({ email: 'a@b.com', password: 'correct' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses a deactivated account', async () => {
      repo.findOne.mockResolvedValueOnce(await activeUser({ isActive: false }));
      await expect(service.login({ email: 'a@b.com', password: 'correct' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('demands a TOTP code once two-factor is on', async () => {
      repo.findOne.mockResolvedValueOnce(
        await activeUser({ mfaEnabled: true, mfaSecret: 'JBSWY3DPEHPK3PXP' }),
      );
      await expect(service.login({ email: 'a@b.com', password: 'correct' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a wrong TOTP code', async () => {
      repo.findOne.mockResolvedValueOnce(
        await activeUser({ mfaEnabled: true, mfaSecret: 'JBSWY3DPEHPK3PXP' }),
      );
      await expect(
        service.login({ email: 'a@b.com', password: 'correct', mfaCode: '000000' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('does not reveal whether an email is registered', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.login({ email: 'nobody@b.com', password: 'whatever' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('password recovery', () => {
    it('reports success for an unknown address without sending mail', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.requestPasswordReset('nobody@b.com')).resolves.toEqual({ success: true });
      expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('sends a reset email for a live account', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com', isActive: true });
      await service.requestPasswordReset('a@b.com');
      expect(mail.sendPasswordReset).toHaveBeenCalled();
    });

    it('rejects an unknown or used reset token', async () => {
      emailTokenRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.resetPassword({ token: 'x'.repeat(24), password: 'Password123' }),
      ).rejects.toBeInstanceOf(Error);
    });

    it('rejects an expired reset token', async () => {
      emailTokenRepo.findOne.mockResolvedValueOnce({
        id: 't1',
        userId: 'u1',
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(
        service.resetPassword({ token: 'x'.repeat(24), password: 'Password123' }),
      ).rejects.toBeInstanceOf(Error);
    });

    it('signs every device out after a successful reset', async () => {
      emailTokenRepo.findOne.mockResolvedValueOnce({
        id: 't1',
        userId: 'u1',
        expiresAt: new Date(Date.now() + 600_000),
      });
      await service.resetPassword({ token: 'x'.repeat(24), password: 'Password123' });
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u1', 'password reset');
    });
  });

  describe('refresh', () => {
    it('rejects a token that does not verify', async () => {
      (jwt.verifyAsync as jest.Mock).mockRejectedValueOnce(new Error('bad signature'));
      await expect(service.refresh('tampered.token')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rotates the session on success', async () => {
      (jwt.verifyAsync as jest.Mock).mockResolvedValueOnce({ sub: 'u1' });
      repo.findOne.mockResolvedValueOnce({
        id: 'u1',
        email: 'a@b.com',
        role: UserRole.BRIDE,
        isActive: true,
        managedByAgentId: null,
        isVerified: true,
        mfaEnabled: false,
      });
      const result = await service.refresh('valid.token');
      expect(sessions.rotate).toHaveBeenCalled();
      expect(result.accessToken).toBeDefined();
    });

    it('refuses to refresh a deactivated account', async () => {
      (jwt.verifyAsync as jest.Mock).mockResolvedValueOnce({ sub: 'u1' });
      repo.findOne.mockResolvedValueOnce({ id: 'u1', isActive: false });
      await expect(service.refresh('valid.token')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});

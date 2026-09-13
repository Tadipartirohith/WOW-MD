import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { authenticator } from 'otplib';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';
import { MfaRecoveryCode } from './entities/mfa-recovery-code.entity';
import { User } from './entities/user.entity';
import { EmailToken } from './entities/email-token.entity';
import { Profile } from '../users/entities/profile.entity';
import { AgentProfile } from '../agents/entities/agent-profile.entity';
import { AppConfigService } from '../../config/app-config.service';
import { MailService } from '../../platform/mail/mail.service';
import { SmsService } from '../../platform/sms/sms.service';
import { PhoneVerificationService } from './phone-verification.service';
import { RedisService } from '../../platform/redis/redis.service';
import { AuditService } from '../../platform/audit/audit.service';
import { AccountType, ProfileClaimStatus, UserRole } from '../../common/enums';
import { RegisterDto, RegisterViaAgentLinkDto } from './dto/auth.dto';

describe('AuthService', () => {
  let service: AuthService;

  const repo = {
    findOne: jest.fn(),
    // Signing in by mobile number reads every account on that number, because
    // one number naming two accounts names neither (EZ1-I258).
    find: jest.fn(async () => [] as unknown[]),
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
  // Agency sign-up links (EZ1-I166). Nothing here exercises them, so the mock
  // only needs the shape the service touches on the paths under test.
  const agencyRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (x) => x),
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
  // The channel for an account taken on by mobile alone (EZ1-I233).
  const sms = { sendPasswordReset: jest.fn() } as unknown as SmsService;
  // The one-time codes behind signing in by mobile number (EZ1-I258). Nothing
  // in these tests takes that route; it is here because the service holds it.
  const phones = {
    requestLogin: jest.fn(async () => undefined),
    checkLogin: jest.fn(async () => ({ id: 'code-1' })),
    spend: jest.fn(async () => undefined),
  } as unknown as PhoneVerificationService;
  // The per-number counters behind the mobile sign-in limits, kept in a map.
  const counters = new Map<string, number>();
  const redis = {
    raw: {
      get: jest.fn(async (key: string) => (counters.has(key) ? String(counters.get(key)) : null)),
      incr: jest.fn(async (key: string) => {
        const next = (counters.get(key) ?? 0) + 1;
        counters.set(key, next);
        return next;
      }),
      expire: jest.fn(async () => 1),
      del: jest.fn(async (key: string) => (counters.delete(key) ? 1 : 0)),
    },
  } as unknown as RedisService;
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
    // How long a one-time code lives (EZ1-I258). Read even on the path that
    // sends nothing, because the answer must look the same either way.
    sms: { verificationTtlMinutes: 10, provider: 'log' },
  } as unknown as AppConfigService;

  beforeEach(async () => {
    jest.clearAllMocks();
    counters.clear();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: repo },
        { provide: getRepositoryToken(Profile), useValue: profileRepo },
        { provide: getRepositoryToken(EmailToken), useValue: emailTokenRepo },
        { provide: getRepositoryToken(MfaRecoveryCode), useValue: recoveryRepo },
        { provide: getRepositoryToken(AgentProfile), useValue: agencyRepo },
        { provide: JwtService, useValue: jwt },
        { provide: AppConfigService, useValue: cfg },
        { provide: SessionsService, useValue: sessions },
        { provide: MailService, useValue: mail },
        { provide: SmsService, useValue: sms },
        { provide: PhoneVerificationService, useValue: phones },
        { provide: RedisService, useValue: redis },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  const individual = (over: Partial<RegisterDto> = {}): RegisterDto =>
    ({
      email: 'a.tester@gmail.com',
      password: 'Password123',
      accountType: AccountType.INDIVIDUAL,
      role: UserRole.BRIDE,
      // Every portal but Admin signs in by number now, so a registration
      // without one would be creating an account with a sign-in route it can
      // never use (EZ1-I258).
      phone: '+919876543210',
      ...over,
    }) as RegisterDto;

  describe('self-service registration (the solo-user path)', () => {
    it('registers a new individual and returns tokens', async () => {
      // Twice: the address, then the number.
      repo.findOne.mockResolvedValue(null);
      const result = await service.register(individual());
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.user.email).toBe('a.tester@gmail.com');
      expect(result.user.role).toBe(UserRole.BRIDE);
      // A solo user is never tied to an agency.
      expect(result.user.managedByAgentId).toBeNull();
    });

    it('opens a session so the new account is signed in immediately', async () => {
      repo.findOne.mockResolvedValue(null);
      await service.register(individual());
      expect(sessions.create).toHaveBeenCalled();
    });

    it('sends a verification email', async () => {
      repo.findOne.mockResolvedValue(null);
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

  // A client who self-registers through an agency's shared link must land in
  // that agency's book (EZ1-I199): the account is tied to the agent, and so is
  // the profile — which is what the agent's My Clients list filters on.
  describe('registration through an agency sign-up link', () => {
    const viaLink = (over: Partial<RegisterViaAgentLinkDto> = {}): RegisterViaAgentLinkDto =>
      ({
        email: 'linked.client@gmail.com',
        password: 'Password123',
        accountType: AccountType.INDIVIDUAL,
        role: UserRole.BRIDE,
        displayName: 'Linked Client',
        phone: '9876543210',
        token: 'x'.repeat(24),
        ...over,
      }) as RegisterViaAgentLinkDto;

    it('ties both the account and the profile to the owning agent', async () => {
      agencyRepo.findOne.mockResolvedValueOnce({
        id: 'ag-1',
        ownerUserId: 'agent-1',
        isApproved: true,
        agencyName: 'Blissful Bonds',
      });
      repo.findOne.mockResolvedValueOnce(null); // no existing account for the email

      const result = await service.registerViaAgentLink(viaLink());

      // The account carries the agency link, the same as an accepted invitation.
      expect(result.user.managedByAgentId).toBe('agent-1');

      // The profile is stewarded by that agent and reads as claimed, so it shows
      // up under the agent's My Clients and the agent cannot overwrite biodata
      // its owner is editing.
      const savedProfile = profileRepo.save.mock.calls.at(-1)?.[0];
      expect(savedProfile.managedByUserId).toBe('agent-1');
      expect(savedProfile.claimStatus).toBe(ProfileClaimStatus.CLAIMED);
    });

    it('refuses a token that resolves to no approved agency', async () => {
      agencyRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.registerViaAgentLink(viaLink())).rejects.toBeInstanceOf(Error);
    });
  });

  describe('login', () => {
    const activeUser = async (over: Partial<User> = {}) => ({
      id: 'u1',
      email: 'a.tester@gmail.com',
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
      const result = await service.login({ email: 'a.tester@gmail.com', password: 'correct' });
      expect(result.accessToken).toBeDefined();
      expect(result.user.permissions.length).toBeGreaterThan(0);
    });

    it('rejects the wrong password', async () => {
      repo.findOne.mockResolvedValueOnce(await activeUser());
      await expect(service.login({ email: 'a.tester@gmail.com', password: 'wrong' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('counts a failed attempt against the account', async () => {
      repo.findOne.mockResolvedValueOnce(await activeUser({ failedLoginAttempts: 0 }));
      await expect(service.login({ email: 'a.tester@gmail.com', password: 'wrong' })).rejects.toThrow();
      expect(repo.update).toHaveBeenCalledWith('u1', { failedLoginAttempts: 1 });
    });

    it('locks the account once the attempt limit is reached', async () => {
      repo.findOne.mockResolvedValueOnce(await activeUser({ failedLoginAttempts: 2 }));
      await expect(service.login({ email: 'a.tester@gmail.com', password: 'wrong' })).rejects.toThrow();
      const call = repo.update.mock.calls.at(-1);
      expect(call?.[1].lockedUntil).toBeInstanceOf(Date);
    });

    it('refuses a locked account even with the right password', async () => {
      repo.findOne.mockResolvedValueOnce(
        await activeUser({ lockedUntil: new Date(Date.now() + 600_000) }),
      );
      await expect(service.login({ email: 'a.tester@gmail.com', password: 'correct' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses a deactivated account', async () => {
      repo.findOne.mockResolvedValueOnce(await activeUser({ isActive: false }));
      await expect(service.login({ email: 'a.tester@gmail.com', password: 'correct' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('demands a TOTP code once two-factor is on', async () => {
      repo.findOne.mockResolvedValueOnce(
        await activeUser({ mfaEnabled: true, mfaSecret: 'JBSWY3DPEHPK3PXP' }),
      );
      await expect(service.login({ email: 'a.tester@gmail.com', password: 'correct' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a wrong TOTP code', async () => {
      repo.findOne.mockResolvedValueOnce(
        await activeUser({ mfaEnabled: true, mfaSecret: 'JBSWY3DPEHPK3PXP' }),
      );
      await expect(
        service.login({ email: 'a.tester@gmail.com', password: 'correct', mfaCode: '000000' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('does not reveal whether an email is registered', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.login({ email: 'nobody@b.com', password: 'whatever' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  /**
   * Signing in with a mobile number and a one-time code (EZ1-I258).
   *
   * The rules worth pinning down are the ones that keep it as strong as the
   * password route: an administrator cannot take it, an ambiguous number signs
   * nobody in, the answer to "is this number registered" is the same either
   * way, and an account with two-factor on still needs its second factor.
   */
  describe('signing in by mobile number', () => {
    const onNumber = (over: Partial<User> = {}) =>
      ({
        id: 'u1',
        email: 'a.tester@gmail.com',
        phone: '+919876543210',
        role: UserRole.BRIDE,
        isActive: true,
        mfaEnabled: false,
        mfaSecret: null,
        phoneVerifiedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
        ...over,
      }) as User;
    const checkLogin = () => phones.checkLogin as jest.Mock;

    it('sends a code to a number that has an account', async () => {
      repo.find.mockResolvedValueOnce([onNumber()]);
      await service.requestMobileOtp('+919876543210');
      expect(phones.requestLogin).toHaveBeenCalledWith('u1', '+919876543210');
    });

    // The number is not a secret, so a different answer here would turn this
    // route into a way of asking whether somebody has an account.
    it('answers the same for a number with no account, and sends nothing', async () => {
      repo.find.mockResolvedValueOnce([]);
      const answer = await service.requestMobileOtp('+919000000000');
      expect(answer.sent).toBe(true);
      expect(phones.requestLogin).not.toHaveBeenCalled();
    });

    // In log mode the code used to come back here, which on a public route is
    // the account itself to anybody who knows the number.
    it('never puts anything but the generic answer in the response', async () => {
      repo.find.mockResolvedValueOnce([onNumber()]);
      const answer = await service.requestMobileOtp('+919876543210');
      expect(Object.keys(answer).sort()).toEqual(['expiresAt', 'sent']);
    });

    it('sends nothing to an administrator', async () => {
      repo.find.mockResolvedValueOnce([onNumber({ role: UserRole.ADMIN })]);
      const answer = await service.requestMobileOtp('+919876543210');
      expect(answer.sent).toBe(true);
      expect(phones.requestLogin).not.toHaveBeenCalled();
    });

    it('stops sending to one number after five an hour, however it is asked', async () => {
      // Five lookups; the sixth and seventh are refused before the lookup.
      for (let i = 0; i < 5; i += 1) repo.find.mockResolvedValueOnce([onNumber()]);
      for (let i = 0; i < 7; i += 1) await service.requestMobileOtp('+919876543210');
      expect(phones.requestLogin).toHaveBeenCalledTimes(5);
    });

    it('signs in and reaches the same account the password would', async () => {
      repo.find.mockResolvedValueOnce([onNumber()]);
      const result = await service.loginWithMobileOtp('+919876543210', '482910', undefined);
      expect(phones.checkLogin).toHaveBeenCalledWith('u1', '482910');
      expect(phones.spend).toHaveBeenCalled();
      expect(result.accessToken).toBeDefined();
      expect(result.user.role).toBe(UserRole.BRIDE);
      expect(result.user.permissions.length).toBeGreaterThan(0);
    });

    it('refuses an administrator, in the same words as a wrong code', async () => {
      repo.find.mockResolvedValueOnce([onNumber({ role: UserRole.ADMIN })]);
      await expect(
        service.loginWithMobileOtp('+919876543210', '482910', undefined),
      ).rejects.toMatchObject({ message: 'That code is not right' });
      expect(phones.checkLogin).not.toHaveBeenCalled();
    });

    // Any difference between these tells a stranger whether the number is
    // registered.
    it('refuses an expired code and an unknown number identically', async () => {
      repo.find.mockResolvedValueOnce([onNumber()]);
      checkLogin().mockRejectedValueOnce(
        new BadRequestException('That code has expired. Ask for a new one.'),
      );
      const expired = await service
        .loginWithMobileOtp('+919876543210', '000000', undefined)
        .catch((err: unknown) => err);
      repo.find.mockResolvedValueOnce([]);
      const unknown = await service
        .loginWithMobileOtp('+919000000000', '000000', undefined)
        .catch((err: unknown) => err);
      expect(expired).toBeInstanceOf(UnauthorizedException);
      expect(unknown).toBeInstanceOf(UnauthorizedException);
      expect((expired as Error).message).toBe((unknown as Error).message);
    });

    it('counts a wrong code against the account, as a wrong password is', async () => {
      repo.find.mockResolvedValueOnce([onNumber()]);
      checkLogin().mockRejectedValueOnce(new BadRequestException('That code is not right'));
      await expect(
        service.loginWithMobileOtp('+919876543210', '000000', undefined),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(repo.update).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ failedLoginAttempts: 1 }),
      );
      expect(phones.spend).not.toHaveBeenCalled();
    });

    it('stops looking at codes for a number after ten failures in the hour', async () => {
      for (let i = 0; i < 10; i += 1) {
        repo.find.mockResolvedValueOnce([]);
        await service.loginWithMobileOtp('+919000000001', '000000', undefined).catch(() => undefined);
      }
      repo.find.mockClear();
      await expect(
        service.loginWithMobileOtp('+919000000001', '000000', undefined),
      ).rejects.toMatchObject({ message: 'That code is not right' });
      expect(repo.find).not.toHaveBeenCalled();
    });

    // A number that names two accounts names neither. Those accounts still
    // have their addresses and passwords.
    it('signs nobody in on a number shared by two accounts', async () => {
      repo.find.mockResolvedValueOnce([onNumber(), onNumber({ id: 'u2' })]);
      await expect(
        service.loginWithMobileOtp('+919876543210', '482910', undefined),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuses a deactivated account once the code is proven', async () => {
      repo.find.mockResolvedValueOnce([onNumber({ isActive: false })]);
      await expect(
        service.loginWithMobileOtp('+919876543210', '482910', undefined),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('asks for the second factor without spending the code', async () => {
      repo.find.mockResolvedValueOnce([
        onNumber({ mfaEnabled: true, mfaSecret: 'JBSWY3DPEHPK3PXP' }),
      ]);
      await expect(
        service.loginWithMobileOtp('+919876543210', '482910', undefined),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(phones.spend).not.toHaveBeenCalled();
    });

    // The earlier version spent the code first and never loaded the secret, so
    // an account with two-factor on could not sign in this way at all.
    it('finishes with the same code and the authenticator code together', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      repo.find.mockResolvedValueOnce([onNumber({ mfaEnabled: true, mfaSecret: secret })]);
      const result = await service.loginWithMobileOtp(
        '+919876543210',
        '482910',
        authenticator.generate(secret),
      );
      expect(result.accessToken).toBeDefined();
      expect(phones.spend).toHaveBeenCalled();
    });

    // Signing in with the number is the same evidence the verification route
    // asks for, so an unconfirmed number is confirmed by using it.
    it('marks an unconfirmed number confirmed', async () => {
      repo.find.mockResolvedValueOnce([onNumber({ phoneVerifiedAt: null })]);
      await service.loginWithMobileOtp('+919876543210', '482910', undefined);
      expect(repo.update).toHaveBeenCalledWith('u1', { phoneVerifiedAt: expect.any(Date) });
    });
  });

  describe('password recovery', () => {
    it('reports success for an unknown address without sending mail', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.requestPasswordReset('nobody@b.com')).resolves.toEqual({ success: true });
      expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('sends a reset email for a live account', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 'u1', email: 'a.tester@gmail.com', isActive: true });
      await service.requestPasswordReset('a.tester@gmail.com');
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
        email: 'a.tester@gmail.com',
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

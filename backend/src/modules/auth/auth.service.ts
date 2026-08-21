import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID, randomInt } from 'crypto';
import { authenticator } from 'otplib';
import { User } from './entities/user.entity';
import { EmailToken } from './entities/email-token.entity';
import { Profile } from '../users/entities/profile.entity';
import { MfaRecoveryCode } from './entities/mfa-recovery-code.entity';
import {
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { AppConfigService } from '../../config/app-config.service';
import {
  ACCOUNT_TYPE_ROLE,
  AccountType,
  EmailTokenType,
  INDIVIDUAL_ROLES,
  OnboardingStage,
  ProfileClaimStatus,
  SELF_REGISTERABLE_ROLES,
  UserRole,
} from '../../common/enums';
import { permissionsFor } from '../../common/authz/permissions';
import { SessionContext, SessionsService } from './sessions.service';
import { MailService } from '../../platform/mail/mail.service';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { expiresIn, generateToken, hashToken } from '../../common/util/tokens';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  managedByAgentId: string | null;
  /**
   * Unique per token. Without it, two logins for the same account inside the
   * same second produce byte-identical JWTs (same claims, same `iat`), which
   * collides on the session table's unique token hash — and means a refresh
   * token is not actually unpredictable.
   */
  jti?: string;
  /** Issued-at in whole seconds, set by the signer. */
  iat?: number;
  /**
   * The account's token generation at the moment this was minted. A password
   * change bumps it, and every token carrying the old value stops working.
   */
  tv?: number;

  /**
   * Issued-at in milliseconds.
   *
   * The standard `iat` is whole seconds, which is too coarse to decide whether
   * a token was minted before or after a password change that happened in the
   * same second — and getting that comparison wrong means either a live token
   * surviving a "sign me out everywhere", or a freshly issued one being killed
   * on arrival.
   */
  iatMs?: number;
}

export interface AuthResult {
  user: {
    id: string;
    email: string;
    role: UserRole;
    managedByAgentId: string | null;
    isVerified: boolean;
    mfaEnabled: boolean;
    permissions: readonly string[];
    /**
     * True for an account the platform created after a Match Fixed. Until the
     * temporary password is replaced, every route except the password change
     * is refused, so the client should route straight to that screen.
     */
    mustResetPassword: boolean;
    onboardingStage: OnboardingStage;
  };
  accessToken: string;
  /** Also set as an httpOnly cookie by the controller. */
  refreshToken: string;
}

/** Thrown as a 401 body the client can branch on to prompt for a TOTP code. */
export const MFA_REQUIRED = 'MFA_REQUIRED';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(MfaRecoveryCode) private readonly recoveryCodes: Repository<MfaRecoveryCode>,
    @InjectRepository(EmailToken) private readonly emailTokens: Repository<EmailToken>,
    private readonly jwt: JwtService,
    private readonly cfg: AppConfigService,
    private readonly sessions: SessionsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- register

  /**
   * Resolves the sign-up form into a concrete role. ADMIN is unreachable here by
   * construction: INDIVIDUAL narrows to bride/groom/family, and every other
   * account type maps through ACCOUNT_TYPE_ROLE, which has no admin entry.
   */
  private resolveRole(dto: RegisterDto): UserRole {
    if (dto.accountType === AccountType.INDIVIDUAL) {
      // The Individual User flow is a business switch, not a code path: with it
      // off the platform is an agent-only brokerage and the only way onto it is
      // through an agency. Accounts created while it was on keep working.
      if (!this.cfg.features.individualUserEnabled) {
        throw new ForbiddenException(
          'Individual sign-up is closed at the moment. An agent can register you and send an invitation.',
        );
      }
      const role = dto.role;
      if (!role || !INDIVIDUAL_ROLES.includes(role)) {
        throw new BadRequestException(
          `An individual account requires role to be one of: ${INDIVIDUAL_ROLES.join(', ')}`,
        );
      }
      return role;
    }
    const role = ACCOUNT_TYPE_ROLE[dto.accountType];
    // Belt and braces: never issue a role outside the self-service allow-list.
    if (!role || !SELF_REGISTERABLE_ROLES.includes(role)) {
      throw new ForbiddenException('That account type cannot be self-registered');
    }
    return role;
  }

  /**
   * Self-service registration. This is the "solo user" path and stays fully
   * open: anyone can create their own account and sign in immediately, with or
   * without an agent ever being involved.
   */
  async register(dto: RegisterDto, ctx: SessionContext = {}): Promise<AuthResult> {
    const role = this.resolveRole(dto);

    const exists = await this.users.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, this.cfg.auth.bcryptRounds);
    const user = await this.users.save(
      this.users.create({
        email: dto.email,
        phone: dto.phone ?? null,
        passwordHash,
        role,
        managedByAgentId: null,
        isActive: true,
        isVerified: false,
      }),
    );

    if (dto.displayName) {
      await this.profiles.save(
        this.profiles.create({
          userId: user.id,
          displayName: dto.displayName,
          // Self-registered: nobody else manages this profile.
          claimStatus: ProfileClaimStatus.SELF,
          managedByUserId: null,
          contactEmail: user.email,
          contactPhone: dto.phone ?? null,
        }),
      );
    }

    await this.sendVerificationEmail(user, dto.displayName ?? dto.email);
    return this.issueTokens(user, ctx);
  }

  // ------------------------------------------------------------------- login

  async login(dto: LoginDto, ctx: SessionContext = {}): Promise<AuthResult> {
    const user = await this.users.findOne({
      where: { email: dto.email },
      select: [
        'id', 'email', 'role', 'passwordHash', 'isActive', 'managedByAgentId',
        'isVerified', 'mfaEnabled', 'mfaSecret', 'failedLoginAttempts', 'lockedUntil',
        'mustResetPassword', 'onboardingStage', 'tokenVersion',
      ],
    });

    // Compare against a dummy hash when the user is absent so the response time
    // does not reveal whether an email is registered.
    const hash =
      user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const passwordOk = await bcrypt.compare(dto.password, hash);

    if (!user || !passwordOk) {
      if (user) await this.registerFailedLogin(user, ctx);
      await this.audit.record({
        action: AuditAction.AUTH_LOGIN_FAILED,
        resourceType: 'user',
        resourceId: user?.id ?? null,
        metadata: { email: dto.email },
        ip: ctx.ip ?? null,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new ForbiddenException(
        `Too many failed attempts. Try again in ${minutes} minute(s), or reset your password.`,
      );
    }
    if (!user.isActive) throw new ForbiddenException('This account has been deactivated');

    // Two-factor, mandatory for admins once configured.
    const mfaRequired =
      user.mfaEnabled ||
      (user.role === UserRole.ADMIN && this.cfg.auth.mfaRequiredForAdmin && user.mfaEnabled);
    if (mfaRequired) {
      if (!dto.mfaCode) {
        throw new UnauthorizedException({
          message: 'An authentication code is required',
          code: MFA_REQUIRED,
        });
      }
      // A recovery code stands in for the authenticator. Checked first because
      // the two are distinguishable by shape, and a mistyped TOTP should not
      // burn a recovery code.
      const looksLikeRecovery = dto.mfaCode.replace(/[\s-]/g, '').length > 6;
      if (looksLikeRecovery) {
        if (await this.consumeRecoveryCode(user.id, dto.mfaCode)) {
          await this.audit.record({
            action: AuditAction.AUTH_MFA_RECOVERY_USED,
            actor: { userId: user.id, role: user.role },
            resourceType: 'user',
            resourceId: user.id,
          });
          return this.finishLogin(user, ctx);
        }
        throw new UnauthorizedException('That recovery code is not valid');
      }
      if (!this.verifyTotp(user.mfaSecret, dto.mfaCode)) {
        await this.registerFailedLogin(user, ctx);
        throw new UnauthorizedException('That authentication code is not valid');
      }
    }

    return this.finishLogin(user, ctx);
  }

  /** The last few steps of a successful sign-in, shared by both second factors. */
  private async finishLogin(user: User, ctx: SessionContext) {
    await this.clearLoginFailures(user.id);
    await this.audit.record({
      action: AuditAction.AUTH_LOGIN_SUCCEEDED,
      actor: { userId: user.id, role: user.role },
      resourceType: 'user',
      resourceId: user.id,
      ip: ctx.ip ?? null,
    });
    return this.issueTokens(user, ctx);
  }

  private async registerFailedLogin(user: User, ctx: SessionContext): Promise<void> {
    const attempts = (user.failedLoginAttempts ?? 0) + 1;
    const max = this.cfg.auth.maxFailedLogins;

    if (attempts >= max) {
      const lockedUntil = expiresIn(this.cfg.auth.lockoutMinutes * 60);
      await this.users.update(user.id, { failedLoginAttempts: attempts, lockedUntil });
      await this.audit.record({
        action: AuditAction.AUTH_ACCOUNT_LOCKED,
        resourceType: 'user',
        resourceId: user.id,
        metadata: { attempts, lockedUntil: lockedUntil.toISOString() },
        ip: ctx.ip ?? null,
      });
      return;
    }
    await this.users.update(user.id, { failedLoginAttempts: attempts });
  }

  private async clearLoginFailures(userId: string): Promise<void> {
    await this.users.update(userId, { failedLoginAttempts: 0, lockedUntil: null });
  }

  // ----------------------------------------------------------------- refresh

  /**
   * Refresh runs as a public route and authenticates the *refresh token
   * itself*, which is presented in an httpOnly cookie (or the body for
   * non-browser clients). Every call rotates the token; see SessionsService for
   * the reuse-detection rule.
   */
  async refresh(refreshToken: string, ctx: SessionContext = {}): Promise<AuthResult> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.cfg.auth.jwtRefreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.users.findOne({
      where: { id: payload.sub },
      select: [
        'id', 'email', 'role', 'isActive', 'managedByAgentId', 'isVerified', 'mfaEnabled',
        'mustResetPassword', 'onboardingStage', 'tokenVersion',
      ],
    });
    if (!user) throw new UnauthorizedException('Access denied');
    if (!user.isActive) throw new ForbiddenException('This account has been deactivated');

    const next = await this.mintRefreshToken(user);
    await this.sessions.rotate(user.id, refreshToken, next.token, next.expiresAt, ctx);

    return {
      user: this.publicUser(user),
      accessToken: await this.mintAccessToken(user),
      refreshToken: next.token,
    };
  }

  async logout(refreshToken?: string, userId?: string): Promise<{ success: true }> {
    if (refreshToken) await this.sessions.revokeByToken(refreshToken, 'logout');
    else if (userId) await this.sessions.revokeAllForUser(userId, 'logout');
    return { success: true };
  }

  async logoutEverywhere(userId: string): Promise<{ success: true }> {
    await this.sessions.revokeAllForUser(userId, 'logout all devices');
    return { success: true };
  }

  // ------------------------------------------------------- email verification

  async sendVerificationEmail(user: Pick<User, 'id' | 'email'>, name: string): Promise<void> {
    const { token, tokenHash } = generateToken();
    await this.emailTokens.save(
      this.emailTokens.create({
        userId: user.id,
        type: EmailTokenType.VERIFY_EMAIL,
        tokenHash,
        expiresAt: expiresIn(this.cfg.auth.emailVerifyTtlHours * 3600),
      }),
    );
    await this.mail.sendEmailVerification({ to: user.email, name, token });
  }

  async resendVerification(userId: string): Promise<{ success: true }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Account not found');
    if (user.isVerified) return { success: true };
    await this.sendVerificationEmail(user, user.email);
    return { success: true };
  }

  async verifyEmail(token: string): Promise<{ success: true }> {
    const record = await this.emailTokens.findOne({
      where: { tokenHash: hashToken(token), type: EmailTokenType.VERIFY_EMAIL, usedAt: IsNull() },
    });
    if (!record || record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('That verification link is invalid or has expired');
    }

    record.usedAt = new Date();
    await this.emailTokens.save(record);
    await this.users.update(record.userId, { isVerified: true, emailVerifiedAt: new Date() });
    await this.audit.record({
      action: AuditAction.AUTH_EMAIL_VERIFIED,
      resourceType: 'user',
      resourceId: record.userId,
    });
    return { success: true };
  }

  // -------------------------------------------------------- password recovery

  /**
   * Always reports success. Telling an anonymous caller whether an address is
   * registered is exactly the enumeration oracle the login path avoids.
   */
  async requestPasswordReset(email: string): Promise<{ success: true }> {
    const user = await this.users.findOne({ where: { email } });
    if (user && user.isActive) {
      const { token, tokenHash } = generateToken();
      await this.emailTokens.save(
        this.emailTokens.create({
          userId: user.id,
          type: EmailTokenType.RESET_PASSWORD,
          tokenHash,
          expiresAt: expiresIn(this.cfg.auth.passwordResetTtlMinutes * 60),
        }),
      );
      await this.mail.sendPasswordReset({ to: user.email, name: user.email, token });
    }
    return { success: true };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ success: true }> {
    const record = await this.emailTokens.findOne({
      where: {
        tokenHash: hashToken(dto.token),
        type: EmailTokenType.RESET_PASSWORD,
        usedAt: IsNull(),
      },
    });
    if (!record || record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('That reset link is invalid or has expired');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.cfg.auth.bcryptRounds);
    record.usedAt = new Date();
    await this.emailTokens.save(record);
    await this.users.update(record.userId, {
      passwordHash,
      passwordChangedAt: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null,
      // Retires every access token already in circulation for this account.
      tokenVersion: () => '"tokenVersion" + 1',
    });
    // A reset is the standard response to a suspected compromise, so drop every
    // existing session rather than leaving the attacker signed in.
    await this.sessions.revokeAllForUser(record.userId, 'password reset');
    await this.audit.record({
      action: AuditAction.AUTH_PASSWORD_RESET,
      resourceType: 'user',
      resourceId: record.userId,
    });
    return { success: true };
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ success: true }> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: ['id', 'passwordHash'],
    });
    if (!user) throw new NotFoundException('Account not found');

    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Your current password is not correct');

    const passwordHash = await bcrypt.hash(dto.newPassword, this.cfg.auth.bcryptRounds);
    // Clearing `mustResetPassword` here is what lifts the lock a provisioned
    // account starts under. Revoking the sessions immediately afterwards is
    // deliberate: the temporary credential was emailed in the clear, so the
    // session it opened is retired with it and the person signs in afresh.
    await this.users.update(userId, {
      passwordHash,
      passwordChangedAt: new Date(),
      mustResetPassword: false,
      // Retires every access token already in circulation for this account, so
      // "signed out everywhere" is true of the short-lived tokens as well as
      // the refresh sessions revoked just below.
      tokenVersion: () => '"tokenVersion" + 1',
    });
    await this.sessions.revokeAllForUser(userId, 'password changed');
    return { success: true };
  }

  // --------------------------------------------------------------------- MFA

  private verifyTotp(secret: string | null | undefined, code: string): boolean {
    if (!secret) return false;
    // One step of drift each way, so a slightly slow phone clock still works.
    authenticator.options = { window: 1 };
    try {
      return authenticator.verify({ token: code, secret });
    } catch {
      return false;
    }
  }

  /** Generates a secret and the otpauth:// URI for the authenticator app. */
  async beginMfaSetup(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Account not found');
    if (user.mfaEnabled) throw new ConflictException('Two-factor is already enabled');

    const secret = authenticator.generateSecret();
    // Stored but not yet enabled: MFA only turns on once a code is confirmed,
    // so a half-finished setup cannot lock anyone out.
    await this.users.update(userId, { mfaSecret: secret });
    return {
      secret,
      otpauthUrl: authenticator.keyuri(user.email, this.cfg.auth.mfaIssuer, secret),
    };
  }

  async confirmMfa(
    userId: string,
    code: string,
  ): Promise<{ success: true; recoveryCodes: string[] }> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: ['id', 'role', 'mfaSecret', 'mfaEnabled'],
    });
    if (!user?.mfaSecret) throw new BadRequestException('Start two-factor setup first');
    if (!this.verifyTotp(user.mfaSecret, code)) {
      throw new BadRequestException('That code is not valid, check your authenticator app');
    }

    await this.users.update(userId, { mfaEnabled: true });
    const recoveryCodes = await this.issueRecoveryCodes(userId);

    await this.audit.record({
      action: AuditAction.AUTH_MFA_ENABLED,
      actor: { userId, role: user.role },
      resourceType: 'user',
      resourceId: userId,
    });

    // Shown exactly once, at the only moment the plaintext exists. Storing them
    // retrievably would make them a second password sitting in the database.
    return { success: true, recoveryCodes };
  }

  /**
   * Ten single-use codes, replacing any that came before.
   *
   * Regenerating invalidates the old set on purpose: somebody asking for new
   * codes has usually just decided the old ones are compromised or lost, and
   * leaving both sets live would defeat the point of asking.
   */
  async issueRecoveryCodes(userId: string): Promise<string[]> {
    await this.recoveryCodes.delete({ userId });

    const codes = Array.from({ length: 10 }, () => this.formatRecoveryCode());
    await this.recoveryCodes.save(
      await Promise.all(
        codes.map(async (code) =>
          this.recoveryCodes.create({
            userId,
            codeHash: await bcrypt.hash(code, this.cfg.auth.bcryptRounds),
          }),
        ),
      ),
    );
    return codes;
  }

  /** Regenerate, for somebody who has used most of theirs or lost the list. */
  async regenerateRecoveryCodes(
    userId: string,
    password: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: ['id', 'role', 'passwordHash', 'mfaEnabled'],
    });
    if (!user) throw new NotFoundException('Account not found');
    if (!user.mfaEnabled) throw new BadRequestException('Two-factor is not enabled');

    // Password only — asking for a TOTP code here would defeat the purpose for
    // the person who has lost their authenticator and still has the password.
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Password is not correct');

    const recoveryCodes = await this.issueRecoveryCodes(userId);
    await this.audit.record({
      action: AuditAction.AUTH_MFA_RECOVERY_REGENERATED,
      actor: { userId, role: user.role },
      resourceType: 'user',
      resourceId: userId,
    });
    return { recoveryCodes };
  }

  /** How many are left, so somebody can be told before they run out. */
  async recoveryCodeCount(userId: string): Promise<{ remaining: number }> {
    return { remaining: await this.recoveryCodes.count({ where: { userId, usedAt: IsNull() } }) };
  }

  /**
   * Spends one recovery code, if it matches.
   *
   * Every unused code has to be compared, because only the hashes are stored —
   * there is nothing to look the code up by. Ten bcrypt comparisons is the
   * price of not keeping them readable, and this path is rare by definition.
   */
  private async consumeRecoveryCode(userId: string, candidate: string): Promise<boolean> {
    const normalised = candidate.replace(/[\s-]/g, '').toUpperCase();
    if (normalised.length < 8) return false;

    const outstanding = await this.recoveryCodes.find({ where: { userId, usedAt: IsNull() } });
    for (const code of outstanding) {
      if (await bcrypt.compare(normalised, code.codeHash)) {
        code.usedAt = new Date();
        await this.recoveryCodes.save(code);
        return true;
      }
    }
    return false;
  }

  /** Groups of four, which is what makes a printed code transcribable. */
  private formatRecoveryCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0 or I/1
    let out = '';
    for (let i = 0; i < 12; i += 1) out += alphabet[randomInt(0, alphabet.length)];
    return out;
  }

  async disableMfa(userId: string, password: string, code: string): Promise<{ success: true }> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: ['id', 'role', 'passwordHash', 'mfaSecret', 'mfaEnabled'],
    });
    if (!user) throw new NotFoundException('Account not found');
    if (!user.mfaEnabled) return { success: true };

    // Disabling 2FA weakens the account, so require both factors to do it.
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Password is not correct');
    if (!this.verifyTotp(user.mfaSecret, code)) {
      throw new BadRequestException('That code is not valid');
    }
    if (user.role === UserRole.ADMIN && this.cfg.auth.mfaRequiredForAdmin) {
      throw new ForbiddenException('Two-factor cannot be switched off on an administrator account');
    }

    await this.users.update(userId, { mfaEnabled: false, mfaSecret: null });
    await this.audit.record({
      action: AuditAction.AUTH_MFA_DISABLED,
      actor: { userId, role: user.role },
      resourceType: 'user',
      resourceId: userId,
    });
    return { success: true };
  }

  // ------------------------------------------------------------------ tokens

  /**
   * The signed-in account, as the client is allowed to see it.
   *
   * Distinct from `GET /users/me`, which returns the marriage *profile* — two
   * different records that a vendor makes obvious, since they have an account
   * and no profile at all.
   */
  async me(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Account not found');
    return {
      ...this.publicUser(user),
      phone: user.phone,
      phoneVerifiedAt: user.phoneVerifiedAt,
      createdAt: user.createdAt,
    };
  }

  private publicUser(
    user: Pick<User, 'id' | 'email' | 'role' | 'managedByAgentId' | 'isVerified' | 'mfaEnabled'> &
      Partial<Pick<User, 'mustResetPassword' | 'onboardingStage'>>,
  ) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      managedByAgentId: user.managedByAgentId ?? null,
      isVerified: Boolean(user.isVerified),
      mfaEnabled: Boolean(user.mfaEnabled),
      mustResetPassword: Boolean(user.mustResetPassword),
      onboardingStage: user.onboardingStage ?? OnboardingStage.PROFILE_INCOMPLETE,
      // The client mirrors these to hide navigation it cannot use. The server
      // re-checks on every request; this is a UX affordance, not a control.
      permissions: permissionsFor(user.role),
    };
  }

  private async mintAccessToken(
    user: Pick<User, 'id' | 'email' | 'role' | 'managedByAgentId'> &
      Partial<Pick<User, 'tokenVersion'>>,
  ): Promise<string> {
    return this.jwt.signAsync(
      {
        sub: user.id,
        tv: user.tokenVersion ?? 0,
        iatMs: Date.now(),
        email: user.email,
        role: user.role,
        managedByAgentId: user.managedByAgentId ?? null,
        jti: randomUUID(),
      },
      { secret: this.cfg.auth.jwtSecret, expiresIn: this.cfg.auth.jwtExpiresIn },
    );
  }

  private async mintRefreshToken(
    user: Pick<User, 'id' | 'email' | 'role' | 'managedByAgentId'>,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        managedByAgentId: user.managedByAgentId ?? null,
        jti: randomUUID(),
      },
      { secret: this.cfg.auth.jwtRefreshSecret, expiresIn: this.cfg.auth.jwtRefreshExpiresIn },
    );
    const decoded = this.jwt.decode(token) as { exp?: number } | null;
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : expiresIn(30 * 86_400);
    return { token, expiresAt };
  }

  /** Issues a fresh access token and opens a NEW session for this device. */
  async issueTokens(
    user: Pick<User, 'id' | 'email' | 'role' | 'managedByAgentId' | 'isVerified' | 'mfaEnabled'> &
      Partial<Pick<User, 'mustResetPassword' | 'onboardingStage' | 'tokenVersion'>>,
    ctx: SessionContext = {},
  ): Promise<AuthResult> {
    const refresh = await this.mintRefreshToken(user);
    await this.sessions.create(user.id, refresh.token, refresh.expiresAt, ctx);
    return {
      user: this.publicUser(user),
      accessToken: await this.mintAccessToken(user),
      refreshToken: refresh.token,
    };
  }
}

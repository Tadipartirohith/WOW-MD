import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { User } from './entities/user.entity';
import { Profile } from '../users/entities/profile.entity';
import { CreateClientDto, LoginDto, RegisterDto } from './dto/auth.dto';
import { AppConfigService } from '../../config/app-config.service';
import {
  ACCOUNT_TYPE_ROLE,
  AccountType,
  INDIVIDUAL_ROLES,
  SELF_REGISTERABLE_ROLES,
  UserRole,
} from '../../common/enums';
import { permissionsFor } from '../../common/authz/permissions';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  managedByAgentId: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly jwt: JwtService,
    private readonly cfg: AppConfigService,
  ) {}

  /**
   * Resolves the sign-up form into a concrete role. ADMIN is unreachable here by
   * construction: INDIVIDUAL narrows to bride/groom/family, and every other
   * account type maps through ACCOUNT_TYPE_ROLE, which has no admin entry.
   */
  private resolveRole(dto: RegisterDto): UserRole {
    if (dto.accountType === AccountType.INDIVIDUAL) {
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

  async register(dto: RegisterDto) {
    const role = this.resolveRole(dto);
    const user = await this.createUser({
      email: dto.email,
      password: dto.password,
      role,
      displayName: dto.displayName,
      managedByAgentId: null,
    });
    return this.issueTokens(user);
  }

  /**
   * Agent-driven onboarding. The created account carries the agent's id in
   * `managedByAgentId` so every downstream read can scope to that agent's book
   * of business. Returns the user record rather than tokens: the agent must not
   * receive credentials that let them impersonate the client's session.
   */
  async createManagedClient(agentId: string, dto: CreateClientDto): Promise<User> {
    const user = await this.createUser({
      email: dto.email,
      password: dto.password,
      role: dto.role,
      displayName: dto.displayName,
      city: dto.city,
      managedByAgentId: agentId,
    });
    return user;
  }

  private async createUser(input: {
    email: string;
    password: string;
    role: UserRole;
    displayName?: string;
    city?: string;
    managedByAgentId: string | null;
  }): Promise<User> {
    const exists = await this.users.findOne({ where: { email: input.email } });
    if (exists) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(input.password, this.cfg.auth.bcryptRounds);
    const user = await this.users.save(
      this.users.create({
        email: input.email,
        passwordHash,
        role: input.role,
        managedByAgentId: input.managedByAgentId,
        isActive: true,
      }),
    );

    // Seed a minimal profile so the account is immediately addressable in
    // listings and matchmaking instead of 404-ing until first edit.
    if (input.displayName) {
      await this.profiles.save(
        this.profiles.create({
          userId: user.id,
          displayName: input.displayName,
          city: input.city,
        }),
      );
    }
    return user;
  }

  async login(dto: LoginDto) {
    const user = await this.users.findOne({
      where: { email: dto.email },
      select: ['id', 'email', 'role', 'passwordHash', 'isActive', 'managedByAgentId'],
    });
    // Compare against a dummy hash when the user is absent so the response time
    // does not reveal whether an email is registered.
    const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const ok = await bcrypt.compare(dto.password, hash);
    if (!user || !ok) throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive) throw new ForbiddenException('This account has been deactivated');

    return this.issueTokens(user);
  }

  /**
   * Refresh runs as a public route and authenticates the *refresh token itself*.
   * Previously it sat behind the access-token guard, which made it unusable the
   * moment the access token expired, i.e. exactly when it is needed.
   */
  async refresh(refreshToken: string) {
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
      select: ['id', 'email', 'role', 'refreshTokenHash', 'isActive', 'managedByAgentId'],
    });
    if (!user || !user.refreshTokenHash) throw new UnauthorizedException('Access denied');
    if (!user.isActive) throw new ForbiddenException('This account has been deactivated');

    const ok = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!ok) throw new UnauthorizedException('Access denied');

    return this.issueTokens(user);
  }

  async logout(userId: string) {
    await this.users.update(userId, { refreshTokenHash: null });
    return { success: true };
  }

  private async issueTokens(
    user: Pick<User, 'id' | 'email' | 'role' | 'managedByAgentId'>,
  ) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      managedByAgentId: user.managedByAgentId ?? null,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.cfg.auth.jwtSecret,
      expiresIn: this.cfg.auth.jwtExpiresIn,
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: this.cfg.auth.jwtRefreshSecret,
      expiresIn: this.cfg.auth.jwtRefreshExpiresIn,
    });
    const refreshTokenHash = await bcrypt.hash(refreshToken, this.cfg.auth.bcryptRounds);
    await this.users.update(user.id, { refreshTokenHash });

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        managedByAgentId: user.managedByAgentId ?? null,
        // The client mirrors these to hide navigation it cannot use. The server
        // re-checks on every request; this is a UX affordance, not a control.
        permissions: permissionsFor(user.role),
      },
      accessToken,
      refreshToken,
    };
  }
}

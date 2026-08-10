import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { User } from './entities/user.entity';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { AppConfigService } from '../../config/app-config.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly cfg: AppConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.users.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, this.cfg.auth.bcryptRounds);
    const user = await this.users.save(
      this.users.create({ email: dto.email, passwordHash, role: dto.role }),
    );
    return this.issueTokens(user);
  }

  async login(dto: LoginDto) {
    const user = await this.users.findOne({
      where: { email: dto.email },
      select: ['id', 'email', 'role', 'passwordHash'],
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(user);
  }

  async refresh(userId: string, refreshToken: string) {
    const user = await this.users.findOne({
      where: { id: userId },
      select: ['id', 'email', 'role', 'refreshTokenHash'],
    });
    if (!user || !user.refreshTokenHash) throw new UnauthorizedException('Access denied');

    const ok = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!ok) throw new UnauthorizedException('Access denied');

    return this.issueTokens(user);
  }

  async logout(userId: string) {
    await this.users.update(userId, { refreshTokenHash: null });
    return { success: true };
  }

  private async issueTokens(user: Pick<User, 'id' | 'email' | 'role'>) {
    const payload = { sub: user.id, email: user.email, role: user.role };
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
      user: { id: user.id, email: user.email, role: user.role },
      accessToken,
      refreshToken,
    };
  }
}

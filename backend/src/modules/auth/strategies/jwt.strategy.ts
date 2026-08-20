import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../../../config/app-config.service';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { User } from '../entities/user.entity';
import { JwtPayload } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    cfg: AppConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.auth.jwtSecret,
    });
  }

  /**
   * Re-reads role and status from the database rather than trusting the token
   * body. Without this, a role change or a deactivation would not take effect
   * until every outstanding access token expired.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.users.findOne({
      where: { id: payload.sub },
      select: [
        'id', 'email', 'role', 'isActive', 'managedByAgentId', 'mustResetPassword',
        'tokenVersion',
      ],
    });
    if (!user) throw new UnauthorizedException('Account no longer exists');
    if (!user.isActive) throw new ForbiddenException('This account has been deactivated');

    // Changing a password revokes the refresh sessions, but an access token
    // already in someone's hands would otherwise keep working for its full
    // life. The account's token generation is minted into every token, so one
    // carrying a superseded value is refused — which is the difference between
    // "signed out everywhere" meaning something and being a comforting phrase.
    //
    // A counter rather than a timestamp comparison: two independently sampled
    // clocks only have to disagree once for a revoked token to survive.
    if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      throw new UnauthorizedException('Your password changed. Please sign in again.');
    }

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      managedByAgentId: user.managedByAgentId ?? null,
      mustResetPassword: Boolean(user.mustResetPassword),
    };
  }
}

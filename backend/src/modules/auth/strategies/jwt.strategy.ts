import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../../../config/app-config.service';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(cfg: AppConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.auth.jwtSecret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    return { userId: payload.sub, email: payload.email, role: payload.role };
  }
}

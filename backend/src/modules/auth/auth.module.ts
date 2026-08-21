import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { User } from './entities/user.entity';
import { RefreshSession } from './entities/refresh-session.entity';
import { EmailToken } from './entities/email-token.entity';
import { Profile } from '../users/entities/profile.entity';
import { InvitationsModule } from '../invitations/invitations.module';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';
import { AuthController } from './auth.controller';
import { PhoneVerification } from './entities/phone-verification.entity';
import { MfaRecoveryCode } from './entities/mfa-recovery-code.entity';
import { PhoneVerificationService } from './phone-verification.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshSession, EmailToken, Profile, PhoneVerification, MfaRecoveryCode]),
    PassportModule,
    JwtModule.register({}),
    InvitationsModule,
  ],
  providers: [AuthService, SessionsService, JwtStrategy, PhoneVerificationService],
  controllers: [AuthController],
  exports: [TypeOrmModule, AuthService, SessionsService, PhoneVerificationService],
})
export class AuthModule {}

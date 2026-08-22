import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfileDetails } from './entities/profile-details.entity';
import { ProfileSibling } from './entities/profile-sibling.entity';
import { ProfileAsset } from './entities/profile-asset.entity';
import { IdentityOtpSession } from './entities/identity-otp-session.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { ProfileDetailsService } from './profile-details.service';
import { ProfileDetailsController } from './profile-details.controller';
import { AadhaarService } from './aadhaar.service';
import { AadhaarController } from './aadhaar.controller';
import {
  LicensedAadhaarProvider,
  MockAadhaarProvider,
  aadhaarProviderFactory,
} from './aadhaar.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProfileDetails,
      ProfileSibling,
      ProfileAsset,
      IdentityOtpSession,
      Profile,
      User,
    ]),
  ],
  providers: [
    ProfileDetailsService,
    AadhaarService,
    MockAadhaarProvider,
    LicensedAadhaarProvider,
    aadhaarProviderFactory,
  ],
  controllers: [ProfileDetailsController, AadhaarController],
  exports: [ProfileDetailsService],
})
export class ProfileDetailsModule {}

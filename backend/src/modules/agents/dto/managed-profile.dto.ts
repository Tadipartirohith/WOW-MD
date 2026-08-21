import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsDefined,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ConsentMethod,
  ConsentRelation,
  ProfileClaimStatus,
  ProfileVisibility,
} from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { PreferencesDto } from '../../users/dto/profile.dto';
import { normaliseEmail } from '../../auth/dto/auth.dto';
import {
  MOBILE_MESSAGE,
  MOBILE_PATTERN,
  normaliseMobile,
} from '../../../common/util/identity-fields';

/**
 * How the family gave permission, captured at intake.
 *
 * Required, not optional. A walk-in family hands over their details verbally;
 * without a record of who agreed to what and when, the platform is holding a
 * real person's name, photograph and phone number on nothing but trust.
 */
export class IntakeConsentDto {
  @ApiProperty({ enum: ConsentMethod, example: ConsentMethod.IN_PERSON })
  @IsEnum(ConsentMethod)
  method: ConsentMethod;

  @ApiProperty({
    enum: ConsentRelation,
    description: 'Who gave it — frequently a parent rather than the subject.',
  })
  @IsEnum(ConsentRelation)
  givenByRelation: ConsentRelation;

  @ApiProperty({ example: 'Ramesh Sharma', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  givenByName: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @Transform(normaliseMobile)
  @Matches(MOBILE_PATTERN, { message: MOBILE_MESSAGE })
  givenByPhone?: string;

  @ApiProperty({ format: 'date', example: '2026-08-12' })
  @IsDateString({}, { message: 'givenAt must be a date, e.g. 2026-08-12' })
  givenAt: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /**
   * Whether they also agreed to the profile being passed outside the agency.
   * Separate on purpose: agreeing to the agency holding your details is not
   * agreeing to them circulating them.
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allowsCirculation?: boolean;
}

/**
 * A profile a steward builds for somebody else.
 *
 * Mobile is mandatory; email is not. A family walking into an agency hands over
 * a phone number far more often than an email address, and many clients never
 * want a login at all — the agent is their whole interface. Email is only
 * needed if and when they are invited to claim the profile.
 */
export class CreateManagedProfileDto {
  @ApiProperty({ example: 'Priya Sharma', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName: string;

  @ApiProperty({
    example: '+919876543210',
    description: 'The primary way to reach this family. Required.',
  })
  @Transform(normaliseMobile)
  @Matches(MOBILE_PATTERN, { message: MOBILE_MESSAGE })
  contactPhone: string;

  @ApiPropertyOptional({
    example: 'priya@example.com',
    description: 'Optional. Only needed to invite them to claim the profile later.',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address, or leave it blank' })
  @MaxLength(254)
  @Transform(normaliseEmail)
  contactEmail?: string;

  /**
   * @IsDefined is load-bearing: @ValidateNested on its own passes when the
   * property is absent entirely, so a request with no consent block reached the
   * service and crashed rather than being refused.
   */
  @ApiProperty({ type: IntakeConsentDto })
  @IsDefined({ message: 'Record how the family gave consent before saving the profile' })
  @ValidateNested()
  @Type(() => IntakeConsentDto)
  consent: IntakeConsentDto;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  gender?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 20, description: 'Absolute media URLs' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({ require_protocol: true }, { each: true })
  @MaxLength(2048, { each: true })
  photos?: string[];

  @ApiPropertyOptional({ type: PreferencesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PreferencesDto)
  preferences?: PreferencesDto;

  @ApiPropertyOptional({ enum: ProfileVisibility })
  @IsOptional()
  @IsEnum(ProfileVisibility)
  visibility?: ProfileVisibility;

  /** Send the invitation straight away instead of saving a draft. */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  inviteNow?: boolean;
}

/**
 * Contact details stay editable while the profile is unclaimed. Once the
 * subject owns it, the service refuses edits entirely — see
 * ManagedProfilesService.update.
 *
 * Consent is deliberately NOT editable here: changing what a family agreed to
 * is not an edit, it is a new consent record (POST /circulation/profiles/:id/consent).
 */
export class UpdateManagedProfileDto extends OmitType(PartialType(CreateManagedProfileDto), [
  'consent',
] as const) {}

export class ManagedProfileSearchDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Free-text match on name, email or city' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ enum: ProfileClaimStatus })
  @IsOptional()
  @IsEnum(ProfileClaimStatus)
  claimStatus?: ProfileClaimStatus;
}

export class AddProfilePhotoDto {
  @ApiProperty({ maxLength: 2048 })
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  url: string;
}

/** The agent's note when asking somebody to take a profile built for them. */
export class RequestProfileClaimDto {
  @ApiPropertyOptional({
    maxLength: 500,
    description: 'Context that helps them recognise you — where you met, when.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

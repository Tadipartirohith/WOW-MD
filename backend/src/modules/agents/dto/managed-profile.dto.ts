import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProfileClaimStatus, ProfileVisibility } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { PreferencesDto } from '../../users/dto/profile.dto';
import { PHONE_MESSAGE, PHONE_PATTERN, normaliseEmail } from '../../auth/dto/auth.dto';

const normalisePhone = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value;

/**
 * A profile a steward builds for somebody else.
 *
 * Contact email and mobile are mandatory: they are the only route from this
 * profile to a real account, and an agent who cannot reach the subject has
 * built a profile nobody can ever claim.
 */
export class CreateManagedProfileDto {
  @ApiProperty({ example: 'Priya Sharma', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName: string;

  @ApiProperty({ example: 'priya@example.com', description: 'Where the invitation is sent' })
  @IsEmail({}, { message: 'A valid email address is required to invite this person later' })
  @MaxLength(254)
  @Transform(normaliseEmail)
  contactEmail: string;

  @ApiProperty({ example: '+919876543210' })
  @Transform(normalisePhone)
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  contactPhone: string;

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
 */
export class UpdateManagedProfileDto extends PartialType(CreateManagedProfileDto) {}

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

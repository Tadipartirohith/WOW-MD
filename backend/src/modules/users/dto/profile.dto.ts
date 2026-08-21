import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ProfileVisibility } from '../../../common/enums';
import { MOBILE_PATTERN, NAME_PATTERN, normaliseMobile } from '../../../common/util/identity-fields';

export class PreferencesDto {
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional() @IsString() @MaxLength(60)
  religion?: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional() @IsString() @MaxLength(60)
  community?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional() @IsString() @MaxLength(80)
  education?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 20 })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true })
  lifestyle?: string[];

  @ApiPropertyOptional({ minimum: 18, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(18) @Max(100)
  preferredAgeMin?: number;

  @ApiPropertyOptional({ minimum: 18, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(18) @Max(100)
  preferredAgeMax?: number;

  @ApiPropertyOptional({ type: [String], maxItems: 25 })
  @IsOptional() @IsArray() @ArrayMaxSize(25) @IsString({ each: true }) @MaxLength(80, { each: true })
  preferredLocations?: string[];
}

export class CreateProfileDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Matches(NAME_PATTERN, { message: 'A name may only contain letters and spaces' })
  displayName: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional() @IsString() @MaxLength(30)
  gender?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional() @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional() @IsString() @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500)
  address?: string;

  /**
   * A second number to reach them on — very often the family's landline or a
   * parent's mobile, which is the number that actually gets answered.
   */
  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @Transform(normaliseMobile)
  @Matches(MOBILE_PATTERN, { message: 'Enter a valid Indian mobile number' })
  contactPhone?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional() @IsString() @MaxLength(2000)
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
}

export class UpdateProfileDto extends PartialType(CreateProfileDto) {}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { MaritalStatus, OccupationStatus } from '../../../common/enums';

/**
 * Which profile the caller is acting as.
 *
 * Individuals normally omit it and act as themselves. Agents and family members
 * pass the managed profile's id — including profiles whose subject has no
 * account yet. GET /agents/profiles/actable lists the valid values.
 */
class ActingProfileDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Profile to act as. Required for agents; optional for everyone else.',
  })
  @IsOptional()
  @IsUUID('4')
  profileId?: string;
}

export class SendInterestDto extends ActingProfileDto {
  @ApiProperty({ format: 'uuid', description: 'The profile being approached' })
  @IsUUID('4')
  toProfileId: string;
}

/**
 * How a family actually narrows a shortlist.
 *
 * Every field is optional and they compose: a filter nobody sets costs nothing,
 * and the ones that are set are ANDed. All of these are indexed columns rather
 * than free text over a jsonb blob, so a search that reads naturally to the
 * person typing it is also one the database can answer.
 */
export class SuggestionsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  profileId?: string;

  @ApiPropertyOptional({ minimum: 18, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(18) @Max(100)
  ageMin?: number;

  @ApiPropertyOptional({ minimum: 18, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(18) @Max(100)
  ageMax?: number;

  @ApiPropertyOptional({ minimum: 120, maximum: 230, description: 'Centimetres' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(120) @Max(230)
  heightMinCm?: number;

  @ApiPropertyOptional({ minimum: 120, maximum: 230, description: 'Centimetres' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(120) @Max(230)
  heightMaxCm?: number;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional() @IsString() @MaxLength(60)
  religion?: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional() @IsString() @MaxLength(60)
  caste?: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional() @IsString() @MaxLength(60)
  motherTongue?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional() @IsString() @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional() @IsString() @MaxLength(120)
  qualification?: string;

  @ApiPropertyOptional({ enum: MaritalStatus })
  @IsOptional() @IsEnum(MaritalStatus)
  maritalStatus?: MaritalStatus;

  @ApiPropertyOptional({ enum: OccupationStatus })
  @IsOptional() @IsEnum(OccupationStatus)
  occupationStatus?: OccupationStatus;

  /**
   * Floor on the compatibility score, as a percentage.
   *
   * This is the control behind "recommended matches": set it to 50 and the list
   * is only profiles the engine actually rates, rather than everything sorted
   * by a number nobody reads.
   */
  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100)
  minScore?: number;

  /**
   * `score` is the default and is what matchmaking is for. `recent` exists
   * because families check back for new arrivals, and a newcomer buried at
   * rank 40 by an eighty-percent match they have already seen is a newcomer
   * they never see.
   */
  @ApiPropertyOptional({ enum: ['score', 'recent'], default: 'score' })
  @IsOptional() @IsIn(['score', 'recent'])
  sort?: 'score' | 'recent';

  /** Only profiles added in the last N days. */
  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365)
  addedWithinDays?: number;
}

export class SubjectQueryDto extends ActingProfileDto {}

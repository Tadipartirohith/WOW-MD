import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StrictBoolean } from '../../../common/decorators/strict-boolean.decorator';
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

  @ApiPropertyOptional({ maxLength: 120, description: 'Job title or business name' })
  @IsOptional() @IsString() @MaxLength(120)
  profession?: string;

  /*
   * The horoscope filters (EZ1-I163).
   *
   * Matched against the chart a profile saved in its biodata — the same rashi,
   * star, padam, gothram and kuja dosham the card already shows. Like the other
   * biodata filters, a profile with no chart is dropped once any of these is
   * set: an unknown in a filtered list is how the filter loses its meaning.
   */
  @ApiPropertyOptional({ maxLength: 60, description: 'Rashi' })
  @IsOptional() @IsString() @MaxLength(60)
  rashi?: string;

  @ApiPropertyOptional({ maxLength: 60, description: 'Star / Nakshatram' })
  @IsOptional() @IsString() @MaxLength(60)
  star?: string;

  @ApiPropertyOptional({ maxLength: 20, description: 'Padam' })
  @IsOptional() @IsString() @MaxLength(20)
  padam?: string;

  @ApiPropertyOptional({ maxLength: 60, description: 'Gothram' })
  @IsOptional() @IsString() @MaxLength(60)
  gothram?: string;

  @ApiPropertyOptional({ maxLength: 20, description: 'Kuja Dosham' })
  @IsOptional() @IsString() @MaxLength(20)
  kujaDosham?: string;

  /**
   * Name, profile code, or a word from the biodata.
   *
   * One box rather than three, because the person typing does not think of
   * "WOW10231" and "Anitha" as different kinds of search — they think of both
   * as the thing they remember about the profile they are looking for.
   */
  @ApiPropertyOptional({ maxLength: 80, example: 'WOW10231' })
  @IsOptional() @IsString() @MaxLength(80)
  q?: string;

  /**
   * Only profiles on this profile's shortlist.
   *
   * `boolean | string` because that union is what StrictBoolean needs to work:
   * without it the implicit conversion runs first and `?shortlistedOnly=false`
   * arrives as true. Measured on the running stack before this was fixed: a
   * search returning 23 suggestions returned 0 when the filter was explicitly
   * turned off. No screen sends the parameter today, so nobody has hit it --
   * it was waiting for whoever wired the filter up.
   */
  @ApiPropertyOptional()
  @IsOptional() @StrictBoolean()
  shortlistedOnly?: boolean | string;

  /**
   * `score` is the default and is what matchmaking is for. `recent` exists
   * because families check back for new arrivals, and a newcomer buried at
   * rank 40 by an eighty-percent match they have already seen is a newcomer
   * they never see. `active` surfaces the profiles that will actually answer,
   * and `age` is how a family with a firm age range reads a list.
   */
  @ApiPropertyOptional({
    enum: ['score', 'recent', 'active', 'age', 'ageDesc'],
    default: 'score',
  })
  @IsOptional() @IsIn(['score', 'recent', 'active', 'age', 'ageDesc'])
  sort?: 'score' | 'recent' | 'active' | 'age' | 'ageDesc';

  /** Only profiles added in the last N days. */
  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365)
  addedWithinDays?: number;
}

export class SubjectQueryDto extends ActingProfileDto {}

/**
 * The optional reason a profile was kept.
 *
 * The profile being shortlisted is in the path and the shortlist's owner is in
 * the query, so the body carries only the note — which is private to the side
 * that wrote it and never travels with the profile.
 */
export class ShortlistNoteDto {
  @ApiPropertyOptional({ maxLength: 500, example: 'Same town as my sister' })
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

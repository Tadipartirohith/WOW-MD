import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ItineraryItemDto {
  @ApiProperty({ minimum: 1, maximum: 365 })
  @Type(() => Number) @IsInt() @Min(1) @Max(365)
  day: number;

  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString() @MinLength(1) @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}

export class CreateItineraryDto {
  @ApiProperty({ minLength: 1, maxLength: 150 })
  @IsString() @MinLength(1) @MaxLength(150)
  title: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  packageId?: string;

  /**
   * The days, if there are any yet.
   *
   * Optional, and that is the fix rather than a relaxation. It used to require
   * at least one item, so the "Create plan" button — which posts a title and an
   * empty list, because the whole idea is to start a plan and fill it in — was
   * refused every single time. A honeymoon is planned by writing the name of
   * the trip down first; insisting on day one before the plan can exist is
   * asking somebody to have finished before they may start.
   */
  @ApiPropertyOptional({ type: [ItineraryItemDto], maxItems: 100 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItineraryItemDto)
  items?: ItineraryItemDto[];
}

/**
 * Browsing packages across destinations, rather than one destination at a time.
 *
 * Couples do not start from "Bali" — they start from a fortnight in December
 * and a number they can afford, and the destination is the answer rather than
 * the question. Every field is optional and they compose.
 */
export class PackageSearchDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  destinationId?: string;

  @ApiPropertyOptional({ description: 'A destination tag, e.g. honeymoon, beach, hills' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tag?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100_000_000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100_000_000)
  maxPrice?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  minNights?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  maxNights?: number;
}

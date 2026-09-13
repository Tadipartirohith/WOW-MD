import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { IsUploadedUrl } from '../../../common/decorators/uploaded-url.decorator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import {
  MOBILE_MESSAGE,
  MOBILE_PATTERN,
  normaliseMobile,
} from '../../../common/util/identity-fields';
import { ReviewStatus } from '../../../common/enums';

export class PlannerPackageDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ minimum: 0, maximum: 100_000_000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  price: number;

  @ApiPropertyOptional({ type: [String], maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  includes?: string[];
}

export class UpsertPlannerProfileDto {
  @ApiProperty({ example: 'Everafter Weddings', maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  agencyName: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 25 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  servesCities?: string[];

  @ApiPropertyOptional({ type: [PlannerPackageDto], maxItems: 20 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PlannerPackageDto)
  packages?: PlannerPackageDto[];

  @ApiPropertyOptional({ minimum: 0, maximum: 80 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(80)
  yearsExperience?: number;

  // Contact and location details, validated field-by-field (EZ1-I69).
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactPerson?: string;

  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @Transform(normaliseMobile)
  @Matches(MOBILE_PATTERN, { message: MOBILE_MESSAGE })
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'hello@everafter.example' })
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  contactEmail?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  state?: string;

  @ApiPropertyOptional({ example: '500001' })
  @IsOptional()
  @Matches(/^[1-9]\d{5}$/, { message: 'Enter a valid 6-digit pincode' })
  pincode?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUploadedUrl({ each: true })
  @MaxLength(2048, { each: true })
  portfolio?: string[];
}

export class PlannerSearchDto extends PaginationDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;
}

/**
 * A couple's review of the planner who ran their wedding (EZ1-I244).
 *
 * The overall rating is the only required part and the only one the average is
 * computed from. The five category scores are optional and stay optional: a
 * couple who wants to say "five stars, they were excellent" should not have to
 * grade five separate things to say it.
 */
export class CreatePlannerReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ maxLength: 1500 })
  @IsOptional()
  @IsString()
  @MaxLength(1500)
  comment?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, description: 'Planning & coordination' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  planning?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  communication?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  serviceQuality?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  professionalism?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  timeliness?: number;
}

export class AdminPlannerReviewQueryDto {
  @ApiPropertyOptional({ enum: ReviewStatus })
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  plannerId?: string;

  /** Name, email or the text of the review — one box, as the admin page has. */
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;
}

export class ModeratePlannerReviewDto {
  @ApiProperty({ enum: ReviewStatus })
  @IsEnum(ReviewStatus)
  status: ReviewStatus;

  /**
   * Required for anything but publishing, enforced in the service rather than
   * here: whether a reason is needed depends on which status was chosen.
   */
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

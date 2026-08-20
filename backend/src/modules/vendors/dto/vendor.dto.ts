import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { VendorCategory } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class VendorPackageDto {
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
}

export class VendorPricingDto {
  @ApiPropertyOptional({ maxLength: 3, example: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100_000_000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  startingAt?: number;

  @ApiPropertyOptional({ type: [VendorPackageDto], maxItems: 20 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => VendorPackageDto)
  packages?: VendorPackageDto[];
}

/**
 * Registration details. Optional at listing time and required before approval:
 * an officer checks them on the visit, and a vendor with nothing to show does
 * not get activated.
 */
export class VendorComplianceDto {
  @ApiPropertyOptional({ example: '29ABCDE1234F1Z5', description: '15-character GSTIN' })
  @IsOptional()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, {
    message: 'gstNumber must be a valid 15-character GSTIN',
  })
  gstNumber?: string;

  @ApiPropertyOptional({ example: 'ABCDE1234F' })
  @IsOptional()
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, { message: 'panNumber must be a valid 10-character PAN' })
  panNumber?: string;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  registrationNumber?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  registeredAddress?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'contactPhone must be 10-15 digits' })
  contactPhone?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 10, description: 'Certificate URLs' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({ require_tld: false }, { each: true })
  complianceDocuments?: string[];
}

export class CreateVendorDto extends VendorComplianceDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty({ enum: VendorCategory })
  @IsEnum(VendorCategory)
  category: VendorCategory;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ type: VendorPricingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => VendorPricingDto)
  pricing?: VendorPricingDto;

  @ApiPropertyOptional({ type: [String], maxItems: 30, description: 'Absolute media URLs' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUrl({ require_protocol: true }, { each: true })
  @MaxLength(2048, { each: true })
  portfolio?: string[];
}

/**
 * Update payload. Every field optional, and deliberately NOT a passthrough of
 * the entity: ratingAvg, ratingCount, isApproved and ownerUserId are server-
 * owned and are rejected by the global whitelist pipe if a client sends them.
 */
export class UpdateVendorDto extends PartialType(CreateVendorDto) {}

export class VendorSearchDto extends PaginationDto {
  @ApiPropertyOptional({ enum: VendorCategory })
  @IsOptional()
  @IsEnum(VendorCategory)
  category?: VendorCategory;

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

export class CreateReviewDto {
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
}

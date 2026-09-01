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
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsUploadedUrl } from '../../../common/decorators/uploaded-url.decorator';
import { Transform } from 'class-transformer';
import {
  ReviewStatus,
  VendorCategory,
} from '../../../common/enums';
import {
  GSTIN_MESSAGE,
  GSTIN_PATTERN,
  MOBILE_MESSAGE,
  MOBILE_PATTERN,
  PAN_MESSAGE,
  PAN_PATTERN,
  normaliseMobile,
  upperCaseTrim,
} from '../../../common/util/identity-fields';
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

  /**
   * What the starting price is *per*: a plate, an hour, a day, an event.
   *
   * A number on its own is not a price in this market — ₹30,000 for a caterer
   * means something entirely different per plate than per event, and a family
   * comparing two vendors cannot do it without this. The form has always
   * offered the field; the DTO did not accept it, and because unknown
   * properties are rejected outright the whole listing failed to save with
   * "property unit should not exist". Anyone who typed into the box lost the
   * listing; anyone who left it empty did not.
   */
  @ApiPropertyOptional({ maxLength: 40, example: 'plate' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  unit?: string;

  /** Anything that qualifies the price — minimum numbers, what is included. */
  @ApiPropertyOptional({ maxLength: 500, example: 'Minimum 100 plates. Service staff included.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

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
  @Transform(upperCaseTrim)
  @Matches(GSTIN_PATTERN, { message: GSTIN_MESSAGE })
  gstNumber?: string;

  @ApiPropertyOptional({ example: 'ABCDE1234F' })
  @IsOptional()
  @Transform(upperCaseTrim)
  @Matches(PAN_PATTERN, { message: PAN_MESSAGE })
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

  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @Transform(normaliseMobile)
  @Matches(MOBILE_PATTERN, { message: MOBILE_MESSAGE })
  contactPhone?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 10, description: 'Certificate URLs' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUploadedUrl({ each: true })
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

  /**
   * Required when the category is OTHER, refused otherwise — a listing that
   * says "Other: Venue" would fragment the very directory the category exists
   * to organise.
   */
  @ApiPropertyOptional({ example: 'Wedding Transportation', maxLength: 80 })
  @ValidateIf((o: { category: VendorCategory }) => o.category === VendorCategory.OTHER)
  @IsString({ message: 'Tell us which category, since you chose Other' })
  @MinLength(2)
  @MaxLength(80)
  otherCategory?: string;

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

  /*
   * Pricing is not part of the business record.
   *
   * It belongs to an Offering, under a Service, under the Catalog — which is
   * where a price has a model behind it, is what the marketplace reads, and is
   * what a quotation is built from. This field was a second, free-text answer
   * to the same question, editable only on My Business and visible only there,
   * so a vendor who filled in both had no way to tell which one a buyer saw.
   *
   * Removed from the payload rather than ignored: the API refuses unknown
   * fields, so a client still sending it is told, instead of having it
   * silently dropped and believing the price was saved.
   */

  @ApiPropertyOptional({ type: [String], maxItems: 30, description: 'Absolute media URLs' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUploadedUrl({ each: true })
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

/** Which slice of the review queue an administrator is looking at. */
export class AdminReviewQueryDto {
  @ApiPropertyOptional({ enum: ReviewStatus })
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  vendorId?: string;
}

export class ModerateReviewDto {
  @ApiProperty({ enum: ReviewStatus })
  @IsEnum(ReviewStatus)
  status: ReviewStatus;

  /**
   * Required for anything but publishing, enforced in the service rather than
   * here: whether a reason is needed depends on which status was chosen, and a
   * DTO cannot see one field while validating another without a custom rule
   * that would be harder to read than the check itself.
   */
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
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

/**
 * The gateway's linked account for a provider, so escrow has somewhere to go.
 *
 * Set by the provider themselves once they have completed payout onboarding.
 * Deliberately its own route rather than a field on the listing form: it is the
 * one value on a business record that decides where money lands, and burying it
 * among the portfolio URLs is how it gets changed by accident.
 */
export class PayoutAccountDto {
  @ApiProperty({
    example: 'acc_JDQrLYlYnCTZKp',
    description: "Razorpay Route linked account id. Empty string clears it.",
  })
  @IsString()
  @MaxLength(64)
  @Matches(/^(acc_[A-Za-z0-9]+)?$/, {
    message: 'That is not a linked account id — they look like acc_XXXXXXXX',
  })
  payoutAccountId: string;
}

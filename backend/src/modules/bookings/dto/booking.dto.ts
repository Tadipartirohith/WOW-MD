import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsUploadedUrl } from '../../../common/decorators/uploaded-url.decorator';
import { BookingStatus, PaymentMethod, PaymentMilestone, ProviderType } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateBookingDto {
  @ApiProperty({ enum: ProviderType, default: ProviderType.VENDOR })
  @IsEnum(ProviderType)
  providerType: ProviderType = ProviderType.VENDOR;

  @ApiProperty({ format: 'uuid', description: 'Vendor id or planner-profile id' })
  @IsUUID('4')
  providerId: string;

  /**
   * Only for a listed-price booking. A vendor request leaves it out — the price
   * is whatever the provider quotes against the requirements below.
   */
  @ApiPropertyOptional({ example: 50000, minimum: 1, maximum: 100_000_000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1, { message: 'A booking amount must be greater than zero' })
  @Max(100_000_000)
  amount?: number;

  /** The published window being requested. Required for a vendor booking. */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  slotId?: string;

  /** The wedding event this is for — the reception, the mehendi. */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  eventId?: string;

  // --------------------------------------------------------------- catalog
  //
  // Which service is being booked, at which published price, and the buyer's
  // answers to that service's booking form. Optional so that a provider who
  // has not moved onto the catalog can still take a request the old way.

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The vendor service being requested. Its booking form decides what is asked.',
  })
  @IsOptional()
  @IsUUID('4')
  vendorServiceId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Which published price was chosen.' })
  @IsOptional()
  @IsUUID('4')
  offeringId?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Answers to the service’s booking form, validated against the same rows the form was ' +
      'generated from.',
  })
  @IsOptional()
  @IsObject()
  serviceAnswers?: Record<string, unknown>;

  @ApiPropertyOptional({
    minimum: 1,
    description: 'Plates, hours, days — whatever the chosen price counts.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity?: number;

  /**
   * What the provider needs to know to price the job: guest count, menu,
   * timings, anything particular. A quotation written without this is a guess.
   */
  @ApiPropertyOptional({ maxLength: 4000, minLength: 10 })
  @IsOptional()
  @IsString()
  @MinLength(10, { message: 'Tell the provider what you need — at least a sentence' })
  @MaxLength(4000)
  requirements?: string;

  /**
   * What the buyer hopes to spend. Optional on purpose: the provider quotes
   * against the requirements, and demanding a number from someone who does not
   * have one only produces a fictional one.
   */
  @ApiPropertyOptional({ example: 50000, minimum: 0, maximum: 100_000_000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  expectedBudget?: number;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  eventDate?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class PayDto {
  @ApiPropertyOptional({
    enum: PaymentMilestone,
    default: PaymentMilestone.ADVANCE,
    description: 'Which instalment to pay. They must be paid in order.',
  })
  @IsOptional()
  @IsEnum(PaymentMilestone)
  milestone?: PaymentMilestone;

  /**
   * How it is being paid.
   *
   * Whether a given method is *accepted* is configuration and is checked in the
   * service, not here — a deployment that has not turned on netbanking should
   * refuse it with a sentence about this platform rather than a validation
   * error listing an enum.
   */
  @ApiPropertyOptional({
    enum: PaymentMethod,
    default: PaymentMethod.CARD,
    description:
      'card, upi and netbanking are held in escrow. cash is settled directly between the two parties and is not protected.',
  })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;
}

export class CancelBookingDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** A message inside a booking. No recipient: a booking has exactly two sides. */
export class BookingMessageDto {
  @ApiProperty({ minLength: 1, maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;

  @ApiPropertyOptional({ maxLength: 2048 })
  @IsOptional()
  @IsUploadedUrl()
  @MaxLength(2048)
  mediaUrl?: string;
}

export class BookingSearchDto extends PaginationDto {
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({ format: 'uuid', description: 'AGENT only: filter to one client' })
  @IsOptional()
  @IsUUID('4')
  clientId?: string;
}

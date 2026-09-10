import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsUploadedUrl } from '../../../common/decorators/uploaded-url.decorator';

export class CreateBookingAddonDto {
  @ApiProperty({ example: 'Extra drone coverage', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ maxLength: 2000, description: 'What the extra needs to cover.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity?: number;

  @ApiPropertyOptional({
    example: 15000,
    description: 'The asked price, when the add-on has a predefined one. The vendor may requote it.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  proposedPrice?: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** The vendor's counter-price on a requote. */
export class RequoteBookingAddonDto {
  @ApiProperty({ example: 18000, minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  vendorPrice: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** A note carried on accept/reject, by either side. */
export class RespondBookingAddonDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/**
 * What the provider hands over when they mark a booking delivered (EZ1-I228).
 *
 * Both optional. A photographer's delivery is a gallery link and a caterer's is
 * nothing at all, so demanding evidence would block the honest majority to
 * catch the dishonest few; when it is supplied it stays on the booking, which
 * is what an administrator settling a dispute later needs.
 */
export class MarkDeliveredDto {
  @ApiPropertyOptional({ maxLength: 2000, description: 'What was delivered.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Photographs or documents evidencing the delivery.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUploadedUrl({ each: true })
  evidence?: string[];
}

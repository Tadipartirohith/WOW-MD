import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BookingStatus, PaymentMilestone, ProviderType } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateBookingDto {
  @ApiProperty({ enum: ProviderType, default: ProviderType.VENDOR })
  @IsEnum(ProviderType)
  providerType: ProviderType = ProviderType.VENDOR;

  @ApiProperty({ format: 'uuid', description: 'Vendor id or planner-profile id' })
  @IsUUID('4')
  providerId: string;

  @ApiProperty({ example: 50000, minimum: 1, maximum: 100_000_000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1, { message: 'A booking amount must be greater than zero' })
  @Max(100_000_000)
  amount: number;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  eventDate?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /**
   * Agents only. Books for a client on their own books; ignored (and rejected)
   * for every other role, so an individual cannot create bookings under someone
   * else's name.
   */
  @ApiPropertyOptional({ format: 'uuid', description: 'AGENT only: the managed client to book for' })
  @IsOptional()
  @IsUUID('4')
  onBehalfOfUserId?: string;
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
}

export class CancelBookingDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
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

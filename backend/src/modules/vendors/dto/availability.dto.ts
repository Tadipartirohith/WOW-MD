import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** 24-hour HH:MM. Seconds are not a thing anybody schedules a wedding by. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = 'Use 24-hour HH:MM, for example 18:00';

export class CreateSlotDto {
  @ApiProperty({ format: 'date', example: '2026-09-01' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: '12:00' })
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  startTime: string;

  @ApiProperty({ example: '16:00' })
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  endTime: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 500,
    description:
      'How many bookings this window can take at once. Defaults to the service’s configured ' +
      'capacity — five for a caterer running five teams, one for a convention hall.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  capacity?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Which of the vendor’s services this window is for. Publishing per service is what lets ' +
      'one afternoon be five catering bookings and one tasting.',
  })
  @IsOptional()
  @IsUUID()
  vendorServiceId?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class UpdateSlotDto {
  @ApiPropertyOptional({ example: '13:00' })
  @IsOptional()
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  startTime?: string;

  @ApiPropertyOptional({ example: '17:00' })
  @IsOptional()
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  endTime?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 500 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  capacity?: number;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class BlockSlotDto {
  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Why the window is unavailable — a holiday, a private booking.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class AvailabilityQueryDto {
  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  to?: string;

  // Availability is service-specific: a buyer checking a particular service
  // must see only that service's slots (plus any not tied to a service), not
  // every service the vendor sells. Without this a slot published for Transport
  // showed up under Makeup too (EZ1-I28).
  @ApiPropertyOptional({ format: 'uuid', description: 'Only slots for this vendor service' })
  @IsOptional()
  @IsUUID()
  vendorServiceId?: string;
}

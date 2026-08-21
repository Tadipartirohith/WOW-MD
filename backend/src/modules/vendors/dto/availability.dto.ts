import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
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
    maximum: 50,
    default: 1,
    description: 'How many events this window can take. One for most vendors.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  capacity?: number;

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

  @ApiPropertyOptional({ minimum: 1, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
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
}

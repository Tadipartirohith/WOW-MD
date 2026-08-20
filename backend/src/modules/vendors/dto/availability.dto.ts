import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class SetAvailabilityDto {
  @ApiProperty({ format: 'date', example: '2026-11-24' })
  @IsDateString()
  date: string;

  @ApiProperty({
    minimum: 0,
    maximum: 20,
    description: 'How many bookings this date can take. Zero blocks the day out.',
  })
  @IsInt()
  @Min(0)
  @Max(20)
  capacity: number;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
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

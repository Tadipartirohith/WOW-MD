import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BookingStatus, BusinessStatus, UserRole } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { StrictBoolean } from '../../../common/decorators/strict-boolean.decorator';

export class ActivityQueryDto {
  @ApiPropertyOptional({ default: 40, minimum: 1, maximum: 200 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 40;
}

/** Shared by the accounts and businesses directories — same three questions. */
export class DirectoryQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: BusinessStatus })
  @IsOptional()
  @IsEnum(BusinessStatus)
  status?: BusinessStatus;

  @ApiPropertyOptional({ description: 'Substring of the email, or of the business name.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ description: 'Suspended accounts are the ones people come looking for.' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  active?: boolean;
}

export class AdminBookingQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  providerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}

export const REPORT_KINDS = [
  'users',
  'agents',
  'vendors',
  'bookings',
  'financial',
  'verification',
] as const;

export class ReportQueryDto {
  @ApiProperty({ enum: REPORT_KINDS })
  @IsIn(REPORT_KINDS)
  kind: (typeof REPORT_KINDS)[number];

  @ApiPropertyOptional({ description: 'Inclusive. Defaults to thirty days before `to`.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive of the whole day. Defaults to today.' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

/** An administrator's answer on a held price change. */
export class DecidePriceChangeDto {
  @ApiProperty({ type: Boolean, description: 'True to apply the new price, false to discard it.' })
  @StrictBoolean()
  approve: boolean | string;
}

import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

/**
 * Ending a match politely needs no explanation, so the reason is optional —
 * but it is stored when given, because the other side and any later
 * investigation both benefit from it.
 */
export class EndMatchDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;
}

/** Reporting is different: a report with no reason cannot be investigated. */
export class ReportMatchDto {
  @ApiProperty({ minLength: 10, maxLength: 1000 })
  @IsString()
  @Length(10, 1000)
  reason: string;
}

/**
 * Which side is confirming.
 *
 * Only meaningful when one account speaks for both families — an agency
 * matching two of its own clients. Everyone else omits it and confirms the
 * only side they are on.
 */
export class ConfirmMatchFixedDto {
  @ApiPropertyOptional({ enum: ['from', 'to'] })
  @IsOptional()
  @IsIn(['from', 'to'])
  side?: 'from' | 'to';
}

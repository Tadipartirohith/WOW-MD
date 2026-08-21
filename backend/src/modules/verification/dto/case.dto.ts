import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CaseStatus,
  CaseSubject,
  PaymentMilestone,
  SettlementOutcome,
} from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class RaiseCaseDto {
  @ApiProperty({ enum: CaseSubject })
  @IsEnum(CaseSubject)
  subjectType: CaseSubject;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The booking, profile or match the issue is about. Freezes escrow when it is a booking.',
  })
  @IsOptional()
  @IsUUID('4')
  subjectId?: string;

  /**
   * Which instalment the argument is about. Optional, because plenty of cases
   * are not about money at all — a profile that is not who it says it is, for
   * one.
   */
  @ApiPropertyOptional({ enum: PaymentMilestone })
  @IsOptional()
  @IsEnum(PaymentMilestone)
  milestone?: PaymentMilestone;

  /**
   * Photographs, invoices, screenshots. An investigation run on two sentences
   * of prose is a coin toss, and the person raising it usually has proof.
   */
  @ApiPropertyOptional({ type: [String], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({ require_protocol: true }, { each: true })
  evidence?: string[];

  @ApiProperty({ minLength: 5, maxLength: 200 })
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  title: string;

  @ApiProperty({ minLength: 10, maxLength: 4000 })
  @IsString()
  @MinLength(10, { message: 'Describe the issue in at least 10 characters' })
  @MaxLength(4000)
  description: string;
}

/**
 * Escalate a case to somebody who will go and look.
 *
 * Some disputes cannot be settled from a desk: the hall that turns out not to
 * exist, the caterer whose kitchen is a front room. Marking that explicitly is
 * how the case reaches a field officer rather than circling in a queue.
 */
export class EscalateCaseDto {
  @ApiProperty({ minLength: 10, maxLength: 1000, description: 'Why a visit is needed' })
  @IsString()
  @MinLength(10, { message: 'Say why this needs somebody on the ground' })
  @MaxLength(1000)
  reason: string;
}

/** More proof, arriving after the case was raised. */
export class AddEvidenceDto {
  @ApiProperty({ type: [String], maxItems: 10 })
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({ require_protocol: true }, { each: true })
  evidence: string[];
}

export class AllocateCaseDto {
  /** Omit to let the platform pick the officer with the fewest open cases. */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  officerUserId?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RecordFindingsDto {
  @ApiProperty({ minLength: 10, maxLength: 4000 })
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  findings: string;

  @ApiPropertyOptional({ enum: CaseStatus })
  @IsOptional()
  @IsEnum(CaseStatus)
  status?: CaseStatus;
}

export class SettleCaseDto {
  @ApiProperty({ enum: SettlementOutcome })
  @IsEnum(SettlementOutcome)
  outcome: SettlementOutcome;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 100_000_000,
    description: 'Required for a partial settlement.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  amount?: number;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CaseQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: CaseStatus })
  @IsOptional()
  @IsEnum(CaseStatus)
  status?: CaseStatus;

  @ApiPropertyOptional({ enum: CaseSubject })
  @IsOptional()
  @IsEnum(CaseSubject)
  subjectType?: CaseSubject;
}

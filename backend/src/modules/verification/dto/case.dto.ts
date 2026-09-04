import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsUploadedUrl } from '../../../common/decorators/uploaded-url.decorator';
import { IsStrictString } from '../../../common/decorators/strict-type.decorator';
import {
  CasePriority,
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
  @IsUploadedUrl({ each: true })
  evidence?: string[];

  @ApiProperty({ minLength: 5, maxLength: 200 })
  @IsStrictString()
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
  @IsUploadedUrl({ each: true })
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

/** The states an officer can put a case into by writing it up. */
const WORKING_STATES = [
  CaseStatus.IN_PROGRESS,
  CaseStatus.WAITING_FOR_INFORMATION,
  CaseStatus.ESCALATED,
] as const;

export class RecordFindingsDto {
  @ApiProperty({ minLength: 10, maxLength: 4000 })
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  findings: string;

  /**
   * Where the case is after writing this up.
   *
   * Deliberately not the whole enum. It used to accept any `CaseStatus`, which
   * let an officer set RESOLVED on the way past and skip the administrator's
   * decision entirely — the money would not have moved, but the case would
   * have read as decided, which is worse than either.
   */
  @ApiPropertyOptional({ enum: WORKING_STATES })
  @IsOptional()
  @IsIn(WORKING_STATES)
  status?: (typeof WORKING_STATES)[number];
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

/** Reading a case and deciding what kind of thing it is. */
export class TriageCaseDto {
  @ApiPropertyOptional({ enum: CasePriority, default: CasePriority.NORMAL })
  @IsOptional()
  @IsEnum(CasePriority)
  priority?: CasePriority;

  @ApiPropertyOptional({ maxLength: 64, example: 'payment' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** An administrator's decision on a proposal an officer submitted. */
export class ReviewCaseDto {
  @ApiProperty({ enum: ['approve', 'reassign'] })
  @IsIn(['approve', 'reassign'])
  decision: 'approve' | 'reassign';

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'On reassign: who it goes to. Left out, the lightest-loaded officer is chosen.',
  })
  @IsOptional()
  @IsUUID('4')
  officerUserId?: string;

  @ApiPropertyOptional({ maxLength: 1000, description: 'Required when reassigning.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** A provider asking where the money they are owed has got to. */
export class SettlementRequestDto {
  @ApiPropertyOptional({ maxLength: 1000, description: 'Anything they want to add.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
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

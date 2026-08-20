import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CaseStatus, CaseSubject, SettlementOutcome } from '../../../common/enums';
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

export class AllocateCaseDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  officerUserId: string;

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

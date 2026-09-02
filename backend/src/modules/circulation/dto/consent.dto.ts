import { IsNotFutureDate } from '../../../common/decorators/not-future.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ConsentMethod, ConsentRelation, ConsentScope } from '../../../common/enums';
import {
  MOBILE_MESSAGE,
  MOBILE_PATTERN,
  normaliseMobile,
} from '../../../common/util/identity-fields';

export class RecordConsentDto {
  @ApiProperty({
    enum: ConsentScope,
    description:
      'INTAKE lets the agency hold the details; CIRCULATION lets them be shared outside it.',
  })
  @IsEnum(ConsentScope)
  scope: ConsentScope;

  @ApiProperty({ enum: ConsentMethod, example: ConsentMethod.IN_PERSON })
  @IsEnum(ConsentMethod)
  method: ConsentMethod;

  @ApiProperty({
    enum: ConsentRelation,
    description: 'Who gave it. Frequently a parent rather than the subject.',
  })
  @IsEnum(ConsentRelation)
  givenByRelation: ConsentRelation;

  @ApiProperty({ example: 'Ramesh Sharma', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  givenByName: string;

  @ApiPropertyOptional({
    example: '+919876543210',
    description: 'A number the agency can call back on to confirm.',
  })
  @IsOptional()
  @Transform(normaliseMobile)
  @Matches(MOBILE_PATTERN, { message: MOBILE_MESSAGE })
  givenByPhone?: string;

  @ApiProperty({
    format: 'date',
    description: 'When consent was actually given, which may predate this record.',
  })
  @IsDateString({}, { message: 'givenAt must be a date, e.g. 2026-08-12' })
  @IsNotFutureDate({ message: 'Consent cannot have been given in the future' })
  givenAt: string;

  @ApiPropertyOptional({ maxLength: 1000, example: 'Father visited the office with the biodata.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class RevokeConsentDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

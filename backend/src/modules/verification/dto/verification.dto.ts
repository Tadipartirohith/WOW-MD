import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApplicantType, VerificationStatus } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class AllocateRequestDto {
  /**
   * Leave it out to let the platform pick the lightest-loaded active officer.
   * An administrator overriding that is normal — they know who is near which
   * address — but they should not have to do the arithmetic every time.
   */
  @ApiPropertyOptional({ format: 'uuid', description: 'User id of the verification officer' })
  @IsOptional()
  @IsUUID('4')
  officerUserId?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Officers may record any outcome except NEW/ASSIGNED, which are admin states. */
const DECIDABLE = [
  VerificationStatus.APPROVED,
  VerificationStatus.REJECTED,
  VerificationStatus.ISSUE,
  VerificationStatus.ADDITIONAL_REVIEW,
];

export class DecideVerificationDto {
  @ApiProperty({ enum: DECIDABLE })
  @IsIn(DECIDABLE, {
    message: `status must be one of: ${DECIDABLE.join(', ')}`,
  })
  status: VerificationStatus;

  @ApiPropertyOptional({
    minLength: 5,
    maxLength: 2000,
    description: 'Required for anything other than an approval.',
  })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  remarks?: string;
}

export class VerificationQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: VerificationStatus })
  @IsOptional()
  @IsEnum(VerificationStatus)
  status?: VerificationStatus;

  @ApiPropertyOptional({ enum: ApplicantType })
  @IsOptional()
  @IsEnum(ApplicantType)
  applicantType?: ApplicantType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  officerUserId?: string;
}

export class CreateOfficerDto {
  @ApiProperty({ example: 'officer@wow.example.com' })
  @IsString()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Suresh Kumar', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;
}

/**
 * What an officer writes up after a visit.
 *
 * `visited` is separate from `observations` because "I went and it checked out"
 * and "I could not find the address" are both findings, and the second is the
 * one that matters most.
 */
export class SubmitFindingsDto {
  @ApiProperty({ description: 'Did the officer actually attend the address?' })
  @IsBoolean()
  visited: boolean;

  @ApiProperty({
    minLength: 10,
    maxLength: 4000,
    example: 'Attended the address. Kitchen and two vans present; GST certificate on the wall.',
  })
  @IsString()
  @MinLength(10, { message: 'Write up what you actually saw' })
  @MaxLength(4000)
  observations: string;

  @ApiProperty({
    type: [String],
    description: 'Anything that did not check out. Required unless recommending approval.',
  })
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  issues: string[];

  @ApiPropertyOptional({ type: [String], description: 'Photographs or documents, as media URLs.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  evidence?: string[];

  @ApiProperty({
    enum: ['approve', 'reject', 'revisit'],
    description: 'The officer recommends; an administrator decides.',
  })
  @IsIn(['approve', 'reject', 'revisit'])
  recommendation: 'approve' | 'reject' | 'revisit';
}

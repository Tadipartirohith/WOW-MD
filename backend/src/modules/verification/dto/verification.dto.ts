import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApplicantType, VerificationStatus } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class AllocateRequestDto {
  @ApiProperty({ format: 'uuid', description: 'User id of the verification officer' })
  @IsUUID('4')
  officerUserId: string;

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

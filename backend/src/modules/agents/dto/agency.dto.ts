import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import {
  MOBILE_MESSAGE,
  MOBILE_PATTERN,
  normaliseMobile,
} from '../../../common/util/identity-fields';

export class UpsertAgencyDto {
  @ApiProperty({ example: 'Sharma Matrimony', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  agencyName: string;

  @ApiPropertyOptional({ maxLength: 60, description: 'Business registration / licence number' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  registrationNumber?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @Transform(normaliseMobile)
  @Matches(MOBILE_PATTERN, { message: MOBILE_MESSAGE })
  contactPhone?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  about?: string;
}

export class RejectAgencyDto {
  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

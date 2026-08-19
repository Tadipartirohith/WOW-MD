import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PHONE_MESSAGE, PHONE_PATTERN } from '../../auth/dto/auth.dto';

const normalisePhone = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value;

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
  @Transform(normalisePhone)
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
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

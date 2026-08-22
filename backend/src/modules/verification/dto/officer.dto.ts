import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateOfficerDto {
  @ApiProperty({ example: 'field.officer@wow.local' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Anitha R' })
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'phone must be 10-15 digits, optionally with +' })
  phone?: string;

  /** Free text: which city or area this officer covers. Shown when allocating. */
  @ApiPropertyOptional({ example: 'Hyderabad' })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  region?: string;
}

export class SetOfficerStatusDto {
  @ApiProperty()
  @IsBoolean()
  isActive: boolean;
}

/**
 * One place an officer will travel to.
 *
 * A city or a state, not both — an officer who covers Telangana does not also
 * need Hyderabad listed, and recording it twice makes the coverage query
 * report them under two tiers at once.
 */
export class ServiceAreaDto {
  @ApiPropertyOptional({ example: 'Hyderabad', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({
    example: 'Telangana',
    maxLength: 120,
    description: 'For an officer who genuinely covers a whole state.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'False for a neighbouring district they will travel to only when nobody nearer is free.',
  })
  @IsOptional()
  @IsBoolean()
  primary?: boolean;
}

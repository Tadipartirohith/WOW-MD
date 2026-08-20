import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

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

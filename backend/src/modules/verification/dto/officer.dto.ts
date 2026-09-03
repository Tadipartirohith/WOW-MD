import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

/** Trim and lowercase so the same address is not stored two ways. */
const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateOfficerDto {
  // A real address, normalised to lowercase and refused when it is a
  // placeholder domain like `@wow.local` — those were being accepted, so an
  // officer account could be created that no email could ever reach.
  @ApiProperty({ example: 'field.officer@wow.com' })
  @Transform(normaliseEmail)
  @IsEmail(
    { host_blacklist: ['wow.local', 'localhost', 'test', 'example.com'] },
    { message: 'Enter a valid email address' },
  )
  email: string;

  @ApiProperty({ example: 'Anitha R' })
  @IsString()
  @Length(2, 120)
  name: string;

  // Mandatory: an officer is allocated work in the field and reached on this
  // number, so an account without one cannot actually be dispatched.
  @ApiProperty({ example: '+919876543210' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'Enter a valid mobile number (10-15 digits)' })
  phone: string;

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

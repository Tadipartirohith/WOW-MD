import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  AccountType,
  INDIVIDUAL_ROLES,
  SELF_REGISTERABLE_ROLES,
  UserRole,
} from '../../../common/enums';

/** Shared password policy: length plus three character classes. */
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
export const PASSWORD_MESSAGE =
  'Password must be at least 8 characters and include an uppercase letter, a lowercase letter and a digit';

const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @ApiProperty({ example: 'bride@example.com' })
  @IsEmail({}, { message: 'A valid email address is required' })
  @MaxLength(254)
  @Transform(normaliseEmail)
  email: string;

  @ApiProperty({ example: 'StrongP@ssw0rd', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE })
  password: string;

  @ApiProperty({
    enum: AccountType,
    description:
      'Coarse account type chosen on the sign-up screen. INDIVIDUAL additionally requires `role`.',
  })
  @IsEnum(AccountType)
  accountType: AccountType;

  /**
   * Only meaningful for INDIVIDUAL sign-ups. Restricted to bride/groom/family so
   * a caller can never mint themselves an admin, agent or vendor account through
   * this field — see the guard on `SELF_REGISTERABLE_ROLES` in AuthService.
   */
  @ApiPropertyOptional({ enum: INDIVIDUAL_ROLES, example: UserRole.BRIDE })
  @ValidateIf((o: RegisterDto) => o.accountType === AccountType.INDIVIDUAL)
  @IsIn(INDIVIDUAL_ROLES as UserRole[], {
    message: `role must be one of: ${INDIVIDUAL_ROLES.join(', ')}`,
  })
  role?: UserRole;

  @ApiPropertyOptional({ example: 'Priya Sharma', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;
}

/** Roles a self-service registration may ever produce. Exported for tests. */
export const REGISTERABLE = SELF_REGISTERABLE_ROLES;

export class LoginDto {
  @ApiProperty({ example: 'bride@example.com' })
  @IsEmail()
  @MaxLength(254)
  @Transform(normaliseEmail)
  email: string;

  @ApiProperty({ example: 'StrongP@ssw0rd' })
  @IsString()
  @MaxLength(128)
  password: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(2048)
  refreshToken: string;
}

/** Payload an AGENT submits to onboard a client account. */
export class CreateClientDto {
  @ApiProperty({ example: 'client@example.com' })
  @IsEmail()
  @MaxLength(254)
  @Transform(normaliseEmail)
  email: string;

  @ApiProperty({ example: 'StrongP@ssw0rd', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE })
  password: string;

  @ApiProperty({ enum: INDIVIDUAL_ROLES, example: UserRole.BRIDE })
  @IsIn(INDIVIDUAL_ROLES as UserRole[], {
    message: `role must be one of: ${INDIVIDUAL_ROLES.join(', ')}`,
  })
  role: UserRole;

  @ApiProperty({ example: 'Priya Sharma', maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName: string;

  @ApiPropertyOptional({ example: 'Hyderabad', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;
}

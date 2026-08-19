import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
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

/**
 * E.164-ish: an optional +, then 8-15 digits. Deliberately permissive about
 * country formatting but strict about shape, because agents key these in by
 * hand and a typo means the client never gets contacted.
 */
export const PHONE_PATTERN = /^\+?[1-9]\d{7,14}$/;
export const PHONE_MESSAGE =
  'Enter a valid phone number in international format, for example +919876543210';

export const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const normalisePhone = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value;

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

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @Transform(normalisePhone)
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone?: string;
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

  /** Required only once the account has two-factor enabled. */
  @ApiPropertyOptional({ example: '123456', description: 'TOTP code, when MFA is enabled' })
  @IsOptional()
  @IsString()
  @Length(6, 6, { message: 'The authentication code is 6 digits' })
  @Matches(/^\d{6}$/, { message: 'The authentication code is 6 digits' })
  mfaCode?: string;
}

/**
 * Body fallback for clients that cannot hold cookies (tests, server-to-server).
 * Browsers send the refresh token in an httpOnly cookie instead and omit this.
 */
export class RefreshDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(2048)
  refreshToken?: string;
}

export class RequestPasswordResetDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(254)
  @Transform(normaliseEmail)
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token from the reset email' })
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  token: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE })
  password: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Token from the verification email' })
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  token: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE })
  newPassword: string;
}

export class ConfirmMfaDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'The authentication code is 6 digits' })
  code: string;
}

export class DisableMfaDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  password: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'The authentication code is 6 digits' })
  code: string;
}

/**
 * Accepting an invitation: the subject sets their OWN password, so the steward
 * who created the profile never knows the credentials.
 */
export class AcceptInvitationDto {
  @ApiProperty({ description: 'Token from the invitation email' })
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  token: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE })
  password: string;
}

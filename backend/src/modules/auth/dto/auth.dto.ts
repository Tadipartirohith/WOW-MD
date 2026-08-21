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
import {
  MOBILE_MESSAGE,
  MOBILE_PATTERN,
  NAME_MESSAGE,
  NAME_PATTERN,
  normaliseMobile,
  normaliseName,
} from '../../../common/util/identity-fields';

/** Shared password policy: length plus three character classes. */
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
export const PASSWORD_MESSAGE =
  'Password must be at least 8 characters and include an uppercase letter, a lowercase letter and a digit';

export const normaliseEmail = ({ value }: { value: unknown }) =>
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

  /**
   * The person's own name, for every account type.
   *
   * A vendor used to type their *business* name here, which put the business
   * identity on the account record and left the person nameless. The business
   * name is collected later, with the rest of the business details.
   */
  @ApiProperty({ example: 'Rakesh Rao', maxLength: 120 })
  @IsString()
  @Transform(normaliseName)
  @Length(2, 120)
  @Matches(NAME_PATTERN, { message: NAME_MESSAGE })
  displayName: string;

  /**
   * Ten digits, stored with its country code. Required for business accounts,
   * which are contacted by phone as a matter of course; optional for an
   * individual, who may only ever be reached by email.
   */
  @ApiPropertyOptional({ example: '9876543210' })
  @ValidateIf(
    (o: RegisterDto) => o.accountType !== AccountType.INDIVIDUAL || o.phone !== undefined,
  )
  @Transform(normaliseMobile)
  @Matches(MOBILE_PATTERN, { message: MOBILE_MESSAGE })
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

  /**
   * Required once the account has two-factor enabled.
   *
   * Accepts either the six digits from the authenticator or one of the longer
   * recovery codes, which is the whole point of recovery codes — somebody who
   * has lost their phone has to be able to type one into this same field.
   */
  @ApiPropertyOptional({
    example: '123456',
    description: 'TOTP code, or a recovery code, when MFA is enabled',
  })
  @IsOptional()
  @IsString()
  @Length(6, 32)
  @Matches(/^([0-9]{6}|[A-Za-z0-9][A-Za-z0-9\s-]{7,31})$/, {
    message: 'Enter the 6-digit code from your authenticator, or a recovery code',
  })
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
/** Regenerating recovery codes needs the password, and nothing else. */
export class RegenerateRecoveryCodesDto {
  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}

/** The six digits that came by SMS. */
export class VerifyPhoneDto {
  @ApiProperty({ example: '482910' })
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'The code is 6 digits' })
  code: string;
}

export class AcceptInvitationDto {
  @ApiProperty({ description: 'Token from the invitation email or SMS' })
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

  /**
   * Only needed when the invitation arrived by SMS alone.
   *
   * Intake is phone-first, so plenty of profiles are built with a number and
   * nothing else. An account still needs an email — it is the sign-in
   * credential and the only way to reset a password — so the one moment to ask
   * for it is here, when the person themselves is on the other end of the form
   * rather than the agent guessing on their behalf.
   */
  @ApiPropertyOptional({ description: 'Required only when the invitation had no email address' })
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(180)
  email?: string;
}

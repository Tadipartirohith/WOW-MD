import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { ProfileClaimStatus, ProfileLifecycle } from '../../../common/enums';

export class ClientSearchDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Free-text match on client email or display name' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  /*
   * Carried as the literal string, not a boolean.
   *
   * The pipe runs with `enableImplicitConversion`, which coerces a query
   * parameter to the declared type -- and for a boolean that is `Boolean(value)`,
   * so the string "false" arrives as true. This filter has therefore always
   * returned active accounts whichever way it was set: an agent choosing
   * "Deactivated accounts" got the active ones and nothing said otherwise.
   * Found while adding the filters beside it (EZ1-I241).
   *
   * A string the service compares explicitly cannot be coerced into its own
   * opposite.
   */
  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'Active or deactivated accounts' })
  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: 'true' | 'false';

  /*
   * The rest of the filters the merged My Clients page offers (EZ1-I241).
   *
   * They are here rather than applied in the browser because the list is
   * paginated: filtering a single page client-side answers "which of these
   * twenty match", which is not the question an agent is asking.
   */

  @ApiPropertyOptional({
    enum: ProfileClaimStatus,
    description: 'Where the client is in claiming their own account',
  })
  @IsOptional()
  @IsEnum(ProfileClaimStatus)
  claimStatus?: ProfileClaimStatus;

  @ApiPropertyOptional({
    enum: ProfileLifecycle,
    description: 'Active, paused, or closed. Closed profiles are excluded unless asked for.',
  })
  @IsOptional()
  @IsEnum(ProfileLifecycle)
  lifecycle?: ProfileLifecycle;

  @ApiPropertyOptional({ description: 'Exact city, as stored on the profile' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  /** A string for the same reason `isActive` is one. */
  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'True for clients who hold an account, false for profiles the agency still owns',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  hasAccount?: 'true' | 'false';
}

export class UpdateClientStatusDto {
  @ApiPropertyOptional()
  @IsBoolean()
  isActive: boolean;
}

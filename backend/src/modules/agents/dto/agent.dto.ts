import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { StrictBoolean } from '../../../common/decorators/strict-boolean.decorator';
import { ProfileClaimStatus, ProfileLifecycle } from '../../../common/enums';

export class ClientSearchDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Free-text match on client email or display name' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  /*
   * This filter always returned active accounts whichever way it was set: the
   * pipe's implicit conversion turns the string "false" into true, so an agent
   * choosing "Deactivated accounts" got the active ones and nothing said
   * otherwise (found while adding the filters beside it, EZ1-I241).
   *
   * `StrictBoolean` with the `boolean | string` union is the house answer to
   * that, and it is what the rest of the platform's sensitive booleans use.
   */
  @ApiPropertyOptional({ description: 'Active or deactivated accounts' })
  @IsOptional()
  @StrictBoolean()
  isActive?: boolean | string;

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

  /** Strict for the same reason `isActive` is. */
  @ApiPropertyOptional({
    description: 'True for clients who hold an account, false for profiles the agency still owns',
  })
  @IsOptional()
  @StrictBoolean()
  hasAccount?: boolean | string;
}

export class UpdateClientStatusDto {
  /**
   * Whether the client keeps their account.
   *
   * Strict for the reason the admin's equivalent is: an agent who meant to
   * suspend somebody and reinstated them instead would have no way of telling
   * from the response. Read with `=== true`.
   */
  @ApiPropertyOptional({ type: Boolean })
  @StrictBoolean()
  isActive: boolean | string;
}

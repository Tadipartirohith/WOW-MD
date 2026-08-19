import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * Which profile the caller is acting as.
 *
 * Individuals normally omit it and act as themselves. Agents and family members
 * pass the managed profile's id — including profiles whose subject has no
 * account yet. GET /agents/profiles/actable lists the valid values.
 */
class ActingProfileDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Profile to act as. Required for agents; optional for everyone else.',
  })
  @IsOptional()
  @IsUUID('4')
  profileId?: string;
}

export class SendInterestDto extends ActingProfileDto {
  @ApiProperty({ format: 'uuid', description: 'The profile being approached' })
  @IsUUID('4')
  toProfileId: string;
}

export class SuggestionsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  profileId?: string;
}

export class SubjectQueryDto extends ActingProfileDto {}

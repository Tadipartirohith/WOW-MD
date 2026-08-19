import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { NetworkVisibility } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';

class ShareBaseDto {
  @ApiProperty({ format: 'uuid', description: 'The profile being circulated' })
  @IsUUID('4')
  profileId: string;

  @ApiPropertyOptional({ maxLength: 1000, description: 'A covering note for the recipient' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}

export class ShareToAgentDto extends ShareBaseDto {
  @ApiProperty({ format: 'uuid', description: 'User id of the receiving agent' })
  @IsUUID('4')
  agentUserId: string;
}

export class ShareToUserDto extends ShareBaseDto {
  @ApiProperty({ format: 'uuid', description: 'User id of the receiving account' })
  @IsUUID('4')
  userId: string;
}

export class ShareLinkDto extends ShareBaseDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 365,
    description: 'How long the link stays usable. Defaults to SHARE_LINK_TTL_DAYS.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}

export class SetPoolVisibilityDto {
  @ApiProperty({ enum: NetworkVisibility })
  @IsEnum(NetworkVisibility)
  visibility: NetworkVisibility;
}

export class PoolSearchDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Free-text match on name or bio' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  gender?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;
}

export class AgentDirectoryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Match on agency name or city' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class PostProposalNoteDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Which side you are writing for. Inferred when you control only one.',
  })
  @IsOptional()
  @IsUUID('4')
  profileId?: string;
}

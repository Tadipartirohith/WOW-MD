import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/** Agents act under a client identity; everyone else omits this. */
class OnBehalfOfDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'AGENT only: the managed client whose matchmaking identity to act under',
  })
  @IsOptional()
  @IsUUID('4')
  onBehalfOfUserId?: string;
}

export class SendInterestDto extends OnBehalfOfDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  toUserId: string;
}

export class SuggestionsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  onBehalfOfUserId?: string;
}

export class SubjectQueryDto extends OnBehalfOfDto {}

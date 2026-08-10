import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class SendInterestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  toUserId: string;
}

export class SuggestionsQueryDto extends PaginationDto {}

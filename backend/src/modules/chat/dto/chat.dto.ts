import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class SendMessageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  toUserId: string;

  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MaxLength(4000)
  body: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mediaUrl?: string;
}

export class MessageHistoryQueryDto extends PaginationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  withUserId: string;
}

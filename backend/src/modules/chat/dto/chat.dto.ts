import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, IsUrl, MaxLength, MinLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class SendMessageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  toUserId: string;

  @ApiProperty({ minLength: 1, maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;

  @ApiPropertyOptional({ maxLength: 2048 })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  mediaUrl?: string;
}

export class MessageHistoryQueryDto extends PaginationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  withUserId: string;
}

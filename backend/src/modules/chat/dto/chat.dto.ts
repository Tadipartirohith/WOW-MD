import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsUploadedUrl } from '../../../common/decorators/uploaded-url.decorator';
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
  @IsUploadedUrl()
  @MaxLength(2048)
  mediaUrl?: string;
}

export class MessageHistoryQueryDto extends PaginationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  withUserId: string;
}

/** Blocking somebody, with a note only the blocker ever sees. */
export class BlockUserDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  userId: string;

  @ApiPropertyOptional({ maxLength: 500, description: 'For your own reference.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/**
 * Reporting somebody.
 *
 * The reasons are a fixed list rather than free text: a report that has to be
 * read before it can be triaged is a report that sits in a queue, and these are
 * the categories an investigator actually sorts by.
 */
export class ReportUserDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  userId: string;

  @ApiProperty({
    enum: ['harassment', 'fake_profile', 'asking_for_money', 'abusive_language', 'spam', 'other'],
  })
  @IsIn(['harassment', 'fake_profile', 'asking_for_money', 'abusive_language', 'spam', 'other'])
  reason: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  detail?: string;
}

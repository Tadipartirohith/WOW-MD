import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { IsUploadedUrl } from '../../../common/decorators/uploaded-url.decorator';
import { MediaType } from '../../../common/enums';

export class CreateAlbumDto {
  @ApiProperty({ minLength: 1, maxLength: 150 })
  @IsString() @MinLength(1) @MaxLength(150)
  title: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class PresignDto {
  /**
   * Constrained to a bare filename with a known media extension. Without the
   * pattern this value reaches object-storage key construction, where `../`
   * segments would let a caller write outside their own prefix.
   */
  @ApiProperty({ example: 'photo.jpg', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp|gif|heic|mp4|mov|webm)$/i, {
    message: 'filename must be a simple name with a supported image or video extension',
  })
  filename: string;
}

/**
 * An upload slot for evidence: a receipt, an invoice, a screenshot.
 *
 * A separate class from `PresignDto` rather than a widened one, because the two
 * are answering different questions. A profile photograph must be an image —
 * accepting a PDF there produces a biodata that renders as a broken box. A
 * support attachment is whatever proves the point, and in practice that is as
 * often an invoice as a photograph. The album route stays image-and-video only.
 */
export class PresignAttachmentDto {
  @ApiProperty({ example: 'invoice.pdf', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp|heic|pdf)$/i, {
    message: 'filename must be a simple name ending in an image extension or .pdf',
  })
  filename: string;
}

export class AddMediaItemDto {
  @ApiProperty({ maxLength: 2048 })
  @IsUploadedUrl()
  @MaxLength(2048)
  url: string;

  @ApiPropertyOptional({ enum: MediaType, default: MediaType.IMAGE })
  @IsOptional()
  @IsEnum(MediaType)
  type?: MediaType;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;
}

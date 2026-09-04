import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { IsUploadedUrl } from '../../../common/decorators/uploaded-url.decorator';
import { IsStrictString } from '../../../common/decorators/strict-type.decorator';
import { MediaType } from '../../../common/enums';

export class CreateAlbumDto {
  @ApiProperty({ minLength: 1, maxLength: 150 })
  @IsStrictString() @MinLength(1) @MaxLength(150)
  title: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

/**
 * The extensions a browser will actually render, plus the ones phones produce.
 *
 * `jfif` is not a curiosity: Chrome on Windows saves ordinary JPEGs under it,
 * so a photograph downloaded and re-uploaded arrives with that extension
 * through no choice of the person doing it. `avif` and `heic` are what recent
 * phones write by default.
 */
export const UPLOAD_IMAGE_EXTENSIONS =
  'jpg|jpeg|jpe|jfif|pjpeg|png|apng|webp|gif|bmp|avif|heic|heif|tif|tiff';
export const UPLOAD_VIDEO_EXTENSIONS = 'mp4|m4v|mov|webm|3gp';

/**
 * Any filename a real device produces, judged on its extension alone.
 *
 * The previous pattern also demanded `^[A-Za-z0-9._-]+$` for the name, which is
 * the rule that produced "it is not taking all types of images". It was not the
 * type it objected to — it was the name. `WhatsApp Image 2026-08-26 at 5.28.11
 * PM.jpeg` has spaces. `pic (1).png` is what Windows calls the second copy of
 * anything. Both are jpeg and png, and both were refused, so the message the
 * uploader saw was about images when the objection was about punctuation.
 *
 * The name is not the security boundary and never was: the storage key is built
 * server-side, the base name is sanitised into it, and the mock storage
 * controller re-resolves the path against its root regardless. Validating the
 * user's filename bought nothing and cost every upload with a space in it.
 */
/**
 * The name part, kept raw so the regex engine sees the escapes rather than
 * the template literal eating them. Path separators and control characters
 * are the only things excluded, and only so a name cannot look like a path
 * at a glance; the key is still built server-side, and the storage
 * controller still resolves it against its own root before writing a byte.
 */
const NAME_PART = String.raw`[^\\/\x00-\x1f]{1,200}`;

const FILENAME = new RegExp(
  `^${NAME_PART}\\.(${UPLOAD_IMAGE_EXTENSIONS}|${UPLOAD_VIDEO_EXTENSIONS})$`,
  'i',
);

export class PresignDto {
  @ApiProperty({ example: 'holiday photo (1).jpeg', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @Matches(FILENAME, {
    message:
      'Choose an image or video file. Accepted: JPEG, PNG, WebP, GIF, BMP, AVIF, HEIC, TIFF, MP4, MOV, WebM.',
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
  @ApiProperty({ example: 'invoice april 2026.pdf', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @Matches(new RegExp(`^${NAME_PART}\\.(${UPLOAD_IMAGE_EXTENSIONS}|pdf)$`, 'i'), {
    message: 'Choose an image or a PDF.',
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

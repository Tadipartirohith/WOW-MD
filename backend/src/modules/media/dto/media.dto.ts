import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { MediaType } from '../../../common/enums';

export class CreateAlbumDto {
  @ApiProperty()
  @IsString()
  title: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class PresignDto {
  @ApiProperty({ example: 'photo.jpg' })
  @IsString()
  filename: string;
}

export class AddMediaItemDto {
  @ApiProperty()
  @IsString()
  url: string;

  @ApiPropertyOptional({ enum: MediaType, default: MediaType.IMAGE })
  @IsOptional()
  @IsEnum(MediaType)
  type?: MediaType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  caption?: string;
}

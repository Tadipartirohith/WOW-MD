import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { MediaService } from './media.service';
import { AddMediaItemDto, CreateAlbumDto, PresignDto } from './dto/media.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @ApiBearerAuth()
  @Post('albums')
  createAlbum(@CurrentUser('userId') userId: string, @Body() dto: CreateAlbumDto) {
    return this.media.createAlbum(userId, dto);
  }

  @ApiBearerAuth()
  @Get('albums')
  listAlbums(@CurrentUser('userId') userId: string) {
    return this.media.listAlbums(userId);
  }

  @ApiBearerAuth()
  @Post('albums/:id/presign')
  presign(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) _id: string,
    @Body() dto: PresignDto,
  ) {
    return this.media.presignUpload(userId, dto.filename);
  }

  @ApiBearerAuth()
  @Post('albums/:id/items')
  addItem(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMediaItemDto,
  ) {
    return this.media.addItem(userId, id, dto);
  }

  @ApiBearerAuth()
  @Get('albums/:id/items')
  listItems(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.listItems(userId, id);
  }

  @Public()
  @Get('shared/:token')
  shared(@Param('token') token: string) {
    return this.media.getShared(token);
  }
}

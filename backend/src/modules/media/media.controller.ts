import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { MediaService } from './media.service';
import {
  AddMediaItemDto,
  CreateAlbumDto,
  PresignAttachmentDto,
  PresignDto,
} from './dto/media.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @ApiBearerAuth()
  @RequirePermissions(Permission.MEDIA_MANAGE_OWN)
  @Post('albums')
  createAlbum(@CurrentUser('userId') userId: string, @Body() dto: CreateAlbumDto) {
    return this.media.createAlbum(userId, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.MEDIA_MANAGE_OWN)
  @Get('albums')
  listAlbums(@CurrentUser('userId') userId: string) {
    return this.media.listAlbums(userId);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.MEDIA_MANAGE_OWN)
  @Post('albums/:id/presign')
  presign(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) _id: string,
    @Body() dto: PresignDto,
  ) {
    return this.media.presignUpload(userId, dto.filename);
  }

  /**
   * An upload slot for a profile photograph.
   *
   * Separate from the album route because the two are different permissions and
   * different owners: albums belong to the couple and need `MEDIA_MANAGE_OWN`,
   * which an agent does not hold — yet an agent sets profile photographs for
   * every client on their books.
   * Without this the profile editors could only take a URL, so an agent had to
   * upload somewhere else first and paste a link back in.
   */
  @ApiBearerAuth()
  @RequirePermissions(Permission.PROFILE_MANAGE_OWN)
  @ApiOperation({ summary: 'Get an upload URL for a profile photograph' })
  @Post('profile-photo/presign')
  presignProfilePhoto(@CurrentUser('userId') userId: string, @Body() dto: PresignDto) {
    return this.media.presignUpload(userId, dto.filename);
  }

  /**
   * An upload slot for something a person is attaching as proof.
   *
   * Gated on `CASE_RAISE` rather than on a media permission: everybody who can
   * raise a complaint needs to be able to attach the receipt for it, and that
   * includes a vendor, who holds no media permissions at all. Attaching a
   * document to a support case went through the *profile photograph* route
   * before this existed, which refused every PDF anybody tried.
   */
  @ApiBearerAuth()
  @RequirePermissions(Permission.CASE_RAISE)
  @ApiOperation({ summary: 'Get an upload URL for evidence — an image or a PDF' })
  @Post('attachment/presign')
  presignAttachment(
    @CurrentUser('userId') userId: string,
    @Body() dto: PresignAttachmentDto,
  ) {
    return this.media.presignUpload(userId, dto.filename);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.MEDIA_MANAGE_OWN)
  @Post('albums/:id/items')
  addItem(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMediaItemDto,
  ) {
    return this.media.addItem(userId, id, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.MEDIA_MANAGE_OWN)
  @Get('albums/:id/items')
  listItems(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.listItems(userId, id);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.MEDIA_MANAGE_OWN)
  @ApiOperation({ summary: 'Remove one photograph from an album' })
  @Delete('albums/:id/items/:itemId')
  removeItem(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.media.removeItem(userId, id, itemId);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.MEDIA_MANAGE_OWN)
  @ApiOperation({
    summary: 'Delete an album and everything in it',
    description:
      'The photographs go with it. There is no cascade on the key, so removing the album alone ' +
      'would leave them as rows pointing at nothing.',
  })
  @Delete('albums/:id')
  removeAlbum(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.removeAlbum(userId, id);
  }

  @Public()
  @Get('shared/:token')
  shared(@Param('token') token: string) {
    return this.media.getShared(token);
  }
}

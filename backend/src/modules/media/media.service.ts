import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Album } from './entities/album.entity';
import { MediaItem } from './entities/media-item.entity';
import { AddMediaItemDto, CreateAlbumDto } from './dto/media.dto';
import { MediaStorageProvider } from './media-storage.provider';
import { AppConfigService } from '../../config/app-config.service';
import { MediaType } from '../../common/enums';

@Injectable()
export class MediaService {
  constructor(
    @InjectRepository(Album) private readonly albums: Repository<Album>,
    @InjectRepository(MediaItem) private readonly items: Repository<MediaItem>,
    private readonly storage: MediaStorageProvider,
    private readonly cfg: AppConfigService,
  ) {}

  createAlbum(userId: string, dto: CreateAlbumDto) {
    return this.albums.save(
      this.albums.create({
        userId,
        title: dto.title,
        isPublic: dto.isPublic ?? false,
        shareToken: randomUUID(),
      }),
    );
  }

  listAlbums(userId: string) {
    return this.albums.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  presignUpload(userId: string, filename: string) {
    return this.storage.presign(userId, filename);
  }

  async addItem(userId: string, albumId: string, dto: AddMediaItemDto) {
    const album = await this.getOwnedAlbum(userId, albumId);
    return this.items.save(
      this.items.create({
        albumId: album.id,
        url: dto.url,
        type: dto.type ?? MediaType.IMAGE,
        caption: dto.caption,
      }),
    );
  }

  async listItems(userId: string, albumId: string) {
    await this.getOwnedAlbum(userId, albumId);
    return this.items.find({ where: { albumId }, order: { createdAt: 'DESC' } });
  }

  /** Public shareable view, resolves an album (and its items) by share token. */
  async getShared(shareToken: string) {
    const album = await this.albums.findOne({ where: { shareToken, isPublic: true } });
    if (!album) throw new NotFoundException('Shared album not found');
    const items = await this.items.find({ where: { albumId: album.id } });
    return { album, items, shareUrl: `${this.cfg.media.shareBaseUrl}/${shareToken}` };
  }

  private async getOwnedAlbum(userId: string, albumId: string): Promise<Album> {
    const album = await this.albums.findOne({ where: { id: albumId } });
    if (!album) throw new NotFoundException('Album not found');
    if (album.userId !== userId) throw new ForbiddenException('Not your album');
    return album;
  }
}

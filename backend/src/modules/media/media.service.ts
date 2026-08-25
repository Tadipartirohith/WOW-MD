import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Album } from './entities/album.entity';
import { MediaItem } from './entities/media-item.entity';
import { AddMediaItemDto, CreateAlbumDto } from './dto/media.dto';
import { MediaStorageProvider } from './media-storage.provider';
import { AppConfigService } from '../../config/app-config.service';
import { MediaType } from '../../common/enums';
import { ModerationService } from '../../platform/moderation/moderation.service';

/** An album as the gallery screen needs it: what is in it, and what it looks like. */
export interface AlbumCard extends Album {
  itemCount: number;
  coverUrl: string | null;
  shareUrl: string | null;
}

@Injectable()
export class MediaService {
  constructor(
    @InjectRepository(Album) private readonly albums: Repository<Album>,
    @InjectRepository(MediaItem) private readonly items: Repository<MediaItem>,
    private readonly storage: MediaStorageProvider,
    private readonly cfg: AppConfigService,
    private readonly moderation: ModerationService,
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

  /**
   * The albums, as cards rather than as rows.
   *
   * A list of titles is not a photo album — it is a list of titles. What makes
   * the screen usable is the count and the cover, and both were left to the
   * client, which could only get them by opening every album in turn. One query
   * for the counts and one for the covers beats N of each.
   */
  async listAlbums(userId: string): Promise<AlbumCard[]> {
    const albums = await this.albums.find({ where: { userId }, order: { createdAt: 'DESC' } });
    if (albums.length === 0) return [];

    const ids = albums.map((a) => a.id);
    const items = await this.items.find({
      where: { albumId: In(ids) },
      order: { createdAt: 'ASC' },
    });

    return albums.map((album) => {
      const mine = items.filter((i) => i.albumId === album.id);
      return {
        ...album,
        itemCount: mine.length,
        // The first photograph added, not the newest. An album's cover
        // changing every time somebody uploads is disorienting on a screen
        // people recognise their own albums by.
        coverUrl: mine.find((i) => i.type === MediaType.IMAGE)?.url ?? null,
        shareUrl: album.isPublic ? `${this.cfg.media.shareBaseUrl}/${album.shareToken}` : null,
      };
    });
  }

  /**
   * Removes one photograph.
   *
   * Ownership is checked through the album rather than on the item, so an item
   * id from somebody else's album resolves to nothing rather than to a
   * deletion.
   */
  async removeItem(userId: string, albumId: string, itemId: string) {
    const album = await this.getOwnedAlbum(userId, albumId);
    const result = await this.items.delete({ id: itemId, albumId: album.id });
    if (!result.affected) throw new NotFoundException('That photo is not in this album');
    return { removed: true };
  }

  /**
   * Removes an album and everything in it.
   *
   * The items go first and explicitly. There is no cascade on the foreign key,
   * so deleting the album alone would leave its photographs behind as rows
   * pointing at nothing — invisible, undeletable, and counted by nothing.
   */
  async removeAlbum(userId: string, albumId: string) {
    const album = await this.getOwnedAlbum(userId, albumId);
    await this.items.delete({ albumId: album.id });
    await this.albums.delete({ id: album.id });
    return { removed: true };
  }

  presignUpload(userId: string, filename: string) {
    return this.storage.presign(userId, filename);
  }

  async addItem(userId: string, albumId: string, dto: AddMediaItemDto) {
    const album = await this.getOwnedAlbum(userId, albumId);

    // Album photographs are shareable, and a shared album is a claim about a
    // real wedding in the same way a profile is a claim about a real person.
    // Videos are left alone: the detector scores stills.
    if ((dto.type ?? MediaType.IMAGE) === MediaType.IMAGE) {
      await this.moderation.assertGenuinePhoto(dto.url, { userId, kind: 'album' });
    }

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

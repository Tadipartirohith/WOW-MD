import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Album } from './entities/album.entity';
import { MediaItem } from './entities/media-item.entity';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { MediaStorageProvider } from './media-storage.provider';
import { MockStorageController } from './mock-storage.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Album, MediaItem])],
  providers: [MediaService, MediaStorageProvider],
  // The mock storage endpoint exists only where the mock provider does. With
  // MEDIA_STORAGE_PROVIDER=s3 the browser PUTs to a real presigned S3 URL and
  // these routes are not registered at all.
  controllers:
    (process.env.MEDIA_STORAGE_PROVIDER || 'mock') === 'mock'
      ? [MediaController, MockStorageController]
      : [MediaController],
  exports: [MediaService],
})
export class MediaModule {}

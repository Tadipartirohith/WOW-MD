import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Album } from './entities/album.entity';
import { MediaItem } from './entities/media-item.entity';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { MediaStorageProvider } from './media-storage.provider';

@Module({
  imports: [TypeOrmModule.forFeature([Album, MediaItem])],
  providers: [MediaService, MediaStorageProvider],
  controllers: [MediaController],
  exports: [MediaService],
})
export class MediaModule {}

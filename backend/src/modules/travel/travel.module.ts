import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Destination } from './entities/destination.entity';
import { TravelPackage } from './entities/travel-package.entity';
import { Itinerary } from './entities/itinerary.entity';
import { TravelService } from './travel.service';
import { TravelController } from './travel.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Destination, TravelPackage, Itinerary])],
  providers: [TravelService],
  controllers: [TravelController],
  exports: [TravelService],
})
export class TravelModule {}

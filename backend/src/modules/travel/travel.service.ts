import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Destination } from './entities/destination.entity';
import { TravelPackage } from './entities/travel-package.entity';
import { Itinerary } from './entities/itinerary.entity';
import { CreateItineraryDto } from './dto/travel.dto';
import { RedisService } from '../../platform/redis/redis.service';

@Injectable()
export class TravelService {
  constructor(
    @InjectRepository(Destination) private readonly destinations: Repository<Destination>,
    @InjectRepository(TravelPackage) private readonly packages: Repository<TravelPackage>,
    @InjectRepository(Itinerary) private readonly itineraries: Repository<Itinerary>,
    private readonly redis: RedisService,
  ) {}

  listDestinations() {
    return this.redis.wrap('travel:destinations', 600, () =>
      this.destinations.find({ order: { name: 'ASC' } }),
    );
  }

  listPackages(destinationId: string) {
    return this.packages.find({ where: { destinationId }, order: { price: 'ASC' } });
  }

  createItinerary(userId: string, dto: CreateItineraryDto) {
    return this.itineraries.save(
      this.itineraries.create({
        userId,
        title: dto.title,
        packageId: dto.packageId ?? null,
        items: dto.items,
      }),
    );
  }

  listItineraries(userId: string) {
    return this.itineraries.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }
}

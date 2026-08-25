import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Destination } from './entities/destination.entity';
import { TravelPackage } from './entities/travel-package.entity';
import { Itinerary } from './entities/itinerary.entity';
import { CreateItineraryDto, PackageSearchDto } from './dto/travel.dto';
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

  /**
   * Packages across every destination, with the destination attached.
   *
   * The per-destination route stays for a destination page; this is the one a
   * couple actually shops from. Filtering happens in SQL rather than after the
   * fact so a tight budget does not first load the whole catalogue.
   */
  async searchPackages(q: PackageSearchDto) {
    const qb = this.packages
      .createQueryBuilder('p')
      .innerJoin(Destination, 'd', 'd.id = p."destinationId"')
      .select([
        'p.id AS id',
        'p.title AS title',
        'p.price AS price',
        'p.nights AS nights',
        'p.inclusions AS inclusions',
        'd.id AS "destinationId"',
        'd.name AS "destinationName"',
        'd.country AS country',
        'd."imageUrl" AS "imageUrl"',
        'd.description AS "destinationDescription"',
        'd.tags AS tags',
      ]);

    if (q.destinationId) qb.andWhere('p."destinationId" = :id', { id: q.destinationId });
    // Containment against the jsonb tag array, so 'honeymoon' matches a
    // destination tagged ["beach","honeymoon"] without a LIKE over the text.
    if (q.tag) qb.andWhere('d.tags @> :tag::jsonb', { tag: JSON.stringify([q.tag]) });
    if (q.maxPrice !== undefined) qb.andWhere('p.price <= :maxPrice', { maxPrice: q.maxPrice });
    if (q.minNights !== undefined) qb.andWhere('p.nights >= :minNights', { minNights: q.minNights });
    if (q.maxNights !== undefined) qb.andWhere('p.nights <= :maxNights', { maxNights: q.maxNights });

    return qb.orderBy('p.price', 'ASC').getRawMany();
  }

  createItinerary(userId: string, dto: CreateItineraryDto) {
    return this.itineraries.save(
      this.itineraries.create({
        userId,
        title: dto.title,
        packageId: dto.packageId ?? null,
        items: dto.items ?? [],
      }),
    );
  }

  listItineraries(userId: string) {
    return this.itineraries.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }
}

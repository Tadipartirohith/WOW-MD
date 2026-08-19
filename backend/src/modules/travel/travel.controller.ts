import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TravelService } from './travel.service';
import { CreateItineraryDto } from './dto/travel.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

@ApiTags('travel')
@Controller('travel')
export class TravelController {
  constructor(private readonly travel: TravelService) {}

  @Public()
  @Get('destinations')
  destinations() {
    return this.travel.listDestinations();
  }

  @Public()
  @Get('destinations/:id/packages')
  packages(@Param('id', ParseUUIDPipe) id: string) {
    return this.travel.listPackages(id);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.TRAVEL_BOOK)
  @Post('itineraries')
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateItineraryDto) {
    return this.travel.createItinerary(userId, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.TRAVEL_BOOK)
  @Get('itineraries')
  list(@CurrentUser('userId') userId: string) {
    return this.travel.listItineraries(userId);
  }
}

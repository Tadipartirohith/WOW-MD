import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TravelService } from './travel.service';
import { CreateItineraryDto, PackageSearchDto } from './dto/travel.dto';
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
  @ApiOperation({
    summary: 'Browse packages across every destination',
    description: 'Filter by budget, nights and destination tag — tag=honeymoon for the honeymoon catalogue.',
  })
  @Get('packages')
  searchPackages(@Query() q: PackageSearchDto) {
    return this.travel.searchPackages(q);
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

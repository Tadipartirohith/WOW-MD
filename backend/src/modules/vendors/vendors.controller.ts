import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { VendorsService } from './vendors.service';
import { CreateReviewDto, CreateVendorDto, VendorSearchDto } from './dto/vendor.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums';

@ApiTags('vendors')
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @ApiBearerAuth()
  @Roles(UserRole.VENDOR, UserRole.ADMIN)
  @Post()
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateVendorDto) {
    return this.vendors.create(userId, dto);
  }

  @Public()
  @Get('search')
  search(@Query() q: VendorSearchDto) {
    return this.vendors.search(q);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.findOne(id);
  }

  @ApiBearerAuth()
  @Post(':id/reviews')
  review(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.vendors.addReview(id, userId, dto);
  }
}

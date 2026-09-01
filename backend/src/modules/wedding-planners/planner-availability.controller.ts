import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AvailabilityService } from '../vendors/availability.service';
import {
  AvailabilityQueryDto,
  BlockSlotDto,
  CreateSlotDto,
  UpdateSlotDto,
} from '../vendors/dto/availability.dto';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';
import { ProviderType } from '../../common/enums';

/**
 * A planner's calendar, on the same machinery as a vendor's.
 *
 * A planner takes bookings against dates exactly as a caterer does, and
 * bookings have carried `providerType` since they were written — availability
 * was the one part of that story keyed to vendors alone, so a planner had no
 * way to publish the weeks they could take work in and a couple looking at
 * them had nothing to read.
 *
 * These delegate to the same service rather than reimplementing it. Slots,
 * capacity, blocking, clash detection and the rolling six-month window are the
 * same question for both, and two copies would drift on the first bug fixed in
 * only one of them. The single genuine difference — whose listing this is —
 * lives in the service's ownership check, which now asks the right table.
 */
@ApiTags('planner-availability')
@ApiBearerAuth()
@Controller('wedding-planners/:id/availability')
export class PlannerAvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @RequirePermissions(Permission.PLANNER_LISTING_MANAGE)
  @ApiOperation({ summary: 'Publish a week you can take work in' })
  @Post('slots')
  create(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSlotDto,
  ) {
    return this.availability.create(actor, ProviderType.PLANNER, id, dto);
  }

  @RequirePermissions(Permission.PLANNER_LISTING_MANAGE)
  @Put('slots/:slotId')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: UpdateSlotDto,
  ) {
    return this.availability.update(actor, ProviderType.PLANNER, id, slotId, dto);
  }

  @RequirePermissions(Permission.PLANNER_LISTING_MANAGE)
  @Delete('slots/:slotId')
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
  ) {
    return this.availability.remove(actor, ProviderType.PLANNER, id, slotId);
  }

  @RequirePermissions(Permission.PLANNER_LISTING_MANAGE)
  @HttpCode(200)
  @ApiOperation({ summary: 'Hold a week back without deleting it' })
  @Post('slots/:slotId/block')
  block(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: BlockSlotDto,
  ) {
    return this.availability.block(actor, ProviderType.PLANNER, id, slotId, dto);
  }

  @RequirePermissions(Permission.PLANNER_LISTING_MANAGE)
  @HttpCode(200)
  @Post('slots/:slotId/unblock')
  unblock(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
  ) {
    return this.availability.unblock(actor, ProviderType.PLANNER, id, slotId);
  }

  @RequirePermissions(Permission.PLANNER_LISTING_MANAGE)
  @Get('slots')
  list(@Param('id', ParseUUIDPipe) id: string, @Query() q: AvailabilityQueryDto) {
    return this.availability.list(ProviderType.PLANNER, id, q.from, q.to);
  }

  @RequirePermissions(Permission.PLANNER_LISTING_MANAGE)
  @Get('summary')
  summary(@Param('id', ParseUUIDPipe) id: string, @Query() q: AvailabilityQueryDto) {
    return this.availability.summary(ProviderType.PLANNER, id, q.from, q.to);
  }

  @RequirePermissions(Permission.PLANNER_LISTING_MANAGE)
  @ApiOperation({ summary: 'The slots behind one summary card' })
  @Get('slots/by/:bucket')
  bucket(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('bucket') bucket: 'published' | 'open' | 'requested' | 'booked' | 'full' | 'blocked',
    @Query() q: AvailabilityQueryDto,
  ) {
    return this.availability.filtered(ProviderType.PLANNER, id, bucket, q.from, q.to);
  }

  @RequirePermissions(Permission.PLANNER_LISTING_MANAGE)
  @Get('calendar')
  calendar(@Param('id', ParseUUIDPipe) id: string, @Query() q: AvailabilityQueryDto) {
    return this.availability.calendar(ProviderType.PLANNER, id, q.from, q.to);
  }
}

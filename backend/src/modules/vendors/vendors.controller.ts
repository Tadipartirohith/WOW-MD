import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { VendorsService } from './vendors.service';
import { AvailabilityService } from './availability.service';
import { BookingsService } from '../bookings/bookings.service';
import { BusinessLifecycleService } from './business-lifecycle.service';
import {
  AdminReviewQueryDto,
  CreateReviewDto,
  CreateVendorDto,
  ModerateReviewDto,
  PayoutAccountDto,
  UpdateVendorDto,
  VendorSearchDto,
} from './dto/vendor.dto';
import {
  AvailabilityQueryDto,
  BlockSlotDto,
  CreateSlotDto,
  UpdateSlotDto,
} from './dto/availability.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';
import { ProviderType, UserRole } from '../../common/enums';

@ApiTags('vendors')
@Controller('vendors')
export class VendorsController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly availability: AvailabilityService,
    private readonly bookings: BookingsService,
    private readonly lifecycle: BusinessLifecycleService,
  ) {}

  // ------------------------------------------------------------- calendar
  //
  // Availability runs on a rolling six-month window computed from today, so
  // a vendor never has to open a new quarter by hand.

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({ summary: 'Publish a bookable time slot' })
  @Post(':id/availability/slots')
  createSlot(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSlotDto,
  ) {
    return this.availability.create(
      actor,
      ProviderType.VENDOR,
      id, dto,
    );
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({
    summary: 'Amend a slot',
    description: 'Times are fixed once anyone has requested it; capacity can still rise.',
  })
  @Put(':id/availability/slots/:slotId')
  updateSlot(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: UpdateSlotDto,
  ) {
    return this.availability.update(
      actor,
      ProviderType.VENDOR,
      id, slotId, dto,
    );
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({
    summary: 'Delete a slot',
    description: 'Only an untouched one. Anything requested or booked is history — block it instead.',
  })
  @Delete(':id/availability/slots/:slotId')
  deleteSlot(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
  ) {
    return this.availability.remove(
      actor,
      ProviderType.VENDOR,
      id, slotId,
    );
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({ summary: 'Make a slot unavailable without losing it' })
  @HttpCode(200)
  @Post(':id/availability/slots/:slotId/block')
  blockSlot(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: BlockSlotDto,
  ) {
    return this.availability.block(
      actor,
      ProviderType.VENDOR,
      id, slotId, dto,
    );
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @HttpCode(200)
  @Post(':id/availability/slots/:slotId/unblock')
  unblockSlot(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
  ) {
    return this.availability.unblock(
      actor,
      ProviderType.VENDOR,
      id, slotId,
    );
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({ summary: 'Every slot in the window, whatever its status' })
  @Get(':id/availability/slots')
  listSlots(@Param('id', ParseUUIDPipe) id: string, @Query() q: AvailabilityQueryDto) {
    return this.availability.list(
      ProviderType.VENDOR,
      id, q.from, q.to,
    );
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({ summary: 'Counters for the availability dashboard' })
  @Get(':id/availability/summary')
  availabilitySummary(@Param('id', ParseUUIDPipe) id: string, @Query() q: AvailabilityQueryDto) {
    return this.availability.summary(
      ProviderType.VENDOR,
      id, q.from, q.to,
    );
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({
    summary: 'The slots behind one summary card',
    description:
      'Every counter the summary reports opens here. A card that shows a number nothing can ' +
      'be done with is a card that appears clickable and does nothing.',
  })
  @Get(':id/availability/slots/by/:bucket')
  availabilityBucket(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('bucket') bucket: 'published' | 'open' | 'requested' | 'booked' | 'full' | 'blocked',
    @Query() q: AvailabilityQueryDto,
  ) {
    return this.availability.filtered(
      ProviderType.VENDOR,
      id, bucket, q.from, q.to,
    );
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({ summary: 'Per-date rollup, for painting the calendar' })
  @Get(':id/availability/calendar')
  availabilityCalendar(@Param('id', ParseUUIDPipe) id: string, @Query() q: AvailabilityQueryDto) {
    return this.availability.calendar(
      ProviderType.VENDOR,
      id, q.from, q.to,
    );
  }

  @Public()
  @ApiOperation({
    summary: 'Slots a buyer can actually book',
    description:
      'Full and blocked windows are absent rather than greyed out. A window with confirmed ' +
      'bookings but capacity left is present, with its counts, so the buyer sees ' +
      '"3 of 5 taken, 2 left" rather than nothing.',
  })
  @Get(':id/availability')
  bookableSlots(@Param('id', ParseUUIDPipe) id: string, @Query() q: AvailabilityQueryDto) {
    return this.availability.listBookable(
      ProviderType.VENDOR,
      id, q.from, q.to, q.vendorServiceId,
    );
  }

  @Public()
  @ApiOperation({ summary: 'The rolling window the calendar runs on' })
  @Get('availability/window')
  availabilityWindow() {
    return this.availability.window();
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @Post()
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateVendorDto) {
    return this.vendors.create(userId, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({ summary: 'Your own vendor listings' })
  @Get('me')
  listOwn(@CurrentUser('userId') userId: string) {
    return this.vendors.listOwn(userId);
  }

  // ---------------------------------------------------- business lifecycle

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({
    summary: 'What is filled in, and what still blocks submission',
    description:
      'Computed rather than tracked. A "documents complete" flag somebody forgot to clear when ' +
      'a document was removed is worse than no flag: it lets an incomplete listing through.',
  })
  @Get(':id/completion')
  completion(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.lifecycle.completion(actor, id);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({
    summary: 'What this business may do right now',
    description: 'Rendered by the client as-is, so the buttons and the rules cannot drift.',
  })
  @Get(':id/rules')
  rules(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.lifecycle.rulesFor(actor, id);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({
    summary: 'Look the whole listing over before anybody else does',
    description:
      'Still editable at this point: the purpose of a review step is to find things to change, ' +
      'and a review you cannot act on is a confirmation dialog with extra steps.',
  })
  @HttpCode(200)
  @Post(':id/first-review')
  firstReview(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.lifecycle.beginFirstReview(actor, id);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({
    summary: 'Submit for verification',
    description:
      'The listing locks here, and the 72-hour clock starts. The lock is enforced by the update ' +
      'APIs rather than by hiding a button: a vendor who edits their GST number after an officer ' +
      'has been sent to check it has verified nothing.',
  })
  @HttpCode(200)
  @Post(':id/submit-verification')
  submitVerification(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.lifecycle.submitForVerification(actor, id);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({
    summary: 'Where escrow pays out to',
    description:
      'The gateway linked account for this business. Its own route rather than a field on the ' +
      'listing form: it is the one value on a business record that decides where money lands.',
  })
  @Put(':id/payout-account')
  setPayoutAccount(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayoutAccountDto,
  ) {
    return this.vendors.setPayoutAccount(userId, id, dto.payoutAccountId);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @Put(':id')
  update(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVendorDto,
  ) {
    return this.vendors.update(userId, id, dto);
  }

  @Public()
  @Get('search')
  search(@Query() q: VendorSearchDto) {
    return this.vendors.search(q);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({
    summary: 'One of your own businesses, in full',
    description:
      'What the public view withholds: GST, PAN, registered address, compliance documents, ' +
      'and the exact reason a verification was refused or sent back. Owner or administrator ' +
      'only — a refusal written for the vendor is not for their competitors to read.',
  })
  @Get(':id/manage')
  findForOwner(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.findForOwner(actor, id);
  }

  @Public()
  @ApiOperation({
    summary: 'One listing, as a buyer sees it',
    description:
      'The subtractive view. This route and /search are unauthenticated, so what they return ' +
      'is the definition of public: no tax numbers, no registered address, no compliance ' +
      'documents, no payout account, no decision reasoning.',
  })
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.findOne(id);
  }

  /**
   * What people said, with who said it left out.
   *
   * Public, and identical for a buyer and for the vendor being reviewed. That
   * is the point: a vendor who can work out which customer left three stars
   * can take it up with them, and the prospect of that conversation is what
   * stops the next honest review being written. No name, no id, and no booking
   * reference either — a booking reference identifies a customer perfectly
   * well.
   */
  @ApiOperation({ summary: 'Published reviews for a listing, anonymised' })
  @Get(':id/reviews')
  reviews(@Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.listReviews(id);
  }

  /**
   * Reviews are gated on a completed booking so the rating signal reflects real
   * transactions. Agents review on behalf of the client whose booking it was,
   * which is why the check runs against the agent's own completed bookings too.
   *
   * Gated on a completed booking that has not already been reviewed, rather
   * than on having ever bought from this vendor. Two completed jobs are two
   * experiences and earn two reviews; one job cannot be reviewed twice. The
   * old shape allowed unlimited rewrites of a single review, silently, because
   * it upserted.
   */
  @ApiBearerAuth()
  @RequirePermissions(Permission.REVIEW_WRITE)
  @Post(':id/reviews')
  async review(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReviewDto,
  ) {
    let bookingId: string | null = null;
    if (actor.role !== UserRole.ADMIN) {
      const used = await this.vendors.reviewedBookingIds(actor.userId, id);
      const booking = await this.bookings.unreviewedCompletedBooking(
        actor.userId,
        ProviderType.VENDOR,
        id,
        used,
      );
      if (!booking) {
        throw new ForbiddenException(
          used.length > 0
            ? 'You have already reviewed every completed booking with this vendor.'
            : 'You can only review a vendor after a booking with them is completed',
        );
      }
      bookingId = booking.id;
    }
    return this.vendors.addReview(id, actor.userId, bookingId, dto);
  }
}

/**
 * Review moderation, which is the administrator's and nobody else's.
 *
 * Its own controller because it is a different audience with a different view:
 * everything above hides the reviewer, and everything here needs them. A
 * vendor must never reach these routes — being able to hide a review about
 * yourself is the one power that would make the whole rating meaningless — and
 * ADMIN_USERS_READ is held by no provider role.
 */
@ApiTags('admin-reviews')
@ApiBearerAuth()
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly vendors: VendorsService) {}

  @RequirePermissions(Permission.ADMIN_USERS_READ)
  @ApiOperation({ summary: 'Every review, with the reviewer, for moderation' })
  @Get()
  list(@Query() query: AdminReviewQueryDto) {
    return this.vendors.listReviewsForAdmin({
      status: query.status,
      vendorId: query.vendorId,
    });
  }

  @RequirePermissions(Permission.ADMIN_USERS_READ)
  @ApiOperation({
    summary: 'Publish, hold, flag or remove a review',
    description:
      'Anything but publishing needs a reason: the reason is what makes the decision reviewable ' +
      'later, by the next administrator or by a vendor asking why their rating moved.',
  })
  @Put(':id/status')
  moderate(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateReviewDto,
  ) {
    return this.vendors.moderateReview(actor.userId, id, dto.status, dto.reason ?? null);
  }
}

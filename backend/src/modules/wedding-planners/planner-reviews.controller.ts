import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlannerReviewsService } from './planner-reviews.service';
import { WeddingPlannersService } from './wedding-planners.service';
import {
  AdminPlannerReviewQueryDto,
  CreatePlannerReviewDto,
  ModeratePlannerReviewDto,
} from './dto/wedding-planner.dto';
import { BookingsService } from '../bookings/bookings.service';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';
import { ProviderType, UserRole } from '../../common/enums';

/**
 * Reviews on a wedding planner (EZ1-I244).
 *
 * The vendor review routes, for the other kind of provider, and in the same
 * three shapes: what the public sees, what the planner sees of their own, and
 * the one write, gated on a completed booking.
 */
@ApiTags('wedding-planners')
@Controller('wedding-planners')
export class PlannerReviewsController {
  constructor(
    private readonly reviews: PlannerReviewsService,
    private readonly planners: WeddingPlannersService,
    private readonly bookings: BookingsService,
  ) {}

  /**
   * Published reviews, anonymised.
   *
   * Public, and identical for a couple browsing and for the planner being
   * reviewed. A planner who can work out which couple left three stars can
   * take it up with them, and the prospect of that conversation is what stops
   * the next honest review being written.
   */
  @Public()
  @ApiOperation({ summary: 'Published reviews for a planner, anonymised' })
  @Get(':id/reviews')
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.listPublished(id);
  }

  /** The average, the total and the star breakdown — the same figures the
   *  planner's own page shows, for their public profile. */
  @Public()
  @ApiOperation({ summary: 'Rating summary for a planner' })
  @Get(':id/reviews/summary')
  summary(@Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.summary(id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: "A planner's own reviews, with the booking each is about" })
  @RequirePermissions(Permission.PLANNER_LISTING_MANAGE)
  @Get(':id/reviews/mine')
  mine(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.listForOwner(actor.userId, id);
  }

  /**
   * Reviews are gated on a completed booking so the rating reflects real
   * weddings. Agents review on behalf of the client whose booking it was, which
   * is why the check runs against the caller's own completed bookings either
   * way.
   *
   * Two completed weddings with the same planner are two experiences and earn
   * two reviews; one booking cannot be reviewed twice.
   */
  @ApiBearerAuth()
  @RequirePermissions(Permission.REVIEW_WRITE)
  @ApiOperation({ summary: 'Review a planner after a completed booking' })
  @Post(':id/reviews')
  async add(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePlannerReviewDto,
  ) {
    let bookingId: string | null = null;
    if (actor.role !== UserRole.ADMIN) {
      const used = await this.reviews.reviewedBookingIds(actor.userId, id);
      const booking = await this.bookings.unreviewedCompletedBooking(
        actor.userId,
        ProviderType.PLANNER,
        id,
        used,
      );
      if (!booking) {
        throw new ForbiddenException(
          used.length > 0
            ? 'You have already reviewed every completed booking with this planner.'
            : 'You can only review a planner after a booking with them is completed',
        );
      }
      bookingId = booking.id;
    }
    return this.reviews.add(id, actor.userId, bookingId, dto);
  }

  /** Whether this account may write a review, and about which booking. Lets the
   *  portal offer "Rate & Review" only where it would actually be accepted. */
  @ApiBearerAuth()
  @RequirePermissions(Permission.REVIEW_WRITE)
  @ApiOperation({ summary: 'Whether the caller has a completed booking left to review' })
  @Get(':id/reviews/eligibility')
  async eligibility(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const used = await this.reviews.reviewedBookingIds(actor.userId, id);
    const booking = await this.bookings.unreviewedCompletedBooking(
      actor.userId,
      ProviderType.PLANNER,
      id,
      used,
    );
    return {
      canReview: Boolean(booking),
      bookingId: booking?.id ?? null,
      alreadyReviewed: used.length,
    };
  }
}

/**
 * Planner review moderation, which is the administrator's and nobody else's.
 *
 * Its own controller because it is a different audience with a different view:
 * everything above hides the reviewer, and everything here needs them. A
 * planner must never reach these routes — being able to hide a review about
 * yourself is the one power that would make the whole rating meaningless — and
 * ADMIN_USERS_READ is held by no provider role.
 */
@ApiTags('admin-reviews')
@ApiBearerAuth()
@Controller('admin/planner-reviews')
export class AdminPlannerReviewsController {
  constructor(private readonly reviews: PlannerReviewsService) {}

  @RequirePermissions(Permission.ADMIN_USERS_READ)
  @ApiOperation({ summary: 'Every planner review, with the reviewer, for moderation' })
  @Get()
  list(@Query() query: AdminPlannerReviewQueryDto) {
    return this.reviews.listForAdmin({
      status: query.status,
      plannerId: query.plannerId,
      rating: query.rating,
      q: query.q,
    });
  }

  @RequirePermissions(Permission.ADMIN_USERS_READ)
  @ApiOperation({ summary: 'The planners a review can be filtered by' })
  @Get('planners')
  planners() {
    return this.reviews.plannerOptions();
  }

  @RequirePermissions(Permission.ADMIN_USERS_READ)
  @ApiOperation({
    summary: 'Publish, hold, flag or remove a planner review',
    description:
      'Anything but publishing needs a reason: the reason is what makes the decision reviewable ' +
      'later, by the next administrator or by a planner asking why their rating moved.',
  })
  @Put(':id/status')
  moderate(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModeratePlannerReviewDto,
  ) {
    return this.reviews.moderate(actor.userId, id, dto.status, dto.reason ?? null);
  }
}

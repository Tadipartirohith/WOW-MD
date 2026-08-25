import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { QuotationsService } from './quotations.service';
import {
  BookingMessageDto,
  BookingSearchDto,
  CancelBookingDto,
  CreateBookingDto,
  PayDto,
} from './dto/booking.dto';
import { BookingChatService } from './booking-chat.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { RespondQuotationDto, SendQuotationDto } from './dto/quotation.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly quotations: QuotationsService,
    private readonly bookingChat: BookingChatService,
  ) {}

  // ------------------------------------------------------------ booking chat
  //
  // The vendor's conversations are always about a job, so they live on the job.
  // One thread per vendor stops making sense the moment the same vendor has
  // three bookings for the same family.

  @RequirePermissions(Permission.CHAT_INQUIRE)
  @ApiOperation({
    summary: 'Whether this booking can be talked about, and why not',
    description:
      'Chat opens when the advance is held and stops accepting messages when the job is ' +
      'finished or cancelled — readable for good, because what was agreed in it is what a ' +
      'dispute turns on. The note is the same sentence the server would refuse with.',
  })
  @Get(':id/chat')
  chatState(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookingChat.state(actor, id);
  }

  @RequirePermissions(Permission.CHAT_INQUIRE)
  @ApiOperation({ summary: 'The thread on one booking' })
  @Get(':id/messages')
  chatHistory(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: PaginationDto,
  ) {
    return this.bookingChat.history(actor, id, q.page, q.limit);
  }

  @RequirePermissions(Permission.CHAT_INQUIRE)
  @ApiOperation({ summary: 'Say something about this booking' })
  @Post(':id/messages')
  chatSend(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BookingMessageDto,
  ) {
    return this.bookingChat.send(actor, id, dto.body, dto.mediaUrl);
  }

  @RequirePermissions(Permission.CHAT_INQUIRE)
  @ApiOperation({ summary: 'Mark the incoming messages on this booking as read' })
  @Put(':id/messages/read')
  chatRead(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookingChat.markRead(actor, id);
  }

  @RequirePermissions(Permission.BOOKING_CREATE)
  @ApiOperation({
    summary: 'Place a booking',
    description:
      'Individual users book for themselves. Agents may pass onBehalfOfUserId to book for a ' +
      'client on their own books. Vendors and planners cannot reach this route.',
  })
  @Post()
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateBookingDto) {
    return this.bookings.create(actor, dto);
  }

  @RequirePermissions(Permission.BOOKING_READ_OWN)
  @ApiOperation({ summary: 'Bookings you placed (agents: also your clients’)' })
  @Get()
  list(@CurrentUser() actor: AuthUser, @Query() q: BookingSearchDto) {
    return this.bookings.listForBuyer(actor, q);
  }

  @RequirePermissions(Permission.BOOKING_READ_INCOMING)
  @ApiOperation({ summary: 'Bookings made against your vendor/planner listings' })
  @Get('incoming')
  incoming(@CurrentUser() actor: AuthUser, @Query() q: BookingSearchDto) {
    return this.bookings.listIncoming(actor, q);
  }

  @RequirePermissions(Permission.BOOKING_READ_INCOMING)
  @ApiOperation({
    summary: 'Your account: earnings, money still in escrow, and the ledger behind both',
  })
  @Get('earnings')
  earnings(@CurrentUser() actor: AuthUser) {
    return this.bookings.earnings(actor);
  }

  @RequirePermissions(Permission.BOOKING_PAY)
  @ApiOperation({
    summary: 'Pay an escrow milestone',
    description:
      'Defaults to the advance, which is the instalment that secures the booking. Instalments ' +
      'must be paid in order.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Retrying with the same key returns the original payment instead of holding twice.',
  })
  @Put(':id/pay')
  pay(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.bookings.pay(actor, id, { milestone: dto.milestone, idempotencyKey });
  }

  @RequirePermissions(Permission.BOOKING_READ_OWN)
  @ApiOperation({ summary: 'The three escrow instalments and what has been paid against each' })
  @Get(':id/milestones')
  milestones(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.milestones(actor, id);
  }

  // ------------------------------------------------------------- quotations

  @RequirePermissions(Permission.BOOKING_CONFIRM)
  @ApiOperation({
    summary: 'Quote for a request',
    description:
      'Re-quoting supersedes the previous offer rather than editing it, so the price history ' +
      'stays on the record.',
  })
  @Post(':id/quotations')
  sendQuotation(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendQuotationDto,
  ) {
    return this.quotations.send(actor, id, dto);
  }

  @RequirePermissions(Permission.BOOKING_READ_OWN)
  @ApiOperation({ summary: 'Quotations on a booking, newest first. Either side may read them.' })
  @Get(':id/quotations')
  listQuotations(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotations.list(actor, id);
  }

  @RequirePermissions(Permission.BOOKING_PAY)
  @ApiOperation({
    summary: 'Accept a quotation',
    description: 'Sets the booking amount and moves it to payment pending.',
  })
  @Put('quotations/:quotationId/accept')
  acceptQuotation(
    @CurrentUser() actor: AuthUser,
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @Body() dto: RespondQuotationDto,
  ) {
    return this.quotations.accept(actor, quotationId, dto);
  }

  @RequirePermissions(Permission.BOOKING_PAY)
  @ApiOperation({ summary: 'Decline a quotation. The request returns to the provider to re-price.' })
  @Put('quotations/:quotationId/reject')
  rejectQuotation(
    @CurrentUser() actor: AuthUser,
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @Body() dto: RespondQuotationDto,
  ) {
    return this.quotations.reject(actor, quotationId, dto);
  }

  @RequirePermissions(Permission.BOOKING_CONFIRM)
  @Put(':id/confirm')
  confirm(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.confirm(actor, id);
  }

  @RequirePermissions(Permission.BOOKING_CONFIRM)
  @ApiOperation({ summary: 'Mark work as started' })
  @Put(':id/start')
  start(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.startWork(actor, id);
  }

  @RequirePermissions(Permission.BOOKING_COMPLETE)
  @ApiOperation({
    summary: 'Mark the work delivered',
    description:
      'Makes the balance payable rather than completing the booking — paying it is what does ' +
      'that. Refused before the second instalment, and while a case is open.',
  })
  @Put(':id/complete')
  complete(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.completeWork(actor, id);
  }

  @RequirePermissions(Permission.BOOKING_COMPLETE)
  @ApiOperation({
    summary: 'Release the held instalments to the provider',
    description: 'Only once the balance is in and no case is open against the booking.',
  })
  @Put(':id/settle')
  settle(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.settle(actor, id);
  }

  /**
   * Deliberately not permission-gated to one side: both buyer and provider may
   * cancel, and the service resolves which side the caller is on.
   */
  @Put(':id/cancel')
  cancel(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelBookingDto,
  ) {
    return this.bookings.cancel(actor, id, dto.reason);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { EventsService } from './events.service';
import {
  CreateEventDto,
  CreateGuestDto,
  GuestRsvpDto,
  SharedRsvpDto,
  EventQueryDto,
  InviteDto,
  UpdateEventDto,
  UpdateGuestDto,
  UpdateRsvpDto,
} from './dto/event.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

@ApiTags('events')
@ApiBearerAuth()
@RequirePermissions(Permission.EVENT_MANAGE_OWN)
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateEventDto) {
    return this.events.createEvent(userId, dto);
  }

  /**
   * The couples whose weddings this planner is running.
   *
   * Empty for everybody else, which is what makes the picker on the Events
   * page appear only for a planner without a role check in the client.
   */
  @ApiOperation({ summary: 'Clients whose events you may work on' })
  @Get('engaged')
  engaged(@CurrentUser() actor: AuthUser) {
    return this.events.engagedHosts(actor.userId);
  }

  @ApiOperation({
    summary: 'The days of a wedding',
    description:
      'A planner may pass hostUserId to work on a wedding they were engaged for; anybody else ' +
      'sees their own. Refused if the engagement does not exist.',
  })
  @Get()
  async list(
    @CurrentUser() actor: AuthUser,
    @Query() q: EventQueryDto,
    @Query('hostUserId') hostUserId?: string,
  ) {
    const host = await this.events.resolveHost(actor, hostUserId);
    return this.events.listEvents(host, q);
  }

  @ApiOperation({
    summary: 'The counters above the list',
    description:
      'Computed from the rows rather than maintained, so they cannot drift from what the list ' +
      'below them shows.',
  })
  @Get('summary')
  summary(@CurrentUser('userId') userId: string) {
    return this.events.eventSummary(userId);
  }

  @Put(':id')
  updateEvent(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.events.updateEvent(userId, id, dto);
  }

  @Delete(':id')
  removeEvent(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.removeEvent(userId, id);
  }

  @Get(':id/vendors')
  eventVendors(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.eventVendors(userId, id);
  }

  @Post('guests')
  addGuest(@CurrentUser('userId') userId: string, @Body() dto: CreateGuestDto) {
    return this.events.addGuest(userId, dto);
  }

  @Get('guests')
  listGuests(@CurrentUser('userId') userId: string) {
    return this.events.listGuests(userId);
  }

  @Post(':id/invite')
  invite(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InviteDto,
  ) {
    return this.events.invite(userId, id, dto.guestId);
  }

  @Put('guests/:id')
  updateGuest(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGuestDto,
  ) {
    return this.events.updateGuest(userId, id, dto);
  }

  @Get(':id/guest-list')
  guestList(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.guestList(userId, id);
  }

  // ------------------------------------------------------------------ RSVP

  @ApiOperation({
    summary: 'The numbers an organiser plans from',
    description:
      'Total invited, coming, not coming and not responded — each as both invitations and ' +
      'people, because an invitation goes to a family and the caterer counts heads. "Maybe" ' +
      'is reported separately rather than folded into either side: somebody who answered ' +
      '"probably" has answered.',
  })
  @Get(':id/rsvp')
  rsvpDashboard(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.rsvpDashboard(userId, id);
  }

  @ApiOperation({
    summary: 'The guests behind one number on the dashboard',
    description:
      'coming | not_coming | maybe | not_responded | all. Every row carries the name, the ' +
      'mobile number, the head count, the reason for a refusal and when they were last chased.',
  })
  @Get(':id/rsvp/:category')
  rsvpGuests(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('category') category: string,
  ) {
    return this.events.rsvpGuests(userId, id, category);
  }

  @ApiOperation({
    summary: 'Chase an invitation nobody has answered',
    description:
      'Records the chase whether or not there is an email address to send to — an organiser ' +
      'who rang them still needs the list to say so.',
  })
  // A chase is not a creation — it updates an invitation that already exists.
  @HttpCode(200)
  @Post('invites/:id/remind')
  remind(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.remind(userId, id);
  }

  /**
   * Guests are not platform users, so these two routes are token-addressed
   * rather than authenticated. The token only ever reaches one invite.
   */
  @Public()
  @Get('rsvp/:token')
  rsvpPreview(@Param('token') token: string) {
    return this.events.previewByToken(token);
  }

  /*
   * The open invitation: one link for a day, answered by anybody who has it.
   *
   * Separate from the per-guest token above rather than an option on it. That
   * one is addressed to a person the host already entered; this one exists
   * because the host has not entered anybody, and the reply is what creates
   * the guest. Sharing the two paths would mean one route that sometimes
   * knows who is asking and sometimes does not.
   */
  @ApiOperation({ summary: 'Create or rotate the shareable invitation link for a day' })
  @Post(':id/share-link')
  createShareLink(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.events.createShareLink(userId, id);
  }

  @ApiOperation({ summary: 'Stop the shareable link working. Guests who used it are kept.' })
  @Delete(':id/share-link')
  revokeShareLink(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.events.revokeShareLink(userId, id);
  }

  @Public()
  @ApiOperation({ summary: 'The invitation behind a shared link' })
  @Get('share/:token')
  sharedPreview(@Param('token') token: string) {
    return this.events.previewShared(token);
  }

  @Public()
  @ApiOperation({ summary: 'Answer a shared invitation. The reply creates the guest.' })
  @Post('share/:token')
  sharedRespond(@Param('token') token: string, @Body() dto: SharedRsvpDto) {
    return this.events.respondShared(token, dto);
  }

  @Public()
  @Put('rsvp/:token')
  rsvpRespond(@Param('token') token: string, @Body() dto: GuestRsvpDto) {
    return this.events.respondByToken(token, dto);
  }

  @Put('invites/:id/rsvp')
  rsvp(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRsvpDto,
  ) {
    return this.events.updateRsvp(userId, id, dto);
  }
}

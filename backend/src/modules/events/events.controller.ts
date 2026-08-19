import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { EventsService } from './events.service';
import {
  CreateEventDto,
  CreateGuestDto,
  GuestRsvpDto,
  InviteDto,
  UpdateRsvpDto,
} from './dto/event.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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

  @Get()
  list(@CurrentUser('userId') userId: string) {
    return this.events.listEvents(userId);
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

  @Get(':id/guest-list')
  guestList(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.guestList(userId, id);
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

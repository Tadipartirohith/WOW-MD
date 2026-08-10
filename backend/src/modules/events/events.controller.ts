import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { EventsService } from './events.service';
import { CreateEventDto, CreateGuestDto, InviteDto, UpdateRsvpDto } from './dto/event.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('events')
@ApiBearerAuth()
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
  invite(@Param('id', ParseUUIDPipe) id: string, @Body() dto: InviteDto) {
    return this.events.invite(id, dto.guestId);
  }

  @Get(':id/guest-list')
  guestList(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.guestList(id);
  }

  @Put('invites/:id/rsvp')
  rsvp(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRsvpDto) {
    return this.events.updateRsvp(id, dto);
  }
}

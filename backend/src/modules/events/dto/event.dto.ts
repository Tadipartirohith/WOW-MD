import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsUploadedUrl } from '../../../common/decorators/uploaded-url.decorator';
import { Transform } from 'class-transformer';
import { EventCategory, EventStatus, RsvpStatus } from '../../../common/enums';
import { MOBILE_MESSAGE, MOBILE_PATTERN, normaliseMobile } from '../../../common/util/identity-fields';

export class CreateEventDto {
  @ApiProperty({ example: 'Mehendi', minLength: 1, maxLength: 120 })
  @IsString() @MinLength(1) @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional() @IsDateString()
  eventDate?: string;

  @ApiPropertyOptional({ maxLength: 240 })
  @IsOptional() @IsString() @MaxLength(240)
  venue?: string;

  @ApiPropertyOptional({ example: 'Sangeet', maxLength: 60 })
  @IsOptional() @IsString() @MaxLength(60)
  eventType?: string;

  @ApiPropertyOptional({ enum: EventCategory })
  @IsOptional() @IsEnum(EventCategory)
  category?: EventCategory;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500)
  venueAddress?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional() @IsString() @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: '19:00', description: '24-hour HH:MM.' })
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Use a 24-hour time like 19:00' })
  startTime?: string;

  @ApiPropertyOptional({ example: '23:00' })
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Use a 24-hour time like 23:00' })
  endTime?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100000 })
  @IsOptional() @IsInt() @Min(0) @Max(100_000)
  expectedGuests?: number;

  @ApiPropertyOptional({ example: '250000.00' })
  @IsOptional() @IsNumberString()
  budget?: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional() @IsString() @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsUploadedUrl()
  imageUrl?: string;

  @ApiPropertyOptional({ enum: EventStatus })
  @IsOptional() @IsEnum(EventStatus)
  status?: EventStatus;
}

/** Everything on an event is amendable — dates move, venues fall through. */
export class UpdateEventDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 120 })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional() @IsDateString()
  eventDate?: string;

  @ApiPropertyOptional({ maxLength: 240 })
  @IsOptional() @IsString() @MaxLength(240)
  venue?: string;

  @ApiPropertyOptional({ example: 'Sangeet', maxLength: 60 })
  @IsOptional() @IsString() @MaxLength(60)
  eventType?: string;

  @ApiPropertyOptional({ enum: EventCategory })
  @IsOptional() @IsEnum(EventCategory)
  category?: EventCategory;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500)
  venueAddress?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional() @IsString() @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: '19:00', description: '24-hour HH:MM.' })
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Use a 24-hour time like 19:00' })
  startTime?: string;

  @ApiPropertyOptional({ example: '23:00' })
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Use a 24-hour time like 23:00' })
  endTime?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100000 })
  @IsOptional() @IsInt() @Min(0) @Max(100_000)
  expectedGuests?: number;

  @ApiPropertyOptional({ example: '250000.00' })
  @IsOptional() @IsNumberString()
  budget?: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional() @IsString() @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsUploadedUrl()
  imageUrl?: string;

  @ApiPropertyOptional({ enum: EventStatus })
  @IsOptional() @IsEnum(EventStatus)
  status?: EventStatus;
}

export class CreateGuestDto {
  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString() @MinLength(1) @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ maxLength: 120, description: 'Email address, if there is one.' })
  @IsOptional() @IsString() @MaxLength(120)
  contact?: string;

  @ApiPropertyOptional({
    example: '9876543210',
    description: 'Mobile number. Chasing an RSVP happens by phone, so this is worth having.',
  })
  @IsOptional()
  @Transform(normaliseMobile)
  @Matches(MOBILE_PATTERN, { message: MOBILE_MESSAGE })
  phone?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    description: 'How many people the invitation covers — the family, not the person.',
  })
  @IsOptional() @IsInt() @Min(1) @Max(100)
  partySize?: number;

  @ApiPropertyOptional({ maxLength: 60, example: "Bride's uncle" })
  @IsOptional() @IsString() @MaxLength(60)
  relation?: string;
}

export class UpdateGuestDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 120 })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional() @IsString() @MaxLength(120)
  contact?: string;

  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @Transform(normaliseMobile)
  @Matches(MOBILE_PATTERN, { message: MOBILE_MESSAGE })
  phone?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional() @IsInt() @Min(1) @Max(100)
  partySize?: number;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional() @IsString() @MaxLength(60)
  relation?: string;
}

export class InviteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  guestId: string;
}

/** What a guest may set through their signed link: their attendance, nothing else. */
export class GuestRsvpDto {
  @ApiProperty({ enum: [RsvpStatus.ATTENDING, RsvpStatus.DECLINED, RsvpStatus.MAYBE] })
  @IsIn([RsvpStatus.ATTENDING, RsvpStatus.DECLINED, RsvpStatus.MAYBE], {
    message: 'Reply with attending, declined or maybe',
  })
  status: RsvpStatus;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 100,
    description: 'How many are actually coming. What the caterer is ordered from.',
  })
  @IsOptional() @IsInt() @Min(0) @Max(100)
  attendingCount?: number;

  @ApiPropertyOptional({ maxLength: 500, description: 'Only if they offer one. Never demanded.' })
  @IsOptional() @IsString() @MaxLength(500)
  declineReason?: string;
}

export class UpdateRsvpDto {
  @ApiProperty({ enum: RsvpStatus })
  @IsEnum(RsvpStatus)
  status: RsvpStatus;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional() @IsString() @MaxLength(40)
  seat?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional() @IsInt() @Min(0) @Max(100)
  attendingCount?: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500)
  declineReason?: string;
}

/** Filters over the wedding's own days. */
export class EventQueryDto {
  @ApiPropertyOptional({ enum: EventStatus })
  @IsOptional() @IsEnum(EventStatus)
  status?: EventStatus;

  @ApiPropertyOptional({ enum: EventCategory })
  @IsOptional() @IsEnum(EventCategory)
  category?: EventCategory;

  @ApiPropertyOptional({ description: 'Matches the name, venue or city.' })
  @IsOptional() @IsString() @MaxLength(120)
  q?: string;
}

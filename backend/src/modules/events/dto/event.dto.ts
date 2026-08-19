import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { RsvpStatus } from '../../../common/enums';

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
}

export class CreateGuestDto {
  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString() @MinLength(1) @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional() @IsString() @MaxLength(120)
  contact?: string;
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
}

export class UpdateRsvpDto {
  @ApiProperty({ enum: RsvpStatus })
  @IsEnum(RsvpStatus)
  status: RsvpStatus;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional() @IsString() @MaxLength(40)
  seat?: string;
}

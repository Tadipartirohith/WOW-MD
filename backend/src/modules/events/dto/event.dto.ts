import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { RsvpStatus } from '../../../common/enums';

export class CreateEventDto {
  @ApiProperty({ example: 'Mehendi' })
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  eventDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  venue?: string;
}

export class CreateGuestDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contact?: string;
}

export class InviteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  guestId: string;
}

export class UpdateRsvpDto {
  @ApiProperty({ enum: RsvpStatus })
  @IsEnum(RsvpStatus)
  status: RsvpStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  seat?: string;
}

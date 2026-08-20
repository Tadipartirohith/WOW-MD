import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

/**
 * Why a profile is being paused or closed. Optional, but worth capturing: it is
 * the first thing anyone asks when a client comes back six months later.
 */
export class EndEngagementDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;
}

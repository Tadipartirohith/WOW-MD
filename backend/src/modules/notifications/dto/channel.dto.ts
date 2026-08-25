import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { StrictBoolean } from '../../../common/decorators/strict-boolean.decorator';

export class RegisterDeviceDto {
  @ApiProperty({ maxLength: 512, description: 'The registration token the OS issued.' })
  @IsString()
  @MinLength(8)
  @MaxLength(512)
  token: string;

  @ApiPropertyOptional({ enum: ['android', 'ios', 'web'], default: 'web' })
  @IsOptional()
  @IsIn(['android', 'ios', 'web'])
  platform?: string;
}

export class WhatsAppOptInDto {
  /** Consent, so it is taken literally. See `StrictBoolean`. */
  @ApiProperty({ type: Boolean, description: 'True to be reached on WhatsApp, false to stop.' })
  @StrictBoolean()
  optIn: boolean | string;
}

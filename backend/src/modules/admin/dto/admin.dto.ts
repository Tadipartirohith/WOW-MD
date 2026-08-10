import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { DisputeStatus } from '../../../common/enums';

export class RaiseDisputeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  bookingId: string;

  @ApiProperty()
  @IsString()
  reason: string;
}

export class ResolveDisputeDto {
  @ApiProperty({ enum: [DisputeStatus.RESOLVED, DisputeStatus.REJECTED] })
  @IsEnum(DisputeStatus)
  status: DisputeStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resolution?: string;
}

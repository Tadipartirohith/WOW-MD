import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { DisputeStatus, UserRole } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { StrictBoolean } from '../../../common/decorators/strict-boolean.decorator';

export class RaiseDisputeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  bookingId: string;

  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsString()
  @MinLength(10, { message: 'Please describe the issue in at least 10 characters' })
  @MaxLength(2000)
  reason: string;
}

export class ResolveDisputeDto {
  @ApiProperty({ enum: [DisputeStatus.RESOLVED, DisputeStatus.REJECTED] })
  @IsIn([DisputeStatus.RESOLVED, DisputeStatus.REJECTED], {
    message: 'A dispute can only be resolved or rejected',
  })
  status: DisputeStatus;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolution?: string;
}

export class DisputeQueryDto {
  @ApiPropertyOptional({ enum: DisputeStatus })
  @IsOptional()
  @IsEnum(DisputeStatus)
  status?: DisputeStatus;
}

export class AdminUserQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class AuditQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'booking.escrow_released' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  actorUserId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  resourceId?: string;
}

export class UpdateUserStatusDto {
  /**
   * Suspending or reinstating somebody's account.
   *
   * Strict, because the ordinary boolean conversion reads `"false"` as true —
   * and an administrator who meant to suspend an account and reinstated it
   * instead would have no way of telling from the response.
   */
  @ApiProperty({ type: Boolean })
  @StrictBoolean()
  isActive: boolean | string;
}

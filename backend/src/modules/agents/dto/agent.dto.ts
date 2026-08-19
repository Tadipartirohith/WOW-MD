import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class ClientSearchDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Free-text match on client email or display name' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ description: 'Filter by active/deactivated clients' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateClientStatusDto {
  @ApiPropertyOptional()
  @IsBoolean()
  isActive: boolean;
}

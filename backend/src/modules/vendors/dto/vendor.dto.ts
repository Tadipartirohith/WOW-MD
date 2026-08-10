import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { VendorCategory } from '../../../common/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateVendorDto {
  @ApiProperty() @IsString() name: string;
  @ApiProperty({ enum: VendorCategory }) @IsEnum(VendorCategory) category: VendorCategory;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
}

export class UpdateVendorDto extends PartialType(CreateVendorDto) {}

export class VendorSearchDto extends PaginationDto {
  @ApiPropertyOptional({ enum: VendorCategory })
  @IsOptional()
  @IsEnum(VendorCategory)
  category?: VendorCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;
}

export class CreateReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}

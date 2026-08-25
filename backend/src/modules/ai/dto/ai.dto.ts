import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { VendorCategory } from '../../../common/enums';

export class BudgetInsightDto {
  @ApiProperty({ example: 1500000, minimum: 1, maximum: 1_000_000_000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000_000)
  totalBudget: number;
}

export class AssistantDto {
  @ApiProperty({
    example: 'How do I plan a 300-guest wedding in 6 months?',
    minLength: 3,
    maxLength: 1000,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  question: string;
}

export class VendorRecoQueryDto {
  @ApiPropertyOptional({ enum: VendorCategory })
  @IsOptional()
  @IsEnum(VendorCategory)
  category?: VendorCategory;
}

/** Which profile the recommendations are for, when a steward is browsing. */
export class MatchRecoQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  profileId?: string;
}

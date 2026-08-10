import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { VendorCategory } from '../../../common/enums';

export class BudgetInsightDto {
  @ApiProperty({ example: 1500000 })
  @IsNumber()
  @Min(0)
  totalBudget: number;
}

export class AssistantDto {
  @ApiProperty({ example: 'How do I plan a 300-guest wedding in 6 months?' })
  @IsString()
  question: string;
}

export class VendorRecoQueryDto {
  @ApiPropertyOptional({ enum: VendorCategory })
  @IsOptional()
  @IsEnum(VendorCategory)
  category?: VendorCategory;
}

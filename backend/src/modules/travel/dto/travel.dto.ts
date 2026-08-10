import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class ItineraryItemDto {
  @ApiProperty() @IsInt() day: number;
  @ApiProperty() @IsString() title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class CreateItineraryDto {
  @ApiProperty()
  @IsString()
  title: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  packageId?: string;

  @ApiProperty({ type: [ItineraryItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItineraryItemDto)
  items: ItineraryItemDto[];
}

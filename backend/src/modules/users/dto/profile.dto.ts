import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ProfileVisibility } from '../../../common/enums';

export class PreferencesDto {
  @ApiPropertyOptional() @IsOptional() @IsString() religion?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() community?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() education?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() lifestyle?: string[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(18) @Max(100) preferredAgeMin?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(18) @Max(100) preferredAgeMax?: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() preferredLocations?: string[];
}

export class CreateProfileDto {
  @ApiProperty() @IsString() displayName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfBirth?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bio?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() photos?: string[];

  @ApiPropertyOptional({ type: PreferencesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PreferencesDto)
  preferences?: PreferencesDto;

  @ApiPropertyOptional({ enum: ProfileVisibility })
  @IsOptional()
  @IsEnum(ProfileVisibility)
  visibility?: ProfileVisibility;
}

export class UpdateProfileDto extends PartialType(CreateProfileDto) {}

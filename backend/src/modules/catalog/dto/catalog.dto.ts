import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsStrictString } from '../../../common/decorators/strict-type.decorator';
import {
  AttributeScope,
  AvailabilityModel,
  PricingModel,
  ServiceAttributeType,
} from '../../../common/enums';

/**
 * Machine names, not prose. A slug is what a saved filter and a deep link
 * refer to, so it has to survive somebody renaming the category next quarter.
 */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MESSAGE = 'Use lower-case words separated by hyphens, for example wedding-photography';

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const KEY_MESSAGE = 'Use lower-case letters, digits and underscores, starting with a letter';

const slugify = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

// ------------------------------------------------------------------ category

export class CreateCategoryDto {
  @ApiProperty({ example: 'photography' })
  @Transform(slugify)
  @IsStrictString()
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  @MaxLength(60)
  slug: string;

  @ApiProperty({ example: 'Photography & Videography' })
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ example: 'camera' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  icon?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) icon?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}

// ---------------------------------------------------------------- definition

export class CreateDefinitionDto {
  @ApiProperty({ example: 'candid-photography' })
  @Transform(slugify)
  @IsStrictString()
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  @MaxLength(60)
  slug: string;

  @ApiProperty({ example: 'Candid wedding photography' })
  @IsString()
  @MaxLength(140)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({
    enum: PricingModel,
    isArray: true,
    description: 'Which pricing models a vendor may choose from for this service.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(9)
  @IsEnum(PricingModel, { each: true })
  allowedPricingModels: PricingModel[];

  @ApiPropertyOptional({ enum: AvailabilityModel, default: AvailabilityModel.SLOT })
  @IsOptional()
  @IsEnum(AvailabilityModel)
  availabilityModel?: AvailabilityModel;

  @ApiPropertyOptional({
    default: true,
    description: 'Packages are optional — a priest sells one ceremony, not three tiers.',
  })
  @IsOptional()
  @IsBoolean()
  packagesAllowed?: boolean;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 500 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  defaultCapacity?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

export class UpdateDefinitionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(140) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;

  @ApiPropertyOptional({ enum: PricingModel, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(9)
  @IsEnum(PricingModel, { each: true })
  allowedPricingModels?: PricingModel[];

  @ApiPropertyOptional({ enum: AvailabilityModel })
  @IsOptional()
  @IsEnum(AvailabilityModel)
  availabilityModel?: AvailabilityModel;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() packagesAllowed?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(500) defaultCapacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}

// ----------------------------------------------------------------- attribute

export class AttributeOptionDto {
  @ApiProperty({ example: 'veg' })
  @IsString()
  @MaxLength(60)
  value: string;

  @ApiProperty({ example: 'Vegetarian' })
  @IsString()
  @MaxLength(120)
  label: string;
}

export class AttributeConstraintsDto {
  @ApiPropertyOptional({ type: [AttributeOptionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AttributeOptionDto)
  options?: AttributeOptionDto[];

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) min?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) max?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(6) precision?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(20000) maxLength?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(200) minSelections?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(200) maxSelections?: number;

  @ApiPropertyOptional({ enum: ['minutes', 'hours', 'days'] })
  @IsOptional()
  @IsEnum({ minutes: 'minutes', hours: 'hours', days: 'days' })
  unit?: 'minutes' | 'hours' | 'days';

  @ApiPropertyOptional({ example: ['.pdf', '.jpg'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  accept?: string[];
}

export class CreateAttributeDto {
  @ApiProperty({ enum: AttributeScope })
  @IsEnum(AttributeScope)
  scope: AttributeScope;

  @ApiProperty({ example: 'guest_count' })
  @Matches(KEY_PATTERN, { message: KEY_MESSAGE })
  @MaxLength(60)
  key: string;

  @ApiProperty({ example: 'Number of guests' })
  @IsString()
  @MaxLength(140)
  label: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  helpText?: string;

  @ApiProperty({ enum: ServiceAttributeType })
  @IsEnum(ServiceAttributeType)
  type: ServiceAttributeType;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ type: AttributeConstraintsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AttributeConstraintsDto)
  constraints?: AttributeConstraintsDto;

  @ApiPropertyOptional({
    default: false,
    description: 'Only meaningful on a SERVICE attribute — each one is a jsonb query.',
  })
  @IsOptional()
  @IsBoolean()
  filterable?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

export class UpdateAttributeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(140) label?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) helpText?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean;

  @ApiPropertyOptional({ type: AttributeConstraintsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AttributeConstraintsDto)
  constraints?: AttributeConstraintsDto;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() filterable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}

// ------------------------------------------------------------ vendor service

export class UpsertVendorServiceDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  definitionId: string;

  @ApiPropertyOptional({ example: 'Signature candid coverage' })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Answers to this definition’s SERVICE attributes. Validated against them.',
  })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @ApiPropertyOptional({
    default: 1,
    minimum: 1,
    maximum: 500,
    description: 'How many of these the vendor can run at once. Five catering teams, one hall.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  concurrentCapacity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

// ------------------------------------------------------------------ offering

export class UpsertOfferingDto {
  @ApiProperty({ example: 'Full day, two photographers' })
  @IsString()
  @MaxLength(140)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: PricingModel })
  @IsEnum(PricingModel)
  pricingModel: PricingModel;

  @ApiPropertyOptional({
    example: '85000.00',
    description: 'Omitted for Custom Quote and No Public Price — those two quote after the request.',
  })
  @IsOptional()
  @IsNumberString({ no_symbols: false })
  price?: string;

  @ApiPropertyOptional({ default: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ example: 'per plate' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  unitLabel?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  minQuantity?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxQuantity?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPackage?: boolean;

  @ApiPropertyOptional({ example: ['Album', 'Drone coverage'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  inclusions?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsUploadedUrl } from '../../../common/decorators/uploaded-url.decorator';
import { StrictBoolean } from '../../../common/decorators/strict-boolean.decorator';
import {
  Complexion,
  FamilyAssetType,
  FamilyStatus,
  FamilyType,
  LifeStatus,
  MaritalStatus,
  SELF_MARITAL_STATUSES,
  OccupationStatus,
} from '../../../common/enums';
import {
  MOBILE_MESSAGE,
  MOBILE_PATTERN,
  NAME_MESSAGE,
  NAME_PATTERN,
  normaliseMobile,
  normaliseName,
  normaliseOptionalName,
} from '../../../common/util/identity-fields';

/**
 * The profile is filled in section by section, and each section is saved on its
 * own. A single 60-field payload would mean a person cannot save their name
 * until they have decided what they want their partner's caste to be.
 */

class LocationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) state?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) district?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) mandal?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) village?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) city?: string;
}

export class PersonalDetailsDto {
  @ApiProperty({ example: 'Rakesh' })
  @IsString()
  @Transform(normaliseName)
  @Matches(NAME_PATTERN, { message: NAME_MESSAGE })
  @MaxLength(80)
  firstName: string;

  /**
   * Accepted, no longer stored separately.
   *
   * Kept on the DTO so a client that has not been updated does not start
   * failing validation mid-deploy; the service folds it into `lastName` when
   * that is empty and otherwise ignores it. Removing it outright would turn a
   * rolling deploy into an outage for anyone on the old bundle.
   */
  @ApiPropertyOptional({ deprecated: true, description: 'Folded into lastName.' })
  @IsOptional()
  @IsString()
  @Transform(normaliseOptionalName)
  @Matches(NAME_PATTERN, { message: NAME_MESSAGE })
  @MaxLength(80)
  surname?: string;

  /**
   * Optional only so a client still sending the old `surname` is accepted; the
   * service refuses a request that carries neither. Required in the form.
   */
  @ApiPropertyOptional({ example: 'Rao', description: 'Family name, as on the documents.' })
  @IsOptional()
  @IsString()
  @Transform(normaliseOptionalName)
  @Matches(NAME_PATTERN, { message: NAME_MESSAGE })
  @MaxLength(80)
  lastName?: string;

  @ApiProperty({ example: 170, minimum: 120, maximum: 230, description: 'Height in centimetres' })
  @IsInt()
  @Min(120)
  @Max(230)
  heightCm: number;

  /**
   * One of a closed list. Free text made this unmatchable: "Fair", "fair" and
   * "Fair/Wheatish" are three values a preference filter cannot compare.
   *
   * Existing rows hold whatever was typed, and are left alone — rewriting
   * somebody's description of themselves to fit a new list is not a migration.
   * The next save moves them onto it.
   */
  @ApiProperty({ enum: Complexion })
  @IsEnum(Complexion)
  complexion: Complexion;

  /**
   * Both moved out of this section.
   *
   * Native place belongs with the family — it is a fact about where a family is
   * from — and place of birth was being read as the same question, so people
   * answered it twice with different words. Still accepted here so a client
   * that has not been updated does not start failing mid-deploy; the service
   * routes the native place to where it now lives and ignores the other.
   */
  @ApiPropertyOptional({ deprecated: true, description: 'Moved to Family details.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nativePlace?: string;

  @ApiPropertyOptional({ deprecated: true, description: 'No longer collected.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  placeOfBirth?: string;

  @ApiProperty({ example: '12 Banjara Hills, Hyderabad 500034' })
  @IsString()
  @MaxLength(500)
  communicationAddress: string;

  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @Transform(normaliseMobile)
  @Matches(MOBILE_PATTERN, { message: MOBILE_MESSAGE })
  alternateMobile?: string;

  @ApiPropertyOptional({ type: LocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  residence?: LocationDto;
}

export class ReligionDetailsDto {
  @ApiProperty({ example: 'Hindu' })
  @IsString()
  @MaxLength(60)
  religion: string;

  @ApiProperty({ example: 'Kamma' })
  @IsString()
  @MaxLength(60)
  caste: string;

  @ApiProperty({ example: 'Gampalavaru' })
  @IsString()
  @MaxLength(60)
  subCaste: string;

  @ApiProperty({ example: 'Telugu' })
  @IsString()
  @MaxLength(60)
  motherTongue: string;

  @ApiPropertyOptional({ description: 'Denomination or sect, where the community uses one' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  denomination?: string;
}

export class HoroscopeDetailsDto {
  @ApiProperty({ description: 'Whether a horoscope exists at all' })
  @IsBoolean()
  horoscopeAvailable: boolean;

  /**
   * Required only when a horoscope exists. A family that does not use one
   * should not be made to invent a rashi to get past the form.
   */
  @ApiPropertyOptional({ example: 'Mesha' })
  @ValidateIf((o: HoroscopeDetailsDto) => o.horoscopeAvailable)
  @IsString({ message: 'Rashi is required when a horoscope is available' })
  @MaxLength(60)
  rashi?: string;

  @ApiPropertyOptional({ example: 'Ashwini' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  star?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) padam?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) gothram?: string;

  @ApiPropertyOptional({ description: 'Yes / No / Unknown' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  kujaDosham?: string;

  @ApiPropertyOptional({ example: '04:35' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Use 24-hour HH:MM' })
  timeOfBirth?: string;

  @ApiPropertyOptional({ type: LocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  birthPlace?: LocationDto;

  @ApiPropertyOptional({ description: 'Uploaded chart' })
  @IsOptional()
  @IsUploadedUrl()
  horoscopeDocumentUrl?: string;
}

export class MaritalDetailsDto {
  // Not IsEnum: `married` belongs to the shared vocabulary for siblings' sake
  // and is not an answer the person seeking a match can give about themselves.
  @ApiProperty({ enum: SELF_MARITAL_STATUSES })
  @IsIn(SELF_MARITAL_STATUSES as MaritalStatus[], {
    message: 'A profile being matched cannot be currently married',
  })
  maritalStatus: MaritalStatus;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  marriageDate?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  divorceDate?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  separationDate?: string;

  /**
   * Why a previous marriage ended, in the person's own words.
   *
   * Never required. Somebody who would rather not explain must still be able to
   * complete the section, and a mandatory box here would be answered with a
   * full stop by everyone who felt that way — which is worse than silence
   * because it looks like an answer.
   */
  @ApiPropertyOptional({
    maxLength: 2000,
    description: 'Optional. Shown only to people who may already see the marital history.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 80 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  yearsMarried?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasChildren?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  boys?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  girls?: number;

  @ApiPropertyOptional({ description: 'Who the children live with' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  childrenLivingWith?: string;
}

class ParentDto {
  @ApiProperty()
  @IsString()
  @Transform(normaliseName)
  @Matches(NAME_PATTERN, { message: NAME_MESSAGE })
  @MaxLength(120)
  name: string;

  /**
   * Alive or deceased, and only those two.
   *
   * It was already accepted here as free text and simply never asked for on
   * the form, so every profile carried an empty one. Two options rather than a
   * text box because this is read at a glance beside a name, and "Late",
   * "late", "expired" and "no more" are the same fact written four ways.
   */
  @ApiPropertyOptional({ enum: LifeStatus })
  @IsOptional()
  @IsEnum(LifeStatus)
  lifeStatus?: LifeStatus;

  @ApiPropertyOptional({ minimum: 18, maximum: 120 })
  @IsOptional()
  @IsInt()
  @Min(18)
  @Max(120)
  age?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  profession?: string;
}

export class FamilyDetailsDto {
  @ApiPropertyOptional({
    example: 'Warangal',
    description: "The family's native place. Asked here rather than in personal details.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nativePlace?: string;

  @ApiPropertyOptional({ maxLength: 80, description: 'The state the native place is in' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nativeState?: string;

  @ApiPropertyOptional({ maxLength: 80, description: 'The country the native place is in' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nativeCountry?: string;

  @ApiPropertyOptional({ maxLength: 120, description: 'The district the native place is in' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nativeDistrict?: string;

  /** Settled abroad. The city and country below are only meaningful when true. */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @StrictBoolean()
  isNri?: boolean;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nriCity?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nriCountry?: string;

  @ApiProperty({ type: ParentDto })
  @ValidateNested()
  @Type(() => ParentDto)
  father: ParentDto;

  @ApiProperty({ type: ParentDto })
  @ValidateNested()
  @Type(() => ParentDto)
  mother: ParentDto;

  @ApiProperty({ enum: FamilyType })
  @IsEnum(FamilyType)
  familyType: FamilyType;

  @ApiProperty({ enum: FamilyStatus })
  @IsEnum(FamilyStatus)
  familyStatus: FamilyStatus;

  @ApiProperty({ minimum: 0, maximum: 20 })
  @IsInt()
  @Min(0)
  @Max(20)
  brothers: number;

  @ApiProperty({ minimum: 0, maximum: 20 })
  @IsInt()
  @Min(0)
  @Max(20)
  sisters: number;

  /**
   * The family's net worth in rupees.
   *
   * Optional, and hidden by default. Plenty of families will not answer it and
   * should not be blocked from completing the section for that.
   */
  @ApiPropertyOptional({ minimum: 0, example: 7500000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  familyNetWorth?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @StrictBoolean()
  familyNetWorthVisible?: boolean;
}

export class SiblingDto {
  @ApiProperty()
  @IsString()
  @Transform(normaliseName)
  @Matches(NAME_PATTERN, { message: NAME_MESSAGE })
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 120 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  age?: number;

  @ApiPropertyOptional({ enum: MaritalStatus })
  @IsOptional()
  @IsEnum(MaritalStatus)
  maritalStatus?: MaritalStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  spouseName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  qualification?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  profession?: string;
}

export class AssetDto {
  @ApiProperty({ enum: FamilyAssetType })
  @IsEnum(FamilyAssetType)
  type: FamilyAssetType;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) area?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedValue?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) ownership?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) remarks?: string;

  @ApiPropertyOptional({ default: false, description: 'Off unless the family opts in' })
  @IsOptional()
  @IsBoolean()
  visible?: boolean;
}

export class EducationDetailsDto {
  @ApiProperty({ example: 'Masters' })
  @IsString()
  @MaxLength(120)
  highestQualification: string;

  @ApiProperty({ example: 'M.Tech, Computer Science' })
  @IsString()
  @MaxLength(160)
  course: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) institution?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) collegePlace?: string;

  @ApiProperty({ enum: OccupationStatus })
  @IsEnum(OccupationStatus)
  occupationStatus: OccupationStatus;

  /** Required when employed, ignored otherwise. */
  @ApiPropertyOptional({ type: Object })
  @ValidateIf((o: EducationDetailsDto) => o.occupationStatus === OccupationStatus.EMPLOYED)
  @IsObject({ message: 'Employment details are required for an employed candidate' })
  employment?: Record<string, unknown>;

  /** Required when self-employed. */
  @ApiPropertyOptional({ type: Object })
  @ValidateIf((o: EducationDetailsDto) => o.occupationStatus === OccupationStatus.SELF_EMPLOYED)
  @IsObject({ message: 'Business details are required for a self-employed candidate' })
  business?: Record<string, unknown>;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  incomeVisible?: boolean;
}

export class PartnerPreferencesDto {
  @ApiProperty({ minimum: 18, maximum: 100 })
  @IsInt()
  @Min(18)
  @Max(100)
  preferredAgeMin: number;

  @ApiProperty({ minimum: 18, maximum: 100 })
  @IsInt()
  @Min(18)
  @Max(100)
  preferredAgeMax: number;

  @ApiProperty({ minimum: 120, maximum: 230 })
  @IsInt()
  @Min(120)
  @Max(230)
  preferredHeightMinCm: number;

  @ApiProperty({ minimum: 120, maximum: 230 })
  @IsInt()
  @Min(120)
  @Max(230)
  preferredHeightMaxCm: number;

  @ApiPropertyOptional({
    type: Object,
    description:
      'Religion, caste, sub-caste, complexion, education, profession, locations and free text.',
  })
  @IsOptional()
  @IsObject()
  preferences?: Record<string, unknown>;

  /**
   * Whether a horoscope matters to this family at all.
   *
   * Three answers rather than a checkbox, and the third is the point: "no
   * preference" is a real position and very different from "no". A family that
   * does not use horoscopes is not asking anybody else to abandon theirs.
   */
  @ApiPropertyOptional({ enum: ['required', 'preferred', 'not_required'] })
  @IsOptional()
  @IsIn(['required', 'preferred', 'not_required'])
  horoscopeExpectation?: 'required' | 'preferred' | 'not_required';

  /**
   * Whether a kuja dosham match is being asked for.
   *
   * Separate from the above because they are separate questions: plenty of
   * families want to see a chart without treating dosham as disqualifying.
   */
  @ApiPropertyOptional({ enum: ['must_match', 'no_objection'] })
  @IsOptional()
  @IsIn(['must_match', 'no_objection'])
  kujaDosham?: 'must_match' | 'no_objection';

  /** Stars or rashis the family is looking for. Free text; usage varies. */
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  preferredStars?: string;

  // The rest of the horoscope preferences a family matches on (EZ1-I15/I48).
  // Free text, stored in the jsonb preferences blob — the values run to
  // thousands (gothram especially) and vary by community, so a closed list
  // would exclude more than it helped.
  @ApiPropertyOptional({ maxLength: 60, description: 'Preferred Rashi' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  preferredRashi?: string;

  @ApiPropertyOptional({ maxLength: 20, description: 'Preferred Padam' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  preferredPadam?: string;

  @ApiPropertyOptional({ maxLength: 300, description: 'Preferred Gothram(s)' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  preferredGothram?: string;

  /**
   * The chart itself, attached from this screen.
   *
   * The same document as on the horoscope section, and deliberately the same
   * field — a family filling in preferences usually has the chart to hand, and
   * making them go back to another section to attach it is where they stop.
   * Uploaded here it lands in exactly one place.
   */
  @ApiPropertyOptional({ maxLength: 2048 })
  @IsOptional()
  @IsUploadedUrl()
  @MaxLength(2048)
  horoscopeDocumentUrl?: string;
}

export class SetPrimaryPhotoDto {
  @ApiProperty({ description: 'One of the photos already on the profile' })
  @IsUploadedUrl()
  url: string;
}

/** One photograph, addressed by the URL it was uploaded to. */
export class ProfilePhotoDto {
  @ApiProperty({ example: 'https://cdn.example.com/profiles/a1b2.jpg' })
  @IsString()
  @Matches(/^https?:\/\/\S+$/i, { message: 'That is not an uploaded photo' })
  @MaxLength(2000)
  url: string;
}

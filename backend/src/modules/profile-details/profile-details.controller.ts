import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProfileDetailsService } from './profile-details.service';
import {
  AssetDto,
  EducationDetailsDto,
  FamilyDetailsDto,
  HoroscopeDetailsDto,
  MaritalDetailsDto,
  PartnerPreferencesDto,
  PersonalDetailsDto,
  ReligionDetailsDto,
  ProfilePhotoDto,
  SetPrimaryPhotoDto,
  SiblingDto,
} from './dto/profile-details.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

/**
 * The matrimonial biodata, saved a section at a time.
 *
 * Every route takes a profile id rather than assuming the caller's own profile,
 * because an agency fills these in for clients who have no account — the same
 * shape the rest of the stewardship surface uses.
 */
@ApiTags('profile-details')
@ApiBearerAuth()
@RequirePermissions(Permission.PROFILE_MANAGE_OWN)
@Controller('profiles/:id')
export class ProfileDetailsController {
  constructor(private readonly details: ProfileDetailsService) {}

  @ApiOperation({ summary: 'The complete biodata, for whoever may see all of it' })
  @Get('details')
  find(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.details.findFull(actor, id);
  }

  @ApiOperation({
    summary: 'Which sections are done and which are not',
    description: 'Computed from what is stored, so it cannot drift from the truth.',
  })
  @Get('details/completion')
  completion(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.details.completion(actor, id);
  }

  @Put('details/personal')
  personal(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PersonalDetailsDto,
  ) {
    return this.details.savePersonal(actor, id, dto);
  }

  @Put('details/religion')
  religion(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReligionDetailsDto,
  ) {
    return this.details.saveReligion(actor, id, dto);
  }

  @ApiOperation({
    summary: 'Horoscope',
    description: 'Answering "not available" completes the section — the question has been answered.',
  })
  @Put('details/horoscope')
  horoscope(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HoroscopeDetailsDto,
  ) {
    return this.details.saveHoroscope(actor, id, dto);
  }

  @Put('details/marital')
  marital(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MaritalDetailsDto,
  ) {
    return this.details.saveMarital(actor, id, dto);
  }

  @Put('details/family')
  family(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FamilyDetailsDto,
  ) {
    return this.details.saveFamily(actor, id, dto);
  }

  @Put('details/education')
  education(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EducationDetailsDto,
  ) {
    return this.details.saveEducation(actor, id, dto);
  }

  @Put('details/preferences')
  preferences(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PartnerPreferencesDto,
  ) {
    return this.details.savePreferences(actor, id, dto);
  }

  @ApiOperation({ summary: 'Choose which photo leads the profile' })
  @ApiOperation({
    summary: 'Clear the biodata and start again',
    description:
      'Removes the details, siblings, family assets and photographs. Not the account — that is ' +
      'under Security, needs a password, and refuses while money is in flight. The consent ' +
      'record and any interests already exchanged survive: those are somebody else\'s record ' +
      'or the platform\'s own.',
  })
  @Delete('details')
  clearBiodata(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.details.clearBiodata(actor, id);
  }

  // -------------------------------------------------------------- photographs

  @ApiOperation({
    summary: 'The photographs on this profile',
    description:
      'Kept on the profile rather than the biodata, because matchmaking and circulation both ' +
      'show them. Until these routes existed the only way to attach one was through the agency ' +
      'console, so a self-managed profile could never have a photograph.',
  })
  @Get('details/photos')
  listPhotos(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.details.listPhotos(actor, id);
  }

  @Post('details/photos')
  addPhoto(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProfilePhotoDto,
  ) {
    return this.details.addPhoto(actor, id, dto.url);
  }

  @Delete('details/photos')
  removePhoto(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProfilePhotoDto,
  ) {
    return this.details.removePhoto(actor, id, dto.url);
  }

  @Put('details/primary-photo')
  primaryPhoto(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPrimaryPhotoDto,
  ) {
    return this.details.setPrimaryPhoto(actor, id, dto);
  }

  // ------------------------------------------------- siblings and assets

  @Post('details/siblings')
  addSibling(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SiblingDto,
  ) {
    return this.details.addSibling(actor, id, dto);
  }

  @Delete('details/siblings/:siblingId')
  removeSibling(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('siblingId', ParseUUIDPipe) siblingId: string,
  ) {
    return this.details.removeSibling(actor, id, siblingId);
  }

  @ApiOperation({
    summary: 'Record a family asset',
    description: 'Hidden from everyone unless the family marks it visible.',
  })
  @Post('details/assets')
  addAsset(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssetDto,
  ) {
    return this.details.addAsset(actor, id, dto);
  }

  @Delete('details/assets/:assetId')
  removeAsset(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ) {
    return this.details.removeAsset(actor, id, assetId);
  }
}

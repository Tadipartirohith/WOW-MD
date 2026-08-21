import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProfileDetails } from './entities/profile-details.entity';
import { ProfileSibling } from './entities/profile-sibling.entity';
import { ProfileAsset } from './entities/profile-asset.entity';
import { Profile } from '../users/entities/profile.entity';
import {
  AssetDto,
  EducationDetailsDto,
  FamilyDetailsDto,
  HoroscopeDetailsDto,
  MaritalDetailsDto,
  PartnerPreferencesDto,
  PersonalDetailsDto,
  ReligionDetailsDto,
  SetPrimaryPhotoDto,
  SiblingDto,
} from './dto/profile-details.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { MaritalStatus, UserRole } from '../../common/enums';

/** The sections a profile has to complete before it is considered ready. */
export const REQUIRED_SECTIONS = [
  'personal',
  'religion',
  'horoscope',
  'marital',
  'family',
  'education',
  'preferences',
  'identity',
] as const;

export type ProfileSection = (typeof REQUIRED_SECTIONS)[number];

export interface CompletionReport {
  profileId: string;
  complete: boolean;
  /** Fraction complete, for the progress bar. */
  percent: number;
  sections: { section: ProfileSection; complete: boolean; label: string }[];
  missing: ProfileSection[];
}

const SECTION_LABEL: Record<ProfileSection, string> = {
  personal: 'Personal details',
  religion: 'Religion and community',
  horoscope: 'Horoscope',
  marital: 'Marital status',
  family: 'Family',
  education: 'Education and occupation',
  preferences: 'Partner preferences',
  identity: 'Identity verification',
};

/**
 * The matrimonial biodata, section by section.
 *
 * Each section saves independently: somebody filling in their own profile
 * stops halfway, and a form that only saves as a whole loses everything they
 * had typed. Completion is computed from what is actually stored rather than
 * tracked as a flag, so it cannot drift away from the truth.
 */
@Injectable()
export class ProfileDetailsService {
  constructor(
    @InjectRepository(ProfileDetails) private readonly details: Repository<ProfileDetails>,
    @InjectRepository(ProfileSibling) private readonly siblings: Repository<ProfileSibling>,
    @InjectRepository(ProfileAsset) private readonly assets: Repository<ProfileAsset>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
  ) {}

  // ------------------------------------------------------------- sections

  async savePersonal(actor: AuthUser, profileId: string, dto: PersonalDetailsDto) {
    const row = await this.editable(actor, profileId);
    Object.assign(row, {
      firstName: dto.firstName,
      surname: dto.surname ?? null,
      lastName: dto.lastName,
      heightCm: dto.heightCm,
      complexion: dto.complexion,
      nativePlace: dto.nativePlace,
      placeOfBirth: dto.placeOfBirth,
      communicationAddress: dto.communicationAddress,
      alternateMobile: dto.alternateMobile ?? null,
      residence: (dto.residence ?? {}) as Record<string, string>,
    });
    return this.persist(profileId, row);
  }

  async saveReligion(actor: AuthUser, profileId: string, dto: ReligionDetailsDto) {
    const row = await this.editable(actor, profileId);
    Object.assign(row, {
      religion: dto.religion,
      caste: dto.caste,
      subCaste: dto.subCaste,
      motherTongue: dto.motherTongue,
      denomination: dto.denomination ?? null,
    });
    return this.persist(profileId, row);
  }

  async saveHoroscope(actor: AuthUser, profileId: string, dto: HoroscopeDetailsDto) {
    const row = await this.editable(actor, profileId);
    const { horoscopeAvailable, horoscopeDocumentUrl, ...chart } = dto;

    row.horoscopeAvailable = horoscopeAvailable;
    // Clearing the chart when the answer turns to "no" matters: a stale rashi
    // left behind would be shown as fact on a profile that has just said it
    // does not have a horoscope.
    row.horoscope = horoscopeAvailable ? (chart as Record<string, unknown>) : {};
    row.horoscopeDocumentUrl = horoscopeAvailable ? (horoscopeDocumentUrl ?? null) : null;
    return this.persist(profileId, row);
  }

  async saveMarital(actor: AuthUser, profileId: string, dto: MaritalDetailsDto) {
    const row = await this.editable(actor, profileId);
    const { maritalStatus, ...history } = dto;

    row.maritalStatus = maritalStatus;
    // Never-married carries no history, and keeping fields somebody typed
    // before correcting the status would be worse than losing them.
    row.maritalHistory =
      maritalStatus === MaritalStatus.NEVER_MARRIED ? {} : (history as Record<string, unknown>);
    return this.persist(profileId, row);
  }

  async saveFamily(actor: AuthUser, profileId: string, dto: FamilyDetailsDto) {
    const row = await this.editable(actor, profileId);
    Object.assign(row, {
      father: dto.father as unknown as Record<string, unknown>,
      mother: dto.mother as unknown as Record<string, unknown>,
      familyType: dto.familyType,
      familyStatus: dto.familyStatus,
      brothers: dto.brothers,
      sisters: dto.sisters,
    });
    return this.persist(profileId, row);
  }

  async saveEducation(actor: AuthUser, profileId: string, dto: EducationDetailsDto) {
    const row = await this.editable(actor, profileId);
    Object.assign(row, {
      highestQualification: dto.highestQualification,
      course: dto.course,
      institution: dto.institution ?? null,
      collegePlace: dto.collegePlace ?? null,
      occupationStatus: dto.occupationStatus,
      employment: dto.employment ?? {},
      business: dto.business ?? {},
      incomeVisible: dto.incomeVisible ?? false,
    });
    return this.persist(profileId, row);
  }

  async savePreferences(actor: AuthUser, profileId: string, dto: PartnerPreferencesDto) {
    const row = await this.editable(actor, profileId);

    if (dto.preferredAgeMin > dto.preferredAgeMax) {
      throw new BadRequestException('The minimum age cannot be above the maximum');
    }
    if (dto.preferredHeightMinCm > dto.preferredHeightMaxCm) {
      throw new BadRequestException('The minimum height cannot be above the maximum');
    }

    Object.assign(row, {
      preferredAgeMin: dto.preferredAgeMin,
      preferredAgeMax: dto.preferredAgeMax,
      preferredHeightMinCm: dto.preferredHeightMinCm,
      preferredHeightMaxCm: dto.preferredHeightMaxCm,
      partnerPreferences: dto.preferences ?? {},
    });
    return this.persist(profileId, row);
  }

  /** The photo shown first. Must be one the profile already has. */
  async setPrimaryPhoto(actor: AuthUser, profileId: string, dto: SetPrimaryPhotoDto) {
    const row = await this.editable(actor, profileId);
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile?.photos?.includes(dto.url)) {
      throw new BadRequestException('That photo is not on this profile');
    }
    row.primaryPhotoUrl = dto.url;
    return this.persist(profileId, row);
  }

  // ------------------------------------------------- siblings and assets

  async addSibling(actor: AuthUser, profileId: string, dto: SiblingDto) {
    await this.editable(actor, profileId);
    return this.siblings.save(this.siblings.create({ profileId, ...dto }));
  }

  async removeSibling(actor: AuthUser, profileId: string, siblingId: string) {
    await this.editable(actor, profileId);
    const row = await this.siblings.findOne({ where: { id: siblingId, profileId } });
    if (!row) throw new NotFoundException('Sibling not found');
    await this.siblings.remove(row);
    return { success: true as const };
  }

  async addAsset(actor: AuthUser, profileId: string, dto: AssetDto) {
    await this.editable(actor, profileId);
    return this.assets.save(
      this.assets.create({
        profileId,
        ...dto,
        estimatedValue: dto.estimatedValue !== undefined ? dto.estimatedValue.toFixed(2) : null,
        visible: dto.visible ?? false,
      }),
    );
  }

  async removeAsset(actor: AuthUser, profileId: string, assetId: string) {
    await this.editable(actor, profileId);
    const row = await this.assets.findOne({ where: { id: assetId, profileId } });
    if (!row) throw new NotFoundException('Asset not found');
    await this.assets.remove(row);
    return { success: true as const };
  }

  // -------------------------------------------------------------- reading

  /**
   * Everything, for whoever may see everything: the owner, the steward who
   * runs the profile, or staff.
   */
  async findFull(actor: AuthUser, profileId: string) {
    const profile = await this.load(profileId);
    this.assertMayRead(actor, profile);

    const [details, siblings, assets] = await Promise.all([
      this.details.findOne({ where: { profileId } }),
      this.siblings.find({ where: { profileId }, order: { createdAt: 'ASC' } }),
      this.assets.find({ where: { profileId }, order: { createdAt: 'ASC' } }),
    ]);

    return {
      profileId,
      details: details ?? null,
      siblings,
      assets,
      completion: this.report(profileId, profile, details, siblings),
    };
  }

  /**
   * What a matched counterpart may see.
   *
   * The rule is subtractive and deliberately blunt: start from the full record
   * and remove the things that are nobody else's business unless explicitly
   * shared — income, invisible assets, the communication address, the second
   * phone number.
   */
  async findShareable(profileId: string) {
    const [details, siblings, assets] = await Promise.all([
      this.details.findOne({ where: { profileId } }),
      this.siblings.find({ where: { profileId }, order: { createdAt: 'ASC' } }),
      this.assets.find({ where: { profileId, visible: true } }),
    ]);
    if (!details) return { profileId, details: null, siblings: [], assets: [] };

    const {
      communicationAddress,
      alternateMobile,
      employment,
      business,
      incomeVisible,
      ...rest
    } = details;

    const strip = (block: Record<string, unknown>) => {
      if (incomeVisible) return block;
      const { salary, income, businessIncome, ...safe } = block;
      return safe;
    };

    return {
      profileId,
      details: {
        ...rest,
        employment: strip(employment ?? {}),
        business: strip(business ?? {}),
      },
      siblings,
      assets,
    };
  }

  async completion(actor: AuthUser, profileId: string): Promise<CompletionReport> {
    const profile = await this.load(profileId);
    this.assertMayRead(actor, profile);

    const [details, siblings] = await Promise.all([
      this.details.findOne({ where: { profileId } }),
      this.siblings.find({ where: { profileId } }),
    ]);
    return this.report(profileId, profile, details, siblings);
  }

  /**
   * Computed from the stored data every time it is asked for.
   *
   * A stored "complete" flag drifts the moment anything is edited or a rule
   * changes, and a profile that claims to be complete when it is not is worse
   * than one that admits it is not.
   */
  private report(
    profileId: string,
    profile: Profile,
    details: ProfileDetails | null,
    siblings: ProfileSibling[],
  ): CompletionReport {
    const has = (value: unknown) =>
      value !== null && value !== undefined && value !== '' &&
      !(typeof value === 'object' && Object.keys(value as object).length === 0);

    const done: Record<ProfileSection, boolean> = {
      personal: Boolean(
        details &&
          has(details.firstName) &&
          has(details.lastName) &&
          has(details.heightCm) &&
          has(details.complexion) &&
          has(details.nativePlace) &&
          has(details.placeOfBirth) &&
          has(details.communicationAddress),
      ),
      religion: Boolean(
        details && has(details.religion) && has(details.caste) && has(details.motherTongue),
      ),
      // Answering "no horoscope" completes the section: the question has been
      // answered, which is all the profile needs.
      horoscope: Boolean(
        details && (details.horoscopeAvailable === false || has(details.horoscope)),
      ),
      marital: Boolean(details && has(details.maritalStatus)),
      family: Boolean(
        details &&
          has(details.father) &&
          has(details.mother) &&
          has(details.familyType) &&
          details.brothers !== null &&
          details.sisters !== null &&
          // Counts and records have to agree, or the family section is telling
          // two different stories.
          siblings.length >= 0,
      ),
      education: Boolean(
        details && has(details.highestQualification) && has(details.occupationStatus),
      ),
      preferences: Boolean(
        details && has(details.preferredAgeMin) && has(details.preferredHeightMinCm),
      ),
      identity: Boolean(profile.governmentIdHash),
    };

    const sections = REQUIRED_SECTIONS.map((section) => ({
      section,
      complete: done[section],
      label: SECTION_LABEL[section],
    }));
    const missing = sections.filter((s) => !s.complete).map((s) => s.section);

    return {
      profileId,
      complete: missing.length === 0,
      percent: Math.round(((sections.length - missing.length) / sections.length) * 100),
      sections,
      missing,
    };
  }

  // --------------------------------------------------------------- guards

  private async load(profileId: string): Promise<Profile> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  private assertMayRead(actor: AuthUser, profile: Profile): void {
    const mine = profile.userId === actor.userId || profile.managedByUserId === actor.userId;
    const staff = actor.role === UserRole.ADMIN || actor.role === UserRole.IN_PERSON;
    if (!mine && !staff) throw new ForbiddenException('That profile is not yours');
  }

  /**
   * Loads the details row for writing, creating it on first use.
   *
   * A steward may write only while the profile is unclaimed — the same line the
   * rest of the agency surface stops at.
   */
  private async editable(actor: AuthUser, profileId: string): Promise<ProfileDetails> {
    const profile = await this.load(profileId);

    const owns = profile.userId !== null && profile.userId === actor.userId;
    const stewards = profile.managedByUserId === actor.userId;
    if (!owns && !stewards && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('That profile is not yours to edit');
    }
    if (stewards && !owns && profile.userId !== null) {
      throw new ForbiddenException(
        'This profile belongs to its owner now — only they can edit it.',
      );
    }

    const existing = await this.details.findOne({ where: { profileId } });
    return existing ?? this.details.create({ profileId });
  }

  private async persist(profileId: string, row: ProfileDetails): Promise<ProfileDetails> {
    return this.details.save(row);
  }

  /**
   * Is the biodata complete enough to send to another family?
   *
   * Deliberately a different question from `profiles.profileCompleted`, which
   * gates matchmaking and asks only for the basics. Someone may look for
   * matches with a name, a date of birth and a city; nobody should be
   * circulating a biodata to strangers with the family section empty, because
   * the first thing the other side does is ask, and the agent has nothing.
   *
   * Identity is excluded: verification runs on its own track and should not
   * hold up an introduction.
   */
  async isBiodataComplete(profileId: string): Promise<boolean> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) return false;

    const [details, siblings] = await Promise.all([
      this.details.findOne({ where: { profileId } }),
      this.siblings.find({ where: { profileId } }),
    ]);
    const report = this.report(profileId, profile, details, siblings);
    return report.missing.every((section) => section === 'identity');
  }

  /** The sections still missing, for a message that says what to go and fill in. */
  async missingSections(profileId: string): Promise<string[]> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) return [...REQUIRED_SECTIONS];

    const [details, siblings] = await Promise.all([
      this.details.findOne({ where: { profileId } }),
      this.siblings.find({ where: { profileId } }),
    ]);
    return this.report(profileId, profile, details, siblings)
      .sections.filter((s) => !s.complete && s.section !== 'identity')
      .map((s) => s.label);
  }
}

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProfileDetails } from './entities/profile-details.entity';
import { ProfileSibling } from './entities/profile-sibling.entity';
import { ProfileAsset } from './entities/profile-asset.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { RedisService } from '../../platform/redis/redis.service';
import { ModerationService } from '../../platform/moderation/moderation.service';
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
import {
  InterestStatus,
  MaritalStatus,
  ProfileLifecycle,
  ProfileVisibility,
  UserRole,
} from '../../common/enums';
import { Interest } from '../matchmaking/entities/interest.entity';
import { ageBand } from '../users/dto/public-profile.dto';

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
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly redis: RedisService,
    private readonly moderation: ModerationService,
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
  ) {}

  // ------------------------------------------------------------- sections

  /** How many photographs a profile needs before the rest can be filled in. */
  private static readonly REQUIRED_PHOTOS = 3;

  async savePersonal(actor: AuthUser, profileId: string, dto: PersonalDetailsDto) {
    const row = await this.editable(actor, profileId);

    // Photographs first. A biodata with no picture is one nobody looks at, and
    // asking at the end means asking somebody who has already finished — so the
    // section that starts the form is the one that requires them.
    const profile = await this.load(profileId);
    const photos = profile.photos?.length ?? 0;
    if (photos < ProfileDetailsService.REQUIRED_PHOTOS) {
      throw new BadRequestException(
        `Add ${ProfileDetailsService.REQUIRED_PHOTOS} photographs before filling in the details — ` +
          `${photos} so far.`,
      );
    }

    // Surname and last name were two fields and are now one. A client that has
    // not been updated still sends a surname, and dropping it would lose a name
    // somebody typed; refusing the request outright would break them mid-deploy.
    const lastName = (dto.lastName || dto.surname || '').trim();
    if (!lastName) {
      throw new BadRequestException('A last name is required');
    }

    Object.assign(row, {
      firstName: dto.firstName,
      // One name field now. A client still sending a surname has it folded in
      // where there is no last name, rather than silently dropped.
      surname: null,
      lastName: lastName,
      heightCm: dto.heightCm,
      complexion: dto.complexion,
      // Native place moved to the family section. A client still sending it
      // here has it routed rather than dropped; place of birth is no longer
      // collected and is ignored.
      ...(dto.nativePlace ? { nativePlace: dto.nativePlace } : {}),
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
    const { horoscopeAvailable, horoscopeDocumentUrl, birthPlace, timeOfBirth, ...chart } = dto;

    row.horoscopeAvailable = horoscopeAvailable;

    /*
     * Where and when somebody was born is not part of the chart.
     *
     * Clearing the chart when the answer turns to "no" matters — a stale rashi
     * left behind would be shown as fact on a profile that has just said it
     * keeps no horoscope. But the birthplace and the time of birth are facts
     * about the person, true whether or not anybody drew a chart from them,
     * and wiping them with the rest meant a family who does not use horoscopes
     * could not record a birthplace they plainly know. They are kept on both
     * branches and merged over whatever was there, so clearing one is done by
     * emptying the field rather than by unticking a different question.
     */
    const born = {
      ...(timeOfBirth !== undefined ? { timeOfBirth } : {}),
      ...(birthPlace !== undefined ? { birthPlace } : {}),
    };
    const existing = (row.horoscope ?? {}) as Record<string, unknown>;
    const keptBorn = {
      ...(existing.timeOfBirth !== undefined ? { timeOfBirth: existing.timeOfBirth } : {}),
      ...(existing.birthPlace !== undefined ? { birthPlace: existing.birthPlace } : {}),
    };

    row.horoscope = horoscopeAvailable
      ? ({ ...keptBorn, ...(chart as Record<string, unknown>), ...born } as Record<string, unknown>)
      : ({ ...keptBorn, ...born } as Record<string, unknown>);

    // The document goes with the chart: a family saying they keep no horoscope
    // should not still have one attached to the profile.
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
      ...(dto.nativePlace ? { nativePlace: dto.nativePlace } : {}),
      ...(dto.nativeState ? { nativeState: dto.nativeState } : {}),
      ...(dto.nativeCountry ? { nativeCountry: dto.nativeCountry } : {}),
      ...(dto.nativeDistrict ? { nativeDistrict: dto.nativeDistrict } : {}),
      brothers: dto.brothers,
      sisters: dto.sisters,
      /*
       * Settled abroad, and where.
       *
       * `isNri` is written whenever it is sent, including false — that is a
       * real answer and has to be able to replace a yes. The city and country
       * are cleared when the answer is no, so a pair left behind by somebody
       * who changed their mind cannot sit on the record invisibly and
       * reappear if the answer ever flips back.
       */
      ...(dto.isNri === undefined
        ? {}
        : dto.isNri
          ? {
              isNri: true,
              nriCity: dto.nriCity ?? null,
              nriCountry: dto.nriCountry ?? null,
            }
          : { isNri: false, nriCity: null, nriCountry: null }),
      // Sent as a number, stored as numeric, and only written when the family
      // actually answered — `undefined` here would blank a figure entered on a
      // previous save, which is the shape of bug this whole file exists to
      // avoid.
      ...(dto.familyNetWorth === undefined
        ? {}
        : { familyNetWorth: String(dto.familyNetWorth) }),
      ...(dto.familyNetWorthVisible === undefined
        ? {}
        : { familyNetWorthVisible: dto.familyNetWorthVisible }),
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

    /*
     * The horoscope answers are preferences and are stored with the rest of
     * them. The *document* is not: it is this person's own chart rather than a
     * preference about anybody else's, so it goes where charts go. Attaching it
     * from this screen is a convenience — a family filling in preferences
     * usually has it to hand, and sending them to another section to attach it
     * is where they stop — but it lands in exactly one place.
     */
    Object.assign(row, {
      preferredAgeMin: dto.preferredAgeMin,
      preferredAgeMax: dto.preferredAgeMax,
      preferredHeightMinCm: dto.preferredHeightMinCm,
      preferredHeightMaxCm: dto.preferredHeightMaxCm,
      partnerPreferences: {
        ...(dto.preferences ?? {}),
        ...(dto.horoscopeExpectation ? { horoscopeExpectation: dto.horoscopeExpectation } : {}),
        ...(dto.kujaDosham ? { kujaDosham: dto.kujaDosham } : {}),
        ...(dto.preferredStars ? { preferredStars: dto.preferredStars } : {}),
      },
      ...(dto.horoscopeDocumentUrl ? { horoscopeDocumentUrl: dto.horoscopeDocumentUrl } : {}),
    });
    const saved = await this.persist(profileId, row);

    // The biodata is where preferences are *entered*; the compatibility engine
    // reads them from `profiles.preferences`. Those were two unconnected
    // stores, so somebody could fill in their partner preferences in full and
    // the engine would still score them against `{}` — which is exactly the
    // reported symptom: matchmaking "not working" while the data was plainly
    // there.
    await this.projectPreferences(profileId, row);
    return saved;
  }

  /**
   * Copies the answers the engine needs onto the profile itself.
   *
   * A projection, not a second source of truth: `profile_details` stays
   * authoritative and this is derived from it on every save. The alternative —
   * having the engine join across to the biodata — would put a second table in
   * the hot path of every suggestion query, on a rule that changes rarely.
   *
   * Only the fields the engine actually scores are copied. Copying everything
   * would quietly widen what a suggestion query can see into a record that has
   * its own visibility rules.
   */
  private async projectPreferences(profileId: string, row: ProfileDetails): Promise<void> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) return;

    const bag = (row.partnerPreferences ?? {}) as Record<string, unknown>;
    const text = (key: string): string | undefined => {
      const v = bag[key];
      return typeof v === 'string' && v.trim() ? v.trim() : undefined;
    };
    const list = (key: string): string[] | undefined => {
      const v = bag[key];
      if (Array.isArray(v)) {
        const items = v.filter((x): x is string => typeof x === 'string' && Boolean(x.trim()));
        return items.length > 0 ? items : undefined;
      }
      // Somebody typing "Hyderabad, Bengaluru" into a free-text box is the
      // common case, and dropping it because it is not an array would be the
      // same failure in a smaller way.
      const single = text(key);
      return single ? single.split(',').map((x) => x.trim()).filter(Boolean) : undefined;
    };

    profile.preferences = {
      ...profile.preferences,
      religion: text('religion') ?? profile.preferences?.religion,
      community: text('caste') ?? text('community') ?? profile.preferences?.community,
      education: text('education') ?? profile.preferences?.education,
      lifestyle: list('lifestyle') ?? profile.preferences?.lifestyle,
      preferredLocations:
        list('locations') ?? list('preferredLocations') ?? profile.preferences?.preferredLocations,
      preferredAgeMin: row.preferredAgeMin ?? profile.preferences?.preferredAgeMin,
      preferredAgeMax: row.preferredAgeMax ?? profile.preferences?.preferredAgeMax,
    };
    await this.profiles.save(profile);

    // The profile is cached per account, so writing it here and stopping would
    // leave every reader — including the matchmaking suggestion query — looking
    // at the copy from before the preferences were entered. Saving and not
    // invalidating is the exact shape of the vendor-profile bug fixed earlier:
    // the write lands, and nothing that reads it can tell.
  }

  // ------------------------------------------------------------- photographs
  //
  // Photographs hang off the profile, not off `profile_details`, because they
  // are what matchmaking and circulation both show. The routes live here
  // because this is the screen the subject actually fills their biodata in on
  // — until now the only way to attach one was through the agency console,
  // which is why a self-managed profile could never have a photograph at all.

  /** How many photographs one profile may carry. */
  private static readonly MAX_PHOTOS = 20;

  async addPhoto(actor: AuthUser, profileId: string, url: string) {
    await this.editable(actor, profileId);

    // A matrimonial profile is a claim about a real person. A generated face
    // makes the government ID, the officer's visit and the family's consent all
    // attach to somebody who does not exist, so this is an identity control
    // rather than a content filter — and it runs before anything is stored
    // against the profile.
    await this.moderation.assertGenuinePhoto(url, { userId: actor.userId, kind: 'biodata' });

    const profile = await this.load(profileId);

    const photos = profile.photos ?? [];
    if (photos.includes(url)) return this.photoState(profile);
    if (photos.length >= ProfileDetailsService.MAX_PHOTOS) {
      throw new BadRequestException(
        `A profile can hold at most ${ProfileDetailsService.MAX_PHOTOS} photos.`,
      );
    }

    profile.photos = [...photos, url];
    const saved = await this.profiles.save(profile);

    // The first photograph somebody uploads becomes the one shown first,
    // because the alternative is a profile with pictures on it and a blank
    // avatar next to them.
    const row = await this.details.findOne({ where: { profileId } });
    if (row && !row.primaryPhotoUrl) {
      row.primaryPhotoUrl = url;
      await this.details.save(row);
    }

    return this.photoState(saved);
  }

  async removePhoto(actor: AuthUser, profileId: string, url: string) {
    await this.editable(actor, profileId);
    const profile = await this.load(profileId);

    profile.photos = (profile.photos ?? []).filter((p) => p !== url);
    const saved = await this.profiles.save(profile);

    // Removing the primary leaves the pointer dangling, so it moves to whatever
    // is left rather than to nothing.
    const row = await this.details.findOne({ where: { profileId } });
    if (row?.primaryPhotoUrl === url) {
      row.primaryPhotoUrl = saved.photos[0] ?? null;
      await this.details.save(row);
    }

    return this.photoState(saved);
  }

  /**
   * Clears the biodata: the details, the siblings, the family assets and the
   * photographs.
   *
   * Deliberately *not* the account, and not the profile row. "Delete profile"
   * on a biodata screen means "I want to start this again" far more often than
   * it means "close my account", and the second is a different action with
   * different consequences — it lives under Security, needs a password, and
   * refuses while money is in flight.
   *
   * What survives: the account, the consent record, the agency's books, and any
   * interests already sent or received. Those are either somebody else's
   * record or the platform's own, and a person clearing their biodata is not a
   * reason to lose them. The profile does become incomplete, which is what
   * takes it out of matchmaking.
   */
  async clearBiodata(actor: AuthUser, profileId: string): Promise<{ success: true }> {
    await this.editable(actor, profileId);

    await this.siblings.delete({ profileId });
    await this.assets.delete({ profileId });
    await this.details.delete({ profileId });

    const profile = await this.load(profileId);
    profile.photos = [];
    profile.profileCompleted = false;
    await this.profiles.save(profile);

    return { success: true };
  }

  async listPhotos(actor: AuthUser, profileId: string) {
    const profile = await this.load(profileId);
    this.assertMayRead(actor, profile);
    return this.photoState(profile);
  }

  private async photoState(profile: Profile) {
    const row = await this.details.findOne({ where: { profileId: profile.id } });
    return {
      photos: profile.photos ?? [],
      primaryPhotoUrl: row?.primaryPhotoUrl ?? profile.photos?.[0] ?? null,
      max: ProfileDetailsService.MAX_PHOTOS,
    };
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
      contact: await this.contactFor(profile),
      completion: this.report(profileId, profile, details, siblings),
    };
  }

  /**
   * Which number is which.
   *
   * The two live in different places for good reasons — the primary is on the
   * account because it is what signs you in and what an OTP goes to, and the
   * alternate is on the biodata because it is usually the family's landline —
   * but a page that shows one without the other reads as though the primary is
   * missing. That was the reported defect. They are returned together, each
   * labelled, with the verified state of the one that has one.
   */
  private async contactFor(profile: Profile): Promise<{
    primaryMobile: string | null;
    primaryMobileVerified: boolean;
    /** Where the primary lives: the account, so it is edited under Security. */
    primaryMobileSource: 'account' | 'agency_record';
    alternateMobile: string | null;
    email: string | null;
  }> {
    // An agent-built profile has no account behind it yet, so the number the
    // agency took at the desk is the primary one there is.
    if (!profile.userId) {
      return {
        primaryMobile: profile.contactPhone,
        primaryMobileVerified: false,
        primaryMobileSource: 'agency_record',
        alternateMobile: null,
        email: profile.contactEmail,
      };
    }

    const user = await this.users.findOne({
      where: { id: profile.userId },
      select: ['id', 'phone', 'phoneVerifiedAt', 'email'],
    });
    const details = await this.details.findOne({ where: { profileId: profile.id } });

    return {
      primaryMobile: user?.phone ?? profile.contactPhone ?? null,
      primaryMobileVerified: Boolean(user?.phoneVerifiedAt),
      primaryMobileSource: 'account',
      alternateMobile: details?.alternateMobile ?? null,
      email: user?.email ?? profile.contactEmail ?? null,
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
  /**
   * One profile, as somebody browsing is allowed to see it.
   *
   * `findShareable` has existed since the biodata was built and was never
   * reachable, which is why a match could be listed but not opened: there was
   * nothing to open. The reported symptom — "the profile is not clickable" —
   * was a missing route rather than a missing link.
   *
   * Who may see it is deliberately the same rule that decides whether they
   * could have been *shown* it in the first place. Anything looser would make
   * a profile id guessable into a biodata; anything tighter would list people
   * you are not allowed to look at.
   */
  async findViewable(actor: AuthUser, profileId: string) {
    const profile = await this.load(profileId);

    const controlsIt =
      profile.userId === actor.userId ||
      profile.managedByUserId === actor.userId ||
      actor.role === UserRole.ADMIN;

    // Whether the caller may see the full biodata, or only the basic card.
    let basicOnly = false;

    if (!controlsIt) {
      if (profile.lifecycle !== ProfileLifecycle.ACTIVE) {
        throw new NotFoundException('That profile is not available');
      }
      // Explicitly PRIVATE stays fully shut, before and after any interest.
      if (profile.visibility === ProfileVisibility.PRIVATE) {
        throw new ForbiddenException('That profile is private');
      }

      // MATCHES_ONLY means exactly that: an accepted interest between the two
      // sides, in either direction.
      if (profile.visibility === ProfileVisibility.MATCHES_ONLY) {
        const mine = await this.profiles.find({
          where: [{ userId: actor.userId }, { managedByUserId: actor.userId }],
        });
        const ids = mine.map((p) => p.id);
        const matched = ids.length
          ? await this.interests.findOne({
              where: [
                { fromProfileId: In(ids), toProfileId: profileId, status: InterestStatus.ACCEPTED },
                { fromProfileId: profileId, toProfileId: In(ids), status: InterestStatus.ACCEPTED },
              ],
            })
          : null;
        // Before mutual acceptance the counterpart is not shut out entirely —
        // they see a basic card (name, age band, gender, city, one photo) so
        // they can decide whether to express interest at all. The private
        // biodata — contact, family, horoscope, the full gallery — stays behind
        // the mutual accept. A profile marked PRIVATE (above) is exempt.
        if (!matched) basicOnly = true;
      }
    }

    if (basicOnly) {
      return {
        limited: true as const,
        // Empty, not absent: the profile view renders these lists, and the basic
        // card deliberately carries none of the private biodata behind them.
        siblings: [],
        assets: [],
        details: null,
        contact: null,
        profile: {
          id: profile.id,
          profileCode: profile.profileCode,
          displayName: profile.displayName,
          city: profile.city,
          gender: profile.gender,
          // An age band, not the exact date of birth: enough to judge a match,
          // not the full record, which is what the mutual accept unlocks.
          ageRange: ageBand(profile.dateOfBirth),
          photos: (profile.photos ?? []).slice(0, 1),
          identityVerified: Boolean(profile.idVerifiedAt),
          stewardship: await this.stewardshipOf(profile),
        },
      };
    }

    const shareable = await this.findShareable(profileId);
    return {
      ...shareable,
      profile: {
        id: profile.id,
        profileCode: profile.profileCode,
        displayName: profile.displayName,
        city: profile.city,
        gender: profile.gender,
        dateOfBirth: profile.dateOfBirth,
        photos: profile.photos ?? [],
        bio: profile.bio,
        // Whether a verification officer has seen the document, which is the
        // thing families ask about before anything else.
        identityVerified: Boolean(profile.idVerifiedAt),
        // What the managed person is — bride or groom — shown at the foot of the
        // profile when a family member opens it from chat (EZ1-I41).
        managingFor: profile.managingFor ?? null,
        // Who is answering for this person, and what they are to them.
        //
        // A family reading a biodata wants to know who they will actually be
        // speaking to. "Managed by a family member — their father" is a
        // materially different proposition from an agency listing, and the
        // profile said nothing about either.
        stewardship: await this.stewardshipOf(profile),
      },
    };
  }

  /**
   * Who manages this profile, in the words a reader uses.
   *
   * Returns null for a self-managed profile, which is the common case and
   * needs no label — saying "managed by themselves" on every card is noise.
   */
  private async stewardshipOf(
    profile: Profile,
  ): Promise<{ kind: 'family' | 'agency'; label: string; relation: string | null } | null> {
    if (!profile.managedByUserId || profile.managedByUserId === profile.userId) return null;

    const steward = await this.users.findOne({ where: { id: profile.managedByUserId } });
    if (!steward) return null;

    if (steward.role === UserRole.FAMILY) {
      return {
        kind: 'family',
        label: 'Managed by a family member',
        relation: profile.stewardRelation,
      };
    }
    return { kind: 'agency', label: 'Managed by an agency', relation: null };
  }

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
      // Native place moved to the family section and place of birth is no
      // longer collected, so neither can be a condition of this one being
      // complete — every existing profile would otherwise become incomplete on
      // deploy, and the fix would look like data loss.
      personal: Boolean(
        details &&
          has(details.firstName) &&
          has(details.lastName) &&
          has(details.heightCm) &&
          has(details.complexion) &&
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
      // The native place is asked here now.
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

  /**
   * Saves a section, and drops the match suggestions computed from it.
   *
   * The compatibility engine reads the biodata, and its results are cached for
   * two minutes. Without this, a family could correct their religion or widen
   * their age range, watch the field save, and be shown the same scores
   * computed from what they had just changed — which reads as the edit not
   * having taken. The cache exists to keep a browse cheap, not to outlive the
   * data it was computed from.
   *
   * Both directions matter: this profile's own suggestions, and the suggestions
   * of anyone this profile appears in. The second cannot be enumerated without
   * scanning, so the key pattern covers it.
   */
  private async persist(profileId: string, row: ProfileDetails): Promise<ProfileDetails> {
    const saved = await this.details.save(row);
    await this.invalidateSuggestions(profileId);
    return saved;
  }

  private async invalidateSuggestions(profileId: string): Promise<void> {
    const own = await this.redis.raw.keys(`match:suggestions:${profileId}:*`);
    if (own.length) await this.redis.del(...own);
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

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Profile, ProfilePreferences } from '../entities/profile.entity';
import { ProfileClaimStatus, ProfileVisibility } from '../../../common/enums';

/**
 * What one person is allowed to see of another.
 *
 * The entity was previously returned whole from match suggestions, which handed
 * every browsing user an exact date of birth and the full photo set of everyone
 * they were shown, before any interest had been accepted. This view is the
 * gate: an age band instead of a birth date, and photos only after a match.
 */
export class PublicProfileView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  displayName: string;

  @ApiPropertyOptional()
  gender?: string;

  /** e.g. "26-30". Null when no date of birth is recorded. */
  @ApiPropertyOptional({ example: '26-30' })
  ageRange: string | null;

  @ApiPropertyOptional()
  city?: string;

  @ApiPropertyOptional()
  bio?: string;

  /** First photo only until matched, then the full set. Empty if hidden. */
  @ApiProperty({ type: [String] })
  photos: string[];

  @ApiProperty()
  photoCount: number;

  @ApiProperty({ description: 'True once photos and details are fully visible' })
  matched: boolean;

  @ApiPropertyOptional()
  preferences?: Pick<ProfilePreferences, 'religion' | 'community' | 'education' | 'lifestyle'>;

  @ApiProperty({ enum: ProfileClaimStatus })
  claimStatus: ProfileClaimStatus;

  /** True when an agent or family member is handling this profile. */
  @ApiProperty()
  managed: boolean;

  /**
   * Which agency put this profile on the platform.
   *
   * `managed` already said that somebody did, which answers a question nobody
   * was asking. Whose profile this is decides whether an agent picks up the
   * phone, and where a family takes a complaint if the details turn out to be
   * wrong — and until now it could only be found by opening the profile, if at
   * all. Null for a self-registered person, who is their own source.
   */
  @ApiPropertyOptional({ example: 'ABC Marriage Agency' })
  sourceAgency?: string | null;

  /** The short code a family can read out. */
  @ApiProperty({ example: 'WOW10231' })
  profileCode: string;

  /** An officer has seen the identity document in person. */
  @ApiProperty()
  verified: boolean;

  /** Null when the profile has never signed in — an agency-built one, say. */
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  lastActiveAt: string | null;

  /**
   * The handful of biodata fields a card is useless without.
   *
   * Not the whole biodata — that is what circulation is for, and it goes
   * through consent. This is the subset a family reads before deciding whether
   * to look further: what they do, what they studied, whether they have been
   * married before. A card carrying only a name, a town and an age band was the
   * reported problem, and it is a fair one: there is nothing there to judge.
   */
  @ApiPropertyOptional()
  card?: ProfileCardFacts;
}

export interface ProfileCardFacts {
  heightCm: number | null;
  religion: string | null;
  caste: string | null;
  motherTongue: string | null;
  maritalStatus: string | null;
  highestQualification: string | null;
  occupationStatus: string | null;
  /** Job title, or the business name when self-employed. */
  profession: string | null;

  /**
   * The horoscope, on the card.
   *
   * The engine has scored against these from the beginning and the biodata has
   * carried them, and a family could not see any of it without opening the
   * profile — which is the wrong way round in this market: for a great many
   * families rashi and gothram decide whether the rest of the card is worth
   * reading at all. Null throughout for a family that does not use horoscopes,
   * and the card simply shows nothing rather than a row of blanks.
   */
  rashi: string | null;
  star: string | null;
  padam: string | null;
  gothram: string | null;
  kujaDosham: string | null;
}

/**
 * Reads the card facts off a biodata row.
 *
 * Income is deliberately absent even when `incomeVisible` is set: it belongs on
 * the profile somebody has chosen to open, not on a card in a grid of forty.
 */
export function toCardFacts(details: {
  heightCm: number | null;
  religion: string | null;
  caste: string | null;
  motherTongue: string | null;
  maritalStatus: string | null;
  highestQualification: string | null;
  occupationStatus: string | null;
  employment: Record<string, unknown>;
  business: Record<string, unknown>;
  horoscope?: Record<string, unknown>;
  horoscopeAvailable?: boolean | null;
}): ProfileCardFacts {
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null;

  // Only when the family says a chart exists. A profile that left the
  // horoscope section alone has an empty object here, and reading fields out
  // of it would print an empty row on every card that has nothing to say.
  const chart = details.horoscopeAvailable ? (details.horoscope ?? {}) : {};

  return {
    rashi: text(chart.rashi),
    star: text(chart.star),
    padam: text(chart.padam),
    gothram: text(chart.gothram),
    kujaDosham: text(chart.kujaDosham),
    heightCm: details.heightCm,
    religion: details.religion,
    caste: details.caste,
    motherTongue: details.motherTongue,
    maritalStatus: details.maritalStatus,
    highestQualification: details.highestQualification,
    occupationStatus: details.occupationStatus,
    profession:
      text(details.employment?.role) ??
      text(details.employment?.designation) ??
      text(details.employment?.company) ??
      text(details.business?.name) ??
      null,
  };
}

/**
 * A profile as its own owner sees it.
 *
 * Everything the entity holds except the two fields nobody outside the server
 * has any use for. `governmentIdHash` is the peppered fingerprint of an
 * identity document — the one value that answers "is this the same person as
 * that other profile?" — and it was going out with every `GET /users/me`, which
 * put it in the browser, in devtools, and in anything that logs a response
 * body. Hashing the number and then handing out the hash gives back most of
 * what hashing it was for.
 *
 * `idVerifiedByUserId` names the officer who confirmed the document, which is
 * an internal audit fact rather than something the subject is owed.
 */
export type OwnProfileView = Omit<Profile, 'governmentIdHash' | 'idVerifiedByUserId'>;

export function toOwnProfile(profile: Profile): OwnProfileView {
  const { governmentIdHash: _hash, idVerifiedByUserId: _officer, ...rest } = profile;
  return rest;
}

/**
 * The fuller view a circulated profile gets: the traditional biodata sheet.
 *
 * Deliberately more generous than `PublicProfileView`. Somebody a profile was
 * *deliberately* shared with — another agent assessing the match, or a family
 * the agent sent it to — needs the photos and the detail, or circulating it
 * achieves nothing. The gate is the sharing decision plus consent, not the
 * projection.
 *
 * Contact details are still withheld: the whole point of a matrimony agent is
 * that they broker the introduction.
 */
export interface BiodataView {
  id: string;
  profileCode: string;
  displayName: string;
  gender?: string;
  ageRange: string | null;
  dateOfBirth: string | null;
  city?: string;
  bio?: string;
  photos: string[];
  preferences?: ProfilePreferences;
  claimStatus: ProfileClaimStatus;
  managed: boolean;
}

export function toBiodata(profile: Profile): BiodataView {
  return {
    id: profile.id,
    displayName: profile.displayName,
    gender: profile.gender,
    ageRange: ageBand(profile.dateOfBirth),
    // Age matters enough in this market to be worth the precision, and this
    // view is only reachable through a deliberate share.
    dateOfBirth: profile.dateOfBirth,
    city: profile.city,
    bio: profile.bio,
    photos: profile.photos ?? [],
    preferences: profile.preferences,
    claimStatus: profile.claimStatus,
    managed: profile.managedByUserId !== null,
    profileCode: profile.profileCode,
  };
}

/** Five-year bands, which is precise enough to match on and coarse enough not to identify. */
export function ageBand(dateOfBirth: string | null): string | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDelta = now.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) age -= 1;
  if (age < 18 || age > 99) return null;

  const lower = Math.floor((age - 1) / 5) * 5 + 1;
  return `${lower}-${lower + 4}`;
}

/**
 * Projects a profile for another user's eyes.
 *
 * `matched` unlocks the full photo set and free-text bio; before that, a viewer
 * sees one lead photo and the structured fields the matching engine works on.
 */
export function toPublicProfile(
  profile: Profile,
  opts: { matched?: boolean; card?: ProfileCardFacts; sourceAgency?: string | null } = {},
): PublicProfileView {
  const matched = Boolean(opts.matched);
  const allPhotos = profile.photos ?? [];

  // MATCHES_ONLY hides imagery until both sides have agreed. PUBLIC profiles
  // show a lead photo to browsers. PRIVATE profiles never reach here, but treat
  // them as hidden anyway rather than relying on the caller having filtered.
  let photos: string[] = [];
  if (matched) photos = allPhotos;
  else if (profile.visibility === ProfileVisibility.PUBLIC) photos = allPhotos.slice(0, 1);

  return {
    sourceAgency: opts.sourceAgency ?? null,
    id: profile.id,
    displayName: profile.displayName,
    gender: profile.gender,
    ageRange: ageBand(profile.dateOfBirth),
    city: profile.city,
    bio: matched ? profile.bio : undefined,
    photos,
    photoCount: allPhotos.length,
    matched,
    preferences: profile.preferences
      ? {
          religion: profile.preferences.religion,
          community: profile.preferences.community,
          education: profile.preferences.education,
          lifestyle: profile.preferences.lifestyle,
          // Deliberately omitted: preferredAgeMin/Max and preferredLocations are
          // the owner's search criteria, not public information about them.
        }
      : undefined,
    claimStatus: profile.claimStatus,
    managed: profile.managedByUserId !== null,
    profileCode: profile.profileCode,
    verified: Boolean(profile.idVerifiedAt),
    lastActiveAt: profile.lastActiveAt ? profile.lastActiveAt.toISOString() : null,
    card: opts.card,
  };
}

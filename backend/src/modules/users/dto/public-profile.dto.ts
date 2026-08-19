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
  opts: { matched?: boolean } = {},
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
  };
}

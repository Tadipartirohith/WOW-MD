import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { Profile } from '../users/entities/profile.entity';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';

export interface MatchWeights {
  weightAge: number;
  weightLocation: number;
  weightReligion: number;
  weightCaste: number;
  weightMotherTongue: number;
  weightEducation: number;
  weightLifestyle: number;
  weightPreferences: number;
  maxAgeGap: number;
}

export interface CompatibilityResult {
  score: number; // 0-100
  breakdown: Record<string, number>;
}

/**
 * One side of a comparison: the account-level profile, and the biodata.
 *
 * Both, because they hold different things. The profile has the date of birth,
 * the town and the photographs; the biodata has everything a family actually
 * matches on. A profile with no biodata row is still scorable — an agency
 * builds those before the client has filled anything in — it simply has less
 * to be scored on.
 */
export interface ScoringSubject {
  profile: Profile;
  details?: ProfileDetails | null;
}

const ageFromDob = (dob: string | null): number | null => {
  if (!dob) return null;
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;

const num = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * Where a matchable fact lives.
 *
 * The biodata first, the profile's `preferences` blob second. That order is the
 * whole of this round's matchmaking fix: the engine read only the blob, and the
 * blob is written by `PUT /users/me/profile`, which the biodata form does not
 * call. So for every profile built the way the product actually asks people to
 * build one — through the sectioned biodata — religion, education and the
 * preferred age range were all absent, scored zero, and dragged the result
 * down. Two families who matched on every count could score in the thirties.
 */
const religionOf = (s: ScoringSubject): string | null =>
  text(s.details?.religion) ?? text(s.profile.preferences?.religion);

const casteOf = (s: ScoringSubject): string | null =>
  text(s.details?.caste) ?? text(s.profile.preferences?.community);

const motherTongueOf = (s: ScoringSubject): string | null => text(s.details?.motherTongue);

const educationOf = (s: ScoringSubject): string | null =>
  text(s.details?.highestQualification) ?? text(s.profile.preferences?.education);

const cityOf = (s: ScoringSubject): string | null =>
  text(s.profile.city) ?? text(s.details?.residence?.city);

const lifestyleOf = (s: ScoringSubject): Set<string> =>
  new Set(
    (s.profile.preferences?.lifestyle ?? [])
      .map((v) => text(v))
      .filter((v): v is string => v !== null),
  );

const preferredAgeOf = (s: ScoringSubject): { min: number | null; max: number | null } => ({
  min: num(s.details?.preferredAgeMin) ?? num(s.profile.preferences?.preferredAgeMin),
  max: num(s.details?.preferredAgeMax) ?? num(s.profile.preferences?.preferredAgeMax),
});

/**
 * PURE, side-effect-free compatibility scorer.
 *
 * **Only what can be judged is counted.** The previous version divided by the
 * full weight of every dimension whether or not there was anything to compare —
 * so a pair who had simply not recorded a mother tongue were marked down for
 * it, exactly as if they had recorded different ones. A dimension neither side
 * has stated is not evidence of incompatibility; it is an absence of evidence,
 * and it now leaves the score alone rather than pulling it toward zero.
 *
 * `breakdown` carries only the dimensions that were actually evaluated, which
 * is also what the match card lists as the reasons.
 */
export function scoreProfiles(
  a: Profile | ScoringSubject,
  b: Profile | ScoringSubject,
  weights: MatchWeights,
): CompatibilityResult {
  // Callers that predate the biodata-aware signature still pass bare profiles.
  const left: ScoringSubject = 'profile' in a ? a : { profile: a };
  const right: ScoringSubject = 'profile' in b ? b : { profile: b };

  const breakdown: Record<string, number> = {};
  let applicable = 0;

  /** Records a dimension that could be judged, and what it earned. */
  const judge = (name: string, weight: number, earned: number) => {
    // A dimension weighted to nothing was still evaluated — it simply cannot
    // earn anything, and it must not shrink the denominator either.
    breakdown[name] = weight > 0 ? earned : 0;
    if (weight > 0) applicable += weight;
  };

  /** The common case: both sides stated it, and they either agree or do not. */
  const judgeEquality = (name: string, weight: number, x: string | null, y: string | null) => {
    if (x === null || y === null) return;
    judge(name, weight, x === y ? weight : 0);
  };

  // Age proximity: full score at no gap, falling linearly to nothing at the
  // configured ceiling.
  const ageA = ageFromDob(left.profile.dateOfBirth);
  const ageB = ageFromDob(right.profile.dateOfBirth);
  if (ageA !== null && ageB !== null && weights.maxAgeGap > 0) {
    const ratio = Math.max(0, 1 - Math.abs(ageA - ageB) / weights.maxAgeGap);
    judge('age', weights.weightAge, weights.weightAge * ratio);
  }

  judgeEquality('location', weights.weightLocation, cityOf(left), cityOf(right));
  judgeEquality('religion', weights.weightReligion, religionOf(left), religionOf(right));
  judgeEquality('caste', weights.weightCaste, casteOf(left), casteOf(right));
  judgeEquality(
    'motherTongue',
    weights.weightMotherTongue,
    motherTongueOf(left),
    motherTongueOf(right),
  );
  judgeEquality('education', weights.weightEducation, educationOf(left), educationOf(right));

  // Lifestyle overlap, as a proportion of everything either side named.
  const lifeA = lifestyleOf(left);
  const lifeB = lifestyleOf(right);
  if (lifeA.size && lifeB.size) {
    const overlap = [...lifeA].filter((x) => lifeB.has(x)).length;
    const union = new Set([...lifeA, ...lifeB]).size;
    judge('lifestyle', weights.weightLifestyle, weights.weightLifestyle * (overlap / union));
  }

  /*
   * Stated partner preferences, checked both ways.
   *
   * A match is not one family's opinion of the other. Scoring only whether b
   * fits a's stated window made the same pair score differently depending on
   * which of them was doing the browsing, which is why two people could see
   * different percentages for the same match.
   */
  const satisfied: boolean[] = [];
  const checkWindow = (viewer: ScoringSubject, other: ScoringSubject) => {
    const otherAge = ageFromDob(other.profile.dateOfBirth);
    const { min, max } = preferredAgeOf(viewer);
    if (otherAge !== null && min !== null && max !== null) {
      satisfied.push(otherAge >= min && otherAge <= max);
    }

    const otherHeight = num(other.details?.heightCm);
    const minH = num(viewer.details?.preferredHeightMinCm);
    const maxH = num(viewer.details?.preferredHeightMaxCm);
    if (otherHeight !== null && minH !== null && maxH !== null) {
      satisfied.push(otherHeight >= minH && otherHeight <= maxH);
    }

    const wanted = (viewer.details?.partnerPreferences ?? {}) as Record<string, unknown>;
    const compare: [unknown, string | null][] = [
      [wanted.religion, religionOf(other)],
      [wanted.caste, casteOf(other)],
      [wanted.education, educationOf(other)],
    ];
    for (const [want, have] of compare) {
      const wantText = text(want);
      if (wantText && have) satisfied.push(wantText === have);
    }
  };
  checkWindow(left, right);
  checkWindow(right, left);

  if (satisfied.length) {
    const met = satisfied.filter(Boolean).length / satisfied.length;
    judge('preferences', weights.weightPreferences, weights.weightPreferences * met);
  }

  const earned = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  const score = applicable > 0 ? Math.round((earned / applicable) * 100) : 0;
  return { score, breakdown };
}

@Injectable()
export class CompatibilityEngine {
  constructor(private readonly cfg: AppConfigService) {}

  get weights(): MatchWeights {
    const m = this.cfg.matchmaking;
    return {
      weightAge: m.weightAge,
      weightLocation: m.weightLocation,
      weightReligion: m.weightReligion,
      weightCaste: m.weightCaste,
      weightMotherTongue: m.weightMotherTongue,
      weightEducation: m.weightEducation,
      weightLifestyle: m.weightLifestyle,
      weightPreferences: m.weightPreferences,
      maxAgeGap: m.maxAgeGap,
    };
  }

  score(a: Profile | ScoringSubject, b: Profile | ScoringSubject): CompatibilityResult {
    return scoreProfiles(a, b, this.weights);
  }
}

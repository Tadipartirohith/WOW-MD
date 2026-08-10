import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { Profile } from '../users/entities/profile.entity';

export interface MatchWeights {
  weightAge: number;
  weightLocation: number;
  weightReligion: number;
  weightEducation: number;
  weightLifestyle: number;
  weightPreferences: number;
  maxAgeGap: number;
}

export interface CompatibilityResult {
  score: number; // 0-100
  breakdown: Record<string, number>;
}

const ageFromDob = (dob: string | null): number | null => {
  if (!dob) return null;
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
};

/**
 * PURE, side-effect-free compatibility scorer. All tunables are passed in via
 * `weights` (sourced from config), which makes the algorithm fully unit-testable
 * and lets ops re-weight behaviour with no code change.
 */
export function scoreProfiles(a: Profile, b: Profile, weights: MatchWeights): CompatibilityResult {
  const breakdown: Record<string, number> = {};

  // Age proximity: full score at 0 gap, linearly to 0 at maxAgeGap.
  const ageA = ageFromDob(a.dateOfBirth);
  const ageB = ageFromDob(b.dateOfBirth);
  if (ageA !== null && ageB !== null && weights.maxAgeGap > 0) {
    const gap = Math.abs(ageA - ageB);
    const ratio = Math.max(0, 1 - gap / weights.maxAgeGap);
    breakdown.age = weights.weightAge * ratio;
  } else {
    breakdown.age = 0;
  }

  // Location match (same city).
  breakdown.location =
    a.city && b.city && a.city.toLowerCase() === b.city.toLowerCase() ? weights.weightLocation : 0;

  // Religion / community.
  breakdown.religion =
    a.preferences?.religion &&
    b.preferences?.religion &&
    a.preferences.religion.toLowerCase() === b.preferences.religion.toLowerCase()
      ? weights.weightReligion
      : 0;

  // Education.
  breakdown.education =
    a.preferences?.education &&
    b.preferences?.education &&
    a.preferences.education.toLowerCase() === b.preferences.education.toLowerCase()
      ? weights.weightEducation
      : 0;

  // Lifestyle overlap (Jaccard-ish).
  const lifeA = new Set((a.preferences?.lifestyle ?? []).map((s) => s.toLowerCase()));
  const lifeB = new Set((b.preferences?.lifestyle ?? []).map((s) => s.toLowerCase()));
  if (lifeA.size && lifeB.size) {
    const overlap = [...lifeA].filter((x) => lifeB.has(x)).length;
    const union = new Set([...lifeA, ...lifeB]).size;
    breakdown.lifestyle = weights.weightLifestyle * (overlap / union);
  } else {
    breakdown.lifestyle = 0;
  }

  // Stated preference satisfaction (b falls within a's preferred age window).
  if (ageB !== null && a.preferences?.preferredAgeMin && a.preferences?.preferredAgeMax) {
    breakdown.preferences =
      ageB >= a.preferences.preferredAgeMin && ageB <= a.preferences.preferredAgeMax
        ? weights.weightPreferences
        : 0;
  } else {
    breakdown.preferences = 0;
  }

  const totalWeight =
    weights.weightAge +
    weights.weightLocation +
    weights.weightReligion +
    weights.weightEducation +
    weights.weightLifestyle +
    weights.weightPreferences;

  const rawScore = Object.values(breakdown).reduce((s, v) => s + v, 0);
  const score = totalWeight > 0 ? Math.round((rawScore / totalWeight) * 100) : 0;

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
      weightEducation: m.weightEducation,
      weightLifestyle: m.weightLifestyle,
      weightPreferences: m.weightPreferences,
      maxAgeGap: m.maxAgeGap,
    };
  }

  score(a: Profile, b: Profile): CompatibilityResult {
    return scoreProfiles(a, b, this.weights);
  }
}

import { scoreProfiles, MatchWeights } from './compatibility.engine';
import { Profile } from '../users/entities/profile.entity';
import { ProfileVisibility } from '../../common/enums';

const weights: MatchWeights = {
  weightAge: 20,
  weightLocation: 20,
  weightReligion: 20,
  weightEducation: 15,
  weightLifestyle: 15,
  weightPreferences: 10,
  maxAgeGap: 8,
};

const dobForAge = (age: number): string => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  return d.toISOString().slice(0, 10);
};

const makeProfile = (overrides: Partial<Profile>): Profile =>
  ({
    id: 'x',
    userId: 'u',
    displayName: 'Test',
    gender: 'Female',
    dateOfBirth: dobForAge(28),
    city: 'Mumbai',
    preferences: {},
    photos: [],
    bio: '',
    visibility: ProfileVisibility.MATCHES_ONLY,
    profileCompleted: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Profile;

describe('scoreProfiles (compatibility engine)', () => {
  it('scores a perfect match at or near 100', () => {
    const a = makeProfile({
      dateOfBirth: dobForAge(28),
      city: 'Mumbai',
      preferences: {
        religion: 'Hindu',
        education: 'Masters',
        lifestyle: ['vegetarian', 'non-smoker'],
        preferredAgeMin: 25,
        preferredAgeMax: 32,
      },
    });
    const b = makeProfile({
      dateOfBirth: dobForAge(29),
      city: 'Mumbai',
      preferences: {
        religion: 'Hindu',
        education: 'Masters',
        lifestyle: ['vegetarian', 'non-smoker'],
      },
    });
    const { score } = scoreProfiles(a, b, weights);
    expect(score).toBeGreaterThanOrEqual(95);
  });

  it('scores a total mismatch at 0', () => {
    const a = makeProfile({
      dateOfBirth: dobForAge(25),
      city: 'Mumbai',
      preferences: { religion: 'Hindu', education: 'Masters', lifestyle: ['vegetarian'] },
    });
    const b = makeProfile({
      dateOfBirth: dobForAge(50), // beyond maxAgeGap
      city: 'Delhi',
      preferences: { religion: 'Christian', education: 'Diploma', lifestyle: ['smoker'] },
    });
    const { score } = scoreProfiles(a, b, weights);
    expect(score).toBe(0);
  });

  it('decreases age sub-score as the gap widens', () => {
    const base = makeProfile({ dateOfBirth: dobForAge(30), city: 'X', preferences: {} });
    const near = makeProfile({ dateOfBirth: dobForAge(31), city: 'Y', preferences: {} });
    const far = makeProfile({ dateOfBirth: dobForAge(37), city: 'Y', preferences: {} });
    expect(scoreProfiles(base, near, weights).breakdown.age).toBeGreaterThan(
      scoreProfiles(base, far, weights).breakdown.age,
    );
  });

  it('respects configurable weights (re-weighting changes the result)', () => {
    const a = makeProfile({ city: 'Mumbai', preferences: {} });
    const b = makeProfile({ city: 'Mumbai', preferences: {} });
    const locationHeavy = { ...weights, weightLocation: 100 };
    const locationZero = { ...weights, weightLocation: 0 };
    expect(scoreProfiles(a, b, locationHeavy).breakdown.location).toBe(100);
    expect(scoreProfiles(a, b, locationZero).breakdown.location).toBe(0);
  });

  it('never exceeds 100 or drops below 0', () => {
    const a = makeProfile({});
    const b = makeProfile({});
    const { score } = scoreProfiles(a, b, weights);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

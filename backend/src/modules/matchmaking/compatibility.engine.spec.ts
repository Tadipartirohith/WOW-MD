import { scoreProfiles, MatchWeights, ScoringSubject } from './compatibility.engine';
import { Profile } from '../users/entities/profile.entity';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import { ProfileVisibility } from '../../common/enums';

const weights: MatchWeights = {
  weightAge: 20,
  weightLocation: 20,
  weightReligion: 20,
  weightCaste: 10,
  weightMotherTongue: 5,
  weightEducation: 15,
  weightLifestyle: 15,
  weightPreferences: 10,
  maxAgeGap: 8,
};

const makeDetails = (overrides: Partial<ProfileDetails>): ProfileDetails =>
  ({
    profileId: 'x',
    religion: null,
    caste: null,
    motherTongue: null,
    highestQualification: null,
    heightCm: null,
    preferredAgeMin: null,
    preferredAgeMax: null,
    preferredHeightMinCm: null,
    preferredHeightMaxCm: null,
    partnerPreferences: {},
    residence: {},
    ...overrides,
  }) as ProfileDetails;

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

  /*
   * The reported defect: the engine read `profiles.preferences`, which the
   * biodata form never writes. Everything a family actually matches on lives in
   * `profile_details`, so a pair who agreed on every count scored as if they
   * had stated nothing at all.
   */
  describe('reads the biodata, which is where the data actually is', () => {
    const bare = (dobAge: number, city: string) =>
      makeProfile({ dateOfBirth: dobForAge(dobAge), city, preferences: {} });

    it('scores religion, caste, mother tongue and education off profile_details', () => {
      const a: ScoringSubject = {
        profile: bare(28, 'Hyderabad'),
        details: makeDetails({
          religion: 'Hindu',
          caste: 'Reddy',
          motherTongue: 'Telugu',
          highestQualification: 'Masters',
        }),
      };
      const b: ScoringSubject = {
        profile: bare(29, 'Hyderabad'),
        details: makeDetails({
          religion: 'hindu',
          caste: 'reddy',
          motherTongue: 'telugu',
          highestQualification: 'masters',
        }),
      };

      const { score, breakdown } = scoreProfiles(a, b, weights);
      expect(breakdown.religion).toBe(20);
      expect(breakdown.caste).toBe(10);
      expect(breakdown.motherTongue).toBe(5);
      expect(breakdown.education).toBe(15);
      expect(score).toBeGreaterThanOrEqual(95);
    });

    it('scores the same pair near zero when only the empty preferences blob is read', () => {
      // The old behaviour, reproduced: identical people, no biodata passed in.
      const { score } = scoreProfiles(bare(28, 'Hyderabad'), bare(29, 'Hyderabad'), weights);
      // Age and location are all that can be judged, so the pair is not
      // *penalised* for the absence — but nothing they agreed on is counted.
      expect(score).toBeGreaterThan(0);
      expect(Object.keys(scoreProfiles(bare(28, 'X'), bare(29, 'X'), weights).breakdown)).toEqual([
        'age',
        'location',
      ]);
    });

    it('does not mark a pair down for a fact neither of them recorded', () => {
      const withTongue: ScoringSubject = {
        profile: bare(28, 'Hyderabad'),
        details: makeDetails({ motherTongue: 'Telugu' }),
      };
      const withoutTongue: ScoringSubject = {
        profile: bare(28, 'Hyderabad'),
        details: makeDetails({}),
      };
      const neither = scoreProfiles(withoutTongue, withoutTongue, weights);
      const one = scoreProfiles(withTongue, withoutTongue, weights);

      // One side stating it and the other not is still unjudgeable, so both
      // read the same. What must not happen is silence scoring as a mismatch.
      expect(neither.breakdown.motherTongue).toBeUndefined();
      expect(one.breakdown.motherTongue).toBeUndefined();
      expect(neither.score).toBe(one.score);
    });

    it('counts a stated partner preference that the other side meets', () => {
      const seeker: ScoringSubject = {
        profile: bare(30, 'Hyderabad'),
        details: makeDetails({
          preferredAgeMin: 24,
          preferredAgeMax: 30,
          preferredHeightMinCm: 150,
          preferredHeightMaxCm: 170,
          partnerPreferences: { religion: 'Hindu' },
        }),
      };
      const met: ScoringSubject = {
        profile: bare(27, 'Hyderabad'),
        details: makeDetails({ heightCm: 160, religion: 'Hindu' }),
      };
      const unmet: ScoringSubject = {
        profile: bare(27, 'Hyderabad'),
        details: makeDetails({ heightCm: 185, religion: 'Christian' }),
      };

      expect(scoreProfiles(seeker, met, weights).breakdown.preferences).toBeGreaterThan(
        scoreProfiles(seeker, unmet, weights).breakdown.preferences,
      );
    });

    it('gives both sides of a pair the same score', () => {
      const a: ScoringSubject = {
        profile: bare(30, 'Hyderabad'),
        details: makeDetails({ preferredAgeMin: 24, preferredAgeMax: 28, religion: 'Hindu' }),
      };
      const b: ScoringSubject = {
        profile: bare(26, 'Hyderabad'),
        details: makeDetails({ religion: 'Hindu' }),
      };
      // Scoring only the viewer's stated window meant the same match read
      // differently depending on who was looking at it.
      expect(scoreProfiles(a, b, weights).score).toBe(scoreProfiles(b, a, weights).score);
    });

    it('still scores a profile that has no biodata row at all', () => {
      const withNone: ScoringSubject = { profile: bare(28, 'Hyderabad'), details: null };
      const { score } = scoreProfiles(withNone, withNone, weights);
      expect(score).toBeGreaterThan(0);
    });
  });
});

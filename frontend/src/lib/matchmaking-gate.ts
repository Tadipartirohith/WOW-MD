import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { MatchFixedState, OnboardingStage } from './permissions';

/**
 * Why sending an interest is closed, or undefined when it is open.
 *
 * Matches worked this out and the other lists did not, which is the whole
 * defect: Network Pool and Shared With Me offered "Send interest" on profiles
 * the server would refuse, and a profile that had already fixed its match
 * carried on being invited to send more. The person clicks, gets a refusal,
 * and reports that the platform let them do something it then would not do.
 *
 * Both layers enforce it and that is deliberate — the API is the one that
 * matters and it already says no. This exists so the button is not offered in
 * the first place, and so the reason travels with it: a control that is simply
 * missing is its own kind of bug report.
 */
export interface MatchStatus {
  profileId: string;
  profileCompleted: boolean;
  stage: OnboardingStage;
  matchFixedState: MatchFixedState;
  identitySubmitted: boolean;
  identityVerified: boolean;
}

export function matchmakingGate(status?: MatchStatus): string | undefined {
  if (!status) return undefined;
  if (!status.profileCompleted) {
    return 'Fill in the profile first: basic details, preferences and a photo.';
  }
  if (!status.identityVerified) {
    return status.identitySubmitted
      ? 'Identity verification is still pending. An officer confirms the document in person.'
      : 'Identity verification is required before you can send or accept an interest.';
  }
  if (status.matchFixedState === 'confirmed') {
    return 'This profile has a fixed match, so matchmaking is closed.';
  }
  return undefined;
}

/** The gate for a profile, fetched. `profileId` is required for an agent. */
export function useMatchmakingGate(profileId?: string): {
  status?: MatchStatus;
  gate?: string;
} {
  const { data } = useQuery({
    queryKey: ['match-status', profileId ?? 'self'],
    queryFn: async () =>
      (await api.get('/matches/status', { params: profileId ? { profileId } : {} }))
        .data as MatchStatus,
    retry: false,
  });
  return { status: data, gate: matchmakingGate(data) };
}

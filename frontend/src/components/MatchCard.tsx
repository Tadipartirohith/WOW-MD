import { MARITAL_LABEL, MaritalStatus, OCCUPATION_LABEL, OccupationStatus } from '../lib/permissions';

/** Server-side privacy view: an age band, not a date of birth. */
export interface PublicProfile {
  id: string;
  displayName: string;
  gender?: string;
  ageRange: string | null;
  city?: string;
  bio?: string;
  photos: string[];
  photoCount: number;
  matched: boolean;
  claimStatus: string;
  managed: boolean;
  profileCode: string;
  verified: boolean;
  lastActiveAt: string | null;
  card?: {
    heightCm: number | null;
    religion: string | null;
    caste: string | null;
    motherTongue: string | null;
    maritalStatus: string | null;
    highestQualification: string | null;
    occupationStatus: string | null;
    profession: string | null;
  };
}

export type InteractionState =
  | 'none'
  | 'interest_sent'
  | 'interest_received'
  | 'accepted'
  | 'declined_by_you'
  | 'declined_by_them';

export interface Suggestion {
  profile: PublicProfile;
  score: number;
  breakdown?: Record<string, number>;
  shortlisted?: boolean;
  note?: string | null;
  interaction?: InteractionState;
}

/**
 * What each part of the score was for, in words.
 *
 * The engine already returned a breakdown and nobody had ever shown it, so a
 * card said "82%" and left the family to guess what the platform thought was
 * good about the match. Naming the dimensions that actually scored turns a
 * number into a reason, which is the difference between a recommendation and
 * an assertion.
 */
const DIMENSION_LABEL: Record<string, string> = {
  age: 'Age',
  location: 'Location',
  religion: 'Religion',
  education: 'Education',
  lifestyle: 'Lifestyle',
  preferences: 'Preferences',
};

const INTERACTION_LABEL: Record<InteractionState, string | null> = {
  none: null,
  interest_sent: 'Interest sent',
  interest_received: 'They are interested',
  accepted: 'Matched',
  declined_by_you: 'You declined',
  declined_by_them: 'They declined',
};

const INTERACTION_TONE: Record<InteractionState, string> = {
  none: '',
  interest_sent: 'bg-blue-50 text-blue-800',
  interest_received: 'bg-emerald-50 text-emerald-800',
  accepted: 'bg-emerald-50 text-emerald-800',
  declined_by_you: 'bg-gray-100 text-gray-600',
  declined_by_them: 'bg-gray-100 text-gray-600',
};

/** "Active now", "Active this week", or nothing rather than a stale claim. */
function activity(lastActiveAt: string | null): string | null {
  if (!lastActiveAt) return null;
  const days = (Date.now() - new Date(lastActiveAt).getTime()) / 86_400_000;
  if (days < 1) return 'Active today';
  if (days < 7) return 'Active this week';
  if (days < 30) return 'Active this month';
  // Past a month it stops being a recommendation and starts being a warning,
  // and a warning is not this component's job. Say nothing instead.
  return null;
}

/**
 * One person, as a card rather than a line.
 *
 * The row this replaces carried a name, a town and an age band. A family
 * cannot decide anything from that, which is exactly what was reported — so
 * every card now answers the questions asked in person: how old, from where,
 * what do they do, what did they study, have they been married before, and is
 * the profile someone an officer has actually met.
 *
 * The score sits with its reasons rather than alone. A bare percentage invites
 * the question "on what basis", and the engine already knew.
 */
export default function MatchCard({
  suggestion,
  showScore = true,
  onOpen,
  onSendInterest,
  onToggleShortlist,
  disabledReason,
}: {
  suggestion: Suggestion;
  showScore?: boolean;
  onOpen: () => void;
  onSendInterest?: () => void;
  onToggleShortlist?: () => void;
  /** Why the committing actions are unavailable, if they are. */
  disabledReason?: string;
}) {
  const p = suggestion.profile;
  const card = p.card;
  const interaction = suggestion.interaction ?? 'none';
  const interactionLabel = INTERACTION_LABEL[interaction];

  // Only the dimensions that actually contributed. Listing "Location ✗"
  // alongside the rest reads as a fault report on a person.
  const reasons = Object.entries(suggestion.breakdown ?? {})
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => DIMENSION_LABEL[key] ?? key)
    .slice(0, 5);

  const facts = [
    p.ageRange ? `${p.ageRange} yrs` : null,
    p.city,
    card?.heightCm ? `${card.heightCm} cm` : null,
    card?.profession,
    card?.highestQualification,
    card?.maritalStatus
      ? (MARITAL_LABEL[card.maritalStatus as MaritalStatus] ?? card.maritalStatus)
      : null,
    card?.occupationStatus && !card?.profession
      ? (OCCUPATION_LABEL[card.occupationStatus as OccupationStatus] ?? card.occupationStatus)
      : null,
    card?.religion,
    card?.motherTongue,
  ].filter(Boolean) as string[];

  const active = activity(p.lastActiveAt);

  return (
    <div className="rounded-lg border border-gray-200 p-3 transition hover:border-gray-300">
      <div className="flex gap-3">
        {p.photos?.[0] ? (
          <img
            src={p.photos[0]}
            alt=""
            className="h-20 w-20 shrink-0 rounded object-cover"
            loading="lazy"
          />
        ) : (
          <span className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded bg-gray-100 text-center text-xs text-gray-500">
            <span className="text-lg">{(p.displayName ?? '?').slice(0, 1).toUpperCase()}</span>
            {/*
              Said plainly rather than shown as a broken image. "No photo yet"
              is information — it tells a family the biodata is unfinished,
              which is worth knowing before they spend an interest on it.
            */}
            No photo yet
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <button className="min-w-0 text-left" onClick={onOpen}>
              <span className="block truncate font-semibold text-gray-900 hover:underline">
                {p.displayName}
              </span>
              <span className="block font-mono text-xs text-gray-400">{p.profileCode}</span>
            </button>
            {showScore && (
              <span className="shrink-0 rounded-full bg-brand-light px-2 py-0.5 text-sm font-semibold text-brand-dark">
                {suggestion.score}% match
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap gap-1">
            {p.verified && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                Verified
              </span>
            )}
            {active && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                {active}
              </span>
            )}
            {interactionLabel && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${INTERACTION_TONE[interaction]}`}
              >
                {interactionLabel}
              </span>
            )}
          </div>

          <p className="mt-1 text-sm text-gray-600">
            {facts.length > 0 ? facts.join(' · ') : 'Biodata not filled in yet.'}
          </p>

          {reasons.length > 0 && showScore && (
            <p className="mt-1 text-xs text-gray-500">
              Matches on {reasons.join(', ').toLowerCase()}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-outline text-xs" onClick={onOpen}>
          View profile
        </button>
        {onSendInterest && interaction === 'none' && (
          <button
            className="btn text-xs"
            onClick={onSendInterest}
            disabled={Boolean(disabledReason)}
            title={disabledReason}
          >
            Show interest
          </button>
        )}
        {onToggleShortlist && (
          <button className="btn-outline text-xs" onClick={onToggleShortlist}>
            {suggestion.shortlisted ? 'Shortlisted ✓' : 'Shortlist'}
          </button>
        )}
        {suggestion.note && (
          <span className="text-xs text-gray-500">&ldquo;{suggestion.note}&rdquo;</span>
        )}
      </div>
    </div>
  );
}

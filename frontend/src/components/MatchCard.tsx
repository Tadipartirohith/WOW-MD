import { MARITAL_LABEL, MaritalStatus, OCCUPATION_LABEL, OccupationStatus } from '../lib/permissions';
import { BookmarkSimple, CheckCircle } from '@phosphor-icons/react';

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
    /**
     * The chart, which the engine has always scored against and the card has
     * never shown. For a great many families here, rashi and gothram decide
     * whether the rest of the card is worth reading at all — so putting them
     * behind a click had the ordering backwards. All null for a family that
     * does not use horoscopes, and the row simply does not appear.
     */
    rashi: string | null;
    star: string | null;
    padam: string | null;
    gothram: string | null;
    kujaDosham: string | null;
  };
  /** Which agency put this profile up. Null when the person registered themselves. */
  sourceAgency?: string | null;
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
  /** Set when a relative sent this over rather than the engine finding it. */
  sharedByFamily?: { sharedAt: string; sharerEmail: string | null; note: string | null };
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
  caste: 'Community',
  motherTongue: 'Mother tongue',
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

  /*
   * The chart is its own row rather than more chips in the run above.
   *
   * Mixing "167 cm" and "Bharani" into one wrapping list makes both harder to
   * find: a family checking compatibility is looking for exactly these five
   * and reads them as a set, and a family that does not use horoscopes should
   * see no trace of them at all.
   */
  const chart = [
    card?.rashi ? { label: 'Rashi', value: card.rashi } : null,
    card?.star ? { label: 'Star', value: card.star } : null,
    card?.padam ? { label: 'Padam', value: card.padam } : null,
    card?.gothram ? { label: 'Gothram', value: card.gothram } : null,
    card?.kujaDosham ? { label: 'Kuja dosham', value: card.kujaDosham } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  const active = activity(p.lastActiveAt);

  return (
    <article
      className="group/card rounded-lg border border-gray-200 bg-surface p-4
        transition-[border-color,box-shadow] duration-200 hover:border-gray-300 hover:shadow-card"
    >
      <div className="flex gap-4">
        {p.photos?.[0] ? (
          <img
            src={p.photos[0]}
            alt=""
            className="h-24 w-24 shrink-0 rounded-md object-cover ring-1 ring-inset ring-gray-900/5"
            loading="lazy"
          />
        ) : (
          <span className="flex h-24 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-md bg-surface-sunken text-center text-[0.6875rem] leading-tight text-gray-400">
            <span className="text-xl font-medium text-gray-500">
              {(p.displayName ?? '?').slice(0, 1).toUpperCase()}
            </span>
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
              <span className="block truncate text-[0.9375rem] font-semibold tracking-[-0.012em] text-gray-900 underline-offset-2 group-hover/card:underline">
                {p.displayName}
              </span>
              <span className="block font-mono text-[0.6875rem] text-gray-400">{p.profileCode}</span>
            </button>
            {showScore && (
              /*
                The number and the word, sized apart. A score is the one figure
                on this card somebody compares across a list, so it gets the
                mono face and its own weight; "match" is a unit, not data, and
                shrinks accordingly.
              */
              <span className="flex shrink-0 items-baseline gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-brand-strong">
                <span className="font-mono text-sm font-semibold leading-none">{suggestion.score}%</span>
                <span className="text-[0.6875rem] opacity-70">match</span>
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap gap-1">
            {/*
              Where the suggestion came from, said before anything else.
              A relative who knows both sides is a different kind of
              recommendation from a percentage, and reading one as the other
              is the whole reason this label exists.
            */}
            {suggestion.sharedByFamily && (
              <span className="rounded-full bg-brand-light px-2 py-0.5 text-xs font-medium text-brand-dark">
                Shared by family member
              </span>
            )}
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

          {/*
            Who this profile came from.

            Set quietly under the facts rather than as another chip: it is not
            a quality of the person, it is who to ring. A family comparing
            three profiles from three agencies could not tell them apart, and
            an agent browsing the pool could not see their own.
          */}
          {p.sourceAgency ? (
            <p className="mt-2 text-[0.75rem] text-gray-500">
              Added by <span className="text-gray-700">{p.sourceAgency}</span>
            </p>
          ) : null}

          {/*
            Facts as separate chips rather than one dot-joined sentence. A
            reader scanning for "what do they do" finds it in a chip and cannot
            find it in the middle of a run-on line.
          */}
          {facts.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-x-1.5 gap-y-1">
              {facts.map((fact) => (
                <li
                  key={fact}
                  className="rounded-sm bg-surface-sunken px-1.5 py-0.5 text-[0.75rem] text-gray-600"
                >
                  {fact}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-gray-400">Biodata not filled in yet.</p>
          )}

          {/*
            The chart, as labelled pairs rather than bare values. "Bharani" on
            its own is meaningless to half the people who will read this card
            and decisive to the other half; the label is what lets the first
            group skip it and the second read it.
          */}
          {chart.length > 0 ? (
            <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-gray-200 pt-2 text-[0.75rem]">
              {chart.map((entry) => (
                <div key={entry.label} className="flex items-baseline gap-1">
                  <dt className="text-gray-400">{entry.label}</dt>
                  <dd className="text-gray-700">{entry.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {reasons.length > 0 && showScore && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
              <CheckCircle size={13} className="shrink-0 text-brand" weight="fill" aria-hidden />
              Matches on {reasons.join(', ').toLowerCase()}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3">
        <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={onOpen}>
          View profile
        </button>
        {onSendInterest && interaction === 'none' && (
          <button
            className="btn px-3 py-1.5 text-xs"
            onClick={onSendInterest}
            disabled={Boolean(disabledReason)}
            title={disabledReason}
          >
            Show interest
          </button>
        )}
        {onToggleShortlist && (
          <button
            className={`btn-ghost px-2.5 py-1.5 text-xs ${
              suggestion.shortlisted ? 'text-brand-strong' : ''
            }`}
            onClick={onToggleShortlist}
            aria-pressed={Boolean(suggestion.shortlisted)}
          >
            <BookmarkSimple
              size={14}
              weight={suggestion.shortlisted ? 'fill' : 'regular'}
              aria-hidden
            />
            {suggestion.shortlisted ? 'Shortlisted' : 'Shortlist'}
          </button>
        )}
        {suggestion.note && (
          <span className="text-xs text-gray-500">&ldquo;{suggestion.note}&rdquo;</span>
        )}
        {suggestion.sharedByFamily?.note && (
          <span className="text-xs text-gray-500">
            &ldquo;{suggestion.sharedByFamily.note}&rdquo;
          </span>
        )}
      </div>
    </article>
  );
}

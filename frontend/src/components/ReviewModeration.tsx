import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from '@phosphor-icons/react';
import { api, apiMessage } from '../lib/api';
import { formatDate } from '../lib/dates';
import { EmptyState, Loading } from './ui/Feedback';

type ReviewStatus = 'published' | 'under_review' | 'flagged' | 'removed';

interface AdminReview {
  id: string;
  vendorId?: string;
  vendorName?: string | null;
  reviewerEmail?: string | null;
  /** The planner variant names the same two things differently (EZ1-I244). */
  plannerId?: string;
  plannerName?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  bookingId: string | null;
  rating: number;
  comment: string;
  categories?: Record<string, number>;
  status: ReviewStatus;
  moderationReason: string | null;
  moderatedAt: string | null;
  createdAt: string;
}

/**
 * Which kind of provider's reviews this is moderating.
 *
 * The two live in different tables and are reached on different routes, and
 * the planner one carries filters the vendor endpoint does not accept — so the
 * shape travels with the kind rather than being guessed at per field.
 */
interface Variant {
  base: string;
  title: string;
  blurb: string;
  subjectLabel: string;
  /** Whether the planner/rating/search filters are offered and sent. */
  richFilters: boolean;
  subjectOf: (review: AdminReview) => string | null;
  reviewerOf: (review: AdminReview) => string | null;
}

const VARIANTS: Record<'vendor' | 'planner', Variant> = {
  vendor: {
    base: '/admin/reviews',
    title: 'Reviews',
    blurb:
      'Anything the automatic screen disliked is held rather than refused, so a complaint about a vendor is never thrown away by a word list. Removing a review moves that vendor’s rating.',
    subjectLabel: 'Business',
    richFilters: false,
    subjectOf: (r) => r.vendorName ?? null,
    reviewerOf: (r) => r.reviewerEmail ?? null,
  },
  planner: {
    base: '/admin/planner-reviews',
    title: 'Planner reviews',
    blurb:
      'The same rules as vendor reviews, on the providers who run the whole wedding. Removing a review moves that planner’s rating.',
    subjectLabel: 'Planner',
    richFilters: true,
    subjectOf: (r) => r.plannerName ?? null,
    reviewerOf: (r) => [r.userName, r.userEmail].filter(Boolean).join(' · ') || null,
  },
};

const STATUS_LABEL: Record<ReviewStatus, string> = {
  published: 'Published',
  under_review: 'Held for review',
  flagged: 'Flagged',
  removed: 'Removed',
};

const STATUS_TONE: Record<ReviewStatus, string> = {
  published: 'bg-positive-bg text-positive-fg',
  under_review: 'bg-caution-bg text-caution-fg',
  flagged: 'bg-caution-bg text-caution-fg',
  removed: 'bg-critical-bg text-critical-fg',
};

/** Held first: it is the only queue with somebody waiting at the end of it. */
const TABS: { key: ReviewStatus | 'all'; label: string }[] = [
  { key: 'under_review', label: 'Held' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'published', label: 'Published' },
  { key: 'removed', label: 'Removed' },
  { key: 'all', label: 'All' },
];

/**
 * Review moderation, which is the administrator's and nobody else's.
 *
 * The opposite of what the vendor sees, on purpose: everything there hides the
 * reviewer and everything here needs them, because deciding whether a review
 * is abuse or a legitimate complaint without knowing who wrote it, what it was
 * about and which booking it came from is deciding in the dark.
 *
 * A vendor must never reach this. Being able to hide a review about yourself
 * is the single power that would make every rating on the platform meaningless.
 */
export default function ReviewModeration({ kind = 'vendor' }: { kind?: 'vendor' | 'planner' }) {
  const qc = useQueryClient();
  const variant = VARIANTS[kind];
  const [tab, setTab] = useState<ReviewStatus | 'all'>('under_review');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  // Only sent where the endpoint accepts them: the vendor query takes a status
  // and a vendor id and nothing else, and the pipe refuses anything it was not
  // told about.
  const [subjectId, setSubjectId] = useState('');
  const [rating, setRating] = useState('');
  const [search, setSearch] = useState('');

  const { data, isPending } = useQuery({
    queryKey: ['admin-reviews', kind, tab, subjectId, rating, search],
    queryFn: async () =>
      (
        await api.get(variant.base, {
          params: {
            ...(tab === 'all' ? {} : { status: tab }),
            ...(variant.richFilters && subjectId ? { plannerId: subjectId } : {}),
            ...(variant.richFilters && rating ? { rating } : {}),
            ...(variant.richFilters && search.trim() ? { q: search.trim() } : {}),
          },
        })
      ).data as AdminReview[],
    retry: false,
  });

  /** The planners a review can be filtered by. Only fetched where offered. */
  const { data: subjects } = useQuery({
    queryKey: ['admin-review-subjects', kind],
    enabled: variant.richFilters,
    queryFn: async () =>
      (await api.get(`${variant.base}/planners`)).data as { id: string; agencyName: string }[],
    retry: false,
  });

  const moderate = useMutation({
    mutationFn: (vars: { id: string; status: ReviewStatus; reason?: string }) =>
      api.put(`${variant.base}/${vars.id}/status`, {
        status: vars.status,
        ...(vars.reason ? { reason: vars.reason } : {}),
      }),
    onSuccess: () => {
      setError('');
      void qc.invalidateQueries({ queryKey: ['admin-reviews'] });
    },
    onError: (err) => setError(apiMessage(err, 'That decision could not be recorded.')),
  });

  const rows = data ?? [];

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="section-title">{variant.title}</h2>
        <p className="text-sm text-gray-600">{variant.blurb}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            className={
              tab === entry.key
                ? 'rounded-full bg-brand px-3 py-1 text-xs font-medium text-brand-fg'
                : 'rounded-full bg-surface-sunken px-3 py-1 text-xs text-gray-600 hover:bg-gray-100'
            }
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/* Filter by planner and by rating, and search across the planner, the
          couple and the words of the review — one box, because an administrator
          looking for "the complaint about Sharma" does not know which field it
          is in (EZ1-I244). */}
      {variant.richFilters && (
        <div className="flex flex-wrap gap-2">
          <select
            className="input w-auto py-1.5 text-sm"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
          >
            <option value="">Every {variant.subjectLabel.toLowerCase()}</option>
            {(subjects ?? []).map((option) => (
              <option key={option.id} value={option.id}>
                {option.agencyName}
              </option>
            ))}
          </select>
          <select
            className="input w-auto py-1.5 text-sm"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
          >
            <option value="">Any rating</option>
            {[5, 4, 3, 2, 1].map((star) => (
              <option key={star} value={star}>
                {star} star{star === 1 ? '' : 's'}
              </option>
            ))}
          </select>
          <input
            className="input flex-1 py-1.5 text-sm sm:max-w-xs"
            placeholder="Couple, planner, booking or words"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {(subjectId || rating || search) && (
            <button
              className="btn-ghost btn-sm"
              onClick={() => {
                setSubjectId('');
                setRating('');
                setSearch('');
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {error && <p className="alert-critical">{error}</p>}

      {isPending ? (
        <Loading rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Star} title="Nothing here">
          {tab === 'under_review'
            ? 'No reviews are waiting on a decision.'
            : 'No reviews in this state.'}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-gray-200">
          {rows.map((review) => (
            <li key={review.id} className="space-y-2 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {variant.subjectOf(review) ?? `Unknown ${variant.subjectLabel.toLowerCase()}`}
                  </p>
                  <p className="text-xs text-gray-500">
                    {/*
                      Everything a decision needs: who, when, which job. A
                      booking reference is what turns "this is unfair" into
                      something checkable.
                    */}
                    {[
                      variant.reviewerOf(review),
                      formatDate(review.createdAt),
                      review.bookingId ? `booking ${review.bookingId.slice(0, 8)}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[review.status]}`}
                >
                  {STATUS_LABEL[review.status]}
                </span>
              </div>

              <div className="flex items-center gap-0.5" aria-label={`${review.rating} out of 5`}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    size={13}
                    weight={star <= review.rating ? 'fill' : 'regular'}
                    className={star <= review.rating ? 'text-caution-fg' : 'text-gray-300'}
                    aria-hidden
                  />
                ))}
              </div>

              {review.comment ? (
                <p className="rounded-sm bg-surface-sunken p-2 text-sm text-gray-700">
                  {review.comment}
                </p>
              ) : (
                <p className="text-sm text-gray-400">Rated, with nothing written.</p>
              )}

              {review.moderationReason && (
                <p className="text-xs text-gray-500">
                  {review.moderatedAt ? 'Decision: ' : 'Held because: '}
                  {review.moderationReason}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input flex-1 py-1 text-sm sm:max-w-xs"
                  placeholder="Reason, required to flag or remove"
                  value={reasons[review.id] ?? ''}
                  onChange={(e) =>
                    setReasons((r) => ({ ...r, [review.id]: e.target.value }))
                  }
                />
                {review.status !== 'published' && (
                  <button
                    className="btn-outline btn-sm"
                    onClick={() => moderate.mutate({ id: review.id, status: 'published' })}
                  >
                    Publish
                  </button>
                )}
                {review.status !== 'flagged' && (
                  <button
                    className="btn-outline btn-sm"
                    onClick={() =>
                      moderate.mutate({
                        id: review.id,
                        status: 'flagged',
                        reason: reasons[review.id],
                      })
                    }
                  >
                    Flag
                  </button>
                )}
                {review.status !== 'removed' && (
                  <button
                    className="btn-outline btn-sm text-critical-fg"
                    onClick={() =>
                      moderate.mutate({
                        id: review.id,
                        status: 'removed',
                        reason: reasons[review.id],
                      })
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

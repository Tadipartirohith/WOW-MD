import { useQuery } from '@tanstack/react-query';
import { Star } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { formatDate } from '../lib/dates';
import { EmptyState, Loading } from '../components/ui/Feedback';

/**
 * A wedding planner's own reviews and ratings (EZ1-I244).
 *
 * The vendor's My Reviews page, for the other kind of provider, with what a
 * planner is actually judged on: the average, how many, the shape of it across
 * five stars down to one, and the parts of the job couples scored separately.
 *
 * The reviewer is never named. A planner who could work out which couple left
 * three stars could take it up with them, and the prospect of that conversation
 * is what stops the next honest review being written. The booking each review
 * is about is shown by its date and reference, which is what a planner needs to
 * remember the wedding.
 */
interface PlannerReview {
  id: string;
  rating: number;
  comment: string;
  categories: Record<string, number>;
  createdAt: string;
  bookingId: string | null;
  eventDate: string | null;
}

interface Summary {
  average: number;
  total: number;
  breakdown: Record<string, number>;
  categories: Record<string, number>;
}

const CATEGORY_LABEL: Record<string, string> = {
  planning: 'Planning & coordination',
  communication: 'Communication',
  serviceQuality: 'Service quality',
  professionalism: 'Professionalism',
  timeliness: 'Timeliness',
};

export default function PlannerReviews() {
  // The planner's own listing, which is what the reviews hang off. One listing
  // per planner account, so there is no switcher to make.
  const { data: listing, isPending: loadingListing } = useQuery({
    queryKey: ['planner-me'],
    queryFn: async () => (await api.get('/wedding-planners/me')).data as { id: string },
    retry: false,
  });

  const { data, isPending } = useQuery({
    queryKey: ['planner-reviews-mine', listing?.id],
    enabled: Boolean(listing?.id),
    queryFn: async () =>
      (await api.get(`/wedding-planners/${listing?.id}/reviews/mine`)).data as {
        summary: Summary;
        reviews: PlannerReview[];
      },
    retry: false,
  });

  if (loadingListing) return <Loading rows={3} />;

  if (!listing) {
    return (
      <div className="space-y-4">
        <Header />
        <div className="card text-sm text-gray-600">
          Create your planner listing first. Reviews arrive against the weddings booked through it.
        </div>
      </div>
    );
  }

  if (isPending) return <Loading rows={3} />;

  const summary = data?.summary;
  const reviews = data?.reviews ?? [];

  return (
    <div className="space-y-4">
      <Header />

      <div className="card space-y-4">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p className="font-mono text-3xl font-medium leading-none text-gray-900">
              {(summary?.average ?? 0).toFixed(1)}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {summary?.total ?? 0} review{summary?.total === 1 ? '' : 's'}
            </p>
          </div>
          {/* The distribution, because an average alone hides the shape: 4.0
              from all fours and 4.0 from half fives and half threes are
              different businesses. */}
          <dl className="min-w-[12rem] flex-1 space-y-1">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = summary?.breakdown?.[String(star)] ?? 0;
              const total = summary?.total ?? 0;
              return (
                <div key={star} className="flex items-center gap-2 text-xs">
                  <dt className="w-3 text-gray-500">{star}</dt>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className="h-full rounded-full bg-caution-fg"
                      style={{ width: total ? `${(count / total) * 100}%` : '0%' }}
                    />
                  </div>
                  <dd className="w-6 text-right font-mono text-gray-500">{count}</dd>
                </div>
              );
            })}
          </dl>
        </div>

        {summary && Object.keys(summary.categories).length > 0 && (
          <div className="border-t border-gray-200 pt-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              How the parts scored
            </h2>
            <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {Object.entries(summary.categories).map(([key, value]) => (
                <div key={key} className="flex items-baseline justify-between gap-3 text-sm">
                  <dt className="text-gray-600">{CATEGORY_LABEL[key] ?? key}</dt>
                  <dd className="font-mono text-gray-900">{value.toFixed(1)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      {reviews.length === 0 ? (
        <EmptyState icon={Star} title="No reviews yet">
          A review can only be written after a booking is completed, so these arrive with the work.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {reviews.map((review) => (
            <li key={review.id} className="card space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-0.5" aria-label={`${review.rating} out of 5`}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      size={15}
                      weight={star <= review.rating ? 'fill' : 'regular'}
                      className={star <= review.rating ? 'text-caution-fg' : 'text-gray-300'}
                      aria-hidden
                    />
                  ))}
                </span>
                <span className="text-xs text-gray-400">{formatDate(review.createdAt)}</span>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                {review.eventDate && (
                  <span>
                    Wedding:{' '}
                    <span className="font-medium text-gray-800">{formatDate(review.eventDate)}</span>
                  </span>
                )}
                {review.bookingId && (
                  <span>
                    Booking:{' '}
                    <span className="font-mono text-gray-500">{review.bookingId.slice(0, 8)}</span>
                  </span>
                )}
              </div>

              {review.comment ? (
                <p className="text-sm text-gray-700">{review.comment}</p>
              ) : (
                <p className="text-sm text-gray-400">Rated, with nothing written.</p>
              )}

              {Object.keys(review.categories ?? {}).length > 0 && (
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  {Object.entries(review.categories).map(([key, value]) => (
                    <li key={key}>
                      {CATEGORY_LABEL[key] ?? key}: <span className="text-gray-800">{value}/5</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="page-title">Reviews & Ratings</h1>
      <p className="page-subtitle">
        What couples said after a completed wedding. Names are left out, and you cannot edit or
        remove a review — if one breaks the rules, raise it on Support.
      </p>
    </div>
  );
}

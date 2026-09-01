import { useQuery } from '@tanstack/react-query';
import { Star } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { formatDate } from '../lib/dates';
import { EmptyState, Loading } from './ui/Feedback';

interface Review {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
}

/**
 * What people said, without who said it.
 *
 * Shown to the vendor being reviewed and to a buyer considering them, and it
 * is deliberately the same view for both. The omission is the feature: a
 * vendor who can work out which customer left three stars can take it up with
 * them, and the prospect of that conversation is what stops the next honest
 * review from being written. The server does not send the reviewer, so this
 * cannot leak them by accident.
 *
 * Held and removed reviews are not here either. A held review is not a secret,
 * it is simply not published yet, and showing it to the vendor before an
 * administrator has read it would defeat the holding.
 */
export default function ReviewsPanel({ vendorId }: { vendorId: string }) {
  const { data, isPending } = useQuery({
    queryKey: ['vendor-reviews', vendorId],
    queryFn: async () => (await api.get(`/vendors/${vendorId}/reviews`)).data as Review[],
    retry: false,
  });

  if (isPending) return <Loading rows={2} />;
  const reviews = data ?? [];

  if (reviews.length === 0) {
    return (
      <EmptyState icon={Star} title="No reviews yet">
        A review can only be written after a booking is completed, so these arrive with the work.
      </EmptyState>
    );
  }

  // The distribution, because an average alone hides the shape: 4.0 from all
  // fours and 4.0 from half fives and half threes are different businesses.
  const spread = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => r.rating === star).length,
  }));
  const average = reviews.reduce((n, r) => n + r.rating, 0) / reviews.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <p className="font-mono text-3xl font-medium leading-none text-gray-900">
            {average.toFixed(1)}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {reviews.length} review{reviews.length === 1 ? '' : 's'}
          </p>
        </div>
        <dl className="min-w-[12rem] flex-1 space-y-1">
          {spread.map(({ star, count }) => (
            <div key={star} className="flex items-center gap-2 text-xs">
              <dt className="w-3 text-gray-500">{star}</dt>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${reviews.length ? (count / reviews.length) * 100 : 0}%` }}
                />
              </div>
              <dd className="w-6 text-right font-mono text-gray-500">{count}</dd>
            </div>
          ))}
        </dl>
      </div>

      <ul className="divide-y divide-gray-200">
        {reviews.map((review) => (
          <li key={review.id} className="space-y-1 py-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-0.5" aria-label={`${review.rating} out of 5`}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    size={13}
                    weight={star <= review.rating ? 'fill' : 'regular'}
                    className={star <= review.rating ? 'text-caution-fg' : 'text-gray-300'}
                    aria-hidden
                  />
                ))}
              </span>
              <span className="text-xs text-gray-400">{formatDate(review.createdAt)}</span>
            </div>
            {review.comment ? (
              <p className="text-sm text-gray-700">{review.comment}</p>
            ) : (
              <p className="text-sm text-gray-400">Rated, with nothing written.</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

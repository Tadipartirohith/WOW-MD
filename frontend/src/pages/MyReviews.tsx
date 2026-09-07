import { useQuery } from '@tanstack/react-query';
import { Star } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { formatDate } from '../lib/dates';
import { useBusinesses } from '../store/business';
import { EmptyState, Loading } from '../components/ui/Feedback';

interface OwnerReview {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
  bookingId: string | null;
  serviceName: string | null;
  offeringName: string | null;
}

/**
 * A vendor's own reviews, on their own page (EZ1-I103).
 *
 * Each review shows the service, package and booking it is about, its rating,
 * comment and date. The reviewer is never named — a vendor who could work out
 * which customer left three stars could take it up with them, and the prospect
 * of that conversation is what stops the next honest review being written.
 */
export default function MyReviews() {
  const { activeId } = useBusinesses();

  const { data, isPending } = useQuery({
    queryKey: ['my-reviews', activeId],
    enabled: Boolean(activeId),
    queryFn: async () => (await api.get(`/vendors/${activeId}/reviews/mine`)).data as OwnerReview[],
    retry: false,
  });

  const reviews = data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">My Reviews</h1>
        <p className="page-subtitle">
          What customers said after a completed booking. Names are left out, and you cannot edit or
          remove a review — if one breaks the rules, raise it on Support.
        </p>
      </div>

      {!activeId ? (
        <div className="card text-sm text-gray-600">
          Select a business from the switcher to see its reviews.
        </div>
      ) : isPending ? (
        <Loading rows={3} />
      ) : reviews.length === 0 ? (
        <EmptyState icon={Star} title="No reviews yet">
          A review can only be written after a booking is completed, so these arrive with the work.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <li key={r.id} className="card space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className="flex items-center gap-0.5"
                  aria-label={`${r.rating} out of 5`}
                >
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      size={15}
                      weight={star <= r.rating ? 'fill' : 'regular'}
                      className={star <= r.rating ? 'text-caution-fg' : 'text-gray-300'}
                      aria-hidden
                    />
                  ))}
                </span>
                <span className="text-xs text-gray-400">{formatDate(r.createdAt)}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                {r.serviceName && (
                  <span>
                    Service: <span className="font-medium text-gray-800">{r.serviceName}</span>
                  </span>
                )}
                {r.offeringName && (
                  <span>
                    Package: <span className="font-medium text-gray-800">{r.offeringName}</span>
                  </span>
                )}
                {r.bookingId && (
                  <span>
                    Booking:{' '}
                    <span className="font-mono text-gray-500">{r.bookingId.slice(0, 8)}</span>
                  </span>
                )}
              </div>
              {r.comment ? (
                <p className="text-sm text-gray-700">{r.comment}</p>
              ) : (
                <p className="text-sm text-gray-400">Rated, with nothing written.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

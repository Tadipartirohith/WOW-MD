import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

/**
 * An agent's reviews, on their own page.
 *
 * These sat inside My Agency, which is the page about the agency's own details
 * -- name, city, licence, fees. Reviews are about how the agency is doing, not
 * what it is, and burying them under a settings form meant an agent had to open
 * an edit screen to read them (EZ1-I229). Same endpoint, same rendering; only
 * the address changed.
 */
interface MyReviews {
  rating: { average: number; count: number };
  reviews: { rating: number; comment: string | null; clientName: string; createdAt: string }[];
}

/** The agent's own reviews: average, count and each client review (EZ1-I206). */
function Stars({ value }: { value: number }) {
  return (
    <span className="text-brand" aria-label={`${value} out of 5`}>
      {'★'.repeat(Math.round(value))}
      <span className="text-gray-300">{'★'.repeat(Math.max(0, 5 - Math.round(value)))}</span>
    </span>
  );
}

export default function AgentReviews() {
  const { data } = useQuery({
    queryKey: ['agent-my-reviews'],
    queryFn: async () => (await api.get('/agents/my-reviews')).data as MyReviews,
    retry: false,
  });
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">My Reviews</h1>
        <p className="page-subtitle">
          What the families you look after have said about working with you.
        </p>
      </div>

      <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="section-title">Overall</h2>
        {data.rating.count > 0 && (
          <span className="flex items-center gap-2 text-sm text-gray-700">
            <Stars value={data.rating.average} />
            <span className="font-medium tabular-nums">{data.rating.average.toFixed(1)}</span>
            <span className="text-gray-500">
              ({data.rating.count} {data.rating.count === 1 ? 'review' : 'reviews'})
            </span>
          </span>
        )}
      </div>
      {data.reviews.length === 0 ? (
        <p className="text-sm text-gray-500">
          No reviews yet. Clients you manage can rate you from their dashboard.
        </p>
      ) : (
        <div className="divide-y">
          {data.reviews.map((r, i) => (
            <div key={i} className="py-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-gray-800">{r.clientName}</span>
                <span className="flex items-center gap-2 text-gray-500">
                  <Stars value={r.rating} />
                  <span>{new Date(r.createdAt).toLocaleDateString()}</span>
                </span>
              </div>
              {r.comment && <p className="mt-1 text-sm text-gray-600">{r.comment}</p>}
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

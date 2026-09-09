import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';

interface MyAgent {
  agent: { id: string; agencyName: string | null; city: string | null; about: string | null } | null;
  rating: { average: number; count: number };
  myReview: { rating: number; comment: string | null } | null;
}

/**
 * A managed client's view of the agent who represents them: who they are, that
 * agent's aggregate rating, and a control to leave or edit the client's own
 * rating (EZ1-I206).
 *
 * Renders nothing for a client with no agent — a directly-registered user is
 * tied to nobody, so `agent` comes back null and there is simply no card.
 */
export default function AgentReviewCard() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['my-agent'],
    queryFn: async () => (await api.get('/agents/my-agent')).data as MyAgent,
    retry: false,
  });

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  // Seed the form from the saved review once it loads, and reset editing state.
  useEffect(() => {
    if (data?.myReview) {
      setRating(data.myReview.rating);
      setComment(data.myReview.comment ?? '');
    } else {
      setRating(0);
      setComment('');
    }
  }, [data?.myReview]);

  const submit = useMutation({
    mutationFn: async () =>
      (
        await api.post('/agents/my-agent/review', {
          rating,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        })
      ).data as MyAgent,
    onSuccess: (fresh) => {
      qc.setQueryData(['my-agent'], fresh);
      setEditing(false);
      setError('');
    },
    onError: (err) => setError(apiMessage(err, 'That rating could not be saved.')),
  });

  if (!data?.agent) return null;

  const { agent, rating: agg, myReview } = data;
  const showForm = editing || !myReview;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (rating < 1) {
      setError('Pick a rating from 1 to 5 stars.');
      return;
    }
    submit.mutate();
  }

  return (
    <section className="card">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="section-title text-sm">Your agent</h3>
        {agg.count > 0 && (
          <span className="text-xs text-gray-500">
            ★ {agg.average.toFixed(1)} · {agg.count} rating{agg.count === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <p className="text-sm font-medium text-gray-900">
        {agent.agencyName ?? 'Your agency'}
        {agent.city ? <span className="font-normal text-gray-500"> · {agent.city}</span> : null}
      </p>

      {!showForm && myReview ? (
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <Stars value={myReview.rating} />
            <span className="text-xs text-gray-500">Your rating</span>
          </div>
          {myReview.comment && <p className="mt-1 text-sm text-gray-700">{myReview.comment}</p>}
          <button
            type="button"
            className="btn-outline mt-3"
            onClick={() => setEditing(true)}
          >
            Edit your rating
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-3 space-y-3 rounded-sm border border-gray-200 p-3">
          <div>
            <p className="text-sm font-medium text-gray-900">Rate your agent</p>
            <div className="mt-1 flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                  className={`text-2xl leading-none ${n <= rating ? 'text-amber-500' : 'text-gray-300'}`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
          <label className="block text-sm">
            <span className="text-gray-700">Comment (optional)</span>
            <textarea
              className="input mt-1"
              rows={3}
              maxLength={1500}
              placeholder="How has your agent been to work with?"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button className="btn" disabled={submit.isPending}>
              {myReview ? 'Update rating' : 'Submit rating'}
            </button>
            {myReview && (
              <button
                type="button"
                className="btn-outline"
                onClick={() => {
                  setEditing(false);
                  setError('');
                  setRating(myReview.rating);
                  setComment(myReview.comment ?? '');
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span className="leading-none">
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= value ? 'text-amber-500' : 'text-gray-300'}>
          ★
        </span>
      ))}
    </span>
  );
}

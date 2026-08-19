import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';

interface RsvpView {
  guestName: string;
  eventName: string;
  eventDate: string | null;
  venue: string | null;
  status: 'invited' | 'attending' | 'declined' | 'maybe';
  seat: string | null;
  respondedAt: string | null;
}

const CHOICES = [
  { value: 'attending', label: 'Yes, I will be there' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'declined', label: 'Sorry, I cannot make it' },
] as const;

/**
 * Guest-facing RSVP.
 *
 * Guests are not platform users, so there is nothing to sign in to. Their link
 * carries a signed, single-purpose token that addresses exactly one invite —
 * it grants no access to the event, the guest list, or anyone else's reply.
 */
export default function GuestRsvp() {
  const { token = '' } = useParams();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const { data, isLoading, isError, error: loadError, refetch } = useQuery({
    queryKey: ['rsvp', token],
    queryFn: async () => (await api.get(`/events/rsvp/${token}`)).data as RsvpView,
    retry: false,
    enabled: Boolean(token),
  });

  async function respond(status: string) {
    setError('');
    try {
      await api.put(`/events/rsvp/${token}`, { status });
      setSaved(true);
      await refetch();
    } catch (err) {
      setError(apiMessage(err, 'We could not record your reply.'));
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-gray-500">Loading your invitation...</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="card w-full max-w-md text-center">
          <h1 className="text-xl font-bold text-brand-dark">This invitation link is not valid</h1>
          <p className="mt-2 text-sm text-gray-600">
            {apiMessage(loadError, 'It may have expired. Ask your host for a new link.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="card w-full max-w-md space-y-4 text-center">
        <p className="text-4xl" aria-hidden>
          &#128141;
        </p>
        <div>
          <h1 className="text-2xl font-bold text-brand">{data.eventName}</h1>
          <p className="mt-1 text-sm text-gray-600">
            {data.eventDate ? new Date(data.eventDate).toLocaleDateString() : 'Date to be confirmed'}
            {data.venue ? ` · ${data.venue}` : ''}
          </p>
        </div>

        <p className="text-gray-700">
          Hello <strong>{data.guestName}</strong>, will you be joining us?
        </p>

        {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}
        {saved && (
          <p className="rounded bg-brand-light p-3 text-sm text-brand-dark">
            Thank you, your reply has been sent. You can change it any time using this link.
          </p>
        )}

        <div className="space-y-2">
          {CHOICES.map((c) => (
            <button
              key={c.value}
              className={data.status === c.value ? 'btn w-full' : 'btn-outline w-full'}
              onClick={() => respond(c.value)}
            >
              {c.label}
              {data.status === c.value ? ' ✓' : ''}
            </button>
          ))}
        </div>

        {data.seat && (
          <p className="text-sm text-gray-500">Your seat: <strong>{data.seat}</strong></p>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
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
  attendingCount: number | null;
  declineReason: string | null;
  invitedPartySize: number | null;
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
 *
 * Two things are asked beyond yes or no, because both are things the host
 * otherwise spends a fortnight on the phone collecting: how many are coming,
 * and — only if they are not — whether they want to say why. The second is
 * never required; a guest who would rather not explain should not be blocked
 * from replying at all.
 */
export default function GuestRsvp() {
  const { token = '' } = useParams();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [choice, setChoice] = useState<string>('');
  const [count, setCount] = useState('');
  const [reason, setReason] = useState('');

  const { data, isLoading, isError, error: loadError, refetch } = useQuery({
    queryKey: ['rsvp', token],
    queryFn: async () => (await api.get(`/events/rsvp/${token}`)).data as RsvpView,
    retry: false,
    enabled: Boolean(token),
  });

  // Read their previous answer back so changing one detail does not mean
  // retyping the rest.
  useEffect(() => {
    if (!data) return;
    if (data.status !== 'invited') setChoice(data.status);
    setCount(String(data.attendingCount ?? data.invitedPartySize ?? ''));
    setReason(data.declineReason ?? '');
  }, [data]);

  async function respond(status: string, extra: Record<string, unknown> = {}) {
    setError('');
    try {
      await api.put(`/events/rsvp/${token}`, { status, ...extra });
      setSaved(true);
      await refetch();
    } catch (err) {
      setSaved(false);
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
          <h1 className="page-title">This invitation link is not valid</h1>
          <p className="mt-2 text-sm text-gray-600">
            {apiMessage(loadError, 'It may have expired. Ask your host for a new link.')}
          </p>
        </div>
      </div>
    );
  }

  const coming = choice === 'attending' || choice === 'maybe';

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="card w-full max-w-md space-y-4 text-center">
        <p className="text-4xl" aria-hidden>
          &#128141;
        </p>
        <div>
          <h1 className="page-title">{data.eventName}</h1>
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
              className={choice === c.value ? 'btn w-full' : 'btn-outline w-full'}
              onClick={() => {
                setChoice(c.value);
                setSaved(false);
                // A refusal needs nothing more, so it is recorded straight away
                // rather than made to wait behind an optional question.
                if (c.value === 'declined') void respond(c.value, { declineReason: reason.trim() });
              }}
            >
              {c.label}
              {data.status === c.value ? ' ✓' : ''}
            </button>
          ))}
        </div>

        {coming && (
          <div className="space-y-3 border-t pt-3 text-left">
            <label className="block text-sm">
              <span className="font-medium text-gray-700">How many of you are coming?</span>
              <input
                className="input mt-1"
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
              {data.invitedPartySize && (
                <span className="mt-1 block text-xs text-gray-500">
                  The invitation is for {data.invitedPartySize}. Fewer is absolutely fine — it just
                  helps us get the catering right.
                </span>
              )}
            </label>
            <button
              className="btn w-full"
              disabled={!count || Number(count) < 1}
              onClick={() => respond(choice, { attendingCount: Number(count) })}
            >
              Send my reply
            </button>
          </div>
        )}

        {choice === 'declined' && (
          <div className="space-y-2 border-t pt-3 text-left">
            <label className="block text-sm">
              <span className="font-medium text-gray-700">Anything you would like to add?</span>
              <input
                className="input mt-1"
                placeholder="Optional"
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <span className="mt-1 block text-xs text-gray-500">
                Entirely up to you — your reply is already recorded.
              </span>
            </label>
            <button
              className="btn-outline w-full"
              onClick={() => respond('declined', { declineReason: reason.trim() })}
            >
              Send that too
            </button>
          </div>
        )}

        {data.seat && (
          <p className="text-sm text-gray-500">Your seat: <strong>{data.seat}</strong></p>
        )}
      </div>
    </div>
  );
}

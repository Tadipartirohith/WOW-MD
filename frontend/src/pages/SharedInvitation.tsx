import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { formatDate } from '../lib/dates';
import { Loading } from '../components/ui/Feedback';

/**
 * The invitation somebody was forwarded.
 *
 * Reached by whoever the link reached — a family group, a cousin who passed it
 * on — so it is signed in as nobody and shows what an invitation shows: which
 * day, when, where, and who is asking. Nothing about the household, the other
 * guests, or who else has replied.
 *
 * Replying is what creates the guest record. The host has no list yet; this is
 * how they get one.
 */

interface Invitation {
  eventName: string;
  eventDate: string | null;
  startTime: string | null;
  venue: string | null;
  venueAddress: string | null;
  city: string | null;
  hostName: string;
}

export default function SharedInvitation() {
  const { token = '' } = useParams<{ token: string }>();

  const { data, isPending, error } = useQuery<Invitation>({
    queryKey: ['shared-invitation', token],
    queryFn: async () => (await api.get(`/events/share/${token}`)).data,
    enabled: Boolean(token),
    retry: false,
  });

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [partySize, setPartySize] = useState('1');
  const [sent, setSent] = useState<null | { attending: boolean; name: string }>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  async function reply(attending: boolean) {
    if (name.trim().length < 2) {
      setFailed('Please give a name so the hosts know who replied.');
      return;
    }
    setFailed('');
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), attending };
      if (contact.trim()) body.contact = contact.trim();
      // Only meaningful for a yes; sending a party size with a decline would
      // read as "four of us are not coming", which nobody means.
      if (attending && Number(partySize) > 0) body.partySize = Number(partySize);
      const { data: result } = await api.post(`/events/share/${token}`, body);
      setSent({ attending, name: result.name ?? name.trim() });
    } catch (err) {
      setFailed(apiMessage(err, 'That could not be sent. Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  }

  if (isPending) return <div className="mx-auto max-w-md p-6"><Loading rows={4} /></div>;

  if (error) {
    return (
      <div className="mx-auto max-w-md p-6">
        <div className="card text-center">
          <h1 className="section-title">This invitation is not available</h1>
          <p className="mt-1 text-sm text-gray-600">
            The link may have been withdrawn, or copied incompletely. Ask whoever sent it for a
            fresh one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-6">
      <div className="card text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-gray-400">You are invited to</p>
        <h1 className="page-title mt-1">{data.eventName}</h1>
        <p className="mt-1 text-sm text-gray-600">by {data.hostName}</p>

        <dl className="mt-4 space-y-1 text-sm text-gray-700">
          {data.eventDate && <p>{formatDate(data.eventDate)}{data.startTime ? `, ${data.startTime}` : ''}</p>}
          {data.venue && <p className="font-medium">{data.venue}</p>}
          {(data.venueAddress || data.city) && (
            <p className="text-gray-500">{[data.venueAddress, data.city].filter(Boolean).join(', ')}</p>
          )}
        </dl>
      </div>

      {sent ? (
        <div className="card text-center">
          <h2 className="section-title">
            {sent.attending ? 'Thank you — see you there' : 'Thank you for letting them know'}
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Recorded for {sent.name}.{' '}
            {sent.attending
              ? 'The hosts can see your reply.'
              : 'They will be sorry to miss you.'}
          </p>
          {/*
            Opening the form again rather than hiding it. People reply for
            somebody else, or change their mind on the spot, and a page that
            can only be answered once sends them back to the group asking how.
          */}
          <button className="btn-outline mt-3" onClick={() => setSent(null)}>
            Reply again, or for somebody else
          </button>
        </div>
      ) : (
        <div className="card space-y-3">
          <h2 className="section-title">Will you be there?</h2>
          {failed && <p className="alert-critical">{failed}</p>}

          <div>
            <label className="label" htmlFor="rsvp-name">
              Your name
            </label>
            <input
              id="rsvp-name"
              className="input"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="rsvp-contact">
              Phone or email <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              id="rsvp-contact"
              className="input"
              value={contact}
              maxLength={160}
              onChange={(e) => setContact(e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="rsvp-party">
              How many of you, including yourself
            </label>
            <input
              id="rsvp-party"
              className="input"
              type="number"
              min={1}
              max={100}
              value={partySize}
              onChange={(e) => setPartySize(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn flex-1" disabled={busy} onClick={() => reply(true)}>
              {busy ? 'Sending…' : 'Coming'}
            </button>
            <button className="btn-outline flex-1" disabled={busy} onClick={() => reply(false)}>
              Unable to attend
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Not answering leaves you as &ldquo;not responded&rdquo;, which the hosts can see too.
          </p>
        </div>
      )}
    </div>
  );
}

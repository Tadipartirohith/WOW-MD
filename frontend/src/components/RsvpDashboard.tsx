import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';

type Category = 'coming' | 'not_coming' | 'maybe' | 'not_responded';

interface Bucket {
  invitations: number;
  people: number;
}

interface Dashboard {
  event: { id: string; name: string; eventDate: string | null; venue: string | null };
  totalInvited: number;
  totalInvitedHeadcount: number;
  categories: Record<Category, Bucket>;
  awaitingReminder: number;
}

interface RsvpGuest {
  inviteId: string;
  guestId: string;
  name: string;
  phone: string | null;
  email: string | null;
  relation: string | null;
  invitedPartySize: number | null;
  status: string;
  attendingCount: number | null;
  respondedAt: string | null;
  declineReason: string | null;
  invitationSent: boolean;
  lastRemindedAt: string | null;
  reminderCount: number;
  seat: string | null;
}

const CATEGORY_LABEL: Record<Category, string> = {
  coming: 'Coming',
  not_coming: 'Not coming',
  maybe: 'Maybe',
  not_responded: 'Not responded',
};

const CATEGORY_TONE: Record<Category, string> = {
  coming: 'text-emerald-700',
  not_coming: 'text-red-700',
  maybe: 'text-amber-700',
  not_responded: 'text-gray-700',
};

/**
 * What the organiser plans from.
 *
 * The numbers are the point, and the guests behind them are the reason the
 * numbers matter: seating, catering and transport are all ordered from a head
 * count, and the difference between "invited" and "coming" is what somebody
 * spends a fortnight on the phone closing.
 *
 * Every category opens. A dashboard that reports "35 have not responded" and
 * cannot say who is a dashboard nobody can act on.
 */
export default function RsvpDashboard({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<Category | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const { data } = useQuery<Dashboard>({
    queryKey: ['rsvp-dashboard', eventId],
    queryFn: async () => (await api.get(`/events/${eventId}/rsvp`)).data,
    enabled: Boolean(eventId),
  });

  const { data: guests = [], isFetching } = useQuery<RsvpGuest[]>({
    queryKey: ['rsvp-guests', eventId, open],
    queryFn: async () => (await api.get(`/events/${eventId}/rsvp/${open}`)).data,
    enabled: Boolean(eventId && open),
  });

  async function remind(inviteId: string) {
    setError('');
    setNotice('');
    try {
      const { data: result } = await api.post(`/events/invites/${inviteId}/remind`, {});
      setNotice(
        result.emailSent
          ? 'Reminder sent, and the chase is on the record.'
          : 'Chase recorded. There is no email address on file, so ring them.',
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['rsvp-guests', eventId] }),
        qc.invalidateQueries({ queryKey: ['rsvp-dashboard', eventId] }),
      ]);
    } catch (err) {
      setError(apiMessage(err, 'That reminder did not go out.'));
    }
  }

  if (!data) return null;
  const c = data.categories;

  return (
    <div className="card space-y-4">
      <div>
        <h3 className="font-medium text-gray-900">Who is coming</h3>
        <p className="text-sm text-gray-600">
          {data.totalInvited} invitation(s), covering {data.totalInvitedHeadcount} people. Click a
          number to see who.
        </p>
      </div>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {notice && <p className="rounded bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(CATEGORY_LABEL) as Category[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setOpen(open === key ? null : key)}
            className={`rounded border p-3 text-left transition hover:border-brand ${
              open === key ? 'border-brand ring-2 ring-brand' : 'border-gray-200'
            }`}
          >
            <p className="text-xs uppercase tracking-wide text-gray-500">{CATEGORY_LABEL[key]}</p>
            <p className={`mt-1 text-2xl font-semibold ${CATEGORY_TONE[key]}`}>
              {c[key].people}
            </p>
            <p className="text-xs text-gray-400">
              {c[key].invitations} invitation(s)
              {key === 'not_responded' && data.awaitingReminder > 0
                ? ` · ${data.awaitingReminder} to chase`
                : ''}
            </p>
          </button>
        ))}
      </div>

      {open && (
        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-800">
              {CATEGORY_LABEL[open]}
              <span className="ml-2 font-normal text-gray-500">
                {isFetching ? 'loading…' : `${guests.length} guest(s)`}
              </span>
            </h4>
            <button className="btn-outline" onClick={() => setOpen(null)}>
              Close
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-1 pr-3">Guest</th>
                  <th className="py-1 pr-3">Mobile</th>
                  {/* Each category needs a different third column, because each
                      one is a different follow-up. */}
                  {open === 'coming' && <th className="py-1 pr-3">Coming</th>}
                  {open === 'maybe' && <th className="py-1 pr-3">Invited</th>}
                  {open === 'not_coming' && <th className="py-1 pr-3">Reason</th>}
                  {open === 'not_responded' && <th className="py-1 pr-3">Invitation</th>}
                  <th className="py-1 pr-3">
                    {open === 'not_responded' ? 'Last chased' : 'Answered'}
                  </th>
                  {open === 'not_responded' && <th className="py-1" />}
                </tr>
              </thead>
              <tbody className="divide-y">
                {guests.map((g) => (
                  <tr key={g.inviteId}>
                    <td className="py-2 pr-3">
                      <span className="font-medium text-gray-900">{g.name}</span>
                      {g.relation && (
                        <span className="block text-xs text-gray-500">{g.relation}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-gray-700">
                      {g.phone ? (
                        <a className="hover:underline" href={`tel:${g.phone}`}>
                          {g.phone}
                        </a>
                      ) : (
                        <span className="text-gray-400">none on file</span>
                      )}
                    </td>
                    {open === 'coming' && (
                      <td className="py-2 pr-3 tabular-nums text-gray-700">
                        {g.attendingCount ?? g.invitedPartySize ?? 1}
                        {g.invitedPartySize && g.attendingCount !== null &&
                        g.attendingCount !== g.invitedPartySize ? (
                          <span className="text-xs text-gray-400"> of {g.invitedPartySize}</span>
                        ) : null}
                      </td>
                    )}
                    {open === 'maybe' && (
                      <td className="py-2 pr-3 tabular-nums text-gray-700">
                        {g.invitedPartySize ?? 1}
                      </td>
                    )}
                    {open === 'not_coming' && (
                      <td className="py-2 pr-3 text-gray-700">
                        {g.declineReason || <span className="text-gray-400">not given</span>}
                      </td>
                    )}
                    {open === 'not_responded' && (
                      <td className="py-2 pr-3 text-gray-700">
                        {g.invitationSent ? (
                          'Sent'
                        ) : (
                          <span className="text-amber-700">Never sent</span>
                        )}
                      </td>
                    )}
                    <td className="py-2 pr-3 text-gray-500">
                      {open === 'not_responded'
                        ? g.lastRemindedAt
                          ? `${new Date(g.lastRemindedAt).toLocaleDateString()}${
                              g.reminderCount > 1 ? ` (${g.reminderCount}×)` : ''
                            }`
                          : '—'
                        : g.respondedAt
                          ? new Date(g.respondedAt).toLocaleDateString()
                          : '—'}
                    </td>
                    {open === 'not_responded' && (
                      <td className="py-2 text-right">
                        <button className="btn-outline" onClick={() => remind(g.inviteId)}>
                          Chase
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {!isFetching && guests.length === 0 && (
                  <tr>
                    <td className="py-3 text-sm text-gray-400" colSpan={6}>
                      Nobody in this group.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/*
            The head count is what a vendor is booked against, so the step from
            "I know my numbers" to "I can book somebody" belongs right here
            rather than three screens away.
          */}
          {open === 'coming' && guests.length > 0 && (
            <div className="rounded bg-gray-50 p-3 text-sm">
              <p className="text-gray-700">
                {c.coming.people} people confirmed for {data.event.name}
                {data.event.eventDate ? ` on ${data.event.eventDate}` : ''}.
              </p>
              <Link className="btn mt-2 inline-block" to="/vendors">
                Book a vendor for this
              </Link>
              <span className="ml-2 text-xs text-gray-500">
                Photography, catering, decoration — the numbers above are what they will quote
                against.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

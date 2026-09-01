import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { api, apiMessage } from '../lib/api';
import { formatDate } from '../lib/dates';
import { EmptyState, Loading } from './ui/Feedback';

/**
 * One subject, everything about it, on one screen.
 *
 * The console could already list users, businesses, bookings and cases; what
 * it could not do was answer a question about one of them. An administrator
 * asking "what has happened with this account" opened six lists and filtered
 * each by a uuid — slow, and the reason the wrong account occasionally gets
 * suspended.
 *
 * What is shown depends on what the subject is, and that is deliberate. A
 * couple has matches and a wedding; an agency has clients and fees; an officer
 * has a workload and no bookings at all. Four empty sections is not a neutral
 * answer — it teaches somebody to stop reading the screen.
 */

interface Section {
  title: string;
  rows: { label: string; value: string }[];
}

export default function Admin360() {
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState<{ kind: 'account' | 'booking'; id: string } | null>(null);

  const { data: directory } = useQuery({
    queryKey: ['admin-directory', query],
    queryFn: async () =>
      (await api.get('/admin/directory', { params: { q: query } })).data as {
        id: string;
        email: string;
        role: string;
      }[],
    enabled: query.trim().length >= 2,
    retry: false,
  });

  const detail = useQuery({
    queryKey: ['admin-360', subject?.kind, subject?.id],
    queryFn: async () =>
      (
        await api.get(
          subject?.kind === 'booking'
            ? `/admin/bookings/${subject.id}`
            : `/admin/accounts/${subject?.id}`,
        )
      ).data,
    enabled: Boolean(subject),
    retry: false,
  });

  const results = Array.isArray(directory) ? directory : [];

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="section-title">Look something up</h2>
        <p className="text-sm text-gray-600">
          An account or a booking id. Everything the platform holds about it appears below, rather
          than in six lists filtered by hand.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 sm:max-w-sm">
          <MagnifyingGlass
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            className="input w-full py-1.5 pl-8 text-sm"
            placeholder="Email, or paste a booking id"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {/*
          A uuid is unambiguous, so pasting one skips the directory entirely —
          which is how an administrator arrives here from a support ticket.
        */}
        {/^[0-9a-f-]{36}$/i.test(query.trim()) && (
          <button
            className="btn-outline btn-sm"
            onClick={() => setSubject({ kind: 'booking', id: query.trim() })}
          >
            Open as booking
          </button>
        )}
      </div>

      {results.length > 0 && (
        <ul className="divide-y divide-gray-200 rounded-sm border border-gray-200">
          {results.slice(0, 8).map((row) => (
            <li key={row.id}>
              <button
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-sunken"
                onClick={() => setSubject({ kind: 'account', id: row.id })}
              >
                <span className="truncate text-gray-900">{row.email}</span>
                <span className="shrink-0 text-xs uppercase tracking-wide text-gray-400">
                  {row.role}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {subject && detail.isPending && <Loading rows={4} />}
      {subject && detail.error && (
        <p className="alert-critical">{apiMessage(detail.error, 'That could not be opened.')}</p>
      )}
      {subject && detail.data && (
        <Detail kind={subject.kind} data={detail.data as Record<string, never>} />
      )}
      {!subject && query.trim().length < 2 && (
        <EmptyState icon={MagnifyingGlass} title="Nothing selected">
          Search for somebody, or paste a booking id from a support case.
        </EmptyState>
      )}
    </div>
  );
}

function Detail({ kind, data }: { kind: 'account' | 'booking'; data: Record<string, never> }) {
  const d = data as unknown as Record<string, never> & Record<string, unknown>;
  const sections: Section[] = [];
  const n = (value: unknown) => (Array.isArray(value) ? String(value.length) : '0');
  const text = (value: unknown) => (value === null || value === undefined || value === '' ? '-' : String(value));

  if (kind === 'booking') {
    const b = d.booking as Record<string, unknown>;
    const client = d.client as Record<string, unknown> | null;
    const agent = d.agent as Record<string, unknown> | null;
    const provider = d.provider as Record<string, unknown>;
    sections.push(
      {
        title: 'The booking',
        rows: [
          { label: 'Status', value: text(b.status).replace(/_/g, ' ') },
          { label: 'Amount', value: `${text(b.currency)} ${text(b.amount)}` },
          { label: 'Event date', value: b.eventDate ? formatDate(String(b.eventDate)) : '-' },
          { label: 'Requested', value: formatDate(String(b.createdAt)) },
        ],
      },
      {
        title: 'Who',
        rows: [
          { label: 'Client', value: text(client?.email) },
          // The agency behind the client, when there is one: an administrator
          // asking why a booking was made often has to ask who made it.
          { label: 'Their agency', value: agent ? text(agent.email) : 'None' },
          { label: 'Provider', value: text(provider?.name ?? provider?.id) },
        ],
      },
      {
        title: 'Money and arguments',
        rows: [
          { label: 'Payments', value: n(d.payments) },
          { label: 'Disputes', value: n(d.disputes) },
        ],
      },
    );
  } else {
    const user = d.user as Record<string, unknown>;
    const payments = d.payments as Record<string, unknown>;
    sections.push({
      title: 'Account',
      rows: [
        { label: 'Email', value: text(user.email) },
        { label: 'Role', value: text(user.role) },
        { label: 'Active', value: user.isActive ? 'Yes' : 'Suspended' },
        { label: 'Identity verified', value: user.isVerified ? 'Yes' : 'No' },
        { label: 'Joined', value: formatDate(String(user.createdAt)) },
      ],
    });

    const matchmaking = d.matchmaking as Record<string, unknown> | null;
    if (matchmaking) {
      sections.push({
        title: 'Matchmaking',
        rows: [
          { label: 'Interests sent', value: text(matchmaking.sent) },
          { label: 'Received', value: text(matchmaking.received) },
          { label: 'Accepted', value: text(matchmaking.accepted) },
          { label: 'Match fixed', value: Number(matchmaking.fixed) > 0 ? 'Yes' : 'No' },
        ],
      });
    }

    sections.push({
      title: 'Money',
      rows: [
        { label: 'Paid in total', value: text(payments?.total) },
        { label: 'Held in escrow', value: text(payments?.inEscrow) },
        { label: 'Released', value: text(payments?.released) },
        { label: 'Refunded', value: text(payments?.refunded) },
      ],
    });

    const agency = d.agency as Record<string, unknown> | null;
    if (agency) {
      sections.push({
        title: 'Agency',
        rows: [
          { label: 'Clients brought on', value: n(agency.clients) },
          { label: 'Charges raised', value: n(agency.charges) },
        ],
      });
    }

    const officer = d.officer as Record<string, unknown> | null;
    if (officer) {
      sections.push({
        title: 'Verification workload',
        rows: [
          { label: 'Allocated', value: text(officer.assigned) },
          { label: 'Still open', value: text(officer.open) },
          // The one number worth acting on: an overdue visit is somebody
          // waiting, and it is invisible everywhere else.
          { label: 'Past the deadline', value: text(officer.overdue) },
        ],
      });
    }

    sections.push({
      title: 'Everything else',
      rows: [
        { label: 'Profiles', value: n(d.profiles) },
        { label: 'Businesses', value: n(d.businesses) },
        { label: 'Bookings placed', value: n(d.bookings) },
        { label: 'Cases raised', value: n(d.casesRaised) },
        { label: 'Cases assigned', value: n(d.casesAssigned) },
        { label: 'Verifications', value: n(d.verifications) },
      ],
    });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {sections.map((section) => (
        <div key={section.title} className="rounded-sm border border-gray-200 p-3">
          <h3 className="section-title text-sm">{section.title}</h3>
          <dl className="mt-2 space-y-1 text-sm">
            {section.rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-gray-500">{row.label}</dt>
                <dd className="truncate text-right font-medium text-gray-900">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

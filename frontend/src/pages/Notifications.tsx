import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate } from '../lib/dates';

interface Notification {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

const TYPE_LABEL: Record<string, string> = {
  match_interest: 'Interest shown',
  match_accepted: 'Interest accepted',
  new_message: 'New message',
  task_reminder: 'Reminder',
  booking_update: 'Booking update',

  booking_request: 'New request',
  booking_quotation: 'Quotation',
  booking_confirmed: 'Job accepted',
  booking_payment: 'Payment held',
  booking_started: 'Work started',
  booking_completed: 'Work delivered',
  booking_cancelled: 'Booking cancelled',

  verification_assigned: 'Visit assigned to you',
  verification_submitted: 'Findings submitted',
  verification_decided: 'Verification decided',
  dispute_update: 'Dispute',
};

/**
 * Which group a notification belongs to.
 *
 * A vendor with forty of these needs to see "three requests are waiting on me"
 * before anything else. Sorting by time alone buries that under whatever
 * happened most recently.
 */
type Group = 'action' | 'money' | 'progress' | 'other';

const TYPE_GROUP: Record<string, Group> = {
  booking_request: 'action',
  booking_quotation: 'action',
  verification_assigned: 'action',
  verification_submitted: 'action',
  match_interest: 'action',
  booking_payment: 'money',
  booking_confirmed: 'progress',
  booking_started: 'progress',
  booking_completed: 'progress',
  booking_cancelled: 'progress',
  verification_decided: 'progress',
  dispute_update: 'action',
  match_accepted: 'progress',
  new_message: 'action',
  task_reminder: 'action',
  booking_update: 'progress',
};

const GROUP_LABEL: Record<Group, string> = {
  action: 'Waiting on you',
  money: 'Money',
  progress: 'Progress',
  other: 'Everything else',
};

/**
 * The notification feed.
 *
 * Every line says what happened in the reader's own terms and links to the
 * screen where they can do something about it — a notification you cannot act
 * on is just noise, and people stop opening the list.
 *
 * Reading one marks it read and nothing else. It is tempting to have opening a
 * request also accept it, or dismiss the thing it refers to; both turn an
 * inbox into a place where glancing at something changes it.
 */
export default function Notifications() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const { data = [], isLoading } = useQuery<Notification[]>({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/notifications')).data,
  });

  const unread = data.filter((n) => !n.isRead).length;
  const rows = filter === 'unread' ? data.filter((n) => !n.isRead) : data;

  async function markRead(id: string) {
    await api.put(`/notifications/${id}/read`, {});
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['unread-count'] });
  }

  async function markAll() {
    await api.put('/notifications/read-all', {});
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['unread-count'] });
  }

  const groups: Group[] = ['action', 'money', 'progress', 'other'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-brand-dark">Notifications</h1>
          <p className="text-sm text-gray-600">
            {unread > 0 ? `${unread} unread` : 'Nothing waiting on you.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={filter === 'all' ? 'btn' : 'btn-outline'}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button
            className={filter === 'unread' ? 'btn' : 'btn-outline'}
            onClick={() => setFilter('unread')}
          >
            Unread ({unread})
          </button>
          {unread > 0 && (
            <button className="btn-outline" onClick={markAll}>
              Mark all as read
            </button>
          )}
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {groups.map((group) => {
        const inGroup = rows.filter((n) => (TYPE_GROUP[n.type] ?? 'other') === group);
        if (inGroup.length === 0) return null;
        return (
          <div key={group} className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              {GROUP_LABEL[group]}
            </h2>
            <div className="card divide-y p-0">
              {inGroup.map((n) => (
                <div
                  key={n.id}
                  className={`flex flex-wrap items-start justify-between gap-3 p-4 ${
                    n.isRead ? '' : 'bg-brand-light/30'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">
                      {TYPE_LABEL[n.type] ?? n.type.replace(/_/g, ' ')}
                      {typeof n.payload?.reference === 'string' && (
                        <span className="ml-2 text-xs font-normal text-gray-400">
                          #{n.payload.reference}
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-gray-600">{describe(n)}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {new Date(n.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {linkFor(n) && (
                      <Link className="btn-outline" to={linkFor(n)!} onClick={() => markRead(n.id)}>
                        Open
                      </Link>
                    )}
                    {!n.isRead && (
                      <button className="btn-outline" onClick={() => markRead(n.id)}>
                        Mark read
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {!isLoading && rows.length === 0 && (
        <p className="card p-6 text-center text-sm text-gray-400">
          {filter === 'unread' ? 'Nothing unread.' : 'Nothing here yet.'}
        </p>
      )}
    </div>
  );
}

/**
 * Where "Open" goes.
 *
 * A booking notification opens the booking itself rather than the list, which
 * is the difference between telling somebody a request has arrived and showing
 * it to them.
 */
function linkFor(n: Notification): string | null {
  const p = n.payload ?? {};
  const bookingId = typeof p.bookingId === 'string' ? p.bookingId : null;

  if (n.type.startsWith('booking_')) {
    return bookingId ? `/bookings?highlight=${bookingId}` : '/bookings';
  }
  if (n.type.startsWith('verification_')) return '/verification';
  if (n.type === 'dispute_update') return '/bookings';
  if (n.type === 'new_message') return '/chat';
  if (n.type === 'task_reminder') return '/planner';
  // Straight to the profile it is about, rather than to a list the reader
  // then has to search.
  if (n.type.startsWith('match_')) {
    const profileId = typeof p.counterpartProfileId === 'string' ? p.counterpartProfileId : null;
    return profileId ? `/matches?profile=${profileId}` : '/matches';
  }
  return null;
}

/** A sentence a person can read, built from whatever the payload carries. */
function describe(n: Notification): string {
  const p = n.payload ?? {};
  const str = (key: string) => (typeof p[key] === 'string' ? String(p[key]) : null);
  const status = str('status')?.replace(/_/g, ' ') ?? '';
  const client = str('clientName') ?? 'A client';
  const service = str('service');
  const when = p.eventDate ? formatDate(String(p.eventDate)) : null;
  const money = str('amount') ? `${str('currency') ?? 'INR'} ${str('amount')}` : null;

  // What the reader needs to decide whether to open it: who, what, and when.
  const job = [service, when].filter(Boolean).join(' · ');

  switch (n.type) {
    case 'booking_request':
      return `${client} has asked about ${job || 'your services'}.`;
    case 'booking_quotation':
      return money ? `${money} — ${job || 'the job'}.` : `A quotation on ${job || 'the job'}.`;
    case 'booking_confirmed':
      return `The provider has accepted ${job || 'the job'}. The date is held.`;
    case 'booking_payment':
      return money ? `${money} is in escrow for ${job || 'the job'}.` : 'A payment is in escrow.';
    case 'booking_started':
      return `Work has started on ${job || 'the job'}.`;
    case 'booking_completed':
      return `${job || 'The job'} is delivered. The balance is now payable.`;
    case 'booking_cancelled':
      return `${job || 'A booking'} was cancelled.`;
    case 'verification_assigned':
      return `A ${str('applicantType') ?? 'business'} verification is on your queue.`;
    case 'verification_submitted':
      return `An officer recommends ${str('recommendation') ?? 'a decision'}${
        typeof p.issues === 'number' && p.issues > 0 ? `, with ${p.issues} issue(s)` : ''
      }.`;
    case 'verification_decided':
      return status ? `Your verification was ${status}.` : 'Your verification was decided.';
    case 'booking_update':
      return status ? `A booking moved to ${status}.` : 'One of your bookings changed.';
    case 'new_message':
      return str('preview') ?? 'Someone replied to you.';
    case 'match_interest':
      return str('counterpartName')
        ? `${str('counterpartName')}${str('counterpartCity') ? ` from ${str('counterpartCity')}` : ''} would like to take your profile forward.`
        : 'Someone would like to take your profile forward.';
    case 'match_accepted':
      // Naming them is the whole point: somebody who has sent five interests
      // cannot act on "your interest was accepted".
      return str('counterpartName')
        ? `${str('counterpartName')} accepted your interest.`
        : 'Your interest was accepted.';
    case 'task_reminder':
      return str('title') ?? 'A planning task is due.';
    default:
      return '';
  }
}

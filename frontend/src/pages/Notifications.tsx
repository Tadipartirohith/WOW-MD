import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import {
  ACTION_LABEL,
  TYPE_LABEL,
  UNREAD_POLL_MS,
  describe,
  type Notification,
} from '../lib/notification-copy';
import { EmptyState, Loading } from '../components/ui/Feedback';
import SupportContact from '../components/SupportContact';
import { BellSlash } from '@phosphor-icons/react';


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
    // On the same clock as the badge, and for a worse reason than the badge
    // had: this page did not refresh at all. Somebody sitting on the feed
    // waiting for a reply watched the count in the navigation tick up beside a
    // list that never changed.
    refetchInterval: UNREAD_POLL_MS,
  });

  const unread = data.filter((n) => !n.isRead).length;
  const rows = filter === 'unread' ? data.filter((n) => !n.isRead) : data;

  async function markAll() {
    await api.put('/notifications/read-all', {});
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['unread-count'] });
  }

  /**
   * One entry per thing, not per event.
   *
   * The feed listed every notification separately and grouped them by what
   * kind they were, which read as noise the moment anybody had more than one
   * booking: a vendor's eleven notifications were about four jobs, interleaved
   * by time, so no single job's story was ever in one place. The grouping made
   * it worse rather than better — a booking's payment landed under "Money"
   * while the request that started it sat under "Waiting on you", so one
   * booking was split across two headings.
   *
   * Now the thing itself is the row: the newest update is the headline and
   * everything earlier about the same booking, case or application folds
   * underneath it. A notification with no subject stands alone, because
   * merging unrelated things is the problem this is fixing.
   *
   * The heading a subject sits under comes from its newest update, so a
   * booking moves from "Waiting on you" to "Progress" as it advances instead
   * of appearing in both at once.
   */
  const subjects = useMemo(() => {
    const bySubject = new Map<string, Notification[]>();
    for (const n of rows) {
      /*
       * The id alone, never the module with it.
       *
       * A quotation and a payment on the same booking both carry that
       * booking's id, but the quotation declares module 'quotations' because
       * that is where it navigates to. Keying on both split one booking into
       * two subjects that then appeared under two different headings — the
       * very thing this grouping exists to stop. The module says where to go;
       * the id says what the thing is, and identity is the id.
       */
      const key = n.targetId ?? `one:${n.id}`;
      bySubject.set(key, [...(bySubject.get(key) ?? []), n]);
    }
    const when = (n: Notification) => new Date(n.createdAt).getTime();
    return [...bySubject.entries()]
      .map(([key, all]) => {
        const sorted = [...all].sort((a, b) => when(b) - when(a));
        return {
          key,
          latest: sorted[0],
          earlier: sorted.slice(1),
          unread: sorted.filter((n) => !n.isRead).length,
          ids: sorted.filter((n) => !n.isRead).map((n) => n.id),
          group: (TYPE_GROUP[sorted[0].type] ?? 'other') as Group,
        };
      })
      .sort((a, b) => when(b.latest) - when(a.latest));
  }, [rows]);

  /** Clearing a subject clears the whole story, not just its last line. */
  async function markSubject(ids: string[]) {
    await Promise.all(ids.map((id) => api.put(`/notifications/${id}/read`, {})));
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['unread-count'] });
  }

  const groups: Group[] = ['action', 'money', 'progress', 'other'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-subtitle">
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

      <Channels />

      {isLoading && <Loading rows={3} />}

      {groups.map((group) => {
        const inGroup = subjects.filter((s) => s.group === group);
        if (inGroup.length === 0) return null;
        return (
          <div key={group} className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              {GROUP_LABEL[group]}
            </h2>
            <div className="card divide-y p-0">
              {inGroup.map((s) => (
                <SubjectRow key={s.key} subject={s} onClear={markSubject} />
              ))}
            </div>
          </div>
        );
      })}

      {!isLoading && rows.length === 0 && (
        <div className="card">
          <EmptyState icon={BellSlash} title="Nothing to catch up on">
            Interests, bookings and verification decisions all land here.
          </EmptyState>
        </div>
      )}

      {/*
        The bottom of this page is where somebody ends up when the thing they
        were waiting for has not arrived. That is the moment to offer a person
        rather than another screen. It renders nothing when no channel is
        configured.
      */}
      <SupportContact />
    </div>
  );
}

/**
 * Where else the platform may reach you.
 *
 * Both switches are off until somebody turns them on, and the copy says what
 * each one actually does rather than "enable notifications". A phone number
 * given so the platform could verify it is not consent to be messaged on
 * WhatsApp, and a toggle that pretends otherwise is the reason people stop
 * trusting the settings screen.
 */
function Channels() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { data } = useQuery<{
    devices: number;
    whatsappOptIn: boolean;
    whatsappReachable: boolean;
  }>({
    queryKey: ['notification-channels'],
    queryFn: async () => (await api.get('/notifications/channels')).data,
    retry: false,
  });

  async function setWhatsApp(optIn: boolean) {
    setBusy(true);
    setNotice(null);
    try {
      await api.put('/notifications/channels/whatsapp', { optIn });
      qc.invalidateQueries({ queryKey: ['notification-channels'] });
      setNotice(
        optIn
          ? 'You will get a WhatsApp about bookings and payments. Nothing else.'
          : 'No more WhatsApp messages.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;

  return (
    <div className="card space-y-2">
      <h2 className="section-title">How we reach you</h2>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-gray-800">On this device</p>
          <p className="text-xs text-gray-500">
            {data.devices > 0
              ? `${data.devices} device(s) registered. Signing out on one stops it.`
              : 'No devices registered. Allow notifications when your browser asks.'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
        <div>
          <p className="text-sm font-medium text-gray-800">WhatsApp</p>
          <p className="text-xs text-gray-500">
            Bookings and payments only. A new request, a quotation, money held, a balance due,
            and a verification decision. Never matches or messages.
          </p>
          {data.whatsappOptIn && !data.whatsappReachable && (
            <p className="text-xs text-amber-700">
              Add a phone number to your profile. There is nowhere to send these yet.
            </p>
          )}
        </div>
        <button
          className={data.whatsappOptIn ? 'btn-outline' : 'btn'}
          disabled={busy}
          onClick={() => void setWhatsApp(!data.whatsappOptIn)}
        >
          {data.whatsappOptIn ? 'Turn off' : 'Turn on'}
        </button>
      </div>

      {notice && <p className="text-xs text-emerald-700">{notice}</p>}
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
interface Subject {
  key: string;
  latest: Notification;
  earlier: Notification[];
  unread: number;
  ids: string[];
  group: Group;
}

/**
 * One booking, case or application, and what has happened to it.
 *
 * The headline is the newest update because that is the state the thing is
 * actually in; everything before it is history, and history is the part that
 * made this page unreadable when it was given equal weight. It is one click
 * away rather than gone, since "what happened before this" is a real question
 * — just not the one somebody opens the page with.
 */
function SubjectRow({
  subject,
  onClear,
}: {
  subject: Subject;
  onClear: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const { latest, earlier, unread } = subject;
  const href = linkFor(latest);

  return (
    <div className={`p-4 ${unread > 0 ? 'bg-brand-light/30' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-gray-900">
            {TYPE_LABEL[latest.type] ?? latest.type.replace(/_/g, ' ')}
            {typeof latest.payload?.reference === 'string' && (
              <span className="ml-2 text-xs font-normal text-gray-400">
                #{latest.payload.reference}
              </span>
            )}
            {unread > 1 && (
              <span className="ml-2 rounded-full bg-brand px-1.5 py-0.5 text-xs font-normal text-white">
                {unread}
              </span>
            )}
          </p>
          <p className="text-sm text-gray-600">{describe(latest)}</p>
          <p className="mt-1 text-xs text-gray-400">
            {new Date(latest.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {href && (
            <Link
              className={`btn-sm ${
                latest.targetAction && latest.targetAction !== 'view' ? 'btn' : 'btn-outline'
              }`}
              to={href}
              onClick={() => onClear(subject.ids)}
            >
              {(latest.targetAction && ACTION_LABEL[latest.targetAction]) ?? 'Open'}
            </Link>
          )}
          {unread > 0 && (
            <button className="btn-outline btn-sm" onClick={() => onClear(subject.ids)}>
              Mark read
            </button>
          )}
        </div>
      </div>

      {earlier.length > 0 && (
        <div className="mt-2">
          <button
            className="text-xs text-gray-500 underline-offset-2 hover:underline"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            {open
              ? 'Hide what came before'
              : `${earlier.length} earlier update${earlier.length === 1 ? '' : 's'}`}
          </button>
          {open && (
            <ul className="mt-2 space-y-1 border-l border-gray-200 pl-3">
              {earlier.map((n) => (
                <li key={n.id} className="text-xs text-gray-500">
                  <span className="font-medium text-gray-700">
                    {TYPE_LABEL[n.type] ?? n.type.replace(/_/g, ' ')}
                  </span>{' '}
                  — {describe(n)}{' '}
                  <span className="text-gray-400">{new Date(n.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function linkFor(n: Notification): string | null {
  // The server now says where each notification goes, so this maps a module to
  // a route rather than re-deciding from the type. The two used to disagree
  // silently — the rule lived here, in a chain of prefix tests, and a phone
  // showing the same notification would have needed its own copy of it.
  if (n.targetModule) {
    switch (n.targetModule) {
      case 'bookings':
      case 'quotations':
      case 'disputes':
        return n.targetId ? `/bookings?highlight=${n.targetId}` : '/bookings';
      case 'verification':
        return '/verification';
      case 'chat':
        return '/chat';
      case 'planner':
        return '/planner';
      case 'matches':
        return n.targetId ? `/matches?profile=${n.targetId}` : '/matches';
    }
  }

  // Rows written before the columns existed. Kept rather than migrated to a
  // guess: the old derivation is what those rows were displayed with.
  const p = n.payload ?? {};
  const bookingId = typeof p.bookingId === 'string' ? p.bookingId : null;

  if (n.type.startsWith('booking_')) {
    return bookingId ? `/bookings?highlight=${bookingId}` : '/bookings';
  }
  if (n.type.startsWith('verification_')) return '/verification';
  if (n.type === 'dispute_update') return '/bookings';
  if (n.type === 'new_message') return '/chat';
  if (n.type === 'task_reminder') return '/planner';
  if (n.type.startsWith('match_')) {
    const profileId = typeof p.counterpartProfileId === 'string' ? p.counterpartProfileId : null;
    return profileId ? `/matches?profile=${profileId}` : '/matches';
  }
  return null;
}


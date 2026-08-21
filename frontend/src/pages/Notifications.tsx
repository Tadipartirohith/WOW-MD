import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

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
};

const TYPE_LINK: Record<string, string> = {
  match_interest: '/matches',
  match_accepted: '/matches',
  new_message: '/chat',
  task_reminder: '/planner',
  booking_update: '/bookings',
};

/**
 * The notification feed.
 *
 * Every line says what happened in the reader's own terms and links to the
 * screen where they can do something about it — a notification you cannot act
 * on is just noise, and people stop opening the list.
 */
export default function Notifications() {
  const qc = useQueryClient();

  const { data = [], isLoading } = useQuery<Notification[]>({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/notifications')).data,
  });

  const unread = data.filter((n) => !n.isRead).length;

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-brand-dark">Notifications</h1>
          <p className="text-sm text-gray-600">
            {unread > 0 ? `${unread} unread` : 'Nothing waiting on you.'}
          </p>
        </div>
        {unread > 0 && (
          <button className="btn-outline" onClick={markAll}>
            Mark all as read
          </button>
        )}
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      <div className="card divide-y p-0">
        {data.map((n) => (
          <div
            key={n.id}
            className={`flex flex-wrap items-start justify-between gap-3 p-4 ${
              n.isRead ? '' : 'bg-brand-light/30'
            }`}
          >
            <div>
              <p className="font-medium text-gray-900">{TYPE_LABEL[n.type] ?? n.type}</p>
              <p className="text-sm text-gray-600">{describe(n)}</p>
              <p className="mt-1 text-xs text-gray-400">
                {new Date(n.createdAt).toLocaleString()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {TYPE_LINK[n.type] && (
                <Link className="btn-outline" to={TYPE_LINK[n.type]} onClick={() => markRead(n.id)}>
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
        {!isLoading && data.length === 0 && (
          <p className="p-6 text-center text-sm text-gray-400">Nothing here yet.</p>
        )}
      </div>
    </div>
  );
}

/** A sentence a person can read, built from whatever the payload carries. */
function describe(n: Notification): string {
  const p = n.payload ?? {};
  const status = typeof p.status === 'string' ? p.status.replace(/_/g, ' ') : '';

  switch (n.type) {
    case 'booking_update':
      return status ? `A booking moved to ${status}.` : 'One of your bookings changed.';
    case 'new_message':
      return typeof p.preview === 'string' ? String(p.preview) : 'Someone replied to you.';
    case 'match_interest':
      return 'Someone would like to take your profile forward.';
    case 'match_accepted':
      return 'Your interest was accepted.';
    case 'task_reminder':
      return typeof p.title === 'string' ? String(p.title) : 'A planning task is due.';
    default:
      return '';
  }
}

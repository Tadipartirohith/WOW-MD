import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, HandHeart } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/dates';
import { EmptyState, Loading } from './ui/Feedback';

/**
 * Every interest across an agency's book, on one page (EZ1-I243).
 *
 * The board below this is per profile, which is the right shape for the person
 * whose profile it is and the wrong one for an agent running forty of them: the
 * Interests card on the dashboard opened a page that showed nothing at all
 * until a client had been picked, and finding out what had happened anywhere
 * meant picking each of them in turn.
 *
 * So this is the flat list, newest first, with both sides of every row and
 * their own details. The agent is not one of the two parties, so "sent by" and
 * "sent to" are the facts — direction is only a way of filtering them — and a
 * row where the agency manages both ends says so rather than pretending one of
 * them is the outside world.
 *
 * The filtering is client-side. The list is one read of the agency's own rows,
 * and searching it here is a view concern rather than a new query per keystroke.
 */
interface PartyView {
  id: string;
  displayName: string;
  gender: string | null;
  ageRange: string | null;
  city: string | null;
  photos?: string[];
  profileCode?: string | null;
  verified?: boolean;
}

interface AgencyInterestRow {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  direction: 'sent' | 'received';
  bothClients: boolean;
  clientProfileId: string;
  from: PartyView;
  to: PartyView;
}

interface AgencyInterests {
  data: AgencyInterestRow[];
  counts: Record<string, number>;
  clients: { id: string; displayName: string }[];
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  unmatched: 'Unmatched',
  blocked: 'Blocked',
};

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-800',
  accepted: 'bg-emerald-50 text-emerald-800',
  rejected: 'bg-gray-100 text-gray-600',
  withdrawn: 'bg-gray-100 text-gray-600',
  unmatched: 'bg-gray-100 text-gray-600',
  blocked: 'bg-red-50 text-red-700',
};

/** The filters the ticket asks for, as one row of chips over two dimensions. */
const DIRECTIONS = [
  { key: '', label: 'All' },
  { key: 'sent', label: 'Sent' },
  { key: 'received', label: 'Received' },
];

const STATUSES = ['pending', 'accepted', 'rejected', 'withdrawn'];

export default function AgencyInterests({
  onViewProfile,
  onViewInterest,
}: {
  /** Opens a profile preview — either side of the row. */
  onViewProfile: (profileId: string) => void;
  /** Opens the client's own board, where the row can be acted on. */
  onViewInterest: (clientProfileId: string) => void;
}) {
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<AgencyInterests>({
    queryKey: ['agency-interests'],
    queryFn: async () => (await api.get('/matches/interests/agency')).data,
    retry: false,
  });

  const rows = data?.data ?? [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    // Inclusive at both ends: somebody filtering "to the 14th" means the 14th.
    const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : 0;
    const toTime = to ? new Date(`${to}T23:59:59`).getTime() : 0;

    return rows.filter((row) => {
      if (direction && row.direction !== direction) return false;
      if (status && row.status !== status) return false;
      const at = new Date(row.createdAt).getTime();
      if (fromTime && at < fromTime) return false;
      if (toTime && at > toTime) return false;
      if (term) {
        const haystack = [
          row.from.displayName,
          row.to.displayName,
          row.from.profileCode,
          row.to.profileCode,
          row.from.city,
          row.to.city,
          row.id,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [rows, direction, status, from, to, search]);

  if (isLoading) return <Loading rows={4} />;

  if (rows.length === 0) {
    return (
      <div className="card">
        <EmptyState icon={HandHeart} title="No interests yet">
          Interests your clients send, and interests sent to them, all appear here as they happen.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {DIRECTIONS.map((option) => (
            <Chip
              key={option.key || 'all'}
              active={direction === option.key}
              onClick={() => setDirection(option.key)}
            >
              {option.label}
              {option.key && data?.counts[option.key] ? (
                <span className="ml-1.5 font-mono opacity-70">{data.counts[option.key]}</span>
              ) : null}
            </Chip>
          ))}
          <span className="mx-1 h-4 w-px bg-gray-200" aria-hidden />
          <Chip active={status === ''} onClick={() => setStatus('')}>
            Any status
          </Chip>
          {STATUSES.map((key) => (
            <Chip key={key} active={status === key} onClick={() => setStatus(key)}>
              {STATUS_LABEL[key]}
              {data?.counts[key] ? (
                <span className="ml-1.5 font-mono opacity-70">{data.counts[key]}</span>
              ) : null}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            className="input flex-1 py-1.5 text-sm sm:max-w-xs"
            placeholder="Client, other profile, code or interest id"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            From
            <input
              className="input w-auto py-1.5 text-sm"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            To
            <input
              className="input w-auto py-1.5 text-sm"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          {(direction || status || from || to || search) && (
            <button
              className="btn-ghost btn-sm"
              onClick={() => {
                setDirection('');
                setStatus('');
                setFrom('');
                setTo('');
                setSearch('');
              }}
            >
              Clear
            </button>
          )}
        </div>

        <p className="text-xs text-gray-500">
          {filtered.length} of {rows.length} interests across {data?.clients.length ?? 0} clients.
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState icon={HandHeart} title="Nothing matches those filters">
            Clear them to see the whole book again.
          </EmptyState>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((row) => (
            <li key={row.id} className="card space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`pill ${STATUS_STYLE[row.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_LABEL[row.status] ?? row.status}
                </span>
                <span className="pill bg-surface-sunken text-gray-600">
                  {row.bothClients ? 'Between your clients' : row.direction === 'sent' ? 'Sent' : 'Received'}
                </span>
                <span className="text-xs text-gray-400">{formatDateTime(row.createdAt)}</span>
                <span className="ml-auto font-mono text-xs text-gray-400">{row.id.slice(0, 8)}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                <Party party={row.from} label="Sent by" onView={() => onViewProfile(row.from.id)} />
                <ArrowRight size={16} className="shrink-0 text-gray-400" aria-hidden />
                <Party party={row.to} label="Sent to" onView={() => onViewProfile(row.to.id)} />
              </div>

              <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-2">
                <button className="btn-outline btn-sm" onClick={() => onViewProfile(row.to.id)}>
                  View profile
                </button>
                <button
                  className="btn-outline btn-sm"
                  onClick={() => onViewInterest(row.clientProfileId)}
                >
                  View interest
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? 'rounded-full bg-brand px-3 py-1 text-xs font-medium text-brand-fg'
          : 'rounded-full bg-surface-sunken px-3 py-1 text-xs text-gray-600 hover:bg-gray-100'
      }
    >
      {children}
    </button>
  );
}

/** One side of an interest: who they are, and a way into their profile. */
function Party({
  party,
  label,
  onView,
}: {
  party: PartyView;
  label: string;
  onView: () => void;
}) {
  const facts = [party.ageRange, party.gender, party.city].filter(Boolean).join(' · ');
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {party.photos?.[0] ? (
        <img
          src={party.photos[0]}
          alt=""
          className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-inset ring-gray-900/5"
        />
      ) : (
        <span className="h-9 w-9 shrink-0 rounded-full bg-surface-sunken" aria-hidden />
      )}
      <div className="min-w-0">
        <p className="text-[0.6875rem] uppercase tracking-wide text-gray-400">{label}</p>
        <button className="block truncate text-sm font-medium text-brand-strong" onClick={onView}>
          {party.displayName}
          {party.profileCode ? (
            <span className="ml-1.5 font-mono text-xs text-gray-400">{party.profileCode}</span>
          ) : null}
        </button>
        {facts && <p className="truncate text-xs text-gray-500">{facts}</p>}
      </div>
    </div>
  );
}

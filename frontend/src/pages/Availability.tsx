import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { DAY_STATE_LABEL, SLOT_STATE_LABEL, SlotState } from '../lib/permissions';

/**
 * A published window, exactly as the server reports it.
 *
 * `remaining`, `state`, `bookable` and `actions` are all computed server-side
 * and read here rather than re-derived. The client showing a different answer
 * from the API is how a vendor ends up looking at "2 free" on a window the
 * server will refuse.
 */
interface Slot {
  id: string;
  vendorServiceId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  confirmed: number;
  pending: number;
  remaining: number;
  state: SlotState;
  bookable: boolean;
  note: string | null;
  blockReason: string | null;
  actions: { canEdit: boolean; canRetime: boolean; canBlock: boolean; canDelete: boolean };
}

interface Day {
  date: string;
  state: string;
  total: number;
  bookable: number;
  pending: number;
  confirmed: number;
  blocked: number;
  remaining: number;
}

interface Summary {
  from: string;
  to: string;
  totalSlots: number;
  openSlots: number;
  requestedSlots: number;
  bookedSlots: number;
  fullSlots: number;
  blockedSlots: number;
  confirmedBookings: number;
  pendingRequests: number;
}

interface VendorService {
  id: string;
  displayName: string | null;
  concurrentCapacity: number;
  definition: { name: string } | null;
}

type Bucket = 'published' | 'open' | 'requested' | 'booked' | 'full' | 'blocked';

const STATE_STYLE: Record<string, string> = {
  available: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  partially_booked: 'bg-sky-50 text-sky-800 border-sky-200',
  fully_booked: 'bg-gray-100 text-gray-600 border-gray-200',
  blocked: 'bg-red-50 text-red-700 border-red-200',
  no_availability: 'bg-white text-gray-300 border-gray-100',
};

const SLOT_STATE_STYLE: Record<SlotState, string> = {
  open: 'bg-emerald-50 text-emerald-800',
  booked: 'bg-sky-50 text-sky-800',
  full: 'bg-gray-100 text-gray-600',
  blocked: 'bg-red-50 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

/**
 * The vendor's calendar.
 *
 * Availability is time slots on dates, not whole days — a photographer sells a
 * morning and an evening on the same Saturday, and a caterer sells the same
 * afternoon to five families at once. The window rolls three months from today
 * and is computed, never stored, so there is no quarter to open by hand.
 *
 * Two things the vendor sees here that they could not before: every window
 * reports its confirmed, pending and remaining counts rather than a single
 * "taken" figure, and every summary card opens the windows behind it.
 */
export default function Availability() {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState('');
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  // A vendor may hold more than one listing, and each keeps its own calendar —
  // a caterer's Saturday has nothing to do with their photography arm's.
  const { data: listings = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['vendor-me'],
    queryFn: async () => (await api.get('/vendors/me')).data,
    retry: false,
  });

  const [listingId, setListingId] = useState('');
  const vendorId = listingId || listings[0]?.id;
  const listing = listings.find((l) => l.id === vendorId);

  const { data: window } = useQuery({
    queryKey: ['availability-window'],
    queryFn: async () => (await api.get('/vendors/availability/window')).data,
  });

  const { data: summary } = useQuery<Summary>({
    queryKey: ['availability-summary', vendorId],
    queryFn: async () => (await api.get(`/vendors/${vendorId}/availability/summary`)).data,
    enabled: Boolean(vendorId),
  });

  const { data: calendar = [] } = useQuery<Day[]>({
    queryKey: ['availability-calendar', vendorId],
    queryFn: async () => (await api.get(`/vendors/${vendorId}/availability/calendar`)).data,
    enabled: Boolean(vendorId),
  });

  const { data: slots = [] } = useQuery<Slot[]>({
    queryKey: ['availability-slots', vendorId],
    queryFn: async () => (await api.get(`/vendors/${vendorId}/availability/slots`)).data,
    enabled: Boolean(vendorId),
  });

  // What a summary card opens. Fetched from the server rather than filtered
  // here, so the card and the counter above it can never disagree.
  const { data: bucketSlots = [], isFetching: bucketLoading } = useQuery<Slot[]>({
    queryKey: ['availability-bucket', vendorId, bucket],
    queryFn: async () =>
      (await api.get(`/vendors/${vendorId}/availability/slots/by/${bucket}`)).data,
    enabled: Boolean(vendorId && bucket),
  });

  // The services a window can be published against. A vendor who has not
  // adopted the catalog simply has none, and publishes without one.
  const { data: services = [] } = useQuery<VendorService[]>({
    queryKey: ['vendor-services', vendorId],
    queryFn: async () => (await api.get(`/vendors/${vendorId}/services`)).data,
    enabled: Boolean(vendorId),
    retry: false,
  });

  const byDate = useMemo(() => {
    const map = new Map<string, Day>();
    for (const day of calendar) map.set(day.date, day);
    return map;
  }, [calendar]);

  const daySlots = useMemo(
    () =>
      slots
        .filter((s) => s.date === selected)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [slots, selected],
  );

  // Everything on this page reads from the server, so one refresh after any
  // change keeps the counters, the calendar and the open card in step.
  async function act(fn: () => Promise<unknown>, ok?: string) {
    setError('');
    setNotice('');
    try {
      await fn();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['availability-slots', vendorId] }),
        qc.invalidateQueries({ queryKey: ['availability-calendar', vendorId] }),
        qc.invalidateQueries({ queryKey: ['availability-summary', vendorId] }),
        qc.invalidateQueries({ queryKey: ['availability-bucket', vendorId] }),
      ]);
      if (ok) setNotice(ok);
      return true;
    } catch (err) {
      setError(apiMessage(err, 'That change was not accepted.'));
      return false;
    }
  }

  if (!listing) {
    return (
      <div className="card">
        <h1 className="text-xl font-bold text-brand-dark">Availability</h1>
        <p className="mt-2 text-sm text-gray-600">
          Create your business listing first — availability hangs off it.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-brand-dark">Availability</h1>
          <p className="text-sm text-gray-600">
            {window ? `Bookable from ${window.from} to ${window.to}.` : 'Rolling three-month window.'}{' '}
            Publish the windows you can actually take work in. A window stays open until you accept
            a job — a request on its own takes nothing.
          </p>
        </div>
        {listings.length > 1 && (
          <label className="text-sm">
            <span className="text-gray-700">Listing</span>
            <select
              className="input mt-1"
              value={vendorId}
              onChange={(e) => {
                setListingId(e.target.value);
                setSelected('');
                setBucket(null);
              }}
            >
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {notice && <p className="rounded bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

      {summary && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="Published"
            value={summary.totalSlots}
            active={bucket === 'published'}
            onClick={() => setBucket(bucket === 'published' ? null : 'published')}
          />
          <Stat
            label="Open"
            value={summary.openSlots}
            tone="text-emerald-700"
            active={bucket === 'open'}
            onClick={() => setBucket(bucket === 'open' ? null : 'open')}
          />
          <Stat
            label="Requested"
            value={summary.requestedSlots}
            hint={`${summary.pendingRequests} request(s)`}
            tone="text-amber-700"
            active={bucket === 'requested'}
            onClick={() => setBucket(bucket === 'requested' ? null : 'requested')}
          />
          <Stat
            label="Booked"
            value={summary.bookedSlots}
            hint={`${summary.confirmedBookings} booking(s)`}
            tone="text-sky-700"
            active={bucket === 'booked'}
            onClick={() => setBucket(bucket === 'booked' ? null : 'booked')}
          />
          <Stat
            label="Full"
            value={summary.fullSlots}
            tone="text-gray-700"
            active={bucket === 'full'}
            onClick={() => setBucket(bucket === 'full' ? null : 'full')}
          />
          <Stat
            label="Blocked"
            value={summary.blockedSlots}
            tone="text-red-700"
            active={bucket === 'blocked'}
            onClick={() => setBucket(bucket === 'blocked' ? null : 'blocked')}
          />
        </div>
      )}

      {bucket && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">
              {BUCKET_TITLE[bucket]}
              <span className="ml-2 text-sm font-normal text-gray-500">
                {bucketLoading ? 'loading…' : `${bucketSlots.length} window(s)`}
              </span>
            </h2>
            <button className="btn-outline" onClick={() => setBucket(null)}>
              Close
            </button>
          </div>
          <div className="divide-y">
            {bucketSlots.map((slot) => (
              <button
                key={slot.id}
                className="flex w-full flex-wrap items-center justify-between gap-2 py-2 text-left hover:bg-gray-50"
                onClick={() => {
                  setSelected(slot.date);
                  setBucket(null);
                }}
              >
                <span className="text-sm font-medium text-gray-900">
                  {formatLongDate(slot.date)} · {hhmm(slot.startTime)}–{hhmm(slot.endTime)}
                </span>
                <SlotCounts slot={slot} />
              </button>
            ))}
            {!bucketLoading && bucketSlots.length === 0 && (
              <p className="py-3 text-sm text-gray-400">Nothing in this group right now.</p>
            )}
          </div>
        </div>
      )}

      <Calendar
        from={window?.from}
        to={window?.to}
        byDate={byDate}
        selected={selected}
        onSelect={(d) => {
          setSelected(d);
          setEditing(null);
        }}
      />

      {selected && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">{formatLongDate(selected)}</h2>
            <span className="text-sm text-gray-500">
              {DAY_STATE_LABEL[byDate.get(selected)?.state ?? 'no_availability']}
            </span>
          </div>

          <div className="divide-y">
            {daySlots.map((slot) =>
              editing === slot.id ? (
                <EditSlot
                  key={slot.id}
                  slot={slot}
                  onCancel={() => setEditing(null)}
                  onSave={async (body) => {
                    const ok = await act(
                      () => api.put(`/vendors/${vendorId}/availability/slots/${slot.id}`, body),
                      'Slot updated.',
                    );
                    if (ok) setEditing(null);
                  }}
                />
              ) : (
                <div
                  key={slot.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div>
                    <p className="font-medium text-gray-900">
                      {hhmm(slot.startTime)} – {hhmm(slot.endTime)}
                    </p>
                    <div className="mt-1">
                      <SlotCounts slot={slot} />
                    </div>
                    {(slot.note || slot.blockReason) && (
                      <p className="mt-1 text-xs text-gray-500">
                        {slot.note}
                        {slot.note && slot.blockReason ? ' · ' : ''}
                        {slot.blockReason}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${SLOT_STATE_STYLE[slot.state]}`}
                    >
                      {SLOT_STATE_LABEL[slot.state]}
                    </span>

                    {/*
                      Every button here is rendered from the server's own answer
                      about what is allowed, so nothing appears that would be
                      refused — and nothing is hidden that would be accepted.
                    */}
                    {slot.actions.canEdit && (
                      <button className="btn-outline" onClick={() => setEditing(slot.id)}>
                        Edit
                      </button>
                    )}
                    {slot.state === 'blocked' ? (
                      <button
                        className="btn-outline"
                        onClick={() =>
                          act(
                            () =>
                              api.post(
                                `/vendors/${vendorId}/availability/slots/${slot.id}/unblock`,
                                {},
                              ),
                            'Back on sale.',
                          )
                        }
                      >
                        Unblock
                      </button>
                    ) : (
                      slot.actions.canBlock && (
                        <button
                          className="btn-outline"
                          onClick={() => {
                            const reason = prompt('Why is this window unavailable?') ?? '';
                            if (reason.trim()) {
                              void act(
                                () =>
                                  api.post(
                                    `/vendors/${vendorId}/availability/slots/${slot.id}/block`,
                                    { reason },
                                  ),
                                'Blocked.',
                              );
                            }
                          }}
                        >
                          Block
                        </button>
                      )
                    )}
                    {slot.actions.canDelete && (
                      <button
                        className="btn-outline"
                        onClick={() =>
                          act(
                            () =>
                              api.delete(`/vendors/${vendorId}/availability/slots/${slot.id}`),
                            'Window withdrawn.',
                          )
                        }
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ),
            )}
            {daySlots.length === 0 && (
              <p className="py-3 text-sm text-gray-400">Nothing published on this date yet.</p>
            )}
          </div>

          <NewSlot
            date={selected}
            services={services}
            onCreate={(body) =>
              act(
                () => api.post(`/vendors/${vendorId}/availability/slots`, body),
                'Window published.',
              )
            }
          />
        </div>
      )}
    </div>
  );
}

const BUCKET_TITLE: Record<Bucket, string> = {
  published: 'Every window published',
  open: 'Windows that can take another booking',
  requested: 'Windows with requests waiting on you',
  booked: 'Windows with confirmed bookings',
  full: 'Windows at capacity',
  blocked: 'Windows you have blocked',
};

/**
 * The four numbers that matter, always shown together.
 *
 * "3 of 5 taken" on its own hid the difference between a booking and a
 * question, which is exactly what made the old page misleading.
 */
function SlotCounts({ slot }: { slot: Slot }) {
  return (
    <p className="text-xs text-gray-600">
      <span className="font-medium text-gray-900">{slot.confirmed}</span> confirmed
      {' · '}
      <span className={slot.pending > 0 ? 'font-medium text-amber-700' : ''}>
        {slot.pending} pending
      </span>
      {' · '}
      <span className={slot.remaining > 0 ? 'font-medium text-emerald-700' : 'text-gray-500'}>
        {slot.remaining} left
      </span>
      {' of '}
      {slot.capacity}
    </p>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone?: string;
  hint?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`card text-left transition hover:border-brand ${active ? 'ring-2 ring-brand' : ''}`}
    >
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? 'text-gray-900'}`}>{value}</p>
      <p className="text-xs text-gray-400">{hint ?? (active ? 'Showing below' : 'Show these')}</p>
    </button>
  );
}

function NewSlot({
  date,
  services,
  onCreate,
}: {
  date: string;
  services: VendorService[];
  onCreate: (b: unknown) => void;
}) {
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('13:00');
  const [serviceId, setServiceId] = useState('');
  const [capacity, setCapacity] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');

  const service = services.find((s) => s.id === serviceId);
  // Capacity follows the service unless the vendor overrides it for this one
  // window, which is where "five teams, but only three free that Saturday"
  // gets said.
  const effectiveCapacity = capacity === '' ? (service?.concurrentCapacity ?? 1) : Number(capacity);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (end <= start) {
      setProblem('The end time has to be after the start time.');
      return;
    }
    if (!Number.isInteger(effectiveCapacity) || effectiveCapacity < 1) {
      setProblem('Capacity has to be a whole number, at least one.');
      return;
    }
    setProblem('');
    onCreate({
      date,
      startTime: start,
      endTime: end,
      capacity: effectiveCapacity,
      vendorServiceId: serviceId || undefined,
      note: note.trim() || undefined,
    });
    setNote('');
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t pt-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="text-gray-700">From</span>
          <input
            className="input mt-1"
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
          />
        </label>
        <label className="text-sm">
          <span className="text-gray-700">To</span>
          <input
            className="input mt-1"
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            required
          />
        </label>
        {services.length > 0 && (
          <label className="text-sm">
            <span className="text-gray-700">Service</span>
            <select
              className="input mt-1"
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value);
                setCapacity('');
              }}
            >
              <option value="">Any</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName ?? s.definition?.name ?? 'Service'}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          <span className="text-gray-700">Capacity</span>
          <input
            className="input mt-1 w-24"
            type="number"
            min={1}
            placeholder={String(service?.concurrentCapacity ?? 1)}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </label>
        <label className="flex-1 text-sm">
          <span className="text-gray-700">Note</span>
          <input
            className="input mt-1"
            placeholder="Morning sitting"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button className="btn">Publish window</button>
      </div>
      <p className="text-xs text-gray-500">
        Capacity is how many bookings this window can take at once — five if you can run five teams,
        one for a hall.
      </p>
      {problem && <p className="text-sm text-red-600">{problem}</p>}
    </form>
  );
}

/**
 * Editing a published window.
 *
 * The times are only offered when the server says they can still change; the
 * capacity and the note are always editable, because nothing has been promised
 * against them.
 */
function EditSlot({
  slot,
  onSave,
  onCancel,
}: {
  slot: Slot;
  onSave: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [start, setStart] = useState(hhmm(slot.startTime));
  const [end, setEnd] = useState(hhmm(slot.endTime));
  const [capacity, setCapacity] = useState(String(slot.capacity));
  const [note, setNote] = useState(slot.note ?? '');
  const [problem, setProblem] = useState('');

  useEffect(() => {
    setStart(hhmm(slot.startTime));
    setEnd(hhmm(slot.endTime));
    setCapacity(String(slot.capacity));
    setNote(slot.note ?? '');
  }, [slot]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (slot.actions.canRetime && end <= start) {
      setProblem('The end time has to be after the start time.');
      return;
    }
    const n = Number(capacity);
    if (!Number.isInteger(n) || n < 1) {
      setProblem('Capacity has to be a whole number, at least one.');
      return;
    }
    if (n < slot.confirmed) {
      setProblem(`This window already holds ${slot.confirmed} confirmed booking(s).`);
      return;
    }
    setProblem('');
    onSave({
      ...(slot.actions.canRetime ? { startTime: start, endTime: end } : {}),
      capacity: n,
      note: note.trim(),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2 py-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="text-gray-700">From</span>
          <input
            className="input mt-1"
            type="time"
            value={start}
            disabled={!slot.actions.canRetime}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="text-gray-700">To</span>
          <input
            className="input mt-1"
            type="time"
            value={end}
            disabled={!slot.actions.canRetime}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="text-gray-700">Capacity</span>
          <input
            className="input mt-1 w-24"
            type="number"
            min={Math.max(1, slot.confirmed)}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </label>
        <label className="flex-1 text-sm">
          <span className="text-gray-700">Note</span>
          <input className="input mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="btn">Save</button>
        <button type="button" className="btn-outline" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {!slot.actions.canRetime && (
        <p className="text-xs text-gray-500">
          The times are fixed now — somebody has already planned their day around this window.
        </p>
      )}
      {problem && <p className="text-sm text-red-600">{problem}</p>}
    </form>
  );
}

/**
 * Month grid across the rolling window.
 *
 * Built from the window the server reports rather than from today's date in the
 * browser, so a device with a wrong clock cannot offer a date the server will
 * then refuse.
 */
function Calendar({
  from,
  to,
  byDate,
  selected,
  onSelect,
}: {
  from?: string;
  to?: string;
  byDate: Map<string, Day>;
  selected: string;
  onSelect: (d: string) => void;
}) {
  const months = useMemo(() => buildMonths(from, to), [from, to]);
  if (!from || !to) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {months.map((month) => (
        <div key={month.key} className="card">
          <p className="mb-2 font-semibold text-gray-900">{month.label}</p>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase text-gray-400">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {month.cells.map((cell, i) =>
              cell === null ? (
                <span key={i} />
              ) : (
                <button
                  key={i}
                  onClick={() => onSelect(cell)}
                  disabled={cell < from || cell > to}
                  title={dayTitle(byDate.get(cell))}
                  className={`rounded border py-1 text-xs disabled:opacity-30 ${
                    STATE_STYLE[byDate.get(cell)?.state ?? 'no_availability']
                  } ${selected === cell ? 'ring-2 ring-brand' : ''}`}
                >
                  {Number(cell.slice(8, 10))}
                </button>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function dayTitle(day?: Day): string {
  const label = DAY_STATE_LABEL[day?.state ?? 'no_availability'];
  if (!day || day.total === 0) return label;
  return `${label} — ${day.confirmed} confirmed, ${day.pending} pending, ${day.remaining} left`;
}

function buildMonths(from?: string, to?: string) {
  if (!from || !to) return [];
  const months: { key: string; label: string; cells: (string | null)[] }[] = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);

  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const days = new Date(year, month + 1, 0).getDate();

    const cells: (string | null)[] = Array(first.getDay()).fill(null);
    for (let d = 1; d <= days; d += 1) {
      cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    months.push({
      key: `${year}-${month}`,
      label: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      cells,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

/** Postgres returns `HH:MM:SS`; a time input wants `HH:MM`. */
function hhmm(time: string) {
  return time.slice(0, 5);
}

function formatLongDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

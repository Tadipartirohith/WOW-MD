import { FormEvent, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { DAY_STATE_LABEL, SLOT_STATUS_LABEL, SlotStatus } from '../lib/permissions';

interface Slot {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  booked: number;
  status: SlotStatus;
  bookingId: string | null;
  note: string | null;
  blockReason: string | null;
}

interface Day {
  date: string;
  state: string;
  total: number;
  bookable: number;
  pending: number;
  booked: number;
  blocked: number;
}

const STATE_STYLE: Record<string, string> = {
  available: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  partially_booked: 'bg-sky-50 text-sky-800 border-sky-200',
  fully_booked: 'bg-gray-100 text-gray-600 border-gray-200',
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  blocked: 'bg-red-50 text-red-700 border-red-200',
  no_availability: 'bg-white text-gray-300 border-gray-100',
};

const STATUS_STYLE: Record<SlotStatus, string> = {
  available: 'bg-emerald-50 text-emerald-800',
  pending: 'bg-amber-50 text-amber-800',
  booked: 'bg-sky-50 text-sky-800',
  blocked: 'bg-red-50 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

/**
 * The vendor's calendar.
 *
 * Availability is time slots on dates, not whole days — a photographer sells a
 * morning and an evening on the same Saturday, and a hall sells three sittings.
 * The window rolls three months from today and is computed, never stored, so
 * there is no quarter to open by hand.
 */
export default function Availability() {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');

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

  const { data: summary } = useQuery({
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

  const byDate = useMemo(() => {
    const map = new Map<string, Day>();
    for (const day of calendar) map.set(day.date, day);
    return map;
  }, [calendar]);

  const daySlots = useMemo(
    () => slots.filter((s) => s.date === selected).sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [slots, selected],
  );

  async function act(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ['availability-slots', vendorId] });
      qc.invalidateQueries({ queryKey: ['availability-calendar', vendorId] });
      qc.invalidateQueries({ queryKey: ['availability-summary', vendorId] });
    } catch (err) {
      setError(apiMessage(err, 'That change was not accepted.'));
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
          Publish the windows you can actually take work in — buyers only see those.
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

      {summary && (
        <div className="grid gap-3 sm:grid-cols-5">
          <Stat label="Slots published" value={summary.totalSlots} />
          <Stat label="Available" value={summary.availableSlots} tone="text-emerald-700" />
          <Stat label="Requested" value={summary.pendingSlots} tone="text-amber-700" />
          <Stat label="Booked" value={summary.bookedSlots} tone="text-sky-700" />
          <Stat label="Blocked" value={summary.blockedSlots} tone="text-red-700" />
        </div>
      )}

      <Calendar
        from={window?.from}
        to={window?.to}
        byDate={byDate}
        selected={selected}
        onSelect={setSelected}
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
            {daySlots.map((slot) => (
              <div key={slot.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium text-gray-900">
                    {slot.startTime.slice(0, 5)} – {slot.endTime.slice(0, 5)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {slot.booked} of {slot.capacity} taken
                    {slot.note ? ` · ${slot.note}` : ''}
                    {slot.blockReason ? ` · ${slot.blockReason}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-1 text-xs ${STATUS_STYLE[slot.status]}`}>
                    {SLOT_STATUS_LABEL[slot.status]}
                  </span>
                  {slot.status === 'available' && (
                    <>
                      <button
                        className="btn-outline"
                        onClick={() => {
                          const reason = prompt('Why is this window unavailable?') ?? '';
                          if (reason.trim()) {
                            void act(() =>
                              api.post(
                                `/vendors/${vendorId}/availability/slots/${slot.id}/block`,
                                { reason },
                              ),
                            );
                          }
                        }}
                      >
                        Block
                      </button>
                      {slot.booked === 0 && (
                        <button
                          className="btn-outline"
                          onClick={() =>
                            act(() =>
                              api.delete(`/vendors/${vendorId}/availability/slots/${slot.id}`),
                            )
                          }
                        >
                          Delete
                        </button>
                      )}
                    </>
                  )}
                  {slot.status === 'blocked' && (
                    <button
                      className="btn-outline"
                      onClick={() =>
                        act(() =>
                          api.post(
                            `/vendors/${vendorId}/availability/slots/${slot.id}/unblock`,
                            {},
                          ),
                        )
                      }
                    >
                      Unblock
                    </button>
                  )}
                </div>
              </div>
            ))}
            {daySlots.length === 0 && (
              <p className="py-3 text-sm text-gray-400">Nothing published on this date yet.</p>
            )}
          </div>

          <NewSlot
            date={selected}
            onCreate={(body) =>
              act(() => api.post(`/vendors/${vendorId}/availability/slots`, body))
            }
          />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function NewSlot({ date, onCreate }: { date: string; onCreate: (b: unknown) => void }) {
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('13:00');
  const [capacity, setCapacity] = useState(1);
  const [note, setNote] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    onCreate({
      date,
      startTime: start,
      endTime: end,
      capacity,
      note: note.trim() || undefined,
    });
    setNote('');
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 border-t pt-4">
      <label className="text-sm">
        <span className="text-gray-700">From</span>
        <input className="input mt-1" type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
      </label>
      <label className="text-sm">
        <span className="text-gray-700">To</span>
        <input className="input mt-1" type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
      </label>
      <label className="text-sm">
        <span className="text-gray-700">Capacity</span>
        <input
          className="input mt-1 w-24"
          type="number"
          min={1}
          value={capacity}
          onChange={(e) => setCapacity(Number(e.target.value))}
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
      <button className="btn">Publish slot</button>
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
                  title={DAY_STATE_LABEL[byDate.get(cell)?.state ?? 'no_availability']}
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

function formatLongDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

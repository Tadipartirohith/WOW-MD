import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { VENDOR_CATEGORIES } from '../lib/permissions';

interface Vendor {
  id: string;
  name: string;
  category: string;
  city?: string;
  description?: string;
  ratingAvg: number;
  ratingCount: number;
}

interface Slot {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  booked: number;
  note: string | null;
}

interface WeddingEvent {
  id: string;
  name: string;
  eventDate: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  venue: 'Venue',
  catering: 'Catering',
  photography: 'Photography',
  decor: 'Decor',
  makeup: 'Makeup',
  entertainment: 'Entertainment',
  other: 'Other',
};

/**
 * The vendor marketplace.
 *
 * A request now carries a date and a published window, because a booking
 * without one is a conversation rather than a commitment: the vendor cannot
 * tell whether they are free, and two couples can be told yes for the same
 * Saturday. Price is deliberately absent — the vendor quotes against the
 * requirements, and a number typed here before anyone has read them is fiction.
 */
export default function Vendors() {
  const [category, setCategory] = useState('');
  const [city, setCity] = useState('');
  const [requesting, setRequesting] = useState<Vendor | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['vendors', category, city],
    queryFn: async () =>
      (
        await api.get('/vendors/search', {
          params: {
            ...(category ? { category } : {}),
            ...(city ? { city } : {}),
          },
        })
      ).data,
  });

  const vendors: Vendor[] = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-brand-dark">Vendors</h1>
          <p className="text-sm text-gray-600">
            Pick a window that suits you and tell them what you need. They come back with a price.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="text-gray-700">City</span>
            <input
              className="input mt-1 max-w-[12rem]"
              value={city}
              placeholder="Any"
              onChange={(e) => setCity(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="text-gray-700">Category</span>
            <select
              className="input mt-1 max-w-xs"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {VENDOR_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {isLoading && <p className="text-gray-500">Loading…</p>}
      {!isLoading && vendors.length === 0 && (
        <p className="card text-sm text-gray-500">No vendors match that search.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {vendors.map((v) => (
          <div key={v.id} className="card flex flex-col">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-semibold">{v.name}</h2>
              {v.ratingCount > 0 && (
                <span className="whitespace-nowrap text-sm text-amber-600">
                  ★ {v.ratingAvg} ({v.ratingCount})
                </span>
              )}
            </div>
            <p className="text-xs uppercase tracking-wide text-gray-400">
              {CATEGORY_LABEL[v.category] ?? v.category}
            </p>
            <p className="text-sm text-gray-500">{v.city}</p>
            {v.description && <p className="mt-2 flex-1 text-sm text-gray-600">{v.description}</p>}
            <button className="btn mt-3" onClick={() => setRequesting(v)}>
              Check availability
            </button>
          </div>
        ))}
      </div>

      {requesting && <RequestDialog vendor={requesting} onClose={() => setRequesting(null)} />}
    </div>
  );
}

function RequestDialog({ vendor, onClose }: { vendor: Vendor; onClose: () => void }) {
  const nav = useNavigate();
  const [slotId, setSlotId] = useState('');
  const [eventId, setEventId] = useState('');
  const [requirements, setRequirements] = useState('');
  const [budget, setBudget] = useState('');
  const [error, setError] = useState('');
  const [existing, setExisting] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: slots = [], isLoading } = useQuery<Slot[]>({
    queryKey: ['bookable-slots', vendor.id],
    queryFn: async () => (await api.get(`/vendors/${vendor.id}/availability`)).data,
  });

  // Bookings can be tied to one event — the mehendi's makeup artist is not the
  // reception's. Absent for anyone who has not set their events up yet.
  const { data: events = [] } = useQuery<WeddingEvent[]>({
    queryKey: ['my-events'],
    queryFn: async () => (await api.get('/events')).data?.data ?? [],
    retry: false,
  });

  const byDate = new Map<string, Slot[]>();
  for (const slot of slots) {
    byDate.set(slot.date, [...(byDate.get(slot.date) ?? []), slot]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setExisting('');
    setBusy(true);
    try {
      const { data } = await api.post('/bookings', {
        providerType: 'vendor',
        providerId: vendor.id,
        slotId,
        requirements,
        ...(eventId ? { eventId } : {}),
        ...(budget ? { expectedBudget: Number(budget) } : {}),
      });
      nav(`/bookings?highlight=${data.id}`);
    } catch (err) {
      const body = (err as { response?: { data?: { error?: { code?: string; bookingId?: string } } } })
        .response?.data?.error;
      if (body?.code === 'DUPLICATE_BOOKING_REQUEST' && body.bookingId) {
        setExisting(body.bookingId);
      } else {
        setError(apiMessage(err, 'That request could not be sent.'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{vendor.name}</h2>
            <p className="text-sm text-gray-600">
              {CATEGORY_LABEL[vendor.category] ?? vendor.category}
              {vendor.city ? ` · ${vendor.city}` : ''}
            </p>
          </div>
          <button className="text-2xl leading-none text-gray-400" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error && <p className="mb-3 rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}
        {existing && (
          <div className="mb-3 rounded bg-amber-50 p-3 text-sm text-amber-900">
            You have already asked this vendor for that window.{' '}
            <button className="underline" onClick={() => nav(`/bookings?highlight=${existing}`)}>
              Open the request you already have
            </button>
            .
          </div>
        )}

        {isLoading && <p className="text-sm text-gray-400">Checking their calendar…</p>}

        {!isLoading && slots.length === 0 && (
          <p className="rounded bg-gray-50 p-4 text-sm text-gray-600">
            They have nothing free in the next three months. Message them from Chat if your date is
            further out.
          </p>
        )}

        {slots.length > 0 && (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <p className="label">Pick a window</p>
              <div className="max-h-56 space-y-3 overflow-y-auto rounded border border-gray-200 p-3">
                {[...byDate.entries()].map(([date, daySlots]) => (
                  <div key={date}>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {daySlots.map((slot) => (
                        <button
                          key={slot.id}
                          type="button"
                          onClick={() => setSlotId(slot.id)}
                          className={`rounded border px-3 py-1.5 text-sm ${
                            slotId === slot.id
                              ? 'border-brand bg-brand-light text-brand-dark'
                              : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {slot.startTime.slice(0, 5)}–{slot.endTime.slice(0, 5)}
                          {slot.note ? ` · ${slot.note}` : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {events.length > 0 && (
              <label className="block text-sm">
                <span className="text-gray-700">Which event is this for?</span>
                <select
                  className="input mt-1"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                >
                  <option value="">Not tied to one event</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                      {ev.eventDate ? ` — ${ev.eventDate}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block text-sm">
              <span className="text-gray-700">What do you need?</span>
              <textarea
                className="input mt-1"
                rows={4}
                minLength={10}
                required
                placeholder="450 guests, vegetarian, service from 7pm, two live counters."
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
              />
              <span className="mt-1 block text-xs text-gray-500">
                The more specific this is, the closer their quote will be to the final price.
              </span>
            </label>

            <label className="block text-sm">
              <span className="text-gray-700">Budget you have in mind</span>
              <input
                className="input mt-1 max-w-[12rem]"
                type="number"
                min={0}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
              <span className="mt-1 block text-xs text-gray-500">
                Optional. Leave it blank if you would rather hear their number first.
              </span>
            </label>

            <div className="flex gap-2">
              <button className="btn" disabled={!slotId || busy}>
                {busy ? 'Sending…' : 'Send request'}
              </button>
              <button type="button" className="btn-outline" onClick={onClose}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

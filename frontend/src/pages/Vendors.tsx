import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { VENDOR_CATEGORIES } from '../lib/permissions';
import DynamicForm, { Answers, FieldSpec, cleanAnswers, validateAnswers } from '../components/DynamicForm';

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
  confirmed: number;
  remaining: number;
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

interface Offering {
  id: string;
  name: string;
  description: string | null;
  pricingModel: string;
  price: string | null;
  currency: string;
  unitLabel: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  isPackage: boolean;
  inclusions: string[];
}

interface VendorServiceSummary {
  id: string;
  displayName: string | null;
  bookable: boolean;
  definition: { name: string } | null;
}

interface BookingContext {
  bookingForm: FieldSpec[];
  offerings: Offering[];
}

/** Where a quantity is part of the price rather than decoration. */
const QUANTITY_MODELS = ['per_person', 'per_item', 'per_hour', 'per_day', 'per_session'];

/** The two models that publish no amount — the vendor quotes after the request. */
const QUOTE_ONLY = ['custom_quote', 'no_public_price'];

function offeringPrice(o: Offering): string {
  if (QUOTE_ONLY.includes(o.pricingModel)) {
    return o.pricingModel === 'custom_quote' ? 'Quoted per job' : 'Price on request';
  }
  const amount = `${o.currency} ${Number(o.price).toLocaleString()}`;
  if (o.pricingModel === 'starting_from') return `From ${amount}`;
  return o.unitLabel ? `${amount} ${o.unitLabel}` : amount;
}

function RequestDialog({ vendor, onClose }: { vendor: Vendor; onClose: () => void }) {
  const nav = useNavigate();
  // Arriving from an event carries it in. An organiser who pressed "book
  // someone for this day" has already told the app which day, and asking again
  // in a dropdown is asking them to repeat themselves.
  const [params] = useSearchParams();
  const [slotId, setSlotId] = useState('');
  const [eventId, setEventId] = useState(params.get('eventId') ?? '');
  const [serviceId, setServiceId] = useState('');
  const [offeringId, setOfferingId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [answers, setAnswers] = useState<Answers>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [requirements, setRequirements] = useState('');
  const [budget, setBudget] = useState('');
  const [error, setError] = useState('');
  const [existing, setExisting] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: slots = [], isLoading } = useQuery<Slot[]>({
    queryKey: ['bookable-slots', vendor.id],
    queryFn: async () => (await api.get(`/vendors/${vendor.id}/availability`)).data,
  });

  // What this business sells, from the catalog. A vendor who has not adopted
  // it has none, and the request falls back to the free-text form below.
  const { data: services = [] } = useQuery<VendorServiceSummary[]>({
    queryKey: ['vendor-public-services', vendor.id],
    queryFn: async () => (await api.get(`/vendors/${vendor.id}/services`)).data,
    retry: false,
  });

  // The questions this service asks, generated from the same rows the server
  // validates the answers against.
  const { data: context } = useQuery<BookingContext>({
    queryKey: ['service-booking-form', serviceId],
    queryFn: async () => (await api.get(`/services/${serviceId}/booking-form`)).data,
    enabled: Boolean(serviceId),
    retry: false,
  });

  const bookable = services.filter((s) => s.bookable);
  const fields = context?.bookingForm ?? [];
  const offerings = context?.offerings ?? [];
  const offering = offerings.find((o) => o.id === offeringId);
  const takesQuantity = Boolean(offering && QUANTITY_MODELS.includes(offering.pricingModel));

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

    // Checked here so a long form does not have to be sent to find out about a
    // missing guest count. The server checks all of it again regardless.
    const found = validateAnswers(fields, answers);
    setFieldErrors(found);
    if (Object.keys(found).length > 0) {
      setError('Some answers need attention.');
      return;
    }

    setBusy(true);
    try {
      const { data } = await api.post('/bookings', {
        providerType: 'vendor',
        providerId: vendor.id,
        slotId,
        requirements,
        ...(serviceId ? { vendorServiceId: serviceId } : {}),
        ...(offeringId ? { offeringId } : {}),
        ...(takesQuantity && quantity ? { quantity: Number(quantity) } : {}),
        ...(fields.length > 0 ? { serviceAnswers: cleanAnswers(fields, answers) } : {}),
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
            They have nothing free in the next six months. Message them from Chat if your date is
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
                          {/*
                            A window a caterer can still take four bookings in
                            reads very differently from one with a single place
                            left, so the buyer sees the count rather than a bare
                            time.
                          */}
                          {slot.capacity > 1 && (
                            <span className="ml-1 text-xs text-gray-500">
                              · {slot.remaining} of {slot.capacity} left
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {bookable.length > 0 && (
              <label className="block text-sm">
                <span className="text-gray-700">Which service?</span>
                <select
                  className="input mt-1"
                  value={serviceId}
                  onChange={(e) => {
                    setServiceId(e.target.value);
                    setOfferingId('');
                    setQuantity('');
                    setAnswers({});
                    setFieldErrors({});
                  }}
                  required
                >
                  <option value="">Choose…</option>
                  {bookable.map((sv) => (
                    <option key={sv.id} value={sv.id}>
                      {sv.displayName ?? sv.definition?.name ?? 'Service'}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {offerings.length > 0 && (
              <div>
                <p className="label">Pick a price</p>
                <div className="space-y-2">
                  {offerings.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setOfferingId(o.id)}
                      className={`block w-full rounded border px-3 py-2 text-left text-sm ${
                        offeringId === o.id
                          ? 'border-brand bg-brand-light'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <span className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium text-gray-900">
                          {o.name}
                          {o.isPackage && (
                            <span className="ml-2 rounded bg-brand/10 px-1.5 py-0.5 text-xs text-brand">
                              Package
                            </span>
                          )}
                        </span>
                        <span className="text-gray-700">{offeringPrice(o)}</span>
                      </span>
                      {o.description && (
                        <span className="mt-0.5 block text-xs text-gray-500">{o.description}</span>
                      )}
                      {o.inclusions.length > 0 && (
                        <span className="mt-0.5 block text-xs text-gray-500">
                          Includes: {o.inclusions.join(', ')}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {takesQuantity && offering && (
              <label className="block text-sm">
                <span className="text-gray-700">
                  How many{offering.unitLabel ? ` (${offering.unitLabel})` : ''}?
                </span>
                <input
                  className="input mt-1 max-w-[12rem]"
                  type="number"
                  min={offering.minQuantity ?? 1}
                  max={offering.maxQuantity ?? undefined}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
                {(offering.minQuantity || offering.maxQuantity) && (
                  <span className="mt-1 block text-xs text-gray-500">
                    They take
                    {offering.minQuantity ? ` from ${offering.minQuantity}` : ''}
                    {offering.maxQuantity ? ` up to ${offering.maxQuantity}` : ''}.
                  </span>
                )}
              </label>
            )}

            {/*
              The questions below are generated from the service the buyer
              picked, not written into this page. That is what replaces a
              hand-written request form per vendor type.
            */}
            {fields.length > 0 && (
              <div className="space-y-2">
                <p className="label">What they need to know</p>
                <DynamicForm
                  fields={fields}
                  answers={answers}
                  errors={fieldErrors}
                  onChange={(k, v) => setAnswers((a) => ({ ...a, [k]: v }))}
                />
              </div>
            )}

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
              <span className="text-gray-700">
                {fields.length > 0 ? 'Anything else they should know?' : 'What do you need?'}
              </span>
              <textarea
                className="input mt-1"
                rows={fields.length > 0 ? 2 : 4}
                minLength={fields.length > 0 ? undefined : 10}
                required={fields.length === 0}
                placeholder="450 guests, vegetarian, service from 7pm, two live counters."
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
              />
              <span className="mt-1 block text-xs text-gray-500">
                {fields.length > 0
                  ? 'Optional — the questions above cover the usual ground.'
                  : 'The more specific this is, the closer their quote will be to the final price.'}
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
              <button
                className="btn"
                disabled={
                  !slotId ||
                  busy ||
                  (bookable.length > 0 && !serviceId) ||
                  (offerings.length > 0 && !offeringId)
                }
              >
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

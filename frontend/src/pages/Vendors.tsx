import { FormEvent, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { Permission, VENDOR_CATEGORIES, can } from '../lib/permissions';
import { useAuth } from '../store/auth';
import DynamicForm, { Answers, FieldSpec, cleanAnswers, validateAnswers } from '../components/DynamicForm';
import { EmptyState, Loading } from '../components/ui/Feedback';
import { SealCheck, Star, Storefront } from '@phosphor-icons/react';

interface Vendor {
  id: string;
  name: string;
  category: string;
  city?: string;
  description?: string;
  ratingAvg: number;
  ratingCount: number;
  /**
   * Already on the wire and never read.
   *
   * A directory of wedding vendors with no photographs in it is a directory
   * nobody browses. The first portfolio image is the cover.
   */
  portfolio?: string[];
  /** The cheapest published offering, for a "From ₹X" line (EZ1-I164). */
  startingPrice?: number | null;
  /** Set once an officer has verified the business, for the badge (EZ1-I164). */
  verifiedAt?: string | null;
}

/** The sort options the grid offers, mirrored server-side (EZ1-I164). */
const SORTS: { value: string; label: string }[] = [
  { value: '', label: 'Recommended' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'reviews', label: 'Most reviewed' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'recent', label: 'Recently added' },
];

/** A removable active-filter pill (EZ1-I164). */
function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-1 text-xs text-gray-700">
      {label}
      <button
        type="button"
        className="text-gray-400 hover:text-gray-700"
        onClick={onClear}
        aria-label={`Clear ${label}`}
      >
        ×
      </button>
    </span>
  );
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
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('');
  const [requesting, setRequesting] = useState<Vendor | null>(null);
  // Only buyers place bookings. A planner browses this page to find and
  // recommend vendors for the weddings they run, but the couple (or their
  // agent) is who actually books — so a planner sees the listings without the
  // "Check availability" booking action (EZ1-I29).
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const canBook = can(permissions, Permission.BOOKING_CREATE);
  /*
   * A planner engaged on a wedding may raise the request for the couple
   * (EZ1-I235). The booking belongs to the couple either way; the planner is
   * recorded as who placed it, which is why this is a separate capability from
   * BOOKING_CREATE rather than a grant of it.
   */
  const canRequestForClient = can(permissions, Permission.BOOKING_REQUEST_FOR_CLIENT);
  const canAsk = canBook || canRequestForClient;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const { data, isLoading } = useQuery({
    queryKey: ['vendors', category, city, search, sort],
    queryFn: async () =>
      (
        await api.get('/vendors/search', {
          params: {
            ...(category ? { category } : {}),
            ...(city ? { city } : {}),
            ...(search ? { search } : {}),
            ...(sort ? { sort } : {}),
          },
        })
      ).data,
  });

  const vendors: Vendor[] = data?.data ?? [];
  const hasFilters = Boolean(category || city || search);
  const clearFilters = () => {
    setCategory('');
    setCity('');
    setSearch('');
  };

  /*
   * Arriving from the vendor detail page's "Send request" (EZ1-I76), open that
   * vendor's request form straight away.
   *
   * The lookup used to be `vendors.find(...)` against whatever this page had
   * loaded, and that list is filtered, sorted and paginated. A buyer who had a
   * category or city filter set, or whose vendor sat past the first page, hit
   * `undefined` — so nothing opened, nothing was said, and the click was
   * swallowed. From the buyer's side that is exactly the reported "there is no
   * way to initiate it" (EZ1-I179): the detail page tells them they may send a
   * request, and pressing the button appears to do nothing.
   *
   * Fetching the vendor by id when the list does not hold it makes the handoff
   * independent of whatever the list happens to be showing.
   */
  useEffect(() => {
    const wanted = params.get('request');
    if (!wanted || requesting) return;

    let cancelled = false;
    const open = (v: Vendor) => {
      if (cancelled) return;
      setRequesting(v);
      params.delete('request');
      setParams(params, { replace: true });
    };

    const match = vendors.find((v) => v.id === wanted);
    if (match) {
      open(match);
      return;
    }
    // Not on this page of results — ask for it directly.
    api
      .get(`/vendors/${wanted}`)
      .then((r) => open(r.data as Vendor))
      .catch(() => {
        // Withdrawn, or never visible to this account. Clear the parameter so
        // the page does not sit there looking like it is about to do something.
        if (cancelled) return;
        params.delete('request');
        setParams(params, { replace: true });
      });

    return () => {
      cancelled = true;
    };
  }, [params, vendors, requesting, setParams]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Vendors</h1>
        <p className="page-subtitle">
          Pick a window that suits you and tell them what you need. They come back with a price.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="text-gray-700">Search</span>
          <input
            className="input mt-1 max-w-[14rem]"
            value={search}
            placeholder="Vendor name"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
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
        <label className="text-sm">
          <span className="text-gray-700">Sort</span>
          <select
            className="input mt-1 max-w-xs"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Active filters, each removable on its own, with one control to clear
          the lot — so it is always visible what the grid is narrowed by. */}
      {hasFilters && (
        <div className="flex flex-wrap items-center gap-2">
          {search && <FilterChip label={`Name: ${search}`} onClear={() => setSearch('')} />}
          {city && <FilterChip label={`City: ${city}`} onClear={() => setCity('')} />}
          {category && (
            <FilterChip
              label={CATEGORY_LABEL[category] ?? category}
              onClear={() => setCategory('')}
            />
          )}
          <button className="text-sm text-brand-dark underline" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      )}

      {isLoading && <Loading rows={3} />}
      {!isLoading && vendors.length === 0 && (
        <div className="card">
          <EmptyState icon={Storefront} title="No vendors found">
            Try a different city, or clear the category and see everything that is available.
            {hasFilters && (
              <span className="mt-3 block">
                <button className="btn-outline btn-sm" onClick={clearFilters}>
                  Clear filters
                </button>
              </span>
            )}
          </EmptyState>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {vendors.map((v) => (
          <div
            key={v.id}
            className="group/vendor flex flex-col overflow-hidden rounded-lg border border-gray-200
              bg-surface transition-[border-color,box-shadow] duration-200
              hover:border-gray-300 hover:shadow-card"
          >
            {/*
              The cover. Where a vendor has uploaded nothing, the space still
              gets held: a grid where some cards have a picture and others start
              with a headline has no rhythm at all, and the empty tile is also
              honest about which vendors have bothered.
            */}
            <div className="relative aspect-[3/2] overflow-hidden bg-surface-sunken">
              {v.portfolio?.[0] ? (
                <img
                  src={v.portfolio[0]}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-500 ease-out
                    group-hover/vendor:scale-[1.03]"
                />
              ) : (
                /*
                  No photograph yet.

                  A flat grey box repeated across a grid reads as a page that
                  failed to load. One quiet jade wash and the trade's own glyph
                  says the same thing — nothing uploaded here — while still
                  giving the grid something to look at. Deliberately one tint
                  rather than one per category: a directory that changes colour
                  every tile has no accent, it has a palette.
                */
                <span className="grid h-full w-full place-items-center bg-gradient-to-br from-brand/[0.07] to-transparent text-gray-300">
                  <Storefront size={24} weight="light" aria-hidden />
                </span>
              )}
            </div>

            <div className="flex flex-1 flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="section-title truncate">{v.name}</h2>
                {v.ratingCount > 0 && (
                  <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-sm text-gray-600">
                    <Star size={13} weight="fill" className="text-caution-fg" aria-hidden />
                    <span className="font-mono">{v.ratingAvg}</span>
                    <span className="text-gray-400">({v.ratingCount})</span>
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-gray-500">
                {[CATEGORY_LABEL[v.category] ?? v.category, v.city].filter(Boolean).join(' \u00b7 ')}
              </p>
              {/* Only approved listings reach search, but a verified badge says
                  an officer actually visited — worth surfacing (EZ1-I164). */}
              {v.verifiedAt && (
                <span className="mt-1.5 inline-flex w-fit items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand-strong">
                  <SealCheck size={12} weight="fill" aria-hidden /> Verified
                </span>
              )}
              {v.description && (
                <p className="mt-2 line-clamp-2 flex-1 text-sm text-gray-600">{v.description}</p>
              )}
              {/*
                The footer is pinned to the bottom (mt-auto) so a card with no
                description keeps the same height as one with two lines, and the
                price sits directly above the actions on every tile.

                Quiet by default, accented on hover. Twelve filled buttons in a
                grid is the accent shouting from every tile at once; the action
                is still obvious, and the card that the pointer is actually on
                is the one that looks pressable.

                View details is the only action on a card now (EZ1-I226).

                A card carried a Request quote button straight into the booking
                form, so a buyer could ask a vendor for a price having seen a
                name, a city and a starting figure — not the services, the
                portfolio, the reviews or what the vendor is actually free to
                do. The request belongs after the vendor has been read, so it
                lives on the profile, where the form can also ask which service
                is wanted before showing the availability for it.
              */}
              <div className="mt-auto flex flex-col gap-2 pt-4">
                {typeof v.startingPrice === 'number' && (
                  <p className="text-sm text-gray-700">
                    From{' '}
                    <span className="font-medium">₹{v.startingPrice.toLocaleString('en-IN')}</span>
                  </p>
                )}
                <button
                  className="btn btn-sm w-full transition-colors"
                  onClick={() => navigate(`/vendors/${v.id}`)}
                >
                  View details
                </button>
                {!canAsk && (
                  <p className="rounded-sm bg-surface-sunken px-2 py-1.5 text-center text-xs text-gray-500">
                    Browse to recommend — the couple places the booking.
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/*
        Scrolled to, not just rendered. The form sits under the vendor grid, so
        a buyer handed here from a vendor's page landed at the top of a list of
        forty others with the thing they asked for somewhere off-screen
        (EZ1-I179).
      */}
      {requesting && (
        <div ref={(el) => el?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <RequestDialog vendor={requesting} onClose={() => setRequesting(null)} />
        </div>
      )}
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
  // A request without a published window (EZ1-I179): the vendor may have nothing
  // open, or none of the open windows suit, so the buyer names a date and the
  // vendor confirms. Prefilled from the detail page's date check when it arrives.
  const [eventDate, setEventDate] = useState(params.get('date') ?? '');
  const todayIso = new Date().toISOString().slice(0, 10);
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
  // The note beside the "open it" link — the partner-already-booked case says
  // something different from an ordinary duplicate (EZ1-I160).
  const [existingNote, setExistingNote] = useState('');
  const [busy, setBusy] = useState(false);
  /*
   * Whose wedding this request is for.
   *
   * Empty for a couple booking for themselves, which is every ordinary caller
   * and the reason the picker below only appears for a planner: `/events/engaged`
   * answers with the weddings this account was engaged on, and a couple is
   * engaged on none (EZ1-I235).
   */
  const [forClient, setForClient] = useState('');
  const { data: engagedClients = [] } = useQuery({
    queryKey: ['engaged-hosts'],
    queryFn: async () =>
      (await api.get('/events/engaged')).data as { userId: string; name: string }[],
    retry: false,
  });

  // What this business sells, from the catalog. A vendor who has not adopted
  // it has none, and the request falls back to the free-text form below.
  const { data: services = [], isLoading: servicesLoading } = useQuery<VendorServiceSummary[]>({
    queryKey: ['vendor-public-services', vendor.id],
    queryFn: async () => (await api.get(`/vendors/${vendor.id}/services`)).data,
    retry: false,
  });

  const bookable = services.filter((s) => s.bookable);

  // Service before availability (EZ1-I197): where the vendor has bookable
  // services, the buyer must pick one before any dates are shown — the slots
  // are that service's, and a calendar chosen before the service is a calendar
  // for the wrong thing. A vendor with no catalog has nothing to pick, so the
  // window (or the slotless date, EZ1-I179) opens straight away as before.
  const needsService = bookable.length > 0;
  const showAvailability = needsService ? Boolean(serviceId) : !servicesLoading;

  // Availability is service-specific (EZ1-I28/I32): once a service is chosen the
  // time slots are only that service's (plus any general, service-less slots),
  // so a slot published for Transport is not offered when booking Makeup. Not
  // fetched until a service is chosen where the catalog offers one (EZ1-I197).
  const { data: slots = [], isLoading } = useQuery<Slot[]>({
    queryKey: ['bookable-slots', vendor.id, serviceId],
    enabled: showAvailability,
    queryFn: async () =>
      (
        await api.get(`/vendors/${vendor.id}/availability`, {
          params: serviceId ? { vendorServiceId: serviceId } : {},
        })
      ).data,
  });

  // The questions this service asks, generated from the same rows the server
  // validates the answers against.
  const { data: context } = useQuery<BookingContext>({
    queryKey: ['service-booking-form', serviceId],
    queryFn: async () => (await api.get(`/services/${serviceId}/booking-form`)).data,
    enabled: Boolean(serviceId),
    retry: false,
  });

  const fields = context?.bookingForm ?? [];
  const offerings = context?.offerings ?? [];
  const offering = offerings.find((o) => o.id === offeringId);
  const takesQuantity = Boolean(offering && QUANTITY_MODELS.includes(offering.pricingModel));
  const selectedService = bookable.find((s) => s.id === serviceId);

  // Bookings can be tied to one event — the mehendi's makeup artist is not the
  // reception's. Absent for anyone who has not set their events up yet.
  const { data: events = [] } = useQuery<WeddingEvent[]>({
    queryKey: ['my-events'],
    queryFn: async () => (await api.get('/events')).data ?? [],
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
    setExistingNote('');

    // Checked here so a long form does not have to be sent to find out about a
    // missing guest count. The server checks all of it again regardless.
    const found = validateAnswers(fields, answers);
    setFieldErrors(found);
    if (Object.keys(found).length > 0) {
      setError('Some answers need attention.');
      return;
    }

    // A planner has to say whose wedding this is. Sending it as their own would
    // put a couple's booking on the planner's account (EZ1-I235).
    if (engagedClients.length > 0 && !forClient) {
      setError('Choose which wedding this request is for.');
      return;
    }

    setBusy(true);
    try {
      const { data } = await api.post('/bookings', {
        providerType: 'vendor',
        providerId: vendor.id,
        ...(slotId ? { slotId } : {}),
        // No published window: carry the date the buyer asked for so the vendor
        // knows which day to confirm. The server derives it from the slot when
        // one is chosen, so the two are never sent together.
        ...(!slotId && eventDate ? { eventDate } : {}),
        requirements,
        ...(serviceId ? { vendorServiceId: serviceId } : {}),
        ...(offeringId ? { offeringId } : {}),
        ...(takesQuantity && quantity ? { quantity: Number(quantity) } : {}),
        ...(fields.length > 0 ? { serviceAnswers: cleanAnswers(fields, answers) } : {}),
        ...(eventId ? { eventId } : {}),
        ...(budget ? { expectedBudget: Number(budget) } : {}),
        // Only ever sent by a planner naming an engaged couple; the server
        // refuses it from anybody else and refuses a wedding they do not run.
        ...(forClient ? { forClientUserId: forClient } : {}),
      });
      nav(`/bookings?highlight=${data.id}`);
    } catch (err) {
      const body = (err as { response?: { data?: { error?: { code?: string; bookingId?: string } } } })
        .response?.data?.error;
      if (body?.code === 'DUPLICATE_BOOKING_REQUEST' && body.bookingId) {
        setExisting(body.bookingId);
      } else if (body?.code === 'PARTNER_ALREADY_BOOKED' && body.bookingId) {
        // The couple share one wedding: the partner already holds this booking,
        // and it shows up in this account's shared Bookings list (EZ1-I160).
        setExisting(body.bookingId);
        setExistingNote('Your partner has already booked this service.');
      } else {
        setError(apiMessage(err, 'That request could not be sent.'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-surface p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="section-title">{vendor.name}</h2>
            <p className="text-sm text-gray-600">
              {CATEGORY_LABEL[vendor.category] ?? vendor.category}
              {vendor.city ? ` · ${vendor.city}` : ''}
            </p>
          </div>
          <button className="text-2xl leading-none text-gray-400" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error && <p className="mb-3 alert-critical">{error}</p>}
        {existing && (
          <div className="mb-3 alert-caution">
            {existingNote || 'You have already asked this vendor for that window.'}{' '}
            <button className="underline" onClick={() => nav(`/bookings?highlight=${existing}`)}>
              {existingNote ? 'Open the booking' : 'Open the request you already have'}
            </button>
            .
          </div>
        )}

          <form onSubmit={submit} className="space-y-4">
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
                    // The slots belong to the previous service; clear the pick so
                    // a stale slot cannot be submitted against the new service.
                    setSlotId('');
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
                      className={`block w-full rounded-sm border px-3 py-2 text-left text-sm ${
                        offeringId === o.id
                          ? 'border-brand bg-brand-light'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <span className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium text-gray-900">
                          {o.name}
                          {o.isPackage && (
                            <span className="ml-2 rounded-sm bg-brand/10 px-1.5 py-0.5 text-xs text-brand">
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

            {/* Service before availability (EZ1-I197): the dates only appear once
                the buyer has chosen what they are booking. The summary restates
                the service and its price above the calendar, and each window
                carries its own time (its duration) and, where the vendor runs
                several at once, how many places are left. Windows that are full
                or blocked never reach here — listBookable returns only the free
                ones — so every date shown is one the buyer can actually take. */}
            {showAvailability ? (
              <div>
                {selectedService && (
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 rounded-sm bg-surface-sunken px-3 py-2">
                    <span className="text-sm font-medium text-gray-900">
                      {selectedService.displayName ?? selectedService.definition?.name ?? 'Service'}
                    </span>
                    {offering && (
                      <span className="text-sm text-gray-700">{offeringPrice(offering)}</span>
                    )}
                  </div>
                )}
                <p className="label">Pick a date and time</p>
                {isLoading && <p className="text-sm text-gray-400">Checking their calendar…</p>}
                {!isLoading && slots.length > 0 && (
                  <div className="max-h-56 space-y-3 overflow-y-auto rounded-sm border border-gray-200 p-3">
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
                              onClick={() => {
                                setSlotId(slot.id);
                                setEventDate('');
                              }}
                              className={`rounded-sm border px-3 py-1.5 text-sm ${
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
                )}

                {/* Slotless request (EZ1-I179): when nothing is published, or none
                    of the windows suit, the buyer names a date and the vendor
                    confirms it. Choosing a slot above clears this and vice versa. */}
                {!isLoading && !slotId && (
                  <label className="mt-2 block text-sm">
                    <span className="text-gray-700">
                      {slots.length > 0 ? 'Or request another date' : 'Which date do you need?'}
                    </span>
                    <input
                      className="input mt-1 max-w-[12rem]"
                      type="date"
                      min={todayIso}
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                    />
                    <span className="mt-1 block text-xs text-gray-500">
                      No published window — the vendor confirms this date before you pay.
                    </span>
                  </label>
                )}
              </div>
            ) : (
              needsService && (
                <p className="rounded-sm bg-surface-sunken px-3 py-2 text-sm text-gray-500">
                  Pick a service above to see the dates and times they are free.
                </p>
              )
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
                      {ev.eventDate ? `: ${ev.eventDate}` : ''}
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
                  ? 'Optional. The questions above cover the usual ground.'
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

            {/*
              Whose wedding, asked only of somebody running one.

              A couple never sees this: /events/engaged answers empty for them.
              A planner must choose, because the booking is the couple's and
              guessing would put it on the wrong account (EZ1-I235).
            */}
            {engagedClients.length > 0 && (
              <label className="block text-sm">
                <span className="text-gray-700">Requesting for</span>
                <select
                  className="input mt-1"
                  value={forClient}
                  onChange={(e) => setForClient(e.target.value)}
                >
                  <option value="">Choose the wedding…</option>
                  {engagedClients.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-gray-500">
                  The booking belongs to them and is paid by them. You are recorded as having
                  placed it.
                </span>
              </label>
            )}

            <div className="flex gap-2">
              <button
                className="btn"
                disabled={
                  (!slotId && !eventDate) ||
                  busy ||
                  (engagedClients.length > 0 && !forClient) ||
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
      </div>
    </div>
  );
}

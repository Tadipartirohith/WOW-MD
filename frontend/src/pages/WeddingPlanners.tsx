import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { Permission, can } from '../lib/permissions';
import ClientSelector from '../components/ClientSelector';
import { Loading } from '../components/ui/Feedback';

interface PlannerPackage {
  name: string;
  price: number;
  includes?: string[];
}

interface Planner {
  id: string;
  agencyName: string;
  city?: string;
  bio?: string;
  yearsExperience: number;
  ratingAvg: number;
  ratingCount: number;
  servesCities?: string[];
  packages?: PlannerPackage[];
  portfolio?: string[];
  website?: string | null;
  contactPerson?: string | null;
}

/**
 * Hire a Wedding Planner.
 *
 * The flow mirrors the vendor one (EZ1-I113): a buyer explores the planners,
 * opens one to read the full profile — experience, the areas they cover, their
 * packages and portfolio — and only then requests a booking, rather than the
 * grid asking for a booking on sight. The page itself is a clean set of cards
 * with a budget and city filter (EZ1-I95).
 */
export default function WeddingPlanners() {
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isAgent = can(permissions, Permission.CLIENT_ACT_ON_BEHALF);
  const canBook = can(permissions, Permission.BOOKING_CREATE);

  const [cityInput, setCityInput] = useState('');
  const [city, setCity] = useState('');
  const [onBehalfOf, setOnBehalfOf] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['planners', city],
    queryFn: async () =>
      (await api.get('/wedding-planners/search', { params: city ? { city } : {} })).data,
  });

  async function book(plannerId: string, eventDate?: string) {
    setBusy(plannerId);
    setMessage('');
    try {
      const payload: Record<string, unknown> = { providerType: 'planner', providerId: plannerId };
      // An empty budget means "quote me" — the planner prices the job, so a
      // number is never invented on the client's behalf.
      const quoted = Number(amount);
      if (amount.trim() && Number.isFinite(quoted) && quoted > 0) payload.amount = quoted;
      // The date the buyer checked availability for travels with the request (EZ1-I113).
      if (eventDate) payload.eventDate = eventDate;
      if (isAgent && onBehalfOf) payload.onBehalfOfUserId = onBehalfOf;
      await api.post('/bookings', payload);
      setOpenId(null);
      setMessage('Booking requested. Pay to move it into escrow from the Bookings page.');
    } catch (err) {
      const msg = (err as AxiosError<{ message?: string | string[] }>).response?.data?.message;
      setMessage(Array.isArray(msg) ? msg.join('. ') : msg || 'Could not create the booking.');
    } finally {
      setBusy('');
    }
  }

  const planners: Planner[] = data?.data ?? [];
  const open = planners.find((p) => p.id === openId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Hire a Wedding Planner</h1>
        <p className="page-subtitle">
          Browse approved planners, open one to see their experience, packages and portfolio, then
          request a booking. The planner quotes you unless you set a budget.
        </p>
      </div>

      {/* Budget and city filters with a prominent search button (EZ1-I95). */}
      <div className="card flex flex-wrap items-end gap-3">
        {isAgent && <ClientSelector value={onBehalfOf} onChange={setOnBehalfOf} />}
        <div>
          <label className="label">
            Your budget <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            className="input max-w-[10rem]"
            type="number"
            min={1}
            placeholder="Leave blank"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="flex-1 min-w-[12rem]">
          <label className="label">City</label>
          <input
            className="input max-w-xs"
            value={cityInput}
            onChange={(e) => setCityInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setCity(cityInput.trim())}
            placeholder="Any city"
          />
        </div>
        <button className="btn shrink-0" onClick={() => setCity(cityInput.trim())}>
          Search planners
        </button>
      </div>

      {message && <p className="rounded-sm bg-brand-light p-3 text-sm text-brand-dark">{message}</p>}
      {isLoading && <Loading rows={3} />}
      {!isLoading && planners.length === 0 && (
        <div className="card text-center text-gray-500">
          No approved planners match that search. Try a different city or clear the filter.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {planners.map((p) => {
          const fromPrice = (p.packages?.length ?? 0) > 0
            ? Math.min(...p.packages!.map((k) => k.price))
            : null;
          return (
          <div
            key={p.id}
            className="card flex flex-col overflow-hidden p-0 transition-[border-color,box-shadow] duration-200 hover:border-gray-300 hover:shadow-card"
          >
            {/* A cover, so the grid reads as a set of businesses rather than a
                list of names (EZ1-I95). Portfolio first, initial as the fallback. */}
            <div className="relative aspect-[16/9] bg-surface-sunken">
              {p.portfolio?.[0] ? (
                <img src={p.portfolio[0]} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="grid h-full w-full place-items-center text-3xl font-semibold text-gray-300">
                  {p.agencyName.slice(0, 1).toUpperCase()}
                </span>
              )}
              {p.ratingCount > 0 && (
                <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
                  ★ {p.ratingAvg.toFixed(1)} ({p.ratingCount})
                </span>
              )}
            </div>
            <div className="flex flex-1 flex-col p-4">
              <h2 className="section-title">{p.agencyName}</h2>
              <p className="text-sm text-gray-500">
                {p.city}
                {p.yearsExperience ? ` · ${p.yearsExperience} yrs experience` : ''}
              </p>
              {p.bio && <p className="mt-2 line-clamp-2 text-sm text-gray-600">{p.bio}</p>}
              <div className="mt-2 flex-1">
                {(p.packages?.length ?? 0) > 0 ? (
                  <p className="text-xs text-gray-500">
                    {p.packages!.length} package{p.packages!.length === 1 ? '' : 's'}
                    {fromPrice !== null ? ` · from ₹${fromPrice.toLocaleString('en-IN')}` : ''}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400">Pricing on request</p>
                )}
              </div>
              <button className="btn mt-4 w-full" onClick={() => setOpenId(p.id)}>
                View profile &amp; availability
              </button>
            </div>
          </div>
          );
        })}
      </div>

      {open && (
        <PlannerDetail
          planner={open}
          canBook={canBook}
          busy={busy === open.id}
          onClose={() => setOpenId(null)}
          onBook={(date) => book(open.id, date)}
        />
      )}
    </div>
  );
}

/**
 * A planner's full profile, opened from the grid — the explore step the vendor
 * flow has and this page was missing (EZ1-I113). The booking action lives here,
 * after the buyer has seen who they are hiring.
 */
interface BookableSlot {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  remaining: number;
}

function PlannerDetail({
  planner,
  canBook,
  busy,
  onClose,
  onBook,
}: {
  planner: Planner;
  canBook: boolean;
  busy: boolean;
  onClose: () => void;
  onBook: (eventDate?: string) => void;
}) {
  // The full record, so packages/portfolio are shown even if the search
  // projection trimmed them.
  const { data } = useQuery({
    queryKey: ['planner', planner.id],
    queryFn: async () => (await api.get(`/wedding-planners/${planner.id}`)).data as Planner,
    initialData: planner,
  });
  const p = data ?? planner;

  // Availability-first: the buyer names a date, checks whether the planner is
  // free, and only then requests — the same path the vendor flow has (EZ1-I113).
  const [date, setDate] = useState('');
  const [checkedDate, setCheckedDate] = useState('');
  const {
    data: slots,
    isFetching: checking,
    refetch: check,
  } = useQuery({
    queryKey: ['planner-availability', planner.id, date],
    enabled: false,
    queryFn: async () =>
      (
        await api.get(`/wedding-planners/${planner.id}/availability/bookable`, {
          params: { from: date, to: date },
        })
      ).data as BookableSlot[],
  });
  const daySlots = (slots ?? []).filter((s) => s.date === checkedDate && s.remaining > 0);
  const hasChecked = Boolean(checkedDate);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-2xl rounded-lg bg-surface p-6">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="section-title">{p.agencyName}</h2>
            <p className="text-sm text-gray-500">
              {p.city}
              {p.yearsExperience ? ` · ${p.yearsExperience} yrs experience` : ''}
              {p.ratingCount > 0 ? ` · ★ ${p.ratingAvg.toFixed(1)} (${p.ratingCount})` : ''}
            </p>
          </div>
          <button className="text-sm text-gray-500 underline" onClick={onClose}>
            Close
          </button>
        </div>

        {p.bio && <p className="text-sm text-gray-700">{p.bio}</p>}

        {(p.servesCities?.length ?? 0) > 0 && (
          <p className="mt-3 text-sm text-gray-600">
            <span className="font-medium text-gray-800">Serves:</span> {p.servesCities!.join(', ')}
          </p>
        )}

        {(p.packages?.length ?? 0) > 0 && (
          <div className="mt-3">
            <h3 className="section-title text-sm">Packages</h3>
            <ul className="mt-1 space-y-1 text-sm">
              {p.packages!.map((k, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 border-b py-1">
                  <span>
                    {k.name}
                    {k.includes?.length ? (
                      <span className="ml-1 text-xs text-gray-400">
                        · {k.includes.join(', ')}
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular-nums text-gray-700">
                    ₹{Number(k.price).toLocaleString('en-IN')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(p.portfolio?.length ?? 0) > 0 && (
          <div className="mt-3">
            <h3 className="section-title text-sm">Portfolio</h3>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {p.portfolio!.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  <img src={url} alt="" loading="lazy" className="aspect-square w-full rounded-sm object-cover" />
                </a>
              ))}
            </div>
          </div>
        )}

        {p.website && (
          <p className="mt-3 text-sm">
            <a className="text-brand underline" href={p.website} target="_blank" rel="noreferrer">
              Visit website
            </a>
          </p>
        )}

        {canBook ? (
          <div className="mt-5 space-y-3 border-t border-gray-200 pt-4">
            <h3 className="section-title text-sm">Check availability</h3>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="block text-gray-600">Event date</span>
                <input
                  className="input mt-1"
                  type="date"
                  min={new Date().toISOString().slice(0, 10)}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <button
                className="btn-outline"
                disabled={!date || checking}
                onClick={async () => {
                  await check();
                  setCheckedDate(date);
                }}
              >
                {checking ? 'Checking…' : 'Check availability'}
              </button>
            </div>

            {hasChecked && !checking && (
              <div className="rounded-sm bg-surface-sunken p-3 text-sm">
                {daySlots.length > 0 ? (
                  <p className="text-emerald-700">
                    Available on {new Date(checkedDate).toLocaleDateString()} —{' '}
                    {daySlots.reduce((n, s) => n + s.remaining, 0)} opening
                    {daySlots.reduce((n, s) => n + s.remaining, 0) === 1 ? '' : 's'} left.
                  </p>
                ) : (
                  <p className="text-gray-600">
                    No published opening on {new Date(checkedDate).toLocaleDateString()}. You can
                    still send a request and the planner will confirm.
                  </p>
                )}
              </div>
            )}

            <button
              className="btn w-full"
              disabled={busy || !hasChecked}
              onClick={() => onBook(checkedDate || undefined)}
            >
              {busy ? 'Requesting…' : 'Request booking'}
            </button>
            {!hasChecked && (
              <p className="text-xs text-gray-400">
                Check a date first, so your request carries the day you need.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-5 text-sm text-gray-500">
            Sign in as an individual or agent to request a booking.
          </p>
        )}
      </div>
    </div>
  );
}

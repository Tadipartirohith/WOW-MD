import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowClockwise,
  CalendarBlank,
  ClipboardText,
  Heart,
  MapPin,
  MagnifyingGlass,
  SealCheck,
  SlidersHorizontal,
  Star,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { Permission, can } from '../lib/permissions';
import ClientSelector from '../components/ClientSelector';
import { EmptyState, LoadingCards } from '../components/ui/Feedback';

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
  createdAt?: string;
}

interface BookableSlot {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  remaining: number;
}

const PAGE_SIZE = 12;

const SORTS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'experience', label: 'Most experienced' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'recent', label: 'Recently added' },
] as const;

type Sort = (typeof SORTS)[number]['value'];

const SHORTLIST_KEY = 'wow:planner-shortlist';

/** The lowest package price, or null when the planner quotes per job. */
function startingPrice(p: Planner): number | null {
  const prices = (p.packages ?? []).map((k) => k.price).filter((n) => Number.isFinite(n));
  return prices.length ? Math.min(...prices) : null;
}

function readShortlist(): Set<string> {
  try {
    const raw = localStorage.getItem(SHORTLIST_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/**
 * Hire a Wedding Planner — the listing, rebuilt for comparison (EZ1-I165).
 *
 * A couple lands here to line planners up against one another, so the page is a
 * grid of equal-height cards that each answer the same questions in the same
 * places — who they are, whether they are verified, how they rate, what they
 * cost, whether they are free on the day — with a filter bar and a sort above.
 * The explore-then-book flow from EZ1-I113 is unchanged: a card opens the full
 * profile, and the booking request still lives there, after the buyer has read
 * who they are hiring.
 */
export default function WeddingPlanners() {
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isAgent = can(permissions, Permission.CLIENT_ACT_ON_BEHALF);
  const canBook = can(permissions, Permission.BOOKING_CREATE);

  // City and rating are the two filters the server understands; everything
  // else below refines the loaded set on the client (the search endpoint takes
  // neither a budget nor an experience floor).
  const [cityInput, setCityInput] = useState('');
  const [city, setCity] = useState('');
  const [minRating, setMinRating] = useState(0);

  // Client-side refinements.
  const [weddingDate, setWeddingDate] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [minYears, setMinYears] = useState(0);
  const [sort, setSort] = useState<Sort>('recommended');

  const [pages, setPages] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [shortlist, setShortlist] = useState<Set<string>>(readShortlist);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['planners', city, minRating, pages],
    queryFn: async () =>
      (
        await api.get('/wedding-planners/search', {
          params: {
            ...(city ? { city } : {}),
            ...(minRating ? { minRating } : {}),
            page: 1,
            limit: PAGE_SIZE * pages,
          },
        })
      ).data as { data: Planner[]; meta: { total: number } },
  });

  const planners = useMemo(() => data?.data ?? [], [data]);
  const total = data?.meta.total ?? 0;

  function toggleShortlist(id: string) {
    setShortlist((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try {
        localStorage.setItem(SHORTLIST_KEY, JSON.stringify([...next]));
      } catch {
        /* a private window without storage still gets the in-memory toggle */
      }
      return next;
    });
  }

  function clearAll() {
    setCityInput('');
    setCity('');
    setMinRating(0);
    setWeddingDate('');
    setBudgetMin('');
    setBudgetMax('');
    setMinYears(0);
    setSort('recommended');
    setPages(1);
  }

  // The drawer holds the filters the server does not surface in the bar:
  // rating and an experience floor. Budget lives in the bar. Count what is
  // active so the button can say so.
  const drawerActive = (minRating > 0 ? 1 : 0) + (minYears > 0 ? 1 : 0);

  const visible = useMemo(() => {
    const min = Number(budgetMin) || 0;
    const max = Number(budgetMax) || Infinity;
    const rows = planners.filter((p) => {
      if (minYears && (p.yearsExperience ?? 0) < minYears) return false;
      const price = startingPrice(p);
      // A planner who quotes per job has no number to compare, so a budget
      // range never hides them — only a listed price outside it does.
      if (price !== null && (price < min || price > max)) return false;
      return true;
    });
    const withPrice = (p: Planner) => startingPrice(p) ?? Infinity;
    const sorted = [...rows];
    switch (sort) {
      case 'rating':
        sorted.sort((a, b) => b.ratingAvg - a.ratingAvg);
        break;
      case 'experience':
        sorted.sort((a, b) => (b.yearsExperience ?? 0) - (a.yearsExperience ?? 0));
        break;
      case 'price_asc':
        sorted.sort((a, b) => withPrice(a) - withPrice(b));
        break;
      case 'price_desc':
        // Priced planners high-to-low; quote-only ones (no number) trail.
        sorted.sort((a, b) => {
          const pa = startingPrice(a);
          const pb = startingPrice(b);
          if (pa === null) return pb === null ? 0 : 1;
          if (pb === null) return -1;
          return pb - pa;
        });
        break;
      case 'recent':
        sorted.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
        break;
      default:
        break; // 'recommended' keeps the server's rating-first order
    }
    return sorted;
  }, [planners, budgetMin, budgetMax, minYears, sort]);

  const open = planners.find((p) => p.id === openId) ?? null;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="page-title">Hire a Wedding Planner</h1>
        <p className="page-subtitle">
          Compare approved planners side by side — ratings, experience and pricing at a glance —
          then open one to see their packages, portfolio and availability before you request.
        </p>
      </header>

      {/* Search and filter bar. */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[10rem] flex-1">
            <label className="label" htmlFor="planner-city">
              City
            </label>
            <input
              id="planner-city"
              className="input"
              value={cityInput}
              onChange={(e) => setCityInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setCity(cityInput.trim());
                  setPages(1);
                }
              }}
              placeholder="Any city"
            />
          </div>
          <div>
            <label className="label" htmlFor="planner-date">
              Wedding date
            </label>
            <input
              id="planner-date"
              className="input"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={weddingDate}
              onChange={(e) => setWeddingDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Budget (₹)</label>
            <div className="flex items-center gap-2">
              <input
                className="input max-w-[7rem]"
                type="number"
                min={0}
                placeholder="Min"
                aria-label="Minimum budget"
                value={budgetMin}
                onChange={(e) => setBudgetMin(e.target.value)}
              />
              <span className="text-gray-400">–</span>
              <input
                className="input max-w-[7rem]"
                type="number"
                min={0}
                placeholder="Max"
                aria-label="Maximum budget"
                value={budgetMax}
                onChange={(e) => setBudgetMax(e.target.value)}
              />
            </div>
          </div>
          <button
            className="btn-outline relative"
            onClick={() => setDrawerOpen(true)}
            aria-haspopup="dialog"
          >
            <SlidersHorizontal size={16} aria-hidden />
            Filters
            {drawerActive > 0 && (
              <span className="ml-1 rounded-full bg-brand px-1.5 text-xs font-semibold text-brand-fg">
                {drawerActive}
              </span>
            )}
          </button>
          <button
            className="btn"
            onClick={() => {
              setCity(cityInput.trim());
              setPages(1);
            }}
          >
            <MagnifyingGlass size={16} aria-hidden />
            Search
          </button>
          <button className="btn-ghost" onClick={clearAll}>
            Clear all
          </button>
        </div>
      </div>

      {message && (
        <p className="alert-positive" role="status">
          {message}
        </p>
      )}

      {/* Result summary and sort. */}
      {!isLoading && !isError && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{total}</span> planner
            {total === 1 ? '' : 's'} found
          </p>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Sort
            <select
              className="input max-w-[13rem] py-2"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {isLoading && <LoadingCards count={6} />}

      {isError && (
        <div className="card">
          <EmptyState icon={WarningCircle} title="We could not load planners">
            Something went wrong reaching the directory.
            <div className="mt-4">
              <button className="btn-outline" onClick={() => refetch()}>
                <ArrowClockwise size={16} aria-hidden />
                Try again
              </button>
            </div>
          </EmptyState>
        </div>
      )}

      {!isLoading && !isError && visible.length === 0 && (
        <div className="card">
          <EmptyState icon={ClipboardText} title="No planners found">
            Nothing matches these filters. Widen the budget, clear the drawer, or browse everyone.
            <div className="mt-4">
              <button className="btn-outline" onClick={clearAll}>
                Clear filters
              </button>
            </div>
          </EmptyState>
        </div>
      )}

      {!isLoading && !isError && visible.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((p) => (
              <PlannerCard
                key={p.id}
                planner={p}
                weddingDate={weddingDate}
                shortlisted={shortlist.has(p.id)}
                onToggleShortlist={() => toggleShortlist(p.id)}
                onOpen={() => setOpenId(p.id)}
              />
            ))}
          </div>

          {planners.length < total && (
            <div className="flex flex-col items-center gap-2 pt-2">
              <p className="text-sm text-gray-500">
                Showing {planners.length} of {total}
              </p>
              <button
                className="btn-outline"
                disabled={isFetching}
                onClick={() => setPages((n) => n + 1)}
              >
                {isFetching ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}

      {/* Filters drawer: a bottom-sheet on mobile, a side panel on desktop. */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-scrim/40 sm:items-stretch sm:justify-end"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full overflow-y-auto rounded-t-lg bg-surface p-5
              sm:h-full sm:max-h-none sm:max-w-sm sm:rounded-none"
            role="dialog"
            aria-label="Filters"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="section-title">Filters</h2>
              <button
                className="text-gray-400 hover:text-gray-700"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close filters"
              >
                <X size={20} aria-hidden />
              </button>
            </div>

            <div className="space-y-5">
              <div>
                <label className="label" htmlFor="filter-rating">
                  Minimum rating
                </label>
                <select
                  id="filter-rating"
                  className="input"
                  value={minRating}
                  onChange={(e) => {
                    setMinRating(Number(e.target.value));
                    setPages(1);
                  }}
                >
                  <option value={0}>Any rating</option>
                  <option value={3}>3★ and up</option>
                  <option value={4}>4★ and up</option>
                  <option value={4.5}>4.5★ and up</option>
                </select>
              </div>

              <div>
                <label className="label" htmlFor="filter-years">
                  Minimum experience
                </label>
                <select
                  id="filter-years"
                  className="input"
                  value={minYears}
                  onChange={(e) => setMinYears(Number(e.target.value))}
                >
                  <option value={0}>Any experience</option>
                  <option value={2}>2+ years</option>
                  <option value={5}>5+ years</option>
                  <option value={10}>10+ years</option>
                </select>
              </div>
            </div>

            <div className="mt-6 flex gap-2">
              <button className="btn flex-1" onClick={() => setDrawerOpen(false)}>
                Show {visible.length} planner{visible.length === 1 ? '' : 's'}
              </button>
              <button
                className="btn-outline"
                onClick={() => {
                  setMinRating(0);
                  setMinYears(0);
                  setPages(1);
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <PlannerDetail
          planner={open}
          canBook={canBook}
          isAgent={isAgent}
          initialDate={weddingDate}
          onClose={() => setOpenId(null)}
          onBooked={(msg) => {
            setOpenId(null);
            setMessage(msg);
          }}
        />
      )}
    </div>
  );
}

/**
 * One planner in the grid. Self-contained so it can check its own availability
 * for the chosen date without the parent firing one query per card up front.
 */
function PlannerCard({
  planner: p,
  weddingDate,
  shortlisted,
  onToggleShortlist,
  onOpen,
}: {
  planner: Planner;
  weddingDate: string;
  shortlisted: boolean;
  onToggleShortlist: () => void;
  onOpen: () => void;
}) {
  const fromPrice = startingPrice(p);
  const tags = (p.packages ?? []).map((k) => k.name).filter(Boolean);
  const shownTags = tags.slice(0, 3);
  const extraTags = tags.length - shownTags.length;

  // Availability is only asked for once a date is on the table — the endpoint
  // is per-planner, so nothing fires until the couple has named a day.
  const { data: slots, isFetching } = useQuery({
    queryKey: ['planner-card-availability', p.id, weddingDate],
    enabled: Boolean(weddingDate),
    staleTime: 60_000,
    queryFn: async () =>
      (
        await api.get(`/wedding-planners/${p.id}/availability/bookable`, {
          params: { from: weddingDate, to: weddingDate },
        })
      ).data as BookableSlot[],
  });
  const remaining = (slots ?? [])
    .filter((s) => s.date === weddingDate)
    .reduce((n, s) => n + s.remaining, 0);

  return (
    <article
      className="group flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-surface
        transition-[border-color,box-shadow] duration-200 hover:border-gray-300 hover:shadow-card"
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-surface-sunken">
        {p.portfolio?.[0] ? (
          <img
            src={p.portfolio[0]}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 ease-out
              group-hover:scale-[1.03]"
          />
        ) : (
          <span className="grid h-full w-full place-items-center bg-gradient-to-br from-brand/[0.07] to-transparent text-3xl font-semibold text-gray-300">
            {p.agencyName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="pill-brand absolute left-2 top-2 bg-surface/90 backdrop-blur">
          <SealCheck size={13} weight="fill" aria-hidden />
          Verified
        </span>
        <button
          className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-surface/90
            text-gray-500 shadow-btn backdrop-blur transition-colors hover:text-brand"
          onClick={onToggleShortlist}
          aria-pressed={shortlisted}
          aria-label={shortlisted ? 'Remove from shortlist' : 'Add to shortlist'}
          title={shortlisted ? 'Remove from shortlist' : 'Add to shortlist'}
        >
          <Heart
            size={17}
            weight={shortlisted ? 'fill' : 'regular'}
            className={shortlisted ? 'text-brand' : ''}
            aria-hidden
          />
        </button>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="section-title truncate">{p.agencyName}</h2>
          {p.ratingCount > 0 && (
            <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-sm text-gray-600">
              <Star size={13} weight="fill" className="text-caution-fg" aria-hidden />
              <span className="font-mono">{p.ratingAvg.toFixed(1)}</span>
              <span className="text-gray-400">({p.ratingCount})</span>
            </span>
          )}
        </div>

        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-gray-500">
          {p.city && (
            <span className="inline-flex items-center gap-1">
              <MapPin size={13} aria-hidden />
              {p.city}
            </span>
          )}
          {p.yearsExperience > 0 && (
            <>
              {p.city && <span aria-hidden>·</span>}
              <span>{p.yearsExperience} yrs experience</span>
            </>
          )}
        </p>

        {shownTags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {shownTags.map((t, i) => (
              <span key={i} className="pill-neutral max-w-full truncate">
                {t}
              </span>
            ))}
            {extraTags > 0 && <span className="pill-neutral">+{extraTags} more</span>}
          </div>
        )}

        <div className="mt-3">
          <AvailabilityChip date={weddingDate} checking={isFetching} remaining={remaining} />
        </div>

        <div className="mt-3 flex-1" />

        <p className="text-sm">
          {fromPrice !== null ? (
            <>
              <span className="text-gray-500">Starting from </span>
              <span className="font-semibold text-gray-900">
                ₹{fromPrice.toLocaleString('en-IN')}
              </span>
            </>
          ) : (
            <span className="text-gray-500">Pricing on request</span>
          )}
        </p>

        <button
          className="btn-outline btn-sm mt-3 w-full transition-colors
            group-hover:border-brand group-hover:text-brand-strong"
          onClick={onOpen}
        >
          View Profile &amp; Availability
        </button>
      </div>
    </article>
  );
}

/**
 * The availability chip, driven by the date picked in the bar.
 *
 * The bookable endpoint only ever returns openings a buyer can actually take,
 * so a positive answer is trustworthy. Its silence is not: no published opening
 * can mean "fully booked" or "has not published a calendar", and those are not
 * the same claim — so an empty answer degrades to a neutral "on request" rather
 * than a false "unavailable" (EZ1-I165).
 */
function AvailabilityChip({
  date,
  checking,
  remaining,
}: {
  date: string;
  checking: boolean;
  remaining: number;
}) {
  if (!date) {
    return (
      <span className="pill-neutral" title="Select a wedding date to check availability">
        <CalendarBlank size={13} aria-hidden />
        Select a date to check availability
      </span>
    );
  }
  if (checking) {
    return (
      <span className="pill-neutral">
        <CalendarBlank size={13} aria-hidden />
        Checking availability…
      </span>
    );
  }
  if (remaining >= 3) {
    return <span className="pill-positive">Available on your date</span>;
  }
  if (remaining > 0) {
    return <span className="pill-caution">Limited availability</span>;
  }
  return (
    <span
      className="pill-neutral"
      title="No published opening — the planner can still confirm on request"
    >
      Availability on request
    </span>
  );
}

/**
 * A planner's full profile, opened from the grid — the explore step of the
 * flow (EZ1-I113). The booking action lives here, after the buyer has seen who
 * they are hiring, and carries the date they checked (and, for an agent, the
 * client and budget) into the request.
 */
function PlannerDetail({
  planner,
  canBook,
  isAgent,
  initialDate,
  onClose,
  onBooked,
}: {
  planner: Planner;
  canBook: boolean;
  isAgent: boolean;
  initialDate: string;
  onClose: () => void;
  onBooked: (message: string) => void;
}) {
  // The full record, so packages/portfolio show even if search trimmed them.
  const { data } = useQuery({
    queryKey: ['planner', planner.id],
    queryFn: async () => (await api.get(`/wedding-planners/${planner.id}`)).data as Planner,
    initialData: planner,
  });
  const p = data ?? planner;

  const [date, setDate] = useState(initialDate);
  const [checkedDate, setCheckedDate] = useState('');
  const [amount, setAmount] = useState('');
  const [onBehalfOf, setOnBehalfOf] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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

  async function book() {
    setBusy(true);
    setError('');
    try {
      const payload: Record<string, unknown> = { providerType: 'planner', providerId: planner.id };
      // An empty budget means "quote me" — the planner prices the job, so a
      // number is never invented on the client's behalf.
      const quoted = Number(amount);
      if (amount.trim() && Number.isFinite(quoted) && quoted > 0) payload.amount = quoted;
      if (checkedDate) payload.eventDate = checkedDate;
      if (isAgent && onBehalfOf) payload.onBehalfOfUserId = onBehalfOf;
      await api.post('/bookings', payload);
      onBooked('Booking requested. Pay to move it into escrow from the Bookings page.');
    } catch (err) {
      setError(apiMessage(err, 'Could not create the booking.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-scrim/40 p-4">
      <div className="my-8 w-full max-w-2xl rounded-lg bg-surface p-6">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="section-title flex items-center gap-2">
              {p.agencyName}
              <span className="pill-brand">
                <SealCheck size={13} weight="fill" aria-hidden />
                Verified
              </span>
            </h2>
            <p className="text-sm text-gray-500">
              {p.city}
              {p.yearsExperience ? ` · ${p.yearsExperience} yrs experience` : ''}
              {p.ratingCount > 0 ? ` · ★ ${p.ratingAvg.toFixed(1)} (${p.ratingCount})` : ''}
            </p>
          </div>
          <button className="text-gray-400 hover:text-gray-700" onClick={onClose} aria-label="Close">
            <X size={20} aria-hidden />
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
                      <span className="ml-1 text-xs text-gray-400">· {k.includes.join(', ')}</span>
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
                  <img
                    src={url}
                    alt=""
                    loading="lazy"
                    className="aspect-square w-full rounded-sm object-cover"
                  />
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
            {isAgent && <ClientSelector value={onBehalfOf} onChange={setOnBehalfOf} />}
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

            <label className="block text-sm">
              <span className="text-gray-600">
                Your budget <span className="text-gray-400">(optional)</span>
              </span>
              <input
                className="input mt-1 max-w-[12rem]"
                type="number"
                min={1}
                placeholder="Leave blank to be quoted"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>

            {error && <p className="alert-critical">{error}</p>}

            <button className="btn w-full" disabled={busy || !hasChecked} onClick={book}>
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

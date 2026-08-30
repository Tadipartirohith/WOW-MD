import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { Loading } from '../components/ui/Feedback';

interface Destination {
  id: string;
  name: string;
  country?: string;
  description?: string;
  imageUrl?: string;
  tags: string[];
}

interface Package {
  id: string;
  title: string;
  price: string;
  nights: number;
  inclusions: string[];
  destinationId: string;
  destinationName: string;
  country: string | null;
  imageUrl: string | null;
  destinationDescription: string | null;
  tags: string[];
}

interface Itinerary {
  id: string;
  title: string;
  packageId: string | null;
  items: { day: number; title: string }[];
}

/**
 * Honeymoon and travel.
 *
 * Shopping starts from the two things a couple actually knows — roughly what
 * they can spend and roughly how long they can be away — and the destination is
 * the answer rather than the first question. Choosing a package seeds an
 * itinerary with a day per night, because an empty itinerary is where planning
 * stops.
 */
export default function Travel() {
  const qc = useQueryClient();
  const [tag, setTag] = useState('honeymoon');
  const [maxPrice, setMaxPrice] = useState('');
  const [minNights, setMinNights] = useState('');
  const [maxNights, setMaxNights] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const { data: destinations = [] } = useQuery({
    queryKey: ['destinations'],
    queryFn: async () => (await api.get('/travel/destinations')).data as Destination[],
  });

  const { data: packages = [], isLoading } = useQuery({
    queryKey: ['packages', tag, maxPrice, minNights, maxNights],
    queryFn: async () =>
      (
        await api.get('/travel/packages', {
          params: {
            ...(tag ? { tag } : {}),
            ...(maxPrice ? { maxPrice: Number(maxPrice) } : {}),
            ...(minNights ? { minNights: Number(minNights) } : {}),
            ...(maxNights ? { maxNights: Number(maxNights) } : {}),
          },
        })
      ).data as Package[],
  });

  const { data: itineraries = [] } = useQuery({
    queryKey: ['itineraries'],
    queryFn: async () => (await api.get('/travel/itineraries')).data as Itinerary[],
  });

  // Every tag anyone has used, so the chips reflect the actual catalogue rather
  // than a hard-coded list that drifts out of date.
  const tags = [...new Set(destinations.flatMap((d) => d.tags ?? []))].sort();

  async function planFrom(pkg: Package) {
    setError('');
    try {
      await api.post('/travel/itineraries', {
        title: `${pkg.destinationName}: ${pkg.title}`,
        packageId: pkg.id,
        items: Array.from({ length: pkg.nights }, (_, i) => ({
          day: i + 1,
          title: `Day ${i + 1}`,
        })),
      });
      qc.invalidateQueries({ queryKey: ['itineraries'] });
    } catch (err) {
      setError(apiMessage(err, 'That itinerary could not be started.'));
    }
  }

  async function createBlank(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/travel/itineraries', { title, items: [] });
      setTitle('');
      qc.invalidateQueries({ queryKey: ['itineraries'] });
    } catch (err) {
      setError(apiMessage(err, 'That itinerary could not be saved.'));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Honeymoon</h1>
        <p className="page-subtitle">
          Start from your budget and the time you have. Picking a package opens an itinerary with a
          day for every night.
        </p>
      </div>

      {error && <p className="alert-critical">{error}</p>}

      <div className="card space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            className={chip(tag === '')}
            onClick={() => setTag('')}
          >
            Everything
          </button>
          {tags.map((t) => (
            <button key={t} className={chip(tag === t)} onClick={() => setTag(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="grid gap-3 border-t pt-3 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="text-gray-700">Budget up to (₹)</span>
            <input
              className="input mt-1"
              type="number"
              min={0}
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">At least (nights)</span>
            <input
              className="input mt-1"
              type="number"
              min={1}
              value={minNights}
              onChange={(e) => setMinNights(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">At most (nights)</span>
            <input
              className="input mt-1"
              type="number"
              min={1}
              value={maxNights}
              onChange={(e) => setMaxNights(e.target.value)}
            />
          </label>
        </div>
      </div>

      {isLoading && <Loading rows={3} />}
      {!isLoading && packages.length === 0 && (
        <p className="card text-sm text-gray-500">
          Nothing matches that. Widen the budget or the dates, or clear the filters to see the
          whole catalogue.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {packages.map((p) => (
          <div key={p.id} className="card flex flex-col overflow-hidden p-0">
            {p.imageUrl && (
              <img src={p.imageUrl} alt="" className="h-36 w-full object-cover" loading="lazy" />
            )}
            <div className="flex flex-1 flex-col p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400">
                {p.destinationName}
                {p.country ? `, ${p.country}` : ''}
              </p>
              <h2 className="section-title">{p.title}</h2>
              <p className="text-sm text-gray-600">
                {p.nights} night{p.nights === 1 ? '' : 's'}
              </p>
              {p.inclusions?.length > 0 && (
                <ul className="mt-2 flex-1 space-y-0.5 text-sm text-gray-600">
                  {p.inclusions.slice(0, 4).map((inc, i) => (
                    <li key={i}>· {inc}</li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex items-center justify-between">
                <p
                  className="text-lg font-semibold text-gray-900"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  ₹{Number(p.price).toLocaleString('en-IN')}
                </p>
                <button className="btn" onClick={() => planFrom(p)}>
                  Start planning
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="section-title mb-2">Your itineraries</h2>
          <div className="divide-y">
            {itineraries.map((it) => (
              <div key={it.id} className="py-2">
                <p className="text-sm font-medium text-gray-900">{it.title}</p>
                <p className="text-xs text-gray-500">
                  {it.items?.length ? `${it.items.length} days planned` : 'Nothing planned yet'}
                </p>
              </div>
            ))}
            {itineraries.length === 0 && (
              <p className="py-2 text-sm text-gray-400">None yet.</p>
            )}
          </div>
        </div>

        <form onSubmit={createBlank} className="card space-y-2">
          <h2 className="section-title">Plan something of your own</h2>
          <p className="text-sm text-gray-600">
            Somewhere that is not in the catalogue? Start a blank itinerary.
          </p>
          <input
            className="input"
            placeholder="Two weeks in Ladakh"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <button className="btn">Create</button>
        </form>
      </div>
    </div>
  );
}

function chip(active: boolean): string {
  return active
    ? 'rounded-full border border-brand bg-brand-light px-3 py-1 text-sm text-brand-dark'
    : 'rounded-full border border-gray-200 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50';
}

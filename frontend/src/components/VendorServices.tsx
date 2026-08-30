import { FormEvent, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { Loading } from './ui/Feedback';
import DynamicForm, {
  Answers,
  FieldSpec,
  cleanAnswers,
  formatAnswer,
  validateAnswers,
} from './DynamicForm';

interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

interface Definition {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  allowedPricingModels: string[];
  availabilityModel: string;
  packagesAllowed: boolean;
  defaultCapacity: number;
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
  active: boolean;
}

interface VendorService {
  id: string;
  definitionId: string;
  displayName: string | null;
  description: string | null;
  attributes: Answers;
  concurrentCapacity: number;
  active: boolean;
  bookable: boolean;
  definition: Definition | null;
  category: Category | null;
  serviceForm: FieldSpec[];
  bookingForm: FieldSpec[];
  offerings: Offering[];
}

export const PRICING_LABEL: Record<string, string> = {
  fixed: 'Fixed price',
  per_person: 'Per person',
  per_hour: 'Per hour',
  per_day: 'Per day',
  per_session: 'Per session',
  per_item: 'Per item',
  starting_from: 'Starting from',
  custom_quote: 'Custom quote',
  no_public_price: 'Price on request',
};

/** The two models that publish no amount — the vendor quotes after the request. */
const QUOTE_ONLY = ['custom_quote', 'no_public_price'];

/** Where a quantity is part of the price rather than decoration. */
const QUANTITY_MODELS = ['per_person', 'per_item', 'per_hour', 'per_day', 'per_session'];

export function priceLabel(o: Offering): string {
  if (QUOTE_ONLY.includes(o.pricingModel)) return PRICING_LABEL[o.pricingModel];
  const amount = `${o.currency} ${Number(o.price).toLocaleString()}`;
  if (o.pricingModel === 'starting_from') return `From ${amount}`;
  return o.unitLabel ? `${amount} ${o.unitLabel}` : amount;
}

/**
 * What this business sells.
 *
 * Every field on this screen comes from the catalog: which services exist,
 * which questions each one asks, which pricing models it may use, and whether
 * it is sold as a package at all. Nothing here is written per vendor type,
 * which is what lets an administrator add a trade without a deployment.
 */
export default function VendorServices({ vendorId }: { vendorId: string }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [pricing, setPricing] = useState<string | null>(null);

  const { data: services = [], isLoading } = useQuery<VendorService[]>({
    queryKey: ['vendor-services', vendorId],
    queryFn: async () => (await api.get(`/vendors/${vendorId}/services`)).data,
    enabled: Boolean(vendorId),
  });

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError('');
    setNotice('');
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['vendor-services', vendorId] });
      setNotice(ok);
      return true;
    } catch (err) {
      setError(apiMessage(err, 'That change was not accepted.'));
      return false;
    }
  }

  const takenDefinitionIds = useMemo(() => services.map((s) => s.definitionId), [services]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="section-title">Services you offer</h2>
          <p className="text-sm text-gray-600">
            What you sell, what it costs, and how many you can run at once. Clients see these, and
            the questions they are asked come from the service they pick.
          </p>
        </div>
        <button className="btn" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : 'Add a service'}
        </button>
      </div>

      {error && <p className="alert-critical">{error}</p>}
      {notice && <p className="alert-positive">{notice}</p>}

      {adding && (
        <AddService
          taken={takenDefinitionIds}
          onAdd={async (body) => {
            const ok = await act(
              () => api.post(`/vendors/${vendorId}/services`, body),
              'Service added. Give it a price so clients can book it.',
            );
            if (ok) setAdding(false);
          }}
        />
      )}

      {isLoading && <div className="card">
          <Loading rows={2} />
        </div>}
      {!isLoading && services.length === 0 && !adding && (
        <p className="card text-sm text-gray-400">
          Nothing listed yet. Add a service to start taking requests.
        </p>
      )}

      {services.map((service) => (
        <div key={service.id} className="card space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="section-title">
                {service.displayName ?? service.definition?.name ?? 'Service'}
              </h3>
              <p className="text-xs text-gray-500">
                {service.category?.name}
                {service.definition ? ` · ${service.definition.name}` : ''}
                {' · '}
                up to {service.concurrentCapacity} at once
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-1 text-xs ${
                  service.bookable
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-amber-50 text-amber-800'
                }`}
              >
                {service.bookable
                  ? 'Bookable'
                  : service.active
                    ? 'No price published'
                    : 'Switched off'}
              </span>
              <button
                className="btn-outline"
                onClick={() => setEditing(editing === service.id ? null : service.id)}
              >
                {editing === service.id ? 'Close' : 'Edit'}
              </button>
              <button
                className="btn-outline"
                onClick={() => setPricing(pricing === service.id ? null : service.id)}
              >
                {pricing === service.id ? 'Close prices' : `Prices (${service.offerings.length})`}
              </button>
              <button
                className="btn-outline"
                onClick={() =>
                  act(
                    () =>
                      api.put(`/vendors/${vendorId}/services/${service.id}`, {
                        definitionId: service.definitionId,
                        active: !service.active,
                      }),
                    service.active ? 'Service switched off.' : 'Service switched on.',
                  )
                }
              >
                {service.active ? 'Switch off' : 'Switch on'}
              </button>
            </div>
          </div>

          {service.description && <p className="text-sm text-gray-700">{service.description}</p>}

          {/* The vendor's own answers, read back. */}
          {Object.keys(service.attributes).length > 0 && editing !== service.id && (
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              {service.serviceForm
                .filter((f) => service.attributes[f.key] !== undefined)
                .map((f) => (
                  <div key={f.key} className="flex gap-2">
                    <dt className="text-gray-500">{f.label}:</dt>
                    <dd className="font-medium text-gray-800">
                      {formatAnswer(f, service.attributes[f.key])}
                    </dd>
                  </div>
                ))}
            </dl>
          )}

          {editing === service.id && (
            <EditService
              service={service}
              onSave={async (body) => {
                const ok = await act(
                  () => api.put(`/vendors/${vendorId}/services/${service.id}`, body),
                  'Service updated.',
                );
                if (ok) setEditing(null);
              }}
              onRemove={async () => {
                const ok = await act(
                  () => api.delete(`/vendors/${vendorId}/services/${service.id}`),
                  'Service removed.',
                );
                if (ok) setEditing(null);
              }}
            />
          )}

          {pricing === service.id && (
            <Offerings
              vendorId={vendorId}
              service={service}
              onChanged={(ok) => act(async () => undefined, ok)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function AddService({ taken, onAdd }: { taken: string[]; onAdd: (b: unknown) => void }) {
  const [categoryId, setCategoryId] = useState('');
  const [definitionId, setDefinitionId] = useState('');
  const [answers, setAnswers] = useState<Answers>({});
  const [capacity, setCapacity] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['catalog-categories'],
    queryFn: async () => (await api.get('/catalog/categories')).data,
  });

  const { data: definitions = [] } = useQuery<Definition[]>({
    queryKey: ['catalog-definitions', categoryId],
    queryFn: async () => (await api.get(`/catalog/categories/${categoryId}/services`)).data,
    enabled: Boolean(categoryId),
  });

  const { data: described } = useQuery<{ definition: Definition; serviceForm: FieldSpec[] }>({
    queryKey: ['catalog-service', definitionId],
    queryFn: async () => (await api.get(`/catalog/services/${definitionId}`)).data,
    enabled: Boolean(definitionId),
  });

  const fields = described?.serviceForm ?? [];

  function submit(e: FormEvent) {
    e.preventDefault();
    const found = validateAnswers(fields, answers);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onAdd({
      definitionId,
      attributes: cleanAnswers(fields, answers),
      concurrentCapacity: capacity ? Number(capacity) : undefined,
    });
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium text-gray-700">Category</span>
          <select
            className="input mt-1"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setDefinitionId('');
              setAnswers({});
            }}
            required
          >
            <option value="">Choose…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium text-gray-700">Service</span>
          <select
            className="input mt-1"
            value={definitionId}
            onChange={(e) => {
              setDefinitionId(e.target.value);
              setAnswers({});
            }}
            disabled={!categoryId}
            required
          >
            <option value="">Choose…</option>
            {definitions.map((d) => (
              <option key={d.id} value={d.id} disabled={taken.includes(d.id)}>
                {d.name}
                {taken.includes(d.id) ? ': already listed' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {described && (
        <>
          {described.definition.description && (
            <p className="text-sm text-gray-600">{described.definition.description}</p>
          )}
          <DynamicForm fields={fields} answers={answers} errors={errors} onChange={(k, v) => setAnswers((a) => ({ ...a, [k]: v }))} />
          <label className="block text-sm sm:max-w-xs">
            <span className="font-medium text-gray-700">How many at once?</span>
            <input
              className="input mt-1"
              type="number"
              min={1}
              placeholder={String(described.definition.defaultCapacity)}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
            <span className="mt-1 block text-xs text-gray-500">
              How many of these you can run simultaneously. Five if you have five teams, one for a
              hall. This seeds the capacity of every window you publish.
            </span>
          </label>
          <button className="btn">Add this service</button>
        </>
      )}
    </form>
  );
}

function EditService({
  service,
  onSave,
  onRemove,
}: {
  service: VendorService;
  onSave: (b: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const [displayName, setDisplayName] = useState(service.displayName ?? '');
  const [description, setDescription] = useState(service.description ?? '');
  const [answers, setAnswers] = useState<Answers>(service.attributes);
  const [capacity, setCapacity] = useState(String(service.concurrentCapacity));
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    const found = validateAnswers(service.serviceForm, answers);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSave({
      definitionId: service.definitionId,
      displayName: displayName.trim(),
      description: description.trim(),
      attributes: cleanAnswers(service.serviceForm, answers),
      concurrentCapacity: Number(capacity) || 1,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 border-t pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium text-gray-700">Your name for it</span>
          <input
            className="input mt-1"
            placeholder={service.definition?.name ?? ''}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="font-medium text-gray-700">How many at once?</span>
          <input
            className="input mt-1"
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="font-medium text-gray-700">Description</span>
        <textarea
          className="input mt-1"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <DynamicForm
        fields={service.serviceForm}
        answers={answers}
        errors={errors}
        onChange={(k, v) => setAnswers((a) => ({ ...a, [k]: v }))}
      />

      <div className="flex flex-wrap gap-2">
        <button className="btn">Save</button>
        <button
          type="button"
          className="btn-outline"
          onClick={() => {
            if (confirm('Remove this service from your business?')) onRemove();
          }}
        >
          Remove
        </button>
      </div>
    </form>
  );
}

function Offerings({
  vendorId,
  service,
  onChanged,
}: {
  vendorId: string;
  service: VendorService;
  onChanged: (ok: string) => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const allowed = service.definition?.allowedPricingModels ?? [];

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError('');
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['vendor-services', vendorId] });
      onChanged(ok);
      setEditing(null);
    } catch (err) {
      setError(apiMessage(err, 'That price was not accepted.'));
    }
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-800">Prices</h4>
        <button className="btn-outline" onClick={() => setEditing(editing === 'new' ? null : 'new')}>
          {editing === 'new' ? 'Cancel' : 'Add a price'}
        </button>
      </div>
      {error && <p className="alert-critical">{error}</p>}

      {editing === 'new' && (
        <OfferingForm
          allowed={allowed}
          packagesAllowed={service.definition?.packagesAllowed ?? true}
          onSave={(body) =>
            act(
              () => api.post(`/vendors/${vendorId}/services/${service.id}/offerings`, body),
              'Price published.',
            )
          }
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="divide-y">
        {service.offerings.map((o) =>
          editing === o.id ? (
            <OfferingForm
              key={o.id}
              existing={o}
              allowed={allowed}
              packagesAllowed={service.definition?.packagesAllowed ?? true}
              onSave={(body) =>
                act(
                  () =>
                    api.put(
                      `/vendors/${vendorId}/services/${service.id}/offerings/${o.id}`,
                      body,
                    ),
                  'Price updated.',
                )
              }
              onCancel={() => setEditing(null)}
              onRemove={() =>
                act(
                  () =>
                    api.delete(
                      `/vendors/${vendorId}/services/${service.id}/offerings/${o.id}`,
                    ),
                  'Price removed.',
                )
              }
            />
          ) : (
            <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  {o.name}
                  {o.isPackage && (
                    <span className="ml-2 rounded-sm bg-brand/10 px-1.5 py-0.5 text-xs text-brand">
                      Package
                    </span>
                  )}
                  {!o.active && <span className="ml-2 text-xs text-gray-400">Retired</span>}
                </p>
                <p className="text-xs text-gray-500">
                  {priceLabel(o)}
                  {o.minQuantity ? ` · from ${o.minQuantity}` : ''}
                  {o.maxQuantity ? ` up to ${o.maxQuantity}` : ''}
                </p>
                {o.inclusions.length > 0 && (
                  <p className="text-xs text-gray-500">Includes: {o.inclusions.join(', ')}</p>
                )}
              </div>
              <button className="btn-outline" onClick={() => setEditing(o.id)}>
                Edit
              </button>
            </div>
          ),
        )}
        {service.offerings.length === 0 && editing !== 'new' && (
          <p className="py-2 text-sm text-gray-400">
            No prices yet, clients cannot request this service until there is one.
          </p>
        )}
      </div>
    </div>
  );
}

function OfferingForm({
  existing,
  allowed,
  packagesAllowed,
  onSave,
  onCancel,
  onRemove,
}: {
  existing?: Offering;
  allowed: string[];
  packagesAllowed: boolean;
  onSave: (b: Record<string, unknown>) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [model, setModel] = useState(existing?.pricingModel ?? allowed[0] ?? 'fixed');
  const [price, setPrice] = useState(existing?.price ?? '');
  const [unitLabel, setUnitLabel] = useState(existing?.unitLabel ?? '');
  const [minQuantity, setMinQuantity] = useState(existing?.minQuantity?.toString() ?? '');
  const [maxQuantity, setMaxQuantity] = useState(existing?.maxQuantity?.toString() ?? '');
  const [isPackage, setIsPackage] = useState(existing?.isPackage ?? false);
  const [inclusions, setInclusions] = useState((existing?.inclusions ?? []).join(', '));
  const [active, setActive] = useState(existing?.active ?? true);
  const [problem, setProblem] = useState('');

  const quoteOnly = QUOTE_ONLY.includes(model);
  const takesQuantity = QUANTITY_MODELS.includes(model);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!quoteOnly && (price === '' || Number(price) < 0)) {
      setProblem('Give a price, or choose Custom quote if you price each job.');
      return;
    }
    if (minQuantity && maxQuantity && Number(minQuantity) > Number(maxQuantity)) {
      setProblem('The minimum is above the maximum.');
      return;
    }
    setProblem('');
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      pricingModel: model,
      price: quoteOnly ? undefined : String(price),
      unitLabel: unitLabel.trim() || undefined,
      minQuantity: takesQuantity && minQuantity ? Number(minQuantity) : undefined,
      maxQuantity: takesQuantity && maxQuantity ? Number(maxQuantity) : undefined,
      isPackage,
      inclusions: inclusions
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      active,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-sm bg-gray-50 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium text-gray-700">Name</span>
          <input
            className="input mt-1"
            placeholder="Full day, two photographers"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="text-sm">
          <span className="font-medium text-gray-700">How it is priced</span>
          <select className="input mt-1" value={model} onChange={(e) => setModel(e.target.value)}>
            {allowed.map((m) => (
              <option key={m} value={m}>
                {PRICING_LABEL[m] ?? m}
              </option>
            ))}
          </select>
        </label>
        {!quoteOnly && (
          <label className="text-sm">
            <span className="font-medium text-gray-700">Amount (INR)</span>
            <input
              className="input mt-1"
              type="number"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </label>
        )}
        {!quoteOnly && (
          <label className="text-sm">
            <span className="font-medium text-gray-700">Per what?</span>
            <input
              className="input mt-1"
              placeholder="per plate"
              value={unitLabel}
              onChange={(e) => setUnitLabel(e.target.value)}
            />
          </label>
        )}
        {takesQuantity && (
          <>
            <label className="text-sm">
              <span className="font-medium text-gray-700">Minimum you will take</span>
              <input
                className="input mt-1"
                type="number"
                min={1}
                value={minQuantity}
                onChange={(e) => setMinQuantity(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="font-medium text-gray-700">Maximum</span>
              <input
                className="input mt-1"
                type="number"
                min={1}
                value={maxQuantity}
                onChange={(e) => setMaxQuantity(e.target.value)}
              />
            </label>
          </>
        )}
      </div>

      <label className="block text-sm">
        <span className="font-medium text-gray-700">Description</span>
        <input
          className="input mt-1"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      {packagesAllowed && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={isPackage}
            onChange={(e) => setIsPackage(e.target.checked)}
          />
          <span className="text-gray-700">This is a package</span>
        </label>
      )}

      {isPackage && (
        <label className="block text-sm">
          <span className="font-medium text-gray-700">What it includes</span>
          <input
            className="input mt-1"
            placeholder="Album, drone coverage, two edits"
            value={inclusions}
            onChange={(e) => setInclusions(e.target.value)}
          />
          <span className="mt-1 block text-xs text-gray-500">Separate each one with a comma.</span>
        </label>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        <span className="text-gray-700">Offer this to clients</span>
      </label>

      {problem && <p className="text-sm text-red-600">{problem}</p>}

      <div className="flex flex-wrap gap-2">
        <button className="btn">{existing ? 'Save' : 'Publish price'}</button>
        <button type="button" className="btn-outline" onClick={onCancel}>
          Cancel
        </button>
        {onRemove && (
          <button
            type="button"
            className="btn-outline"
            onClick={() => {
              if (confirm('Remove this price?')) onRemove();
            }}
          >
            Remove
          </button>
        )}
      </div>
    </form>
  );
}

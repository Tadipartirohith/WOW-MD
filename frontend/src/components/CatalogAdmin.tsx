import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { PRICING_LABEL } from './VendorServices';

interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
}

interface Definition {
  id: string;
  categoryId: string;
  slug: string;
  name: string;
  description: string | null;
  allowedPricingModels: string[];
  availabilityModel: string;
  packagesAllowed: boolean;
  defaultCapacity: number;
  active: boolean;
}

interface Attribute {
  id: string;
  scope: 'service' | 'booking';
  key: string;
  label: string;
  helpText: string | null;
  type: string;
  required: boolean;
  filterable: boolean;
  constraints: {
    options?: { value: string; label: string }[];
    min?: number;
    max?: number;
    unit?: string;
  };
  sortOrder: number;
}

interface Vocabulary {
  attributeTypes: string[];
  attributeScopes: string[];
  pricingModels: string[];
  availabilityModels: string[];
}

const TYPE_LABEL: Record<string, string> = {
  text: 'Text',
  number: 'Whole number',
  decimal: 'Decimal',
  boolean: 'Yes / no',
  single_select: 'Choose one',
  multi_select: 'Choose several',
  date: 'Date',
  time: 'Time',
  date_time: 'Date and time',
  duration: 'Duration',
  currency: 'Money',
  file: 'File or image',
  url: 'Web address',
  location: 'Place',
  range: 'Range',
};

const AVAILABILITY_LABEL: Record<string, string> = {
  slot: 'Takes a published window',
  full_day: 'Takes the whole day',
  multi_day: 'Runs across several days',
  always: 'No calendar involvement',
};

/** Types whose answers come from a list the administrator writes. */
const NEEDS_OPTIONS = ['single_select', 'multi_select'];

/**
 * The service catalog, as an administrator configures it.
 *
 * This screen is the alternative to shipping a module per vendor type. A new
 * trade — a mehendi artist, a drone crew, a horse for the baraat — is a
 * category, a service and a handful of questions written here, and every
 * vendor can list against it the same afternoon.
 */
export default function CatalogAdmin() {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [definitionId, setDefinitionId] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [addingService, setAddingService] = useState(false);
  const [addingAttribute, setAddingAttribute] = useState(false);

  const { data: vocabulary } = useQuery<Vocabulary>({
    queryKey: ['catalog-vocabulary'],
    queryFn: async () => (await api.get('/catalog/vocabulary')).data,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['catalog-categories-admin', showRetired],
    queryFn: async () =>
      (await api.get('/catalog/categories', { params: { includeInactive: showRetired } })).data,
  });

  const { data: definitions = [] } = useQuery<Definition[]>({
    queryKey: ['catalog-definitions-admin', categoryId, showRetired],
    queryFn: async () =>
      (
        await api.get(`/catalog/categories/${categoryId}/services`, {
          params: { includeInactive: showRetired },
        })
      ).data,
    enabled: Boolean(categoryId),
  });

  const { data: attributes = [] } = useQuery<Attribute[]>({
    queryKey: ['catalog-attributes', definitionId],
    queryFn: async () => (await api.get(`/catalog/services/${definitionId}/attributes`)).data,
    enabled: Boolean(definitionId),
  });

  const category = categories.find((c) => c.id === categoryId);
  const definition = definitions.find((d) => d.id === definitionId);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError('');
    setNotice('');
    try {
      await fn();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['catalog-categories-admin'] }),
        qc.invalidateQueries({ queryKey: ['catalog-definitions-admin'] }),
        qc.invalidateQueries({ queryKey: ['catalog-attributes'] }),
        qc.invalidateQueries({ queryKey: ['catalog-categories'] }),
      ]);
      setNotice(ok);
      return true;
    } catch (err) {
      setError(apiMessage(err, 'That change was not accepted.'));
      return false;
    }
  }

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-gray-900">Service catalog</h2>
          <p className="text-sm text-gray-600">
            What vendors are able to sell, and what buyers are asked when they book it. Adding a
            trade here needs no deployment.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={showRetired}
            onChange={(e) => setShowRetired(e.target.checked)}
          />
          Show retired
        </label>
      </div>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {notice && <p className="rounded bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

      {/* ------------------------------------------------------- categories */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Categories
          </h3>
          <button className="btn-outline" onClick={() => setAddingCategory(!addingCategory)}>
            {addingCategory ? 'Cancel' : 'Add'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setCategoryId(c.id === categoryId ? '' : c.id);
                setDefinitionId('');
              }}
              className={`rounded-full border px-3 py-1 text-sm ${
                c.id === categoryId
                  ? 'border-brand bg-brand text-brand-fg'
                  : c.active
                    ? 'border-gray-300 text-gray-700 hover:border-brand'
                    : 'border-dashed border-gray-300 text-gray-400'
              }`}
            >
              {c.name}
              {!c.active && ' (retired)'}
            </button>
          ))}
          {categories.length === 0 && <p className="text-sm text-gray-400">Nothing yet.</p>}
        </div>

        {addingCategory && (
          <SlugForm
            what="category"
            placeholder="Drone crews"
            onSave={async (body) => {
              const ok = await act(
                () => api.post('/admin/catalog/categories', body),
                'Category added.',
              );
              if (ok) setAddingCategory(false);
            }}
          />
        )}

        {category && (
          <div className="flex flex-wrap items-center gap-2 rounded bg-gray-50 p-2 text-sm">
            <span className="text-gray-600">
              <strong>{category.name}</strong> · <code className="text-xs">{category.slug}</code>
            </span>
            <button
              className="btn-outline"
              onClick={() =>
                act(
                  () =>
                    api.put(`/admin/catalog/categories/${category.id}`, {
                      active: !category.active,
                    }),
                  category.active ? 'Category retired.' : 'Category restored.',
                )
              }
            >
              {category.active ? 'Retire' : 'Restore'}
            </button>
            <span className="text-xs text-gray-500">
              Retiring hides it from new listings. Everything already booked under it keeps working.
            </span>
          </div>
        )}
      </div>

      {/* -------------------------------------------------------- definitions */}
      {categoryId && (
        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Services in {category?.name}
            </h3>
            <button className="btn-outline" onClick={() => setAddingService(!addingService)}>
              {addingService ? 'Cancel' : 'Add'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {definitions.map((d) => (
              <button
                key={d.id}
                onClick={() => setDefinitionId(d.id === definitionId ? '' : d.id)}
                className={`rounded-full border px-3 py-1 text-sm ${
                  d.id === definitionId
                    ? 'border-brand bg-brand text-brand-fg'
                    : d.active
                      ? 'border-gray-300 text-gray-700 hover:border-brand'
                      : 'border-dashed border-gray-300 text-gray-400'
                }`}
              >
                {d.name}
                {!d.active && ' (retired)'}
              </button>
            ))}
            {definitions.length === 0 && <p className="text-sm text-gray-400">Nothing yet.</p>}
          </div>

          {addingService && vocabulary && (
            <DefinitionForm
              vocabulary={vocabulary}
              onSave={async (body) => {
                const ok = await act(
                  () => api.post(`/admin/catalog/categories/${categoryId}/services`, body),
                  'Service added. Give it some questions next.',
                );
                if (ok) setAddingService(false);
              }}
            />
          )}

          {definition && vocabulary && (
            <DefinitionForm
              key={definition.id}
              vocabulary={vocabulary}
              existing={definition}
              onSave={(body) =>
                act(() => api.put(`/admin/catalog/services/${definition.id}`, body), 'Service updated.')
              }
            />
          )}
        </div>
      )}

      {/* --------------------------------------------------------- attributes */}
      {definitionId && vocabulary && (
        <div className="space-y-3 border-t pt-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Questions on {definition?.name}
            </h3>
            <button className="btn-outline" onClick={() => setAddingAttribute(!addingAttribute)}>
              {addingAttribute ? 'Cancel' : 'Add a question'}
            </button>
          </div>

          {addingAttribute && (
            <AttributeForm
              vocabulary={vocabulary}
              onSave={async (body) => {
                const ok = await act(
                  () => api.post(`/admin/catalog/services/${definitionId}/attributes`, body),
                  'Question added.',
                );
                if (ok) setAddingAttribute(false);
              }}
            />
          )}

          {(['service', 'booking'] as const).map((scope) => {
            const rows = attributes.filter((a) => a.scope === scope);
            return (
              <div key={scope}>
                <p className="text-sm font-medium text-gray-800">
                  {scope === 'service' ? 'Asked of the vendor' : 'Asked of the buyer'}
                  <span className="ml-2 font-normal text-gray-500">
                    {scope === 'service'
                      ? 'Describes what they offer; shown on the listing.'
                      : 'The booking form. This is what replaces a hand-written request page.'}
                  </span>
                </p>
                <div className="divide-y">
                  {rows.map((a) => (
                    <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <p className="text-sm text-gray-900">
                          {a.label}
                          {a.required && <span className="text-red-500"> *</span>}
                          {a.filterable && (
                            <span className="ml-2 rounded bg-brand/10 px-1.5 py-0.5 text-xs text-brand">
                              filterable
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500">
                          <code>{a.key}</code> · {TYPE_LABEL[a.type] ?? a.type}
                          {a.constraints?.options
                            ? ` · ${a.constraints.options.length} option(s)`
                            : ''}
                          {a.constraints?.min !== undefined || a.constraints?.max !== undefined
                            ? ` · ${a.constraints.min ?? '−∞'}…${a.constraints.max ?? '∞'}`
                            : ''}
                        </p>
                      </div>
                      <button
                        className="btn-outline"
                        onClick={() => {
                          if (
                            confirm(
                              `Remove "${a.label}"? Answers already stored under it stay put and ` +
                                'simply stop being read.',
                            )
                          ) {
                            void act(
                              () => api.delete(`/admin/catalog/attributes/${a.id}`),
                              'Question removed.',
                            );
                          }
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {rows.length === 0 && (
                    <p className="py-2 text-sm text-gray-400">Nothing asked here yet.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SlugForm({
  what,
  placeholder,
  onSave,
}: {
  what: string;
  placeholder: string;
  onSave: (b: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');

  // The slug follows the name until somebody edits it, which is what people
  // expect and saves a field on the common path.
  const effectiveSlug = slug || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function submit(e: FormEvent) {
    e.preventDefault();
    onSave({ name: name.trim(), slug: effectiveSlug, description: description.trim() || undefined });
    setName('');
    setSlug('');
    setDescription('');
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded bg-gray-50 p-3">
      <label className="text-sm">
        <span className="text-gray-700">Name</span>
        <input
          className="input mt-1"
          placeholder={placeholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      <label className="text-sm">
        <span className="text-gray-700">Slug</span>
        <input
          className="input mt-1"
          placeholder={effectiveSlug || 'auto'}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
      </label>
      <label className="flex-1 text-sm">
        <span className="text-gray-700">Description</span>
        <input
          className="input mt-1"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <button className="btn">Add {what}</button>
    </form>
  );
}

function DefinitionForm({
  vocabulary,
  existing,
  onSave,
}: {
  vocabulary: Vocabulary;
  existing?: Definition;
  onSave: (b: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [slug, setSlug] = useState(existing?.slug ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [models, setModels] = useState<string[]>(existing?.allowedPricingModels ?? ['fixed']);
  const [availability, setAvailability] = useState(existing?.availabilityModel ?? 'slot');
  const [packagesAllowed, setPackagesAllowed] = useState(existing?.packagesAllowed ?? true);
  const [defaultCapacity, setDefaultCapacity] = useState(String(existing?.defaultCapacity ?? 1));
  const [problem, setProblem] = useState('');

  const effectiveSlug =
    slug || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (models.length === 0) {
      setProblem('Pick at least one way this can be priced.');
      return;
    }
    setProblem('');
    const body: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || undefined,
      allowedPricingModels: models,
      availabilityModel: availability,
      packagesAllowed,
      defaultCapacity: Number(defaultCapacity) || 1,
    };
    if (!existing) body.slug = effectiveSlug;
    onSave(body);
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded bg-gray-50 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium text-gray-700">Name</span>
          <input
            className="input mt-1"
            placeholder="Aerial coverage"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        {!existing && (
          <label className="text-sm">
            <span className="font-medium text-gray-700">Slug</span>
            <input
              className="input mt-1"
              placeholder={effectiveSlug || 'auto'}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </label>
        )}
        <label className="text-sm">
          <span className="font-medium text-gray-700">How it takes time</span>
          <select
            className="input mt-1"
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
          >
            {vocabulary.availabilityModels.map((m) => (
              <option key={m} value={m}>
                {AVAILABILITY_LABEL[m] ?? m}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium text-gray-700">Default capacity</span>
          <input
            className="input mt-1"
            type="number"
            min={1}
            value={defaultCapacity}
            onChange={(e) => setDefaultCapacity(e.target.value)}
          />
          <span className="mt-1 block text-xs text-gray-500">
            What a vendor's windows start at. Five for a caterer, one for a hall.
          </span>
        </label>
      </div>

      <label className="block text-sm">
        <span className="font-medium text-gray-700">Description</span>
        <input
          className="input mt-1"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <div className="text-sm">
        <span className="font-medium text-gray-700">How it may be priced</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {vocabulary.pricingModels.map((m) => {
            const on = models.includes(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => setModels(on ? models.filter((x) => x !== m) : [...models, m])}
                className={`rounded-full border px-3 py-1 text-xs ${
                  on
                    ? 'border-brand bg-brand text-brand-fg'
                    : 'border-gray-300 text-gray-700 hover:border-brand'
                }`}
              >
                {PRICING_LABEL[m] ?? m}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Withdrawing one that vendors are already selling on is refused — they would be left with a
          listing they cannot edit.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={packagesAllowed}
          onChange={(e) => setPackagesAllowed(e.target.checked)}
        />
        <span className="text-gray-700">
          Can be sold as a package
          <span className="ml-1 text-xs text-gray-500">
            — leave off for a service that is one thing, like a priest conducting a ceremony.
          </span>
        </span>
      </label>

      {problem && <p className="text-sm text-red-600">{problem}</p>}
      <button className="btn">{existing ? 'Save service' : 'Add service'}</button>
    </form>
  );
}

function AttributeForm({
  vocabulary,
  onSave,
}: {
  vocabulary: Vocabulary;
  onSave: (b: Record<string, unknown>) => void;
}) {
  const [scope, setScope] = useState<'service' | 'booking'>('booking');
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [helpText, setHelpText] = useState('');
  const [type, setType] = useState('text');
  const [required, setRequired] = useState(false);
  const [filterable, setFilterable] = useState(false);
  const [options, setOptions] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [unit, setUnit] = useState('hours');
  const [problem, setProblem] = useState('');

  const effectiveKey =
    key || label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  const needsOptions = NEEDS_OPTIONS.includes(type);
  const takesBounds = ['number', 'decimal', 'currency', 'duration', 'range'].includes(type);

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = options
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
      .map((o) => ({
        value: o.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        label: o,
      }));

    if (needsOptions && parsed.length === 0) {
      setProblem('A question with a list of answers needs the list.');
      return;
    }
    if (min && max && Number(min) > Number(max)) {
      setProblem('The minimum is above the maximum.');
      return;
    }
    setProblem('');

    const constraints: Record<string, unknown> = {};
    if (needsOptions) constraints.options = parsed;
    if (takesBounds && min) constraints.min = Number(min);
    if (takesBounds && max) constraints.max = Number(max);
    if (type === 'duration') constraints.unit = unit;

    onSave({
      scope,
      key: effectiveKey,
      label: label.trim(),
      helpText: helpText.trim() || undefined,
      type,
      required,
      filterable: scope === 'service' ? filterable : false,
      constraints,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded bg-gray-50 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium text-gray-700">Who is asked</span>
          <select
            className="input mt-1"
            value={scope}
            onChange={(e) => setScope(e.target.value as 'service' | 'booking')}
          >
            <option value="service">The vendor, about what they offer</option>
            <option value="booking">The buyer, when they request</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium text-gray-700">Kind of answer</span>
          <select className="input mt-1" value={type} onChange={(e) => setType(e.target.value)}>
            {vocabulary.attributeTypes.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t] ?? t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium text-gray-700">Question</span>
          <input
            className="input mt-1"
            placeholder="Number of guests"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
          />
        </label>
        <label className="text-sm">
          <span className="font-medium text-gray-700">Key</span>
          <input
            className="input mt-1"
            placeholder={effectiveKey || 'auto'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <span className="mt-1 block text-xs text-gray-500">
            What the answer is stored under. Stable; the question above is not.
          </span>
        </label>
      </div>

      <label className="block text-sm">
        <span className="font-medium text-gray-700">Hint</span>
        <input
          className="input mt-1"
          placeholder="City is enough if the venue is not fixed yet."
          value={helpText}
          onChange={(e) => setHelpText(e.target.value)}
        />
      </label>

      {needsOptions && (
        <label className="block text-sm">
          <span className="font-medium text-gray-700">The answers offered</span>
          <input
            className="input mt-1"
            placeholder="Vegetarian, Non-vegetarian, Jain"
            value={options}
            onChange={(e) => setOptions(e.target.value)}
          />
          <span className="mt-1 block text-xs text-gray-500">Separate each one with a comma.</span>
        </label>
      )}

      {takesBounds && (
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label>
            <span className="font-medium text-gray-700">Minimum</span>
            <input className="input mt-1 w-28" type="number" value={min} onChange={(e) => setMin(e.target.value)} />
          </label>
          <label>
            <span className="font-medium text-gray-700">Maximum</span>
            <input className="input mt-1 w-28" type="number" value={max} onChange={(e) => setMax(e.target.value)} />
          </label>
          {type === 'duration' && (
            <label>
              <span className="font-medium text-gray-700">Measured in</span>
              <select className="input mt-1" value={unit} onChange={(e) => setUnit(e.target.value)}>
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </label>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          <span className="text-gray-700">Required</span>
        </label>
        {scope === 'service' && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={filterable}
              onChange={(e) => setFilterable(e.target.checked)}
            />
            <span className="text-gray-700">
              Buyers can filter on it
              <span className="ml-1 text-xs text-gray-500">— worth it for two or three, not all.</span>
            </span>
          </label>
        )}
      </div>

      {problem && <p className="text-sm text-red-600">{problem}</p>}
      <button className="btn">Add question</button>
    </form>
  );
}

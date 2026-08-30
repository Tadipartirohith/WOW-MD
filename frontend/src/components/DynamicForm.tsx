import { ChangeEvent } from 'react';
import PhotoUploader from './PhotoUploader';

/**
 * One question, exactly as the catalog describes it.
 *
 * This shape comes straight off `/catalog/services/:id` — the same rows the
 * server validates against. Nothing here is hand-written per vendor type,
 * which is the whole point: a new kind of service is configuration, and this
 * component is what renders it.
 */
export interface FieldSpec {
  key: string;
  label: string;
  helpText: string | null;
  type: string;
  required: boolean;
  constraints: {
    options?: { value: string; label: string }[];
    min?: number;
    max?: number;
    precision?: number;
    maxLength?: number;
    minSelections?: number;
    maxSelections?: number;
    unit?: 'minutes' | 'hours' | 'days';
    accept?: string[];
  };
  filterable?: boolean;
}

export type Answers = Record<string, unknown>;

/**
 * Client-side validation that mirrors the server's, field by field.
 *
 * Mirrors rather than replaces: the server checks all of this again, and its
 * answer is the one that counts. This exists so somebody filling in a long
 * form finds out about a bad guest count before they submit it, not after.
 */
export function validateAnswers(fields: FieldSpec[], answers: Answers): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const value = answers[field.key];
    const empty =
      value === undefined || value === null || value === '' ||
      (Array.isArray(value) && value.length === 0);

    if (empty) {
      if (field.required) errors[field.key] = 'Required';
      continue;
    }

    const c = field.constraints ?? {};
    switch (field.type) {
      case 'number':
      case 'decimal':
      case 'currency':
      case 'duration': {
        const n = Number(value);
        if (!Number.isFinite(n)) errors[field.key] = 'Must be a number';
        else if (field.type === 'number' && !Number.isInteger(n))
          errors[field.key] = 'Must be a whole number';
        else if (field.type === 'duration' && n <= 0) errors[field.key] = 'Must be more than zero';
        else if (c.min !== undefined && n < c.min) errors[field.key] = `At least ${c.min}`;
        else if (c.max !== undefined && n > c.max) errors[field.key] = `At most ${c.max}`;
        break;
      }
      case 'multi_select': {
        const chosen = Array.isArray(value) ? value : [];
        if (c.minSelections !== undefined && chosen.length < c.minSelections)
          errors[field.key] = `Choose at least ${c.minSelections}`;
        else if (c.maxSelections !== undefined && chosen.length > c.maxSelections)
          errors[field.key] = `Choose at most ${c.maxSelections}`;
        break;
      }
      case 'text': {
        if (c.maxLength !== undefined && String(value).length > c.maxLength)
          errors[field.key] = `${c.maxLength} characters or fewer`;
        break;
      }
      case 'url': {
        if (!/^https?:\/\/\S+$/i.test(String(value)))
          errors[field.key] = 'Include http:// or https://';
        break;
      }
      case 'location': {
        const v = value as { city?: string };
        if (!v?.city?.trim()) errors[field.key] = 'A city at least';
        break;
      }
      case 'range': {
        const v = value as { from?: unknown; to?: unknown };
        const from = Number(v?.from);
        const to = Number(v?.to);
        if (!Number.isFinite(from) || !Number.isFinite(to)) errors[field.key] = 'Give a from and a to';
        else if (from > to) errors[field.key] = 'Starts after it ends';
        else if (c.min !== undefined && from < c.min) errors[field.key] = `At least ${c.min}`;
        else if (c.max !== undefined && to > c.max) errors[field.key] = `At most ${c.max}`;
        break;
      }
      default:
        break;
    }
  }

  return errors;
}

/**
 * Strips answers to nothing back out before submitting.
 *
 * The server drops them anyway, but sending `""` for an optional field makes
 * the request read as though somebody answered it.
 */
export function cleanAnswers(fields: FieldSpec[], answers: Answers): Answers {
  const out: Answers = {};
  for (const field of fields) {
    const value = answers[field.key];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (field.type === 'location') {
      const v = value as { city?: string };
      if (!v?.city?.trim()) continue;
    }
    out[field.key] = value;
  }
  return out;
}

export default function DynamicForm({
  fields,
  answers,
  errors,
  onChange,
  columns = 2,
}: {
  fields: FieldSpec[];
  answers: Answers;
  errors?: Record<string, string>;
  onChange: (key: string, value: unknown) => void;
  columns?: 1 | 2;
}) {
  if (fields.length === 0) return null;

  return (
    <div className={`grid gap-3 ${columns === 2 ? 'sm:grid-cols-2' : ''}`}>
      {fields.map((field) => (
        <Field key={field.key} field={field} error={errors?.[field.key]}>
          <Control field={field} value={answers[field.key]} onChange={onChange} />
        </Field>
      ))}
    </div>
  );
}

function Field({
  field,
  error,
  children,
}: {
  field: FieldSpec;
  error?: string;
  children: React.ReactNode;
}) {
  // A range and a location both need the full width to be readable.
  const wide = field.type === 'range' || field.type === 'location' || field.type === 'multi_select';
  return (
    <label className={`block text-sm ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="font-medium text-gray-700">
        {field.label}
        {field.required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {field.helpText && <span className="mt-1 block text-xs text-gray-500">{field.helpText}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

function Control({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}) {
  const c = field.constraints ?? {};
  const set = (v: unknown) => onChange(field.key, v);
  const text = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    set(e.target.value);

  switch (field.type) {
    case 'boolean':
      return (
        <span className="mt-1 flex items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={value === true}
            onChange={(e) => set(e.target.checked)}
          />
          <span className="text-gray-600">Yes</span>
        </span>
      );

    case 'number':
    case 'decimal':
    case 'currency':
      return (
        <input
          className="input mt-1"
          type="number"
          inputMode="decimal"
          step={field.type === 'number' ? 1 : (c.precision ? 10 ** -c.precision : 'any')}
          min={c.min}
          max={c.max}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={text}
        />
      );

    case 'duration':
      return (
        <span className="mt-1 flex items-center gap-2">
          <input
            className="input"
            type="number"
            min={c.min ?? 1}
            max={c.max}
            value={value === undefined || value === null ? '' : String(value)}
            onChange={text}
          />
          <span className="text-xs text-gray-500">{c.unit ?? 'hours'}</span>
        </span>
      );

    case 'single_select':
      return (
        <select className="input mt-1" value={String(value ?? '')} onChange={text}>
          <option value="">Choose…</option>
          {(c.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );

    case 'multi_select': {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      return (
        <span className="mt-1 flex flex-wrap gap-2">
          {(c.options ?? []).map((o) => {
            const on = chosen.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() =>
                  set(on ? chosen.filter((v) => v !== o.value) : [...chosen, o.value])
                }
                className={`rounded-full border px-3 py-1 text-xs ${
                  on
                    ? 'border-brand bg-brand text-brand-fg'
                    : 'border-gray-300 text-gray-700 hover:border-brand'
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </span>
      );
    }

    case 'date':
      return <input className="input mt-1" type="date" value={String(value ?? '')} onChange={text} />;

    case 'time':
      return <input className="input mt-1" type="time" value={String(value ?? '')} onChange={text} />;

    case 'date_time':
      return (
        <input
          className="input mt-1"
          type="datetime-local"
          // The server stores ISO with a Z; the input wants local without one.
          value={String(value ?? '').slice(0, 16)}
          onChange={(e) => set(e.target.value ? new Date(e.target.value).toISOString() : '')}
        />
      );

    case 'url':
      return (
        <input
          className="input mt-1"
          type="url"
          placeholder="https://"
          value={String(value ?? '')}
          onChange={text}
        />
      );

    case 'file': {
      const url = String(value ?? '');
      return (
        <span className="mt-1 flex flex-wrap items-center gap-2">
          <PhotoUploader label={url ? 'Replace' : 'Upload'} onUploaded={(u) => set(u)} />
          {url && (
            <>
              <a className="text-xs text-brand underline" href={url} target="_blank" rel="noreferrer">
                View
              </a>
              <button type="button" className="text-xs text-gray-500 underline" onClick={() => set('')}>
                Remove
              </button>
            </>
          )}
        </span>
      );
    }

    case 'location': {
      const v = (value ?? {}) as { label?: string; city?: string };
      return (
        <span className="mt-1 grid gap-2 sm:grid-cols-2">
          <input
            className="input"
            placeholder="City"
            value={v.city ?? ''}
            onChange={(e) => set({ ...v, city: e.target.value })}
          />
          <input
            className="input"
            placeholder="Venue or address (optional)"
            value={v.label ?? ''}
            onChange={(e) => set({ ...v, label: e.target.value })}
          />
        </span>
      );
    }

    case 'range': {
      const v = (value ?? {}) as { from?: number | string; to?: number | string };
      return (
        <span className="mt-1 flex items-center gap-2">
          <input
            className="input"
            type="number"
            placeholder="From"
            min={c.min}
            max={c.max}
            value={v.from ?? ''}
            onChange={(e) => set({ ...v, from: e.target.value })}
          />
          <span className="text-xs text-gray-500">to</span>
          <input
            className="input"
            type="number"
            placeholder="To"
            min={c.min}
            max={c.max}
            value={v.to ?? ''}
            onChange={(e) => set({ ...v, to: e.target.value })}
          />
        </span>
      );
    }

    case 'text':
    default:
      return (c.maxLength ?? 0) > 200 ? (
        <textarea
          className="input mt-1"
          rows={3}
          maxLength={c.maxLength}
          value={String(value ?? '')}
          onChange={text}
        />
      ) : (
        <input
          className="input mt-1"
          maxLength={c.maxLength}
          value={String(value ?? '')}
          onChange={text}
        />
      );
  }
}

/** Renders a stored answer back as something a person can read. */
export function formatAnswer(field: FieldSpec, value: unknown): string {
  if (value === undefined || value === null || value === '') return '-';

  switch (field.type) {
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'single_select':
      return field.constraints?.options?.find((o) => o.value === value)?.label ?? String(value);
    case 'multi_select': {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      if (chosen.length === 0) return '-';
      return chosen
        .map((v) => field.constraints?.options?.find((o) => o.value === v)?.label ?? v)
        .join(', ');
    }
    case 'duration':
      return `${value} ${field.constraints?.unit ?? 'hours'}`;
    case 'location': {
      const v = value as { label?: string; city?: string };
      return v.label && v.label !== v.city ? `${v.label}, ${v.city}` : (v.city ?? '-');
    }
    case 'range': {
      const v = value as { from?: number; to?: number };
      return `${v.from} – ${v.to}`;
    }
    case 'date_time':
      return new Date(String(value)).toLocaleString();
    default:
      return String(value);
  }
}

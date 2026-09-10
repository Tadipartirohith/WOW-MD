import { ChangeEvent } from 'react';
import PhotoUploader from './PhotoUploader';
import {
  type Answers,
  type FieldSpec,
  cleanAnswers,
  formatAnswer,
  validateAnswers,
} from '../lib/dynamic-form';

/**
 * The catalog's questions, rendered.
 *
 * The shape of a question and what counts as a valid answer to one now live in
 * lib/dynamic-form.ts, because the mobile app renders the same catalog forms
 * and the two clients have to agree about validity. They are re-exported here
 * so every existing `from './DynamicForm'` import keeps working, and because
 * this is still where somebody looking for them would think to look.
 */
export type { Answers, FieldSpec };
export { cleanAnswers, formatAnswer, validateAnswers };

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

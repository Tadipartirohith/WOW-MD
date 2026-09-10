/**
 * The catalog's own questions, and what a valid answer to one is.
 *
 * Split out of components/DynamicForm.tsx, which still re-exports every name
 * here so nothing that imported them had to move. The split exists because the
 * mobile app renders the same catalog forms and has to agree with this one
 * about what a valid answer is: a vendor entering a guest count on a phone that
 * the web client would refuse — or worse, the other way round — is the drift
 * this repository's sharing rule is written to prevent (see
 * mobile/src/shared/permissions.ts for the argument in full).
 *
 * Only the pure half moved. The component keeps the rendering, because that is
 * the half the two platforms genuinely cannot share: one draws `<select>` and
 * the other draws a sheet.
 */

/**
 * One question, exactly as the catalog describes it.
 *
 * This shape comes straight off `/catalog/services/:id` — the same rows the
 * server validates against. Nothing here is hand-written per vendor type,
 * which is the whole point: a new kind of service is configuration, and the
 * form component is what renders it.
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

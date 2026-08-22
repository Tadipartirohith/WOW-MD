/**
 * Dates, rendered for people rather than for machines.
 *
 * Every one of these takes the same view of an absent date: say so in words.
 * Rendering a null straight into JSX prints nothing, and rendering the string
 * "null" or a zero-epoch date prints something worse — a wedding apparently
 * scheduled for 1 January 1970. Both were reported, and both come from the
 * same missing decision about what "not set yet" looks like.
 */

/** What an unanswered date reads as. One wording, everywhere. */
export const NOT_SET = 'Date not set';

function parse(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();
  // The literal strings are not paranoia: a backend that stringifies a null and
  // a form that submits an empty select both produce exactly these.
  if (!text || text === 'null' || text === 'undefined' || text === '0') return null;

  // A bare YYYY-MM-DD is parsed as UTC midnight, which in India renders as the
  // previous day. Anchoring it to local midnight keeps the date somebody typed.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date(text);

  if (Number.isNaN(date.getTime())) return null;
  // Anything at or before the epoch is a zero date that has been through a
  // conversion, not a real one.
  if (date.getTime() <= 0) return null;
  return date;
}

/** "21 November 2026", or "Date not set". */
export function formatDate(value: string | null | undefined, fallback = NOT_SET): string {
  const date = parse(value);
  if (!date) return fallback;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "Sat, 21 Nov 2026" — for lists, where the weekday earns its space. */
export function formatShortDate(value: string | null | undefined, fallback = NOT_SET): string {
  const date = parse(value);
  if (!date) return fallback;
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(value: string | null | undefined, fallback = NOT_SET): string {
  const date = parse(value);
  if (!date) return fallback;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Whether there is a real date here at all. */
export function hasDate(value: string | null | undefined): boolean {
  return parse(value) !== null;
}

/**
 * "in 3 months", "in 12 days", "today", "2 days ago".
 *
 * Used where the distance matters more than the date — a task due in four days
 * is urgent in a way that "18 November" does not convey at a glance.
 */
export function relativeToToday(value: string | null | undefined, fallback = NOT_SET): string {
  const date = parse(value);
  if (!date) return fallback;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0 && days < 45) return `in ${days} days`;
  if (days < 0 && days > -45) return `${Math.abs(days)} days ago`;

  const months = Math.round(Math.abs(days) / 30);
  return days > 0 ? `in ${months} month${months === 1 ? '' : 's'}` : `${months} months ago`;
}

/** Days from today, negative for the past. Null when there is no date. */
export function daysAway(value: string | null | undefined): number | null {
  const date = parse(value);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

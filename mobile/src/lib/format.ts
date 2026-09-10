/**
 * Money and clock formatting, matching the web client's wording exactly.
 *
 * These are inline one-liners scattered across the web screens rather than a
 * module, so there is nothing to re-export from `src/shared`. They are copied
 * here — the smallest thing in this codebase worth copying, and the alternative
 * would be a shared module whose only purpose is two template strings.
 *
 * What matters is that the output matches: `en-IN` grouping puts the separators
 * where an Indian reader expects them (₹12,34,567, not ₹1,234,567), and a
 * marketplace that prints a lakh the wrong way looks like it was built
 * somewhere else.
 */

/** `₹12,34,567`. The dashboard and booking rows. */
export function rupees(value: string | number | null | undefined): string {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

/** `₹12,34,567.00`. The ledger, where the paise are part of the answer. */
export function rupeesExact(value: string | number | null | undefined): string {
  return `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

/** An amount in whatever currency the record carries, for quotations and cases. */
export function money(value: string | number | null | undefined, currency = 'INR'): string {
  if (currency === 'INR') return rupees(value);
  return `${currency} ${Number(value || 0).toLocaleString('en-IN')}`;
}

/** Postgres returns `HH:MM:SS`; everything on screen wants `HH:MM`. */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}

/** An enum value as words: `quotation_sent` when no label exists for it. */
export function humanise(value: string): string {
  return value.replace(/_/g, ' ');
}

/** `14 Mar 2026`, for a row that has room for a date and nothing more. */
export function shortDate(value: string | null | undefined): string {
  if (!value) return 'Date not set';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return 'Date not set';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** `14 March 2026, 09:30`, for a record that is about when something happened. */
export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

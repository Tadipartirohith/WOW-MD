import type { AxiosError } from 'axios';

/**
 * Pulls the human-readable message out of an error response.
 *
 * This read the wrong level for the whole life of the project. The API wraps
 * every failure in an envelope — `{statusCode, timestamp, path, error}` — and
 * puts the reason inside `error.message`; this looked for `message` at the top,
 * found nothing, and fell through to the caller's fallback. Every single
 * explanation the server produced was replaced by a generic sentence before it
 * reached anybody.
 *
 * That is the honest cause of a good share of the "X is not working" reports.
 * "That document could not be recorded" was, underneath, *this document is
 * already registered against another profile*. "That photo could not be
 * uploaded" was *that filename is not accepted*. The user was told the thing
 * had failed and never told why, so the only report they could write was that
 * it failed.
 *
 * Both shapes are read, because the envelope is the filter's and a network
 * error or a proxy's 502 page is neither.
 */
export function apiMessage(err: unknown, fallback = 'Something went wrong.'): string {
  const res = (err as AxiosError<ApiErrorBody>).response;
  const body = res?.data;
  const msg = body?.error?.message ?? body?.message;

  // class-validator returns one string per broken rule.
  if (Array.isArray(msg)) return msg.filter(Boolean).join('. ');
  if (typeof msg === 'string' && msg.trim()) return msg;

  // No envelope at all: the request never reached the API, or something in
  // front of it answered. Saying which is more use than a shrug.
  if (!res) return 'Could not reach the server. Check your connection and try again.';
  return fallback;
}

interface ApiErrorBody {
  message?: string | string[];
  error?: { message?: string | string[] };
}

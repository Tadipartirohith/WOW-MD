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
  const res = (err as ErrorWithResponse).response;
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

/**
 * Just enough of a rejected request to read, described structurally rather
 * than imported from axios.
 *
 * This file is shared with the mobile app, which reaches it across a project
 * boundary — and a file outside its own project resolves bare imports against
 * its own node_modules, not the importer's. `import type` looks free because
 * it emits nothing, but the type-checker still has to find the package, so it
 * broke the mobile build in CI while passing locally, where the web client's
 * node_modules happened to be sitting on disk. The rule the boundary actually
 * needs is that a shared module resolves nothing at all.
 */
interface ErrorWithResponse {
  response?: { data?: ApiErrorBody };
}

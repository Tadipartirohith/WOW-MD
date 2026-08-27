import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuth } from '../store/auth';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  // The refresh token is an httpOnly cookie, so every request must carry
  // credentials for the silent-refresh flow to work.
  withCredentials: true,
});

// Attach the access token to every request.
api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * Single-flight refresh. Several requests can 401 at once when a short-lived
 * access token expires; without this they would each fire their own refresh and
 * race to rotate the token — which the server now treats as reuse and punishes
 * by revoking the whole session family.
 */
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const { setAuth, clear } = useAuth.getState();
  try {
    // A bare axios call, so this request does not recurse through the
    // interceptor with the stale access token attached. The cookie travels
    // automatically.
    const { data } = await axios.post(
      `${api.defaults.baseURL}/auth/refresh`,
      {},
      { withCredentials: true },
    );
    setAuth(data);
    return data.accessToken as string;
  } catch {
    clear();
    return null;
  }
}

/**
 * Called once at start-up. If the refresh cookie is still valid the session is
 * restored without the user signing in again; otherwise they land on /login.
 */
export async function bootstrapSession(): Promise<void> {
  const token = await refreshAccessToken();
  if (!token) useAuth.getState().setReady(true);
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retried?: boolean };
    const url = original?.url ?? '';

    // Only a 401 is a token problem. A 403 means the account genuinely lacks the
    // permission, and refreshing would not change that — leave the caller to
    // surface the message rather than silently signing the user out.
    const isAuthRoute =
      url.includes('/auth/login') ||
      url.includes('/auth/refresh') ||
      url.includes('/auth/invitations');

    if (error.response?.status === 401 && original && !original._retried && !isAuthRoute) {
      original._retried = true;
      refreshing =
        refreshing ??
        refreshAccessToken().finally(() => {
          refreshing = null;
        });
      const token = await refreshing;
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
    }

    return Promise.reject(error);
  },
);

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

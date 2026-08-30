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

export { apiMessage } from './api-errors';

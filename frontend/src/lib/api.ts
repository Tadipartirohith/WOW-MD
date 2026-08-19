import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuth } from '../store/auth';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
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
 * race to rotate the token, invalidating one another.
 */
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken, setAuth, logout } = useAuth.getState();
  if (!refreshToken) {
    logout();
    return null;
  }
  try {
    // A bare axios call, so this request does not recurse through the
    // interceptor with the stale access token attached.
    const { data } = await axios.post(`${api.defaults.baseURL}/auth/refresh`, { refreshToken });
    setAuth(data);
    return data.accessToken as string;
  } catch {
    logout();
    return null;
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retried?: boolean };
    const url = original?.url ?? '';

    // Only a 401 is a token problem. A 403 means the account genuinely lacks the
    // permission, and refreshing would not change that — leave the caller to
    // surface the message rather than silently signing the user out.
    const isAuthRoute = url.includes('/auth/login') || url.includes('/auth/refresh');
    if (error.response?.status === 401 && original && !original._retried && !isAuthRoute) {
      original._retried = true;
      refreshing = refreshing ?? refreshAccessToken().finally(() => {
        refreshing = null;
      });
      const token = await refreshing;
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
    }

    if (error.response?.status === 401 && isAuthRoute) useAuth.getState().logout();
    return Promise.reject(error);
  },
);

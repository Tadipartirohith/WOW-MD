import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { useAuth, type AuthUser } from '@/store/auth';

/**
 * The API client.
 *
 * The web client's equivalent is not shared, and this is the one place where
 * not sharing is the right answer rather than a shortcut. There, the refresh
 * token is an httpOnly cookie the page cannot read and the browser attaches on
 * its own; here there is no cookie jar, so the app holds the token itself and
 * presents it in the body. The server tells the two apart by the absence of an
 * `Origin` header (see AuthController.isNativeClient) — `X-Client-Platform`
 * below only states the intent, it is not what is trusted.
 *
 * Everything above that line — the single-flight refresh, the retry, which
 * statuses count as a token problem — is the same reasoning as the web client,
 * and the comments there are worth reading alongside these.
 */
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8085/api';

/** Alphanumerics, dot, dash and underscore only: SecureStore rejects the rest. */
const REFRESH_KEY = 'wow.refreshToken';

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'X-Client-Platform': Platform.OS },
  // Only meaningful under `expo start --web`, where this app runs in a browser
  // and is served the cookie like any other page.
  withCredentials: true,
});

/**
 * The keystore, with the web build allowed to have none.
 *
 * `expo-secure-store` has no web implementation, and a browser build does not
 * need one: it is given the httpOnly cookie instead, which is strictly better
 * than anything this app could do with localStorage.
 */
const keystore = {
  async get(): Promise<string | null> {
    if (Platform.OS === 'web') return null;
    try {
      return await SecureStore.getItemAsync(REFRESH_KEY);
    } catch {
      return null;
    }
  },
  async set(token: string): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
      await SecureStore.setItemAsync(REFRESH_KEY, token, {
        // Available after the first unlock, so a notification tapped on a
        // locked phone still has a session by the time the app is open, and
        // never leaves the device in a backup.
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
    } catch {
      // A device that refuses the keystore still gets this session; it just
      // will not be signed in next launch.
    }
  },
  async clear(): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
      await SecureStore.deleteItemAsync(REFRESH_KEY);
    } catch {
      /* nothing to clear is not a failure */
    }
  },
};

api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** What /auth/login, /auth/register and /auth/refresh answer a native client. */
export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  /** Present only for a native client; a browser is sent the cookie instead. */
  refreshToken?: string;
}

/**
 * Stores what an auth response returned: the user and access token in memory,
 * the refresh token in the keystore.
 *
 * Called from login and from refresh alike, because the server rotates the
 * refresh token on every use — keeping the old one would present a spent
 * credential next launch, which the server treats as reuse and answers by
 * revoking the whole session family.
 */
export async function acceptAuth(data: AuthResponse): Promise<void> {
  if (data.refreshToken) await keystore.set(data.refreshToken);
  useAuth.getState().setAuth({ user: data.user, accessToken: data.accessToken });
}

export async function signOutLocally(): Promise<void> {
  await keystore.clear();
  useAuth.getState().clear();
}

/**
 * Signs out here and on the server.
 *
 * The server call is what actually revokes the refresh token; without it the
 * credential stays valid for thirty days on a phone the person may have signed
 * out of precisely because they are giving it away. It is still allowed to
 * fail — a device with no signal must be able to sign out of itself — so the
 * local clear happens either way.
 */
export async function signOut(): Promise<void> {
  const stored = await keystore.get();
  try {
    await api.post('/auth/logout', stored ? { refreshToken: stored } : {});
  } catch {
    /* revoked or unreachable; the local clear below is what the user asked for */
  }
  await signOutLocally();
}

/**
 * Single-flight refresh.
 *
 * Several requests can 401 at once when a short-lived access token expires.
 * Without this they would each fire their own refresh and race to rotate the
 * token, and the server — correctly — reads a rotated token presented twice as
 * reuse and revokes the family. So one refresh at a time, and everybody waits
 * on the same promise.
 */
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const stored = await keystore.get();
  // On web there is nothing to read and the cookie travels by itself; on a
  // device, no stored token means there is no session to restore.
  if (!stored && Platform.OS !== 'web') return null;

  try {
    // A bare axios call, so this does not recurse through the interceptor with
    // the stale access token attached.
    const { data } = await axios.post(
      `${BASE_URL}/auth/refresh`,
      stored ? { refreshToken: stored } : {},
      { headers: { 'X-Client-Platform': Platform.OS }, withCredentials: true },
    );
    await acceptAuth(data);
    return data.accessToken as string;
  } catch {
    await signOutLocally();
    return null;
  }
}

/**
 * Called once at start-up. A stored refresh token means the person stays signed
 * in across launches, which on a phone is not a convenience but the expectation.
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

    // Only a 401 is a token problem. A 403 means the account genuinely lacks
    // the permission, and refreshing would not change that.
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

export { apiMessage } from '@/shared/api-errors';

import { create } from 'zustand';
import type { OnboardingStage, PermissionValue, UserRole } from '../lib/permissions';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  /** Set when an agent onboarded this account. */
  managedByAgentId: string | null;
  isVerified: boolean;
  mfaEnabled: boolean;
  permissions: PermissionValue[];
  /**
   * True for an account the platform created after a match was fixed, until the
   * emailed temporary password is replaced. Every route but the reset itself is
   * refused server-side while this holds, so the app routes straight there.
   */
  mustResetPassword?: boolean;
  onboardingStage?: OnboardingStage;
}

interface AuthState {
  user: AuthUser | null;
  /** In memory only — see the note below. */
  accessToken: string | null;
  /** False until the boot-time refresh has settled, so routes do not flash. */
  ready: boolean;
  setAuth: (data: { user: AuthUser; accessToken: string }) => void;
  setPermissions: (permissions: PermissionValue[]) => void;
  setUser: (patch: Partial<AuthUser>) => void;
  setReady: (ready: boolean) => void;
  clear: () => void;
}

/**
 * Deliberately NOT persisted.
 *
 * Tokens used to be written to localStorage, which meant any XSS bug walked off
 * with a 30-day refresh token. Now the refresh token lives in an httpOnly
 * cookie the page cannot read, and the short-lived access token is held in
 * memory only. On reload we silently call /auth/refresh, and the cookie
 * re-establishes the session (see `bootstrapSession`).
 */
export const useAuth = create<AuthState>()((set) => ({
  user: null,
  accessToken: null,
  ready: false,
  setAuth: (data) => set({ user: data.user, accessToken: data.accessToken, ready: true }),
  setPermissions: (permissions) =>
    set((s) => (s.user ? { user: { ...s.user, permissions } } : s)),
  setUser: (patch) => set((s) => (s.user ? { user: { ...s.user, ...patch } } : s)),
  setReady: (ready) => set({ ready }),
  clear: () => set({ user: null, accessToken: null, ready: true }),
}));

/** Convenience selector for the capability checks used across the UI. */
export const usePermissions = (): PermissionValue[] => useAuth((s) => s.user?.permissions ?? []);

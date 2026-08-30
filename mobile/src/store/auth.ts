import { create } from 'zustand';

import type { OnboardingStage, PermissionValue, UserRole } from '@/shared/permissions';

/**
 * The signed-in account.
 *
 * The web client has an identical store, and it is deliberately NOT shared.
 * That file imports zustand; the two apps are on different majors of it (4.5
 * there, 5.0 here), and a store created by one copy of zustand and read through
 * the hooks of another is two registries pretending to be one. It fails as
 * state that silently stops updating, which is the worst way for it to fail.
 *
 * So the boundary rule is: only dependency-free modules cross it. The things
 * that genuinely must not drift — the permission matrix, notification wording,
 * error parsing, date formats — are pure, and those are shared (see
 * src/shared). Thirty lines of obvious state are not worth breaking the rule.
 */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  /** Set when an agent onboarded this account. */
  managedByAgentId: string | null;
  isVerified: boolean;
  mfaEnabled: boolean;
  permissions: PermissionValue[];
  /** Every route but the reset itself is refused server-side while this holds. */
  mustResetPassword?: boolean;
  onboardingStage?: OnboardingStage;
}

interface AuthState {
  user: AuthUser | null;
  /**
   * In memory only.
   *
   * The credential that survives a launch is the refresh token, and it lives in
   * the platform keystore rather than here (see lib/api). Keeping the short
   * access token in memory means a force-quit costs nothing and there is no
   * second copy of anything to keep in step.
   */
  accessToken: string | null;
  /** False until the boot-time refresh has settled, so routes do not flash. */
  ready: boolean;
  setAuth: (data: { user: AuthUser; accessToken: string }) => void;
  setUser: (patch: Partial<AuthUser>) => void;
  setReady: (ready: boolean) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>()((set) => ({
  user: null,
  accessToken: null,
  ready: false,
  setAuth: (data) => set({ user: data.user, accessToken: data.accessToken, ready: true }),
  setUser: (patch) => set((s) => (s.user ? { user: { ...s.user, ...patch } } : s)),
  setReady: (ready) => set({ ready }),
  clear: () => set({ user: null, accessToken: null, ready: true }),
}));

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PermissionValue, UserRole } from '../lib/permissions';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  /** Set when an agent onboarded this account. */
  managedByAgentId: string | null;
  permissions: PermissionValue[];
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  setAuth: (data: { user: AuthUser; accessToken: string; refreshToken: string }) => void;
  /** Refreshes the cached capability list without touching tokens. */
  setPermissions: (permissions: PermissionValue[]) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setAuth: (data) =>
        set({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken }),
      setPermissions: (permissions) =>
        set((s) => (s.user ? { user: { ...s.user, permissions } } : s)),
      logout: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    { name: 'wow-auth' },
  ),
);

/** Convenience selector for the capability checks used across the UI. */
export const usePermissions = (): PermissionValue[] => useAuth((s) => s.user?.permissions ?? []);

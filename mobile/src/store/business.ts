import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import { api } from '@/lib/api';
import { Permission, can } from '@/shared/permissions';
import { useAuth } from '@/store/auth';

/**
 * Which of a vendor's businesses every provider screen is about.
 *
 * One account can hold several — a caterer who also does photography — and the
 * platform treats each as its own business with its own catalog, calendar,
 * bookings, money and verification. The choice therefore has to span screens:
 * switching business on Availability and finding Bookings still showing the
 * other one is the confusion this exists to remove.
 *
 * The web client's `store/business.ts` is the same reasoning and is deliberately
 * NOT shared, for the reason recorded in src/shared/permissions and in
 * metro.config.js: that file imports zustand and react-query, the two apps are
 * on different majors of zustand, and a store created by one copy and read
 * through the hooks of another is two registries pretending to be one. Only
 * dependency-free modules cross the boundary. What does match is the storage
 * key's shape and the stale-id rule, because those are the parts that would
 * bite if they drifted.
 */
const KEY = 'wow.activeBusiness';

interface BusinessState {
  businessId: string | null;
  /** False until the stored id has been read back, so nothing picks the first
   *  business and then jumps to the remembered one in front of the user. */
  ready: boolean;
  setBusinessId: (id: string | null) => void;
  hydrate: () => Promise<void>;
}

export const useBusinessStore = create<BusinessState>((set) => ({
  businessId: null,
  ready: false,
  setBusinessId: (id) => {
    // Fire-and-forget: the store is the truth for this render, and a failed
    // write costs the selection next launch rather than this one.
    void (id ? AsyncStorage.setItem(KEY, id) : AsyncStorage.removeItem(KEY));
    set({ businessId: id });
  },
  hydrate: async () => {
    try {
      const saved = await AsyncStorage.getItem(KEY);
      set({ businessId: saved, ready: true });
    } catch {
      set({ ready: true });
    }
  },
}));

export interface BusinessSummary {
  id: string;
  name: string;
  category: string;
  status: string;
  isApproved: boolean;
  payoutAccountId?: string | null;
  /** Where the listing stands and why, for the screens that explain the lock. */
  decisionReason?: string | null;
  correctionFields?: string[] | null;
}

/**
 * The account's businesses, and which one is current.
 *
 * The stored id is checked against the list rather than trusted: a business
 * that was archived, or one left behind by a different account on the same
 * phone, would otherwise send every screen to a 403 with no way back. When it
 * does not match, the first business is used.
 */
export function useBusinesses() {
  const businessId = useBusinessStore((s) => s.businessId);
  const ready = useBusinessStore((s) => s.ready);
  const setBusinessId = useBusinessStore((s) => s.setBusinessId);
  const hydrate = useBusinessStore((s) => s.hydrate);

  useEffect(() => {
    if (!ready) void hydrate();
  }, [ready, hydrate]);

  /*
   * Only asked by somebody who could have a business.
   *
   * `enabled` rather than a role test, because the capability is what the
   * endpoint actually checks — and asking anyway would collect a 403 on every
   * screen for an account the client already knows cannot hold a listing.
   */
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isVendor = can(permissions, Permission.VENDOR_LISTING_MANAGE);

  const { data: businesses = [], isLoading } = useQuery<BusinessSummary[]>({
    queryKey: ['vendor-me'],
    queryFn: async () => (await api.get('/vendors/me')).data,
    enabled: isVendor,
    retry: false,
  });

  const known = businesses.some((b) => b.id === businessId);
  const activeId = known ? businessId : (businesses[0]?.id ?? null);
  const active = businesses.find((b) => b.id === activeId) ?? null;

  return { businesses, activeId, active, setBusinessId, isLoading, isVendor };
}

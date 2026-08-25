import { create } from 'zustand';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

/**
 * Which of a vendor's businesses everything else is about.
 *
 * One account can hold several — a caterer who also does photography — and the
 * platform treats each as its own business with its own catalog, calendar,
 * bookings, money and verification. Every one of those screens used to render
 * `listings[0]` and call it "your business", so the second business was
 * unreachable except through a per-page dropdown on the one page that had one.
 *
 * The choice is held here rather than in a URL parameter because it spans
 * pages: switching business on Availability and finding Bookings still showing
 * the other one is the confusion this exists to remove.
 *
 * Persisted so it survives a reload — losing the selection on every refresh
 * makes the switcher feel broken — but only the id is kept, and it is verified
 * against what the account actually holds before use.
 */
const KEY = 'wow.activeBusiness';

interface BusinessState {
  businessId: string | null;
  setBusinessId: (id: string | null) => void;
}

export const useBusinessStore = create<BusinessState>()((set) => ({
  businessId: typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null,
  setBusinessId: (id) => {
    if (typeof localStorage !== 'undefined') {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    }
    set({ businessId: id });
  },
}));

export interface BusinessSummary {
  id: string;
  name: string;
  category: string;
  status: string;
  isApproved: boolean;
}

/**
 * The account's businesses, and which one is current.
 *
 * The stored id is checked against the list rather than trusted: a business
 * that was archived, or a stale id left by a different account on a shared
 * machine, would otherwise send every page to a 403 with no way back. When it
 * does not match, the first business is used and the store is corrected.
 */
export function useBusinesses() {
  const businessId = useBusinessStore((s) => s.businessId);
  const setBusinessId = useBusinessStore((s) => s.setBusinessId);

  const { data: businesses = [], isLoading } = useQuery<BusinessSummary[]>({
    queryKey: ['vendor-me'],
    queryFn: async () => (await api.get('/vendors/me')).data,
    retry: false,
  });

  const known = businesses.some((b) => b.id === businessId);
  const activeId = known ? businessId : (businesses[0]?.id ?? null);
  const active = businesses.find((b) => b.id === activeId) ?? null;

  return { businesses, activeId, active, setBusinessId, isLoading, stale: Boolean(businessId) && !known };
}

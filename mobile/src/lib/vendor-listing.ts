import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

/**
 * The vendor's own business record, as `GET /vendors/me` answers it.
 *
 * The same endpoint the business switcher reads, under its own cache key, which
 * is what the web client does too: the switcher wants a name and a status for
 * each business, and this wants the whole row — the compliance numbers, the
 * portfolio, the papers, why it was sent back. Two keys over one endpoint costs
 * a request and keeps the summary from being invalidated every time a form
 * saves a field the switcher does not show.
 */
export interface VendorListing {
  id: string;
  name: string;
  category: string;
  otherCategory: string | null;
  city: string;
  description: string;
  gstNumber: string | null;
  panNumber: string | null;
  registrationNumber: string | null;
  tradingSince: string | null;
  registeredAddress: string | null;
  contactPhone: string | null;
  portfolio: string[];
  complianceDocuments: string[];
  isApproved: boolean;
  payoutAccountId: string | null;
  /** Where this business is in its life, from draft to live. */
  status: string;
  decisionReason: string | null;
  /**
   * When an administrator asked for a targeted correction, exactly which fields
   * the vendor may change before resubmitting. Null or empty means the listing
   * was reopened in full, or is not under a correction at all.
   */
  correctionFields?: string[] | null;
}

export function useMyListing() {
  return useQuery<VendorListing[]>({
    queryKey: ['my-listing'],
    queryFn: async () => (await api.get('/vendors/me')).data,
    // A provider who has not created a listing yet gets a 404; that is a normal
    // first-run state, not an error worth retrying.
    retry: false,
  });
}

/** The one this screen is about, or undefined before the switcher has settled. */
export function useActiveListing(activeId: string | null) {
  const query = useMyListing();
  return {
    ...query,
    listing: (query.data ?? []).find((l) => l.id === activeId),
  };
}

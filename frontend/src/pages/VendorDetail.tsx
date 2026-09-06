import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Permission, can } from '../lib/permissions';
import { useAuth } from '../store/auth';
import { EmptyState, Loading } from '../components/ui/Feedback';
import { Star, Storefront } from '@phosphor-icons/react';

/**
 * A single vendor's full profile (EZ1-I76).
 *
 * The listing card gives a couple a name and a cover; before they choose a
 * vendor they need the whole picture — the trade, how long the business has
 * run, its portfolio, the services and prices it offers, and what other couples
 * said. This is that page, and the request itself still runs through the
 * availability flow on the Vendors page so there is one booking path, not two.
 */
interface PublicVendor {
  id: string;
  name: string;
  category: string;
  otherCategory: string | null;
  description: string;
  city: string;
  portfolio: string[];
  ratingAvg: number;
  ratingCount: number;
  contactPhone: string | null;
  tradingSince: string | null;
}

interface Offering {
  id: string;
  name: string;
  description: string | null;
  price: string | null;
  currency: string;
  isPackage: boolean;
}

interface ServiceSummary {
  id: string;
  displayName: string | null;
  bookable: boolean;
  definition: { name: string } | null;
  category: { name: string } | null;
  offerings: Offering[];
}

interface Review {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  venue: 'Venue',
  catering: 'Catering',
  photography: 'Photography',
  decor: 'Decor',
  makeup: 'Makeup',
  entertainment: 'Entertainment',
  other: 'Other',
};

export default function VendorDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const canBook = can(permissions, Permission.BOOKING_CREATE);

  const { data: vendor, isLoading } = useQuery({
    queryKey: ['vendor', id],
    queryFn: async () => (await api.get(`/vendors/${id}`)).data as PublicVendor,
    enabled: Boolean(id),
    retry: false,
  });

  const { data: services = [] } = useQuery({
    queryKey: ['vendor-services', id],
    queryFn: async () => (await api.get(`/vendors/${id}/services`)).data as ServiceSummary[],
    enabled: Boolean(id),
    retry: false,
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['vendor-reviews', id],
    queryFn: async () => (await api.get(`/vendors/${id}/reviews`)).data as Review[],
    enabled: Boolean(id),
    retry: false,
  });

  if (isLoading) return <Loading rows={4} />;
  if (!vendor) {
    return (
      <EmptyState title="Vendor not found">
        This vendor is not available. It may have been removed or is not yet approved.
      </EmptyState>
    );
  }

  const category =
    vendor.category === 'other'
      ? (vendor.otherCategory ?? 'Other')
      : (CATEGORY_LABEL[vendor.category] ?? vendor.category);

  return (
    <div className="space-y-6">
      <Link to="/vendors" className="text-sm text-brand-dark underline">
        ← All vendors
      </Link>

      {/* Cover + headline */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-surface">
        <div className="relative aspect-[16/6] bg-surface-sunken">
          {vendor.portfolio?.[0] ? (
            <img src={vendor.portfolio[0]} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full w-full place-items-center text-gray-300">
              <Storefront size={32} weight="light" aria-hidden />
            </span>
          )}
        </div>
        <div className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="page-title">{vendor.name}</h1>
              <p className="text-sm text-gray-500">
                {[category, vendor.city].filter(Boolean).join(' · ')}
              </p>
            </div>
            {vendor.ratingCount > 0 && (
              <span className="flex items-center gap-1 text-sm text-gray-600">
                <Star size={14} weight="fill" className="text-caution-fg" aria-hidden />
                <span className="font-mono">{vendor.ratingAvg}</span>
                <span className="text-gray-400">({vendor.ratingCount})</span>
              </span>
            )}
          </div>
          {vendor.tradingSince && (
            <p className="mt-1 text-xs text-gray-500">
              Trading since {new Date(vendor.tradingSince).toLocaleDateString()}
            </p>
          )}
          {vendor.description && (
            <p className="mt-3 text-sm text-gray-700">{vendor.description}</p>
          )}
          {canBook && (
            <button
              className="btn mt-4"
              onClick={() => navigate(`/vendors?request=${vendor.id}`)}
            >
              Check availability &amp; request
            </button>
          )}
        </div>
      </div>

      {/* Portfolio gallery beyond the cover */}
      {vendor.portfolio.length > 1 && (
        <div>
          <h2 className="section-title mb-2">Portfolio</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {vendor.portfolio.slice(1).map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer">
                <img src={url} alt="" loading="lazy" className="aspect-square w-full rounded-sm object-cover" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Services and prices */}
      {services.length > 0 && (
        <div>
          <h2 className="section-title mb-2">Services &amp; pricing</h2>
          <div className="space-y-2">
            {services.map((svc) => (
              <div key={svc.id} className="card">
                <p className="font-medium text-gray-900">
                  {svc.displayName ?? svc.definition?.name ?? 'Service'}
                  {svc.category?.name && (
                    <span className="ml-2 text-xs font-normal text-gray-500">{svc.category.name}</span>
                  )}
                </p>
                {svc.offerings.length > 0 ? (
                  <ul className="mt-1 space-y-1 text-sm text-gray-700">
                    {svc.offerings.map((o) => (
                      <li key={o.id} className="flex items-baseline justify-between gap-3">
                        <span>
                          {o.name}
                          {o.isPackage && (
                            <span className="ml-1 text-xs text-gray-400">package</span>
                          )}
                        </span>
                        <span className="tabular-nums text-gray-600">
                          {o.price
                            ? `${o.currency} ${Number(o.price).toLocaleString('en-IN')}`
                            : 'On request'}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-gray-400">Priced on request.</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reviews */}
      {reviews.length > 0 && (
        <div>
          <h2 className="section-title mb-2">Reviews</h2>
          <div className="space-y-2">
            {reviews.map((r) => (
              <div key={r.id} className="card">
                <div className="flex items-center gap-1 text-sm text-gray-600">
                  <Star size={13} weight="fill" className="text-caution-fg" aria-hidden />
                  <span className="font-mono">{r.rating}</span>
                  <span className="ml-2 text-xs text-gray-400">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {r.comment && <p className="mt-1 text-sm text-gray-700">{r.comment}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CaretLeft } from '@phosphor-icons/react';
import { api, apiMessage } from '../../lib/api';
import { formatDate } from '../../lib/dates';
import { BOOKING_STATUS_LABEL } from '../../lib/permissions';
import { EmptyState, Loading } from '../../components/ui/Feedback';

/**
 * One vendor business in full (EZ1-I188).
 *
 * Reached by clicking a business on a vendor account. It exposes everything the
 * platform holds about the listing: business info and description, registration
 * and compliance, the whole services catalogue with its offerings and
 * concurrency (availability), uploaded documents, verification history and the
 * bookings taken against it.
 */

interface Offering {
  id: string;
  name: string;
  pricingModel: string;
  price: string | null;
  currency: string;
  unitLabel: string | null;
  isPackage: boolean;
  inclusions: string[];
  active: boolean;
}

interface ServiceRow {
  id: string;
  displayName: string | null;
  description: string | null;
  concurrentCapacity: number;
  active: boolean;
  offerings: Offering[];
}

interface BusinessDetail {
  business: {
    id: string;
    name: string;
    category: string;
    otherCategory: string | null;
    description: string | null;
    city: string | null;
    pricing: { currency?: string; startingAt?: number; unit?: string; notes?: string };
    portfolio: string[];
    ratingAvg: number;
    ratingCount: number;
    gstNumber: string | null;
    panNumber: string | null;
    registrationNumber: string | null;
    tradingSince: string | null;
    registeredAddress: string | null;
    contactPhone: string | null;
    complianceDocuments: string[];
    status: string;
    isApproved: boolean;
    submittedAt: string | null;
    verifiedAt: string | null;
    decisionReason: string | null;
    revisionCount: number;
    archivedAt: string | null;
    payoutAccountId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  owner: { id: string; email: string; role: string; isActive: boolean; phone: string | null; createdAt: string } | null;
  services: ServiceRow[];
  verifications: {
    id: string;
    status: string;
    applicantType: string;
    remarks: string | null;
    findings: { visited: boolean; observations: string; issues: string[]; recommendation: string } | null;
    decidedAt: string | null;
    submittedAt: string | null;
    createdAt: string;
  }[];
  bookings: {
    id: string;
    status: string;
    amount: string;
    currency: string;
    eventDate: string | null;
    createdAt: string;
    buyerName: string | null;
    serviceName: string | null;
    amountPaid: string;
  }[];
}

const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const price = (o: Offering) =>
  o.price === null
    ? o.pricingModel.replace(/_/g, ' ')
    : `${o.currency === 'INR' ? '₹' : `${o.currency} `}${Number(o.price).toLocaleString('en-IN')}${
        o.unitLabel ? ` / ${o.unitLabel}` : ''
      }`;

export default function AdminBusinessDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery<BusinessDetail>({
    queryKey: ['admin-business-detail', id],
    queryFn: async () => (await api.get(`/admin/businesses/${id}`)).data,
    retry: false,
  });

  const back = (
    <button onClick={() => navigate(-1)} className="btn-ghost btn-sm -ml-2 text-gray-500">
      <CaretLeft size={15} aria-hidden /> Back
    </button>
  );

  if (isLoading) return <Loading rows={6} />;
  if (error || !data)
    return (
      <div className="space-y-4">
        {back}
        <EmptyState title="Business not found">
          {apiMessage(error, 'That business could not be opened.')}
        </EmptyState>
      </div>
    );

  const b = data.business;

  return (
    <div className="space-y-5">
      {back}

      <div className="card bg-gradient-to-br from-brand-soft to-surface">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-brand-strong">Business</p>
            <h1 className="page-title truncate">{b.name}</h1>
            <p className="page-subtitle">
              {b.category === 'other' && b.otherCategory ? b.otherCategory : b.category}
              {b.city ? ` · ${b.city}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="pill bg-gray-100 text-gray-600">{b.status.replace(/_/g, ' ')}</span>
            <span className={`pill ${b.isApproved ? 'bg-positive-bg text-positive-fg' : 'bg-caution-bg text-caution-fg'}`}>
              {b.isApproved ? 'Live' : 'Not live'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Business info">
          <Row label="Category">
            {b.category === 'other' && b.otherCategory ? b.otherCategory : b.category}
          </Row>
          <Row label="City">{dash(b.city)}</Row>
          <Row label="Rating">
            {b.ratingCount > 0 ? `${b.ratingAvg.toFixed(1)} (${b.ratingCount})` : 'No ratings'}
          </Row>
          <Row label="Trading since">{b.tradingSince ? formatDate(b.tradingSince) : '—'}</Row>
          <Row label="Contact">{dash(b.contactPhone)}</Row>
          {data.owner && (
            <Link className="btn-outline btn-sm mt-2 w-full justify-center" to={`/admin/vendors/${data.owner.id}`}>
              Open owner account
            </Link>
          )}
        </Section>

        <Section title="Registration & compliance">
          <Row label="GST">{dash(b.gstNumber)}</Row>
          <Row label="PAN">{dash(b.panNumber)}</Row>
          <Row label="Registration no.">{dash(b.registrationNumber)}</Row>
          <Row label="Registered address">{dash(b.registeredAddress)}</Row>
          <Row label="Payout account">{b.payoutAccountId ? 'Linked' : 'Not linked'}</Row>
        </Section>

        <Section title="Lifecycle">
          <Row label="Status">{b.status.replace(/_/g, ' ')}</Row>
          <Row label="Submitted">{b.submittedAt ? formatDate(b.submittedAt) : '—'}</Row>
          <Row label="Verified">{b.verifiedAt ? formatDate(b.verifiedAt) : '—'}</Row>
          <Row label="Revisions">{String(b.revisionCount)}</Row>
          <Row label="Created">{formatDate(b.createdAt)}</Row>
        </Section>
      </div>

      {b.description && (
        <div className="card">
          <h2 className="section-title mb-1">Description</h2>
          <p className="whitespace-pre-line text-sm text-gray-700">{b.description}</p>
        </div>
      )}

      {b.decisionReason && (
        <div className="card">
          <h2 className="section-title mb-1">Latest decision note</h2>
          <p className="text-sm text-gray-700">{b.decisionReason}</p>
        </div>
      )}

      {/* Services & catalogue, with concurrency as the availability signal. */}
      <div className="card">
        <h2 className="section-title mb-1">Services &amp; catalogue</h2>
        {data.services.length === 0 ? (
          <p className="py-2 text-sm text-gray-400">No services listed.</p>
        ) : (
          <div className="space-y-4">
            {data.services.map((s) => (
              <div key={s.id} className="rounded-md border border-gray-100 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-gray-900">
                    {s.displayName || 'Service'}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-gray-500">
                    <span>Runs {s.concurrentCapacity} at once</span>
                    <span className={`pill ${s.active ? 'bg-positive-bg text-positive-fg' : 'bg-gray-100 text-gray-500'}`}>
                      {s.active ? 'Active' : 'Off'}
                    </span>
                  </span>
                </div>
                {s.description && <p className="mt-1 text-xs text-gray-500">{s.description}</p>}
                {s.offerings.length > 0 && (
                  <div className="mt-2 divide-y">
                    {s.offerings.map((o) => (
                      <div key={o.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate text-gray-800">{o.name}</span>
                          {o.isPackage && o.inclusions.length > 0 && (
                            <span className="text-xs text-gray-500">{o.inclusions.join(', ')}</span>
                          )}
                        </span>
                        <span className="whitespace-nowrap font-medium tabular-nums text-gray-900">
                          {price(o)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {(b.complianceDocuments.length > 0 || b.portfolio.length > 0) && (
        <div className="card">
          <h2 className="section-title mb-2">Documents &amp; portfolio</h2>
          <div className="flex flex-wrap gap-2">
            {b.complianceDocuments.map((src, i) => (
              <a
                key={`d${i}`}
                href={src}
                target="_blank"
                rel="noreferrer"
                className="pill bg-brand-soft text-brand-strong"
              >
                Document {i + 1}
              </a>
            ))}
            {b.portfolio.map((src, i) => (
              <img
                key={`p${i}`}
                src={src}
                alt={`Portfolio ${i + 1}`}
                className="h-24 w-24 rounded-md object-cover"
              />
            ))}
          </div>
        </div>
      )}

      {data.verifications.length > 0 && (
        <div className="card">
          <h2 className="section-title mb-2">Verification history</h2>
          <div className="divide-y">
            {data.verifications.map((v) => (
              <div key={v.id} className="py-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-700">
                    {v.decidedAt ? `Decided ${formatDate(v.decidedAt)}` : `Raised ${formatDate(v.createdAt)}`}
                  </span>
                  <span className="pill bg-gray-100 text-gray-600">{v.status.replace(/_/g, ' ')}</span>
                </div>
                {v.findings?.observations && (
                  <p className="mt-1 text-xs text-gray-500">{v.findings.observations}</p>
                )}
                {v.remarks && <p className="mt-1 text-xs text-gray-500">{v.remarks}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.bookings.length > 0 && (
        <div className="card">
          <h2 className="section-title mb-1">Bookings received</h2>
          <div className="divide-y">
            {data.bookings.map((bk) => (
              <Link
                key={bk.id}
                to={`/admin/bookings/${bk.id}`}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-brand-soft/40"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-gray-900">
                    {bk.buyerName ?? 'Customer'}
                    {bk.serviceName ? ` · ${bk.serviceName}` : ''}
                  </span>
                  <span className="text-xs text-gray-500">
                    {bk.eventDate ?? formatDate(bk.createdAt)} · #{bk.id.slice(0, 8)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium tabular-nums text-gray-900">
                    {bk.currency === 'INR' ? '₹' : `${bk.currency} `}
                    {Number(bk.amount).toLocaleString('en-IN')}
                  </span>
                  <span className="pill bg-brand-soft text-brand-strong">
                    {BOOKING_STATUS_LABEL[bk.status] ?? bk.status}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h2 className="section-title mb-2">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="truncate text-right font-medium text-gray-900">{children}</span>
    </div>
  );
}

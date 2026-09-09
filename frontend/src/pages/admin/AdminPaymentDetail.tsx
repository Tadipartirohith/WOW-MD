import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CaretLeft } from '@phosphor-icons/react';
import { api, apiMessage } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/dates';
import { BOOKING_STATUS_LABEL, MILESTONE_LABEL } from '../../lib/permissions';
import { EmptyState, Loading } from '../../components/ui/Feedback';

/**
 * One payment in full — the admin Payment Details view (EZ1-I202).
 *
 * The Payments list answers "who paid whom, how much"; this answers "and where
 * is that money now" — the escrow position across the whole booking, every
 * instalment, the gateway references, and a way through to the booking it sits
 * on. All of it is the one `/admin/transactions/:id` read.
 */

interface Payment {
  id: string;
  milestone: string;
  status: string;
  amount: string;
  commissionAmount: string;
  payoutAmount: string;
  currency: string;
  method: string;
  provider: string;
  providerRef: string | null;
  payoutRef: string | null;
  payoutNote: string | null;
  providerStatus: string | null;
  webhookVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PaymentDetail {
  payment: Payment;
  booking: {
    id: string;
    status: string;
    amount: string;
    currency: string;
    eventDate: string | null;
    createdAt: string;
  } | null;
  customer: {
    id: string;
    name: string | null;
    email: string;
    phone: string | null;
    role: string;
  } | null;
  provider: {
    id: string;
    ownerUserId?: string;
    name?: string;
    category?: string;
    type: string;
  } | null;
  service: { id: string; name: string | null } | null;
  event: {
    id: string;
    name: string;
    venue: string | null;
    city: string | null;
    eventDate: string | null;
    startTime: string | null;
  } | null;
  payments: Payment[];
  summary: {
    total: string;
    held: string;
    released: string;
    refunded: string;
    commission: string;
    payout: string;
  };
}

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  initiated: 'Initiated',
  held_in_escrow: 'Held in escrow',
  disputed: 'Disputed',
  released: 'Released',
  pending_payout: 'Pending payout',
  refunded: 'Refunded',
  partially_settled: 'Partially settled',
  failed: 'Failed',
};

const PAYMENT_STATUS_STYLE: Record<string, string> = {
  held_in_escrow: 'bg-amber-50 text-amber-800',
  released: 'bg-emerald-50 text-emerald-800',
  disputed: 'bg-red-50 text-red-700',
  refunded: 'bg-gray-100 text-gray-500',
  pending_payout: 'bg-sky-50 text-sky-800',
  partially_settled: 'bg-sky-50 text-sky-800',
  initiated: 'bg-gray-100 text-gray-600',
  failed: 'bg-red-50 text-red-700',
};

const money = (v: string | null | undefined, ccy = 'INR') =>
  `${ccy === 'INR' ? '₹' : `${ccy} `}${Number(v ?? 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
  })}`;

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`pill ${PAYMENT_STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {PAYMENT_STATUS_LABEL[status] ?? status.replace(/_/g, ' ')}
    </span>
  );
}

export default function AdminPaymentDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery<PaymentDetail>({
    queryKey: ['admin-payment-detail', id],
    queryFn: async () => (await api.get(`/admin/transactions/${id}`)).data,
    retry: false,
  });

  if (isLoading) return <Loading rows={6} />;
  if (error || !data)
    return (
      <div className="space-y-4">
        <BackLink />
        <EmptyState title="Payment not found">
          {apiMessage(error, 'That payment could not be opened.')}
        </EmptyState>
      </div>
    );

  const { payment, booking, customer, provider, service, event, payments, summary } = data;
  const ccy = payment.currency;
  const providerRoute =
    provider?.ownerUserId && provider.type === 'planner'
      ? `/admin/planners/${provider.ownerUserId}`
      : provider?.ownerUserId
        ? `/admin/vendors/${provider.ownerUserId}`
        : null;

  // The instalment breakdown, read off the booking's full payment set.
  const milestoneAmount = (m: string) =>
    payments.find((p) => p.milestone === m)?.amount ?? null;

  return (
    <div className="space-y-5">
      <BackLink />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Payment #{payment.id.slice(0, 8)}</h1>
          <p className="page-subtitle">
            {MILESTONE_LABEL[payment.milestone] ?? payment.milestone} ·{' '}
            {formatDateTime(payment.createdAt)}
          </p>
        </div>
        <StatusPill status={payment.status} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Transaction">
          <Row label="Transaction ID">
            <span className="font-mono text-xs">{payment.id}</span>
          </Row>
          <Row label="Instalment">{MILESTONE_LABEL[payment.milestone] ?? payment.milestone}</Row>
          <Row label="Amount">{money(payment.amount, ccy)}</Row>
          <Row label="Method">{payment.method?.toUpperCase() ?? '—'}</Row>
          <Row label="Payment status">
            <StatusPill status={payment.status} />
          </Row>
          <Row label="Created">{formatDateTime(payment.createdAt)}</Row>
          <Row label="Last updated">{formatDateTime(payment.updatedAt)}</Row>
        </Section>

        <Section title="Booking">
          {booking ? (
            <>
              <Row label="Booking ID">
                <Link
                  className="font-mono text-xs text-brand-strong hover:underline"
                  to={`/admin/bookings/${booking.id}`}
                >
                  {booking.id.slice(0, 8)}
                </Link>
              </Row>
              <Row label="Booking status">
                {BOOKING_STATUS_LABEL[booking.status] ?? booking.status}
              </Row>
              <Row label="Booking total">{money(booking.amount, booking.currency)}</Row>
              {booking.eventDate && <Row label="Event date">{formatDate(booking.eventDate)}</Row>}
              <Link className="btn-outline btn-sm mt-2" to={`/admin/bookings/${booking.id}`}>
                Open booking
              </Link>
            </>
          ) : (
            <p className="text-sm text-gray-400">Booking record missing.</p>
          )}
        </Section>

        <Section title="Parties">
          {customer ? (
            <>
              <Row label="Customer">{customer.name ?? customer.email}</Row>
              <Row label="Email">{customer.email}</Row>
              <Row label="Mobile">{customer.phone ?? '—'}</Row>
              <Link className="btn-outline btn-sm mb-2 mt-2" to={`/admin/clients/${customer.id}`}>
                Open customer
              </Link>
            </>
          ) : (
            <p className="text-sm text-gray-400">Customer record missing.</p>
          )}
          {provider && (
            <>
              <Row label="Provider">{provider.name ?? provider.id.slice(0, 8)}</Row>
              <Row label="Type">{provider.category ?? provider.type}</Row>
              {providerRoute && (
                <Link className="btn-outline btn-sm mt-2" to={providerRoute}>
                  Open provider
                </Link>
              )}
            </>
          )}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Service & event">
          <Row label="Service / package">{service?.name ?? '—'}</Row>
          {event ? (
            <>
              <Row label="Event">{event.name}</Row>
              {event.venue && <Row label="Venue">{event.venue}</Row>}
              {event.city && <Row label="City">{event.city}</Row>}
              {event.eventDate && <Row label="Event date">{formatDate(event.eventDate)}</Row>}
              {event.startTime && <Row label="Starts">{event.startTime}</Row>}
            </>
          ) : (
            <Row label="Event">—</Row>
          )}
        </Section>

        <Section title="Gateway">
          <Row label="Gateway">{payment.provider ?? '—'}</Row>
          <Row label="Gateway reference">
            <span className="font-mono text-xs">{payment.providerRef ?? '—'}</span>
          </Row>
          <Row label="Payout reference">
            <span className="font-mono text-xs">{payment.payoutRef ?? '—'}</span>
          </Row>
          <Row label="Gateway status">{payment.providerStatus ?? '—'}</Row>
          <Row label="Webhook verified">
            {payment.webhookVerifiedAt ? formatDateTime(payment.webhookVerifiedAt) : '—'}
          </Row>
          {payment.payoutNote && <Row label="Payout note">{payment.payoutNote}</Row>}
        </Section>
      </div>

      <Section title="Amounts & escrow">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Booking total" value={money(summary.total, ccy)} />
          <Stat label="Advance" value={money(milestoneAmount('advance'), ccy)} />
          <Stat label="Second" value={money(milestoneAmount('second'), ccy)} />
          <Stat label="Final" value={money(milestoneAmount('final'), ccy)} />
          <Stat label="Held in escrow" value={money(summary.held, ccy)} tone="text-amber-700" />
          <Stat label="Released" value={money(summary.released, ccy)} tone="text-emerald-700" />
          <Stat label="Refunded" value={money(summary.refunded, ccy)} />
          <Stat label="Commission" value={money(summary.commission, ccy)} />
          <Stat label="Payout" value={money(summary.payout, ccy)} />
        </div>
      </Section>

      <Section title="Payment history">
        {payments.length === 0 ? (
          <p className="text-sm text-gray-400">No payments recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full min-w-[640px] text-sm"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Instalment</th>
                  <th className="py-2 pr-3 text-right">Amount</th>
                  <th className="py-2 pr-3 text-right">Payout</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {payments.map((p) => (
                  <tr key={p.id} className={p.id === payment.id ? 'bg-surface-sunken' : undefined}>
                    <td className="py-2 pr-3 text-gray-600">{formatDateTime(p.createdAt)}</td>
                    <td className="py-2 pr-3">{MILESTONE_LABEL[p.milestone] ?? p.milestone}</td>
                    <td className="py-2 pr-3 text-right">{money(p.amount, p.currency)}</td>
                    <td className="py-2 pr-3 text-right text-gray-600">
                      {money(p.payoutAmount, p.currency)}
                    </td>
                    <td className="py-2">
                      <StatusPill status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );

  function BackLink() {
    return (
      <button
        onClick={() => navigate('/admin/payments')}
        className="btn-ghost btn-sm -ml-2 text-gray-500"
      >
        <CaretLeft size={15} aria-hidden /> Back to payments
      </button>
    );
  }
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-surface-sunken px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-sm font-semibold tabular-nums ${tone ?? 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

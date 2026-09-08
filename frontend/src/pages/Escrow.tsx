import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Vault } from '@phosphor-icons/react';
import { api, apiMessage } from '../lib/api';
import { MILESTONE_LABEL } from '../lib/permissions';
import { EmptyState, Loading } from '../components/ui/Feedback';

interface EscrowPayment {
  paymentId: string;
  milestone: string;
  status: string;
  amount: string;
  method: string;
  reference: string | null;
  payoutRef: string | null;
  createdAt: string;
  updatedAt: string;
}

interface EscrowRecord {
  bookingId: string;
  providerType: 'vendor' | 'planner';
  providerName: string;
  serviceName: string | null;
  eventDate: string | null;
  bookingAmount: string;
  currency: string;
  status: string;
  heldInEscrow: string;
  released: string;
  refunded: string;
  payments: EscrowPayment[];
}

interface Escrow {
  currency: string;
  heldInEscrow: string;
  released: string;
  refunded: string;
  records: EscrowRecord[];
}

/**
 * Buyer-facing wording for a payment's escrow status. The provider's Accounts
 * page reads the same states from the other side ("Paid out to you"); here they
 * are told in the language of the person whose money it is.
 */
const STATUS_LABEL: Record<string, string> = {
  initiated: 'Processing',
  held_in_escrow: 'Held in escrow',
  disputed: 'Frozen: case open',
  pending_payout: 'Released to provider',
  released: 'Released to provider',
  partially_settled: 'Part settled',
  refunded: 'Refunded to you',
};

const STATUS_STYLE: Record<string, string> = {
  initiated: 'bg-gray-100 text-gray-600',
  held_in_escrow: 'bg-amber-50 text-amber-800',
  disputed: 'bg-red-50 text-red-700',
  pending_payout: 'bg-emerald-50 text-emerald-800',
  released: 'bg-emerald-50 text-emerald-800',
  partially_settled: 'bg-sky-50 text-sky-800',
  refunded: 'bg-gray-100 text-gray-500',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-600'
      }`}
    >
      {STATUS_LABEL[status] ?? status.replace(/_/g, ' ')}
    </span>
  );
}

/**
 * The couple's escrow, across every booking (EZ1-I148).
 *
 * Bookings shows one booking's instalments at a time; this is the money view —
 * what has been paid in, what is still held safe, what has gone to the provider
 * and what has come back. All of it is the caller's own: the server scopes it
 * to the money they themselves paid.
 */
export default function Escrow() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery<Escrow>({
    queryKey: ['escrow'],
    queryFn: async () => (await api.get('/bookings/escrow')).data,
    retry: false,
  });

  const money = (value: string, currency = data?.currency ?? 'INR') =>
    `${currency === 'INR' ? '₹' : ''}${Number(value).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
    })}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Escrow</h1>
        <p className="page-subtitle">
          Money you have paid into your bookings, held safely until the work is done. Pay and track
          each instalment on the <Link className="text-brand underline" to="/bookings">Bookings</Link>{' '}
          page.
        </p>
      </div>

      {isLoading && <Loading rows={3} />}

      {isError && (
        <p className="alert-critical">{apiMessage(error, 'Your escrow could not be loaded.')}</p>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Figure
              label="Held in escrow"
              value={money(data.heldInEscrow)}
              tone="text-amber-700"
              note="Held safe until the work is signed off"
            />
            <Figure
              label="Released to provider"
              value={money(data.released)}
              tone="text-emerald-700"
              note="Left escrow once the work was done"
            />
            <Figure
              label="Refunded to you"
              value={money(data.refunded)}
              note="Returned on a cancellation"
            />
          </div>

          {data.records.length === 0 ? (
            <div className="card">
              <EmptyState icon={Vault} title="No escrow transactions">
                Once you pay an instalment on a booking, the money is held here in escrow until the
                provider completes the work.
              </EmptyState>
            </div>
          ) : (
            <div className="space-y-3">
              {data.records.map((r) => (
                <div key={r.bookingId} className="card space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">
                        {r.providerName}
                        {r.serviceName && (
                          <span className="font-normal text-gray-500"> · {r.serviceName}</span>
                        )}
                      </p>
                      <p className="text-sm text-gray-500">
                        <span className="uppercase tracking-wide text-gray-400">
                          {r.providerType}
                        </span>
                        {Number(r.bookingAmount) > 0
                          ? ` · ${money(r.bookingAmount, r.currency)}`
                          : ''}
                        {r.eventDate ? ` · ${r.eventDate}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={r.status} />
                      <button
                        className="btn-outline"
                        onClick={() => setExpanded(expanded === r.bookingId ? null : r.bookingId)}
                        aria-expanded={expanded === r.bookingId}
                      >
                        {expanded === r.bookingId ? 'Hide' : 'Details'}
                      </button>
                    </div>
                  </div>

                  {/* Per-booking money split, so a glance says where it sits. */}
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
                    {Number(r.heldInEscrow) > 0 && (
                      <span>
                        In escrow{' '}
                        <span className="font-medium text-amber-700">
                          {money(r.heldInEscrow, r.currency)}
                        </span>
                      </span>
                    )}
                    {Number(r.released) > 0 && (
                      <span>
                        Released{' '}
                        <span className="font-medium text-emerald-700">
                          {money(r.released, r.currency)}
                        </span>
                      </span>
                    )}
                    {Number(r.refunded) > 0 && (
                      <span>
                        Refunded{' '}
                        <span className="font-medium text-gray-600">
                          {money(r.refunded, r.currency)}
                        </span>
                      </span>
                    )}
                  </div>

                  {expanded === r.bookingId && (
                    <div className="border-t pt-3">
                      <h3 className="section-title text-sm">Escrow timeline</h3>
                      <ol className="mt-2 space-y-3 border-l-2 border-gray-200 pl-3">
                        {r.payments.map((p) => (
                          <li key={p.paymentId} className="text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium text-gray-800">
                                {MILESTONE_LABEL[p.milestone] ?? p.milestone}
                                <span className="ml-2 font-normal tabular-nums text-gray-500">
                                  {money(p.amount, r.currency)}
                                </span>
                              </span>
                              <StatusBadge status={p.status} />
                            </div>
                            <p className="mt-0.5 text-xs text-gray-400">
                              Paid {new Date(p.createdAt).toLocaleString()}
                              {p.updatedAt && p.updatedAt !== p.createdAt
                                ? ` · updated ${new Date(p.updatedAt).toLocaleString()}`
                                : ''}
                              {p.method === 'cash' ? ' · paid in cash (not held in escrow)' : ''}
                            </p>
                            {(p.reference || p.payoutRef) && (
                              <p className="mt-0.5 font-mono text-xs text-gray-400">
                                {p.reference ? `Ref ${p.reference}` : ''}
                                {p.payoutRef ? ` · Payout ${p.payoutRef}` : ''}
                              </p>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: string;
  tone?: string;
  note: string;
}) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${tone ?? 'text-gray-900'}`}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-gray-500">{note}</p>
    </div>
  );
}

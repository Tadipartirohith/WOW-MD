import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { MILESTONE_LABEL } from '../lib/permissions';

interface LedgerRow {
  paymentId: string;
  bookingId: string;
  milestone: string;
  status: string;
  amount: string;
  commissionAmount: string;
  payoutAmount: string;
  confirmedAt: string | null;
  createdAt: string;
}

interface Earnings {
  heldInEscrow: string;
  released: string;
  refunded: string;
  commission: string;
  gross: string;
  currency: string;
  ledger: LedgerRow[];
}

const STATUS_LABEL: Record<string, string> = {
  initiated: 'Starting',
  held_in_escrow: 'In escrow',
  disputed: 'Frozen — case open',
  released: 'Paid out',
  refunded: 'Refunded',
  partially_settled: 'Part settled',
};

const STATUS_STYLE: Record<string, string> = {
  initiated: 'bg-gray-100 text-gray-600',
  held_in_escrow: 'bg-amber-50 text-amber-800',
  disputed: 'bg-red-50 text-red-700',
  released: 'bg-emerald-50 text-emerald-800',
  refunded: 'bg-gray-100 text-gray-500',
  partially_settled: 'bg-sky-50 text-sky-800',
};

/**
 * The provider's money.
 *
 * Held and paid out are shown as separate figures because they answer different
 * questions: one is what the marketplace owes them, the other is what has
 * already reached their bank. Adding them together would flatter the balance
 * and mislead somebody deciding whether they can pay their own suppliers.
 */
export default function Accounts() {
  const { data, isLoading } = useQuery<Earnings>({
    queryKey: ['earnings'],
    queryFn: async () => (await api.get('/bookings/earnings')).data,
  });

  const money = (value: string) =>
    `${data?.currency === 'INR' ? '₹' : ''}${Number(value).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
    })}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-brand-dark">Accounts</h1>
        <p className="text-sm text-gray-600">
          Every rupee that has moved through your bookings, and where it currently sits.
        </p>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Figure
              label="Paid out to you"
              value={money(data.released)}
              tone="text-emerald-700"
              note="Already released from escrow"
            />
            <Figure
              label="Held in escrow"
              value={money(data.heldInEscrow)}
              tone="text-amber-700"
              note="Yours once the work is signed off"
            />
            <Figure
              label="Platform commission"
              value={money(data.commission)}
              note="Deducted from released payments"
            />
            <Figure
              label="Refunded"
              value={money(data.refunded)}
              note="Returned to the buyer"
            />
          </div>

          <div className="card overflow-x-auto">
            <h2 className="mb-3 font-semibold text-gray-900">Ledger</h2>
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Booking</th>
                  <th className="pb-2">Instalment</th>
                  <th className="pb-2 text-right">Charged</th>
                  <th className="pb-2 text-right">Commission</th>
                  <th className="pb-2 text-right">Your share</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {data.ledger.map((row) => (
                  <tr key={row.paymentId}>
                    <td className="py-2 text-gray-600">
                      {new Date(row.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2 font-mono text-xs text-gray-500">
                      {row.bookingId.slice(0, 8)}
                    </td>
                    <td className="py-2">{MILESTONE_LABEL[row.milestone] ?? row.milestone}</td>
                    <td className="py-2 text-right">{money(row.amount)}</td>
                    <td className="py-2 text-right text-gray-500">
                      −{money(row.commissionAmount)}
                    </td>
                    <td className="py-2 text-right font-medium">{money(row.payoutAmount)}</td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${
                          STATUS_STYLE[row.status] ?? 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {STATUS_LABEL[row.status] ?? row.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {data.ledger.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-gray-400">
                      No payments yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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

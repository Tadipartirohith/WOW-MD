import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';

interface AgencyCharge {
  id: string;
  amount: string;
  currency: string;
  status:
    | 'initiated'
    | 'held_in_escrow'
    | 'disputed'
    | 'released'
    | 'pending_payout'
    | 'refunded'
    | 'partially_settled'
    | 'failed';
  createdAt: string;
  paidAt: string | null;
}

/**
 * A managed client's view of the agency settlement fee raised when their match
 * is fixed (EZ1-I209). Shows the applicable fee and, while it is unpaid, a
 * "Pay Agency Fee" action that places the amount into escrow; once paid it
 * reflects the held status and, after the agency is settled, the paid status.
 *
 * Renders nothing for a client with no agency fee — a directly-registered user
 * with no agent has no charge, so the list comes back empty and there is no
 * card.
 */
export default function AgencyFeeCard() {
  const qc = useQueryClient();
  const { data, error: loadError } = useQuery({
    queryKey: ['my-charges'],
    queryFn: async () => (await api.get('/agents/my-charges')).data as AgencyCharge[],
    retry: false,
  });

  const pay = useMutation({
    mutationFn: async (chargeId: string) =>
      (await api.put(`/agents/charges/${chargeId}/pay`)).data as AgencyCharge,
    onSuccess: () => {
      // Refetch so the row reflects its new held/paid status.
      qc.invalidateQueries({ queryKey: ['my-charges'] });
    },
  });

  const charges = data ?? [];
  if (charges.length === 0) return null;

  return (
    <section className="card space-y-2">
      <div>
        <h3 className="section-title text-sm">Agency fee</h3>
        <p className="text-sm text-gray-600">
          A <span className="font-medium">match settlement</span> fee is held in escrow when you
          pay it and reaches your agency only once your match is fixed.
        </p>
      </div>

      <div className="divide-y">
        {charges.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div>
              <span className="tabular-nums font-medium text-gray-900">
                {c.currency} {c.amount}
              </span>
              <span className="ml-2 text-xs text-gray-500">{statusLabel(c.status)}</span>
            </div>
            {c.status === 'initiated' ? (
              <button
                type="button"
                className="btn"
                disabled={pay.isPending}
                onClick={() => pay.mutate(c.id)}
              >
                {pay.isPending ? 'Paying…' : 'Pay Agency Fee'}
              </button>
            ) : (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600">
                {c.status.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        ))}
      </div>

      {pay.isError && (
        <p className="text-sm text-red-600">
          {apiMessage(pay.error, 'That payment could not be completed.')}
        </p>
      )}
      {loadError && (
        <p className="text-sm text-gray-500">Your agency fees could not be loaded just now.</p>
      )}
    </section>
  );
}

function statusLabel(status: AgencyCharge['status']): string {
  switch (status) {
    case 'initiated':
      return 'Due now';
    case 'held_in_escrow':
      return 'Paid — held in escrow until your match is fixed';
    case 'released':
      return 'Paid and settled to your agency';
    case 'refunded':
      return 'Refunded';
    case 'disputed':
      return 'Held pending a case';
    default:
      return '';
  }
}

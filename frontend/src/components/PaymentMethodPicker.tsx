import { useQuery } from '@tanstack/react-query';
import { Warning } from '@phosphor-icons/react';
import { api } from '../lib/api';

/**
 * How this instalment is being paid.
 *
 * The list is asked for, never hard-coded. A copy in the client is a second
 * copy of a decision the server already owns, and the two disagree the first
 * time an operator turns netbanking off — leaving a button whose only effect
 * is a refusal, which is how a working platform starts looking broken.
 *
 * Cash is shown apart from the others and carries a warning, because choosing
 * it changes what the buyer is agreeing to rather than only how they pay: the
 * platform never receives the money, so there is nothing for it to hold, and
 * nothing to give back if the day goes wrong. That is a sentence somebody
 * should read before they tap it, not something to discover during a dispute.
 */

export interface PaymentMethods {
  methods: string[];
  currency: string;
  cash: { enabled: boolean; maxAmount: number };
}

const LABEL: Record<string, string> = {
  card: 'Card',
  upi: 'UPI',
  netbanking: 'Net banking',
  cash: 'Cash',
};

export function usePaymentMethods() {
  return useQuery<PaymentMethods>({
    queryKey: ['payment-methods'],
    queryFn: async () => (await api.get('/payments/methods')).data,
    // This changes when an operator edits configuration and restarts, which is
    // not something worth re-asking about on every render.
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}

export default function PaymentMethodPicker({
  value,
  onChange,
  amount,
}: {
  value: string;
  onChange: (method: string) => void;
  /** This instalment, so the cash ceiling can be judged before it is refused. */
  amount?: string | number;
}) {
  const { data } = usePaymentMethods();
  const available = data?.methods ?? [];
  if (available.length <= 1) return null;

  const cashChosen = value === 'cash';
  const overCap =
    cashChosen &&
    data?.cash.maxAmount != null &&
    Number(amount) > Number(data.cash.maxAmount);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {available.map((m) => {
          const active = m === value;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(m)}
              className={`rounded-full border px-3 py-1 text-sm transition ${
                active
                  ? 'border-brand bg-brand-light text-brand-strong'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {LABEL[m] ?? m}
            </button>
          );
        })}
      </div>

      {cashChosen && (
        <p className="flex items-start gap-2 rounded-sm bg-amber-50 p-2 text-xs text-amber-900">
          <Warning size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Cash is paid directly to the provider, so it is not held in escrow. The platform
            cannot refund it if something goes wrong.
            {data?.cash.maxAmount
              ? ` Up to ${data.currency} ${Number(data.cash.maxAmount).toLocaleString('en-IN')} an instalment.`
              : ''}
          </span>
        </p>
      )}

      {/*
        Said before the button is pressed rather than after.

        The server refuses this, and correctly — but a refusal arriving after a
        tap reads as a fault in the page, where the same sentence beforehand
        reads as a rule.
      */}
      {overCap && (
        <p className="alert-critical text-xs">
          This instalment is above the cash limit. Pay this one online.
        </p>
      )}
    </div>
  );
}

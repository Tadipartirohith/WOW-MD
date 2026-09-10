import { useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { rupeesExact, shortDate } from '@/lib/format';
import { MILESTONE_LABEL, Permission, can } from '@/shared/permissions';
import { Badge, Divider, StatTile, TileGrid, type Tone } from '@/components/chrome';
import { PayoutAccount } from '@/components/accounts/payout-account';
import { ListScreen } from '@/components/layout';
import { BusinessSwitcher } from '@/components/business/switcher';
import { Body, Button, Caption, Card, PageSubtitle } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { useBusinesses } from '@/store/business';
import { radius, rgb, space, useTheme } from '@/theme';

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
  /** Earned and owed, but not yet transferred — usually payout onboarding. */
  pendingPayout: string;
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
  disputed: 'Frozen: case open',
  released: 'Paid out',
  pending_payout: 'Owed to you',
  refunded: 'Refunded',
  partially_settled: 'Part settled',
};

const STATUS_TONE: Record<string, Tone> = {
  initiated: 'neutral',
  held_in_escrow: 'caution',
  disputed: 'critical',
  released: 'positive',
  refunded: 'neutral',
  partially_settled: 'brand',
};

/**
 * The provider's money.
 *
 * Held and paid out are shown as separate figures because they answer different
 * questions: one is what the marketplace owes them, the other is what has
 * already reached their bank. Adding them together would flatter the balance
 * and mislead somebody deciding whether they can pay their own suppliers.
 *
 * The web page renders the ledger as a seven-column table with a horizontal
 * scroll. That does not survive a phone at any font size worth reading, so each
 * payment is a card instead — the same seven facts, stacked, with the figure
 * that matters set largest.
 */
export default function Accounts() {
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isVendor = can(permissions, Permission.VENDOR_LISTING_MANAGE);
  const { activeId } = useBusinesses();

  const { data, isPending, isFetching, refetch } = useQuery<Earnings>({
    queryKey: ['earnings'],
    queryFn: async () => (await api.get('/bookings/earnings')).data,
  });

  // The vendor's payout account lives here, not in My Business.
  const { data: payout } = useQuery<{ payoutAccountId: string | null } | null>({
    queryKey: ['payout-account', activeId],
    enabled: isVendor && Boolean(activeId),
    queryFn: async () => {
      const listings = (await api.get('/vendors/me')).data as {
        id: string;
        payoutAccountId: string | null;
      }[];
      return listings.find((l) => l.id === activeId) ?? null;
    },
    retry: false,
  });

  return (
    <ListScreen
      header={
        <>
          <View style={{ gap: space(1) }}>
            <PageSubtitle>
              Every rupee that has moved through your bookings, and where it currently sits.
            </PageSubtitle>
          </View>

          <BusinessSwitcher />

          {isVendor && activeId ? (
            <PayoutAccount vendorId={activeId} current={payout?.payoutAccountId ?? null} />
          ) : null}

          {data && (
            <TileGrid>
              <StatTile
                label="Paid out to you"
                value={rupeesExact(data.released)}
                hint="Already released from escrow"
                tone="positive"
              />
              <StatTile
                label="Held in escrow"
                value={rupeesExact(data.heldInEscrow)}
                hint="Yours once the work is signed off"
                tone="caution"
              />
              {/*
                Only shown when there is some. "Owed" is a different fact from
                "held" — the work is done and the money is no longer the
                buyer's — and a provider seeing a zero here every day would
                stop reading it.
              */}
              {Number(data.pendingPayout) > 0 && (
                <StatTile
                  label="Owed to you"
                  value={rupeesExact(data.pendingPayout)}
                  hint="Earned. Waiting on a payout account to send it to."
                  tone="caution"
                />
              )}
              <StatTile
                label="Platform commission"
                value={rupeesExact(data.commission)}
                hint="Deducted from released payments"
              />
              <StatTile
                label="Refunded"
                value={rupeesExact(data.refunded)}
                hint="Returned to the buyer"
              />
            </TileGrid>
          )}

          <View style={{ gap: space(1) }}>
            <Body style={{ fontWeight: '600' }}>Ledger</Body>
            <Caption tone="faint">Every instalment, and what your share of it was.</Caption>
          </View>
        </>
      }
      data={data?.ledger ?? []}
      keyExtractor={(row) => row.paymentId}
      loading={isPending}
      refreshing={isFetching && !isPending}
      onRefresh={() => void refetch()}
      emptyTitle="No payments yet"
      emptyBody="Money appears here once a booking has been paid for."
      renderItem={(row) => <LedgerCard row={row} />}
    />
  );
}

function LedgerCard({ row }: { row: LedgerRow }) {
  const theme = useTheme();
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
        <View style={{ flex: 1, gap: space(0.5) }}>
          <Body>{MILESTONE_LABEL[row.milestone] ?? row.milestone}</Body>
          <Caption tone="faint">
            Booking {row.bookingId.slice(0, 8)} · {shortDate(row.createdAt)}
          </Caption>
        </View>
        <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>
          {STATUS_LABEL[row.status] ?? row.status}
        </Badge>
      </View>

      <Divider />

      <View style={{ gap: space(1) }}>
        <Line label="Charged" value={rupeesExact(row.amount)} />
        <Line label="Commission" value={`−${rupeesExact(row.commissionAmount)}`} muted />
        <Line label="Your share" value={rupeesExact(row.payoutAmount)} strong />
      </View>

      {/*
        Only where the money is stuck. A "settle my payment" button beside every
        row would be a button people press on payments that are working, and the
        desk would fill with requests that have no answer.
      */}
      {row.status === 'pending_payout' ? <SettleMyPayment bookingId={row.bookingId} /> : null}

      {row.confirmedAt ? (
        <Caption tone="faint" style={{ color: rgb(theme.ink[400]) }}>
          Confirmed {shortDate(row.confirmedAt)}
        </Caption>
      ) : null}
    </Card>
  );
}

function Line({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(3) }}>
      <Caption tone="faint">{label}</Caption>
      {strong ? (
        <Body style={{ fontWeight: '600', fontVariant: ['tabular-nums'] }}>{value}</Body>
      ) : (
        <Caption
          tone={muted ? 'faint' : 'default'}
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {value}
        </Caption>
      )}
    </View>
  );
}

/**
 * "Settle my payment", on a payment that has not landed.
 *
 * It answers before it routes. The commonest reason a payout is stuck is a
 * provider who has not finished their own onboarding, and saying so is a better
 * outcome than putting a request on somebody's desk and making them wait for
 * the same sentence. Only if they still want a person does a case exist — and
 * the second press returns the one already open rather than raising another.
 */
function SettleMyPayment({ bookingId }: { bookingId: string }) {
  const theme = useTheme();
  const [state, setState] = useState<{ reason: string; owed: string; open: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function ask() {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/verification/cases/settlement/${bookingId}`, {});
      setState({ reason: data.reason, owed: data.owed, open: data.alreadyOpen });
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (state) {
    return (
      <View
        style={{
          backgroundColor: rgb(theme.cautionBg),
          borderRadius: radius.sm,
          padding: space(2.5),
          gap: space(1),
        }}
      >
        <Caption style={{ color: rgb(theme.cautionFg) }}>{state.reason}</Caption>
        <Caption style={{ color: rgb(theme.cautionFg) }}>
          {state.open
            ? 'A request on this is already with the support desk.'
            : 'Raised with the support desk.'}
        </Caption>
      </View>
    );
  }

  return (
    <View style={{ gap: space(1) }}>
      <Button
        label={busy ? 'Checking…' : 'Settle my payment'}
        variant="ghost"
        small
        busy={busy}
        onPress={() => void ask()}
      />
      {error ? <Caption tone="critical">{error}</Caption> : null}
    </View>
  );
}

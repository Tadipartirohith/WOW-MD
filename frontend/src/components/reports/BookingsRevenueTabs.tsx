import {
  ChartBar,
  CheckCircle,
  Coins,
  CurrencyInr,
  Receipt,
  Tag,
  TrendUp,
  Vault,
} from '@phosphor-icons/react';
import { BOOKING_STATUS_LABEL } from '../../lib/permissions';
import {
  BarList,
  ColumnChart,
  Composition,
  KpiGrid,
  KpiTile,
  Panel,
  TrendChart,
} from './ReportParts';
import { MILESTONE_LABEL, count, inr, pct, type ReportsData, windowQuery } from './reportData';

/** Bookings over the period: volume, stage, and what was booked (EZ1-I242). */
export function BookingsTab({ d }: { d: ReportsData }) {
  const wq = windowQuery(d.window);
  const b = d.bookings.data;
  const categories = d.categories.data;
  const points = d.series.data?.points ?? [];
  const completionRate = b && b.placed ? (b.byStatus.completed / b.placed) * 100 : 0;

  return (
    <div className="space-y-6">
      <KpiGrid>
        <KpiTile label="New bookings" value={count(b?.placed)} to={`/admin/bookings?${wq}`} icon={Receipt}
          accent="brand" load={d.bookings} />
        <KpiTile label="Booking value" hint="Cancelled bookings excluded" value={inr(b?.grossValue)} icon={TrendUp}
          accent="caution" load={d.bookings} />
        <KpiTile label="Average booking" hint="Over bookings that reached a price" value={inr(b?.averageValue)}
          icon={Coins} accent="caution" load={d.bookings} />
        <KpiTile label="Completion rate" hint={`${count(b?.byStatus.completed)} of ${count(b?.placed)} completed`}
          value={pct(completionRate)} to={`/admin/bookings?status=completed&${wq}`} icon={CheckCircle}
          accent="positive" load={d.bookings} />
      </KpiGrid>

      <Panel title="Bookings trend" subtitle="Bookings placed per day" icon={ChartBar} load={d.series}
        empty={points.every((p) => p.bookings === 0)} emptyText="No bookings were placed in this period.">
        <ColumnChart format={count} points={points.map((p) => ({ date: p.date, value: p.bookings }))} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Bookings by stage" subtitle="Every stage, including the empty ones. Each opens its bookings."
          icon={Receipt} load={d.bookings} empty={!b?.placed} emptyText="No bookings in this period.">
          <BarList rows={Object.entries(BOOKING_STATUS_LABEL).map(([status, label]) => ({
            key: status,
            label,
            value: b?.byStatus[status] ?? 0,
            to: `/admin/bookings?status=${status}&${wq}`,
          }))} />
        </Panel>

        <Panel title="Bookings by category" icon={Tag} load={d.categories}
          subtitle={categories && categories.rows.length
            ? `${categories.fromService} labelled by the service booked, ${categories.inferred} by the provider's own trade.`
            : 'What people booked.'}
          empty={!categories?.rows.length} emptyText="No bookings in this period.">
          <BarList accent="caution" rows={(categories?.rows ?? []).map((r) => ({
            key: r.category,
            label: r.category,
            value: r.bookings,
            display: `${count(r.bookings)} · ${inr(r.value)}`,
          }))} />
        </Panel>
      </div>
    </div>
  );
}

/** Where the money came from and where it went (EZ1-I242). */
export function RevenueTab({ d }: { d: ReportsData }) {
  const f = d.financial.data;
  const payments = d.payments.data;
  const points = d.series.data?.points ?? [];

  return (
    <div className="space-y-6">
      <KpiGrid>
        <KpiTile label="Revenue collected" hint="Money actually taken" value={inr(f?.collected)} to="/admin/payments"
          icon={CurrencyInr} accent="caution" load={d.financial} />
        <KpiTile label="Commission earned" hint="On payments released" value={inr(f?.commission)}
          to="/admin/payments?status=released" icon={TrendUp} accent="positive" load={d.financial} />
        <KpiTile label="Held in escrow" value={inr(f?.held)} to="/admin/payments?status=held_in_escrow" icon={Vault}
          accent="caution" load={d.financial} />
        <KpiTile label="Awaiting payout" value={inr(f?.awaitingPayout)} to="/admin/payments?status=pending_payout"
          icon={Coins} accent="brand" load={d.financial} />
      </KpiGrid>

      <Panel title="Revenue trend" subtitle="Per day: money taken, commission earned, and the value of bookings placed"
        icon={TrendUp} load={d.series}
        empty={points.every((p) => p.collected === 0 && p.value === 0)} emptyText="No money moved in this period.">
        <TrendChart points={points} format={inr} series={[
          { key: 'collected', label: 'Collected', tone: 'text-caution-fg' },
          { key: 'value', label: 'Booking value', tone: 'text-brand' },
          { key: 'commission', label: 'Commission', tone: 'text-positive-fg' },
        ]} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Where the money went" subtitle="Each line opens those payments." icon={CurrencyInr}
          load={d.financial} empty={Number(f?.collected ?? 0) === 0} emptyText="No money moved through escrow in this period.">
          <Composition format={inr} segments={[
            { label: 'Released to providers', value: Number(f?.releasedToProviders ?? 0), bar: 'bg-positive-fg', to: '/admin/payments?status=released' },
            { label: 'Platform commission', value: Number(f?.commission ?? 0), bar: 'bg-brand', to: '/admin/payments?status=released' },
            { label: 'Held in escrow', value: Number(f?.held ?? 0), bar: 'bg-caution-fg', to: '/admin/payments?status=held_in_escrow' },
            { label: 'Awaiting payout', value: Number(f?.awaitingPayout ?? 0), bar: 'bg-brand-400', to: '/admin/payments?status=pending_payout' },
            { label: 'Disputed', value: Number(f?.disputed ?? 0), bar: 'bg-critical-fg', to: '/admin/payments?status=disputed' },
            { label: 'Refunded', value: Number(f?.refunded ?? 0), bar: 'bg-gray-400', to: '/admin/payments?status=refunded' },
          ]} />
        </Panel>

        <Panel title="By instalment" subtitle="Money taken at each stage of the booking." icon={Coins} load={d.payments}
          empty={!payments?.transactions} emptyText="No payments in this period.">
          <BarList accent="caution" rows={Object.entries(payments?.byMilestone ?? {}).map(([m, v]) => ({
            key: m,
            label: MILESTONE_LABEL[m] ?? m,
            value: Number(v.amount),
            display: `${inr(v.amount)} · ${count(v.count)} payments`,
          }))} />
        </Panel>
      </div>
    </div>
  );
}

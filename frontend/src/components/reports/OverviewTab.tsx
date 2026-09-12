import {
  Buildings,
  ChartLineUp,
  CheckCircle,
  ClipboardText,
  Coins,
  CurrencyInr,
  Hourglass,
  Lifebuoy,
  Receipt,
  Scales,
  SealCheck,
  Storefront,
  TrendUp,
  UsersThree,
  Vault,
  XCircle,
} from '@phosphor-icons/react';
import { BOOKING_STATUS_LABEL } from '../../lib/permissions';
import ActivityTable from './ActivityTable';
import { BarList, Composition, KpiGrid, KpiTile, Panel, Stat, TrendChart } from './ReportParts';
import { count, inr, type ReportsData, windowQuery } from './reportData';

function GroupHeading({ children }: { children: string }) {
  return <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">{children}</h2>;
}

/**
 * The whole platform over the selected period, on one screen (EZ1-I242).
 *
 * Tiles are grouped by the question they answer rather than listed, and each
 * opens the page that owns its number -- filtered to the same thing wherever
 * that page can be filtered.
 */
export default function OverviewTab({ d }: { d: ReportsData }) {
  const wq = windowQuery(d.window);
  const users = d.users.data;
  const bookings = d.bookings.data;
  const financial = d.financial.data;
  const support = d.support.data;
  const verification = d.verification.data;
  const points = d.series.data?.points ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <GroupHeading>In this period</GroupHeading>
        <KpiGrid>
          <KpiTile label="New individual users" hint="Brides, grooms and families" value={count(users?.individuals)}
            to="/admin/users" icon={UsersThree} accent="brand" load={d.users} />
          <KpiTile label="New bookings" value={count(bookings?.placed)} to={`/admin/bookings?${wq}`}
            icon={Receipt} accent="brand" load={d.bookings} />
          <KpiTile label="Booking value" hint="Cancelled bookings excluded" value={inr(bookings?.grossValue)}
            icon={TrendUp} accent="caution" load={d.bookings} />
          <KpiTile label="Revenue collected" hint="Money actually taken" value={inr(financial?.collected)}
            to="/admin/payments" icon={CurrencyInr} accent="caution" load={d.financial} />
          <KpiTile label="Completed bookings" value={count(bookings?.byStatus.completed)}
            to={`/admin/bookings?status=completed&${wq}`} icon={CheckCircle} accent="positive" load={d.bookings} />
          <KpiTile label="Cancelled bookings" value={count(bookings?.byStatus.cancelled)}
            to={`/admin/bookings?status=cancelled&${wq}`} icon={XCircle} accent="critical" load={d.bookings} />
          {/* Two tables, two things: a case is an investigation, a dispute is a buyer contesting a booking. */}
          <KpiTile label="Open support cases" hint="Raised in this period" value={count(support?.open)}
            to="/admin/support?tab=cases&status=open" icon={Lifebuoy} accent="critical" load={d.support} />
          <KpiTile label="Open disputes" hint="Raised in this period" value={count(support?.openDisputes)}
            to="/admin/support?tab=disputes" icon={Scales} accent="critical" load={d.support} />
        </KpiGrid>
      </div>

      <div className="space-y-3">
        <GroupHeading>Money and queues</GroupHeading>
        <KpiGrid>
          <KpiTile label="Held in escrow" hint="Taken in this period, not yet moved" value={inr(financial?.held)}
            to="/admin/payments?status=held_in_escrow" icon={Vault} accent="caution" load={d.financial} />
          <KpiTile label="Awaiting payout" hint="Earned, not yet sent to the provider" value={inr(financial?.awaitingPayout)}
            to="/admin/payments?status=pending_payout" icon={Coins} accent="caution" load={d.financial} />
          <KpiTile label="Commission earned" hint="On payments released" value={inr(financial?.commission)}
            to="/admin/payments?status=released" icon={ChartLineUp} accent="positive" load={d.financial} />
          <KpiTile label="Pending verification" hint="Waiting for an officer" value={count(verification?.pending)}
            to="/verification" icon={Hourglass} accent="positive" load={d.verification} />
        </KpiGrid>
      </div>

      <div className="space-y-3">
        <GroupHeading>The platform, all time</GroupHeading>
        <KpiGrid>
          <KpiTile label="Vendors" value={count(users?.platform.vendors)} to="/admin/vendors"
            icon={Storefront} accent="brand" load={d.users} />
          <KpiTile label="Wedding planners" value={count(users?.platform.planners)} to="/admin/planners"
            icon={ClipboardText} accent="brand" load={d.users} />
          <KpiTile label="Agencies" value={count(users?.platform.agents)} to="/admin/agents"
            icon={Buildings} accent="brand" load={d.users} />
          <KpiTile label="Verification officers" hint="Active" value={count(users?.platform.officers)}
            to="/admin/officers" icon={SealCheck} accent="positive" load={d.users} />
        </KpiGrid>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="User growth" subtitle="New accounts per day" icon={ChartLineUp} load={d.series}
          empty={points.every((p) => p.users === 0)} emptyText="No new accounts in this period.">
          <TrendChart points={points} format={count} series={[
            { key: 'individuals', label: 'Individual users', tone: 'text-brand' },
            { key: 'users', label: 'All accounts', tone: 'text-caution-fg' },
          ]} />
        </Panel>

        <Panel title="Bookings by stage" subtitle="Where this period's bookings sit today. Each stage opens its bookings."
          icon={Receipt} load={d.bookings} empty={!bookings?.placed} emptyText="No bookings in this period.">
          <BarList rows={Object.entries(BOOKING_STATUS_LABEL)
            .map(([status, label]) => ({
              key: status,
              label,
              value: bookings?.byStatus[status] ?? 0,
              to: `/admin/bookings?status=${status}&${wq}`,
            }))
            .filter((r) => r.value > 0)} />
        </Panel>
      </div>

      <Panel title="Revenue overview" subtitle="Every rupee taken in this period, by where it went." icon={CurrencyInr}
        load={d.financial}>
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Collected" value={inr(financial?.collected)} to="/admin/payments" />
            <Stat label="Commission earned" value={inr(financial?.commission)} to="/admin/payments?status=released" />
            <Stat label="Currently held" value={inr(financial?.held)} to="/admin/payments?status=held_in_escrow" />
          </div>
          <Composition format={inr} segments={[
            { label: 'Released to providers', value: Number(financial?.releasedToProviders ?? 0), bar: 'bg-positive-fg', to: '/admin/payments?status=released' },
            { label: 'Platform commission', value: Number(financial?.commission ?? 0), bar: 'bg-brand', to: '/admin/payments?status=released' },
            { label: 'Held in escrow', value: Number(financial?.held ?? 0), bar: 'bg-caution-fg', to: '/admin/payments?status=held_in_escrow' },
            { label: 'Awaiting payout', value: Number(financial?.awaitingPayout ?? 0), bar: 'bg-brand-400', to: '/admin/payments?status=pending_payout' },
            { label: 'Disputed', value: Number(financial?.disputed ?? 0), bar: 'bg-critical-fg', to: '/admin/payments?status=disputed' },
            { label: 'Refunded', value: Number(financial?.refunded ?? 0), bar: 'bg-gray-400', to: '/admin/payments?status=refunded' },
          ]} />
        </div>
      </Panel>

      <ActivityTable d={d} limit={15} />
    </div>
  );
}

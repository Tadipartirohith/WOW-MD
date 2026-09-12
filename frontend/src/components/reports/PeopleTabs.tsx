import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Buildings,
  ChartLineUp,
  CheckCircle,
  ClipboardText,
  SealCheck,
  Storefront,
  UsersThree,
  UserPlus,
} from '@phosphor-icons/react';
import { ROLE_LABEL, type UserRole } from '../../lib/permissions';
import {
  BarList,
  DataTable,
  KpiGrid,
  KpiTile,
  Panel,
  TrendChart,
  type Column,
} from './ReportParts';
import { count, inr, pct, type ProviderRow, type ReportsData, windowQuery } from './reportData';

/** Where each non-individual role's directory lives. Individuals have one directory. */
const ROLE_PAGE: Partial<Record<string, string>> = {
  bride: '/admin/users',
  groom: '/admin/users',
  family: '/admin/users',
  agent: '/admin/agents',
  vendor: '/admin/vendors',
  planner: '/admin/planners',
  in_person: '/admin/officers',
};

/** Who joined, and as what (EZ1-I242). */
export function UsersTab({ d }: { d: ReportsData }) {
  const u = d.users.data;
  const points = d.series.data?.points ?? [];

  return (
    <div className="space-y-6">
      <KpiGrid>
        <KpiTile label="New individual users" hint="Brides, grooms and families" value={count(u?.individuals)}
          to="/admin/users" icon={UsersThree} accent="brand" load={d.users} />
        <KpiTile label="New accounts, every role" hint="Individuals, businesses and staff" value={count(u?.total)}
          icon={UserPlus} accent="brand" load={d.users} />
        <KpiTile label="Agencies" hint="All time" value={count(u?.platform.agents)} to="/admin/agents"
          icon={Buildings} accent="caution" load={d.users} />
        <KpiTile label="Verification officers" hint="Active, all time" value={count(u?.platform.officers)}
          to="/admin/officers" icon={SealCheck} accent="positive" load={d.users} />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="User growth" subtitle="New accounts per day" icon={ChartLineUp} load={d.series}
          empty={points.every((p) => p.users === 0)} emptyText="No new accounts in this period.">
          <TrendChart points={points} format={count} series={[
            { key: 'individuals', label: 'Individual users', tone: 'text-brand' },
            { key: 'users', label: 'All accounts', tone: 'text-caution-fg' },
          ]} />
        </Panel>

        <Panel title="New accounts by role" subtitle="Each role opens its directory." icon={UsersThree} load={d.users}
          empty={!u?.total} emptyText="No new accounts in this period.">
          <BarList rows={Object.entries(u?.byRole ?? {})
            .filter(([, n]) => n > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([role, n]) => ({
              key: role,
              label: ROLE_LABEL[role as UserRole] ?? role,
              value: n,
              to: ROLE_PAGE[role],
            }))} />
        </Panel>
      </div>
    </div>
  );
}

type SortKey = 'bookings' | 'value' | 'completion' | 'cancellation' | 'rating';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'bookings', label: 'Most bookings' },
  { key: 'value', label: 'Highest value' },
  { key: 'completion', label: 'Best completion rate' },
  { key: 'cancellation', label: 'Highest cancellation rate' },
  { key: 'rating', label: 'Best rated' },
];

/** How each vendor and planner did with the bookings placed in the period (EZ1-I242). */
export function ProvidersTab({ d }: { d: ReportsData }) {
  const wq = windowQuery(d.window);
  const rows = d.providers.data?.rows ?? [];
  const [type, setType] = useState<'all' | 'vendor' | 'planner'>('all');
  const [category, setCategory] = useState('');
  const [city, setCity] = useState('');
  const [sort, setSort] = useState<SortKey>('bookings');

  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))].sort(), [rows]);
  const cities = useMemo(
    () => [...new Set(rows.map((r) => r.city).filter((c): c is string => Boolean(c)))].sort(),
    [rows],
  );

  const shown = useMemo(() => {
    const filtered = rows.filter(
      (r) =>
        (type === 'all' || r.providerType === type) &&
        (!category || r.category === category) &&
        (!city || r.city === city),
    );
    const by: Record<SortKey, (r: ProviderRow) => number> = {
      bookings: (r) => r.bookings,
      value: (r) => Number(r.value),
      completion: (r) => r.completionRate,
      cancellation: (r) => r.cancellationRate,
      rating: (r) => r.rating ?? -1,
    };
    return [...filtered].sort((a, b) => by[sort](b) - by[sort](a));
  }, [rows, type, category, city, sort]);

  const totalBookings = rows.reduce((t, r) => t + r.bookings, 0);
  const totalCompleted = rows.reduce((t, r) => t + r.completed, 0);

  const columns: Column<ProviderRow>[] = [
    {
      key: 'name',
      label: 'Provider',
      render: (r) => (
        <div>
          <p className="font-medium text-gray-900">
            {r.name}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${r.providerType === 'planner' ? 'bg-caution-bg text-caution-fg' : 'bg-brand-soft text-brand-strong'}`}>
              {r.providerType === 'planner' ? 'Planner' : 'Vendor'}
            </span>
          </p>
          <p className="text-xs text-gray-500">{[r.category, r.city].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    {
      key: 'bookings',
      label: 'Bookings',
      align: 'right',
      render: (r) => (
        <Link to={`/admin/bookings?providerId=${r.providerId}&${wq}`} className="text-brand-strong hover:underline">
          {count(r.bookings)}
        </Link>
      ),
    },
    { key: 'completed', label: 'Completed', align: 'right', render: (r) => count(r.completed) },
    { key: 'completion', label: 'Completion', align: 'right', render: (r) => pct(r.completionRate) },
    {
      key: 'cancellation',
      label: 'Cancelled',
      align: 'right',
      render: (r) => <span className={r.cancellationRate >= 25 ? 'font-medium text-critical-fg' : ''}>{pct(r.cancellationRate)}</span>,
    },
    { key: 'value', label: 'Value', align: 'right', render: (r) => inr(r.value) },
    { key: 'collected', label: 'Collected', align: 'right', render: (r) => inr(r.collected) },
    {
      key: 'rating',
      label: 'Rating',
      align: 'right',
      render: (r) => (r.rating === null ? <span className="text-gray-400">No reviews</span> : `${r.rating.toFixed(1)} (${r.ratingCount})`),
    },
  ];

  return (
    <div className="space-y-6">
      <KpiGrid>
        <KpiTile label="Providers booked" value={count(rows.length)} icon={Storefront} accent="brand" load={d.providers} />
        <KpiTile label="Vendors booked" value={count(rows.filter((r) => r.providerType === 'vendor').length)}
          to="/admin/vendors" icon={Storefront} accent="brand" load={d.providers} />
        <KpiTile label="Planners booked" value={count(rows.filter((r) => r.providerType === 'planner').length)}
          to="/admin/planners" icon={ClipboardText} accent="caution" load={d.providers} />
        <KpiTile label="Completion rate" hint={`${count(totalCompleted)} of ${count(totalBookings)} bookings`}
          value={pct(totalBookings ? (totalCompleted / totalBookings) * 100 : 0)} icon={CheckCircle}
          accent="positive" load={d.providers} />
      </KpiGrid>

      <Panel title="Provider performance" subtitle="Bookings placed in this period, by who was booked. Bookings open that provider's list."
        icon={Storefront} load={d.providers} empty={rows.length === 0} emptyText="No provider was booked in this period.">
        <div className="mb-4 flex flex-wrap gap-2">
          <select className="input py-1 text-sm" value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Provider type">
            <option value="all">Vendors and planners</option>
            <option value="vendor">Vendors</option>
            <option value="planner">Wedding planners</option>
          </select>
          <select className="input py-1 text-sm" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">Every category</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input py-1 text-sm" value={city} onChange={(e) => setCity(e.target.value)} aria-label="Location">
            <option value="">Every location</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input py-1 text-sm" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">No provider matches those filters.</p>
        ) : (
          <DataTable columns={columns} rows={shown} rowKey={(r) => `${r.providerType}:${r.providerId}`} />
        )}
      </Panel>
    </div>
  );
}

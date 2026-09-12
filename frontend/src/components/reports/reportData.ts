import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from '../../lib/api';

/*
 * The data layer behind Admin Reports (EZ1-I242).
 *
 * Every figure on the page comes through one of the three hooks below, each a
 * live read of a real /admin endpoint over the selected window. The window is
 * resolved once, at the top of the page, and passed down, so no section can
 * quietly report a different period from the one beside it.
 */

export type RangeKey = 'today' | '7d' | '30d' | 'month' | 'custom';

export const PRESETS: { key: Exclude<RangeKey, 'custom'>; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 Days' },
  { key: '30d', label: 'Last 30 Days' },
  { key: 'month', label: 'This Month' },
];

/** An inclusive pair of YYYY-MM-DD dates. */
export interface ReportWindow {
  from: string;
  to: string;
}

const iso = (d: Date) => {
  // Local calendar date, not UTC: "today" in India at 1 a.m. is still today.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function presetWindow(key: Exclude<RangeKey, 'custom'>): ReportWindow {
  const now = new Date();
  const to = iso(now);
  if (key === 'today') return { from: to, to };
  if (key === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  const back = key === '7d' ? 6 : 29;
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)), to };
}

// ---------------------------------------------------------------- hooks

export function useReport<T>(kind: string, w: ReportWindow, enabled = true) {
  return useQuery<T>({
    queryKey: ['admin-report', kind, w.from, w.to],
    queryFn: async () => (await api.get('/admin/reports', { params: { kind, ...w } })).data as T,
    retry: 1,
    enabled,
  });
}

export function useSeries(w: ReportWindow, enabled = true) {
  return useQuery<{ points: SeriesPoint[] }>({
    queryKey: ['admin-report-series', w.from, w.to],
    queryFn: async () => (await api.get('/admin/reports/timeseries', { params: w })).data,
    retry: 1,
    enabled,
  });
}

export function useActivity(w: ReportWindow, limit = 25, enabled = true) {
  return useQuery<ActivityRow[]>({
    queryKey: ['admin-activity', 'reports', w.from, w.to, limit],
    queryFn: async () => (await api.get('/admin/activity', { params: { limit, ...w } })).data,
    retry: 1,
    enabled,
  });
}

// ---------------------------------------------------------------- the page's reads, together

/** Every read the page makes, resolved once at the top and handed to the tab on show. */
export interface ReportsData {
  window: ReportWindow;
  users: UseQueryResult<UsersReport>;
  bookings: UseQueryResult<BookingsReport>;
  financial: UseQueryResult<FinancialReport>;
  payments: UseQueryResult<PaymentsReport>;
  providers: UseQueryResult<{ rows: ProviderRow[] }>;
  categories: UseQueryResult<CategoriesReport>;
  support: UseQueryResult<SupportReport>;
  verification: UseQueryResult<VerificationReport>;
  series: UseQueryResult<{ points: SeriesPoint[] }>;
  activity: UseQueryResult<ActivityRow[]>;
}

/** `from=...&to=...`, so a drill-down lands on the same period the figure described. */
export const windowQuery = (w: ReportWindow) => `from=${w.from}&to=${w.to}`;

// ---------------------------------------------------------------- shapes

export interface UsersReport {
  total: number;
  individuals: number;
  byRole: Record<string, number>;
  platform: { vendors: number; planners: number; officers: number; agents: number };
}

export interface BookingsReport {
  placed: number;
  byStatus: Record<string, number>;
  grossValue: string;
  averageValue: string;
}

export interface FinancialReport {
  collected: string;
  held: string;
  disputed: string;
  releasedToProviders: string;
  commission: string;
  refunded: string;
  awaitingPayout: string;
}

export interface PaymentsReport {
  transactions: number;
  successful: number;
  pending: number;
  failed: number;
  refunded: number;
  disputed: number;
  byStatus: Record<string, { count: number; amount: string }>;
  byMilestone: Record<string, { count: number; amount: string }>;
  amounts: Record<
    'collected' | 'held' | 'released' | 'commission' | 'refunded' | 'disputed' | 'awaitingPayout' | 'partiallySettled',
    string
  >;
}

export interface ProviderRow {
  providerType: 'vendor' | 'planner';
  providerId: string;
  name: string;
  category: string;
  city: string | null;
  rating: number | null;
  ratingCount: number;
  bookings: number;
  completed: number;
  cancelled: number;
  value: string;
  collected: string;
  completionRate: number;
  cancellationRate: number;
}

export interface CategoriesReport {
  rows: { category: string; bookings: number; completed: number; value: string }[];
  fromService: number;
  inferred: number;
}

export interface SupportReport {
  cases: number;
  open: number;
  unresolved: number;
  escalated: number;
  resolved: number;
  closed: number;
  caseByStatus: Record<string, number>;
  bySubject: Record<string, number>;
  medianHoursToResolution: number | null;
  disputes: number;
  openDisputes: number;
  disputeByStatus: Record<string, number>;
}

export interface VerificationReport {
  requests: number;
  pending: number;
  inFlight: number;
  approved: number;
  rejected: number;
  byStatus: Record<string, number>;
  byApplicantType: Record<string, { requests: number; approved: number; rejected: number; pending: number }>;
  medianHoursToDecision: number | null;
  officerWorkload: { officerId: string; email: string | null; open: number }[];
}

export interface SeriesPoint {
  date: string;
  users: number;
  individuals: number;
  bookings: number;
  value: number;
  collected: number;
  commission: number;
}

export interface ActivityRow {
  at: string;
  kind: string;
  summary: string;
  resourceType: string;
  resourceId: string;
}

// ---------------------------------------------------------------- words and numbers

export const inr = (v: string | number | null | undefined) =>
  `₹${Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export const count = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('en-IN');

export const pct = (n: number) => `${n.toFixed(n % 1 === 0 ? 0 : 1)}%`;

export function hours(h: number | null): string {
  if (h === null) return 'Not enough decided yet';
  if (h < 1) return 'Under an hour';
  if (h < 48) return `${Math.round(h)} hours`;
  return `${(h / 24).toFixed(1)} days`;
}

export const titleCase = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** How an administrator reads a payment's state. The provider-facing wording is elsewhere. */
export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  initiated: 'Started, not yet paid',
  held_in_escrow: 'Held in escrow',
  disputed: 'Frozen by a dispute',
  released: 'Released to provider',
  pending_payout: 'Awaiting payout',
  refunded: 'Refunded',
  partially_settled: 'Partially settled',
  failed: 'Failed',
};

export const MILESTONE_LABEL: Record<string, string> = {
  advance: 'Advance',
  second: 'Second instalment',
  final: 'Final payment',
};

export const CASE_SUBJECT_LABEL: Record<string, string> = {
  agent: 'Agency',
  vendor: 'Vendor listing',
  profile: 'Profile',
  match: 'Match',
  booking: 'Booking',
  payment: 'Payment',
  availability: 'Availability',
  account: 'Account',
  other: 'Other',
};

export const APPLICANT_LABEL: Record<string, string> = {
  vendor: 'Vendors',
  planner: 'Wedding planners',
  agent: 'Agencies',
};

export const DISPUTE_STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  resolved: 'Resolved',
  rejected: 'Rejected',
};

// ---------------------------------------------------------------- export

export type CsvRow = (string | number | null)[];

/**
 * A CSV the administrator can open in Excel.
 *
 * Every cell is quoted, and a leading = + - or @ is escaped with an apostrophe:
 * a vendor named "=HYPERLINK(...)" is data, and a spreadsheet that runs it as a
 * formula is how a report becomes an attack.
 */
export function downloadCsv(filename: string, rows: CsvRow[]) {
  const cell = (c: string | number | null) => {
    let text = c === null ? '' : String(c);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

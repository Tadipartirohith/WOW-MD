import { Fragment, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CaretRight } from '@phosphor-icons/react';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/dates';
import { ROLE_LABEL } from '../../lib/permissions';

/**
 * The append-only record of privileged and money-moving actions (EZ1-I153),
 * made readable (EZ1-I204).
 *
 * The stored rows are deliberately terse — a dotted action name and a small
 * `metadata` bag — because the trail is written on the path of the action it
 * describes. This is the presentation layer that turns one of those rows into
 * something an administrator can read at a glance: a friendly title, the actor
 * and their role, the module and record it touched, a previous→new status where
 * the metadata carries one, and a one-line description. Clicking a row opens the
 * full detail, including the raw metadata for reference. Nothing here invents
 * data the row does not carry; fields that are absent are simply omitted.
 */

interface AuditEvent {
  id: string;
  action: string;
  actorUserId: string | null;
  actorRole: string | null;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

/** Friendly title per stable action name, mirroring the backend AuditAction enum. */
const ACTION_TITLE: Record<string, string> = {
  'auth.login_succeeded': 'Login succeeded',
  'auth.login_failed': 'Login failed',
  'auth.account_locked': 'Account locked',
  'auth.password_reset': 'Password reset',
  'auth.email_verified': 'Email verified',
  'auth.mfa_enabled': 'Two-factor enabled',
  'auth.mfa_disabled': 'Two-factor disabled',
  'auth.refresh_reuse_detected': 'Token reuse detected',
  'auth.session_revoked': 'Session revoked',
  'auth.mfa_recovery_used': 'Recovery code used',
  'auth.mfa_recovery_regenerated': 'Recovery codes regenerated',

  'profile.created_by_steward': 'Profile created by steward',
  'profile.invited': 'Profile invited',
  'profile.claimed': 'Profile claimed',
  'profile.claim_requested': 'Profile claim requested',
  'profile.shared': 'Profile shared',
  'profile.share_revoked': 'Profile share revoked',
  'profile.pooled': 'Profile pooled',
  'profile.unpooled': 'Profile unpooled',
  'profile.deactivated': 'Profile deactivated',
  'profile.reactivated': 'Profile reactivated',
  'profile.archived': 'Profile archived',
  'profile.photo_rejected': 'Profile photo rejected',

  'consent.intake_recorded': 'Intake consent recorded',
  'consent.circulation_recorded': 'Circulation consent recorded',
  'consent.revoked': 'Consent revoked',

  'verification.requested': 'Verification requested',
  'verification.allocated': 'Verification allocated',
  'verification.approved': 'Verification approved',
  'verification.rejected': 'Verification rejected',
  'officer.created': 'Officer created',

  'case.raised': 'Support case raised',
  'case.allocated': 'Support case allocated',
  'case.settled': 'Support case settled',

  'match.fixed_proposed': 'Match proposed',
  'match.fixed_confirmed': 'Match confirmed',
  'match.unmatched': 'Match undone',
  'match.blocked': 'Match blocked',
  'match.reported': 'Match reported',
  'customer.provisioned': 'Customer provisioned',

  'agent_charge.raised': 'Agent charge raised',
  'agent_charge.held': 'Agent charge held',
  'agent_charge.released': 'Agent charge released',

  'identity.submitted': 'Identity submitted',
  'identity.otp_sent': 'Identity OTP sent',
  'identity.verified': 'Identity verified',

  'chat.user_reported': 'User reported in chat',

  'agent.approved': 'Agent approved',
  'agent.rejected': 'Agent rejected',
  'vendor.approved': 'Vendor approved',
  'planner.approved': 'Planner approved',

  'booking.escrow_held': 'Escrow held',
  'booking.escrow_released': 'Escrow released',
  'booking.escrow_refunded': 'Escrow refunded',
  'payment.webhook_received': 'Payment webhook received',
  'payment.webhook_rejected': 'Payment webhook rejected',
  'payment.reconciliation_mismatch': 'Reconciliation mismatch',

  'data.exported': 'Data exported',
  'data.erased': 'Data erased',

  'user.suspended': 'User suspended',
  'user.reinstated': 'User reinstated',
  'dispute.resolved': 'Dispute resolved',

  'catalog.category_changed': 'Catalog category changed',
  'catalog.definition_changed': 'Catalog service changed',
  'catalog.attribute_changed': 'Catalog attribute changed',
};

/** Module each action belongs to, keyed by the action's dotted prefix. */
const MODULE_BY_PREFIX: Record<string, string> = {
  auth: 'Authentication',
  profile: 'Profiles',
  consent: 'Consent',
  verification: 'Verification',
  officer: 'Verification',
  case: 'Support cases',
  match: 'Matchmaking',
  customer: 'Matchmaking',
  agent_charge: 'Agent billing',
  agent: 'Agents',
  identity: 'Identity',
  chat: 'Chat',
  vendor: 'Vendors',
  planner: 'Planners',
  booking: 'Bookings',
  payment: 'Payments',
  data: 'Data rights',
  user: 'Users',
  dispute: 'Disputes',
  catalog: 'Catalog',
};

const titleFor = (action: string) =>
  ACTION_TITLE[action] ??
  action
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

const moduleFor = (action: string) => MODULE_BY_PREFIX[action.split('.')[0]] ?? 'Platform';

const roleLabel = (role: string | null) =>
  role ? (ROLE_LABEL as Record<string, string>)[role] ?? role : null;

/** "verified → live" when the metadata records a status change, else null. */
function statusChange(m: Record<string, unknown>): { from: string; to: string } | null {
  const from = m.from;
  const to = m.to;
  if (from == null && to == null) return null;
  return { from: from == null ? '—' : String(from), to: to == null ? '—' : String(to) };
}

const isLogin = (action: string) => action.startsWith('auth.login') || action === 'auth.account_locked';

const money = (v: unknown) =>
  `₹${Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

/** A one-line, human description built only from fields the row actually carries. */
function describe(e: AuditEvent): string {
  const m = e.metadata ?? {};
  const actor = roleLabel(e.actorRole) ?? 'System';

  switch (e.action) {
    case 'auth.login_succeeded':
      return `${actor} signed in successfully.`;
    case 'auth.login_failed':
      return `Failed sign-in${m.email ? ` for ${m.email}` : ''}.`;
    case 'auth.account_locked':
      return `Account locked after ${m.attempts ?? 'repeated'} failed attempts.`;
    case 'booking.escrow_held':
    case 'booking.escrow_released':
    case 'booking.escrow_refunded':
      return m.amount != null
        ? `${money(m.amount)}${m.milestone ? ` for the ${String(m.milestone).replace(/_/g, ' ')} milestone` : ''}.`
        : titleFor(e.action) + '.';
    case 'chat.user_reported':
      return `Reported${m.reason ? ` for ${m.reason}` : ''}${m.messages ? ` (${m.messages} messages cited)` : ''}.`;
    default:
      break;
  }

  const change = statusChange(m);
  const parts: string[] = [];
  if (change) parts.push(`Status ${change.from} → ${change.to}.`);
  if (m.reason) parts.push(`Reason: ${m.reason}.`);
  if (parts.length) return parts.join(' ');
  return `${titleFor(e.action)} by ${actor}.`;
}

/** Metadata keys already surfaced elsewhere in the detail; not repeated in the key/value list. */
const HANDLED_KEYS = new Set(['from', 'to']);

const humanKey = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.]/g, ' ');

const humanValue = (v: unknown): string => {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.length ? v.map(humanValue).join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-xs uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-700 break-all">{value}</dd>
    </div>
  );
}

function AuditDetail({ e }: { e: AuditEvent }) {
  const m = e.metadata ?? {};
  const change = statusChange(m);
  const extras = Object.entries(m).filter(([k]) => !HANDLED_KEYS.has(k));

  return (
    <div className="space-y-3 rounded-lg bg-rose-50/40 p-4">
      <p className="text-sm text-gray-700">{describe(e)}</p>

      <dl className="space-y-1.5">
        <DetailRow label="Action" value={<span className="font-medium">{titleFor(e.action)}</span>} />
        <DetailRow label="Module" value={moduleFor(e.action)} />
        <DetailRow label="Actor" value={roleLabel(e.actorRole) ?? 'System'} />
        {e.actorUserId && <DetailRow label="Actor ID" value={e.actorUserId} />}
        {e.resourceType && (
          <DetailRow label="Record" value={`${e.resourceType}${e.resourceId ? ` · ${e.resourceId}` : ''}`} />
        )}
        {change && (
          <DetailRow
            label="Status"
            value={
              <span className="inline-flex items-center gap-2">
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{change.from}</span>
                <CaretRight size={12} className="text-gray-400" />
                <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">{change.to}</span>
              </span>
            }
          />
        )}
        {isLogin(e.action) && (
          <>
            {m.email != null && <DetailRow label="Email" value={String(m.email)} />}
            <DetailRow
              label="Outcome"
              value={
                e.action === 'auth.login_succeeded' ? (
                  <span className="text-emerald-700">Success</span>
                ) : (
                  <span className="text-red-600">Failed</span>
                )
              }
            />
          </>
        )}
        {e.ip && <DetailRow label="IP address" value={e.ip} />}
        <DetailRow label="When" value={formatDateTime(e.createdAt)} />
        {extras.map(([k, v]) => (
          <DetailRow key={k} label={humanKey(k)} value={humanValue(v)} />
        ))}
      </dl>

      <details>
        <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">
          Raw metadata
        </summary>
        <pre className="mt-1 overflow-x-auto rounded bg-gray-900/90 p-3 text-xs text-gray-100">
          {JSON.stringify({ action: e.action, resourceType: e.resourceType, resourceId: e.resourceId, ip: e.ip, metadata: m }, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export default function AdminAuditLogs() {
  const [open, setOpen] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['audit'],
    queryFn: async () => (await api.get('/admin/audit', { params: { limit: 100 } })).data,
    retry: false,
  });
  const events: AuditEvent[] = data?.data ?? [];

  return (
    <div className="card">
      <h1 className="section-title mb-1">Audit trail</h1>
      <p className="mb-3 text-sm text-gray-500">
        Append-only record of privileged and money-moving actions. Most recent 100. Click a row for the full detail.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th className="py-2 pr-3">When</th>
              <th className="py-2 pr-3">Action</th>
              <th className="py-2 pr-3">Actor</th>
              <th className="py-2 pr-3">Module</th>
              <th className="py-2">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {events.map((e) => {
              const change = statusChange(e.metadata ?? {});
              const expanded = open === e.id;
              return (
                <Fragment key={e.id}>
                  <tr
                    onClick={() => setOpen(expanded ? null : e.id)}
                    className="cursor-pointer hover:bg-rose-50/40"
                  >
                    <td className="whitespace-nowrap py-2 pr-3 text-gray-500">
                      {formatDateTime(e.createdAt)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3">
                      <span className="inline-flex items-center gap-1.5 font-medium text-gray-800">
                        <CaretRight
                          size={12}
                          className={`text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
                        />
                        {titleFor(e.action)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-gray-500">
                      {roleLabel(e.actorRole) ?? 'System'}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-gray-500">{moduleFor(e.action)}</td>
                    <td className="py-2 text-gray-500">
                      {change ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                            {change.from}
                          </span>
                          <CaretRight size={10} className="text-gray-400" />
                          <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                            {change.to}
                          </span>
                        </span>
                      ) : (
                        <span className="line-clamp-1">{describe(e)}</span>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={5} className="pb-3">
                        <AuditDetail e={e} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {events.length === 0 && <p className="text-sm text-gray-400">No events recorded yet.</p>}
    </div>
  );
}

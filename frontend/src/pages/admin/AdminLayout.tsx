import { NavLink, Outlet } from 'react-router-dom';
import type { Icon } from '@phosphor-icons/react';
import {
  Gauge,
  UsersThree,
  IdentificationCard,
  Storefront,
  SealCheck,
  ClipboardText,
  Receipt,
  Coins,
  HandHeart,
  Images,
  CheckCircle,
  ShieldCheck,
  Lifebuoy,
  Bell,
  Graph,
  ListChecks,
  Gear,
} from '@phosphor-icons/react';
import { Permission, PermissionValue, canAny } from '../../lib/permissions';
import { useAuth } from '../../store/auth';

/**
 * The Admin Portal is a page per module, not one console with tabs (EZ1-I153).
 *
 * Each entry is its own route under /admin, so an administrator can bookmark
 * "the vendors screen" and the browser back button means what it says. The
 * combined /admin console this replaced kept every module in one component's
 * local `section` state, which no URL could address and no link could reach.
 *
 * Entries are gated by the same admin permissions the endpoints behind them
 * require: a role holding only ADMIN_USERS_READ sees the directories, not the
 * audit trail. `external` entries leave the portal for an existing full page
 * (Verification runs its own screen), so they carry an absolute path.
 */
interface AdminNavEntry {
  to: string;
  label: string;
  icon: Icon;
  requires: PermissionValue[];
  /** A destination outside the /admin layout (its own established page). */
  external?: boolean;
}

export const ADMIN_NAV: AdminNavEntry[] = [
  { to: '/admin', label: 'Dashboard', icon: Gauge, requires: [Permission.ADMIN_ANALYTICS_READ] },
  { to: '/admin/users', label: 'Users', icon: UsersThree, requires: [Permission.ADMIN_USERS_READ] },
  { to: '/admin/agents', label: 'Agents', icon: IdentificationCard, requires: [Permission.ADMIN_USERS_READ] },
  { to: '/admin/vendors', label: 'Vendors', icon: Storefront, requires: [Permission.ADMIN_USERS_READ] },
  { to: '/admin/officers', label: 'Verification Officers', icon: SealCheck, requires: [Permission.ADMIN_OFFICER_MANAGE] },
  { to: '/admin/planners', label: 'Wedding Planners', icon: ClipboardText, requires: [Permission.ADMIN_USERS_READ] },
  { to: '/admin/bookings', label: 'Bookings', icon: Receipt, requires: [Permission.ADMIN_ANALYTICS_READ] },
  { to: '/admin/payments', label: 'Payments', icon: Coins, requires: [Permission.ADMIN_ANALYTICS_READ] },
  { to: '/admin/services', label: 'Services', icon: HandHeart, requires: [Permission.ADMIN_ANALYTICS_READ] },
  { to: '/admin/catalog', label: 'Catalog', icon: Images, requires: [Permission.ADMIN_ANALYTICS_READ] },
  { to: '/admin/approvals', label: 'Approvals', icon: CheckCircle, requires: [Permission.ADMIN_AGENT_APPROVE, Permission.ADMIN_VENDOR_APPROVE] },
  { to: '/verification', label: 'Verification', icon: SealCheck, requires: [Permission.VERIFICATION_ALLOCATE, Permission.VERIFICATION_PROCESS], external: true },
  { to: '/admin/support', label: 'Support', icon: Lifebuoy, requires: [Permission.ADMIN_DISPUTE_RESOLVE] },
  { to: '/admin/notifications', label: 'Notifications', icon: Bell, requires: [Permission.ADMIN_ANALYTICS_READ] },
  { to: '/admin/reports', label: 'Reports', icon: Graph, requires: [Permission.ADMIN_ANALYTICS_READ] },
  { to: '/admin/security', label: 'Security', icon: ShieldCheck, requires: [Permission.ADMIN_ANALYTICS_READ] },
  { to: '/admin/audit', label: 'Audit Logs', icon: ListChecks, requires: [Permission.ADMIN_AUDIT_READ] },
  { to: '/admin/settings', label: 'Settings', icon: Gear, requires: [Permission.ADMIN_ANALYTICS_READ] },
];

export default function AdminLayout() {
  const role = useAuth((s) => s.user?.role);
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const entries = ADMIN_NAV.filter((e) => canAny(permissions, e.requires));

  /*
   * The administrator's portal nav lives in the application's left rail now
   * (EZ1-I169), so rendering it a second time here would put two identical
   * navigations on every admin screen. The inline nav stays only for the rare
   * non-admin who reaches a module by capability alone, whose left rail carries
   * the generic application nav rather than this one.
   */
  const showNav = role !== 'admin';

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {showNav && (
      <nav
        aria-label="Admin"
        className="-mx-1 flex shrink-0 gap-1 overflow-x-auto pb-1 lg:mx-0 lg:w-56 lg:flex-col lg:overflow-visible lg:pb-0"
      >
        {entries.map(({ to, label, icon: Glyph, external }) => (
          <NavLink
            key={to}
            to={to}
            // The Dashboard index would otherwise stay active on every child
            // route, since /admin is a prefix of all of them.
            end={to === '/admin'}
            className={({ isActive }) =>
              `flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors ${
                isActive && !external
                  ? 'bg-brand-soft font-medium text-brand-strong'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`
            }
          >
            <Glyph size={17} className="shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </NavLink>
        ))}
      </nav>
      )}

      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

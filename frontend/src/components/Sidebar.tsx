import { Link, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import type { Icon } from '@phosphor-icons/react';

export interface SidebarEntry {
  to: string;
  label: string;
  icon: Icon;
  group: string;
  badge?: number;
}

/**
 * The application's navigation.
 *
 * It was a horizontal row of up to twenty-five pills with `flex-wrap`, which at
 * any real window width became two or three stacked lines. A wrapped navigation
 * is not a style problem: the row height changes as the account's permissions
 * change, the page content moves down with it, and nothing is where it was the
 * last time you looked.
 *
 * A vertical rail solves the wrap and buys the thing a long list actually needs,
 * which is grouping. Nobody scans twenty-five labels; everybody scans five
 * headings and then four labels. Entries are filtered by capability before they
 * reach here, so most accounts see three or four groups.
 */
export default function Sidebar({
  entries,
  groups,
  onNavigate,
}: {
  entries: SidebarEntry[];
  groups: { key: string; title: string | null }[];
  /** Closes the drawer on mobile. Absent on desktop, where nothing closes. */
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const reduce = useReducedMotion();

  return (
    <nav aria-label="Main" className="flex flex-col gap-6 py-1">
      {groups.map(({ key, title }) => {
        const items = entries.filter((e) => e.group === key);
        if (items.length === 0) return null;

        return (
          <div key={key}>
            {title && (
              <h2 className="mb-2 px-3 text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-gray-400">
                {title}
              </h2>
            )}
            <ul className="flex flex-col gap-0.5">
              {items.map((entry) => {
                const active = pathname === entry.to;
                const Glyph = entry.icon;

                return (
                  <li key={entry.to}>
                    <Link
                      to={entry.to}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={`group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm
                        transition-colors duration-150 ${
                          active
                            ? 'text-brand-strong'
                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                        }`}
                    >
                      {/*
                        The active background is a shared layout element rather
                        than a class on each row, so moving between pages slides
                        one shape instead of cross-fading two. It is the only
                        piece of choreography in the navigation, and it earns
                        its place by making the current location legible while
                        it changes.
                      */}
                      {active && (
                        <motion.span
                          layoutId="nav-active"
                          className="absolute inset-0 -z-10 rounded-md bg-brand-soft"
                          transition={
                            reduce
                              ? { duration: 0 }
                              : { type: 'spring', stiffness: 420, damping: 34 }
                          }
                        />
                      )}
                      <Glyph
                        size={18}
                        weight={active ? 'fill' : 'regular'}
                        className="shrink-0"
                        aria-hidden
                      />
                      <span className="truncate">{entry.label}</span>
                      {entry.badge !== undefined && entry.badge > 0 && (
                        <span
                          className="ml-auto shrink-0 rounded-full bg-brand px-1.5 py-0.5 font-mono
                            text-[0.625rem] font-semibold leading-none text-brand-fg"
                          aria-label={`${entry.badge} unread`}
                        >
                          {entry.badge > 99 ? '99+' : entry.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

import { ReactNode } from 'react';
import type { Icon } from '@phosphor-icons/react';

/**
 * The three states every list on this platform can be in, written once.
 *
 * There were a hundred and fifteen hand-rolled loading strings across the app,
 * in three spellings of the same word, and as many one-line grey empty states.
 * None of them were wrong; all of them were slightly different, which is what
 * makes an application feel assembled rather than built.
 */

/**
 * Placeholders shaped like the rows that are coming.
 *
 * A spinner says "wait". A skeleton says "wait, and here is what for" — the
 * page does not jump when the data lands, because the space was already the
 * right size. That difference is worth more than it looks on a list that
 * arrives over a phone connection.
 */
export function Loading({
  rows = 3,
  className = '',
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-3 ${className}`} role="status" aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton h-10 w-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-3" style={{ width: `${58 - i * 6}%` }} />
            <div className="skeleton h-2.5" style={{ width: `${38 - i * 4}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The card-shaped variant, for grids rather than lists. */
export function LoadingCards({ count = 3 }: { count?: number }) {
  return (
    <div
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading</span>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card space-y-3">
          <div className="skeleton h-24 w-full" />
          <div className="skeleton h-3 w-2/3" />
          <div className="skeleton h-2.5 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/**
 * Nothing here, and what to do about it.
 *
 * An empty state that only says "no results" leaves the reader to work out
 * whether they broke something, whether the platform is broken, or whether
 * this is simply the beginning. Every one of these takes a line saying which,
 * and where there is an action it is offered rather than described.
 */
export function EmptyState({
  icon: Glyph,
  title,
  children,
  action,
}: {
  icon?: Icon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {Glyph && (
        <span className="mb-4 grid h-11 w-11 place-items-center rounded-full bg-surface-sunken text-gray-400">
          <Glyph size={20} aria-hidden />
        </span>
      )}
      <p className="text-[0.9375rem] font-medium text-gray-800">{title}</p>
      {children && (
        <div className="mt-1.5 max-w-[42ch] text-sm leading-relaxed text-gray-500">{children}</div>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * A page masthead: what this screen is, and one line on what it is for.
 *
 * The subtitle is not decoration. Most of these screens are one step in a
 * process somebody is halfway through, and a sentence saying which step is the
 * difference between a page and a form.
 */
export function PageHeader({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {children && <p className="page-subtitle">{children}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

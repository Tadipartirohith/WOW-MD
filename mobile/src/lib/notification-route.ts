import type { Href } from 'expo-router';

import type { Notification } from '@/shared/notification-copy';

/**
 * Where a notification opens.
 *
 * The decision is the server's: every notification carries `targetModule`,
 * `targetAction` and `targetId`, written from one total map over the
 * notification types (backend notification-targets.ts). This turns that answer
 * into a route in *this* app, which is the only part a client is entitled to
 * decide — the web app's `linkFor` does exactly the same job against its own
 * routes.
 *
 * Null means this app has no screen for it. That is not a failure to be papered
 * over: sending somebody to the wrong screen, or to a blank one, is worse than
 * a row that says what happened and does not pretend to lead anywhere
 * (EZ1-I254). The three that answer null today — a chat thread, a planner task,
 * a wedding event — are web-only screens.
 */
type RouteOptions = { canVerify?: boolean; canReadIncoming?: boolean };

/**
 * The booking card lives on the seller's queue. A customer has no bookings
 * screen in this app yet, and the queue would answer them 403 and show nothing,
 * so for them the row marks itself read and leads nowhere.
 */
function bookingRoute(bookingId: string | null, opts: RouteOptions): Href | null {
  if (!opts.canReadIncoming) return null;
  return bookingId ? { pathname: '/bookings', params: { booking: bookingId } } : '/bookings';
}

export function routeFor(n: Notification, opts: RouteOptions = {}): Href | null {
  const payload = (n.payload ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof payload[key] === 'string' ? String(payload[key]) : null);
  const bookingId = n.targetId ?? str('bookingId');

  if (n.targetModule) {
    switch (n.targetModule) {
      // A quotation, an escrow hold, an add-on and a cancellation are all
      // facts about one booking, and the booking card is where all of them are
      // read. It opens with its detail already expanded.
      case 'bookings':
      case 'quotations':
      case 'disputes':
        return bookingRoute(bookingId, opts);
      case 'support':
        // Staff work cases on the Cases tab; the person who raised it reads
        // their own on Support (EZ1-I49).
        return opts.canVerify ? '/cases' : '/support';
      case 'verification':
        // A decision is for the applicant, who reads it on their own listing.
        // Only the staff notifications — assigned, submitted, requested — go to
        // the queue, and an assigned visit opens the visit itself.
        // Its target is the business, not a visit, so staff go to the queue.
        if (n.type === 'verification_decided') return opts.canVerify ? '/verification' : '/business';
        if (opts.canVerify && n.targetId) return { pathname: '/visit/[id]', params: { id: n.targetId } };
        return '/verification';
      case 'matches':
        return '/matches';
      case 'chat':
      case 'planner':
      case 'clients':
      case 'events':
        return null;
    }
  }

  /*
   * Rows written before the server carried the columns. Kept rather than
   * migrated to a guess: this is the derivation those rows were displayed with.
   */
  if (n.type.startsWith('booking_')) return bookingRoute(bookingId, opts);
  if (n.type.startsWith('verification_')) return '/verification';
  if (n.type.startsWith('match_')) return '/matches';

  return null;
}

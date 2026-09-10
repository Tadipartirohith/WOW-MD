import { View } from 'react-native';

import { humanise, money, shortDate } from '@/lib/format';
import type { SupportCase } from '@/lib/verification';
import { hhmm } from '@/lib/format';
import { readableTime } from '@/components/form';
import { DocumentList } from '@/components/uploader';
import { Body, Caption, Card, SectionTitle } from '@/components/ui';
import { space } from '@/theme';

/**
 * Everything about the thing a case is arguing over.
 *
 * The server fills these in per case type — the booking and its parties, the
 * escrow behind it, the business's own row, the vendor's windows, the account's
 * standing — so an officer can investigate without opening four other screens.
 * Each block appears only when the case has one, which is why a payout dispute
 * shows escrow and a listing complaint shows compliance numbers.
 */
export function CaseContext({ item }: { item: SupportCase }) {
  return (
    <>
      {/* Who raised it. */}
      {item.raisedByName || item.raisedByEmail ? (
        <Card>
          <Caption tone="faint">Raised by</Caption>
          <Body>
            {item.raisedByName ?? item.raisedByEmail}
            {item.raisedByRole ? ` · ${item.raisedByRole}` : ''}
          </Body>
          {item.raisedByName && item.raisedByEmail ? (
            <Caption tone="faint">{item.raisedByEmail}</Caption>
          ) : null}
        </Card>
      ) : null}

      {item.booking ? (
        <Card>
          <SectionTitle>Booking {item.booking.id.slice(0, 8)}</SectionTitle>
          <Caption tone="faint">{humanise(item.booking.status)}</Caption>
          <Body>{money(item.booking.amount, item.booking.currency)}</Body>
          {item.booking.buyerName ? (
            <Caption>Buyer: {item.booking.buyerName}</Caption>
          ) : null}
          {item.booking.providerName ? (
            <Caption>Provider: {item.booking.providerName}</Caption>
          ) : null}
        </Card>
      ) : null}

      {/* The escrow behind a booking or payout case, so the officer sees the
          money it is actually about and not just the booking total. */}
      {item.payments && item.payments.length > 0 ? (
        <Card>
          <SectionTitle>Escrow</SectionTitle>
          {item.payments.map((payment, i) => (
            <View key={i} style={{ gap: space(0.5) }}>
              <Body>
                {humanise(payment.milestone)} · {humanise(payment.status)}
              </Body>
              <Caption tone="faint">
                {money(payment.amount)}
                {Number(payment.payoutAmount) > 0
                  ? ` · payout ${money(payment.payoutAmount)}`
                  : ''}
                {payment.payoutNote ? ` · ${payment.payoutNote}` : ''}
              </Caption>
            </View>
          ))}
        </Card>
      ) : null}

      {/* The business's own row for a listing complaint — its standing and the
          compliance details an officer would otherwise open Verification for. */}
      {item.business ? (
        <Card>
          <SectionTitle>{item.business.name}</SectionTitle>
          <Caption tone="faint">{humanise(item.business.category)}</Caption>
          <Body>
            {humanise(item.business.status)}
            {item.business.isApproved ? ' · approved' : ' · not approved'}
            {item.business.city ? ` · ${item.business.city}` : ''}
          </Body>
          <Caption>
            {item.business.gstNumber ? `GST ${item.business.gstNumber}` : 'No GST'}
            {item.business.panNumber ? ` · PAN ${item.business.panNumber}` : ''}
            {item.business.tradingSince
              ? ` · trading since ${shortDate(item.business.tradingSince)}`
              : ''}
          </Caption>
          {item.business.revisionCount > 0 ? (
            <Caption tone="faint">{item.business.revisionCount} revisions</Caption>
          ) : null}
          {item.business.decisionReason ? (
            <Caption>Last decision: {item.business.decisionReason}</Caption>
          ) : null}
        </Card>
      ) : null}

      {/* The vendor's upcoming windows and any overbooked ones. */}
      {item.availability ? (
        <Card>
          <SectionTitle>Availability</SectionTitle>
          <Body>
            {item.availability.upcoming} upcoming
            {item.availability.conflicts > 0
              ? ` · ${item.availability.conflicts} overbooked`
              : ''}
          </Body>
          {item.availability.slots.map((slot, i) => (
            <Caption key={i} tone="faint">
              {shortDate(slot.date)} {readableTime(hhmm(slot.startTime))}–
              {readableTime(hhmm(slot.endTime))} · {slot.confirmed}/{slot.capacity} booked
              {slot.pending > 0 ? ` · ${slot.pending} pending` : ''} · {humanise(slot.status)}
            </Caption>
          ))}
        </Card>
      ) : null}

      {/* The account's standing for an account complaint. */}
      {item.account ? (
        <Card>
          <SectionTitle>Account</SectionTitle>
          <Body>{item.account.email ?? '—'}</Body>
          <Caption tone="faint">
            {item.account.role ? `${item.account.role} · ` : ''}
            {item.account.isActive ? 'active' : 'suspended'}
          </Caption>
        </Card>
      ) : null}

      {(item.evidence?.length ?? 0) > 0 ? (
        <Card>
          <SectionTitle>Evidence</SectionTitle>
          <DocumentList urls={item.evidence} />
        </Card>
      ) : null}
    </>
  );
}

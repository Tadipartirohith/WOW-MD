import { useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import {
  PAYMENT_LABEL,
  PAYMENT_TONE,
  SELLER_STATUS_LABEL,
  type IncomingBooking,
} from '@/lib/bookings';
import { dateTime, money, shortDate } from '@/lib/format';
import { formatAnswer, type FieldSpec } from '@/shared/dynamic-form';
import { MILESTONE_LABEL } from '@/shared/permissions';
import { Badge, DetailGrid, DetailRow, Divider } from '@/components/chrome';
import { VendorAddOns } from '@/components/bookings/addons';
import { Button, Caption, SectionTitle } from '@/components/ui';
import { rgb, space, useTheme } from '@/theme';

/**
 * Everything about one booking, behind the fold.
 *
 * The card above it carries what the next decision is made on. This is the rest
 * of the record, which a provider previously had to piece together from the
 * list, the Accounts ledger and their own memory of what they quoted
 * (EZ1-I252): the reference, the customer, the event, the package, what was
 * quoted and what was agreed, what has actually been paid and what is still
 * held in escrow, the add-ons, and the order it all happened in.
 *
 * Four cards, in the order the questions get asked: who and what for, what was
 * sold, what else was asked for, and where the money is. Then the thread with
 * the customer, which the card puts underneath (EZ1-I260).
 *
 * Nothing is repeated from the row above. The customer's phone and email, the
 * guest count, the date it was asked for and the budget they named are all on
 * the card already, and printing them again under a heading is what made this
 * read as a dump rather than a record.
 *
 * The quotation and the timeline are a press further in. They are what somebody
 * reaches for when a figure is disputed rather than when a job is being worked,
 * and putting them inline pushed the money off the bottom of the screen.
 *
 * Every figure is read live from the endpoints that own it. Nothing here is
 * computed from a stale copy on the row, and nothing is hardcoded.
 */
interface Quotation {
  id: string;
  amount: string;
  currency: string;
  status: string;
  notes: string | null;
  validUntil: string | null;
  createdAt: string;
}

interface Milestones {
  total: string;
  currency: string;
  milestones: { milestone: string; amount: string; status: string | null; paymentId: string | null }[];
}

type HistoryEvent = { at: string; label: string; detail: string | null };

/** A payment in one of these states has not actually been collected. */
const UNPAID = ['initiated', 'failed', 'refunded'];

export function BookingDetail({ booking }: { booking: IncomingBooking }) {
  const [showRecord, setShowRecord] = useState(false);

  const quotations = useQuery({
    queryKey: ['booking-quotations', booking.id],
    queryFn: async () => (await api.get(`/bookings/${booking.id}/quotations`)).data as Quotation[],
    enabled: showRecord,
    retry: false,
  });

  const milestones = useQuery({
    queryKey: ['booking-milestones', booking.id],
    queryFn: async () => (await api.get(`/bookings/${booking.id}/milestones`)).data as Milestones,
    retry: false,
  });

  const history = useQuery({
    queryKey: ['booking-history', booking.id],
    queryFn: async () => (await api.get(`/bookings/${booking.id}/history`)).data as HistoryEvent[],
    enabled: showRecord,
    retry: false,
  });

  // The live offer, which is the last one sent: re-quoting supersedes rather
  // than edits, so the older rows are history and not the price.
  const quotation = quotations.data?.[0] ?? null;
  const rows = milestones.data?.milestones ?? [];
  const currency = milestones.data?.currency ?? booking.currency;

  const paid = rows
    .filter((row) => row.status && !UNPAID.includes(row.status))
    .reduce((total, row) => total + Number(row.amount || 0), 0);
  const total = Number(milestones.data?.total ?? booking.amount ?? 0);
  const remaining = Math.max(0, total - paid);

  return (
    <View style={{ gap: space(3) }}>
      <Section title="Booking">
        <DetailGrid>
          <DetailRow label="Booking ID">{booking.id}</DetailRow>
          <DetailRow label="Status">
            {SELLER_STATUS_LABEL[booking.status] ?? booking.status.replace(/_/g, ' ')}
          </DetailRow>
          <DetailRow label="Customer">{booking.clientName ?? 'Customer'}</DetailRow>
          <DetailRow label="Event">{booking.eventName ?? '—'}</DetailRow>
          <DetailRow label="Date">{shortDate(booking.eventDate)}</DetailRow>
          <DetailRow label="Venue">
            {[booking.eventVenue, booking.eventCity].filter(Boolean).join(', ') || '—'}
          </DetailRow>
        </DetailGrid>
      </Section>

      <Section title="Service">
        <DetailGrid>
          <DetailRow label="Service">{booking.serviceName ?? '—'}</DetailRow>
          {booking.offeringName ? (
            <DetailRow label="Package">{booking.offeringName}</DetailRow>
          ) : null}
          {booking.quantity ? <DetailRow label="Quantity">{String(booking.quantity)}</DetailRow> : null}
          <DetailRow label="Price">{money(booking.amount, currency)}</DetailRow>
        </DetailGrid>
        {booking.requirements ? (
          <Caption>
            <Caption tone="faint">What they asked for: </Caption>
            {booking.requirements}
          </Caption>
        ) : null}
        {booking.notes ? (
          <Caption>
            <Caption tone="faint">Note: </Caption>
            {booking.notes}
          </Caption>
        ) : null}
        <ServiceAnswers booking={booking} />
      </Section>

      {/* The extras the customer asked for after the quotation: what they
          asked for, what they offered, what the vendor answered. */}
      <VendorAddOns bookingId={booking.id} />

      {showRecord && quotation ? (
        <Section title="Quotation">
          <DetailGrid>
            <DetailRow label="Quoted">{money(quotation.amount, quotation.currency)}</DetailRow>
            <DetailRow label="Status">{quotation.status.replace(/_/g, ' ')}</DetailRow>
            <DetailRow label="Sent">{shortDate(quotation.createdAt)}</DetailRow>
            {quotation.validUntil ? (
              <DetailRow label="Valid until">{shortDate(quotation.validUntil)}</DetailRow>
            ) : null}
          </DetailGrid>
          {quotation.notes ? <Caption tone="muted">{quotation.notes}</Caption> : null}
        </Section>
      ) : null}

      <Section title="Payment">
        <DetailGrid>
          <DetailRow label="Total">{money(total, currency)}</DetailRow>
          <DetailRow label="Paid">{money(paid, currency)}</DetailRow>
          <DetailRow label="Remaining">{money(remaining, currency)}</DetailRow>
        </DetailGrid>
        {booking.paymentStatus ? (
          <View style={{ flexDirection: 'row' }}>
            <Badge tone={PAYMENT_TONE[booking.paymentStatus] ?? 'neutral'}>
              {PAYMENT_LABEL[booking.paymentStatus] ?? booking.paymentStatus}
            </Badge>
          </View>
        ) : null}
        {/* The instalments, separately: an advance that has cleared and a
            balance that has not are two different facts about the same job. */}
        {rows.map((row) => (
          <View
            key={row.milestone}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}
          >
            <Caption style={{ flex: 1 }} numberOfLines={1}>
              {MILESTONE_LABEL[row.milestone] ?? row.milestone.replace(/_/g, ' ')}
            </Caption>
            <Caption style={{ fontVariant: ['tabular-nums'] }}>
              {money(row.amount, currency)}
            </Caption>
            <Caption tone={row.status && !UNPAID.includes(row.status) ? 'brand' : 'faint'}>
              {row.status
                ? (PAYMENT_LABEL[row.status] ?? row.status.replace(/_/g, ' '))
                : 'Not due yet'}
            </Caption>
          </View>
        ))}
      </Section>

      {showRecord && history.data && history.data.length > 0 ? (
        <Section title="History">
          {history.data.map((event, index) => (
            <View key={`${event.at}-${index}`} style={{ gap: space(0.5) }}>
              {index > 0 ? <Divider /> : null}
              <Caption>{event.label}</Caption>
              <Caption tone="faint">
                {[dateTime(event.at), event.detail].filter(Boolean).join(' · ')}
              </Caption>
            </View>
          ))}
        </Section>
      ) : null}

      <Button
        label={showRecord ? 'Hide quotation and history' : 'Quotation and history'}
        variant="ghost"
        small
        onPress={() => setShowRecord((open) => !open)}
      />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: space(1.5),
        paddingTop: space(2),
        borderTopWidth: 1,
        borderTopColor: rgb(theme.border),
      }}
    >
      <SectionTitle>{title}</SectionTitle>
      {children}
    </View>
  );
}

/**
 * What the buyer answered on this service's own form.
 *
 * Fetched per service rather than stored on the booking, so a label an
 * administrator has since reworded reads correctly on an old request.
 */
function ServiceAnswers({ booking }: { booking: IncomingBooking }) {
  const answers = booking.serviceAnswers ?? {};
  const hasAnswers = Object.keys(answers).length > 0;

  const { data } = useQuery<{ bookingForm: FieldSpec[] }>({
    queryKey: ['service-booking-form', booking.vendorServiceId],
    queryFn: async () => (await api.get(`/services/${booking.vendorServiceId}/booking-form`)).data,
    enabled: Boolean(booking.vendorServiceId) && hasAnswers,
    retry: false,
  });

  if (!hasAnswers) return null;
  const fields = data?.bookingForm ?? [];
  if (fields.length === 0) return null;

  return (
    <DetailGrid>
      {fields
        .filter((field) => answers[field.key] !== undefined)
        .map((field) => (
          <DetailRow key={field.key} label={field.label}>
            {formatAnswer(field, answers[field.key])}
          </DetailRow>
        ))}
    </DetailGrid>
  );
}

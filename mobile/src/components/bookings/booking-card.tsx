import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { CalendarBlank, MapPin, UsersThree } from 'phosphor-react-native';

import { api } from '@/lib/api';
import {
  ACTIONS,
  NEXT_ACTION,
  PAYMENT_LABEL,
  PAYMENT_TONE,
  QUOTABLE,
  SELLER_STATUS_LABEL,
  isRequestOnDate,
  type IncomingBooking,
} from '@/lib/bookings';
import { money, shortDate } from '@/lib/format';
import { Badge, DetailGrid, DetailRow, Divider } from '@/components/chrome';
import { BookingDetail } from '@/components/bookings/detail';
import { BookingChat } from '@/components/bookings/chat';
import { QuotationForm } from '@/components/bookings/quotation';
import { PromptSheet } from '@/components/prompt';
import { Body, Button, Caption, Card } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * One job in the provider's queue.
 *
 * Everything the decision is actually made on is on the card: who it is for,
 * where, how many people, which service, what the customer had in mind, and
 * whether any money has moved. On the web all of that arrived at once because
 * answering a request used to mean opening the wedding, the client and the
 * quotation on separate screens.
 *
 * The one thing held back is the detail behind the fold — the client's answers,
 * their add-ons, the message thread. A phone card that opened all of it would
 * be a screen, and a queue of them would be forty nested queries deep before
 * the first row was readable.
 */
export function BookingCard({
  booking,
  canQuote,
  onAct,
  acting,
  onQuoted,
  openByDefault = false,
}: {
  booking: IncomingBooking;
  canQuote: boolean;
  onAct: (id: string, path: string, body?: Record<string, unknown>) => void;
  acting: boolean;
  onQuoted: () => void;
  /**
   * Opened on arrival, for a card something else asked for by name — a
   * notification about this booking, or a row on the dashboard. Somebody who
   * tapped one booking is not then made to tap Show detail on it.
   */
  openByDefault?: boolean;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(openByDefault);
  const [quoting, setQuoting] = useState(false);
  const [deliveryPrompt, setDeliveryPrompt] = useState(false);

  // The list recycles its rows, so a card that was already mounted when the
  // request to open it arrived would keep its own collapsed state.
  useEffect(() => {
    if (openByDefault) setExpanded(true);
  }, [openByDefault]);

  const actions = ACTIONS[booking.status] ?? [];
  const onDate = isRequestOnDate(booking);
  const paid = Number(booking.paidAmount ?? 0);
  const remaining = Math.max(0, Number(booking.amount ?? 0) - paid);

  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: space(2.5) }}>
        {/* The client's photo, so the provider recognises who they are dealing
            with without opening the profile. */}
        {booking.clientPhoto ? (
          <Image
            source={{ uri: booking.clientPhoto }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: rgb(theme.surfaceSunken),
            }}
            contentFit="cover"
          />
        ) : null}
        <View style={{ flex: 1, gap: space(0.5) }}>
          {/* The real customer name; "Customer" only when the record genuinely
              has no name, never "A client". */}
          <Body numberOfLines={2}>
            {booking.clientName ?? 'Customer'}
            {booking.serviceName ? ` · ${booking.serviceName}` : ''}
            {booking.offeringName ? ` · ${booking.offeringName}` : ''}
          </Body>
          <Caption tone="faint">
            Asked {shortDate(booking.createdAt)} · {booking.id.slice(0, 8)}
          </Caption>
          {/* The customer's own contact and location, so the provider can reach
              them and place the event without opening another screen. */}
          {booking.clientPhone || booking.clientEmail || booking.clientCity || booking.eventCity ? (
            <Caption tone="faint">
              {[booking.clientPhone, booking.clientEmail, booking.clientCity ?? booking.eventCity]
                .filter(Boolean)
                .join(' · ')}
            </Caption>
          ) : null}
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5) }}>
        <Badge>{SELLER_STATUS_LABEL[booking.status] ?? booking.status.replace(/_/g, ' ')}</Badge>
        {/* Marked on the row as well as gathered under its own tab, so it reads
            as one wherever the provider comes across it. */}
        {onDate ? <Badge tone="caution">Request on date</Badge> : null}
        {booking.paymentStatus ? (
          <Badge tone={PAYMENT_TONE[booking.paymentStatus] ?? 'neutral'}>
            {PAYMENT_LABEL[booking.paymentStatus] ?? booking.paymentStatus}
          </Badge>
        ) : null}
      </View>

      {/* The facts, as chips rather than a table: a phone has no room for a
          definition list and these read fine as a sentence of icons. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(3) }}>
        {booking.eventDate ? (
          <Fact icon={<CalendarBlank size={14} color={rgb(theme.ink[400])} />}>
            {shortDate(booking.eventDate)}
          </Fact>
        ) : null}
        {booking.eventVenue || booking.eventCity ? (
          <Fact icon={<MapPin size={14} color={rgb(theme.ink[400])} />}>
            {[booking.eventVenue, booking.eventCity].filter(Boolean).join(', ')}
          </Fact>
        ) : null}
        {booking.expectedGuests ? (
          <Fact icon={<UsersThree size={14} color={rgb(theme.ink[400])} />}>
            {`${booking.expectedGuests} guests`}
          </Fact>
        ) : null}
      </View>

      <DetailGrid>
        <View style={{ flexDirection: 'row', gap: space(4) }}>
          <View style={{ flex: 1 }}>
            <DetailRow label="Amount">{money(booking.amount, booking.currency)}</DetailRow>
          </View>
          {/*
            Once the advance has cleared, what is paid and what is left are the
            two figures a vendor is actually tracking — and both come off the
            list read rather than a request per row (EZ1-I259).
          */}
          {paid > 0 ? (
            <View style={{ flex: 1 }}>
              <DetailRow label="Paid">{money(paid, booking.currency)}</DetailRow>
            </View>
          ) : null}
          {/*
            The number the customer actually entered when they asked: the
            booking amount is 0 until a quote is agreed, so without this the
            vendor saw INR 0 and could not tell what the customer had in mind.
          */}
          {booking.expectedBudget && Number(booking.expectedBudget) > 0 ? (
            <View style={{ flex: 1 }}>
              <DetailRow label="Customer budget">
                {money(booking.expectedBudget, booking.currency)}
              </DetailRow>
            </View>
          ) : null}
        </View>
      </DetailGrid>

      {paid > 0 && remaining > 0 ? (
        <Caption tone="faint">Remaining {money(remaining, booking.currency)}</Caption>
      ) : null}

      {/* The one thing waiting on the provider, so the queue reads as a to-do
          list rather than a wall of statuses. */}
      {NEXT_ACTION[booking.status] ? (
        <Caption style={{ color: rgb(theme.cautionFg), fontWeight: '600' }}>
          Next: {NEXT_ACTION[booking.status]}
        </Caption>
      ) : null}

      {/* Why a cancelled booking was cancelled, and by whom. */}
      {booking.status === 'cancelled' && (booking.cancellationReason || booking.cancelledByName) ? (
        <View
          style={{
            backgroundColor: rgb(theme.criticalBg),
            borderRadius: radius.sm,
            padding: space(2.5),
          }}
        >
          <Caption style={{ color: rgb(theme.criticalFg) }}>
            Cancelled
            {booking.cancelledByName
              ? ` by ${booking.cancelledByName}${
                  booking.cancelledByRole ? ` (${booking.cancelledByRole})` : ''
                }`
              : ''}
            {booking.cancellationReason ? ` — ${booking.cancellationReason}` : ''}
          </Caption>
        </View>
      ) : null}

      {booking.requirements ? (
        <Sunken>
          <Caption>{booking.requirements}</Caption>
        </Sunken>
      ) : null}

      {/* A free-text note the customer left on the request. */}
      {booking.notes ? (
        <Sunken>
          <Caption>
            <Caption tone="faint">Note: </Caption>
            {booking.notes}
          </Caption>
        </Sunken>
      ) : null}

      <Divider />

      {/* What the buyer answered on this service's own form, plus the add-ons
          and the thread. Fetched only when opened. */}
      <Button
        label={expanded ? 'Hide detail' : 'Show detail'}
        variant="ghost"
        small
        onPress={() => setExpanded((e) => !e)}
      />
      {expanded && (
        <>
          <BookingDetail booking={booking} />
          <BookingChat bookingId={booking.id} />
        </>
      )}

      {(actions.length > 0 || (canQuote && QUOTABLE.includes(booking.status))) && (
        <View style={{ gap: space(2) }}>
          {canQuote && QUOTABLE.includes(booking.status) ? (
            <Button
              label={booking.status === 'quotation_sent' ? 'Re-quote' : 'Send quotation'}
              onPress={() => setQuoting((q) => !q)}
            />
          ) : null}
          {actions.map((action) => (
            <Button
              key={action.path}
              label={action.label}
              variant={action.primary ? 'primary' : 'outline'}
              disabled={acting}
              onPress={() => {
                /*
                  Marking a delivery asks what was delivered.

                  Optional — a caterer has nothing to show, a photographer has a
                  gallery link — but when it is given it stays on the booking,
                  which is what the customer reads before confirming and what an
                  administrator settling a later dispute needs. Cancelling the
                  prompt cancels the action rather than marking it delivered
                  with no note.
                */
                if (action.path === 'complete') {
                  setDeliveryPrompt(true);
                  return;
                }
                onAct(booking.id, action.path);
              }}
            />
          ))}
        </View>
      )}

      {quoting && (
        <QuotationForm
          bookingId={booking.id}
          onDone={() => {
            setQuoting(false);
            onQuoted();
          }}
          onCancel={() => setQuoting(false)}
        />
      )}

      <PromptSheet
        visible={deliveryPrompt}
        title="What was delivered?"
        message="The customer sees this when they confirm. Leave it blank to skip."
        placeholder="Gallery link, delivery note, anything the customer should see"
        confirmLabel="Mark delivered"
        onCancel={() => setDeliveryPrompt(false)}
        onConfirm={(value) => {
          setDeliveryPrompt(false);
          onAct(booking.id, 'complete', value ? { notes: value } : {});
        }}
      />
    </Card>
  );
}

function Fact({ icon, children }: { icon: React.ReactNode; children: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
      {icon}
      <Caption>{children}</Caption>
    </View>
  );
}

function Sunken({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: rgb(theme.surfaceSunken),
        borderRadius: radius.sm,
        padding: space(2.5),
      }}
    >
      {children}
    </View>
  );
}

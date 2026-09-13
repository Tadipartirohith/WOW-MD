import { useState } from 'react';
import { View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { Badge, type Tone } from '@/components/chrome';
import { PromptSheet } from '@/components/prompt';
import { Alert, Body, Button, Caption } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

interface BookingAddon {
  id: string;
  title: string;
  description: string | null;
  quantity: number;
  proposedPrice: string | null;
  vendorPrice: string | null;
  currency: string;
  note: string | null;
  status: 'requested' | 'accepted' | 'rejected' | 'requoted';
  responseNote: string | null;
  createdAt: string;
}

const ADDON_STATUS_LABEL: Record<BookingAddon['status'], string> = {
  requested: 'Awaiting your response',
  requoted: 'Requoted → awaiting the client',
  accepted: 'Agreed',
  rejected: 'Declined',
};

const ADDON_STATUS_TONE: Record<BookingAddon['status'], Tone> = {
  requested: 'caution',
  requoted: 'brand',
  accepted: 'positive',
  rejected: 'neutral',
};

/**
 * Add-on requests the client raised on this booking.
 *
 * The seller side of the mini-quotation on a confirmed booking: the vendor sees
 * each extra the client asked for and accepts it, rejects it, or requotes with
 * their own price for the client to accept. Only the requests still awaiting
 * the vendor carry the controls — an agreed add-on is a record, not a decision.
 */
export function VendorAddOns({ bookingId }: { bookingId: string }) {
  const theme = useTheme();
  const qc = useQueryClient();
  const [requoting, setRequoting] = useState<BookingAddon | null>(null);
  const [error, setError] = useState('');

  const { data: addons } = useQuery({
    queryKey: ['incoming-addons', bookingId],
    queryFn: async () => (await api.get(`/bookings/${bookingId}/addons`)).data as BookingAddon[],
    retry: false,
  });

  async function run(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      /*
       * An accepted add-on is money owed, and the server puts it on the booking
       * total. Refreshing only the add-on list left the card, the instalments
       * and the earnings all showing the amount from before it was agreed
       * (EZ1-I259).
       */
      for (const key of [
        ['incoming-addons', bookingId],
        ['booking-milestones', bookingId],
        ['booking-history', bookingId],
        ['incoming-bookings'],
        ['incoming-counts'],
        ['earnings'],
      ]) {
        void qc.invalidateQueries({ queryKey: key });
      }
      setRequoting(null);
    } catch (err) {
      setError(apiMessage(err, 'That action was rejected.'));
    }
  }

  if ((addons ?? []).length === 0) return null;

  return (
    <View
      style={{
        gap: space(2),
        backgroundColor: rgb(theme.surfaceSunken),
        borderRadius: radius.sm,
        padding: space(3),
        marginTop: space(2),
      }}
    >
      <Body style={{ fontWeight: '600' }}>Add-on requests</Body>
      {error ? <Alert tone="critical">{error}</Alert> : null}

      {(addons ?? []).map((addon) => (
        <View
          key={addon.id}
          style={{
            backgroundColor: rgb(theme.surface),
            borderRadius: radius.sm,
            padding: space(2.5),
            gap: space(1.5),
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
            <Body style={{ flex: 1 }}>
              {addon.title}
              {addon.quantity > 1 ? ` × ${addon.quantity}` : ''}
            </Body>
            <Badge tone={ADDON_STATUS_TONE[addon.status]}>{ADDON_STATUS_LABEL[addon.status]}</Badge>
          </View>

          {addon.description ? <Caption>{addon.description}</Caption> : null}
          {addon.note ? <Caption tone="faint">Client note: {addon.note}</Caption> : null}

          {addon.proposedPrice != null ? (
            <Caption>Client proposed: {money(addon.proposedPrice, addon.currency)}</Caption>
          ) : null}
          {addon.vendorPrice != null ? (
            <Body>Your price: {money(addon.vendorPrice, addon.currency)}</Body>
          ) : null}

          {addon.status === 'requested' && (
            <View style={{ gap: space(2), marginTop: space(1) }}>
              <Button
                label="Accept"
                small
                onPress={() => void run(() => api.put(`/bookings/addons/${addon.id}/accept`, {}))}
              />
              <View style={{ flexDirection: 'row', gap: space(2) }}>
                <Button
                  label="Reject"
                  variant="outline"
                  small
                  style={{ flex: 1 }}
                  onPress={() => void run(() => api.put(`/bookings/addons/${addon.id}/reject`, {}))}
                />
                <Button
                  label="Requote"
                  variant="outline"
                  small
                  style={{ flex: 1 }}
                  onPress={() => setRequoting(addon)}
                />
              </View>
            </View>
          )}
        </View>
      ))}

      <PromptSheet
        visible={requoting !== null}
        title="Your price for this add-on"
        message="The client accepts or declines your number; nothing is charged until they do."
        placeholder="Your price"
        confirmLabel="Send price"
        multiline={false}
        keyboardNumeric
        minLength={1}
        initialValue={requoting?.proposedPrice ?? ''}
        onCancel={() => setRequoting(null)}
        onConfirm={(value) => {
          const addon = requoting;
          if (!addon) return;
          void run(() =>
            api.put(`/bookings/addons/${addon.id}/requote`, { vendorPrice: Number(value) }),
          );
        }}
      />
    </View>
  );
}

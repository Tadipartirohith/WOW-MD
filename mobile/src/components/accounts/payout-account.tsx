import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { Badge } from '@/components/chrome';
import { Alert, Body, Button, Caption, Card, Field, SectionTitle } from '@/components/ui';
import { space } from '@/theme';

/**
 * Where a vendor's money leaves escrow to.
 *
 * Lives on Accounts alongside the rest of the payment picture rather than
 * inside My Business, which is only about the shop window.
 */
export function PayoutAccount({
  vendorId,
  current,
}: {
  vendorId: string;
  current: string | null;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState(current ?? '');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setValue(current ?? ''), [current]);

  async function save() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api.put(`/vendors/${vendorId}/payout-account`, { payoutAccountId: value.trim() });
      await Promise.all(
        ['my-listing', 'earnings', 'payout-account', 'vendor-me'].map((key) =>
          qc.invalidateQueries({ queryKey: [key] }),
        ),
      );
      setEditing(false);
      setNotice(
        value.trim()
          ? 'Saved. Anything already owed to you goes out on the next payout run.'
          : 'Cleared. Payouts will be held until you add an account.',
      );
    } catch (err) {
      setError(apiMessage(err, 'That could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
        <SectionTitle style={{ flex: 1 }}>Payout account</SectionTitle>
        <Badge tone={current ? 'positive' : 'caution'}>{current ? 'Ready' : 'Not set up'}</Badge>
      </View>
      <Body tone="muted">
        Where money leaves escrow to. Until this is set, what you have earned is held as owed rather
        than paid.
      </Body>

      {error ? <Alert tone="critical">{error}</Alert> : null}
      {notice ? <Alert tone="positive">{notice}</Alert> : null}

      {!editing ? (
        <View style={{ gap: space(2) }}>
          <Body tone={current ? 'default' : 'faint'}>{current ?? 'No payout account'}</Body>
          <Button
            label={current ? 'Change' : 'Add one'}
            variant="outline"
            small
            onPress={() => setEditing(true)}
          />
        </View>
      ) : (
        <View style={{ gap: space(2.5) }}>
          <Field
            label="Linked account"
            placeholder="acc_XXXXXXXXXXXX"
            value={value}
            onChangeText={setValue}
            autoCapitalize="none"
            autoCorrect={false}
            hint="From your payment gateway, once your onboarding has cleared. Leave it blank to stop payouts."
          />
          <Button label="Save" busy={busy} onPress={() => void save()} />
          <Button
            label="Cancel"
            variant="outline"
            onPress={() => {
              setEditing(false);
              setValue(current ?? '');
            }}
          />
        </View>
      )}
    </Card>
  );
}

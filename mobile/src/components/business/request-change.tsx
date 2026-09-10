import { useState } from 'react';
import { View } from 'react-native';

import { api, apiMessage } from '@/lib/api';
import { Textarea } from '@/components/form';
import { Alert, Body, Button, Caption, Card, SectionTitle } from '@/components/ui';
import { space } from '@/theme';

/**
 * A verified listing's legal details are locked, so a genuine change to one
 * goes through the same correction path an officer uses.
 *
 * The vendor has no endpoint to reopen their own listing — and should not: the
 * point of verification is that they cannot quietly rewrite what was checked.
 * So this raises a `vendor` support case describing the change, and the team
 * then reopens the listing through the existing unlock flow.
 */
export function RequestChange({ vendorId }: { vendorId: string }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api.post('/verification/cases', {
        subjectType: 'vendor',
        subjectId: vendorId,
        title: 'Change request: verified business details',
        description: detail.trim(),
      });
      setNotice('Sent. Our team will review it and reopen the listing if the change checks out.');
      setDetail('');
      setOpen(false);
    } catch (err) {
      setError(apiMessage(err, 'That could not be sent.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: space(2.5) }}>
      <SectionTitle>Request a change</SectionTitle>
      <Body tone="muted">
        PAN, GST, registration and the other verified details are locked. Need one changed?
      </Body>

      {notice ? <Alert tone="positive">{notice}</Alert> : null}
      {error ? <Alert tone="critical">{error}</Alert> : null}

      {!open ? (
        <Button label="Request a change" variant="outline" onPress={() => setOpen(true)} />
      ) : (
        <View style={{ gap: space(2.5) }}>
          <Textarea
            label="What needs changing"
            value={detail}
            onChange={setDetail}
            rows={4}
            maxLength={2000}
            placeholder="Which detail needs changing, what it should be, and why."
            hint="At least ten characters — the team reads this verbatim."
          />
          <View style={{ flexDirection: 'row', gap: space(2) }}>
            <Button
              label="Cancel"
              variant="outline"
              onPress={() => {
                setOpen(false);
                setDetail('');
              }}
              style={{ flex: 1 }}
            />
            <Button
              label="Send request"
              busy={busy}
              disabled={detail.trim().length < 10}
              onPress={() => void submit()}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      )}
    </Card>
  );
}

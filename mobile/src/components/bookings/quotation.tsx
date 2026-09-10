import { useState } from 'react';
import { View } from 'react-native';

import { api, apiMessage } from '@/lib/api';
import { rupees } from '@/lib/format';
import { Permission, can } from '@/shared/permissions';
import { Divider } from '@/components/chrome';
import { CheckRow, DateField, Textarea } from '@/components/form';
import { Alert, Body, Button, Caption, Field } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * The price the provider puts on a job.
 *
 * The one thing worth pointing at is the breakdown. It is kept apart from the
 * notes on purpose: a note is a covering message, and these lines are what the
 * job is priced on and what a dispute argues from. The mismatch check is here
 * for the same reason — lines that do not add up to the total are a quotation
 * two people will read differently.
 */
export function QuotationForm({
  bookingId,
  onDone,
  onCancel,
}: {
  bookingId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const isPlanner = can(
    useAuth((s) => s.user?.permissions ?? []),
    Permission.PLANNER_LISTING_MANAGE,
  );

  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [validUntil, setValidUntil] = useState('');
  // A planner quotes with or without arranging vendors; the choice is recorded
  // so the client sees which offer this is.
  const [vendorsIncluded, setVendorsIncluded] = useState(false);
  const [lines, setLines] = useState<{ description: string; amount: string }[]>([
    { description: '', amount: '' },
  ]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const filled = lines.filter((l) => l.description.trim() && l.amount);
  const lineTotal = filled.reduce((total, line) => total + Number(line.amount || 0), 0);
  const mismatch = filled.length > 0 && Math.abs(lineTotal - Number(amount || 0)) > 0.001;

  async function submit() {
    setError('');
    setBusy(true);
    try {
      await api.post(`/bookings/${bookingId}/quotations`, {
        amount: Number(amount),
        notes: notes || undefined,
        terms: terms || undefined,
        validUntil: validUntil || undefined,
        vendorsIncluded: isPlanner ? vendorsIncluded : undefined,
        lines: filled.length
          ? filled.map((l) => ({ description: l.description.trim(), amount: Number(l.amount) }))
          : undefined,
      });
      onDone();
    } catch (err) {
      setError(apiMessage(err, 'That quotation was rejected.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      style={{
        width: '100%',
        gap: space(3),
        backgroundColor: rgb(theme.surfaceSunken),
        borderRadius: radius.md,
        padding: space(3),
      }}
    >
      <Body style={{ fontWeight: '600' }}>Send a quotation</Body>
      {error ? <Alert tone="critical">{error}</Alert> : null}

      {isPlanner && (
        <CheckRow
          label="This quotation includes arranging the couple's vendors"
          hint="Add the vendor and service costs plus your coordination fee to the total and itemise them below. Leave it off to quote your own services only."
          checked={vendorsIncluded}
          onChange={setVendorsIncluded}
        />
      )}

      <Field
        label="Total"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0"
      />
      <Field label="Notes for the client" value={notes} onChangeText={setNotes} />
      <DateField
        label="Valid until"
        value={validUntil}
        onChange={setValidUntil}
        hint="Left blank, the offer stands for 14 days."
      />
      <Textarea
        label="Terms"
        value={terms}
        onChange={setTerms}
        rows={4}
        placeholder="Cancellation, overtime, travel, what happens if the guest count changes"
      />

      <Divider />
      <Body style={{ fontWeight: '600' }}>Breakdown (optional)</Body>
      {lines.map((line, i) => (
        <View key={i} style={{ gap: space(2) }}>
          <Field
            label={`Line ${i + 1}`}
            placeholder="What it covers"
            value={line.description}
            onChangeText={(text) =>
              setLines((ls) => ls.map((l, j) => (j === i ? { ...l, description: text } : l)))
            }
          />
          <Field
            label="Amount"
            value={line.amount}
            keyboardType="decimal-pad"
            onChangeText={(text) =>
              setLines((ls) => ls.map((l, j) => (j === i ? { ...l, amount: text } : l)))
            }
          />
        </View>
      ))}
      <Button
        label="Add a line"
        variant="outline"
        small
        onPress={() => setLines((ls) => [...ls, { description: '', amount: '' }])}
      />
      {filled.length > 0 ? (
        <Caption tone={mismatch ? 'critical' : 'muted'}>
          The lines add up to {rupees(lineTotal)}
          {mismatch ? ', which does not match the total.' : '.'}
        </Caption>
      ) : null}

      <Button
        label="Send to the client"
        busy={busy}
        disabled={!amount || mismatch}
        onPress={() => void submit()}
      />
      <Button label="Cancel" variant="outline" onPress={onCancel} />
    </View>
  );
}

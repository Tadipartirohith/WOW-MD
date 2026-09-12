import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { todayIso } from '@/shared/dates';
import { Badge } from '@/components/chrome';
import { DateField, SelectField } from '@/components/form';
import { Alert, Body, Button, Card, Field, SectionTitle } from '@/components/ui';
import { space } from '@/theme';

type AvailabilityStatus = 'available' | 'on_leave' | 'unavailable';

interface Availability {
  status: AvailabilityStatus;
  leaveFrom: string | null;
  leaveTo: string | null;
  leaveReason: string | null;
  /** Whether allocation is skipping the officer right now. */
  onLeaveNow: boolean;
}

const AVAILABILITY_LABEL: Record<AvailabilityStatus, string> = {
  available: 'Available',
  on_leave: 'On leave',
  unavailable: 'Unavailable',
};

/**
 * An officer setting whether they are taking fieldwork.
 *
 * Available is the working default. On leave carries a start and end date, so a
 * leave booked for next week does not pull the officer out of allocation today;
 * unavailable is an open-ended stand down. Auto-allocation skips anyone who is
 * not available now — an administrator can still name them directly, which is
 * why this only sets a preference rather than blocking work outright.
 *
 * This is the screen an officer is most likely to want from a phone, which is
 * part of why the portal is worth having here at all: somebody who is ill at
 * seven in the morning should be able to come off the roster without opening a
 * laptop.
 */
export function MyAvailability() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['my-availability'],
    queryFn: async () =>
      (await api.get('/verification/officers/me/availability')).data as Availability,
    retry: false,
  });

  const [status, setStatus] = useState<AvailabilityStatus>('available');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  // Seed the form from the server once, then leave the officer's edits alone.
  useEffect(() => {
    if (data && !seeded) {
      setStatus(data.status);
      setFrom(data.leaveFrom ?? '');
      setTo(data.leaveTo ?? '');
      setReason(data.leaveReason ?? '');
      setSeeded(true);
    }
  }, [data, seeded]);

  const onLeave = status === 'on_leave';
  /*
   * Leave is booked, not recorded. A window that starts before today is either
   * a typo or an attempt to backdate a stand-down that already happened, and
   * neither can change what was allocated while it was not there — so the
   * floor is today, the end may not precede the start, and the server rejects
   * both as well (EZ1-I256).
   *
   * A start date already on the record is left alone: an officer correcting the
   * reason on leave that began last week is not setting a past date, and this
   * must not turn their existing row into something they can no longer save.
   */
  const today = todayIso();
  const kept = data?.leaveFrom ?? '';
  const startInPast = from !== '' && from < today && from !== kept;
  const endBeforeStart = from !== '' && to !== '' && to < from;
  const datesOk = !onLeave || (from !== '' && to !== '' && !startInPast && !endBeforeStart);

  async function save() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api.put('/verification/officers/me/availability', {
        status,
        leaveFrom: onLeave ? from : undefined,
        leaveTo: onLeave ? to : undefined,
        leaveReason: onLeave && reason ? reason : undefined,
      });
      setNotice('Availability updated.');
      setOpen(false);
      // So the admin roster and the allocation workload reflect it at once.
      for (const key of ['my-availability', 'verification-officers', 'verification-workload']) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    } catch (err) {
      setError(apiMessage(err, 'Could not update availability.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
        <SectionTitle style={{ flex: 1 }}>My availability</SectionTitle>
        {data ? (
          <Badge tone={data.status === 'available' ? 'positive' : 'caution'}>
            {AVAILABILITY_LABEL[data.status]}
            {data.status === 'on_leave' && data.leaveFrom && data.leaveTo
              ? ` · ${data.leaveFrom} to ${data.leaveTo}`
              : ''}
          </Badge>
        ) : null}
      </View>
      <Body tone="muted">
        New verifications are not auto-allocated to you while you are on leave or unavailable. An
        administrator can still assign one to you by name.
      </Body>

      {notice ? <Alert tone="positive">{notice}</Alert> : null}

      {!open ? (
        <Button label="Change" variant="outline" small onPress={() => setOpen(true)} />
      ) : (
        <View style={{ gap: space(2.5) }}>
          <SelectField
            label="Status"
            value={status}
            onChange={(value) => setStatus(value as AvailabilityStatus)}
            options={(Object.keys(AVAILABILITY_LABEL) as AvailabilityStatus[]).map((s) => ({
              value: s,
              label: AVAILABILITY_LABEL[s],
            }))}
          />

          {onLeave && (
            <>
              <DateField
                label="From"
                value={from}
                onChange={(value) => {
                  setFrom(value);
                  // An end that now precedes the start would be an invalid
                  // window the officer never typed; clear it rather than mark
                  // it wrong.
                  if (to !== '' && to < value) setTo('');
                }}
                from={kept && kept < today ? kept : today}
                error={startInPast ? 'Leave cannot start before today.' : undefined}
              />
              <DateField
                label="To"
                value={to}
                onChange={setTo}
                from={from || today}
                error={endBeforeStart ? 'End date cannot be before the start date.' : undefined}
              />
              <Field
                label="Reason"
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. Annual leave"
                hint="Optional. Only an administrator sees this."
              />
            </>
          )}

          {error ? <Alert tone="critical">{error}</Alert> : null}

          <Button
            label="Save availability"
            busy={busy}
            disabled={!datesOk}
            onPress={() => void save()}
          />
          <Button label="Cancel" variant="outline" onPress={() => setOpen(false)} />
        </View>
      )}
    </Card>
  );
}

import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { hhmm } from '@/lib/format';
import type { SlotState } from '@/shared/permissions';
import { Badge, Divider, type Tone } from '@/components/chrome';
import { SelectField, TimeField, readableTime } from '@/components/form';
import { Alert, Body, Button, Caption, Field, SectionTitle } from '@/components/ui';
import { rgb, space, useTheme } from '@/theme';

/**
 * A published window, exactly as the server reports it.
 *
 * `remaining`, `state`, `bookable` and `actions` are all computed server-side.
 * Every button below is rendered from `actions`, so nothing appears that would
 * be refused — and nothing is hidden that would be accepted.
 */
export interface Slot {
  id: string;
  vendorServiceId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  confirmed: number;
  pending: number;
  remaining: number;
  state: SlotState;
  bookable: boolean;
  note: string | null;
  blockReason: string | null;
  actions: { canEdit: boolean; canRetime: boolean; canBlock: boolean; canDelete: boolean };
}

const SLOT_TONE: Record<SlotState, Tone> = {
  open: 'positive',
  booked: 'brand',
  full: 'neutral',
  blocked: 'critical',
  cancelled: 'neutral',
};

interface ServiceOption {
  id: string;
  displayName: string | null;
  concurrentCapacity: number;
  definition: { name: string } | null;
}

const serviceName = (service: ServiceOption) =>
  service.displayName ?? service.definition?.name ?? 'Service';

/**
 * The four numbers that matter, always shown together.
 *
 * "3 of 5 taken" on its own hid the difference between a booking and a
 * question, which is exactly what made the old web page misleading.
 */
function SlotCounts({ slot }: { slot: Slot }) {
  const theme = useTheme();
  return (
    <Caption>
      <Caption style={{ color: rgb(theme.ink[900]), fontWeight: '600' }}>{slot.confirmed}</Caption>
      {' confirmed · '}
      <Caption style={slot.pending > 0 ? { color: rgb(theme.cautionFg), fontWeight: '600' } : undefined}>
        {slot.pending} pending
      </Caption>
      {' · '}
      <Caption
        style={
          slot.remaining > 0
            ? { color: rgb(theme.positiveFg), fontWeight: '600' }
            : { color: rgb(theme.ink[500]) }
        }
      >
        {slot.remaining} left
      </Caption>
      {` of ${slot.capacity}`}
    </Caption>
  );
}

export function SlotRow({
  slot,
  stateLabel,
  onSave,
  onBlock,
  onUnblock,
  onDelete,
}: {
  slot: Slot;
  stateLabel: string;
  onSave: (body: Record<string, unknown>) => void;
  onBlock: () => void;
  onUnblock: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (editing) {
    return (
      <EditSlot
        slot={slot}
        onCancel={() => setEditing(false)}
        onSave={(body) => {
          onSave(body);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <View style={{ gap: space(2), paddingVertical: space(2) }}>
      <Divider />
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
        <View style={{ flex: 1, gap: space(1) }}>
          <Body>
            {readableTime(hhmm(slot.startTime))} – {readableTime(hhmm(slot.endTime))}
          </Body>
          <SlotCounts slot={slot} />
          {slot.note || slot.blockReason ? (
            <Caption tone="faint">
              {[slot.note, slot.blockReason].filter(Boolean).join(' · ')}
            </Caption>
          ) : null}
        </View>
        <Badge tone={SLOT_TONE[slot.state]}>{stateLabel}</Badge>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
        {slot.actions.canEdit ? (
          <Button
            label="Edit"
            variant="outline"
            small
            onPress={() => setEditing(true)}
            style={{ flex: 1 }}
          />
        ) : null}
        {slot.state === 'blocked' ? (
          <Button label="Unblock" variant="outline" small onPress={onUnblock} style={{ flex: 1 }} />
        ) : slot.actions.canBlock ? (
          <Button label="Block" variant="outline" small onPress={onBlock} style={{ flex: 1 }} />
        ) : null}
        {slot.actions.canDelete ? (
          <Button
            // Two presses rather than a dialog: withdrawing a window takes it
            // off sale for good, and there is nothing else on this row that a
            // stray tap could confuse it with.
            label={confirmingDelete ? 'Really delete' : 'Delete'}
            variant="outline"
            small
            onPress={() => (confirmingDelete ? onDelete() : setConfirmingDelete(true))}
            style={{ flex: 1 }}
          />
        ) : null}
      </View>
    </View>
  );
}

/**
 * Editing a published window.
 *
 * The times are only offered when the server says they can still change; the
 * capacity and the note are always editable, because nothing has been promised
 * against them.
 */
function EditSlot({
  slot,
  onSave,
  onCancel,
}: {
  slot: Slot;
  onSave: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [start, setStart] = useState(hhmm(slot.startTime));
  const [end, setEnd] = useState(hhmm(slot.endTime));
  const [capacity, setCapacity] = useState(String(slot.capacity));
  const [note, setNote] = useState(slot.note ?? '');
  const [problem, setProblem] = useState('');

  useEffect(() => {
    setStart(hhmm(slot.startTime));
    setEnd(hhmm(slot.endTime));
    setCapacity(String(slot.capacity));
    setNote(slot.note ?? '');
  }, [slot]);

  function submit() {
    if (slot.actions.canRetime && end <= start) {
      setProblem('The end time has to be after the start time.');
      return;
    }
    const n = Number(capacity);
    if (!Number.isInteger(n) || n < 1) {
      setProblem('Capacity has to be a whole number, at least one.');
      return;
    }
    if (n < slot.confirmed) {
      setProblem(`This window already holds ${slot.confirmed} confirmed booking(s).`);
      return;
    }
    setProblem('');
    onSave({
      ...(slot.actions.canRetime ? { startTime: start, endTime: end } : {}),
      capacity: n,
      note: note.trim(),
    });
  }

  return (
    <View style={{ gap: space(3), paddingVertical: space(2) }}>
      <Divider />
      <SectionTitle>Edit this window</SectionTitle>
      <TimeField
        label="From"
        value={start}
        onChange={setStart}
        disabled={!slot.actions.canRetime}
      />
      <TimeField label="To" value={end} onChange={setEnd} disabled={!slot.actions.canRetime} />
      {!slot.actions.canRetime ? (
        <Caption tone="faint">
          The times are fixed now. Somebody has already planned their day around this window.
        </Caption>
      ) : null}
      <Field
        label="Capacity"
        value={capacity}
        onChangeText={setCapacity}
        keyboardType="number-pad"
      />
      <Field label="Note" value={note} onChangeText={setNote} />
      {problem ? <Alert tone="critical">{problem}</Alert> : null}
      <Button label="Save" onPress={submit} />
      <Button label="Cancel" variant="outline" onPress={onCancel} />
    </View>
  );
}

export function NewSlot({
  date,
  services,
  onCreate,
}: {
  date: string;
  services: ServiceOption[];
  onCreate: (body: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('13:00');
  // Availability is per service: a window must name the service it is for, so
  // publishing time for one service does not make every service look bookable.
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [capacity, setCapacity] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (!serviceId && services.length > 0) setServiceId(services[0].id);
  }, [services, serviceId]);

  const service = services.find((s) => s.id === serviceId);
  // Capacity follows the service unless the vendor overrides it for this one
  // window, which is where "five teams, but only three free that Saturday"
  // gets said.
  const effectiveCapacity = capacity === '' ? (service?.concurrentCapacity ?? 1) : Number(capacity);

  function submit() {
    if (end <= start) {
      setProblem('The end time has to be after the start time.');
      return;
    }
    if (!Number.isInteger(effectiveCapacity) || effectiveCapacity < 1) {
      setProblem('Capacity has to be a whole number, at least one.');
      return;
    }
    // A window with no service would show under every service, so a vendor who
    // has services must pick the one this window is for.
    if (services.length > 0 && !serviceId) {
      setProblem('Choose the service this window is for.');
      return;
    }
    setProblem('');
    onCreate({
      date,
      startTime: start,
      endTime: end,
      capacity: effectiveCapacity,
      vendorServiceId: serviceId || undefined,
      note: note.trim() || undefined,
    });
    setNote('');
    setOpen(false);
  }

  if (!open) {
    return (
      <>
        <Divider />
        <Button label="Publish a window" onPress={() => setOpen(true)} />
      </>
    );
  }

  return (
    <View style={{ gap: space(3) }}>
      <Divider />
      <SectionTitle>Publish a window</SectionTitle>
      <TimeField label="From" value={start} onChange={setStart} />
      <TimeField label="To" value={end} onChange={setEnd} />
      {services.length > 0 && (
        <SelectField
          label="Service"
          value={serviceId}
          onChange={(value) => {
            setServiceId(value);
            setCapacity('');
          }}
          options={services.map((s) => ({ value: s.id, label: serviceName(s) }))}
        />
      )}
      <Field
        label="Capacity"
        value={capacity}
        onChangeText={setCapacity}
        keyboardType="number-pad"
        placeholder={String(service?.concurrentCapacity ?? 1)}
        hint="How many bookings this window can take at once: five if you can run five teams, one for a hall."
      />
      <Field label="Note" value={note} onChangeText={setNote} placeholder="Morning sitting" />
      {problem ? <Alert tone="critical">{problem}</Alert> : null}
      <Button label="Publish window" onPress={submit} />
      <Button label="Cancel" variant="outline" onPress={() => setOpen(false)} />
    </View>
  );
}

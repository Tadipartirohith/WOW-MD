import { useState } from 'react';
import { View } from 'react-native';

import { api } from '@/lib/api';
import { formatAnswer, validateAnswers, cleanAnswers, type Answers } from '@/shared/dynamic-form';
import { Badge, DetailGrid, DetailRow, Divider } from '@/components/chrome';
import { DynamicForm } from '@/components/dynamic-form';
import { Textarea } from '@/components/form';
import { Offerings } from '@/components/business/offerings';
import type { VendorService } from '@/components/business/service-types';
import { Body, Button, Caption, Card, Field, SectionTitle } from '@/components/ui';
import { space } from '@/theme';

/**
 * One service the business sells.
 *
 * The web client renders every service's edit form and every service's prices
 * inline, all expandable at once. Here each card holds three states — read,
 * edit, prices — and only one of them at a time, because a phone showing two
 * open forms is a phone showing neither.
 *
 * `bookable` is the server's own answer and is shown as it comes: a vendor
 * needs to know the difference between a service that is switched off and one
 * that is on but has no published price, because the second looks live from
 * this screen and is invisible to a client.
 */
export function ServiceCard({
  vendorId,
  service,
  onAct,
  onNotice,
}: {
  vendorId: string;
  service: VendorService;
  onAct: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;
  onNotice: (message: string) => void;
}) {
  const [mode, setMode] = useState<'read' | 'edit' | 'prices'>('read');

  return (
    <Card>
      <View style={{ gap: space(1) }}>
        <SectionTitle numberOfLines={2}>
          {service.displayName ?? service.definition?.name ?? 'Service'}
        </SectionTitle>
        <Caption tone="faint">
          {[service.category?.name, service.definition?.name]
            .filter(Boolean)
            .join(' · ')}
          {` · up to ${service.concurrentCapacity} at once`}
        </Caption>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), alignItems: 'center' }}>
        <Badge tone={service.bookable ? 'positive' : 'caution'}>
          {service.bookable ? 'Bookable' : service.active ? 'No price published' : 'Switched off'}
        </Badge>
      </View>

      {service.description ? <Body tone="muted">{service.description}</Body> : null}

      {/* The vendor's own answers, read back. */}
      {mode === 'read' && Object.keys(service.attributes).length > 0 && (
        <>
          <Divider />
          <DetailGrid>
            {service.serviceForm
              .filter((f) => service.attributes[f.key] !== undefined)
              .map((f) => (
                <DetailRow key={f.key} label={f.label}>
                  {formatAnswer(f, service.attributes[f.key])}
                </DetailRow>
              ))}
          </DetailGrid>
        </>
      )}

      {mode === 'edit' && (
        <EditService
          service={service}
          onSave={async (body) => {
            const ok = await onAct(
              () => api.put(`/vendors/${vendorId}/services/${service.id}`, body),
              'Service updated.',
            );
            if (ok) setMode('read');
          }}
          onRemove={async () => {
            const ok = await onAct(
              () => api.delete(`/vendors/${vendorId}/services/${service.id}`),
              'Service removed.',
            );
            if (ok) setMode('read');
          }}
          onCancel={() => setMode('read')}
        />
      )}

      {mode === 'prices' && (
        <Offerings vendorId={vendorId} service={service} onChanged={onNotice} />
      )}

      <Divider />
      <View style={{ gap: space(2) }}>
        <View style={{ flexDirection: 'row', gap: space(2) }}>
          <Button
            label={mode === 'edit' ? 'Close' : 'Edit'}
            variant="outline"
            small
            onPress={() => setMode(mode === 'edit' ? 'read' : 'edit')}
            style={{ flex: 1 }}
          />
          <Button
            label={mode === 'prices' ? 'Close prices' : `Prices (${service.offerings.length})`}
            variant="outline"
            small
            onPress={() => setMode(mode === 'prices' ? 'read' : 'prices')}
            style={{ flex: 1 }}
          />
        </View>
        <Button
          label={service.active ? 'Switch off' : 'Switch on'}
          variant="ghost"
          small
          onPress={() =>
            void onAct(
              () =>
                api.put(`/vendors/${vendorId}/services/${service.id}`, {
                  definitionId: service.definitionId,
                  active: !service.active,
                }),
              service.active ? 'Service switched off.' : 'Service switched on.',
            )
          }
        />
      </View>
    </Card>
  );
}

function EditService({
  service,
  onSave,
  onRemove,
  onCancel,
}: {
  service: VendorService;
  onSave: (body: Record<string, unknown>) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [displayName, setDisplayName] = useState(service.displayName ?? '');
  const [description, setDescription] = useState(service.description ?? '');
  const [answers, setAnswers] = useState<Answers>(service.attributes);
  const [capacity, setCapacity] = useState(String(service.concurrentCapacity));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);

  function submit() {
    const found = validateAnswers(service.serviceForm, answers);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSave({
      definitionId: service.definitionId,
      displayName: displayName.trim(),
      description: description.trim(),
      attributes: cleanAnswers(service.serviceForm, answers),
      concurrentCapacity: Number(capacity) || 1,
    });
  }

  return (
    <View style={{ gap: space(3) }}>
      <Divider />
      <Field
        label="Your name for it"
        placeholder={service.definition?.name ?? ''}
        value={displayName}
        onChangeText={setDisplayName}
      />
      <Field
        label="How many at once?"
        value={capacity}
        onChangeText={setCapacity}
        keyboardType="number-pad"
        hint="How many of these you can run simultaneously."
      />
      <Textarea label="Description" value={description} onChange={setDescription} rows={3} />

      <DynamicForm
        fields={service.serviceForm}
        answers={answers}
        errors={errors}
        onChange={(key, value) => setAnswers((a) => ({ ...a, [key]: value }))}
      />

      <Button label="Save" onPress={submit} />
      <View style={{ flexDirection: 'row', gap: space(2) }}>
        <Button label="Cancel" variant="outline" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          // Two presses rather than a confirm dialog: removing a service takes
          // its prices and its published windows with it, and a modal that
          // interrupts the form is easier to dismiss by accident than a button
          // that changes what it says.
          label={confirming ? 'Really remove' : 'Remove'}
          variant="outline"
          onPress={() => (confirming ? onRemove() : setConfirming(true))}
          style={{ flex: 1 }}
        />
      </View>
      {confirming ? (
        <Caption tone="critical">
          This removes the service from your business, along with its prices.
        </Caption>
      ) : null}
    </View>
  );
}

import { useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { PRICING_LABEL, QUANTITY_MODELS, QUOTE_ONLY, priceLabel } from '@/lib/pricing';
import { Badge, Divider } from '@/components/chrome';
import { CheckRow, SelectField, Textarea } from '@/components/form';
import { Alert, Body, Button, Caption, Field } from '@/components/ui';
import { rgb, radius, space, useTheme } from '@/theme';
import type { Offering, VendorService } from '@/components/business/service-types';

/**
 * A service's prices.
 *
 * The web client's Offerings/OfferingForm pair. Which pricing models are
 * offered, and whether a package may be built at all, come from the catalog
 * definition rather than from anything written here — that is what lets an
 * administrator add a trade without a deployment, and it is the reason this
 * screen has no per-category special cases in it.
 */
export function Offerings({
  vendorId,
  service,
  onChanged,
}: {
  vendorId: string;
  service: VendorService;
  onChanged: (message: string) => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const allowed = service.definition?.allowedPricingModels ?? [];

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError('');
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['vendor-services', vendorId] });
      onChanged(ok);
      setEditing(null);
    } catch (err) {
      setError(apiMessage(err, 'That price was not accepted.'));
    }
  }

  return (
    <View style={{ gap: space(2.5) }}>
      <Divider />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
        <Body style={{ flex: 1, fontWeight: '600' }}>Prices</Body>
        <Button
          label={editing === 'new' ? 'Cancel' : 'Add a price'}
          variant="outline"
          small
          onPress={() => setEditing(editing === 'new' ? null : 'new')}
        />
      </View>
      {error ? <Alert tone="critical">{error}</Alert> : null}

      {editing === 'new' && (
        <OfferingForm
          allowed={allowed}
          packagesAllowed={service.definition?.packagesAllowed ?? true}
          onSave={(body) =>
            act(
              () => api.post(`/vendors/${vendorId}/services/${service.id}/offerings`, body),
              'Price published.',
            )
          }
          onCancel={() => setEditing(null)}
        />
      )}

      {service.offerings.map((offering) =>
        editing === offering.id ? (
          <OfferingForm
            key={offering.id}
            existing={offering}
            allowed={allowed}
            packagesAllowed={service.definition?.packagesAllowed ?? true}
            onSave={(body) =>
              act(
                () =>
                  api.put(
                    `/vendors/${vendorId}/services/${service.id}/offerings/${offering.id}`,
                    body,
                  ),
                'Price updated.',
              )
            }
            onCancel={() => setEditing(null)}
            onRemove={() =>
              act(
                () =>
                  api.delete(
                    `/vendors/${vendorId}/services/${service.id}/offerings/${offering.id}`,
                  ),
                'Price removed.',
              )
            }
          />
        ) : (
          <View
            key={offering.id}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}
          >
            <View style={{ flex: 1, gap: space(1) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
                <Body numberOfLines={2} style={{ flexShrink: 1 }}>
                  {offering.name}
                </Body>
                {offering.isPackage ? <Badge tone="brand">Package</Badge> : null}
                {!offering.active ? <Badge>Retired</Badge> : null}
              </View>
              <Caption>
                {priceLabel(offering)}
                {offering.minQuantity ? ` · from ${offering.minQuantity}` : ''}
                {offering.maxQuantity ? ` up to ${offering.maxQuantity}` : ''}
              </Caption>
              {offering.inclusions.length > 0 ? (
                <Caption tone="faint">Includes: {offering.inclusions.join(', ')}</Caption>
              ) : null}
            </View>
            <Button
              label="Edit"
              variant="outline"
              small
              onPress={() => setEditing(offering.id)}
            />
          </View>
        ),
      )}

      {service.offerings.length === 0 && editing !== 'new' && (
        <Caption tone="faint">
          No prices yet — clients cannot request this service until there is one.
        </Caption>
      )}
    </View>
  );
}

function OfferingForm({
  existing,
  allowed,
  packagesAllowed,
  onSave,
  onCancel,
  onRemove,
}: {
  existing?: Offering;
  allowed: string[];
  packagesAllowed: boolean;
  onSave: (body: Record<string, unknown>) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const theme = useTheme();
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [model, setModel] = useState(existing?.pricingModel ?? allowed[0] ?? 'fixed');
  const [price, setPrice] = useState(existing?.price ?? '');
  const [unitLabel, setUnitLabel] = useState(existing?.unitLabel ?? '');
  const [minQuantity, setMinQuantity] = useState(existing?.minQuantity?.toString() ?? '');
  const [maxQuantity, setMaxQuantity] = useState(existing?.maxQuantity?.toString() ?? '');
  const [isPackage, setIsPackage] = useState(existing?.isPackage ?? false);
  const [inclusions, setInclusions] = useState((existing?.inclusions ?? []).join(', '));
  const [active, setActive] = useState(existing?.active ?? true);
  const [problem, setProblem] = useState('');

  const quoteOnly = QUOTE_ONLY.includes(model);
  const takesQuantity = QUANTITY_MODELS.includes(model);

  function submit() {
    if (!name.trim()) {
      setProblem('Give this price a name a client would recognise.');
      return;
    }
    if (!quoteOnly && (price === '' || Number(price) < 0)) {
      setProblem('Give a price, or choose Custom quote if you price each job.');
      return;
    }
    if (minQuantity && maxQuantity && Number(minQuantity) > Number(maxQuantity)) {
      setProblem('The minimum is above the maximum.');
      return;
    }
    setProblem('');
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      pricingModel: model,
      price: quoteOnly ? undefined : String(price),
      unitLabel: unitLabel.trim() || undefined,
      minQuantity: takesQuantity && minQuantity ? Number(minQuantity) : undefined,
      maxQuantity: takesQuantity && maxQuantity ? Number(maxQuantity) : undefined,
      isPackage,
      inclusions: inclusions
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      active,
    });
  }

  return (
    <View
      style={{
        gap: space(3),
        backgroundColor: rgb(theme.surfaceSunken),
        borderRadius: radius.md,
        padding: space(3),
      }}
    >
      <Field
        label="Name"
        placeholder="Full day, two photographers"
        value={name}
        onChangeText={setName}
      />
      <SelectField
        label="How it is priced"
        value={model}
        onChange={setModel}
        options={allowed.map((m) => ({ value: m, label: PRICING_LABEL[m] ?? m }))}
        hint="Only the models this service allows are offered."
      />
      {!quoteOnly && (
        <>
          <Field
            label="Amount (INR)"
            value={String(price)}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
          />
          <Field
            label="Per what?"
            placeholder="per plate"
            value={unitLabel}
            onChangeText={setUnitLabel}
          />
        </>
      )}
      {takesQuantity && (
        <View style={{ flexDirection: 'row', gap: space(2) }}>
          <View style={{ flex: 1 }}>
            <Field
              label="Minimum you will take"
              value={minQuantity}
              onChangeText={setMinQuantity}
              keyboardType="number-pad"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Maximum"
              value={maxQuantity}
              onChangeText={setMaxQuantity}
              keyboardType="number-pad"
            />
          </View>
        </View>
      )}
      <Field label="Description" value={description} onChangeText={setDescription} />

      {packagesAllowed && (
        <CheckRow label="This is a package" checked={isPackage} onChange={setIsPackage} />
      )}
      {isPackage && (
        <Textarea
          label="What it includes"
          value={inclusions}
          onChange={setInclusions}
          rows={2}
          placeholder="Album, drone coverage, two edits"
          hint="Separate each one with a comma."
        />
      )}
      <CheckRow label="Offer this to clients" checked={active} onChange={setActive} />

      {problem ? <Alert tone="critical">{problem}</Alert> : null}

      <View style={{ gap: space(2) }}>
        <Button label={existing ? 'Save' : 'Publish price'} onPress={submit} />
        <View style={{ flexDirection: 'row', gap: space(2) }}>
          <Button label="Cancel" variant="outline" onPress={onCancel} style={{ flex: 1 }} />
          {onRemove && (
            <Button label="Remove" variant="outline" onPress={onRemove} style={{ flex: 1 }} />
          )}
        </View>
      </View>
    </View>
  );
}

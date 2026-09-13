import { useState } from 'react';
import { View } from 'react-native';
import { useMutation } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { DetailGrid, DetailRow } from '@/components/chrome';
import { SelectField } from '@/components/form';
import { Alert, Button, Caption, Card, Field, SectionTitle } from '@/components/ui';
import { space } from '@/theme';

/**
 * Partner preferences (EZ1-I261), including whether the partner lives abroad
 * (EZ1-I246, EZ1-I247).
 *
 * The one section of a biodata that people genuinely revise: the age window
 * widens, the preferred city changes, a family decides they do mind about NRI
 * after all. That is why it is editable on the phone while the rest of the
 * biodata is not — this is the part somebody changes in a conversation.
 *
 * The NRI question is phrased about the partner rather than about a gender, and
 * "doesn't matter" is offered as an answer rather than as a blank, because a
 * family who does not mind is saying something.
 */
const NRI_OPTIONS = [
  { value: 'no_preference', label: "Doesn't matter" },
  { value: 'yes', label: 'Yes, prefer NRI' },
  { value: 'no', label: 'No, prefer non-NRI' },
];

const NRI_LABEL: Record<string, string> = {
  no_preference: "Doesn't matter",
  yes: 'Yes, prefer NRI',
  no: 'No, prefer non-NRI',
};

export function PreferencesSection({
  profileId,
  details,
  onSaved,
}: {
  profileId: string;
  details: Record<string, unknown>;
  onSaved: () => void;
}) {
  const bag = (details.partnerPreferences as Record<string, unknown> | undefined) ?? {};
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({
    preferredAgeMin: String(details.preferredAgeMin ?? 24),
    preferredAgeMax: String(details.preferredAgeMax ?? 34),
    preferredHeightMinCm: String(details.preferredHeightMinCm ?? 150),
    preferredHeightMaxCm: String(details.preferredHeightMaxCm ?? 190),
    religion: String(bag.religion ?? ''),
    caste: String(bag.caste ?? ''),
    education: String(bag.education ?? ''),
    locations: String(bag.locations ?? ''),
    nriPreference: String(bag.nriPreference ?? ''),
    preferredNriCountry: String(bag.preferredNriCountry ?? ''),
  });

  const save = useMutation({
    mutationFn: async () => {
      await api.put(`/profiles/${profileId}/details/preferences`, {
        preferredAgeMin: Number(form.preferredAgeMin),
        preferredAgeMax: Number(form.preferredAgeMax),
        preferredHeightMinCm: Number(form.preferredHeightMinCm),
        preferredHeightMaxCm: Number(form.preferredHeightMaxCm),
        preferences: {
          ...(form.religion.trim() ? { religion: form.religion.trim() } : {}),
          ...(form.caste.trim() ? { caste: form.caste.trim() } : {}),
          ...(form.education.trim() ? { education: form.education.trim() } : {}),
          ...(form.locations.trim() ? { locations: form.locations.trim() } : {}),
        },
        ...(form.nriPreference ? { nriPreference: form.nriPreference } : {}),
        // Only ever sent alongside a yes. The server clears it otherwise, and
        // sending it anyway asks for a country to be kept against a preference
        // that no longer wants one.
        ...(form.nriPreference === 'yes' && form.preferredNriCountry.trim()
          ? { preferredNriCountry: form.preferredNriCountry.trim() }
          : {}),
      });
    },
    onSuccess: () => {
      setError('');
      setNotice('Saved. Matches are scored against this from now on.');
      setEditing(false);
      onSaved();
    },
    onError: (err) => setError(apiMessage(err, 'Those preferences could not be saved.')),
  });

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  function submit() {
    if (Number(form.preferredAgeMin) > Number(form.preferredAgeMax)) {
      setError('The minimum age cannot be above the maximum.');
      return;
    }
    if (Number(form.preferredHeightMinCm) > Number(form.preferredHeightMaxCm)) {
      setError('The minimum height cannot be above the maximum.');
      return;
    }
    setError('');
    save.mutate();
  }

  return (
    <Card>
      <SectionTitle>Partner preferences</SectionTitle>

      {notice ? <Alert tone="positive">{notice}</Alert> : null}
      {error ? <Alert tone="critical">{error}</Alert> : null}

      {editing ? (
        <>
          <View style={{ flexDirection: 'row', gap: space(2) }}>
            <View style={{ flex: 1 }}>
              <Field
                label="Age from"
                value={form.preferredAgeMin}
                onChangeText={set('preferredAgeMin')}
                keyboardType="number-pad"
                maxLength={3}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Age to"
                value={form.preferredAgeMax}
                onChangeText={set('preferredAgeMax')}
                keyboardType="number-pad"
                maxLength={3}
              />
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: space(2) }}>
            <View style={{ flex: 1 }}>
              <Field
                label="Height from (cm)"
                value={form.preferredHeightMinCm}
                onChangeText={set('preferredHeightMinCm')}
                keyboardType="number-pad"
                maxLength={3}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Height to (cm)"
                value={form.preferredHeightMaxCm}
                onChangeText={set('preferredHeightMaxCm')}
                keyboardType="number-pad"
                maxLength={3}
              />
            </View>
          </View>

          <Field label="Religion" value={form.religion} onChangeText={set('religion')} />
          <Field label="Caste" value={form.caste} onChangeText={set('caste')} />
          <Field label="Education" value={form.education} onChangeText={set('education')} />
          <Field
            label="Preferred location"
            value={form.locations}
            onChangeText={set('locations')}
            hint="One or more towns, separated by commas."
          />

          <SelectField
            label="Is the partner an NRI?"
            value={form.nriPreference}
            options={NRI_OPTIONS}
            onChange={set('nriPreference')}
            placeholder="No preference"
          />
          {form.nriPreference === 'yes' ? (
            <Field
              label="Preferred NRI country"
              value={form.preferredNriCountry}
              onChangeText={set('preferredNriCountry')}
              placeholder="USA, UK, Canada, Australia…"
              maxLength={120}
            />
          ) : null}

          <View style={{ gap: space(2) }}>
            <Button label="Save preferences" busy={save.isPending} onPress={submit} />
            <Button
              label="Cancel"
              variant="outline"
              disabled={save.isPending}
              onPress={() => {
                setEditing(false);
                setError('');
              }}
            />
          </View>
        </>
      ) : (
        <>
          <DetailGrid>
            <DetailRow label="Age">
              {`${details.preferredAgeMin ?? '—'} to ${details.preferredAgeMax ?? '—'}`}
            </DetailRow>
            <DetailRow label="Height">
              {`${details.preferredHeightMinCm ?? '—'} to ${details.preferredHeightMaxCm ?? '—'} cm`}
            </DetailRow>
            <DetailRow label="Religion">{String(bag.religion ?? '—')}</DetailRow>
            <DetailRow label="Caste">{String(bag.caste ?? '—')}</DetailRow>
            <DetailRow label="Education">{String(bag.education ?? '—')}</DetailRow>
            <DetailRow label="Location">{String(bag.locations ?? '—')}</DetailRow>
            <DetailRow label="NRI">
              {NRI_LABEL[String(bag.nriPreference ?? '')] ?? 'Not said'}
            </DetailRow>
            {bag.nriPreference === 'yes' ? (
              <DetailRow label="Country">{String(bag.preferredNriCountry ?? '—')}</DetailRow>
            ) : null}
          </DetailGrid>
          <Button label="Edit preferences" variant="outline" small onPress={() => setEditing(true)} />
          <Caption tone="faint">
            Matches are scored against these. The horoscope expectations and the rest of the
            preferences are on the web app.
          </Caption>
        </>
      )}
    </Card>
  );
}

import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { FileText } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { isChartImage } from '@/shared/horoscope';
import { DetailGrid, DetailRow } from '@/components/chrome';
import { PhotoPicker } from '@/components/uploader';
import { Alert, Body, Button, Caption, Card, Field, SectionTitle } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * The horoscope, and the chart itself (EZ1-I231, EZ1-I261).
 *
 * The chart belongs on a phone more than anywhere else: it is a piece of paper
 * an astrologer drew, and the way a family gets it onto the platform is by
 * photographing it. Attaching it from the web meant finding a scanner or
 * emailing it to themselves first.
 *
 * A picture is shown; a PDF is handed to the phone to open, because drawing a
 * PDF into an image view is a broken-image icon and reads as an upload that
 * failed. Nothing attached says "not uploaded" rather than leaving a blank —
 * this family keeps a horoscope, which is why the section is here.
 */
export function HoroscopeSection({
  profileId,
  details,
  onSaved,
}: {
  profileId: string;
  details: Record<string, unknown>;
  onSaved: () => void;
}) {
  const theme = useTheme();
  const chart = (details.horoscope as Record<string, unknown> | undefined) ?? {};
  const available = details.horoscopeAvailable === true;
  const stored = typeof details.horoscopeDocumentUrl === 'string' ? details.horoscopeDocumentUrl : null;

  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({
    rashi: String(chart.rashi ?? ''),
    star: String(chart.star ?? ''),
    padam: String(chart.padam ?? ''),
    gothram: String(chart.gothram ?? ''),
    kujaDosham: String(chart.kujaDosham ?? ''),
    horoscopeDocumentUrl: stored ?? '',
  });

  const save = useMutation({
    mutationFn: async (patch: Partial<typeof form> = {}) => {
      const next = { ...form, ...patch };
      await api.put(`/profiles/${profileId}/details/horoscope`, {
        horoscopeAvailable: true,
        ...Object.fromEntries(
          (['rashi', 'star', 'padam', 'gothram', 'kujaDosham'] as const)
            .map((key) => [key, next[key].trim()])
            .filter(([, value]) => value),
        ),
        ...(next.horoscopeDocumentUrl ? { horoscopeDocumentUrl: next.horoscopeDocumentUrl } : {}),
      });
    },
    onSuccess: () => {
      setError('');
      setNotice('Saved.');
      setEditing(false);
      onSaved();
    },
    onError: (err) => setError(apiMessage(err, 'That could not be saved.')),
  });

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <Card>
      <SectionTitle>Horoscope</SectionTitle>

      {notice ? <Alert tone="positive">{notice}</Alert> : null}
      {error ? <Alert tone="critical">{error}</Alert> : null}

      {editing ? (
        <>
          <Field label="Rashi" value={form.rashi} onChangeText={set('rashi')} />
          <Field label="Star / Nakshatram" value={form.star} onChangeText={set('star')} />
          <Field label="Padam" value={form.padam} onChangeText={set('padam')} maxLength={20} />
          <Field label="Gothram" value={form.gothram} onChangeText={set('gothram')} />
          <Field
            label="Kuja dosham"
            value={form.kujaDosham}
            onChangeText={set('kujaDosham')}
            maxLength={20}
          />
          <View style={{ gap: space(2) }}>
            <Button label="Save" busy={save.isPending} onPress={() => save.mutate({})} />
            <Button label="Cancel" variant="outline" onPress={() => setEditing(false)} />
          </View>
        </>
      ) : (
        <>
          <DetailGrid>
            <DetailRow label="Has a horoscope">{available ? 'Yes' : 'Not said'}</DetailRow>
            <DetailRow label="Rashi">{String(chart.rashi ?? '—')}</DetailRow>
            <DetailRow label="Star">{String(chart.star ?? '—')}</DetailRow>
            <DetailRow label="Padam">{String(chart.padam ?? '—')}</DetailRow>
            <DetailRow label="Gothram">{String(chart.gothram ?? '—')}</DetailRow>
            <DetailRow label="Kuja dosham">{String(chart.kujaDosham ?? '—')}</DetailRow>
          </DetailGrid>
          <Button label="Edit the chart details" variant="outline" small onPress={() => setEditing(true)} />
        </>
      )}

      {/* The chart itself. Saved the moment it is uploaded rather than waiting
          for a Save nobody associates with a photograph they just took. */}
      {stored ? (
        isChartImage(stored) ? (
          <Image
            source={{ uri: stored }}
            style={{
              width: '100%',
              height: 240,
              borderRadius: radius.sm,
              backgroundColor: rgb(theme.surfaceSunken),
            }}
            contentFit="contain"
            transition={150}
          />
        ) : (
          <View style={{ gap: space(1.5) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
              <FileText size={18} color={rgb(theme.ink[400])} />
              <Body tone="muted" style={{ flex: 1 }}>
                The chart is attached as a document.
              </Body>
            </View>
            <Button
              label="Open the chart"
              variant="outline"
              small
              onPress={() => void Linking.openURL(stored)}
            />
          </View>
        )
      ) : (
        <Caption tone="faint">Chart: not uploaded</Caption>
      )}

      <PhotoPicker
        label={stored ? 'Replace the chart' : 'Attach the chart'}
        kind="attachment"
        onUploaded={(url) => {
          setForm((current) => ({ ...current, horoscopeDocumentUrl: url }));
          save.mutate({ horoscopeDocumentUrl: url });
        }}
      />
      <Caption tone="faint">
        A photograph of it is fine, or a PDF. Families compare charts before deciding whether to
        send interest, so anyone who can see your profile can open it.
      </Caption>
    </Card>
  );
}

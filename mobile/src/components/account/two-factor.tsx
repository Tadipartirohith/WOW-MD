import { useState } from 'react';
import { View } from 'react-native';

import { api, apiMessage } from '@/lib/api';
import { Badge } from '@/components/chrome';
import { Alert, Body, Button, Caption, Card, Field, SectionTitle } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * Two-factor, the same three states as the web card: off, mid-setup, on.
 *
 * The web page draws no QR either — it shows the secret and the otpauth URL and
 * lets the authenticator take it from there. On a phone that is the better half
 * of the bargain anyway: the authenticator is on this device, so a string that
 * can be copied beats a code that would have to be photographed by the same
 * camera it is displayed on.
 */
export function TwoFactorCard({
  enabled,
  onChanged,
}: {
  enabled: boolean;
  onChanged: (enabled: boolean) => void;
}) {
  const theme = useTheme();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /*
   * Held here and nowhere else. This is the only moment the plaintext exists,
   * and putting it in the keystore would make it a second password on the
   * device the first one is already on.
   */
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  async function run(work: () => Promise<void>, fallback: string) {
    setError('');
    setBusy(true);
    try {
      await work();
    } catch (err) {
      setError(apiMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
        <SectionTitle style={{ flex: 1 }}>Two-factor authentication</SectionTitle>
        <Badge tone={enabled ? 'positive' : 'neutral'}>{enabled ? 'On' : 'Off'}</Badge>
      </View>

      {error ? <Alert tone="critical">{error}</Alert> : null}

      {recoveryCodes ? (
        <View
          style={{
            backgroundColor: rgb(theme.cautionBg),
            borderRadius: radius.sm,
            padding: space(3),
            gap: space(1.5),
          }}
        >
          <Body style={{ fontWeight: '600', color: rgb(theme.cautionFg) }}>
            Write these down now
          </Body>
          <Caption style={{ color: rgb(theme.cautionFg) }}>
            Each one signs you in once if you lose your authenticator. This is the only time they
            are shown — we keep them hashed, so we cannot show them again.
          </Caption>
          {recoveryCodes.map((rc) => (
            <Caption key={rc} style={{ color: rgb(theme.cautionFg), letterSpacing: 1 }}>
              {rc}
            </Caption>
          ))}
          <Button
            label="I have saved them"
            variant="outline"
            small
            onPress={() => setRecoveryCodes(null)}
          />
        </View>
      ) : null}

      {enabled ? (
        <>
          <Caption tone="muted">
            Turning two-factor off needs both your password and a current code.
          </Caption>
          <Field
            label="Your password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
          />
          <Field
            label="6-digit code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
          />
          <Button
            label="Turn off two-factor"
            variant="outline"
            busy={busy}
            disabled={!password || code.length < 6}
            onPress={() =>
              void run(async () => {
                await api.post('/auth/mfa/disable', { password, code });
                setPassword('');
                setCode('');
                onChanged(false);
              }, 'Two-factor could not be turned off.')
            }
          />
        </>
      ) : setup ? (
        <>
          <Caption tone="muted">
            Add this secret to your authenticator app, then enter the code it shows.
          </Caption>
          <View
            style={{
              backgroundColor: rgb(theme.surfaceSunken),
              borderRadius: radius.sm,
              padding: space(3),
            }}
          >
            <Body style={{ letterSpacing: 1 }}>{setup.secret}</Body>
          </View>
          <Caption tone="faint">{setup.otpauthUrl}</Caption>
          <Field
            label="6-digit code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
          />
          <Button
            label="Confirm and turn on"
            busy={busy}
            disabled={code.length < 6}
            onPress={() =>
              void run(async () => {
                const { data } = await api.post('/auth/mfa/confirm', { code });
                setSetup(null);
                setCode('');
                setRecoveryCodes(data.recoveryCodes ?? null);
                onChanged(true);
              }, 'That code was not accepted.')
            }
          />
          <Button label="Cancel" variant="ghost" small onPress={() => setSetup(null)} />
        </>
      ) : (
        <>
          <Caption tone="muted">
            Adds a second step at sign-in, so a stolen password is not enough on its own.
          </Caption>
          <Button
            label="Set up two-factor"
            busy={busy}
            onPress={() =>
              void run(async () => {
                const { data } = await api.post('/auth/mfa/setup');
                setSetup(data);
              }, 'Two-factor could not be started.')
            }
          />
        </>
      )}
    </Card>
  );
}

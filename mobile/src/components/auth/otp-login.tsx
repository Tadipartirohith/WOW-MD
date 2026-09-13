import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { AxiosError } from 'axios';

import { acceptAuth, api, apiMessage } from '@/lib/api';
import { Alert, Body, Button, Caption, Field } from '@/components/ui';
import { space } from '@/theme';

/**
 * Signing in with a mobile number and a code (EZ1-I258).
 *
 * The number is what most of this platform's people were taken on with: an
 * agent signs a family up on the phone, the number is what duplicate detection
 * keys on, and it is the thing they actually answer. Asking those families for
 * an email address and a password they invented at intake, months ago, is the
 * step they get stuck at.
 *
 * Two steps, not two screens. Asking for the number and then replacing it with
 * a code box loses the thing somebody is checking against the message that has
 * just arrived — so the number stays on screen, and the code appears under it.
 *
 * Every rule that makes six digits a credential is the server's: the code
 * expires, three wrong guesses spend it, one use consumes it, and both routes
 * are rate-limited. This screen only says what happened.
 */
const RESEND_SECONDS = 30;

export function OtpLogin({ onNeedsPassword }: { onNeedsPassword: () => void }) {
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [sent, setSent] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** Seconds until "Send it again" becomes pressable. */
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const digits = mobile.replace(/[\s-]/g, '').replace(/^\+91/, '');
  const numberLooksRight = /^[6-9]\d{9}$/.test(digits);

  async function request() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api.post('/auth/otp/request', { mobile: digits });
      setSent(true);
      setCooldown(RESEND_SECONDS);
      // The same words whether or not the number has an account. The code is never
      // in the answer: in development it is written to the server log.
      setNotice('If that number has an account, a code is on its way.');
    } catch (err) {
      setError(apiMessage(err, 'That code could not be sent. Try again in a minute.'));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/otp/login', {
        mobile: digits,
        code,
        ...(needsMfa ? { mfaCode } : {}),
      });
      // Not `setAuth`: on a device the refresh token arrives in the body and
      // has to reach the keystore, or the session ends when the app is closed.
      await acceptAuth(data);
    } catch (err) {
      const body = (err as AxiosError<{ code?: string }>).response?.data;
      if (body?.code === 'MFA_REQUIRED') {
        setNeedsMfa(true);
        setError('');
        setNotice('');
      } else {
        setError(apiMessage(err, 'That code is not right.'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space(3) }}>
      {error ? <Alert tone="critical">{error}</Alert> : null}
      {notice && !error ? <Alert tone="positive">{notice}</Alert> : null}

      <Field
        label="Mobile number"
        hint={sent ? undefined : 'Ten digits, the number your account was set up with.'}
        value={mobile}
        onChangeText={(value) => {
          setMobile(value);
          // Changing the number invalidates everything about the last one; the
          // server would refuse the old code anyway.
          if (sent) {
            setSent(false);
            setCode('');
            setNotice('');
            setNeedsMfa(false);
          }
        }}
        keyboardType="number-pad"
        maxLength={13}
        autoComplete="tel"
        textContentType="telephoneNumber"
        placeholder="9876543210"
      />

      {sent ? (
        <>
          <Field
            label="Code"
            hint="The six digits we sent by SMS."
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            autoFocus
            onSubmitEditing={needsMfa ? undefined : verify}
            returnKeyType="go"
          />

          {needsMfa ? (
            <>
              <Field
                label="Authentication code"
                hint="The six digits from your authenticator app."
                value={mfaCode}
                onChangeText={setMfaCode}
                keyboardType="number-pad"
                maxLength={6}
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                onSubmitEditing={verify}
                returnKeyType="go"
              />
              <Body tone="muted">
                Your code was accepted. Two-factor is on for this account, so this step confirms it
                is you.
              </Body>
            </>
          ) : null}

          <Button
            label="Sign in"
            onPress={() => void verify()}
            busy={busy}
            disabled={code.length < 6 || (needsMfa && mfaCode.length < 6)}
          />
          <Button
            label={cooldown > 0 ? `Send it again in ${cooldown}s` : 'Send it again'}
            variant="ghost"
            small
            disabled={busy || cooldown > 0}
            onPress={() => void request()}
          />
        </>
      ) : (
        <Button
          label="Send me a code"
          onPress={() => void request()}
          busy={busy}
          disabled={!numberLooksRight}
        />
      )}

      <Button
        label="Sign in with an email address instead"
        variant="ghost"
        small
        onPress={onNeedsPassword}
      />
    </View>
  );
}

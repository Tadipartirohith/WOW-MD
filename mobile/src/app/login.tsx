import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Link } from 'expo-router';
import type { AxiosError } from 'axios';

import { acceptAuth, api, apiMessage } from '@/lib/api';
import {
  Alert,
  Body,
  Button,
  Caption,
  Field,
  PageSubtitle,
  PageTitle,
  Screen,
} from '@/components/ui';
import { rgb, space, useTheme } from '@/theme';

/**
 * Sign in.
 *
 * The web version is a split: form on the left, a photograph on the right that
 * says what the product is for. That panel is deliberately not brought across.
 * It is dropped below `lg` on the web too, for the reason given there — a
 * photograph above a sign-in form on a phone is a photograph somebody scrolls
 * past to reach the thing they opened the app to do.
 *
 * What does come across is the flow, exactly: a missing second factor is not
 * an error the person made, so the form asks for the code instead of telling
 * them something went wrong.
 */
export default function Login() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/login', {
        email: email.trim(),
        password,
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
      } else {
        setError(apiMessage(err, 'Invalid email or password.'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: rgb(theme.canvas) }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <View style={{ gap: space(1), marginTop: space(10), marginBottom: space(4) }}>
          <PageTitle>WOW</PageTitle>
          <PageSubtitle>World of Weddings. Sign in to pick up where you left off.</PageSubtitle>
        </View>

        {error ? <Alert tone="critical">{error}</Alert> : null}

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          placeholder="you@example.com"
          editable={!needsMfa}
        />

        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          editable={!needsMfa}
          onSubmitEditing={needsMfa ? undefined : submit}
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
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={6}
              autoFocus
              onSubmitEditing={submit}
              returnKeyType="go"
            />
            <Body tone="muted">
              Your password was accepted. This step confirms it is you on this device.
            </Body>
          </>
        ) : null}

        <Button
          label={needsMfa ? 'Confirm and sign in' : 'Sign in'}
          onPress={submit}
          busy={busy}
          disabled={!email.trim() || !password || (needsMfa && mfaCode.length < 6)}
        />

        {/*
          Hidden mid-MFA: the account already exists and is half signed in, so
          offering to make another one there is noise at the worst moment.
        */}
        {needsMfa ? null : (
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              gap: space(1),
            }}
          >
            <Caption>No account?</Caption>
            <Link href="/register" asChild>
              <Pressable accessibilityRole="link" hitSlop={8}>
                <Caption tone="brand">Create one</Caption>
              </Pressable>
            </Link>
          </View>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

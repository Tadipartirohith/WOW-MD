import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Badge, Divider } from '@/components/chrome';
import { TwoFactorCard } from '@/components/account/two-factor';
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  Field,
  Loading,
  PageSubtitle,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useAuth } from '@/store/auth';
import { space } from '@/theme';

/**
 * Security: the password, the second factor, and every device holding a session.
 *
 * The web app's Security page, less the data export and the account erasure.
 * Both of those hand over or destroy everything the platform holds, and neither
 * is something to offer behind a thumb on a bus — they stay on the web, and this
 * page says so rather than leaving somebody hunting for them.
 */
interface Session {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
}

/** Turns a raw user-agent into something a person can recognise. */
function describeDevice(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (/okhttp|Expo|ReactNative/i.test(ua)) return 'The app on Android';
  if (/CFNetwork|Darwin/i.test(ua)) return 'The app on iOS';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

export default function Security() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const { data: sessions, isPending } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => (await api.get('/auth/sessions')).data as Session[],
    retry: false,
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/auth/sessions/${id}`)).data,
    onSuccess: () => {
      setError('');
      setNotice('That device has been signed out.');
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err) => setError(apiMessage(err, 'That device could not be signed out.')),
  });

  const resend = useMutation({
    mutationFn: async () => (await api.post('/auth/verify-email/resend')).data,
    onSuccess: () => {
      setError('');
      setNotice('Check your inbox for the confirmation link.');
    },
    onError: (err) => setError(apiMessage(err, 'That could not be sent.')),
  });

  return (
    <Screen>
      <PageSubtitle>
        Your password, two-factor authentication, and the devices signed in to this account.
      </PageSubtitle>

      {notice ? <Alert tone="positive">{notice}</Alert> : null}
      {error ? <Alert tone="critical">{error}</Alert> : null}

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <SectionTitle style={{ flex: 1 }}>Email address</SectionTitle>
          <Badge tone={user?.isVerified ? 'positive' : 'caution'}>
            {user?.isVerified ? 'Confirmed' : 'Not confirmed'}
          </Badge>
        </View>
        <Body>{user?.email ?? '—'}</Body>
        {user?.isVerified ? null : (
          <Button
            label="Send the confirmation link again"
            variant="outline"
            small
            busy={resend.isPending}
            onPress={() => resend.mutate()}
          />
        )}
      </Card>

      <ChangePassword
        onDone={() => {
          setError('');
          setNotice('Password changed. Every device has been signed out.');
        }}
      />

      <TwoFactorCard
        enabled={Boolean(user?.mfaEnabled)}
        onChanged={(enabled) => {
          setUser({ mfaEnabled: enabled });
          setNotice(enabled ? 'Two-factor is on.' : 'Two-factor is off.');
        }}
      />

      <Card>
        <SectionTitle>Where you are signed in</SectionTitle>
        {isPending ? (
          <Loading rows={2} />
        ) : (sessions ?? []).length === 0 ? (
          <Caption tone="faint">No other device holds a session.</Caption>
        ) : (
          (sessions ?? []).map((session, index) => (
            <View key={session.id} style={{ gap: space(1.5) }}>
              {index > 0 ? <Divider /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
                <Body style={{ flex: 1 }} numberOfLines={1}>
                  {describeDevice(session.userAgent)}
                </Body>
                {session.current ? <Badge tone="brand">This device</Badge> : null}
              </View>
              <Caption tone="faint">
                {[session.ip, `last used ${dateTime(session.lastUsedAt ?? session.createdAt)}`]
                  .filter(Boolean)
                  .join(' · ')}
              </Caption>
              {session.current ? null : (
                <Button
                  label="Sign this device out"
                  variant="outline"
                  small
                  disabled={revoke.isPending}
                  onPress={() => revoke.mutate(session.id)}
                />
              )}
            </View>
          ))
        )}
      </Card>

      <Caption tone="faint">
        Downloading everything we hold about you, and closing the account for good, are on the web
        app. Neither is a thing to do by accident.
      </Caption>
    </Screen>
  );
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirmPassword, setConfirm] = useState('');
  const [error, setError] = useState('');

  const change = useMutation({
    mutationFn: async () => {
      await api.post('/auth/password/change', { currentPassword, newPassword });
    },
    onSuccess: () => {
      setCurrent('');
      setNew('');
      setConfirm('');
      setError('');
      onDone();
    },
    onError: (err) => setError(apiMessage(err, 'Your password could not be changed.')),
  });

  function submit() {
    if (newPassword !== confirmPassword) {
      setError('Password and Confirm Password do not match.');
      return;
    }
    setError('');
    change.mutate();
  }

  return (
    <Card>
      <SectionTitle>Change password</SectionTitle>
      <Caption tone="muted">
        Changing your password signs out every device, including this one.
      </Caption>
      {error ? <Alert tone="critical">{error}</Alert> : null}
      <Field
        label="Current password"
        value={currentPassword}
        onChangeText={setCurrent}
        secureTextEntry
        autoCapitalize="none"
      />
      <Field
        label="New password"
        value={newPassword}
        onChangeText={setNew}
        secureTextEntry
        autoCapitalize="none"
        hint="At least 8 characters, with an uppercase letter, a lowercase letter and a digit."
      />
      <Field
        label="Confirm new password"
        value={confirmPassword}
        onChangeText={setConfirm}
        secureTextEntry
        autoCapitalize="none"
      />
      <Button
        label="Change password"
        busy={change.isPending}
        disabled={!currentPassword || !newPassword || !confirmPassword}
        onPress={submit}
      />
    </Card>
  );
}

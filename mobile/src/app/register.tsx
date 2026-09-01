import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Link } from 'expo-router';

import { acceptAuth, api, apiMessage } from '@/lib/api';
import {
  EMAIL_PATTERN,
  MOBILE_10_PATTERN,
  NAME_PATTERN,
  type AccountType,
} from '@/shared/permissions';
import { Alert, Body, Button, Caption, Field, PageSubtitle, PageTitle, Screen } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * Sign up.
 *
 * The app had no way in at all: an account could only be made on the web and
 * then signed into here, which is not something anybody who downloads an app
 * discovers on their own.
 *
 * The rules are the web page's, and deliberately not re-derived — the patterns
 * come from the same shared module the web form uses, which is itself checked
 * against the server's enum. Three hand-written copies of "what is a valid
 * mobile number" is three chances to reject something the server would have
 * accepted.
 *
 * The account type is asked first because it decides the permission set, and
 * because it cannot be changed afterwards without support.
 */
interface TypeOption {
  type: AccountType;
  label: string;
  blurb: string;
  roles?: { value: string; label: string }[];
}

const ACCOUNT_TYPES: TypeOption[] = [
  {
    type: 'individual',
    label: 'Individual',
    blurb: 'Looking for a match, or a family member searching on their behalf.',
    roles: [
      { value: 'bride', label: 'Bride' },
      { value: 'groom', label: 'Groom' },
      { value: 'family', label: 'Family member' },
    ],
  },
  {
    type: 'agent',
    label: 'Marriage agent',
    blurb: 'Build profiles for clients and book on their behalf. Reviewed before activation.',
  },
  {
    type: 'vendor',
    label: 'Vendor',
    blurb: 'Sell wedding services: venue, catering, photography, decor and more.',
  },
  {
    type: 'planner',
    label: 'Wedding planner',
    blurb: 'Offer planning packages and co-manage the weddings you are engaged on.',
  },
];

export default function Register() {
  const theme = useTheme();

  const [accountType, setAccountType] = useState<AccountType>('individual');
  const [role, setRole] = useState('bride');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const selected = ACCOUNT_TYPES.find((a) => a.type === accountType)!;
  // A business is reached on its number, so it is required; an individual can
  // sign up on an email alone and add one later.
  const phoneRequired = accountType !== 'individual';

  /**
   * The same rules the server applies, checked before the round trip.
   *
   * Field-level and specific, because "Enter a 10-digit mobile number" says
   * which field and what to do about it where a single banner does not. The
   * server still enforces every one of these.
   */
  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    const name = displayName.trim();
    const digits = phone.replace(/\s|-/g, '').replace(/^\+91/, '');

    if (!name) errors.displayName = 'Enter your name';
    else if (accountType === 'individual' && !NAME_PATTERN.test(name)) {
      errors.displayName = 'A name may only contain letters and spaces';
    }

    if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email address';

    if (phoneRequired && !digits) errors.phone = 'A business account needs a contact number';
    else if (digits && !MOBILE_10_PATTERN.test(digits)) {
      errors.phone = 'Enter a 10-digit Indian mobile number, starting 6 to 9';
    }

    if (password.length < 8) errors.password = 'At least 8 characters';
    else if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      errors.password = 'Needs an uppercase letter, a lowercase letter and a digit';
    }

    return errors;
  }

  async function submit() {
    setError('');
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        email: email.trim(),
        password,
        accountType,
        displayName: displayName.trim(),
      };
      if (phone.trim()) payload.phone = phone.replace(/\s|-/g, '');
      // Only meaningful for an individual; the server derives the role from
      // accountType for every other persona, and refuses it here.
      if (accountType === 'individual') payload.role = role;

      const { data } = await api.post('/auth/register', payload);
      // Not `setAuth`: on a device the refresh token arrives in the body and
      // has to reach the keystore, or the session ends when the app is closed.
      // The root layout's gate takes it from here.
      await acceptAuth(data);
    } catch (err) {
      setError(apiMessage(err, 'Could not register. The email may already be in use.'));
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
        <View style={{ gap: space(1), marginTop: space(8), marginBottom: space(3) }}>
          <PageTitle>Create your account</PageTitle>
          <PageSubtitle>
            Pick the kind of account you need. It decides what you can do here, and cannot be
            changed later without contacting support.
          </PageSubtitle>
        </View>

        {error ? <Alert tone="critical">{error}</Alert> : null}

        <View style={{ gap: space(2) }}>
          <Body tone="muted">I am joining as</Body>
          {ACCOUNT_TYPES.map((opt) => {
            const active = opt.type === accountType;
            return (
              <Pressable
                key={opt.type}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => setAccountType(opt.type)}
                style={({ pressed }) => [
                  {
                    borderRadius: radius.md,
                    borderWidth: active ? 1.5 : StyleSheet.hairlineWidth,
                    borderColor: rgb(active ? theme.brand : theme.border),
                    backgroundColor: rgb(active ? theme.brandSoft : theme.surface),
                    padding: space(3),
                    gap: space(1),
                  },
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Body>{opt.label}</Body>
                <Caption>{opt.blurb}</Caption>
              </Pressable>
            );
          })}
        </View>

        {selected.roles ? (
          <View style={{ gap: space(2) }}>
            <Body tone="muted">Who is this profile for?</Body>
            <View style={{ flexDirection: 'row', gap: space(2) }}>
              {selected.roles.map((r) => {
                const active = r.value === role;
                return (
                  <Button
                    key={r.value}
                    label={r.label}
                    small
                    variant={active ? 'primary' : 'outline'}
                    onPress={() => setRole(r.value)}
                    style={{ flex: 1 }}
                  />
                );
              })}
            </View>
          </View>
        ) : null}

        <Field
          label={accountType === 'individual' ? 'Full name' : 'Your name'}
          value={displayName}
          onChangeText={setDisplayName}
          maxLength={120}
          autoComplete="name"
          textContentType="name"
        />
        {fieldErrors.displayName ? (
          <Caption tone="critical">{fieldErrors.displayName}</Caption>
        ) : null}

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          placeholder="you@example.com"
        />
        {fieldErrors.email ? <Caption tone="critical">{fieldErrors.email}</Caption> : null}

        <Field
          label={phoneRequired ? 'Mobile number' : 'Mobile number (optional)'}
          hint={fieldErrors.phone ? undefined : 'Ten digits, starting 6 to 9. The +91 is added for you.'}
          value={phone}
          onChangeText={setPhone}
          keyboardType="number-pad"
          maxLength={13}
          autoComplete="tel"
          textContentType="telephoneNumber"
          placeholder="9876543210"
        />
        {fieldErrors.phone ? <Caption tone="critical">{fieldErrors.phone}</Caption> : null}

        <Field
          label="Password"
          hint={
            fieldErrors.password
              ? undefined
              : 'At least 8 characters, with an uppercase letter, a lowercase letter and a digit.'
          }
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          onSubmitEditing={submit}
          returnKeyType="go"
        />
        {fieldErrors.password ? <Caption tone="critical">{fieldErrors.password}</Caption> : null}

        <Button
          label={`Create ${selected.label.toLowerCase()} account`}
          onPress={submit}
          busy={busy}
          disabled={!email.trim() || !password || !displayName.trim()}
        />

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: space(1),
            marginBottom: space(4),
          }}
        >
          <Caption>Have an account?</Caption>
          <Link href="/login" asChild>
            <Pressable accessibilityRole="link" hitSlop={8}>
              <Caption tone="brand">Sign in</Caption>
            </Pressable>
          </Link>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

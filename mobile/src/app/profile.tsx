import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { ROLE_LABEL } from '@/shared/permissions';
import { DetailGrid, DetailRow } from '@/components/chrome';
import { DateField, SelectField, Textarea } from '@/components/form';
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  Eyebrow,
  Field,
  Loading,
  PageSubtitle,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useAuth } from '@/store/auth';
import { space } from '@/theme';

/**
 * My Profile: what the platform holds about the person, not their business.
 *
 * The web app's Profile page, less the parts that only mean something to
 * somebody in the matches. A vendor and a verification officer have no biodata,
 * so the visibility control and the steward fields are not here — they were
 * noise on the web page too (EZ1-I85, EZ1-I93) and the same argument settles it
 * for this app.
 *
 * Read first, edit on request. A page that opens as a form invites an accidental
 * edit of a field somebody only came to check.
 */
interface MeResponse {
  displayName?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  city?: string | null;
  address?: string | null;
  contactPhone?: string | null;
  bio?: string | null;
}

const EMPTY = {
  displayName: '',
  gender: '',
  dateOfBirth: '',
  city: '',
  address: '',
  contactPhone: '',
  bio: '',
};

/** The server's own rule, applied in the field so a typo costs no round trip. */
const MOBILE_10 = /^[6-9]\d{9}$/;

const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

export default function Profile() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);

  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { data, isPending } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data as MeResponse,
    retry: false,
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      displayName: data.displayName ?? '',
      gender: data.gender ?? '',
      dateOfBirth: data.dateOfBirth ?? '',
      city: data.city ?? '',
      address: data.address ?? '',
      contactPhone: data.contactPhone ?? '',
      bio: data.bio ?? '',
    });
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      // Blank optional fields are omitted rather than sent empty, which the
      // validators read as malformed rather than absent.
      const payload: Record<string, string> = { displayName: form.displayName.trim() };
      for (const key of ['gender', 'dateOfBirth', 'city', 'address', 'contactPhone', 'bio'] as const) {
        const value = form[key].trim();
        if (value) payload[key] = value;
      }
      await api.put('/users/me/profile', payload);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      setEditing(false);
      setError('');
      setNotice('Saved. This is what we hold for you now.');
    },
    onError: (err) => setError(apiMessage(err, 'Your profile could not be saved.')),
  });

  function submit() {
    setNotice('');
    setError('');
    const errors: Record<string, string> = {};
    if (!form.displayName.trim()) errors.displayName = 'Tell us what to call you';
    if (form.contactPhone.trim()) {
      const digits = form.contactPhone.replace(/[\s-]/g, '').replace(/^\+91/, '');
      if (!MOBILE_10.test(digits)) errors.contactPhone = 'Enter a 10-digit Indian mobile number';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    save.mutate();
  }

  const set = (key: keyof typeof EMPTY) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    // The mark clears the moment they start fixing the field it is on.
    setFieldErrors((fe) => (fe[key] ? { ...fe, [key]: '' } : fe));
  };

  if (isPending) {
    return (
      <Screen>
        <Loading rows={3} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <Eyebrow>Signed in as</Eyebrow>
        <SectionTitle>{user?.email ?? 'Signed in'}</SectionTitle>
        <Caption tone="faint">
          {user ? (ROLE_LABEL[user.role] ?? user.role) : ''}
          {user?.isVerified ? ' · email confirmed' : ' · email not confirmed'}
        </Caption>
      </Card>

      {notice ? <Alert tone="positive">{notice}</Alert> : null}
      {error ? <Alert tone="critical">{error}</Alert> : null}

      {editing ? (
        <Card>
          <SectionTitle>Edit your details</SectionTitle>
          <Field
            label="Name"
            value={form.displayName}
            onChangeText={set('displayName')}
            error={fieldErrors.displayName}
            placeholder="The name people see"
          />
          <SelectField
            label="Gender"
            value={form.gender}
            options={GENDERS}
            onChange={set('gender')}
          />
          <DateField
            label="Date of birth"
            value={form.dateOfBirth}
            onChange={set('dateOfBirth')}
            to={new Date().toISOString().slice(0, 10)}
          />
          <Field label="City" value={form.city} onChangeText={set('city')} />
          <Field label="Address" value={form.address} onChangeText={set('address')} />
          <Field
            label="Contact number"
            value={form.contactPhone}
            onChangeText={set('contactPhone')}
            error={fieldErrors.contactPhone}
            keyboardType="phone-pad"
            placeholder="10-digit mobile number"
          />
          <Textarea label="About you" value={form.bio} onChange={set('bio')} rows={4} />

          <View style={{ gap: space(2) }}>
            <Button label="Save" busy={save.isPending} onPress={submit} />
            <Button
              label="Cancel"
              variant="outline"
              disabled={save.isPending}
              onPress={() => {
                setEditing(false);
                setFieldErrors({});
                setError('');
              }}
            />
          </View>
        </Card>
      ) : (
        <Card>
          <SectionTitle>Your details</SectionTitle>
          <DetailGrid>
            <DetailRow label="Name">{data?.displayName || '—'}</DetailRow>
            <DetailRow label="Gender">
              {GENDERS.find((g) => g.value === data?.gender)?.label ?? '—'}
            </DetailRow>
            <DetailRow label="Date of birth">{data?.dateOfBirth || '—'}</DetailRow>
            <DetailRow label="City">{data?.city || '—'}</DetailRow>
            <DetailRow label="Address">{data?.address || '—'}</DetailRow>
            <DetailRow label="Contact number">{data?.contactPhone || '—'}</DetailRow>
          </DetailGrid>
          {data?.bio ? <Body tone="muted">{data.bio}</Body> : null}
          <Button label="Edit profile" onPress={() => setEditing(true)} />
        </Card>
      )}

      <PageSubtitle>
        Your email address and what your account may do are set by the platform. Everything else on
        this page is yours to change.
      </PageSubtitle>
    </Screen>
  );
}

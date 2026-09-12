import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { dateTime, humanise } from '@/lib/format';
import { isProvider } from '@/shared/permissions';
import { Badge, DetailGrid, DetailRow, Divider, type Tone } from '@/components/chrome';
import { SelectField, Textarea } from '@/components/form';
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
 * Somewhere to say something has gone wrong.
 *
 * The web app's Support page: the same subjects, the same wording, the same
 * warning that raising a case against a booking freezes the money held on it.
 * The subject is asked for rather than inferred, because freezing somebody's
 * money by accident is not a small mistake.
 *
 * Evidence photographs are on the web page and not here. An attachment picker
 * belongs with the upload work in Business Details, not bolted onto a form
 * somebody is filling in because something is already broken.
 */
interface SupportCase {
  id: string;
  subjectType: string;
  subjectId: string | null;
  title: string;
  description: string;
  status: string;
  createdAt: string;
  findings?: string | null;
  settlementNotes?: string | null;
  resolvedAt?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  triaged: 'Triaged',
  allocated: 'With an investigator',
  in_progress: 'Being looked into',
  waiting_for_information: 'Waiting on you',
  resolution_submitted: 'Resolution in review',
  admin_review: 'Resolution in review',
  reassigned: 'Sent for another look',
  resolved: 'Resolved',
  rejected: 'Closed, no action',
  escalated: 'Escalated for a visit',
  closed: 'Closed',
};

const STATUS_TONE: Record<string, Tone> = {
  open: 'caution',
  waiting_for_information: 'caution',
  reassigned: 'caution',
  resolved: 'positive',
  escalated: 'critical',
  rejected: 'neutral',
  closed: 'neutral',
};

type Audience = 'provider' | 'seeker';

const SUBJECTS: { value: string; label: string; note?: string; audience?: Audience[] }[] = [
  { value: 'booking', label: 'A booking', note: 'Money held on it is frozen until this is settled' },
  { value: 'payment', label: 'A payment or payout' },
  { value: 'vendor', label: 'My business listing', audience: ['provider'] },
  { value: 'availability', label: 'Availability', audience: ['provider'] },
  { value: 'profile', label: 'A profile', audience: ['seeker'] },
  { value: 'match', label: 'A match', audience: ['seeker'] },
  { value: 'account', label: 'My account' },
  { value: 'other', label: 'Something else' },
];

function subjectsFor(role?: string) {
  const provider = isProvider(role);
  const seeker = role === 'bride' || role === 'groom' || role === 'family' || role === 'agent';
  return SUBJECTS.filter((subject) => {
    if (!subject.audience) return true;
    if (provider) return subject.audience.includes('provider');
    if (seeker) return subject.audience.includes('seeker');
    // Staff and anyone unclassified see everything.
    return true;
  });
}

export default function Support() {
  const qc = useQueryClient();
  const role = useAuth((s) => s.user?.role);
  const [raising, setRaising] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['support-cases'],
    queryFn: async () => (await api.get('/verification/cases')).data as { data: SupportCase[] },
    retry: false,
  });

  const rows = data?.data ?? [];

  return (
    <Screen>
      <PageSubtitle>
        Anything that has gone wrong. A booking, a payment, a listing that will not verify. Somebody
        reads every one of these.
      </PageSubtitle>

      {notice ? <Alert tone="positive">{notice}</Alert> : null}
      {error ? <Alert tone="critical">{error}</Alert> : null}

      <Button
        label={raising ? 'Cancel' : 'Raise an issue'}
        variant={raising ? 'outline' : 'primary'}
        onPress={() => setRaising((r) => !r)}
      />

      {raising ? (
        <RaiseCase
          subjects={subjectsFor(role)}
          onDone={(message) => {
            setRaising(false);
            setError('');
            setNotice(message);
            void qc.invalidateQueries({ queryKey: ['support-cases'] });
          }}
          onError={(message) => {
            setNotice('');
            setError(message);
          }}
        />
      ) : null}

      <SectionTitle>Your issues</SectionTitle>
      {isPending ? (
        <Loading rows={2} />
      ) : rows.length === 0 ? (
        <Card>
          <Caption tone="faint">
            Nothing raised. If something is wrong, raising it here is how it reaches a person.
          </Caption>
        </Card>
      ) : (
        rows.map((row) => (
          <Card key={row.id}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
              <SectionTitle style={{ flex: 1 }} numberOfLines={2}>
                {row.title}
              </SectionTitle>
              <Badge tone={STATUS_TONE[row.status] ?? 'brand'}>
                {STATUS_LABEL[row.status] ?? humanise(row.status)}
              </Badge>
            </View>
            <Caption tone="faint">
              {[
                SUBJECTS.find((s) => s.value === row.subjectType)?.label ??
                  humanise(row.subjectType),
                `raised ${dateTime(row.createdAt)}`,
              ].join(' · ')}
            </Caption>

            <Button
              label={open === row.id ? 'Hide detail' : 'Show detail'}
              variant="ghost"
              small
              onPress={() => setOpen((current) => (current === row.id ? null : row.id))}
            />

            {open === row.id ? (
              <>
                <Divider />
                <Body tone="muted">{row.description}</Body>
                <DetailGrid>
                  <DetailRow label="Reference">{row.id.slice(0, 8)}</DetailRow>
                  {row.subjectId ? (
                    <DetailRow label="About">{row.subjectId.slice(0, 8)}</DetailRow>
                  ) : null}
                  {row.resolvedAt ? (
                    <DetailRow label="Resolved">{dateTime(row.resolvedAt)}</DetailRow>
                  ) : null}
                </DetailGrid>
                {row.findings ? (
                  <Caption>
                    <Caption tone="faint">What was found: </Caption>
                    {row.findings}
                  </Caption>
                ) : null}
                {row.settlementNotes ? (
                  <Caption>
                    <Caption tone="faint">Settlement: </Caption>
                    {row.settlementNotes}
                  </Caption>
                ) : null}
              </>
            ) : null}
          </Card>
        ))
      )}
    </Screen>
  );
}

function RaiseCase({
  subjects,
  onDone,
  onError,
}: {
  subjects: { value: string; label: string; note?: string }[];
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [subjectType, setSubjectType] = useState('other');
  const [subjectId, setSubjectId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // A booking or a payment is settled against a specific record, so the
  // reference is asked for rather than guessed at.
  const needsSubject = subjectType === 'booking' || subjectType === 'payment';

  const raise = useMutation({
    mutationFn: async () => {
      await api.post('/verification/cases', {
        subjectType,
        subjectId: subjectId.trim() || undefined,
        title: title.trim(),
        description: description.trim(),
      });
    },
    onSuccess: () => {
      setTitle('');
      setDescription('');
      setSubjectId('');
      onDone('Raised. You will see it move through the stages here.');
    },
    onError: (err) => onError(apiMessage(err, 'That could not be raised.')),
  });

  return (
    <Card>
      <SelectField
        label="What is it about?"
        value={subjectType}
        options={subjects}
        onChange={(value) => {
          setSubjectType(value);
          setSubjectId('');
        }}
      />
      {needsSubject ? (
        <Field
          label={subjectType === 'booking' ? 'Booking reference' : 'Payment reference'}
          value={subjectId}
          onChangeText={setSubjectId}
          autoCapitalize="none"
          autoCorrect={false}
          hint="Any money held on it is frozen until this is settled."
        />
      ) : null}
      <Field
        label="In one line"
        value={title}
        onChangeText={setTitle}
        placeholder="What has gone wrong"
      />
      <Textarea
        label="What happened"
        value={description}
        onChange={setDescription}
        rows={5}
        placeholder="Dates, amounts, names — whatever somebody would need to look into it"
      />
      <Button
        label="Raise it"
        busy={raise.isPending}
        disabled={!title.trim() || !description.trim()}
        onPress={() => raise.mutate()}
      />
    </Card>
  );
}

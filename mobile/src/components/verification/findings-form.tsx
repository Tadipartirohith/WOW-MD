import { useState } from 'react';
import { View } from 'react-native';

import { api } from '@/lib/api';
import { CORRECTABLE_FIELD_KEYS, CORRECTION_FIELD_LABELS } from '@/shared/permissions';
import { CheckRow, SelectField, Textarea } from '@/components/form';
import { DocumentList, PhotoPicker } from '@/components/uploader';
import { Alert, Body, Button, Caption, Card, SectionTitle } from '@/components/ui';
import { space } from '@/theme';

type Run = (fn: () => Promise<unknown>, done?: string) => Promise<void>;

/**
 * What the officer writes up after attending.
 *
 * `visited` is asked separately from the observations because "I went and it
 * checked out" and "I could not find the address" are both findings, and the
 * second is the one that matters most.
 *
 * The evidence uploader is the part this platform adds rather than replicates.
 * The web form has no way to attach anything — the field exists on the record
 * and the page never offered it — and an officer standing in front of the
 * kitchen they are verifying is holding the one device that can photograph it.
 */
export function FindingsForm({
  requestId,
  revisit,
  onRun,
}: {
  requestId: string;
  revisit: boolean;
  onRun: Run;
}) {
  const [visited, setVisited] = useState(true);
  const [observations, setObservations] = useState('');
  const [issues, setIssues] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [recommendation, setRecommendation] = useState<'approve' | 'reject' | 'revisit'>('approve');
  const [problem, setProblem] = useState('');

  const issueList = issues
    .split('\n')
    .map((issue) => issue.trim())
    .filter(Boolean);

  function submit() {
    if (observations.trim().length < 10) {
      setProblem('Write up what you actually saw.');
      return;
    }
    if (recommendation !== 'approve' && issueList.length === 0) {
      setProblem('List what did not check out, one per line.');
      return;
    }
    setProblem('');
    void onRun(
      () =>
        api.put(`/verification/requests/${requestId}/findings`, {
          visited,
          observations: observations.trim(),
          issues: issueList,
          evidence,
          recommendation,
        }),
      'Submitted. An administrator decides from here.',
    );
  }

  return (
    <Card>
      <SectionTitle>{revisit ? 'Write up the return visit' : 'Write up the visit'}</SectionTitle>

      <CheckRow label="I attended the address" checked={visited} onChange={setVisited} />

      <Textarea
        label="What you saw"
        value={observations}
        onChange={setObservations}
        rows={5}
        placeholder="Attended the address. Kitchen and two vans present; GST certificate on the wall."
      />

      <Textarea
        label="Anything that did not check out"
        value={issues}
        onChange={setIssues}
        rows={3}
        placeholder="One per line"
        hint="One per line. Required for anything other than an approval."
      />

      <View style={{ gap: space(1.5) }}>
        <Body style={{ fontSize: 13, fontWeight: '500' }} tone="muted">
          Evidence
        </Body>
        <Caption tone="faint">
          Photographs of the premises, the signage, the certificates on the wall. Attached to the
          findings an administrator reads.
        </Caption>
        <DocumentList
          urls={evidence}
          onRemove={(url) => setEvidence((e) => e.filter((u) => u !== url))}
        />
        <PhotoPicker
          label="Add evidence"
          kind="attachment"
          onUploaded={(url) => setEvidence((e) => [...e, url])}
        />
      </View>

      <SelectField
        label="What you recommend"
        value={recommendation}
        onChange={(value) => setRecommendation(value as typeof recommendation)}
        options={[
          { value: 'approve', label: 'Approve' },
          { value: 'reject', label: 'Reject' },
          { value: 'revisit', label: 'Somebody should go again' },
        ]}
        hint="A recommendation, not a decision. An administrator reads this and decides."
      />

      {problem ? <Alert tone="critical">{problem}</Alert> : null}
      <Button label="Submit findings" onPress={submit} />
    </Card>
  );
}

/**
 * Ask the vendor to correct specific business fields and resubmit.
 *
 * A tighter send-back than "Needs another look": the administrator picks exactly
 * which fields are wrong, and the listing reopens for only those. The server
 * keeps the flagged fields and a snapshot of their values, so the resubmission
 * shows up as previous-vs-updated on the next review.
 */
export function RequestCorrection({
  requestId,
  onRun,
}: {
  requestId: string;
  onRun: Run;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<string[]>([]);
  const [reason, setReason] = useState('');

  const toggle = (key: string) =>
    setFields((prev) => (prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]));

  if (!open) {
    return (
      <Button label="Request correction" variant="outline" onPress={() => setOpen(true)} />
    );
  }

  const ready = fields.length > 0 && reason.trim().length >= 5;

  return (
    <Card>
      <SectionTitle>Which fields need correcting?</SectionTitle>
      {CORRECTABLE_FIELD_KEYS.map((key) => (
        <CheckRow
          key={key}
          label={CORRECTION_FIELD_LABELS[key]}
          checked={fields.includes(key)}
          onChange={() => toggle(key)}
        />
      ))}
      <Textarea
        label="What is wrong"
        value={reason}
        onChange={setReason}
        rows={3}
        placeholder="What is wrong and what the vendor should change. They see this verbatim."
      />
      <Caption tone="faint">
        The listing reopens for only these fields; everything else stays locked until it is
        resubmitted and re-verified.
      </Caption>
      <Button
        label="Send correction request"
        disabled={!ready}
        onPress={() =>
          void onRun(async () => {
            await api.put(`/verification/requests/${requestId}/request-correction`, {
              fields,
              reason: reason.trim(),
            });
            setOpen(false);
            setFields([]);
            setReason('');
          }, 'Correction requested. The vendor can edit only those fields and resubmit.')
        }
      />
      <Button label="Cancel" variant="outline" onPress={() => setOpen(false)} />
    </Card>
  );
}

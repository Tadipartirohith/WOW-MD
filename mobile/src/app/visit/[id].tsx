import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { dateTime, shortDate } from '@/lib/format';
import {
  RECOMMENDATION_LABEL,
  STATUS_TONE,
  type Officer,
  type VerificationRequest,
} from '@/lib/verification';
import { Permission, VERIFICATION_LABEL, can } from '@/shared/permissions';
import { Badge, Divider } from '@/components/chrome';
import { SelectField, Textarea } from '@/components/form';
import { FindingsForm, RequestCorrection } from '@/components/verification/findings-form';
import { Sla } from '@/components/verification/sla';
import { SubjectDetails } from '@/components/verification/subject-details';
import { DocumentList } from '@/components/uploader';
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Loading,
  PageSubtitle,
  PageTitle,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useAuth } from '@/store/auth';
import { rgb, space, useTheme } from '@/theme';

/**
 * One verification visit.
 *
 * The web client renders this as a card in the queue that grows to hold
 * everything — the record under review, the officer's write-up form, the
 * administrator's decision, the correction picker. That works beside a list on
 * a desktop and cannot work on a phone, so the visit gets a screen of its own
 * with a real back button, and the queue stays a queue.
 *
 * The two halves stay as separate as they are on the web, and for the reason
 * recorded there: the officer attends and writes up what they saw, and somebody
 * else decides on the strength of it. An approval that rests on nothing is what
 * makes a verification a checkbox.
 */
export default function Visit() {
  const theme = useTheme();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const permissions = useAuth((s) => s.user?.permissions ?? []);

  const canAllocate = can(permissions, Permission.VERIFICATION_ALLOCATE);
  const canDecide = can(permissions, Permission.VERIFICATION_DECIDE);
  const canFieldwork = can(permissions, Permission.VERIFICATION_FIELDWORK);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [remarks, setRemarks] = useState('');
  const [officerUserId, setOfficerUserId] = useState('');

  // Read out of the queue rather than fetched on its own: the list is already
  // in cache and polling, so the detail cannot show a status the queue behind
  // it disagrees with.
  const { data: requests, isPending } = useQuery({
    queryKey: ['verification-requests'],
    queryFn: async () => (await api.get('/verification/requests')).data,
    retry: false,
    refetchInterval: 20_000,
  });

  // Only an allocator needs the roster; an officer working their own visit
  // never reassigns one, so the request is not made for them.
  const { data: officers = [] } = useQuery({
    queryKey: ['verification-officers'],
    queryFn: async () => (await api.get('/verification/officers')).data as Officer[],
    retry: false,
    enabled: canAllocate,
  });

  // How much each officer is already carrying. Allocation without it is a name
  // picked off a list, which is how one officer ends up with everything.
  const { data: workload = [] } = useQuery({
    queryKey: ['verification-workload'],
    queryFn: async () =>
      (await api.get('/verification/workload')).data as {
        officerUserId: string;
        open: number;
        onLeave?: boolean;
        availability?: { status: string; leaveTo: string | null };
      }[],
    retry: false,
    enabled: canAllocate,
  });

  const request: VerificationRequest | undefined = (requests?.data ?? []).find(
    (row: VerificationRequest) => row.id === id,
  );

  async function run(fn: () => Promise<unknown>, done?: string) {
    setError('');
    setNotice('');
    try {
      await fn();
      if (done) setNotice(done);
      for (const key of [
        'verification-requests',
        'verification-request',
        'verification-metrics',
        'verification-officers',
      ]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    } catch (err) {
      setError(apiMessage(err, 'That action was rejected.'));
    }
  }

  if (isPending) {
    return (
      <Screen>
        <Loading rows={4} />
      </Screen>
    );
  }

  if (!request) {
    return (
      <Screen>
        <EmptyState title="That visit is no longer in your queue">
          It may have been reallocated or decided by somebody else.
        </EmptyState>
      </Screen>
    );
  }

  const decided = request.status === 'approved' || request.status === 'rejected';
  // Findings are in; somebody has to read them and decide.
  const awaitingDecision = request.status === 'submitted' || request.status === 'admin_review';

  // Verification is official work: only a Verification Officer may be allocated
  // a request, never a commercial agent. Agents are filtered out of the roster
  // here rather than shown and refused later.
  const eligible = officers
    .filter((officer) => (officer.kind ?? 'officer') === 'officer' && officer.isActive)
    .map((officer) => {
      const load = workload.find((w) => w.officerUserId === officer.id);
      return {
        ...officer,
        openCount: load?.open ?? 0,
        onLeave: load?.onLeave ?? false,
        availabilityStatus: load?.availability?.status,
        leaveTo: load?.availability?.leaveTo ?? null,
      };
    })
    // Lightest first, so the recommended choice is also the first one listed.
    .sort((a, b) => (a.openCount ?? 0) - (b.openCount ?? 0));

  const officerName = (userId: string | null) =>
    officers.find((officer) => officer.id === userId)?.name ?? 'Verification officer';

  return (
    <Screen>
      <View style={{ gap: space(1) }}>
        <PageTitle>{request.subjectName ?? `${request.applicantType} verification`}</PageTitle>
        <PageSubtitle>
          {request.applicantType} verification · raised {shortDate(request.createdAt)}
          {request.applicantCity ? ` · ${request.applicantCity}` : ''}
        </PageSubtitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
          <Badge tone={STATUS_TONE[request.status] ?? 'neutral'}>
            {VERIFICATION_LABEL[request.status] ?? request.status.replace(/_/g, ' ')}
          </Badge>
          {request.revisitCount > 0 ? (
            <Badge tone="caution">Visit {request.revisitCount + 1}</Badge>
          ) : null}
        </View>
      </View>

      {error ? <Alert tone="critical">{error}</Alert> : null}
      {notice ? <Alert tone="positive">{notice}</Alert> : null}

      <Sla request={request} />

      {request.applicantEmail || request.applicantPhone ? (
        <Card>
          <SectionTitle>Reaching them</SectionTitle>
          <Body>{[request.applicantEmail, request.applicantPhone].filter(Boolean).join(' · ')}</Body>
        </Card>
      ) : null}

      {request.remarks ? (
        <Card>
          <SectionTitle>Remarks on the record</SectionTitle>
          <Body tone="muted">{request.remarks}</Body>
        </Card>
      ) : null}

      <SubjectDetails requestId={request.id} applicantType={request.applicantType} />

      {/*
        Only while the request is still unallocated. Once an officer is
        assigned, the Allocate control disappears and the assigned officer is
        shown instead — the web UI was still offering "Allocate to" after the
        backend had assigned and the officer had submitted findings.
      */}
      {canAllocate && request.status === 'new' && (
        <Card>
          <SectionTitle>Allocate this visit</SectionTitle>
          <SelectField
            label="Allocate to"
            value={officerUserId}
            onChange={setOfficerUserId}
            placeholder="Lightest workload (recommended)"
            options={eligible.map((officer) => ({
              value: officer.id,
              label: officer.name,
              disabled: officer.onLeave,
              note: [
                typeof officer.openCount === 'number' ? `${officer.openCount} open` : null,
                officer.onLeave
                  ? officer.availabilityStatus === 'on_leave'
                    ? `on leave${officer.leaveTo ? ` until ${officer.leaveTo}` : ''}`
                    : 'unavailable'
                  : null,
              ]
                .filter(Boolean)
                .join(' · '),
            }))}
            hint="Left to itself this goes to whoever is carrying least. Name an officer only when something about this case says it should be theirs."
          />
          <Button
            label="Allocate"
            onPress={() =>
              void run(
                () =>
                  api.put(
                    `/verification/requests/${request.id}/allocate`,
                    officerUserId ? { officerUserId } : {},
                  ),
                'Allocated. The officer will see it in their queue.',
              )
            }
          />
        </Card>
      )}

      {/* After allocation, who it went to — replacing the Allocate control. */}
      {request.status !== 'new' && request.assignedToUserId ? (
        <Card>
          <Caption tone="faint">Assigned officer</Caption>
          <Body>{officerName(request.assignedToUserId)}</Body>
        </Card>
      ) : null}

      {/* What the officer wrote up, once they have. */}
      {request.findings && (
        <Card>
          <SectionTitle>
            {request.findings.visited ? 'Visited' : 'Could not attend'}
          </SectionTitle>
          <Caption tone="faint">
            Recommends {RECOMMENDATION_LABEL[request.findings.recommendation]}
            {request.assignedToUserId ? ` · filed by ${officerName(request.assignedToUserId)}` : ''}
            {request.submittedAt ? ` · ${dateTime(request.submittedAt)}` : ''}
          </Caption>
          <Divider />
          <Body>{request.findings.observations}</Body>
          {request.findings.issues.length > 0 && (
            <View style={{ gap: space(1) }}>
              {request.findings.issues.map((issue, i) => (
                <Caption key={i} style={{ color: rgb(theme.criticalFg) }}>
                  • {issue}
                </Caption>
              ))}
            </View>
          )}
          {request.findings.evidence.length > 0 && (
            <>
              <Caption tone="faint">Evidence</Caption>
              <DocumentList urls={request.findings.evidence} />
            </>
          )}
        </Card>
      )}

      {/*
        The officer's half: attend, then write up what they saw. Deciding on the
        strength of it is a separate step, below.
      */}
      {canFieldwork && !decided && !awaitingDecision && (
        <>
          {request.status === 'assigned' || request.status === 'additional_review' ? (
            <Button
              label={request.status === 'additional_review' ? 'Go back out' : 'Start the visit'}
              variant="outline"
              onPress={() => void run(() => api.put(`/verification/requests/${request.id}/start`))}
            />
          ) : null}
          <FindingsForm
            requestId={request.id}
            revisit={request.revisitCount > 0}
            onRun={run}
          />
        </>
      )}

      {/* The reviewer's half. */}
      {canDecide && awaitingDecision && (
        <Card>
          <SectionTitle>Decide</SectionTitle>
          {request.status === 'submitted' ? (
            <Button
              label="Take this for review"
              variant="outline"
              onPress={() =>
                void run(
                  () => api.put(`/verification/requests/${request.id}/review`),
                  'Yours to decide. Nobody else will pick it up.',
                )
              }
            />
          ) : null}
          <Textarea
            label="Your reasoning"
            value={remarks}
            onChange={setRemarks}
            rows={3}
            placeholder="Required for anything other than an approval."
          />
          <Button
            label="Approve"
            onPress={() =>
              void run(
                () =>
                  api.put(`/verification/requests/${request.id}/decide`, {
                    status: 'approved',
                    remarks: remarks || undefined,
                  }),
                'Approved. The applicant is now active.',
              )
            }
          />
          <Button
            label="Needs another look"
            variant="outline"
            onPress={() =>
              void run(
                () =>
                  api.put(`/verification/requests/${request.id}/decide`, {
                    status: 'additional_review',
                    remarks,
                  }),
                'Sent back. It is on the officer’s queue again.',
              )
            }
          />
          <Button
            label="Reject"
            variant="outline"
            onPress={() =>
              void run(() =>
                api.put(`/verification/requests/${request.id}/decide`, {
                  status: 'rejected',
                  remarks,
                }),
              )
            }
          />
          <Caption tone="faint">
            Sending it back clears the findings and returns it to the officer, who visits again.
          </Caption>
        </Card>
      )}

      {/*
        The targeted alternative to "Needs another look": reopen only the fields
        that are wrong, so the vendor fixes those and nothing else. Vendor
        businesses only, and only while the request is still live.
      */}
      {canDecide &&
      request.applicantType === 'vendor' &&
      request.subjectId &&
      !decided &&
      request.status !== 'new' ? (
        <RequestCorrection requestId={request.id} onRun={run} />
      ) : null}
    </Screen>
  );
}

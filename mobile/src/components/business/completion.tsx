import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, CircleIcon, LockSimple, Warning } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { BUSINESS_STATUS_LABEL, businessTone } from '@/lib/business-status';
import { Badge, Divider } from '@/components/chrome';
import { Alert, Body, Button, Caption, Card, SectionTitle } from '@/components/ui';
import { rgb, space, useTheme } from '@/theme';

/**
 * Getting a business from a blank form to live, as one visible sequence.
 *
 * The native rendering of the web client's BusinessSetup, and the same
 * principle it is built on: every rule here is the server's, read rather than
 * re-derived. The checklist is `completion().items`, the button is enabled by
 * `canSubmit`, the lock is `rules.editIdentity`. A second copy of those rules on
 * this platform would be a second thing to keep in step, and it would be the
 * copy that is wrong — a phone telling a vendor they are ready while the API
 * refuses the submission is worse than no phone at all.
 */

export interface CompletionItem {
  key: string;
  label: string;
  complete: boolean;
  /** What is still needed, or a note when the item is optional. */
  missing: string | null;
}

export interface Completion {
  businessId: string;
  status: string;
  rules: {
    editIdentity: boolean;
    /** About, contact and portfolio stay the vendor's once verified/live. */
    editPresentational: boolean;
    editCatalog: boolean;
    trade: boolean;
    submit: boolean;
    visible: boolean;
    note: string;
  };
  items: CompletionItem[];
  canSubmit: boolean;
  blocking: string[];
}

export function useCompletion(businessId?: string | null) {
  return useQuery({
    queryKey: ['business-completion', businessId],
    queryFn: async () => (await api.get(`/vendors/${businessId}/completion`)).data as Completion,
    enabled: Boolean(businessId),
    retry: false,
  });
}

/** Everything a save touches, so the hub, the switcher and the checklist agree. */
export function useRefreshBusiness() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['business-completion'] });
    void qc.invalidateQueries({ queryKey: ['my-listing'] });
    void qc.invalidateQueries({ queryKey: ['vendor-me'] });
    void qc.invalidateQueries({ queryKey: ['me'] });
  };
}

export function BusinessChecklist({ businessId }: { businessId: string }) {
  const theme = useTheme();
  const refresh = useRefreshBusiness();
  const [error, setError] = useState('');
  const { data, isPending } = useCompletion(businessId);

  const review = useMutation({
    mutationFn: () => api.post(`/vendors/${businessId}/first-review`),
    onSuccess: () => {
      setError('');
      refresh();
    },
    onError: (err) => setError(apiMessage(err, 'That could not be opened for review.')),
  });

  const submit = useMutation({
    mutationFn: () => api.post(`/vendors/${businessId}/submit-verification`),
    onSuccess: () => {
      setError('');
      refresh();
    },
    onError: (err) => setError(apiMessage(err, 'That could not be submitted.')),
  });

  if (isPending || !data) return null;

  const { status, rules, items, canSubmit } = data;
  const inReview = status === 'first_review';
  const submitted = !rules.submit && !rules.editIdentity;

  return (
    <Card style={{ gap: space(3) }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: space(2),
        }}
      >
        <SectionTitle style={{ flex: 1 }}>Getting this listing live</SectionTitle>
        <Badge tone={businessTone(status)}>{BUSINESS_STATUS_LABEL[status] ?? status}</Badge>
      </View>
      <Caption>{rules.note}</Caption>

      {error ? <Alert tone="critical">{error}</Alert> : null}

      {/*
        The checklist is the server's, item for item. It is computed on every
        read rather than tracked, so removing a document takes its tick away
        again — a "documents complete" flag somebody forgot to clear is worse
        than no flag, because it lets an unfinished listing through the gate.
      */}
      <View>
        {items.map((item, i) => (
          <View
            key={item.key}
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: space(3),
              paddingVertical: space(2.5),
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: rgb(theme.border),
            }}
          >
            {/* The tick is decoration beside the label; the label already
                says what the item is, and `item.missing` says what is left. */}
            {item.complete ? (
              <CheckCircle size={20} weight="fill" color={rgb(theme.positiveFg)} />
            ) : (
              <CircleIcon size={20} color={rgb(theme.ink[300])} />
            )}
            <View style={{ flex: 1, gap: space(0.5) }}>
              <Body>{item.label}</Body>
              {item.missing ? <Caption tone="faint">{item.missing}</Caption> : null}
            </View>
          </View>
        ))}
      </View>

      {/*
        Two steps, and they are different questions. The first review is the
        vendor reading their own listing while they can still change it; the
        submission is the moment it locks and an officer is sent. Collapsing
        them into one button would make the review a confirmation dialog.
      */}
      {rules.submit && (
        <View style={{ gap: space(2) }}>
          <Divider />
          {!inReview ? (
            <Button
              label="Look it over"
              disabled={!canSubmit}
              busy={review.isPending}
              onPress={() => review.mutate()}
            />
          ) : (
            <>
              <Button
                label="Submit for verification"
                disabled={!canSubmit}
                busy={submit.isPending}
                onPress={() => submit.mutate()}
              />
              <Caption tone="faint">
                It locks when you do. An officer visits the registered address.
              </Caption>
            </>
          )}
          {!canSubmit && data.blocking.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
              <Warning size={15} weight="fill" color={rgb(theme.cautionFg)} />
              <Caption style={{ flex: 1, color: rgb(theme.cautionFg) }}>
                Still needed: {data.blocking.join(', ')}
              </Caption>
            </View>
          )}
        </View>
      )}

      {submitted && (
        <View style={{ gap: space(2) }}>
          <Divider />
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
            <LockSimple size={17} color={rgb(theme.ink[400])} />
            {/*
              The lock is the server's, not this screen's. A vendor who could
              edit their GST number after an officer had been sent to check it
              would have verified nothing, so the update routes refuse it —
              this only says so.
            */}
            <Caption style={{ flex: 1 }}>
              Locked while it is being verified. It opens again if it is sent back for changes.
            </Caption>
          </View>
        </View>
      )}
    </Card>
  );
}

import { Pressable, StyleSheet, View } from 'react-native';
import { CaretRight } from 'phosphor-react-native';

import { shortDate } from '@/lib/format';
import { STATUS_TONE, type VerificationRequest } from '@/lib/verification';
import { VERIFICATION_LABEL } from '@/shared/permissions';
import { Badge } from '@/components/chrome';
import { Sla } from '@/components/verification/sla';
import { Body, Caption } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * One visit in the queue.
 *
 * The name is in the title. Every card in this queue used to read "planner
 * verification", so telling two apart meant opening both — and an administrator
 * working through a morning's approvals is mostly asking "which one is this".
 *
 * Everything an officer decides *whether to open* on is here: who it is about,
 * where, how to reach them, how long is left. What they need in order to do the
 * work is on the visit's own screen, because it is a screenful.
 */
export function RequestRow({
  request,
  onPress,
}: {
  request: VerificationRequest;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${request.applicantType} verification${
        request.subjectName ? ` for ${request.subjectName}` : ''
      }`}
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: rgb(theme.surface),
          borderColor: rgb(theme.border),
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.lg,
          padding: space(4),
          gap: space(2),
        },
        pressed && { backgroundColor: rgb(theme.surfaceSunken) },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
        <View style={{ flex: 1, gap: space(0.5) }}>
          <Body numberOfLines={2}>
            {capitalise(request.applicantType)} verification
            {request.subjectName ? ` — ${request.subjectName}` : ''}
          </Body>
          <Caption tone="faint">
            Raised {shortDate(request.createdAt)}
            {request.applicantCity ? ` · ${request.applicantCity}` : ''}
          </Caption>
          {request.applicantEmail || request.applicantPhone ? (
            <Caption tone="faint" numberOfLines={1}>
              {[request.applicantEmail, request.applicantPhone].filter(Boolean).join(' · ')}
            </Caption>
          ) : null}
        </View>
        <Badge tone={STATUS_TONE[request.status] ?? 'neutral'}>
          {VERIFICATION_LABEL[request.status] ?? request.status.replace(/_/g, ' ')}
        </Badge>
      </View>

      {/*
        An allocation made on workload alone because nobody covers that city is
        a staffing gap, and it is invisible once the allocation has happened
        unless it is said here.
      */}
      {request.allocationBasis === 'workload_only' && request.applicantCity ? (
        <Caption style={{ color: rgb(theme.cautionFg) }}>
          Nobody covers {request.applicantCity}, allocated on workload alone
        </Caption>
      ) : null}

      <Sla request={request} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
        <Caption tone="brand" style={{ flex: 1 }}>
          {request.findings ? 'Findings filed — open to review' : 'Open the visit'}
        </Caption>
        <CaretRight size={16} color={rgb(theme.ink[400])} />
      </View>
    </Pressable>
  );
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

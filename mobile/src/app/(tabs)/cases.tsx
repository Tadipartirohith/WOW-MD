import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { CaretRight } from 'phosphor-react-native';

import { api } from '@/lib/api';
import { dateTime, humanise } from '@/lib/format';
import { CASE_FILTERS, STATUS_TONE, type SupportCase } from '@/lib/verification';
import { CASE_STATUS_LABEL, type CaseStatus } from '@/shared/permissions';
import { Badge, FilterChips } from '@/components/chrome';
import { ListScreen } from '@/components/layout';
import { Body, Caption, PageSubtitle, PageTitle } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * The cases assigned to a verification officer.
 *
 * These lived as a tab inside Verification, beside the visit queue. The two are
 * different work — a visit is "go to this address and write down what you saw",
 * a case is an investigation with parties, evidence and a resolution — and
 * sharing a screen meant an officer filtering one was also filtering away the
 * other. Same endpoints as the web page and the same workflow behind each row.
 */
export default function Cases() {
  const router = useRouter();
  const [filter, setFilter] = useState<CaseStatus | null>(null);

  const { data, isPending, isFetching, refetch } = useQuery({
    queryKey: ['verification-cases'],
    queryFn: async () => (await api.get('/verification/cases')).data,
    retry: false,
    refetchInterval: 20_000,
  });

  const all: SupportCase[] = data?.data ?? [];
  const rows = filter ? all.filter((item) => item.status === filter) : all;

  const chips = CASE_FILTERS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    count: all.filter((item) => item.status === entry.key).length,
  }));

  return (
    <ListScreen
      header={
        <>
          <View style={{ gap: space(1), marginTop: space(4) }}>
            <PageTitle>Cases</PageTitle>
            <PageSubtitle>
              Investigations allocated to you — who raised it, what the evidence says, and the
              resolution you propose. Verification visits are on their own tab.
            </PageSubtitle>
          </View>

          {/* Every status is its own filter with a live count, so an officer can
              go straight to what is escalated rather than reading one long list. */}
          <FilterChips
            options={chips}
            value={filter}
            onChange={(key) => setFilter(key as CaseStatus | null)}
          />
        </>
      }
      data={rows}
      keyExtractor={(item) => item.id}
      loading={isPending}
      refreshing={isFetching && !isPending}
      onRefresh={() => void refetch()}
      emptyTitle={all.length === 0 ? 'Nothing allocated to you' : 'Nothing in that group'}
      emptyBody={
        all.length === 0
          ? 'Investigations appear here when an administrator allocates one to you.'
          : undefined
      }
      renderItem={(item) => (
        <CaseRow item={item} onPress={() => router.push(`/case/${item.id}`)} />
      )}
    />
  );
}

/**
 * One case in the list.
 *
 * The case id, its type and when it was raised are up front, so the record
 * identifies itself before it is opened — an officer asked about "the payout
 * one from Tuesday" needs to find it without reading eight descriptions.
 */
function CaseRow({ item, onPress }: { item: SupportCase; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title}
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
          <Body numberOfLines={2}>{item.title}</Body>
          <Caption tone="faint">
            Case {item.id.slice(0, 8)} · {humanise(item.subjectType)} · raised{' '}
            {dateTime(item.createdAt)}
          </Caption>
        </View>
        <Badge tone={STATUS_TONE[item.status] ?? 'neutral'}>
          {CASE_STATUS_LABEL[item.status] ?? humanise(item.status)}
        </Badge>
      </View>

      <Body tone="muted" numberOfLines={3}>
        {item.description}
      </Body>

      {item.requiresPhysicalVerification ? (
        <Caption style={{ color: rgb(theme.cautionFg) }}>
          Escalated — this one needs somebody on the ground.
        </Caption>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
        <Caption tone="brand" style={{ flex: 1 }}>
          Open the case
        </Caption>
        <CaretRight size={16} color={rgb(theme.ink[400])} />
      </View>
    </Pressable>
  );
}

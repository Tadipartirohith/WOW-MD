import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { SECTIONS, type VerificationRequest } from '@/lib/verification';
import { FilterChips, StatTile, TileGrid } from '@/components/chrome';
import { ListScreen } from '@/components/layout';
import { RequestRow } from '@/components/verification/request-row';
import { Body, Caption, Field, PageSubtitle, PageTitle } from '@/components/ui';
import { space } from '@/theme';

/**
 * The in-person verification portal.
 *
 * One screen, two audiences, the same as the web page: an officer sees the work
 * allocated to them, an administrator sees everything. The split is enforced on
 * the server — this simply stops showing controls that would only ever come
 * back 403.
 *
 * Cases are a separate tab, as they are a separate page on the web. A visit is
 * "go to this address and write down what you saw"; a case is an investigation
 * with parties, evidence and a resolution. Sharing one screen meant an officer
 * filtering for one was also filtering away the other.
 *
 * The queue is one flat, virtualised list with the section as a filter, rather
 * than the web page's eight headed groups rendered at once. A phone cannot show
 * eight headings and their contents at the same time, and an officer carrying
 * twenty visits wants one bucket anyway.
 */
export default function Verification() {
  const router = useRouter();

  // Null shows every section at once, which is what somebody with four visits
  // wants; picking one is for somebody with forty.
  const [section, setSection] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Polled, so a request an administrator allocates in another session shows up
  // here without the officer having to act first.
  const { data: metrics } = useQuery({
    queryKey: ['verification-metrics'],
    queryFn: async () => (await api.get('/verification/metrics')).data,
    retry: false,
    refetchInterval: 20_000,
  });

  const {
    data: requests,
    isPending,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['verification-requests'],
    queryFn: async () => (await api.get('/verification/requests')).data,
    retry: false,
    refetchInterval: 20_000,
  });

  const all: VerificationRequest[] = requests?.data ?? [];

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const wanted = section ? (SECTIONS.find((s) => s.key === section)?.statuses ?? []) : null;

    return all
      .filter((request) => !wanted || wanted.includes(request.status))
      .filter(
        (request) =>
          !term ||
          [
            request.subjectName,
            request.applicantEmail,
            request.applicantCity,
            request.applicantType,
            request.id,
          ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(term)),
      )
      // Oldest first inside a bucket: the visit closest to its deadline is the
      // one that needs doing, and the SLA runs from when it was raised.
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [all, section, search]);

  const chips = SECTIONS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    count: all.filter((request) => entry.statuses.includes(request.status)).length,
  }));

  const blurb = section ? SECTIONS.find((s) => s.key === section)?.blurb : undefined;

  return (
    <ListScreen
      header={
        <>
          <View style={{ gap: space(1), marginTop: space(4) }}>
            <PageTitle>Verification</PageTitle>
            <PageSubtitle>
              Agents and vendors are visited before they are activated. Nothing on this platform is
              approved from a form alone.
            </PageSubtitle>
          </View>

          {/*
            Whether an officer is taking fieldwork lives on Home, beside the
            rest of their own standing. This page is the queue: the work, not
            the worker.
          */}
          {metrics && (
            <TileGrid>
              {/* Every tile is a filter: pressing one opens the bucket it counts. */}
              <StatTile
                label="Waiting"
                value={metrics.requests?.new ?? 0}
                active={section === 'new'}
                onPress={() => setSection(section === 'new' ? null : 'new')}
              />
              <StatTile
                label="In progress"
                value={metrics.requests?.in_progress ?? 0}
                tone="brand"
                active={section === 'in_progress'}
                onPress={() => setSection(section === 'in_progress' ? null : 'in_progress')}
              />
              <StatTile
                label="Approved"
                value={metrics.requests?.approved ?? 0}
                tone="positive"
                active={section === 'approved'}
                onPress={() => setSection(section === 'approved' ? null : 'approved')}
              />
              <StatTile
                label="Rejected"
                value={metrics.requests?.rejected ?? 0}
                tone="critical"
                active={section === 'rejected'}
                onPress={() => setSection(section === 'rejected' ? null : 'rejected')}
              />
            </TileGrid>
          )}

          <View style={{ gap: space(1.5) }}>
            <Body style={{ fontWeight: '600' }}>Visits ({all.length})</Body>
            <FilterChips options={chips} value={section} onChange={setSection} />
            {blurb ? <Caption tone="faint">{blurb}</Caption> : null}
          </View>

          <Field
            label="Search the queue"
            value={search}
            onChangeText={setSearch}
            placeholder="Business, applicant, city, type or id"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      }
      data={rows}
      keyExtractor={(request) => request.id}
      loading={isPending}
      refreshing={isFetching && !isPending}
      onRefresh={() => void refetch()}
      emptyTitle={all.length === 0 ? 'Nothing in the queue' : 'Nothing in that group'}
      emptyBody={
        all.length === 0
          ? 'Verification requests arrive here when a business submits its listing.'
          : undefined
      }
      renderItem={(request) => (
        <RequestRow request={request} onPress={() => router.push(`/visit/${request.id}`)} />
      )}
    />
  );
}

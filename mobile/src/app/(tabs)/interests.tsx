import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { formatDate } from '@/shared/dates';
import { FilterChips } from '@/components/chrome';
import { InterestRow, type Interest } from '@/components/matches/interest-row';
import { ListScreen } from '@/components/layout';
import { PromptSheet } from '@/components/prompt';
import { Alert, Caption, Field, PageSubtitle, PageTitle } from '@/components/ui';
import { space } from '@/theme';

/**
 * Interests — who has asked about this profile, who it has asked, and what came
 * of each one (EZ1-I261).
 *
 * The web page's own shape: one board, five ways of slicing it, and the actions
 * travelling with each row rather than being worked out here. What a person may
 * do to an interest depends on its status *and* on which side of it they are —
 * you decline one that came to you and take back one you sent — and two rows
 * that look identical can allow different things. Deciding that in the client
 * would be a second copy of the rule in the one place that cannot enforce it.
 *
 * A steward picks whose interests they are looking at. The selector is the web
 * page's too; without it an agent acting for forty clients has no way to say
 * which one they mean.
 */
interface Board {
  profileId: string;
  received: Interest[];
  sent: Interest[];
  pending: Interest[];
  accepted: Interest[];
  declined: Interest[];
  withdrawn: Interest[];
  counts: Record<string, number>;
}

const TABS: { key: keyof Board & string; label: string; empty: string }[] = [
  {
    key: 'received',
    label: 'Received',
    empty: 'Nobody has asked about this profile yet. Being complete and having photographs is what changes that.',
  },
  { key: 'sent', label: 'Sent', empty: 'Nothing sent yet. Browse Matches and send an interest to start.' },
  { key: 'pending', label: 'Pending', empty: 'Nothing is waiting on an answer, from either side.' },
  {
    key: 'accepted',
    label: 'Accepted',
    empty: 'No accepted interests yet. Both sides have to agree before a conversation opens.',
  },
  { key: 'declined', label: 'Declined', empty: 'Nothing has been declined.' },
];

export default function Interests() {
  const qc = useQueryClient();
  const router = useRouter();
  const [tab, setTab] = useState<string | null>('received');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<{ row: Interest; kind: 'withdraw' | 'block' } | null>(null);

  const { data, isPending, isFetching, refetch } = useQuery({
    queryKey: ['interest-board'],
    queryFn: async () => (await api.get('/matches/interests')).data as Board,
    retry: false,
  });

  const act = useMutation({
    mutationFn: async ({ id, path }: { id: string; path: string }) =>
      (await api.put(`/matches/${id}/${path}`, {})).data,
    onSuccess: () => {
      setError('');
      // The same interests drive the Matches list and the chat threads, so both
      // are dropped rather than left showing an answer that has changed.
      for (const key of ['interest-board', 'suggestions', 'conversations', 'unread-count']) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (err) => setError(apiMessage(err, 'That could not be done.')),
  });

  const rows = useMemo(() => {
    const list = (data?.[(tab ?? 'received') as keyof Board] as Interest[] | undefined) ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter((row) =>
      [row.counterpart.displayName, row.counterpart.profileCode, row.counterpart.city]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [data, tab, search]);

  const chips = TABS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    count: data?.counts?.[entry.key],
  }));

  const active = TABS.find((entry) => entry.key === tab);

  return (
    <>
      <ListScreen
        header={
          <>
            <View style={{ gap: space(1), marginTop: space(4) }}>
              <PageTitle>Interests</PageTitle>
              <PageSubtitle>
                Who has asked about you, who you have asked, and what came of each one.
              </PageSubtitle>
            </View>

            {error ? <Alert tone="critical">{error}</Alert> : null}

            <FilterChips options={chips} value={tab} onChange={(key) => setTab(key ?? 'received')} />

            <Field
              label="Search"
              value={search}
              onChangeText={setSearch}
              placeholder="Name, profile code or city"
              autoCapitalize="none"
              autoCorrect={false}
            />

            {data?.profileId ? (
              <Caption tone="faint">
                Last updated {formatDate(new Date().toISOString())}
              </Caption>
            ) : null}
          </>
        }
        data={rows}
        keyExtractor={(row) => row.id}
        loading={isPending}
        refreshing={isFetching && !isPending}
        onRefresh={() => void refetch()}
        emptyTitle="Nothing here"
        emptyBody={active?.empty}
        renderItem={(row) => (
          <InterestRow
            interest={row}
            busy={act.isPending}
            onOpenProfile={() =>
              router.push({ pathname: '/match/[id]', params: { id: row.counterpart.id } })
            }
            onAct={(path) => {
              // Both of these are hard to undo — one takes back a message
              // somebody may have read, the other is permanent — so they ask.
              if (path === 'withdraw' || path === 'block') {
                setConfirm({ row, kind: path });
                return;
              }
              act.mutate({ id: row.id, path });
            }}
          />
        )}
      />

      <PromptSheet
        visible={confirm !== null}
        title={
          confirm?.kind === 'block'
            ? `Block ${confirm.row.counterpart.displayName}?`
            : 'Take this interest back?'
        }
        message={
          confirm?.kind === 'block'
            ? 'They will not appear again in either of your lists, and are not told why. This cannot be undone from here.'
            : 'Your interest will be withdrawn. You can send it again later.'
        }
        confirmLabel={confirm?.kind === 'block' ? 'Block' : 'Withdraw'}
        // Nothing to type: the decision is the whole of the answer.
        input={false}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) act.mutate({ id: confirm.row.id, path: confirm.kind });
          setConfirm(null);
        }}
      />
    </>
  );
}

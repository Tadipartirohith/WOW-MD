import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { hhmm } from '@/lib/format';
import { useActiveListing } from '@/lib/vendor-listing';
import { DAY_STATE_LABEL, Permission, SLOT_STATE_LABEL, can } from '@/shared/permissions';
import { MonthCalendar, formatLongDate, todayIso, type DayTone } from '@/components/calendar';
import { Badge, StatTile, TileGrid, type Tone } from '@/components/chrome';
import { PromptSheet } from '@/components/prompt';
import { BusinessSwitcher } from '@/components/business/switcher';
import { NewSlot, SlotRow, type Slot } from '@/components/availability/slots';
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  PageSubtitle,
  PageTitle,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useAuth } from '@/store/auth';
import { useBusinesses } from '@/store/business';
import { space } from '@/theme';

interface Day {
  date: string;
  state: string;
  total: number;
  bookable: number;
  pending: number;
  confirmed: number;
  blocked: number;
  remaining: number;
}

interface Summary {
  from: string;
  to: string;
  totalSlots: number;
  openSlots: number;
  requestedSlots: number;
  bookedSlots: number;
  fullSlots: number;
  blockedSlots: number;
  confirmedBookings: number;
  pendingRequests: number;
}

interface ServiceOption {
  id: string;
  displayName: string | null;
  concurrentCapacity: number;
  definition: { name: string } | null;
}

type Bucket = 'published' | 'open' | 'requested' | 'booked' | 'full' | 'blocked';

const BUCKET_TITLE: Record<Bucket, string> = {
  published: 'Every window published',
  open: 'Windows that can take another booking',
  requested: 'Windows with requests waiting on you',
  booked: 'Windows with confirmed bookings',
  full: 'Windows at capacity',
  blocked: 'Windows you have blocked',
};

/** The calendar's day colours, as the server names its day states. */
const DAY_TONE: Record<string, DayTone> = {
  available: 'available',
  partially_booked: 'partially_booked',
  fully_booked: 'fully_booked',
  blocked: 'blocked',
  no_availability: 'none',
};

/**
 * The provider's calendar.
 *
 * Availability is time slots on dates, not whole days — a photographer sells a
 * morning and an evening on the same Saturday, and a caterer sells the same
 * afternoon to five families at once. The window rolls six months from today and
 * is computed, never stored.
 *
 * `remaining`, `state`, `bookable` and `actions` are all computed server-side
 * and read here rather than re-derived, which is the rule this whole screen
 * turns on: a client showing a different answer from the API is how a vendor
 * ends up looking at "2 free" on a window the server will refuse.
 *
 * The one shape change from the web is the calendar. That page draws all six
 * months at once in a three-column grid; here it is one month with arrows,
 * because six stacked grids on a phone is a page nobody reaches the end of and
 * day cells too small to hit.
 */
export default function Availability() {
  const qc = useQueryClient();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isPlanner =
    can(permissions, Permission.PLANNER_LISTING_MANAGE) &&
    !can(permissions, Permission.VENDOR_LISTING_MANAGE);

  const { activeId, businesses } = useBusinesses();
  const { listing: vendorListing } = useActiveListing(activeId);

  const { data: plannerListing } = useQuery({
    queryKey: ['my-planner-listing'],
    queryFn: async () => (await api.get('/wedding-planners/me')).data,
    enabled: isPlanner,
    retry: false,
  });

  /*
   * Which listing's calendar this is, and where it lives.
   *
   * A vendor may hold several businesses and picks one in the switcher; a
   * planner has exactly one and never chooses. Both end up as an id and a base
   * path, and everything below this line is identical for the two — because a
   * planner's week and a caterer's Saturday are the same object, published the
   * same way, blocked for the same reasons.
   */
  const vendorId: string | undefined = isPlanner ? plannerListing?.id : (activeId ?? undefined);
  const listing = isPlanner ? plannerListing : vendorListing;
  const base = isPlanner ? '/wedding-planners' : '/vendors';

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState('');
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [blocking, setBlocking] = useState<Slot | null>(null);

  const { data: window } = useQuery({
    queryKey: ['availability-window'],
    queryFn: async () => (await api.get('/vendors/availability/window')).data,
  });

  const { data: summary } = useQuery<Summary>({
    queryKey: ['availability-summary', vendorId],
    queryFn: async () => (await api.get(`${base}/${vendorId}/availability/summary`)).data,
    enabled: Boolean(vendorId),
  });

  const { data: calendar = [] } = useQuery<Day[]>({
    queryKey: ['availability-calendar', vendorId],
    queryFn: async () => (await api.get(`${base}/${vendorId}/availability/calendar`)).data,
    enabled: Boolean(vendorId),
  });

  const { data: slots = [] } = useQuery<Slot[]>({
    queryKey: ['availability-slots', vendorId],
    queryFn: async () => (await api.get(`${base}/${vendorId}/availability/slots`)).data,
    enabled: Boolean(vendorId),
  });

  // What a summary tile opens. Fetched from the server rather than filtered
  // here, so the tile and the counter above it can never disagree.
  const { data: bucketSlots = [], isFetching: bucketLoading } = useQuery<Slot[]>({
    queryKey: ['availability-bucket', vendorId, bucket],
    queryFn: async () =>
      (await api.get(`${base}/${vendorId}/availability/slots/by/${bucket}`)).data,
    enabled: Boolean(vendorId && bucket),
  });

  // The services a window can be published against. A vendor who has not
  // adopted the catalog simply has none, and publishes without one.
  const { data: services = [] } = useQuery<ServiceOption[]>({
    queryKey: ['vendor-services', vendorId],
    queryFn: async () => (await api.get(`/vendors/${vendorId}/services`)).data,
    enabled: Boolean(vendorId),
    retry: false,
  });

  const byDate = useMemo(() => {
    const map = new Map<string, Day>();
    for (const day of calendar) map.set(day.date, day);
    return map;
  }, [calendar]);

  const daySlots = useMemo(
    () =>
      slots
        .filter((s) => s.date === selected)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [slots, selected],
  );

  // Everything on this screen reads from the server, so one refresh after any
  // change keeps the counters, the calendar and the open tile in step.
  async function act(fn: () => Promise<unknown>, ok?: string) {
    setError('');
    setNotice('');
    try {
      await fn();
      await Promise.all(
        (
          [
            'availability-slots',
            'availability-calendar',
            'availability-summary',
            'availability-bucket',
          ] as const
        ).map((key) => qc.invalidateQueries({ queryKey: [key, vendorId] })),
      );
      if (ok) setNotice(ok);
      return true;
    } catch (err) {
      setError(apiMessage(err, 'That change was not accepted.'));
      return false;
    }
  }

  if (!listing) {
    return (
      <Screen>
        <Header window={window} />
        <EmptyState title="Create your business listing first">
          Availability hangs off a listing, so there is nothing to publish against yet.
        </EmptyState>
      </Screen>
    );
  }

  // Availability opens only once the listing is approved. The server refuses
  // slot changes before then; this explains why rather than erroring.
  if (!listing.isApproved) {
    return (
      <Screen>
        <Header window={window} />
        <Card>
          <SectionTitle>Not open yet</SectionTitle>
          <Body tone="muted">
            Your business is still in verification. Availability opens once an administrator
            approves your listing. Until then you can complete My Business and reach us on Support.
          </Body>
        </Card>
      </Screen>
    );
  }

  const tiles: { key: Bucket; label: string; value: number; hint?: string; tone?: Tone }[] = summary
    ? [
        { key: 'published', label: 'Published', value: summary.totalSlots },
        { key: 'open', label: 'Open', value: summary.openSlots, tone: 'positive' },
        {
          key: 'requested',
          label: 'Requested',
          value: summary.requestedSlots,
          hint: `${summary.pendingRequests} request(s)`,
          tone: 'caution',
        },
        {
          key: 'booked',
          label: 'Booked',
          value: summary.bookedSlots,
          hint: `${summary.confirmedBookings} booking(s)`,
          tone: 'brand',
        },
        { key: 'full', label: 'Full', value: summary.fullSlots },
        { key: 'blocked', label: 'Blocked', value: summary.blockedSlots, tone: 'critical' },
      ]
    : [];

  return (
    <Screen>
      <Header window={window} />
      {businesses.length > 1 ? <BusinessSwitcher /> : null}

      {error ? <Alert tone="critical">{error}</Alert> : null}
      {notice ? <Alert tone="positive">{notice}</Alert> : null}

      {tiles.length > 0 && (
        <TileGrid>
          {tiles.map((tile) => (
            <StatTile
              key={tile.key}
              label={tile.label}
              value={tile.value}
              hint={tile.hint ?? (bucket === tile.key ? 'Showing below' : 'Show these')}
              tone={tile.tone}
              active={bucket === tile.key}
              onPress={() => setBucket(bucket === tile.key ? null : tile.key)}
            />
          ))}
        </TileGrid>
      )}

      {bucket && (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
            <SectionTitle style={{ flex: 1 }}>{BUCKET_TITLE[bucket]}</SectionTitle>
            <Button label="Close" variant="ghost" small onPress={() => setBucket(null)} />
          </View>
          <Caption tone="faint">
            {bucketLoading ? 'Loading…' : `${bucketSlots.length} window(s)`}
          </Caption>
          {bucketSlots.map((slot) => (
            <Button
              key={slot.id}
              label={`${formatLongDate(slot.date)} · ${hhmm(slot.startTime)}–${hhmm(slot.endTime)}`}
              variant="ghost"
              small
              onPress={() => {
                setSelected(slot.date);
                setBucket(null);
              }}
            />
          ))}
          {!bucketLoading && bucketSlots.length === 0 ? (
            <Caption tone="faint">Nothing in this group right now.</Caption>
          ) : null}
        </Card>
      )}

      <Card>
        <MonthCalendar
          from={window?.from ?? todayIso()}
          to={window?.to}
          selected={selected || undefined}
          onSelect={setSelected}
          toneFor={(date) => DAY_TONE[byDate.get(date)?.state ?? 'no_availability'] ?? 'none'}
          legend
        />
      </Card>

      {selected ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
            <SectionTitle style={{ flex: 1 }}>{formatLongDate(selected)}</SectionTitle>
            <Badge>{DAY_STATE_LABEL[byDate.get(selected)?.state ?? 'no_availability']}</Badge>
          </View>

          {daySlots.map((slot) => (
            <SlotRow
              key={slot.id}
              slot={slot}
              stateLabel={SLOT_STATE_LABEL[slot.state]}
              onSave={(body) =>
                act(
                  () => api.put(`${base}/${vendorId}/availability/slots/${slot.id}`, body),
                  'Slot updated.',
                )
              }
              onUnblock={() =>
                act(
                  () =>
                    api.post(`${base}/${vendorId}/availability/slots/${slot.id}/unblock`, {}),
                  'Back on sale.',
                )
              }
              onBlock={() => setBlocking(slot)}
              onDelete={() =>
                act(
                  () => api.delete(`${base}/${vendorId}/availability/slots/${slot.id}`),
                  'Window withdrawn.',
                )
              }
            />
          ))}
          {daySlots.length === 0 ? (
            <Caption tone="faint">Nothing published on this date yet.</Caption>
          ) : null}

          <NewSlot
            date={selected}
            services={services}
            onCreate={(body) =>
              act(
                () => api.post(`${base}/${vendorId}/availability/slots`, body),
                'Window published.',
              )
            }
          />
        </Card>
      ) : (
        <Caption tone="faint">Pick a date to see its windows or publish a new one.</Caption>
      )}

      <PromptSheet
        visible={blocking !== null}
        title="Why is this window unavailable?"
        message="Blocking takes it off sale without withdrawing it, so it can come back."
        placeholder="Already committed elsewhere"
        confirmLabel="Block"
        minLength={1}
        onCancel={() => setBlocking(null)}
        onConfirm={(reason) => {
          const slot = blocking;
          setBlocking(null);
          if (!slot) return;
          void act(
            () =>
              api.post(`${base}/${vendorId}/availability/slots/${slot.id}/block`, { reason }),
            'Blocked.',
          );
        }}
      />
    </Screen>
  );
}

function Header({ window }: { window?: { from: string; to: string } }) {
  return (
    <View style={{ gap: space(1), marginTop: space(4) }}>
      <PageTitle>Availability</PageTitle>
      <PageSubtitle>
        {window ? `Bookable from ${window.from} to ${window.to}. ` : 'Rolling six-month window. '}
        Publish the windows you can actually take work in. A window stays open until you accept a
        job. A request on its own takes nothing.
      </PageSubtitle>
    </View>
  );
}

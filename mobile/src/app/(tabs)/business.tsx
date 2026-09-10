import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CaretRight, CheckCircle, CircleIcon, Storefront } from 'phosphor-react-native';

import { BUSINESS_STATUS_LABEL, businessTone, categoryLabel, isVerifiedLive } from '@/lib/business-status';
import { shortDate } from '@/lib/format';
import { useActiveListing } from '@/lib/vendor-listing';
import { CORRECTION_FIELD_LABELS } from '@/shared/permissions';
import { Badge, DetailGrid, DetailRow, Divider } from '@/components/chrome';
import { BusinessSwitcher } from '@/components/business/switcher';
import { useCompletion } from '@/components/business/completion';
import { RequestChange } from '@/components/business/request-change';
import { DocumentList, MediaStrip } from '@/components/uploader';
import {
  Body,
  Button,
  Caption,
  Card,
  Eyebrow,
  Loading,
  PageSubtitle,
  PageTitle,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useBusinesses } from '@/store/business';
import { rgb, space, useTheme } from '@/theme';

/**
 * My Business.
 *
 * The web client's ProviderConsole, which is the vendor's shop window and only
 * that: the calendar, the work coming in and the money each have their own
 * module, and none of them belongs here.
 *
 * The difference on a phone is where the guided sequence lives. On the web the
 * three steps — Business Details, Catalog & Services, Review & Submit — are
 * rendered in place, with a row of chips swapping one long form for another. A
 * phone has room for one thing at a time, so this screen is the summary and
 * each step is a real push onto the stack: the header gets a back button that
 * means what it says, and a half-filled form cannot be lost by pressing chip
 * two. Same steps, same order, same server rules carried between them.
 */
export default function MyBusiness() {
  const theme = useTheme();
  const router = useRouter();
  const { activeId, isLoading } = useBusinesses();
  const { listing, isPending } = useActiveListing(activeId);
  const { data: completion } = useCompletion(activeId);

  const rejected = listing?.status === 'rejected';
  const locked = completion ? !completion.rules.editIdentity : false;
  const presentationalOnly = locked && (completion?.rules.editPresentational ?? false);

  // Which steps are done, from the server's own checklist rather than a guess
  // at what the form holds. `identity` and `catalog` are the keys completion()
  // reports; anything it does not report simply has no tick.
  const done = (prefix: string) =>
    (completion?.items ?? []).some((item) => item.key.startsWith(prefix) && item.complete);

  if (isLoading || isPending) {
    return (
      <Screen>
        <Header />
        <Loading rows={3} />
      </Screen>
    );
  }

  // Signing up made an account. A listing is the thing couples search, and it
  // has not been written — which nothing used to say.
  if (!listing) {
    return (
      <Screen>
        <Header />
        <Card style={{ gap: space(2) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
            <Storefront size={20} color={rgb(theme.brand)} />
            <SectionTitle style={{ flex: 1 }}>Your business is not listed yet</SectionTitle>
          </View>
          <Body tone="muted">
            Signing up made your account. A listing is the thing couples search, and yours has not
            been written. It takes a few minutes and nothing reaches an administrator until it
            exists.
          </Body>
          <Button label="Create your listing" onPress={() => router.push('/business-details')} />
        </Card>
      </Screen>
    );
  }

  // A rejected listing is locked: no set-up, no availability, no services —
  // only the way to contact support. The backend enforces this too, so a hidden
  // form is not the whole of the restriction.
  if (rejected) {
    return (
      <Screen>
        <Header />
        <BusinessSwitcher />
        <Card style={{ gap: space(2.5) }}>
          <SectionTitle style={{ color: rgb(theme.criticalFg) }}>
            This listing was rejected
          </SectionTitle>
          {listing.decisionReason ? <Body>{listing.decisionReason}</Body> : null}
          <Body tone="muted">
            The account is locked while it is rejected — Business Details, Services, Availability
            and Bookings cannot be changed. If you think this is a mistake, raise it on Support.
          </Body>
          <Caption tone="faint">
            Support is on the web app for now; this screen does not raise a case on its own.
          </Caption>
        </Card>
      </Screen>
    );
  }

  const steps = [
    {
      key: 'business',
      label: 'Business Details',
      hint: 'Who you are, where you trade, and the papers behind it',
      complete: done('identity') || done('business'),
      href: '/business-details' as const,
    },
    {
      key: 'catalog',
      label: 'Catalog & Services',
      hint: 'What you sell, what it costs, and how many you can run at once',
      complete: done('catalog') || done('service'),
      href: '/business-services' as const,
    },
    // Once verified or live there is nothing left to submit, so the step is
    // dropped rather than shown with a stale "being verified" note.
    ...(isVerifiedLive(listing.status)
      ? []
      : [
          {
            key: 'review',
            label: 'Review & Submit',
            hint: 'Read it over, then send it for verification',
            complete: false,
            href: '/business-review' as const,
          },
        ]),
  ];

  return (
    <Screen>
      <Header />
      <BusinessSwitcher />

      {/*
        The officer's own words when a listing is sent back — the vendor cannot
        fix what nobody named. Read from the owner-only route, so a competitor
        cannot look it up.
      */}
      {listing.decisionReason ? (
        <Card style={{ backgroundColor: rgb(theme.cautionBg), borderColor: rgb(theme.cautionBg) }}>
          <Eyebrow>
            {(listing.correctionFields?.length ?? 0) > 0 ? 'Correction required' : 'What needs fixing'}
          </Eyebrow>
          <Body style={{ color: rgb(theme.cautionFg) }}>{listing.decisionReason}</Body>
          {/*
            When the send-back was targeted, name the fields the vendor may
            edit. The lock on everything else is enforced by the server; this
            only says which fields are open so the vendor is not hunting.
          */}
          {(listing.correctionFields?.length ?? 0) > 0 && (
            <View style={{ gap: space(1.5), marginTop: space(1) }}>
              <Caption style={{ color: rgb(theme.cautionFg) }}>You can edit only:</Caption>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5) }}>
                {listing.correctionFields!.map((field) => (
                  <Badge key={field} tone="caution">
                    {CORRECTION_FIELD_LABELS[field] ?? field}
                  </Badge>
                ))}
              </View>
            </View>
          )}
        </Card>
      ) : null}

      {/* Where the listing stands, and what it is. */}
      <Card>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: space(2),
          }}
        >
          <View style={{ flex: 1, gap: space(0.5) }}>
            <SectionTitle numberOfLines={2}>{listing.name}</SectionTitle>
            <Caption>
              {categoryLabel(listing.category, listing.otherCategory)}
              {listing.city ? ` · ${listing.city}` : ''}
            </Caption>
          </View>
          <Badge tone={businessTone(listing.status)}>
            {listing.isApproved
              ? 'Live in search'
              : (BUSINESS_STATUS_LABEL[listing.status] ?? listing.status)}
          </Badge>
        </View>
        {listing.description ? (
          <Body tone="muted" style={{ marginTop: space(1) }}>
            {listing.description}
          </Body>
        ) : null}
      </Card>

      {/* The sequence. Each row pushes the step that owns it. */}
      <View style={{ gap: space(1) }}>
        <SectionTitle>Set-up</SectionTitle>
        <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
          {steps.map((step, i) => (
            <StepRow
              key={step.key}
              first={i === 0}
              label={`${i + 1}. ${step.label}`}
              hint={step.hint}
              complete={step.complete}
              onPress={() => router.push(step.href)}
            />
          ))}
        </Card>
      </View>

      {/* The record itself, read-only. A vendor opening this screen wants to
          check what the platform is telling clients about them, and a screen
          that only ever offers an edit form makes that check look like an
          invitation to change something. */}
      <Card>
        <SectionTitle>The record</SectionTitle>
        <Caption tone="faint">
          {locked
            ? presentationalOnly
              ? 'The verified details are locked. About, contact and photos are still yours to change.'
              : 'Locked while it is verified.'
            : 'Open for editing under Business Details.'}
        </Caption>
        <Divider />
        <DetailGrid>
          <DetailRow label="GST number">{listing.gstNumber ?? 'Not provided'}</DetailRow>
          <DetailRow label="PAN">{listing.panNumber ?? 'Not provided'}</DetailRow>
          <DetailRow label="Registration number">
            {listing.registrationNumber ?? 'Not provided'}
          </DetailRow>
          <DetailRow label="Trading since">
            {listing.tradingSince ? shortDate(listing.tradingSince) : 'Not provided'}
          </DetailRow>
          <DetailRow label="Registered address">
            {listing.registeredAddress ?? 'Not provided'}
          </DetailRow>
          <DetailRow label="Contact number">{listing.contactPhone ?? 'Not provided'}</DetailRow>
        </DetailGrid>

        {(listing.portfolio?.length ?? 0) > 0 && (
          <>
            <Divider />
            <Caption tone="faint">Portfolio ({listing.portfolio.length})</Caption>
            <MediaStrip urls={listing.portfolio} />
          </>
        )}

        {(listing.complianceDocuments?.length ?? 0) > 0 && (
          <>
            <Divider />
            <Caption tone="faint">
              Compliance documents ({listing.complianceDocuments.length})
            </Caption>
            <DocumentList urls={listing.complianceDocuments} />
          </>
        )}
      </Card>

      {/*
        The verified details are locked, but a business does move — a firm
        re-registers, an address changes. Rather than a dead editable input, the
        vendor raises the change and the team reopens the listing through the
        same correction path an officer uses.
      */}
      {presentationalOnly ? <RequestChange vendorId={listing.id} /> : null}
    </Screen>
  );
}

function Header() {
  return (
    <View style={{ gap: space(1), marginTop: space(4) }}>
      <PageTitle>My Business</PageTitle>
      <PageSubtitle>
        Your shop window: who you are, what you sell and what it costs. Your calendar and the work
        coming in have their own tabs. This one is only about the business.
      </PageSubtitle>
    </View>
  );
}

/**
 * One step of the sequence.
 *
 * A row rather than a chip, because a row has space for what the step is for.
 * The web client's chips carry only a number and a name, which works next to
 * the form they open and not on a screen where the form is elsewhere.
 */
function StepRow({
  first,
  label,
  hint,
  complete,
  onPress,
}: {
  first: boolean;
  label: string;
  hint: string;
  complete: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${complete ? 'Done' : 'Not done'}`}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space(3),
          paddingHorizontal: space(4),
          paddingVertical: space(3.5),
          minHeight: 64,
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: rgb(theme.border),
        },
        pressed && { backgroundColor: rgb(theme.surfaceSunken) },
      ]}
    >
      {complete ? (
        <CheckCircle size={20} weight="fill" color={rgb(theme.positiveFg)} />
      ) : (
        <CircleIcon size={20} color={rgb(theme.ink[300])} />
      )}
      <View style={{ flex: 1, gap: space(0.5) }}>
        <Body>{label}</Body>
        <Caption tone="faint">{hint}</Caption>
      </View>
      <CaretRight size={16} color={rgb(theme.ink[400])} />
    </Pressable>
  );
}

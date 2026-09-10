import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { categoryLabel } from '@/lib/business-status';
import { shortDate } from '@/lib/format';
import { priceLabel } from '@/lib/pricing';
import { useActiveListing } from '@/lib/vendor-listing';
import { DetailGrid, DetailRow, Divider } from '@/components/chrome';
import { BusinessChecklist } from '@/components/business/completion';
import { DocumentList, MediaStrip } from '@/components/uploader';
import {
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Loading,
  PageSubtitle,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useBusinesses } from '@/store/business';
import { rgb, radius, space, useTheme } from '@/theme';

/** A vendor service and its priced offerings, as the review reads them. */
interface ReviewService {
  id: string;
  displayName: string | null;
  description: string | null;
  definition: { name?: string } | null;
  category: { name?: string } | null;
  offerings: {
    id: string;
    name: string;
    pricingModel: string;
    price: string | null;
    currency: string;
    unitLabel: string | null;
  }[];
}

/**
 * Review & Submit — step three of My Business.
 *
 * The whole submission, read-only, and then the gate. Both halves matter: the
 * review is the vendor reading their own listing while they can still change
 * it, and the submission is the moment it locks and an officer is sent. The web
 * client keeps them as separate presses for that reason, and so does this.
 *
 * What is shown is the submission itself rather than a count of it — the actual
 * photographs, each document by name, every service with its prices. A vendor
 * about to lock their listing for a field visit is entitled to see what the
 * officer will see, not "2 Services / 3 Documents".
 */
export default function BusinessReview() {
  const theme = useTheme();
  const router = useRouter();
  const { activeId } = useBusinesses();
  const { listing, isPending } = useActiveListing(activeId);

  const { data: services = [] } = useQuery<ReviewService[]>({
    queryKey: ['vendor-services', activeId],
    queryFn: async () => (await api.get(`/vendors/${activeId}/services`)).data,
    enabled: Boolean(activeId),
    retry: false,
  });

  if (isPending) {
    return (
      <Screen>
        <Loading rows={4} />
      </Screen>
    );
  }

  if (!listing) {
    return (
      <Screen>
        <EmptyState title="There is nothing to review yet">
          Create your listing first, then come back here to read it over.
        </EmptyState>
      </Screen>
    );
  }

  const portfolio = listing.portfolio ?? [];
  const documents = listing.complianceDocuments ?? [];

  return (
    <Screen>
      <View style={{ gap: space(1) }}>
        <PageSubtitle>
          Everything you have entered, read-only. Go back to change anything, then submit for
          verification below.
        </PageSubtitle>
      </View>

      <Card>
        <SectionTitle>The business</SectionTitle>
        <Divider />
        <DetailGrid>
          <DetailRow label="Business name">{listing.name}</DetailRow>
          <DetailRow label="Category">
            {categoryLabel(listing.category, listing.otherCategory)}
          </DetailRow>
          <DetailRow label="City">{listing.city || 'Not provided'}</DetailRow>
          <DetailRow label="PAN">{listing.panNumber ?? 'Not provided'}</DetailRow>
          <DetailRow label="GST number">{listing.gstNumber ?? 'Not provided'}</DetailRow>
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

        {listing.description ? (
          <>
            <Divider />
            <DetailRow label="Description">{listing.description}</DetailRow>
          </>
        ) : null}
      </Card>

      {/* The actual portfolio images, not a count of them. */}
      <Card>
        <SectionTitle>Portfolio ({portfolio.length})</SectionTitle>
        {portfolio.length > 0 ? (
          <MediaStrip urls={portfolio} />
        ) : (
          <Caption style={{ color: rgb(theme.cautionFg) }}>No photos added yet.</Caption>
        )}
      </Card>

      {/* Each compliance document by name. */}
      <Card>
        <SectionTitle>Compliance documents ({documents.length})</SectionTitle>
        {documents.length > 0 ? (
          <DocumentList urls={documents} />
        ) : (
          <Caption style={{ color: rgb(theme.cautionFg) }}>No documents uploaded yet.</Caption>
        )}
      </Card>

      {/* Catalogs, services and their priced offerings in full. */}
      {services.length > 0 && (
        <Card>
          <SectionTitle>Catalog & services ({services.length})</SectionTitle>
          {services.map((service) => (
            <View
              key={service.id}
              style={{
                backgroundColor: rgb(theme.surfaceSunken),
                borderRadius: radius.sm,
                padding: space(3),
                gap: space(1),
              }}
            >
              <Body>{service.displayName ?? service.definition?.name ?? 'Service'}</Body>
              {service.category?.name ? (
                <Caption tone="faint">{service.category.name}</Caption>
              ) : null}
              {service.description ? <Caption>{service.description}</Caption> : null}
              {service.offerings.length > 0 ? (
                <View style={{ gap: space(0.5), marginTop: space(1) }}>
                  {service.offerings.map((offering) => (
                    <View
                      key={offering.id}
                      style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(3) }}
                    >
                      <Body style={{ flex: 1 }} numberOfLines={2}>
                        {offering.name}
                      </Body>
                      <Caption style={{ fontVariant: ['tabular-nums'] }}>
                        {priceLabel(offering)}
                      </Caption>
                    </View>
                  ))}
                </View>
              ) : (
                <Caption tone="faint">No offerings priced yet.</Caption>
              )}
            </View>
          ))}
        </Card>
      )}

      {/*
        The checklist and the two-step Submit for Verification are the server's,
        reused verbatim: it decides what is still missing and locks the listing
        on submit.
      */}
      {activeId ? <BusinessChecklist businessId={activeId} /> : null}

      <Button
        label="Edit business details"
        variant="outline"
        onPress={() => router.push('/business-details')}
      />
    </Screen>
  );
}

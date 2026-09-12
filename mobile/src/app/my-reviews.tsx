import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Star } from 'phosphor-react-native';

import { api } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { BusinessSwitcher } from '@/components/business/switcher';
import {
  Body,
  Caption,
  Card,
  EmptyState,
  Loading,
  PageSubtitle,
  Screen,
} from '@/components/ui';
import { useBusinesses } from '@/store/business';
import { rgb, space, useTheme } from '@/theme';

/**
 * A vendor's own reviews (EZ1-I103), on a phone.
 *
 * Each one shows the service, the package and the booking it is about, its
 * rating, its comment and its date. The reviewer is never named — a vendor who
 * could work out which customer left three stars could take it up with them,
 * and the prospect of that conversation is what stops the next honest review
 * being written.
 */
interface OwnerReview {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
  bookingId: string | null;
  serviceName: string | null;
  offeringName: string | null;
}

export default function MyReviews() {
  const { activeId } = useBusinesses();

  const { data, isPending } = useQuery({
    queryKey: ['my-reviews', activeId],
    enabled: Boolean(activeId),
    queryFn: async () => (await api.get(`/vendors/${activeId}/reviews/mine`)).data as OwnerReview[],
    retry: false,
  });

  const reviews = data ?? [];

  return (
    <Screen>
      <PageSubtitle>
        What customers said after a completed booking. Names are left out, and you cannot edit or
        remove a review — if one breaks the rules, raise it on Support.
      </PageSubtitle>

      <BusinessSwitcher />

      {!activeId ? (
        <Card>
          <Caption tone="faint">Pick a business above to see its reviews.</Caption>
        </Card>
      ) : isPending ? (
        <Loading rows={3} />
      ) : reviews.length === 0 ? (
        <EmptyState title="No reviews yet">
          A review can only be written after a booking is completed, so these arrive with the work.
        </EmptyState>
      ) : (
        reviews.map((review) => (
          <Card key={review.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
              <Stars rating={review.rating} />
              <Caption tone="faint" style={{ flex: 1, textAlign: 'right' }}>
                {shortDate(review.createdAt)}
              </Caption>
            </View>
            <Caption tone="faint">
              {[
                review.serviceName ? `Service: ${review.serviceName}` : null,
                review.offeringName ? `Package: ${review.offeringName}` : null,
                review.bookingId ? `Booking ${review.bookingId.slice(0, 8)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Caption>
            {review.comment ? (
              <Body tone="muted">{review.comment}</Body>
            ) : (
              <Caption tone="faint">Rated, with nothing written.</Caption>
            )}
          </Card>
        ))
      )}
    </Screen>
  );
}

function Stars({ rating }: { rating: number }) {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel={`${rating} out of 5`}
      style={{ flexDirection: 'row', gap: space(0.5) }}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={15}
          weight={star <= rating ? 'fill' : 'regular'}
          color={rgb(star <= rating ? theme.cautionFg : theme.ink[300])}
        />
      ))}
    </View>
  );
}

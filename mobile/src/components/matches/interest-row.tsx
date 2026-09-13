import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { SealCheck } from 'phosphor-react-native';

import { formatDate } from '@/shared/dates';
import { Badge, type Tone } from '@/components/chrome';
import { Button, Caption, Card, SectionTitle } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * One interest, either way round (EZ1-I261).
 *
 * The buttons are the server's: `actions` travels with the row, because what a
 * person may do depends on the status *and* on which side of it they are, and
 * two rows that look identical can allow different things. This renders what
 * came back rather than deciding it again.
 */
export interface Interest {
  id: string;
  status: string;
  createdAt: string;
  direction: 'incoming' | 'outgoing';
  counterpart: {
    id: string;
    displayName: string;
    city: string | null;
    ageRange: string | null;
    gender: string | null;
    photos?: string[];
    photoUrl?: string | null;
    profileCode?: string | null;
    verified?: boolean;
  };
  actions: { accept: boolean; decline: boolean; unsend: boolean; block: boolean };
  acceptedBy: { displayName: string; mine: boolean } | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting',
  accepted: 'Accepted',
  rejected: 'Declined',
  withdrawn: 'Withdrawn',
  unmatched: 'Ended',
  blocked: 'Blocked',
};

const STATUS_TONE: Record<string, Tone> = {
  pending: 'caution',
  accepted: 'positive',
  rejected: 'neutral',
  withdrawn: 'neutral',
  unmatched: 'neutral',
  blocked: 'critical',
};

export function InterestRow({
  interest,
  busy,
  onAct,
  onOpenProfile,
}: {
  interest: Interest;
  busy: boolean;
  onAct: (path: 'accept' | 'decline' | 'withdraw' | 'block') => void;
  onOpenProfile: () => void;
}) {
  const theme = useTheme();
  const { counterpart: them, actions } = interest;
  const photo = them.photos?.[0] ?? them.photoUrl ?? null;
  const facts = [them.ageRange, them.city, them.gender].filter(Boolean).join(' · ');

  return (
    <Card>
      {/* The whole head opens the profile: a row about a person that does
          nothing when pressed reads as broken. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${them.displayName}, open this profile`}
        onPress={onOpenProfile}
        style={({ pressed }) => [
          { flexDirection: 'row', alignItems: 'center', gap: space(3) },
          pressed && { opacity: 0.6 },
        ]}
      >
        {photo ? (
          <Image
            source={{ uri: photo }}
            style={{
              width: 52,
              height: 52,
              borderRadius: radius.md,
              backgroundColor: rgb(theme.surfaceSunken),
            }}
            contentFit="cover"
          />
        ) : (
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: radius.md,
              backgroundColor: rgb(theme.surfaceSunken),
            }}
          />
        )}
        <View style={{ flex: 1, gap: space(0.5) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
            <SectionTitle numberOfLines={1} style={{ flexShrink: 1 }}>
              {them.displayName}
            </SectionTitle>
            {/* An officer has met this person. It is the one fact on the row
                that is not self-reported. */}
            {them.verified ? <SealCheck size={15} color={rgb(theme.brandStrong)} weight="fill" /> : null}
          </View>
          {facts ? <Caption tone="faint">{facts}</Caption> : null}
          {them.profileCode ? <Caption tone="faint">{them.profileCode}</Caption> : null}
        </View>
      </Pressable>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space(1.5) }}>
        <Badge tone={STATUS_TONE[interest.status] ?? 'neutral'}>
          {STATUS_LABEL[interest.status] ?? interest.status}
        </Badge>
        <Badge>{interest.direction === 'incoming' ? 'They asked' : 'You asked'}</Badge>
        <Caption tone="faint">{formatDate(interest.createdAt)}</Caption>
      </View>

      {/* Who said yes, when one side has. The web page says it too: on an
          accepted row it is the difference between "they agreed" and "you did". */}
      {interest.acceptedBy ? (
        <Caption tone="muted">
          {interest.acceptedBy.mine
            ? 'You accepted this.'
            : `${interest.acceptedBy.displayName} accepted this.`}
        </Caption>
      ) : null}

      {actions.accept || actions.decline || actions.unsend || actions.block ? (
        <View style={{ gap: space(2) }}>
          {actions.accept ? (
            <Button label="Accept" disabled={busy} onPress={() => onAct('accept')} />
          ) : null}
          <View style={{ flexDirection: 'row', gap: space(2) }}>
            {actions.decline ? (
              <Button
                label="Decline"
                variant="outline"
                disabled={busy}
                style={{ flex: 1 }}
                onPress={() => onAct('decline')}
              />
            ) : null}
            {actions.unsend ? (
              <Button
                label="Withdraw"
                variant="outline"
                disabled={busy}
                style={{ flex: 1 }}
                onPress={() => onAct('withdraw')}
              />
            ) : null}
            {actions.block ? (
              <Button
                label="Block"
                variant="ghost"
                disabled={busy}
                style={{ flex: 1 }}
                onPress={() => onAct('block')}
              />
            ) : null}
          </View>
        </View>
      ) : null}
    </Card>
  );
}

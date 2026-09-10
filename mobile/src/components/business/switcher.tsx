import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CaretUpDown, Check } from 'phosphor-react-native';

import { BUSINESS_STATUS_LABEL, businessTone, categoryLabel } from '@/lib/business-status';
import { Badge } from '@/components/chrome';
import { Sheet } from '@/components/sheet';
import { Body, Caption } from '@/components/ui';
import { useBusinesses } from '@/store/business';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * Which business the provider screens are about.
 *
 * The web client puts this in the page header, where it is always on screen. A
 * phone has no such header to spare, so it sits at the top of each provider
 * screen instead — and only when there is a choice to make. An account with one
 * business is the overwhelming case, and a switcher offering it its only option
 * is a control that does nothing but take up the space above the content.
 */
export function BusinessSwitcher() {
  const theme = useTheme();
  const { businesses, activeId, active, setBusinessId } = useBusinesses();
  const [open, setOpen] = useState(false);

  if (businesses.length < 2 || !active) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Business: ${active.name}. Change`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: space(2.5),
            backgroundColor: rgb(theme.surfaceSunken),
            borderRadius: radius.md,
            paddingHorizontal: space(3),
            paddingVertical: space(2.5),
            minHeight: 52,
          },
          pressed && { opacity: 0.75 },
        ]}
      >
        <View style={{ flex: 1, gap: space(0.5) }}>
          <Caption tone="faint">Business</Caption>
          <Body numberOfLines={1}>{active.name}</Body>
        </View>
        <CaretUpDown size={18} color={rgb(theme.ink[500])} />
      </Pressable>

      <Sheet visible={open} title="Which business?" onClose={() => setOpen(false)}>
        <Caption>
          Each business keeps its own catalog, calendar, bookings and money. The choice holds across
          every screen until you change it.
        </Caption>
        <View>
          {businesses.map((business, i) => {
            const current = business.id === activeId;
            return (
              <Pressable
                key={business.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: current }}
                onPress={() => {
                  setBusinessId(business.id);
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space(3),
                    paddingVertical: space(3),
                    borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: rgb(theme.border),
                    minHeight: 56,
                  },
                  pressed && { backgroundColor: rgb(theme.surfaceSunken) },
                ]}
              >
                <View style={{ flex: 1, gap: space(1) }}>
                  <Body numberOfLines={1}>{business.name}</Body>
                  <Caption tone="faint" numberOfLines={1}>
                    {categoryLabel(business.category)}
                  </Caption>
                </View>
                <Badge tone={businessTone(business.status)}>
                  {business.isApproved
                    ? 'Live in search'
                    : (BUSINESS_STATUS_LABEL[business.status] ?? business.status)}
                </Badge>
                {current ? <Check size={18} weight="bold" color={rgb(theme.brandStrong)} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </>
  );
}

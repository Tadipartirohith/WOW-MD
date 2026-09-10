import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Body, Caption, SectionTitle } from '@/components/ui';
import { radius, rgb, space, useTheme, type Theme } from '@/theme';

/**
 * The pieces the vendor and officer portals are assembled from.
 *
 * Each one is the native rendering of something the web client already draws:
 * the status pill on a listing, the filter row above a queue, the clickable
 * figure on a dashboard, the definition list under a heading. They live here
 * rather than in ui.tsx because that file is the general primitive layer and
 * these are the portal vocabulary — but the names match the web app's so a
 * reader moving between the two is reading about the same thing.
 */

// ----------------------------------------------------------------- badges --

export type Tone = 'neutral' | 'brand' | 'positive' | 'caution' | 'critical';

function toneColours(theme: Theme, tone: Tone): { bg: string; fg: string } {
  switch (tone) {
    case 'brand':
      return { bg: rgb(theme.brandSoft), fg: rgb(theme.brandStrong) };
    case 'positive':
      return { bg: rgb(theme.positiveBg), fg: rgb(theme.positiveFg) };
    case 'caution':
      return { bg: rgb(theme.cautionBg), fg: rgb(theme.cautionFg) };
    case 'critical':
      return { bg: rgb(theme.criticalBg), fg: rgb(theme.criticalFg) };
    default:
      return { bg: rgb(theme.surfaceSunken), fg: rgb(theme.ink[600]) };
  }
}

/** Where something stands, said in a word. The web client's rounded-full pill. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const theme = useTheme();
  const { bg, fg } = toneColours(theme, tone);
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: space(2), paddingVertical: space(1) }}>
      <Text style={{ fontSize: 12, fontWeight: '500', color: fg }}>{children}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ chips --

export interface ChipOption {
  key: string;
  label: string;
  /** Shown beside the label. Undefined means the count is not known yet. */
  count?: number;
}

/**
 * The filter row above a queue.
 *
 * Horizontally scrollable rather than wrapped: the web client wraps these onto
 * two or three lines, which on a phone would push the list itself off the
 * screen. Scrolling keeps the queue where it was and the row one line tall, and
 * a chip with nothing in it is dimmed rather than hidden so the set of filters
 * does not change shape as work moves through it.
 */
export function FilterChips({
  options,
  value,
  onChange,
}: {
  options: ChipOption[];
  /** Null is "no filter", which is what somebody with four rows wants. */
  value: string | null;
  onChange: (key: string | null) => void;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // The row is inset by the screen padding, so the chips start flush with
      // the text above them and the last one can still be scrolled clear.
      contentContainerStyle={{ gap: space(2), paddingVertical: space(0.5) }}
    >
      {options.map((option) => {
        const active = option.key === value;
        const empty = option.count === 0;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(active ? null : option.key)}
            style={({ pressed }) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: space(1.5),
                borderRadius: 999,
                paddingHorizontal: space(3),
                // 34pt tall: smaller than a button because it is a filter, but
                // still inside what a thumb hits without aiming.
                minHeight: 34,
                justifyContent: 'center',
                backgroundColor: active ? rgb(theme.brand) : rgb(theme.surfaceSunken),
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: active ? rgb(theme.brand) : rgb(theme.border),
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: active ? '600' : '500',
                color: active
                  ? rgb(theme.brandFg)
                  : rgb(empty ? theme.ink[400] : theme.ink[700]),
              }}
            >
              {option.label}
            </Text>
            {option.count !== undefined && (
              <Text
                style={{
                  fontSize: 12,
                  fontVariant: ['tabular-nums'],
                  color: active ? rgb(theme.brandFg) : rgb(theme.ink[400]),
                }}
              >
                {option.count}
              </Text>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ tiles --

/**
 * A figure that opens what it counts.
 *
 * The web dashboard's StatCard, and the same rule: a number nobody can act on
 * is decoration. An absent value draws a dash rather than a nought, because
 * nought is a fact and claiming it before the answer arrives is the small lie
 * that makes somebody stop trusting the screen.
 */
export function StatTile({
  label,
  value,
  hint,
  tone,
  active,
  onPress,
  style,
}: {
  label: string;
  value: string | number | undefined;
  hint?: string;
  tone?: Tone;
  /** Drawn as selected, for a tile that is also the current filter. */
  active?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const figureColour = tone ? toneColours(theme, tone).fg : rgb(theme.ink[900]);

  const body = (
    <>
      <Caption numberOfLines={1}>{label}</Caption>
      <Text
        style={{
          fontSize: 26,
          fontWeight: '500',
          lineHeight: 30,
          letterSpacing: -0.5,
          fontVariant: ['tabular-nums'],
          color: figureColour,
        }}
      >
        {value ?? '—'}
      </Text>
      {hint ? (
        <Caption tone="faint" numberOfLines={1}>
          {hint}
        </Caption>
      ) : null}
    </>
  );

  const frame: ViewStyle = {
    flex: 1,
    minWidth: 140,
    gap: space(1),
    backgroundColor: rgb(theme.surface),
    borderRadius: radius.lg,
    borderWidth: active ? 1.5 : StyleSheet.hairlineWidth,
    borderColor: rgb(active ? theme.brand : theme.border),
    padding: space(3.5),
  };

  if (!onPress) return <View style={[frame, style]}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [frame, pressed && { opacity: 0.75 }, style]}
    >
      {body}
    </Pressable>
  );
}

/** Tiles two-up, which is as many as a phone fits without shrinking the figure. */
export function TileGrid({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2.5) }}>{children}</View>
  );
}

// ------------------------------------------------------------------- rows --

/**
 * A label and its value, from the web client's definition lists.
 *
 * Stacked rather than side by side: a registered address or a GST number does
 * not fit beside its own label at phone width, and a value that wraps under a
 * right-aligned label is harder to read than one that starts at the margin.
 */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: space(0.5) }}>
      <Caption tone="faint" numberOfLines={1}>
        {label}
      </Caption>
      {typeof children === 'string' || typeof children === 'number' ? (
        <Body>{children}</Body>
      ) : (
        children
      )}
    </View>
  );
}

/** Label/value pairs, two to a line where they fit. */
export function DetailGrid({ children }: { children: ReactNode }) {
  return <View style={{ gap: space(2.5) }}>{children}</View>;
}

export function Divider() {
  const theme = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: rgb(theme.border),
        marginVertical: space(1),
      }}
    />
  );
}

/** The web client's `bg-surface-sunken` explanatory paragraph, e.g. StepIntro. */
export function InfoNote({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: rgb(theme.surfaceSunken),
        borderRadius: radius.sm,
        paddingHorizontal: space(3),
        paddingVertical: space(2.5),
      }}
    >
      <Caption>{children}</Caption>
    </View>
  );
}

/** A heading over a group of cards, matching the web dashboard's section labels. */
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space(2),
        marginTop: space(1),
      }}
    >
      <SectionTitle style={{ flex: 1 }} numberOfLines={1}>
        {title}
      </SectionTitle>
      {action}
    </View>
  );
}

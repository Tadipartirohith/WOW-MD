import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CaretLeft, CaretRight } from 'phosphor-react-native';

import { Caption, SectionTitle } from '@/components/ui';
import { radius, rgb, space, useTheme, type Theme } from '@/theme';

/**
 * The month grid.
 *
 * The web client draws every month of the rolling six-month window at once, in
 * a three-column grid of cards. That is the right shape for a desktop and the
 * wrong one for a phone: six grids stacked vertically is a page nobody scrolls
 * to the bottom of, and the day cells come out too small to hit.
 *
 * So one month, paged. The same information — a day's colour is its state, the
 * legend says what the colours mean — with the window's bounds enforced on the
 * arrows as well as the cells, so a person cannot page to a month they are not
 * allowed to publish in and then find every day disabled.
 */

export type DayTone = 'available' | 'partially_booked' | 'fully_booked' | 'blocked' | 'none';

function toneColours(theme: Theme, tone: DayTone): { bg: string; fg: string; border: string } {
  switch (tone) {
    case 'available':
      return {
        bg: rgb(theme.positiveBg),
        fg: rgb(theme.positiveFg),
        border: rgb(theme.positiveBg),
      };
    case 'partially_booked':
      return { bg: rgb(theme.brandSoft), fg: rgb(theme.brandStrong), border: rgb(theme.brandSoft) };
    case 'fully_booked':
      return {
        bg: rgb(theme.surfaceSunken),
        fg: rgb(theme.ink[600]),
        border: rgb(theme.surfaceSunken),
      };
    case 'blocked':
      return {
        bg: rgb(theme.criticalBg),
        fg: rgb(theme.criticalFg),
        border: rgb(theme.criticalBg),
      };
    default:
      return { bg: 'transparent', fg: rgb(theme.ink[500]), border: 'transparent' };
  }
}

/** `YYYY-MM-DD` for a local date, without going through UTC and losing a day. */
export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function todayIso(): string {
  const now = new Date();
  return isoDate(now.getFullYear(), now.getMonth(), now.getDate());
}

/** The cells of one month, with leading blanks so the first lands on its weekday. */
function monthCells(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array(first.getDay()).fill(null);
  for (let d = 1; d <= days; d += 1) cells.push(isoDate(year, month, d));
  return cells;
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function MonthCalendar({
  from,
  to,
  selected,
  onSelect,
  toneFor,
  legend = false,
}: {
  /** The first selectable date, `YYYY-MM-DD`. Days before it are disabled. */
  from?: string;
  to?: string;
  selected?: string;
  onSelect: (date: string) => void;
  /** A day's state, when the caller has one. Absent draws a plain day. */
  toneFor?: (date: string) => DayTone;
  legend?: boolean;
}) {
  const theme = useTheme();

  // Opened on the selected day's month, or the start of the window, or now —
  // in that order, so returning to this screen lands where the person left it.
  const [cursor, setCursor] = useState(() => {
    const anchor = selected || from || todayIso();
    return { year: Number(anchor.slice(0, 4)), month: Number(anchor.slice(5, 7)) - 1 };
  });

  const cells = useMemo(() => monthCells(cursor.year, cursor.month), [cursor]);

  // Whether a step in either direction stays inside the window. Compared on the
  // last/first day of the neighbouring month rather than its first, so a window
  // that starts mid-month still lets that month be reached.
  const lastOfPrev = isoDate(cursor.year, cursor.month, 1);
  const firstOfNext = isoDate(cursor.year, cursor.month + 1, 1);
  const canGoBack = !from || from < lastOfPrev;
  const canGoOn = !to || (to >= firstOfNext && firstOfNext <= to);

  const step = (by: number) =>
    setCursor((c) => {
      const next = new Date(c.year, c.month + by, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });

  return (
    <View style={{ gap: space(2.5) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
        <SectionTitle style={{ flex: 1 }}>{monthLabel(cursor.year, cursor.month)}</SectionTitle>
        <Stepper label="Previous month" disabled={!canGoBack} onPress={() => step(-1)}>
          <CaretLeft size={18} color={rgb(canGoBack ? theme.ink[700] : theme.ink[300])} />
        </Stepper>
        <Stepper label="Next month" disabled={!canGoOn} onPress={() => step(1)}>
          <CaretRight size={18} color={rgb(canGoOn ? theme.ink[700] : theme.ink[300])} />
        </Stepper>
      </View>

      <View style={{ flexDirection: 'row' }}>
        {WEEKDAYS.map((day, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: rgb(theme.ink[400]) }}>
              {day}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((cell, i) => {
          if (cell === null) {
            // A seventh of the row, so the columns stay aligned with the
            // weekday header whatever the month starts on.
            return <View key={`blank-${i}`} style={{ width: `${100 / 7}%`, height: 44 }} />;
          }
          const outside = (from && cell < from) || (to && cell > to);
          const tone = toneFor?.(cell) ?? 'none';
          const { bg, fg, border } = toneColours(theme, tone);
          const isSelected = cell === selected;

          return (
            <View key={cell} style={{ width: `${100 / 7}%`, height: 44, padding: 2 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={cell}
                accessibilityState={{ disabled: Boolean(outside), selected: isSelected }}
                disabled={Boolean(outside)}
                onPress={() => onSelect(cell)}
                style={({ pressed }) => [
                  {
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: radius.sm,
                    backgroundColor: bg,
                    // The selection is a ring rather than a fill, so it can sit
                    // on top of a day that already has a state colour without
                    // hiding it.
                    borderWidth: isSelected ? 1.5 : StyleSheet.hairlineWidth,
                    borderColor: isSelected ? rgb(theme.brand) : border,
                  },
                  outside && { opacity: 0.3 },
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: isSelected ? '700' : '500',
                    fontVariant: ['tabular-nums'],
                    color: isSelected ? rgb(theme.brandStrong) : fg,
                  }}
                >
                  {Number(cell.slice(8, 10))}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      {/* What the colours mean, so a day is readable without pressing it. */}
      {legend && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(3) }}>
          {(
            [
              ['available', 'Open'],
              ['partially_booked', 'Partly booked'],
              ['fully_booked', 'Full'],
              ['blocked', 'Blocked'],
            ] as const
          ).map(([tone, label]) => (
            <View key={tone} style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
              <View
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  backgroundColor: toneColours(theme, tone).bg,
                }}
              />
              <Caption tone="faint">{label}</Caption>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function Stepper({
  label,
  disabled,
  onPress,
  children,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      // 40pt square: a month arrow is pressed repeatedly and a small one is
      // pressed repeatedly and missed.
      style={({ pressed }) => [
        {
          width: 40,
          height: 40,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: rgb(theme.border),
        },
        pressed && { backgroundColor: rgb(theme.surfaceSunken) },
      ]}
    >
      {children}
    </Pressable>
  );
}

/** "Saturday, 14 March 2026", the web client's formatLongDate. */
export function formatLongDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, rgb, rgba, space, useTheme, type Theme } from '@/theme';

/**
 * The primitives, matching the component layer in the web app's index.css.
 *
 * Same names as the classes there — btn, btn-outline, btn-ghost, input, card,
 * page-title, section-title — so that a change of mind about what a button
 * looks like is one edit per app rather than an audit of every screen.
 *
 * Typography is the one deliberate divergence. The web sets Geist; here the
 * platform face is used instead, because a wedding app that renders in a
 * webfont on a phone reads as a website in a wrapper, which is the exact
 * impression this build exists to avoid. Geist ships woff2, which React Native
 * cannot load anyway.
 */

// ------------------------------------------------------------------ text --

type TextTone = 'default' | 'muted' | 'faint' | 'brand' | 'critical' | 'onBrand';

function toneColour(theme: Theme, tone: TextTone): string {
  switch (tone) {
    case 'muted':
      return rgb(theme.ink[500]);
    case 'faint':
      return rgb(theme.ink[400]);
    case 'brand':
      return rgb(theme.brandStrong);
    case 'critical':
      return rgb(theme.criticalFg);
    case 'onBrand':
      return rgb(theme.brandFg);
    default:
      return rgb(theme.ink[800]);
  }
}

interface TxtProps {
  children: ReactNode;
  tone?: TextTone;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

/** A page's own name. One per screen, and never inside a card. */
export function PageTitle({ children, style }: TxtProps) {
  const theme = useTheme();
  return (
    <Text
      style={[
        { fontSize: 28, fontWeight: '600', letterSpacing: -0.6, color: rgb(theme.ink[900]) },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** The line under a page title. Measured, because a subtitle that runs the
 *  full width of a phone is a paragraph pretending to be a caption. */
export function PageSubtitle({ children, style }: TxtProps) {
  const theme = useTheme();
  return (
    <Text style={[{ fontSize: 15, lineHeight: 22, color: rgb(theme.ink[500]) }, style]}>
      {children}
    </Text>
  );
}

export function SectionTitle({ children, style, numberOfLines }: TxtProps) {
  const theme = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        { fontSize: 16, fontWeight: '600', letterSpacing: -0.2, color: rgb(theme.ink[900]) },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Body({ children, tone = 'default', style, numberOfLines }: TxtProps) {
  const theme = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ fontSize: 15, lineHeight: 21, color: toneColour(theme, tone) }, style]}
    >
      {children}
    </Text>
  );
}

export function Caption({ children, tone = 'muted', style, numberOfLines }: TxtProps) {
  const theme = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ fontSize: 13, lineHeight: 18, color: toneColour(theme, tone) }, style]}
    >
      {children}
    </Text>
  );
}

/** An eyebrow: uppercase, tracked, and never a heading in disguise. */
export function Eyebrow({ children, style }: TxtProps) {
  const theme = useTheme();
  return (
    <Text
      style={[
        {
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          color: rgb(theme.ink[400]),
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

// --------------------------------------------------------------- surfaces --

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const style = { flex: 1, backgroundColor: rgb(theme.canvas) };
  // The bottom pad clears the tab bar's own inset; without it the last card in
  // a list sits under the bar and looks like the list was cut off.
  const content = { padding: space(4), paddingBottom: insets.bottom + space(6), gap: space(4) };

  if (!scroll) return <View style={[style, content]}>{children}</View>;
  return (
    <ScrollView style={style} contentContainerStyle={content} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: rgb(theme.surface),
          borderColor: rgb(theme.border),
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.lg,
          padding: space(4),
          gap: space(2),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ---------------------------------------------------------------- actions --

type ButtonVariant = 'primary' | 'outline' | 'ghost';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  small?: boolean;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  small = false,
  disabled = false,
  busy = false,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const off = disabled || busy;

  const base: ViewStyle = {
    borderRadius: radius.md,
    paddingVertical: small ? space(2) : space(3),
    paddingHorizontal: small ? space(3) : space(4),
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space(2),
    borderWidth: variant === 'outline' ? StyleSheet.hairlineWidth : 0,
    // A minimum height rather than padding alone: 44pt is the smallest target
    // a thumb hits reliably, and it is not negotiable on the small variant.
    minHeight: small ? 36 : 46,
  };

  const fills: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: rgb(theme.brand) },
    outline: { borderColor: rgb(theme.borderStrong), backgroundColor: 'transparent' },
    ghost: { backgroundColor: 'transparent' },
  };

  const labels: Record<ButtonVariant, string> = {
    primary: rgb(theme.brandFg),
    outline: rgb(theme.ink[800]),
    ghost: rgb(theme.brandStrong),
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        base,
        fills[variant],
        // Press feedback rather than a hover state: there is no pointer here,
        // and a control that never acknowledges a tap reads as broken.
        pressed && { opacity: 0.75 },
        off && { opacity: 0.45 },
        style,
      ]}
    >
      {busy && <ActivityIndicator size="small" color={labels[variant]} />}
      <Text style={{ fontSize: small ? 14 : 15, fontWeight: '600', color: labels[variant] }}>
        {label}
      </Text>
    </Pressable>
  );
}

// ------------------------------------------------------------------ input --

interface FieldProps extends TextInputProps {
  label: string;
  hint?: string;
}

export function Field({ label, hint, style, ...props }: FieldProps) {
  const theme = useTheme();
  return (
    <View style={{ gap: space(1.5) }}>
      <Text style={{ fontSize: 13, fontWeight: '500', color: rgb(theme.ink[600]) }}>{label}</Text>
      <TextInput
        placeholderTextColor={rgb(theme.ink[400])}
        style={[
          {
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: rgb(theme.border),
            backgroundColor: rgb(theme.surface),
            borderRadius: radius.sm,
            paddingHorizontal: space(3),
            paddingVertical: space(3),
            fontSize: 16, // 16 or iOS zooms the field on focus.
            color: rgb(theme.ink[900]),
            minHeight: 46,
          },
          style,
        ]}
        {...props}
      />
      {hint ? <Caption tone="faint">{hint}</Caption> : null}
    </View>
  );
}

// --------------------------------------------------------------- feedback --

type AlertTone = 'critical' | 'positive' | 'caution';

export function Alert({ tone, children }: { tone: AlertTone; children: ReactNode }) {
  const theme = useTheme();
  const ground = { critical: theme.criticalBg, positive: theme.positiveBg, caution: theme.cautionBg };
  const ink = { critical: theme.criticalFg, positive: theme.positiveFg, caution: theme.cautionFg };
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: rgb(ground[tone]),
        borderRadius: radius.sm,
        padding: space(3),
      }}
    >
      <Text style={{ fontSize: 14, lineHeight: 20, color: rgb(ink[tone]) }}>{children}</Text>
    </View>
  );
}

/**
 * A skeleton rather than a spinner.
 *
 * A spinner says something is happening; a skeleton says what is about to
 * arrive, and the page does not jump when it does.
 */
export function Loading({ rows = 3 }: { rows?: number }) {
  const theme = useTheme();
  return (
    <View style={{ gap: space(3) }} accessibilityLabel="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <View
          key={i}
          style={{
            height: 72,
            borderRadius: radius.lg,
            backgroundColor: rgba(theme.ink[300], theme.dark ? 0.18 : 0.35),
          }}
        />
      ))}
    </View>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: space(8), gap: space(2) }}>
      <SectionTitle style={{ textAlign: 'center' }}>{title}</SectionTitle>
      {children ? (
        <Body tone="muted" style={{ textAlign: 'center' }}>
          {children}
        </Body>
      ) : null}
    </Card>
  );
}

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CaretDown, Check } from 'phosphor-react-native';

import { MonthCalendar, formatLongDate } from '@/components/calendar';
import { Sheet } from '@/components/sheet';
import { Body, Button, Caption, Field } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * The form controls the portals need beyond a text field.
 *
 * The web client uses `<select>`, `<input type="date">` and
 * `<input type="time">`, all of which the browser renders natively and none of
 * which exists in React Native. Each is replaced here by the control the
 * platform would have given: a sheet of options, a month grid, a list of times.
 * (`window.prompt` gets the same treatment in components/prompt.tsx.)
 *
 * No new native dependency for any of them. A date or time picker module would
 * mean rebuilding the dev client — this app already carries a config plugin, so
 * it is not an Expo Go build — and a month grid was needed for Availability
 * regardless, so the calendar is reused rather than a second one installed.
 */

// ------------------------------------------------------------------ label --

function Label({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text style={{ fontSize: 13, fontWeight: '500', color: rgb(theme.ink[600]) }}>{children}</Text>
  );
}

/**
 * The pressable that looks like an input and opens a sheet.
 *
 * Shared by the select, the date and the time so the three read as one family;
 * a date field that did not match the field above it would look like a bug.
 */
function Trigger({
  value,
  placeholder,
  invalid,
  disabled,
  onPress,
}: {
  value?: string;
  placeholder: string;
  invalid?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space(2),
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: rgb(invalid ? theme.criticalFg : theme.border),
          backgroundColor: rgb(theme.surface),
          borderRadius: radius.sm,
          paddingHorizontal: space(3),
          minHeight: 46,
        },
        pressed && { backgroundColor: rgb(theme.surfaceSunken) },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text
        style={{
          flex: 1,
          fontSize: 16,
          color: rgb(value ? theme.ink[900] : theme.ink[400]),
        }}
        numberOfLines={1}
      >
        {value || placeholder}
      </Text>
      <CaretDown size={16} color={rgb(theme.ink[400])} />
    </Pressable>
  );
}

function Wrapper({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: space(1.5) }}>
      <Label>{label}</Label>
      {children}
      {error ? <Caption tone="critical">{error}</Caption> : null}
      {hint && !error ? <Caption tone="faint">{hint}</Caption> : null}
    </View>
  );
}

// ----------------------------------------------------------------- select --

export interface Option {
  value: string;
  label: string;
  /** Why this one cannot be chosen — an already-listed service, an officer on
   *  leave. Shown beside the label rather than hiding the row, so somebody
   *  looking for a name finds it and learns why it is unavailable. */
  note?: string;
  disabled?: boolean;
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose…',
  hint,
  error,
  disabled,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <Wrapper label={label} hint={hint} error={error}>
      <Trigger
        value={current?.label}
        placeholder={placeholder}
        invalid={Boolean(error)}
        disabled={disabled}
        onPress={() => setOpen(true)}
      />
      <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
        <ScrollView style={{ maxHeight: 380 }}>
          {options.map((option, i) => {
            const active = option.value === value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: active, disabled: Boolean(option.disabled) }}
                disabled={option.disabled}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space(3),
                    paddingVertical: space(3.5),
                    borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: rgb(theme.border),
                    minHeight: 48,
                  },
                  pressed && { backgroundColor: rgb(theme.surfaceSunken) },
                  option.disabled && { opacity: 0.45 },
                ]}
              >
                <View style={{ flex: 1, gap: space(0.5) }}>
                  <Body>{option.label}</Body>
                  {option.note ? <Caption tone="faint">{option.note}</Caption> : null}
                </View>
                {active ? <Check size={18} weight="bold" color={rgb(theme.brandStrong)} /> : null}
              </Pressable>
            );
          })}
          {options.length === 0 && <Caption tone="faint">Nothing to choose from yet.</Caption>}
        </ScrollView>
      </Sheet>
    </Wrapper>
  );
}

// ------------------------------------------------------------------- date --

export function DateField({
  label,
  value,
  onChange,
  from,
  to,
  hint,
  error,
  placeholder = 'Pick a date',
}: {
  label: string;
  /** `YYYY-MM-DD`, which is what every one of these endpoints takes. */
  value: string;
  onChange: (value: string) => void;
  from?: string;
  to?: string;
  hint?: string;
  error?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Wrapper label={label} hint={hint} error={error}>
      <Trigger
        value={value ? formatLongDate(value) : undefined}
        placeholder={placeholder}
        invalid={Boolean(error)}
        onPress={() => setOpen(true)}
      />
      <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
        <MonthCalendar
          from={from}
          to={to}
          selected={value || undefined}
          onSelect={(date) => {
            onChange(date);
            setOpen(false);
          }}
        />
        {/* Clearing matters on the optional dates — a trading-since or a
            quotation expiry entered by mistake has to be removable. */}
        {value ? (
          <Button
            label="Clear"
            variant="ghost"
            onPress={() => {
              onChange('');
              setOpen(false);
            }}
          />
        ) : null}
      </Sheet>
    </Wrapper>
  );
}

// ------------------------------------------------------------------- time --

/** Half-hour steps across the day, which is how availability windows are sold. */
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const hour = Math.floor(i / 2);
  return `${String(hour).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`;
});

/** 14:30 as "2:30 pm", the way a person reads a time back. */
export function readableTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function TimeField({
  label,
  value,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  /** `HH:MM`. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <Wrapper label={label} hint={hint}>
      <Trigger
        value={value ? readableTime(value) : undefined}
        placeholder="Pick a time"
        disabled={disabled}
        onPress={() => setOpen(true)}
      />
      <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
        <ScrollView style={{ maxHeight: 380 }}>
          {TIMES.map((time, i) => {
            const active = time === value;
            return (
              <Pressable
                key={time}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  onChange(time);
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: space(3),
                    borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: rgb(theme.border),
                    minHeight: 46,
                  },
                  pressed && { backgroundColor: rgb(theme.surfaceSunken) },
                ]}
              >
                <Body style={{ flex: 1 }}>{readableTime(time)}</Body>
                {active ? <Check size={18} weight="bold" color={rgb(theme.brandStrong)} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </Sheet>
    </Wrapper>
  );
}

// --------------------------------------------------------------- textarea --

/**
 * A multi-line field.
 *
 * `textAlignVertical` is what makes Android start the text at the top; without
 * it the first line sits in the middle of an empty box and the field reads as a
 * single-line input that happens to be tall.
 */
export function Textarea({
  label,
  value,
  onChange,
  rows = 4,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  hint?: string;
  error?: string;
  maxLength?: number;
}) {
  return (
    <Field
      label={label}
      value={value}
      onChangeText={onChange}
      multiline
      style={{ minHeight: 22 * rows, paddingTop: space(3), textAlignVertical: 'top' }}
      {...rest}
    />
  );
}

// ------------------------------------------------------------- check rows --

/** A checkbox as a whole row, so the label is part of the target. */
export function CheckRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space(3),
          paddingVertical: space(2),
          minHeight: 44,
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: checked ? rgb(theme.brand) : 'transparent',
          borderWidth: checked ? 0 : StyleSheet.hairlineWidth,
          borderColor: rgb(theme.borderStrong),
        }}
      >
        {checked ? <Check size={13} weight="bold" color={rgb(theme.brandFg)} /> : null}
      </View>
      <View style={{ flex: 1, gap: space(0.5) }}>
        <Body>{label}</Body>
        {hint ? <Caption tone="faint">{hint}</Caption> : null}
      </View>
    </Pressable>
  );
}

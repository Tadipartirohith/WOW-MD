import { Pressable, StyleSheet, View } from 'react-native';

import type { Answers, FieldSpec } from '@/shared/dynamic-form';
import { CheckRow, DateField, SelectField, Textarea, TimeField } from '@/components/form';
import { DocumentList, PhotoPicker } from '@/components/uploader';
import { Body, Caption, Field } from '@/components/ui';
import { rgb, space, useTheme } from '@/theme';

/**
 * The catalog's questions, drawn with native controls.
 *
 * The specs and their validation come from the web client (see
 * shared/dynamic-form) because both apps must agree on what a valid answer is.
 * The rendering is this file's own, because that is the half the two platforms
 * genuinely cannot share: there is no `<select>` here, no `type="date"`, and a
 * row of checkboxes at browser sizes is a row of targets too small to hit.
 *
 * Everything is one column. The web form goes two-up on wide screens; at phone
 * width a two-column form puts a label above a field half a thumb wide, and
 * every one of these questions can carry a sentence of help text under it.
 */
export function DynamicForm({
  fields,
  answers,
  errors,
  onChange,
}: {
  fields: FieldSpec[];
  answers: Answers;
  errors?: Record<string, string>;
  onChange: (key: string, value: unknown) => void;
}) {
  if (fields.length === 0) return null;
  return (
    <View style={{ gap: space(3) }}>
      {fields.map((field) => (
        <Control
          key={field.key}
          field={field}
          value={answers[field.key]}
          error={errors?.[field.key]}
          onChange={onChange}
        />
      ))}
    </View>
  );
}

/** The label a control renders, with the catalog's own required marker. */
function labelFor(field: FieldSpec): string {
  return field.required ? `${field.label} *` : field.label;
}

function Control({
  field,
  value,
  error,
  onChange,
}: {
  field: FieldSpec;
  value: unknown;
  error?: string;
  onChange: (key: string, value: unknown) => void;
}) {
  const theme = useTheme();
  const c = field.constraints ?? {};
  const set = (v: unknown) => onChange(field.key, v);
  const label = labelFor(field);
  const hint = field.helpText ?? undefined;
  const asText = value === undefined || value === null ? '' : String(value);

  switch (field.type) {
    case 'boolean':
      return (
        <View style={{ gap: space(0.5) }}>
          <CheckRow label={label} hint={hint} checked={value === true} onChange={set} />
          {error ? <Caption tone="critical">{error}</Caption> : null}
        </View>
      );

    case 'number':
    case 'decimal':
    case 'currency':
      return (
        <Field
          label={label}
          hint={hint}
          error={error}
          value={asText}
          onChangeText={set}
          // `decimal-pad` rather than `numeric`: the numeric pad on iOS carries
          // a comma on some locales and no decimal point, which is the keyboard
          // that makes a price impossible to type.
          keyboardType={field.type === 'number' ? 'number-pad' : 'decimal-pad'}
        />
      );

    case 'duration':
      return (
        <Field
          label={label}
          hint={hint ?? `In ${c.unit ?? 'hours'}.`}
          error={error}
          value={asText}
          onChangeText={set}
          keyboardType="number-pad"
        />
      );

    case 'single_select':
      return (
        <SelectField
          label={label}
          hint={hint}
          error={error}
          value={asText}
          onChange={set}
          options={(c.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
        />
      );

    case 'multi_select': {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      return (
        <View style={{ gap: space(1.5) }}>
          <Body style={{ fontSize: 13, fontWeight: '500' }} tone="muted">
            {label}
          </Body>
          {/*
            Wrapping chips rather than a multiple-select. Every option is
            visible and each is its own target, which is what a phone needs;
            a native multi-select would be a sheet the person has to open,
            choose in, and close, once per option.
          */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
            {(c.options ?? []).map((option) => {
              const on = chosen.includes(option.value);
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() =>
                    set(on ? chosen.filter((v) => v !== option.value) : [...chosen, option.value])
                  }
                  style={({ pressed }) => [
                    {
                      borderRadius: 999,
                      paddingHorizontal: space(3),
                      minHeight: 36,
                      justifyContent: 'center',
                      backgroundColor: on ? rgb(theme.brand) : 'transparent',
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: rgb(on ? theme.brand : theme.borderStrong),
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Body style={{ fontSize: 13, color: rgb(on ? theme.brandFg : theme.ink[700]) }}>
                    {option.label}
                  </Body>
                </Pressable>
              );
            })}
          </View>
          {error ? <Caption tone="critical">{error}</Caption> : null}
          {hint && !error ? <Caption tone="faint">{hint}</Caption> : null}
        </View>
      );
    }

    case 'date':
      return (
        <DateField label={label} hint={hint} error={error} value={asText} onChange={set} />
      );

    case 'time':
      return <TimeField label={label} hint={hint} value={asText} onChange={set} />;

    case 'date_time': {
      // Stored as an ISO instant; shown as its date, with the time chosen
      // separately. A single datetime control does not exist natively, and
      // splitting it is how every native calendar asks the same question.
      const iso = asText;
      const datePart = iso.slice(0, 10);
      const timePart = iso.length >= 16 ? new Date(iso).toTimeString().slice(0, 5) : '';
      const combine = (date: string, time: string) => {
        if (!date) return set('');
        set(new Date(`${date}T${time || '00:00'}`).toISOString());
      };
      return (
        <View style={{ gap: space(2) }}>
          <DateField
            label={label}
            hint={hint}
            error={error}
            value={datePart}
            onChange={(d) => combine(d, timePart)}
          />
          <TimeField label="Time" value={timePart} onChange={(t) => combine(datePart, t)} />
        </View>
      );
    }

    case 'url':
      return (
        <Field
          label={label}
          hint={hint}
          error={error}
          value={asText}
          onChangeText={set}
          placeholder="https://"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
        />
      );

    case 'file': {
      const url = asText;
      return (
        <View style={{ gap: space(1.5) }}>
          <Body style={{ fontSize: 13, fontWeight: '500' }} tone="muted">
            {label}
          </Body>
          {url ? <DocumentList urls={[url]} onRemove={() => set('')} /> : null}
          <PhotoPicker
            label={url ? 'Replace' : 'Upload'}
            kind="attachment"
            onUploaded={(u) => set(u)}
          />
          {error ? <Caption tone="critical">{error}</Caption> : null}
          {hint && !error ? <Caption tone="faint">{hint}</Caption> : null}
        </View>
      );
    }

    case 'location': {
      const v = (value ?? {}) as { label?: string; city?: string };
      return (
        <View style={{ gap: space(2) }}>
          <Field
            label={label}
            error={error}
            placeholder="City"
            value={v.city ?? ''}
            onChangeText={(city) => set({ ...v, city })}
            autoCapitalize="words"
          />
          <Field
            label="Venue or address"
            hint={hint ?? 'Optional.'}
            placeholder="Optional"
            value={v.label ?? ''}
            onChangeText={(text) => set({ ...v, label: text })}
          />
        </View>
      );
    }

    case 'range': {
      const v = (value ?? {}) as { from?: number | string; to?: number | string };
      return (
        <View style={{ gap: space(1.5) }}>
          <Body style={{ fontSize: 13, fontWeight: '500' }} tone="muted">
            {label}
          </Body>
          <View style={{ flexDirection: 'row', gap: space(2) }}>
            <View style={{ flex: 1 }}>
              <Field
                label="From"
                value={v.from === undefined ? '' : String(v.from)}
                onChangeText={(from) => set({ ...v, from })}
                keyboardType="number-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="To"
                value={v.to === undefined ? '' : String(v.to)}
                onChangeText={(to) => set({ ...v, to })}
                keyboardType="number-pad"
              />
            </View>
          </View>
          {error ? <Caption tone="critical">{error}</Caption> : null}
          {hint && !error ? <Caption tone="faint">{hint}</Caption> : null}
        </View>
      );
    }

    case 'text':
    default:
      // A long answer gets a box; the web client draws the same line at 200
      // characters of allowance.
      return (c.maxLength ?? 0) > 200 ? (
        <Textarea
          label={label}
          hint={hint}
          error={error}
          value={asText}
          onChange={set}
          rows={3}
          maxLength={c.maxLength}
        />
      ) : (
        <Field
          label={label}
          hint={hint}
          error={error}
          value={asText}
          onChangeText={set}
          maxLength={c.maxLength}
        />
      );
  }
}

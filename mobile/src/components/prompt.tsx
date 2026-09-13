import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Sheet } from '@/components/sheet';
import { Button, Caption } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * What `window.prompt` was doing on the web, as a sheet.
 *
 * There are several of these behind an action — why a window is blocked, why a
 * case needs a visit, what was delivered — and every one of them is text the
 * other party reads verbatim. `Alert.prompt` is iOS-only, so this is the one
 * control that behaves the same on both platforms.
 *
 * Cancelling cancels the action rather than sending it empty, which is the
 * behaviour the web client is careful about too: a delivery marked with no note
 * is a different thing from a delivery nobody was asked about.
 */
export function PromptSheet({
  visible,
  title,
  message,
  placeholder,
  confirmLabel = 'Send',
  minLength = 0,
  initialValue = '',
  multiline = true,
  keyboardNumeric = false,
  input = true,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  confirmLabel?: string;
  minLength?: number;
  initialValue?: string;
  multiline?: boolean;
  keyboardNumeric?: boolean;
  /**
   * Whether there is anything to type.
   *
   * False makes this a confirmation: a decision that is hard to undo — taking
   * an interest back, blocking somebody — is worth asking about, and asking is
   * the whole of the question. It answers with an empty string.
   */
  input?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState(initialValue);

  // Reset each time it opens, or a reason typed for one row would be offered
  // as the reason for the next.
  useEffect(() => {
    if (visible) setText(initialValue);
  }, [visible, initialValue]);

  const ready = text.trim().length >= minLength;

  return (
    <Sheet visible={visible} title={title} onClose={onCancel}>
      {message ? <Caption>{message}</Caption> : null}
      {input ? (
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={rgb(theme.ink[400])}
        multiline={multiline}
        keyboardType={keyboardNumeric ? 'numeric' : 'default'}
        autoFocus
        style={{
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: rgb(theme.border),
          backgroundColor: rgb(theme.surface),
          borderRadius: radius.sm,
          padding: space(3),
          fontSize: 16,
          color: rgb(theme.ink[900]),
          minHeight: multiline ? 88 : 46,
          textAlignVertical: multiline ? 'top' : 'center',
        }}
      />
      ) : null}
      <View style={{ flexDirection: 'row', gap: space(2) }}>
        <Button label="Cancel" variant="outline" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          label={confirmLabel}
          disabled={input && !ready}
          onPress={() => onConfirm(text.trim())}
          style={{ flex: 1 }}
        />
      </View>
    </Sheet>
  );
}

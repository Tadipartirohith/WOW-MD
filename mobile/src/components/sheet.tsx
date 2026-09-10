import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SectionTitle } from '@/components/ui';
import { radius, rgb, rgba, space, useTheme } from '@/theme';

/**
 * A sheet from the bottom of the screen.
 *
 * The native answer to the several things the web client does with a dropdown,
 * a `<select>` or a `window.prompt`. All three assume a pointer and a keyboard
 * within reach; on a phone the reachable part of the screen is the bottom, and
 * a control that opens there is one a thumb can finish without the hand moving.
 *
 * `presentationStyle` is left alone deliberately — a plain transparent modal
 * behaves the same on both platforms, where the iOS-only page sheet would give
 * Android a different dismissal gesture from the one the scrim implies.
 */
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      // The hardware back button on Android closes the sheet rather than the
      // screen behind it, which is what the scrim is promising.
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/*
          The scrim dismisses. A sheet that can only be closed by a button is
          a sheet people back out of with the system gesture, which on iOS
          leaves the app rather than the sheet.
        */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={{ ...StyleSheet.absoluteFillObject, backgroundColor: rgba(theme.scrim, 0.45) }}
        />
        <View
          style={{
            backgroundColor: rgb(theme.surfaceRaised),
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            paddingTop: space(4),
            paddingHorizontal: space(4),
            paddingBottom: insets.bottom + space(4),
            gap: space(3),
            // Never taller than most of the screen: a sheet that fills it is a
            // screen, and should have been pushed instead.
            maxHeight: '85%',
          }}
        >
          <View style={{ alignItems: 'center' }}>
            {/* The grabber, which is what says this panel came from the bottom
                and can go back there. */}
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: rgb(theme.borderStrong),
                marginBottom: space(3),
              }}
            />
          </View>
          <SectionTitle>{title}</SectionTitle>
          {children}
        </View>
      </View>
    </Modal>
  );
}

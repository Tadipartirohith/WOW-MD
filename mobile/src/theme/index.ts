import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { darkTheme, lightTheme, type Theme } from './tokens';

export * from './tokens';

export type ThemeChoice = 'light' | 'dark' | 'system';

/** The same key the web app writes, for no better reason than that a person
 *  reading either codebase should not have to wonder whether they match. */
const STORAGE_KEY = 'wow-theme';

interface ThemeState {
  choice: ThemeChoice;
  /** False until the stored choice has been read back, so nothing renders the
   *  wrong theme and then corrects itself in front of the user. */
  ready: boolean;
  set: (choice: ThemeChoice) => void;
  hydrate: () => Promise<void>;
}

export const useThemeChoice = create<ThemeState>((set) => ({
  choice: 'system',
  ready: false,
  set: (choice) => {
    // Fire-and-forget: the store is the source of truth for this render, and a
    // failed write costs the preference next launch, not this one.
    void AsyncStorage.setItem(STORAGE_KEY, choice);
    set({ choice });
  },
  hydrate: async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      set({ choice: saved === 'light' || saved === 'dark' ? saved : 'system', ready: true });
    } catch {
      // A device that cannot read its own preferences still gets an app.
      set({ ready: true });
    }
  },
}));

/**
 * The resolved theme.
 *
 * `system` is honoured live: `useColorScheme` re-renders when the OS flips at
 * dusk, which is the behaviour the web app gets from a `matchMedia` listener.
 * An explicit choice overrides it, because a toggle that cannot beat the OS is
 * a toggle that lies.
 */
export function useTheme(): Theme {
  const choice = useThemeChoice((s) => s.choice);
  const system = useColorScheme();
  const dark = choice === 'dark' || (choice === 'system' && system === 'dark');
  return dark ? darkTheme : lightTheme;
}

/** Reads the stored preference once, at start-up. */
export function useHydrateTheme(): boolean {
  const ready = useThemeChoice((s) => s.ready);
  const hydrate = useThemeChoice((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  return ready;
}

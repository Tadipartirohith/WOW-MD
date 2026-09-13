import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { bootstrapSession } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { rgb, useHydrateTheme, useTheme } from '@/theme';

void SplashScreen.preventAutoHideAsync();

/**
 * One retry, and never on a 401.
 *
 * The interceptor already refreshes and replays a request whose token expired,
 * so a 401 that reaches here is a real answer: the account is signed out. Query
 * retrying it three more times only delays the login screen.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failures, error) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403) return false;
        return failures < 1;
      },
      staleTime: 30_000,
    },
  },
});

/**
 * Sends a signed-out person to the login screen and a signed-in one away from
 * it.
 *
 * Held until `ready`, which the boot-time refresh sets. Redirecting before then
 * would bounce everybody with a perfectly good stored session to login for the
 * half-second the keystore read takes.
 */
function useAuthGate() {
  const user = useAuth((s) => s.user);
  const ready = useAuth((s) => s.ready);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    // Both ends of the signed-out flow, or opening sign-up would bounce
    // straight back to sign-in — which is the screen it was reached from.
    const inAuthFlow = segments[0] === 'login' || segments[0] === 'register';
    if (!user && !inAuthFlow) router.replace('/login');
    else if (user && inAuthFlow) router.replace('/');
  }, [ready, user, segments, router]);
}

/**
 * Wipe the query cache whenever the signed-in user changes (EZ1-I122).
 *
 * The same data-isolation rule the web app enforces: signing out and back in as
 * somebody else never restarts the app, and with a 30s staleTime the previous
 * user's cached answers would otherwise be served to the next one. Clearing on
 * any change away from a real user makes one account's data unable to appear
 * under another's session.
 */
function useClearCacheOnUserChange() {
  const userId = useAuth((s) => s.user?.id ?? null);
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (prev.current != null && prev.current !== userId) {
      queryClient.clear();
    }
    prev.current = userId;
  }, [userId]);
}

export default function RootLayout() {
  const theme = useTheme();
  const themeReady = useHydrateTheme();
  const authReady = useAuth((s) => s.ready);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    void bootstrapSession().finally(() => setBooted(true));
  }, []);

  const ready = themeReady && booted && authReady;

  useEffect(() => {
    // Held until the theme is known as well as the session: hiding the splash
    // first shows a light screen to a dark-mode user for one frame, which is
    // the flash the web app's init-before-render exists to prevent.
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
        {ready ? <Routes /> : <View style={{ flex: 1, backgroundColor: rgb(theme.canvas) }} />}
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function Routes() {
  const theme = useTheme();
  useAuthGate();
  useClearCacheOnUserChange();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: rgb(theme.canvas) },
        // The header follows the theme rather than the platform default, or a
        // dark-mode user gets one white bar at the top of an otherwise dark
        // screen. `headerBackTitle` is emptied so a long title on the previous
        // screen does not push the chevron off the iOS bar.
        headerStyle: { backgroundColor: rgb(theme.surface) },
        headerTintColor: rgb(theme.brandStrong),
        headerTitleStyle: { color: rgb(theme.ink[900]), fontSize: 17, fontWeight: '600' },
        headerBackTitle: '',
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="(tabs)" />

      {/*
        The screens pushed out of a tab, each with the platform's own header.
        A native header rather than a title drawn into the page: it brings the
        back button, the swipe-back gesture and the large-title collapse with
        it, and a hand-rolled one brings none of those and has to be told about
        the notch.

        The titles are the web app's own words, because a vendor who has used
        the site is looking for "Catalog & Services" and not for a synonym.
      */}
      <Stack.Screen
        name="business-details"
        options={{ headerShown: true, title: 'Business Details' }}
      />
      <Stack.Screen
        name="business-services"
        options={{ headerShown: true, title: 'Catalog & Services' }}
      />
      <Stack.Screen
        name="business-review"
        options={{ headerShown: true, title: 'Review & Submit' }}
      />
      <Stack.Screen name="accounts" options={{ headerShown: true, title: 'Accounts' }} />
      <Stack.Screen name="profile" options={{ headerShown: true, title: 'My Profile' }} />
      <Stack.Screen name="support" options={{ headerShown: true, title: 'Support' }} />
      <Stack.Screen name="security" options={{ headerShown: true, title: 'Security' }} />
      <Stack.Screen name="my-reviews" options={{ headerShown: true, title: 'My Reviews' }} />
      <Stack.Screen name="about" options={{ headerShown: true, title: 'About' }} />
      <Stack.Screen
        name="transaction/[id]"
        options={{ headerShown: true, title: 'Payment' }}
      />
      <Stack.Screen name="biodata" options={{ headerShown: true, title: 'Biodata' }} />
      <Stack.Screen name="events" options={{ headerShown: true, title: 'Events' }} />
      <Stack.Screen name="chat/index" options={{ headerShown: true, title: 'Chat' }} />
      {/* The title becomes the other person's name once the thread knows it. */}
      <Stack.Screen name="chat/[id]" options={{ headerShown: true, title: 'Conversation' }} />
      <Stack.Screen name="match/[id]" options={{ headerShown: true, title: 'Profile' }} />
      <Stack.Screen name="visit/[id]" options={{ headerShown: true, title: 'Visit' }} />
      <Stack.Screen name="case/[id]" options={{ headerShown: true, title: 'Case' }} />
    </Stack>
  );
}

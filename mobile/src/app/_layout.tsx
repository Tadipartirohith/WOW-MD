import { useEffect, useState } from 'react';
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
    const inAuthFlow = segments[0] === 'login';
    if (!user && !inAuthFlow) router.replace('/login');
    else if (user && inAuthFlow) router.replace('/');
  }, [ready, user, segments, router]);
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

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: rgb(theme.canvas) },
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

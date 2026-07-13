import 'react-native-get-random-values';
import { Stack, usePathname, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Platform, View, StyleSheet, TouchableOpacity } from 'react-native';
import { useFonts, Montserrat_300Light, Montserrat_400Regular, Montserrat_500Medium, Montserrat_600SemiBold, Montserrat_700Bold, Montserrat_800ExtraBold } from '@expo-google-fonts/montserrat';
import * as SplashScreen from 'expo-splash-screen';
import * as Sentry from '@sentry/react-native';

import { useNotificationSetup } from '@/hooks/useNotificationSetup';
import { useNewTournamentNotifier } from '@/hooks/useNewTournamentNotifier';
import { usePasswordRecovery } from '@/hooks/usePasswordRecovery';
import { isRecoveryInProgress } from '@/lib/password-recovery';
import { AppAlertProvider } from '@/components/ui/app-alert';
import { ScraperBanner } from '@/components/ui/ScraperBanner';
import { DemoDataProvider } from '@/hooks/useDemoData';
import { queryClient, persistCacheToMmkv } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { DEMO_MODE } from '@/config/demo';
import { trackScreen } from '@/lib/analytics';
import { consumePendingDeepLink } from '@/lib/pending-navigation';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { Text } from '@/components/ui/text';
import { TourlyLogo } from '@/components/ui/tourly-logo';
import { useLanguage } from '@/hooks/useLanguage';
import { T } from '@/constants/theme';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    enableNativeCrashHandling: true,
    tracesSampleRate: 0.2,
  });
}

// Restore persisted query cache and subscribe to future changes
persistCacheToMmkv();

// On web: if this page load is an OAuth callback, extract tokens and set the
// session before any React Query fetches run. This mirrors what native does
// manually via WebBrowser + setSession().
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  const hash = window.location.hash.substring(1);
  const query = window.location.search.substring(1);
  const fromHash = new URLSearchParams(hash);
  const fromQuery = new URLSearchParams(query);
  const accessToken = fromHash.get('access_token') ?? fromQuery.get('access_token');
  const refreshToken = fromHash.get('refresh_token') ?? fromQuery.get('refresh_token');
  if (accessToken) {
    // Synchronously kick off setSession so the Supabase client has credentials
    // before the first query fires. Clear the tokens from the URL afterward.
    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken ?? '' }).then(() => {
      window.history.replaceState({}, document.title, window.location.pathname);
    });
  }
}

export const unstable_settings = {
  anchor: '(tabs)',
};

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { data: profile, isLoading: profileLoading, isFetching: profileFetching, isError: profileIsError, refetch: refetchProfile } = useProfile();
  const segments = useSegments();
  const router = useRouter();
  const { t } = useLanguage();

  useEffect(() => {
    if (DEMO_MODE) return;

    if (loading) return;
    // A password-recovery deep link is being handled (see usePasswordRecovery)
    // — the recovery session's SIGNED_IN transition must not redirect the user
    // away from /reset-password before they set a new password.
    if (isRecoveryInProgress()) return;
    if (user && (profileLoading || profileFetching || profile === undefined)) return;

    const inAuth = segments[0] === 'auth';
    const inOnboarding = segments[0] === 'onboarding';

    if (__DEV__) {
      console.log('[AuthGate]', {
        userId: user?.id ?? null,
        loading,
        profileLoading,
        profileFetching,
        profileIsNull: profile === null,
        profileIsUndefined: profile === undefined,
        onboarding_complete: (profile as any)?.onboarding_complete ?? 'N/A',
        segments: segments[0],
        inAuth,
        inOnboarding,
      });
    }

    if (!user) {
      if (!inAuth) {
        if (__DEV__) console.log('[AuthGate] → /auth (no user)');
        router.replace('/auth');
      }
    } else if (!profile || !profile.onboarding_complete) {
      // No profile row OR onboarding not complete → new user needs onboarding.
      // NOTE: for pre-migration users the SQL in supabase/fix_missing_profiles.sql
      // must be run first — it backfills rows with onboarding_complete = true so
      // those users never land here.
      if (!inOnboarding) {
        if (__DEV__) console.log('[AuthGate] → /onboarding/walkthrough (onboarding_complete false/null)');
        router.replace('/onboarding/walkthrough');
      }
    } else {
      // Profile exists and onboarding is done → home.
      if (inAuth || inOnboarding) {
        if (__DEV__) console.log('[AuthGate] → /(tabs) (onboarding_complete = true)');
        router.replace('/(tabs)');
      }

      // Auth + profile are now settled and the user is signed in and
      // onboarded — safe to replay a notification tap that arrived on cold
      // start before this gate had resolved (see lib/pending-navigation.ts).
      // consumePendingDeepLink() is consume-once, so this only ever replays
      // a given tap a single time even though the effect can re-run.
      const pending = consumePendingDeepLink();
      if (pending) {
        if (pending.target === 'calendar') {
          router.navigate('/(tabs)/calendar');
        } else {
          router.navigate({
            pathname: '/(tabs)/tournaments',
            params: { openTournament: pending.tournamentId },
          });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, profile, profileLoading, profileFetching]);

  // A signed-in user whose profile query settled to an error (not loading,
  // not fetching, data still undefined) has no cached row to fall back on.
  // The effect above deliberately blocks navigation in this state (same
  // guard as the loading case), so without this branch there is nothing on
  // screen to recover from — render a minimal retry view instead.
  if (!DEMO_MODE && user && !loading && !profileLoading && !profileFetching && profile === undefined && profileIsError) {
    return (
      <View style={gateStyles.container}>
        <TourlyLogo width={160} height={42} />
        <Text style={gateStyles.title}>{t('auth.profileLoadErrorTitle')}</Text>
        <Text style={gateStyles.message}>{t('auth.profileLoadErrorBody')}</Text>
        <TouchableOpacity style={gateStyles.retryBtn} onPress={() => refetchProfile()} activeOpacity={0.8}>
          <Text style={gateStyles.retryText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <>{children}</>;
}

const gateStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.bg,
    paddingHorizontal: 32,
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: T.textPrimary, textAlign: 'center', marginTop: 16 },
  message: { fontSize: 14, color: T.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 8 },
  retryBtn: {
    backgroundColor: T.accent,
    borderRadius: 50,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  retryText: { color: T.textPrimary, fontSize: 15, fontWeight: '700' },
});

function AppLayout() {
  useNotificationSetup();
  useNewTournamentNotifier();
  usePasswordRecovery();

  // First-party screen analytics: one event per route change.
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) trackScreen(pathname);
  }, [pathname]);

  return (
    <AuthGate>
      <ScraperBanner />
      <Stack>
        <Stack.Screen name="(tabs)"      options={{ headerShown: false }} />
        <Stack.Screen name="auth"        options={{ headerShown: false }} />
        <Stack.Screen name="reset-password" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding"  options={{ headerShown: false }} />
        <Stack.Screen name="settings"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="profile"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="insights"         options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="my-performance"  options={{ headerShown: false, presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
      <StatusBar style="auto" />
    </AuthGate>
  );
}

SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const [fontsLoaded] = useFonts({
    Montserrat_300Light,
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    Montserrat_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <DemoDataProvider>
            <AppAlertProvider>
              <ErrorBoundary>
                <AppLayout />
              </ErrorBoundary>
            </AppAlertProvider>
          </DemoDataProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);

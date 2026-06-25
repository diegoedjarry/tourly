import 'react-native-get-random-values';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useFonts, Montserrat_300Light, Montserrat_400Regular, Montserrat_500Medium, Montserrat_600SemiBold, Montserrat_700Bold, Montserrat_800ExtraBold } from '@expo-google-fonts/montserrat';
import * as SplashScreen from 'expo-splash-screen';

import { useNotificationSetup } from '@/hooks/useNotificationSetup';
import { DemoDataProvider } from '@/hooks/useDemoData';
import { queryClient, persistCacheToMmkv } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { DEMO_MODE } from '@/config/demo';

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
  const { data: profile, isLoading: profileLoading } = useProfile();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (DEMO_MODE) return; // skip auth gate in demo mode
    if (loading || (user && profileLoading)) return;
    const inAuth = segments[0] === 'auth';
    const inOnboarding = segments[0] === 'onboarding';
    if (!user) {
      if (!inAuth) router.replace('/auth');
    } else if (profile && !profile.onboarding_complete) {
      // Only redirect to onboarding if profile explicitly has onboarding_complete = false
      if (!inOnboarding) router.replace('/onboarding/profile');
    } else {
      // profile is null (no row yet) or onboarding_complete — go to tabs
      if (inAuth || inOnboarding) router.replace('/(tabs)');
    }
  }, [user, loading, profile, profileLoading, segments]);

  return <>{children}</>;
}

function AppLayout() {
  useNotificationSetup();
  return (
    <AuthGate>
      <Stack>
        <Stack.Screen name="(tabs)"      options={{ headerShown: false }} />
        <Stack.Screen name="auth"        options={{ headerShown: false }} />
        <Stack.Screen name="onboarding"  options={{ headerShown: false }} />
        <Stack.Screen name="settings"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="profile"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="insights"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="modal"       options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </AuthGate>
  );
}

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
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
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <DemoDataProvider>
          <AppLayout />
        </DemoDataProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

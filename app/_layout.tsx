import 'react-native-get-random-values';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useNotificationSetup } from '@/hooks/useNotificationSetup';
import { DemoDataProvider } from '@/hooks/useDemoData';
import { queryClient, persistCacheToMmkv } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';

// Restore persisted query cache and subscribe to future changes
persistCacheToMmkv();

export const unstable_settings = {
  anchor: '(tabs)',
};

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === 'auth';
    if (!user && !inAuth) {
      router.replace('/auth');
    } else if (user && inAuth) {
      router.replace('/(tabs)');
    }
  }, [user, loading, segments]);

  return <>{children}</>;
}

export default function RootLayout() {
  useNotificationSetup();

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <DemoDataProvider>
          <AuthGate>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="auth"   options={{ headerShown: false }} />
              <Stack.Screen name="modal"  options={{ presentation: 'modal', title: 'Modal' }} />
            </Stack>
            <StatusBar style="auto" />
          </AuthGate>
        </DemoDataProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

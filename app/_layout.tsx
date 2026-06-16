import 'react-native-get-random-values';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useNotificationSetup } from '@/hooks/useNotificationSetup';
import { DemoDataProvider } from '@/hooks/useDemoData';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  useNotificationSetup();

  return (
    <SafeAreaProvider>
      <DemoDataProvider>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="modal"  options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <StatusBar style="auto" />
      </DemoDataProvider>
    </SafeAreaProvider>
  );
}

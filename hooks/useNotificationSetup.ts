import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useAppQuery } from '@/hooks/useAppQuery';
import { useProfile } from '@/hooks/useProfile';
import { useLanguage } from '@/hooks/useLanguage';

// Push notifications don't work in Expo Go on Android (SDK 53+). Skip entirely.
const isExpoGo = Constants.executionEnvironment === 'storeClient';

export function useNotificationSetup() {
  const router = useRouter();
  const { data, isFetching } = useAppQuery({});
  const { data: profile } = useProfile();
  const { lang } = useLanguage();
  const orphanCleanupDone = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web' || isExpoGo) return;
    import('@/utils/notifications').then(({ requestPermissionsAndGetToken }) => {
      requestPermissionsAndGetToken().catch(() => {});
    });
  }, []);

  // One-time-per-session: cancel any notifications for tournaments that no longer exist.
  // Waits for isFetching=false so the cleanup runs against confirmed live data, not stale cache.
  useEffect(() => {
    if (Platform.OS === 'web' || isExpoGo) return;
    if (!data?.tournaments || isFetching || orphanCleanupDone.current) return;
    orphanCleanupDone.current = true;
    const validIds = new Set<string>(data.tournaments.map((t: any) => t.id as string));
    import('@/utils/notifications').then(({ cancelOrphanedNotifications }) => {
      cancelOrphanedNotifications(validIds).catch(() => {});
    });
  }, [data?.tournaments, isFetching]);

  useEffect(() => {
    if (Platform.OS === 'web' || isExpoGo) return;
    if (!data?.tournaments) return;
    import('@/utils/notifications').then(({ rescheduleAllNotifications }) => {
      rescheduleAllNotifications(data.tournaments, profile ?? undefined, lang).catch(() => {});
    });
  }, [data?.tournaments, profile, lang]);

  // Handle notification taps — open tournament detail
  useEffect(() => {
    if (Platform.OS === 'web' || isExpoGo) return;
    let sub: { remove: () => void } | undefined;
    import('expo-notifications').then(Notifications => {
      sub = Notifications.addNotificationResponseReceivedListener(response => {
        const tournamentId = response.notification.request.content.data?.tournamentId as string | undefined;
        if (tournamentId) {
          router.navigate({
            pathname: '/(tabs)/tournaments',
            params: { openTournament: tournamentId as string },
          });
        }
      });
    });
    return () => sub?.remove();
  }, [router]);
}

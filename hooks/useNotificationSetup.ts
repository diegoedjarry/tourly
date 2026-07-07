import { useEffect } from 'react';
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

  useEffect(() => {
    if (Platform.OS === 'web' || isExpoGo) return;
    import('@/utils/notifications').then(({ requestPermissionsAndGetToken }) => {
      requestPermissionsAndGetToken().catch(() => {});
    });
  }, []);

  // Cancel notifications for tournaments that no longer exist — or are withdrawn /
  // removed from My List (their notifications are stale by definition; buildSpecs
  // never creates them). Runs on every settled fetch, not once per session: a stale
  // server refetch (e.g. offline delete queued but not yet flushed) can make the
  // reschedule effect re-add notifications for a just-deleted tournament, so the
  // sweep must keep running against confirmed live data.
  useEffect(() => {
    if (Platform.OS === 'web' || isExpoGo) return;
    if (!data?.tournaments || isFetching) return;
    const validIds = new Set<string>(
      data.tournaments
        .filter((t: any) => !t.isWithdrawn && t.isInMyList !== false)
        .map((t: any) => t.id as string),
    );
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
        const data = response.notification.request.content.data as Record<string, unknown> | undefined;
        // Profile-matched "new tournament" notifications land on the calendar.
        if (data?.target === 'calendar') {
          router.navigate('/(tabs)/calendar');
          return;
        }
        const tournamentId = data?.tournamentId as string | undefined;
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

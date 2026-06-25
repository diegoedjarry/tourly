import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppQuery } from '@/hooks/useAppQuery';
import { useProfile } from '@/hooks/useProfile';

export function useNotificationSetup() {
  const router = useRouter();
  const { data } = useAppQuery({});
  const { data: profile } = useProfile();

  useEffect(() => {
    if (Platform.OS === 'web') return;
    import('@/utils/notifications').then(({ requestPermissionsAndGetToken }) => {
      requestPermissionsAndGetToken().catch(() => {});
    });
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!data?.tournaments) return;
    import('@/utils/notifications').then(({ rescheduleAllNotifications }) => {
      rescheduleAllNotifications(data.tournaments, profile ?? undefined).catch(() => {});
    });
  }, [data?.tournaments, profile]);

  // Handle notification taps — open tournament detail
  useEffect(() => {
    if (Platform.OS === 'web') return;
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

import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useAppQuery } from '@/hooks/useAppQuery';
import {
  requestPermissionsAndGetToken,
  rescheduleAllNotifications,
} from '@/utils/notifications';

export function useNotificationSetup() {
  const router = useRouter();
  const { data } = useAppQuery({});

  // Request push permissions (token storage handled server-side later)
  useEffect(() => {
    requestPermissionsAndGetToken().catch(() => {});
  }, []);

  // Reschedule all notifications whenever tournament data changes
  useEffect(() => {
    if (!data?.tournaments) return;
    rescheduleAllNotifications(data.tournaments);
  }, [data?.tournaments]);

  // Handle notification taps — open tournament detail
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const tournamentId = response.notification.request.content.data?.tournamentId;
      if (tournamentId) {
        router.navigate({
          pathname: '/(tabs)/tournaments',
          params: { openTournament: tournamentId },
        });
      }
    });
    return () => sub.remove();
  }, [router]);
}

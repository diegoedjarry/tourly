import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { db } from '@/db';
import {
  requestPermissionsAndGetToken,
  rescheduleAllNotifications,
} from '@/utils/notifications';

const DEVICE_ID = 'singleton-device';

export function useNotificationSetup() {
  const router = useRouter();
  const { user } = db.useAuth();
  const { data } = db.useQuery(user ? { tournaments: {} } : null);

  // Request permissions + save push token
  useEffect(() => {
    requestPermissionsAndGetToken().then(token => {
      if (!token) return;
      db.transact(
        db.tx.devices[DEVICE_ID].update({
          pushToken: token,
          platform: require('react-native').Platform.OS,
          updatedAt: Date.now(),
        })
      );
    });
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

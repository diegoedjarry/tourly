import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useAppQuery } from '@/hooks/useAppQuery';
import { useProfile } from '@/hooks/useProfile';
import { useLanguage } from '@/hooks/useLanguage';
import { DEMO_MODE } from '@/config/demo';

// Push notifications don't work in Expo Go on Android (SDK 53+). Skip entirely.
const isExpoGo = Constants.executionEnvironment === 'storeClient';

export function useNotificationSetup() {
  const router = useRouter();
  const { data, isFetching, isLoading, error } = useAppQuery({});
  const { data: profile } = useProfile();
  const { lang } = useLanguage();

  // Keep latest values available to the AppState listener below without
  // re-subscribing it on every data/profile/lang change.
  const latestRef = useRef({ tournaments: data?.tournaments, profile, lang });
  latestRef.current = { tournaments: data?.tournaments, profile, lang };

  // The app never schedules notifications inside Expo Go, so anything scheduled
  // there is stale by definition — left over from a pre-guard session or an old
  // checkout. Expo Go's notification store is separate from the standalone app's
  // and no other code path can clean it, so purge it once on mount.
  useEffect(() => {
    if (DEMO_MODE) return;
    if (Platform.OS === 'web' || !isExpoGo) return;
    import('expo-notifications').then(Notifications => {
      Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (DEMO_MODE) return;
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
    if (DEMO_MODE) return;
    if (Platform.OS === 'web' || isExpoGo) return;
    if (!data?.tournaments || isFetching || error) return;
    const validIds = new Set<string>(
      data.tournaments
        .filter((t: any) => !t.isWithdrawn && t.isInMyList !== false)
        .map((t: any) => t.id as string),
    );
    import('@/utils/notifications').then(({ cancelOrphanedNotifications }) => {
      cancelOrphanedNotifications(validIds).catch(() => {});
    });
  }, [data?.tournaments, isFetching, error]);

  // An empty list from a failed or in-flight fetch must never wipe every
  // scheduled reminder — a genuinely empty account (successful fetch, zero
  // rows) still reschedules-to-nothing correctly, so only isLoading/error skip.
  useEffect(() => {
    if (DEMO_MODE) return;
    if (Platform.OS === 'web' || isExpoGo) return;
    if (!data?.tournaments || isLoading || isFetching || error) return;
    import('@/utils/notifications').then(({ rescheduleAllNotifications }) => {
      rescheduleAllNotifications(data.tournaments, profile ?? undefined, lang).catch(() => {});
    });
  }, [data?.tournaments, profile, lang, isLoading, isFetching, error]);

  // Detect device timezone changes (e.g. a player flies to a new country mid-trip).
  // On-site reminders are scheduled as local wall-clock Date triggers, so if the
  // timezone changes after scheduling, the already-scheduled triggers no longer
  // line up with the intended tournament-local moment. Tournament data changes
  // already trigger a reschedule, but a pure timezone change wouldn't — so check
  // on every foreground transition and reschedule only when the timezone actually
  // differs from what was stored at the last successful reschedule.
  useEffect(() => {
    if (DEMO_MODE) return;
    if (Platform.OS === 'web' || isExpoGo) return;

    const checkTimezone = async () => {
      const { tournaments, profile: latestProfile, lang: latestLang } = latestRef.current;
      if (!tournaments) return;
      try {
        const { getCurrentTimeZone, LAST_TZ_STORAGE_KEY, rescheduleAllNotifications } =
          await import('@/utils/notifications');
        const currentTz = getCurrentTimeZone();
        const storedTz = await AsyncStorage.getItem(LAST_TZ_STORAGE_KEY);
        if (storedTz !== null && storedTz === currentTz) return;
        await rescheduleAllNotifications(tournaments, latestProfile ?? undefined, latestLang);
      } catch {
        // Best-effort — worst case we miss one drift check and catch it on the
        // next foreground transition or the next tournament-data reschedule.
      }
    };

    // Check once on mount too, in case the app was backgrounded across a
    // timezone change and is only now rendering this hook for the first time.
    checkTimezone();

    const sub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') checkTimezone();
    });
    return () => sub.remove();
  }, []);

  // Handle notification taps — open tournament detail
  useEffect(() => {
    if (DEMO_MODE) return;
    if (Platform.OS === 'web' || isExpoGo) return;
    let sub: { remove: () => void } | undefined;
    let cancelled = false;
    import('expo-notifications').then(Notifications => {
      if (cancelled) return;
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
    return () => { cancelled = true; sub?.remove(); };
  }, [router]);
}

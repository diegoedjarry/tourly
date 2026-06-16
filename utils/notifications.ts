import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

// Show notifications even when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ─── Permissions & token ──────────────────────────────────────────────────────

export async function requestPermissionsAndGetToken(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  const { status } = existing === 'granted'
    ? { status: existing }
    : await Notifications.requestPermissionsAsync();

  if (status !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('tourly-deadlines', {
      name: 'Deadline Alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#5B5BD6',
    });
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync();
    return token.data;
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoToDate(dateStr: string, hour = 9): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function shortDate(dateStr: string): string {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [, m, d] = dateStr.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

// ─── Schedule / cancel ────────────────────────────────────────────────────────

interface NotifSpec {
  id: string;
  title: string;
  trigger: Date;
  tournamentId: string;
}

function buildSpecs(tournaments: any[]): NotifSpec[] {
  const specs: NotifSpec[] = [];
  const now = new Date();

  for (const t of tournaments) {
    if (t.isWithdrawn || t.isInMyList === false) continue;

    // Sign-up deadline — only when NOT yet registered
    if (!t.isRegistered && t.signUpDeadline) {
      const dl   = isoToDate(t.signUpDeadline);
      const name = t.name;
      const date = shortDate(t.signUpDeadline);
      const signUpAlerts = [
        { days: -7, id: `su7_${t.id}`,  title: `⏰ Sign up deadline in 7 days — ${name} (${date})` },
        { days: -2, id: `su2_${t.id}`,  title: `🚨 Sign up deadline in 2 days — ${name} (${date})` },
        { days: -1, id: `su1_${t.id}`,  title: `🚨 Sign up deadline TOMORROW — ${name}` },
      ];
      for (const a of signUpAlerts) {
        const trigger = addDays(dl, a.days);
        if (trigger > now) specs.push({ id: a.id, title: a.title, trigger, tournamentId: t.id });
      }
    }

    // Withdrawal deadline — only when registered
    if (t.isRegistered && t.withdrawalDeadline) {
      const dl   = isoToDate(t.withdrawalDeadline);
      const name = t.name;
      const wdAlerts = [
        { days: -7, id: `wd7_${t.id}`, title: `⏰ Withdrawal deadline in 7 days — ${name}` },
        { days: -2, id: `wd2_${t.id}`, title: `🚨 Withdrawal deadline in 2 days — ${name}` },
        { days:  0, id: `wd0_${t.id}`, title: `🚨 Withdrawal deadline TODAY — ${name}. Act now.` },
      ];
      for (const a of wdAlerts) {
        const trigger = addDays(dl, a.days);
        if (trigger > now) specs.push({ id: a.id, title: a.title, trigger, tournamentId: t.id });
      }
    }

    // Freeze / doubles entry deadline — for all in-list, non-withdrawn tournaments
    if (t.freezeDeadline) {
      const dl   = isoToDate(t.freezeDeadline);
      const name = t.name;
      const date = shortDate(t.freezeDeadline);
      const fzAlerts = [
        { days: -3, id: `fz3_${t.id}`, title: `⏰ Doubles entry deadline in 3 days — ${name} (${date})` },
        { days: -1, id: `fz1_${t.id}`, title: `🎾 Doubles entry deadline TOMORROW — ${name}` },
        { days:  0, id: `fz0_${t.id}`, title: `🎾 Doubles entry deadline TODAY — ${name}` },
      ];
      for (const a of fzAlerts) {
        const trigger = addDays(dl, a.days);
        if (trigger > now) specs.push({ id: a.id, title: a.title, trigger, tournamentId: t.id });
      }
    }
  }

  return specs;
}

export async function rescheduleAllNotifications(tournaments: any[]): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  const specs = buildSpecs(tournaments);
  for (const spec of specs) {
    await Notifications.scheduleNotificationAsync({
      identifier: spec.id,
      content: {
        title: spec.title,
        sound: true,
        data: { tournamentId: spec.tournamentId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: spec.trigger,
      },
    });
  }
}

export async function cancelTournamentNotifications(tournamentId: string): Promise<void> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  const mine = all.filter(n => n.content.data?.tournamentId === tournamentId);
  await Promise.all(mine.map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

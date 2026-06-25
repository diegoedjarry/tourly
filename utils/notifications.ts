import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { ReminderConfig, ReminderTime, OnsiteReminderTime } from '@/hooks/useProfile';
import { DEFAULT_REMINDER_CONFIG, DEFAULT_ONSITE_REMINDERS } from '@/hooks/useProfile';
import { getOnsiteDeadlines, getCircuit } from '@/utils/deadlines';
import type { OnsiteDeadlineLabel } from '@/utils/deadlines';

try {
  if (Platform.OS !== 'web') {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  }
} catch {}

// ─── Permissions & token ──────────────────────────────────────────────────────

export async function requestPermissionsAndGetToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'web' || !Device.isDevice) return null;

    const { status: existing } = await Notifications.getPermissionsAsync();
    const { status } = existing === 'granted'
      ? { status: existing }
      : await Notifications.requestPermissionsAsync();

    if (status !== 'granted') return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('tourly-deadlines', {
        name: 'Tourly — Deadline Alerts',
        description: 'Entry, withdrawal and freeze deadline reminders',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#5B5BD6',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: false,
        sound: 'default',
      });
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return token.data;
  } catch {
    return null;
  }
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

function isoToDate(dateStr: string, hour = 9): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0);
}

function timeToMs(t: ReminderTime): number {
  const n = parseInt(t);
  if (t.endsWith('d')) return n * 86400000;
  if (t.endsWith('h')) return n * 3600000;
  if (t.endsWith('m')) return n * 60000;
  return 0;
}

// ─── Notification text formatting ─────────────────────────────────────────────

function formatCountdown(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0 && m > 0) return `${h} hour${h > 1 ? 's' : ''} ${m} min`;
  if (h > 0) return `${h} hour${h > 1 ? 's' : ''}`;
  return `${m} minutes`;
}

function formatNotif(
  deadlineType: string,
  city: string,
  category: string,
  msRemaining: number,
): { title: string; body: string } {
  const days = Math.floor(msRemaining / 86400000);

  if (days < 1) {
    return {
      title: `🚨 Today — ${city}`,
      body: `${deadlineType} closes in ${formatCountdown(msRemaining)}`,
    };
  }
  if (days === 1) {
    return {
      title: `⚠️ Tomorrow — ${city}`,
      body: `${deadlineType} · ${category}`,
    };
  }
  if (days <= 3) {
    return {
      title: `⚠️ ${days} days — ${city}`,
      body: `${deadlineType} · ${category}`,
    };
  }
  if (days <= 7) {
    return {
      title: `📅 This week — ${city}`,
      body: `${deadlineType} · ${category} · ${days} days`,
    };
  }
  return {
    title: `📅 Upcoming — ${city}`,
    body: `${deadlineType} · ${category} · ${days} days`,
  };
}

// ─── Schedule / cancel ────────────────────────────────────────────────────────

interface NotifSpec {
  id: string;
  title: string;
  body: string;
  trigger: Date;
  tournamentId: string;
}

export interface NotifPrefs {
  notify_enabled?: boolean;
  notify_singles?: boolean;
  notify_withdrawal?: boolean;
  notify_freeze?: boolean;
  notify_reminder_config?: ReminderConfig | null;
  notify_onsite_enabled?: boolean;
  notify_onsite_reminders?: (OnsiteReminderTime | null)[];
}

const SAME_DAY_OFFSETS: ReminderTime[] = ['6h', '2h', '30m'];

function addReminders(
  specs: NotifSpec[],
  seenKeys: Set<string>,
  times: (ReminderTime | null)[],
  deadlineStr: string,
  deadlineType: string,
  prefix: string,
  tournamentId: string,
  city: string,
  category: string,
  now: Date,
) {
  const deadline = isoToDate(deadlineStr, 9);

  // User-configured reminders
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (!t) continue;
    const key = `${prefix}${t}_${tournamentId}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const ms = timeToMs(t);
    const trigger = new Date(deadline.getTime() - ms);
    if (trigger <= now) continue;
    const { title, body } = formatNotif(deadlineType, city, category, ms);
    specs.push({ id: key, title, body, trigger, tournamentId });
  }

  // Auto same-day countdown notifications (6h, 2h, 30m)
  for (const t of SAME_DAY_OFFSETS) {
    const key = `${prefix}auto${t}_${tournamentId}`;
    if (seenKeys.has(key)) continue;
    const alreadyCovered = times.some(ut => ut === t);
    if (alreadyCovered) continue;
    seenKeys.add(key);
    const ms = timeToMs(t);
    const trigger = new Date(deadline.getTime() - ms);
    if (trigger <= now) continue;
    const { title, body } = formatNotif(deadlineType, city, category, ms);
    specs.push({ id: key, title, body, trigger, tournamentId });
  }
}

function onsiteTimeToMs(t: OnsiteReminderTime): number {
  const n = parseInt(t);
  if (t.endsWith('h')) return n * 3600000;
  if (t.endsWith('m')) return n * 60000;
  return 0;
}

function addOnsiteReminders(
  specs: NotifSpec[],
  seenKeys: Set<string>,
  times: (OnsiteReminderTime | null)[],
  od: OnsiteDeadlineLabel,
  tournamentId: string,
  city: string,
  now: Date,
) {
  const refHour = od.refHour;
  const refDate = isoToDate(od.dateStr, refHour);

  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (!t) continue;
    const key = `onsite_${od.label.replace(/\s+/g, '_')}_${t}_${tournamentId}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const ms = onsiteTimeToMs(t);
    const trigger = new Date(refDate.getTime() - ms);
    if (trigger <= now) continue;
    const countdown = formatCountdown(ms);
    specs.push({
      id: key,
      title: `🎾 Sign-in — ${city}`,
      body: `${od.label} in ${countdown}`,
      trigger,
      tournamentId,
    });
  }
}

function buildSpecs(tournaments: any[], prefs?: NotifPrefs): NotifSpec[] {
  if (prefs?.notify_enabled === false) return [];
  const specs: NotifSpec[] = [];
  const seen = new Set<string>();
  const now = new Date();
  const cfg = prefs?.notify_reminder_config ?? DEFAULT_REMINDER_CONFIG;

  const singlesOn = prefs?.notify_singles ?? true;
  const wdOn = prefs?.notify_withdrawal ?? true;
  const fzOn = prefs?.notify_freeze ?? true;

  for (const t of tournaments) {
    if (t.isWithdrawn || t.isInMyList === false) continue;
    const city = t.city || t.name?.replace(/^[A-Z]\d+\s+/, '') || 'Tournament';
    const cat = t.category || '';

    if (singlesOn && !t.isRegistered && t.signUpDeadline) {
      addReminders(specs, seen, cfg.singles, t.signUpDeadline, 'Singles entry', 'su_', t.id, city, cat, now);
    }

    if (wdOn && t.isRegistered && t.withdrawalDeadline) {
      addReminders(specs, seen, cfg.withdrawal, t.withdrawalDeadline, 'Withdrawal', 'wd_', t.id, city, cat, now);
    }

    if (fzOn && t.freezeDeadline) {
      addReminders(specs, seen, cfg.freeze, t.freezeDeadline, 'Doubles entry', 'fz_', t.id, city, cat, now);
    }

    const onsiteEnabled = prefs?.notify_onsite_enabled ?? true;
    if (onsiteEnabled && t.startDate) {
      const onsiteDeadlines = getOnsiteDeadlines(t.startDate, t.category);
      const onsiteTimes = prefs?.notify_onsite_reminders ?? DEFAULT_ONSITE_REMINDERS;
      for (const od of onsiteDeadlines) {
        addOnsiteReminders(specs, seen, onsiteTimes, od, t.id, city, now);
      }
    }
  }

  return specs;
}

export async function rescheduleAllNotifications(tournaments: any[], prefs?: NotifPrefs): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    return;
  }
  const specs = buildSpecs(tournaments, prefs);
  for (const spec of specs) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: spec.id,
        content: {
          title: spec.title,
          body: spec.body,
          sound: 'default',
          data: { tournamentId: spec.tournamentId },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: spec.trigger,
        },
      });
    } catch {}
  }
}

export async function cancelTournamentNotifications(tournamentId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const all = await Notifications.getAllScheduledNotificationsAsync();
  const mine = all.filter(n => n.content.data?.tournamentId === tournamentId);
  await Promise.all(mine.map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

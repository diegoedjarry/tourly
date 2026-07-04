import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { ReminderConfig, ReminderTime, OnsiteReminderTime } from '@/hooks/useProfile';
import { DEFAULT_REMINDER_CONFIG, DEFAULT_ONSITE_REMINDERS } from '@/hooks/useProfile';
import { getOnsiteDeadlines, getCircuit, deadlineInstant } from '@/utils/deadlines';
import type { OnsiteDeadlineLabel, StoredDeadlineKind } from '@/utils/deadlines';
import { t as i18nT, type Lang, type StringKey } from '@/lib/i18n';

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

    // Persist the push token so remote pushes can target this device.
    try {
      const { db } = await import('@/db');
      await db.transact(
        db.tx.devices['singleton-device'].update({
          pushToken: token.data,
          platform: Platform.OS,
          updatedAt: Date.now(),
        }),
      );
    } catch {
      // Token persistence is best-effort; local notifications still work.
    }

    return token.data;
  } catch {
    return null;
  }
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

// Local wall-clock instant — for on-site deadlines expressed in tournament-local time.
function isoToDate(dateStr: string, hour = 9): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0);
}

// Stored deadlines anchor to their real closing instant via deadlineInstant():
// ITF at 14:00 GMT (per ITF rulebook), Challenger advance deadlines in US ET.

function timeToMs(t: ReminderTime): number {
  const n = parseInt(t);
  if (t.endsWith('d')) return n * 86400000;
  if (t.endsWith('h')) return n * 3600000;
  if (t.endsWith('m')) return n * 60000;
  return 0;
}

// ─── Notification text formatting ─────────────────────────────────────────────

// Translate a template key and substitute {placeholders}.
function tpl(key: StringKey, lang: Lang, params: Record<string, string | number>): string {
  let s = i18nT(key, lang);
  for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, String(v));
  return s;
}

function formatCountdown(ms: number, lang: Lang): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const hourWord = lang === 'es' ? (h > 1 ? 'horas' : 'hora') : (h > 1 ? 'hours' : 'hour');
  if (h > 0 && m > 0) return `${h} ${hourWord} ${m} min`;
  if (h > 0) return `${h} ${hourWord}`;
  return lang === 'es' ? `${m} minutos` : `${m} minutes`;
}

function formatNotif(
  deadlineType: string,
  city: string,
  category: string,
  msRemaining: number,
  lang: Lang,
): { title: string; body: string } {
  const days = Math.floor(msRemaining / 86400000);

  if (days < 1) {
    return {
      title: tpl('notif.todayTitle', lang, { city }),
      body: tpl('notif.closesIn', lang, { type: deadlineType, countdown: formatCountdown(msRemaining, lang) }),
    };
  }
  if (days === 1) {
    return {
      title: tpl('notif.tomorrowTitle', lang, { city }),
      body: `${deadlineType} · ${category}`,
    };
  }
  if (days <= 3) {
    return {
      title: tpl('notif.daysTitle', lang, { days, city }),
      body: `${deadlineType} · ${category}`,
    };
  }
  if (days <= 7) {
    return {
      title: tpl('notif.weekTitle', lang, { city }),
      body: `${deadlineType} · ${category} · ${tpl('notif.daysWord', lang, { days })}`,
    };
  }
  return {
    title: tpl('notif.upcomingTitle', lang, { city }),
    body: `${deadlineType} · ${category} · ${tpl('notif.daysWord', lang, { days })}`,
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
  lang: Lang,
  kind: StoredDeadlineKind,
) {
  // Count down to the deadline's real closing instant (ITF 14:00 GMT;
  // Challenger 12:00 PM ET / withdrawal 10:00 AM ET), independent of device timezone.
  const deadline = deadlineInstant(deadlineStr, category, kind);

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
    const { title, body } = formatNotif(deadlineType, city, category, ms, lang);
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
    const { title, body } = formatNotif(deadlineType, city, category, ms, lang);
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
  lang: Lang,
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
    const countdown = formatCountdown(ms, lang);
    specs.push({
      id: key,
      title: tpl('notif.signinTitle', lang, { city }),
      body: tpl('notif.signinBody', lang, { label: od.label, countdown }),
      trigger,
      tournamentId,
    });
  }
}

function buildSpecs(tournaments: any[], prefs?: NotifPrefs, lang: Lang = 'en'): NotifSpec[] {
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
      addReminders(specs, seen, cfg.singles, t.signUpDeadline, i18nT('notif.singlesEntry', lang), 'su_', t.id, city, cat, now, lang, 'signUp');
    }

    if (wdOn && t.isRegistered && t.withdrawalDeadline) {
      addReminders(specs, seen, cfg.withdrawal, t.withdrawalDeadline, i18nT('notif.withdrawal', lang), 'wd_', t.id, city, cat, now, lang, 'withdrawal');
    }

    if (fzOn && t.freezeDeadline) {
      addReminders(specs, seen, cfg.freeze, t.freezeDeadline, i18nT('notif.doublesEntry', lang), 'fz_', t.id, city, cat, now, lang, 'freeze');
    }

    const onsiteEnabled = prefs?.notify_onsite_enabled ?? true;
    if (onsiteEnabled && t.startDate) {
      const onsiteDeadlines = getOnsiteDeadlines(t.startDate, t.category);
      const onsiteTimes = prefs?.notify_onsite_reminders ?? DEFAULT_ONSITE_REMINDERS;
      for (const od of onsiteDeadlines) {
        addOnsiteReminders(specs, seen, onsiteTimes, od, t.id, city, now, lang);
      }
    }
  }

  return specs;
}

// Serialize reschedules: concurrent cancelAll+schedule runs can drop or duplicate
// notifications. Each call waits for the previous run to finish.
let rescheduleInFlight: Promise<void> = Promise.resolve();

export function rescheduleAllNotifications(tournaments: any[], prefs?: NotifPrefs, lang: Lang = 'en'): Promise<void> {
  rescheduleInFlight = rescheduleInFlight
    .catch(() => {})
    .then(() => doRescheduleAll(tournaments, prefs, lang));
  return rescheduleInFlight;
}

async function doRescheduleAll(tournaments: any[], prefs?: NotifPrefs, lang: Lang = 'en'): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    return;
  }
  const specs = buildSpecs(tournaments, prefs, lang);
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
    } catch {
      // Scheduling failure for one notification shouldn't abort the rest.
      console.warn('[notifications] failed to schedule', spec.id);
    }
  }
}

export async function cancelTournamentNotifications(tournamentId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const all = await Notifications.getAllScheduledNotificationsAsync();
  const mine = all.filter(n => n.content.data?.tournamentId === tournamentId);
  await Promise.all(mine.map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

// Cancels any scheduled notification whose tournamentId is not in the provided set.
// Run once on app launch to clean up orphaned notifications from tournaments deleted
// before the per-delete cancellation fix was in place.
export async function cancelOrphanedNotifications(validTournamentIds: Set<string>): Promise<void> {
  if (Platform.OS === 'web') return;
  const all = await Notifications.getAllScheduledNotificationsAsync();
  const orphans = all.filter(n => {
    const tid = n.content.data?.tournamentId as string | undefined;
    return tid !== undefined && !validTournamentIds.has(tid);
  });
  await Promise.all(orphans.map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

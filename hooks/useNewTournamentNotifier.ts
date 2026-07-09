import { useEffect } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { DEMO_MODE } from '@/config/demo';
import { useProfile, type Profile } from '@/hooks/useProfile';
import { useLanguage } from '@/hooks/useLanguage';
import { foldDiacritics, playerNameFilter } from '@/utils/text';
import { scoreTournament, type MatchContext, type MatchTournament } from '@/utils/tournament-match';

// Push notifications don't work in Expo Go on Android (SDK 53+). Skip entirely.
const isExpoGo = Constants.executionEnvironment === 'storeClient';

const SEEN_AT_KEY = 'newTournamentSeenAt';
const CHECK_AT_KEY = 'newTournamentCheckAt';
const NOTIFIED_IDS_KEY = 'newTournamentNotifiedIds';
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // at most once per 12h
const BACKFILL_MS = 7 * 24 * 60 * 60 * 1000;   // first enable: only look back 7 days
const MAX_NOTIFICATIONS = 3;
const MAX_NOTIFIED_IDS = 200; // bounded — keep only the most recent ids

// Module-level guard: the AsyncStorage throttle below is check-then-act, so two
// overlapping effect runs (fast refresh, rapid settings toggling) could both
// pass the gate and double-fire notifications without this.
let checkInFlight = false;

// Root layout calls this once (orchestrator-wired). No-op unless the player has
// explicitly opted in via profile.notify_new_tournaments — everything here must
// fail silently so a scraper hiccup or malformed profile never blocks startup.
export function useNewTournamentNotifier() {
  const { data: profile } = useProfile();
  const { lang } = useLanguage();

  useEffect(() => {
    if (Platform.OS === 'web' || isExpoGo) return;
    if (DEMO_MODE) return;
    if (!profile || profile.notify_new_tournaments !== true) return;

    let cancelled = false;

    (async () => {
      if (checkInFlight) return;
      checkInFlight = true;
      try {
        const lastCheck = await AsyncStorage.getItem(CHECK_AT_KEY);
        if (lastCheck && Date.now() - new Date(lastCheck).getTime() < CHECK_INTERVAL_MS) return;
        if (cancelled) return;
        // Claim the 12h window BEFORE any awaited network work — a failed run
        // skips one cycle, which beats duplicate pushes from a race.
        await AsyncStorage.setItem(CHECK_AT_KEY, new Date().toISOString());

        const ctx = await buildMatchContext(profile, lang);
        if (cancelled) return;

        const seenAtRaw = await AsyncStorage.getItem(SEEN_AT_KEY);
        const seenAt = seenAtRaw ?? new Date(Date.now() - BACKFILL_MS).toISOString();
        // Local calendar date, not UTC — matches the repo's local-date convention
        // (see parseLocalDate() pattern) so "today" lines up with the player's
        // actual day rather than flipping early/late in negative-offset timezones.
        const todayIso = localDateIso(new Date());

        const { data: rows, error } = await supabase
          .from('itf_tournaments')
          .select('id, name, city, country, surface, category, start_date, end_date, prize_money_total, created_at')
          .gt('created_at', seenAt)
          .gte('start_date', todayIso)
          .order('created_at', { ascending: false })
          .limit(60);

        if (error || !rows || cancelled) return;

        // Skip tournaments we've already notified about — a flaky cycle (e.g.
        // seenAt persisted but the app was killed before scheduling finished)
        // must not re-notify the same tournament on the next run.
        const notifiedIds = await readNotifiedIds();

        const matches = rows
          .filter(row => !notifiedIds.has(row.id))
          .map(row => {
            const t: MatchTournament = {
              name: row.name,
              city: row.city,
              country: row.country,
              surface: row.surface,
              category: row.category,
              start_date: row.start_date,
              prize_money_total: row.prize_money_total,
            };
            return { row, match: scoreTournament(t, ctx) };
          })
          .filter(({ match }) => match.reasons.length > 0)
          .sort((a, b) => b.match.score - a.match.score)
          .slice(0, MAX_NOTIFICATIONS);

        if (matches.length > 0) {
          const Notifications = await import('expo-notifications');
          const newlyNotified: string[] = [];
          for (const { row, match } of matches) {
            const title = lang === 'es' ? `Nuevo torneo: ${row.name}` : `New tournament: ${row.name}`;
            const reasonsJoined = match.reasons.join(' · ');
            const body = lang === 'es'
              ? `Coincide con tu perfil: ${reasonsJoined}`
              : `Matches your profile: ${reasonsJoined}`;
            try {
              await Notifications.scheduleNotificationAsync({
                content: {
                  title,
                  body,
                  sound: 'default',
                  data: { target: 'calendar' },
                },
                trigger: null,
              });
              newlyNotified.push(row.id);
            } catch {
              // One failed notification shouldn't block the rest — and it's
              // left out of newlyNotified so a future cycle can retry it.
            }
          }
          if (newlyNotified.length > 0) {
            await writeNotifiedIds(notifiedIds, newlyNotified);
          }
        }

        await AsyncStorage.setItem(SEEN_AT_KEY, new Date().toISOString());
      } catch {
        // Never let a scraper/network hiccup crash startup.
      } finally {
        checkInFlight = false;
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.notify_new_tournaments, profile?.id, lang]);
}

// Local calendar date as YYYY-MM-DD (per the repo's local-date convention —
// see utils/deadlines.ts's parseLocalDate() pattern). Deliberately NOT
// toISOString(), which is UTC and would flip "today" a day early/late for
// players in negative-offset timezones.
function localDateIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Notified-id bookkeeping ──────────────────────────────────────────────────
// Bounded record of tournament ids we've already sent a "new tournament" push
// for, so a flaky cycle (crash/kill between scheduling and persisting seenAt)
// can't re-notify the same tournaments on a later run.
async function readNotifiedIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(NOTIFIED_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

async function writeNotifiedIds(existing: Set<string>, added: string[]): Promise<void> {
  try {
    const merged = [...existing, ...added];
    // Keep only the most recent MAX_NOTIFIED_IDS — oldest entries fall off.
    const bounded = merged.slice(Math.max(0, merged.length - MAX_NOTIFIED_IDS));
    await AsyncStorage.setItem(NOTIFIED_IDS_KEY, JSON.stringify(bounded));
  } catch {
    // Best-effort — worst case a future cycle re-notifies once more.
  }
}

// Builds the scoring context from the same profiles/player_profiles accessor pattern
// used in app/my-performance.tsx (atp_player_name → player_profiles by fuzzy name match).
async function buildMatchContext(profile: Profile, lang: 'en' | 'es'): Promise<MatchContext> {
  let winBySurface: MatchContext['winBySurface'] = null;

  try {
    const atpName = profile.atp_player_name;
    if (atpName?.trim()) {
      const fullName = atpName.trim();
      const nameParts = fullName.split(/\s+/).slice(0, 2).join(' ');
      const { data: rows } = await supabase
        .from('player_profiles')
        .select('player_name, win_loss_by_surface')
        .or(playerNameFilter(nameParts))
        .order('last_updated', { ascending: false })
        .limit(5);

      if (rows && rows.length > 0) {
        const foldedFull = foldDiacritics(fullName).toLowerCase();
        const exact = rows.find((r: any) =>
          foldDiacritics((r.player_name ?? '').trim()).toLowerCase() === foldedFull);
        const row = (exact ?? rows[0]) as any;
        winBySurface = row.win_loss_by_surface ?? null;
      }
    }
  } catch {
    // No player_profiles match — surface scoring just falls back to primarySurface.
  }

  return {
    winBySurface,
    nationality: profile.nationality ?? null,
    homeCity: profile.home_city ?? null,
    primarySurface: profile.primary_surface ?? null,
    lang,
  };
}

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
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // at most once per 12h
const BACKFILL_MS = 7 * 24 * 60 * 60 * 1000;   // first enable: only look back 7 days
const MAX_NOTIFICATIONS = 3;

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
        const todayIso = new Date().toISOString().slice(0, 10);

        const { data: rows, error } = await supabase
          .from('itf_tournaments')
          .select('id, name, city, country, surface, category, start_date, end_date, prize_money_total, created_at')
          .gt('created_at', seenAt)
          .gte('start_date', todayIso)
          .order('created_at', { ascending: false })
          .limit(60);

        if (error || !rows || cancelled) return;

        const matches = rows
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
            } catch {
              // One failed notification shouldn't block the rest.
            }
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

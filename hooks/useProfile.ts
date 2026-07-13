import { Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { t as i18nT } from '@/lib/i18n';
import { getCurrentLang } from '@/hooks/useLanguage';

export type ReminderTime = '7d' | '5d' | '3d' | '2d' | '1d' | '12h' | '6h' | '2h' | '30m';
export type OnsiteReminderTime = '6h' | '5h' | '4h' | '3h' | '2h' | '1h' | '45m' | '30m' | '15m';
export const DEFAULT_ONSITE_REMINDERS: (OnsiteReminderTime | null)[] = ['5h', '2h', '30m'];
export interface ReminderConfig {
  singles: (ReminderTime | null)[];
  withdrawal: (ReminderTime | null)[];
  freeze: (ReminderTime | null)[];
}
export const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  singles: ['7d', '2d', '2h'],
  withdrawal: ['7d', '2d', '2h'],
  freeze: ['7d', '2d', '2h'],
};

export interface Profile {
  id: string;
  full_name: string | null;
  role: string | null;
  nationality: string | null;
  ranking: number | null;
  date_of_birth: string | null;
  home_city: string | null;
  annual_budget: number | null;
  primary_surface: string | null;
  travel_with_coach: string | null;
  travel_with_stringing: string | null;
  avatar_url: string | null;
  notify_enabled: boolean;
  notify_singles: boolean;
  notify_singles_reminders: number;
  notify_withdrawal: boolean;
  notify_withdrawal_reminders: number;
  notify_freeze: boolean;
  notify_freeze_reminders: number;
  notify_reminder_config: ReminderConfig | null;
  notify_onsite_enabled: boolean;
  notify_onsite_reminders: (OnsiteReminderTime | null)[];
  notify_new_tournaments: boolean;
  atp_player_name: string | null;
  language: string | null;
  onboarding_complete: boolean;
  ipin_number: string | null;
  share_expense_data: boolean;
  created_at: string;
}

const QUERY_KEY = ['profile'];

export function useProfile() {
  return useQuery({
    queryKey: QUERY_KEY,
    staleTime: 0,
    queryFn: async () => {
      // Use getSession() (reads from local storage) instead of getUser()
      // (network round-trip). The session is guaranteed to be set by the time
      // onAuthStateChange fires SIGNED_IN and we resetQueries — so this is
      // safe and avoids a second network call that could race with the session
      // not yet being fully persisted.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
  });
}

// Serializes update calls so a second mutateAsync() started before the first
// one's response lands merges against the first one's result instead of the
// same pre-update cache snapshot both calls would otherwise read. Without
// this, two quick edits (e.g. toggling two reminder rows back-to-back) each
// spread the same stale nested object (like notify_reminder_config) and
// whichever upsert resolves last silently discards the other's change.
let updateChain: Promise<any> = Promise.resolve();

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: Partial<Profile>) => {
      const result = updateChain.then(
        () => applyProfileUpdate(qc, updates),
        () => applyProfileUpdate(qc, updates), // run even if the prior update in the chain failed
      );
      // Swallow rejections in the chain itself (already surfaced to the
      // caller via the returned/thrown promise) so one failure doesn't
      // permanently wedge the chain for subsequent updates.
      updateChain = result.catch(() => {});
      return result;
    },
    onSuccess: (data) => {
      // Seed the cache with the authoritative server row immediately so the
      // next queued update's getQueryData() read (and any immediate re-render)
      // sees this result rather than stale data, then let invalidate refetch
      // in the background to reconcile with any other source of truth.
      qc.setQueryData(QUERY_KEY, data);
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: () => {
      // Several callers (e.g. Settings switches) fire-and-forget this
      // mutation without awaiting/catching it, so a failed write was
      // previously silent — the toggle looked flipped even though nothing
      // was saved. Invalidate so the next render reflects the real cached
      // value (snapping controls back to server truth) and tell the user
      // the save didn't happen instead of failing invisibly.
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      const lang = getCurrentLang();
      Alert.alert(i18nT('common.couldNotSave', lang), i18nT('common.tryAgain', lang));
    },
  });
}

async function applyProfileUpdate(qc: ReturnType<typeof useQueryClient>, updates: Partial<Profile>): Promise<Profile> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  // Merge against the freshest cached profile at mutation execution time
  // (not a render-closure snapshot the caller captured when the button was
  // pressed) so a partial update never clobbers fields — nested or
  // top-level — changed by another update that landed in between.
  const fresh = qc.getQueryData<Profile | null>(QUERY_KEY);
  // created_at is server-defaulted and never meant to be re-sent by a client
  // update — omit it from the merge base so it's never round-tripped.
  const { created_at: _createdAt, ...freshWithoutCreatedAt } = fresh ?? {};
  const payload = fresh ? { ...freshWithoutCreatedAt, ...updates } : { ...updates };
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ ...payload, id: user.id })
    .select()
    .single();
  if (error) throw error;
  return data as Profile;
}

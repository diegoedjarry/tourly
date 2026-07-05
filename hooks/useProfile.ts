import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

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

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Partial<Profile>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('profiles')
        .upsert({ id: user.id, ...updates })
        .select()
        .single();
      if (error) throw error;
      return data as Profile;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { DEMO_MODE } from '@/config/demo';
import type { Tournament } from '@/lib/database.types';

const QUERY_KEY = ['tournaments'];

export function useTournaments() {
  return useQuery({
    queryKey: QUERY_KEY,
    enabled: !DEMO_MODE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tournaments')
        .select('*')
        .order('start_date', { ascending: true });
      if (error) throw error;
      return data as Tournament[];
    },
  });
}

export function usePatchTournament() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Tournament> }) => {
      const { error } = await supabase.from('tournaments').update(updates).eq('id', id);
      if (error) throw error;
    },
    onMutate: async ({ id, updates }) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const previous = qc.getQueryData<Tournament[]>(QUERY_KEY);
      qc.setQueryData<Tournament[]>(QUERY_KEY, old =>
        old?.map(t => t.id === id ? { ...t, ...updates } : t) ?? []
      );
      return { previous };
    },
    onError: (_, __, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUERY_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useAddTournament() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tournament: Omit<Tournament, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('tournaments')
        .insert({ ...tournament, user_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data as Tournament;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

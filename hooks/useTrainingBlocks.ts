import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { DEMO_MODE } from '@/config/demo';
import type { TrainingBlock } from '@/lib/database.types';

const QUERY_KEY = ['training_blocks'];

export function useTrainingBlocks() {
  return useQuery({
    queryKey: QUERY_KEY,
    enabled: !DEMO_MODE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('training_blocks')
        .select('*')
        .order('start_date', { ascending: true });
      if (error) throw error;
      return data as TrainingBlock[];
    },
  });
}

export function useAddTrainingBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (block: { title: string; start_date: string; end_date: string; note?: string | null }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('training_blocks')
        .insert({ ...block, user_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data as TrainingBlock;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useDeleteTrainingBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('training_blocks').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

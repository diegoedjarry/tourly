import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useReflections(periodType: 'weekly' | 'monthly') {
  return useQuery({
    queryKey: ['reflections', periodType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reflections')
        .select('*')
        .eq('period_type', periodType)
        .order('created_at', { ascending: false })
        .limit(3);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useGenerateReflection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (periodType: 'weekly' | 'monthly') => {
      const { data, error } = await supabase.functions.invoke('generate-reflection', {
        body: { period_type: periodType },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, periodType) => qc.invalidateQueries({ queryKey: ['reflections', periodType] }),
  });
}

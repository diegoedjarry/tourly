import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useLatestCoaching() {
  return useQuery({
    queryKey: ['coaching'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coaching_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 1000 * 60 * 60 * 6,
  });
}

export function useGenerateCoaching() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('generate-coaching');
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coaching'] }),
  });
}

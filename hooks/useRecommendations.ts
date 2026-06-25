import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface Recommendation {
  title: string;
  explanation: string;
  impact: 'high' | 'medium' | 'low';
  icon: string;
}

const QUERY_KEY = ['recommendations'];

export function useRecommendations() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return [];

      const { data, error } = await supabase.functions.invoke('recommend-tournaments', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) throw error;
      return (data?.recommendations ?? []) as Recommendation[];
    },
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 48,
    retry: 1,
  });
}

export function useRefreshRecommendations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('recommend-tournaments', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) throw error;
      const recs = (data?.recommendations ?? []) as Recommendation[];
      qc.setQueryData(QUERY_KEY, recs);
      return recs;
    },
  });
}

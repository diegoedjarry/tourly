import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface SharedAccess {
  id: string;
  owner_id: string;
  shared_with_email: string;
  shared_with_id: string | null;
  role: string;
  status: string;
  created_at: string;
  accepted_at: string | null;
}

const QUERY_KEY = ['shared_access'];

export function useMyShares() {
  return useQuery({
    queryKey: [...QUERY_KEY, 'mine'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('shared_access')
        .select('*')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as SharedAccess[];
    },
  });
}

export function useSharedWithMe() {
  return useQuery({
    queryKey: [...QUERY_KEY, 'with_me'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('shared_access')
        .select('*')
        .eq('shared_with_email', user.email)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as SharedAccess[];
    },
  });
}

export function useInviteShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (email: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('shared_access')
        .upsert({
          owner_id: user.id,
          shared_with_email: email.toLowerCase().trim(),
          role: 'viewer',
          status: 'pending',
        })
        .select()
        .single();
      if (error) throw error;
      return data as SharedAccess;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (shareId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('shared_access')
        .update({ status: 'accepted', shared_with_id: user.id, accepted_at: new Date().toISOString() })
        .eq('id', shareId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useRevokeShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (shareId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('shared_access')
        .delete()
        .eq('id', shareId)
        .eq('owner_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useSharedData(ownerId: string | null) {
  return useQuery({
    queryKey: ['shared_data', ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      if (!ownerId) return null;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: share } = await supabase
        .from('shared_access')
        .select('id')
        .eq('owner_id', ownerId)
        .eq('shared_with_id', user.id)
        .eq('status', 'accepted')
        .maybeSingle();
      if (!share) throw new Error('Access denied');

      const [tournamentsRes, expensesRes, profileRes] = await Promise.all([
        supabase.from('shared_tournaments').select('*').eq('user_id', ownerId).eq('shared_with_id', user.id),
        supabase.from('shared_expenses').select('*').eq('user_id', ownerId).eq('shared_with_id', user.id),
        supabase.from('profiles').select('full_name, ranking, nationality').eq('id', ownerId).maybeSingle(),
      ]);
      if (tournamentsRes.error) throw tournamentsRes.error;
      if (expensesRes.error) throw expensesRes.error;
      if (profileRes.error) throw profileRes.error;
      return {
        tournaments: tournamentsRes.data ?? [],
        expenses: expensesRes.data ?? [],
        profile: profileRes.data,
      };
    },
  });
}

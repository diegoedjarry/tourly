import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { DEMO_MODE } from '@/config/demo';
import type { Expense } from '@/lib/database.types';

const QUERY_KEY = ['expenses'];

export function useExpenses() {
  return useQuery({
    queryKey: QUERY_KEY,
    enabled: !DEMO_MODE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .order('date', { ascending: false });
      if (error) throw error;
      return data as Expense[];
    },
  });
}

export function useAddExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (expense: Omit<Expense, 'id' | 'user_id' | 'created_at'>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('expenses')
        .insert({ ...expense, user_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data as Expense;
    },
    onMutate: async (expense) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const previous = qc.getQueryData<Expense[]>(QUERY_KEY);
      const optimistic: Expense = {
        ...expense,
        id: `optimistic-${Date.now()}`,
        user_id: '',
        created_at: new Date().toISOString(),
        tournament_id: expense.tournament_id ?? null,
        note: expense.note ?? null,
      };
      qc.setQueryData<Expense[]>(QUERY_KEY, old => [optimistic, ...(old ?? [])]);
      return { previous };
    },
    onError: (_, __, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUERY_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

import { useQuery } from '@tanstack/react-query';
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

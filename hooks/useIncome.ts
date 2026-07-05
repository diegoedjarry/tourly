import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { DEMO_MODE } from '@/config/demo';
import type { Income } from '@/lib/database.types';

const QUERY_KEY = ['income'];

export interface IncomeRecord {
  id: string;
  source: string | null;
  type: 'sponsor' | 'federation' | 'stipend' | 'other';
  amount: number;
  currency: string;
  amountUsd: number | null;
  date: string;
  note: string | null;
  createdAt: string;
}

function mapIncome(i: Income): IncomeRecord {
  return {
    id: i.id,
    source: i.source,
    type: i.type,
    amount: i.amount,
    currency: i.currency,
    amountUsd: i.amount_usd,
    date: i.date,
    note: i.note,
    createdAt: i.created_at,
  };
}

export function useIncome() {
  return useQuery({
    queryKey: QUERY_KEY,
    enabled: !DEMO_MODE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('income')
        .select('*')
        .order('date', { ascending: false });
      if (error) throw error;
      return (data as Income[]).map(mapIncome);
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

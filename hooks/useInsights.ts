import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { DEMO_MODE } from '@/config/demo';
import { selectInsight, hasEnoughData } from '@/utils/insights';

export interface Insight {
  id: string;
  insight_type: string;
  insight_label: string;
  content: string;
  trigger_event: string;
  generated_at: string;
}

const DEMO_INSIGHTS: Insight[] = [
  {
    id: 'demo-1',
    insight_type: 'surface_cost_efficiency',
    insight_label: 'SURFACE COST',
    content: "Clay is your most affordable surface at $620 average vs $940 on hard court. Your clay results also generate more prize money on average.",
    trigger_event: 'daily',
    generated_at: new Date().toISOString(),
  },
  {
    id: 'demo-2',
    insight_type: 'weekly_recap',
    insight_label: 'WEEKLY RECAP',
    content: 'Last week in Buenos Aires you spent $740. Your biggest cost was Accommodation at $430.',
    trigger_event: 'monday',
    generated_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'demo-3',
    insight_type: 'prize_coverage',
    insight_label: 'PRIZE COVERAGE',
    content: 'Prize money covers 34% of your total expenses this season. You have earned $3,200 against $9,400 in costs.',
    trigger_event: 'daily',
    generated_at: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
];

export function useInsights() {
  const query = useQuery({
    queryKey: ['insights'],
    enabled: !DEMO_MODE,
    queryFn: async () => {
      console.log('[insights] fetching from Supabase...');
      const { data, error } = await supabase
        .from('insights')
        .select('*')
        .order('generated_at', { ascending: false })
        .limit(10);
      if (error) {
        console.error('[insights] fetch error:', error.message);
        throw error;
      }
      console.log('[insights] fetched', data?.length ?? 0, 'insights');
      return (data ?? []) as Insight[];
    },
    staleTime: 1000 * 60 * 30,
  });

  if (DEMO_MODE) {
    console.log('[insights] DEMO_MODE on — using demo data');
    return { ...query, data: DEMO_INSIGHTS, isLoading: false };
  }
  return query;
}

export function useGenerateInsight() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      tournaments?: any[];
      expenses?: any[];
      trigger?: string;
    }) => {
      if (DEMO_MODE) {
        console.log('[insights] DEMO_MODE — skipping generation');
        return null;
      }

      // Callers that only pass a trigger (e.g. "expense_logged") fall back to
      // the current react-query cache for the data-sufficiency check.
      const tournaments = params.tournaments ?? qc.getQueryData<any[]>(['tournaments']) ?? [];
      const expenses = params.expenses ?? qc.getQueryData<any[]>(['expenses']) ?? [];

      console.log('[insights] checking data sufficiency:', tournaments.length, 'tournaments,', expenses.length, 'expenses');

      if (!hasEnoughData(tournaments, expenses)) {
        console.log('[insights] not enough data — need 2+ tournaments and 5+ expenses');
        return null;
      }

      // Get current user
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        console.error('[insights] auth error or no user:', authError?.message);
        return null;
      }
      console.log('[insights] generating for user:', user.id);

      // Fetch recent insights to respect cooldowns
      const { data: recent, error: recentError } = await supabase
        .from('insights')
        .select('insight_type, generated_at')
        .eq('user_id', user.id)
        .order('generated_at', { ascending: false })
        .limit(20);

      if (recentError) console.warn('[insights] could not fetch recent:', recentError.message);

      const recentMapped = (recent ?? []).map((r: any) => ({
        type: r.insight_type,
        generated_at: r.generated_at,
      }));

      const forceMonday = params.trigger === 'monday';
      const result = selectInsight(tournaments, expenses, recentMapped, forceMonday);

      if (!result) {
        console.log('[insights] selectInsight returned null — all on cooldown or no data');
        return null;
      }

      console.log('[insights] selected insight type:', result.type);

      const { data, error } = await supabase
        .from('insights')
        .insert({
          user_id: user.id,
          insight_type: result.type,
          insight_label: result.label,
          content: result.text,
          trigger_event: params.trigger ?? 'daily',
        })
        .select()
        .single();

      if (error) {
        console.error('[insights] insert error:', error.message, error.details);
        throw error;
      }

      console.log('[insights] saved insight:', data.id);
      return data;
    },
    onSuccess: (data) => {
      if (data) qc.invalidateQueries({ queryKey: ['insights'] });
    },
  });
}

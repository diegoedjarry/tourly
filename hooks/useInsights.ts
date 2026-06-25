import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { DEMO_MODE } from '@/config/demo';

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
    id: 'demo-insight-1',
    insight_type: 'surface_roi',
    insight_label: 'SURFACE ROI',
    content: "Your clay court results are your strongest this season — you're netting an average of $620 more per clay event compared to hard courts. With four clay tournaments coming up, you're well-positioned for a strong financial stretch.",
    trigger_event: 'daily',
    generated_at: new Date().toISOString(),
  },
  {
    id: 'demo-insight-2',
    insight_type: 'weekly_recap',
    insight_label: 'WEEKLY RECAP',
    content: 'Last week you spent $740 across Buenos Aires — accommodation took 58% of that budget. Your prize money covered 71% of total costs, your best coverage ratio in the last six weeks.',
    trigger_event: 'monday',
    generated_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'demo-insight-3',
    insight_type: 'biggest_cost_category',
    insight_label: 'SPENDING PATTERN',
    content: 'Flights account for 41% of your total spending this season at an average of $395 per tournament. Booking 30+ days in advance for your South American legs could save around $120 per trip.',
    trigger_event: 'daily',
    generated_at: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: 'demo-insight-4',
    insight_type: 'season_net_position',
    insight_label: 'SEASON NET',
    content: "You're currently $1,850 net positive on the year — one of your best starts financially. Maintaining your current prize coverage ratio of 68% through the clay season would push you past $3,000 net by July.",
    trigger_event: 'daily',
    generated_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: 'demo-insight-5',
    insight_type: 'geographic_efficiency',
    insight_label: 'GEOGRAPHIC ROI',
    content: 'South American events are your most cost-efficient region — you average $310 in expenses per $100 of prize money there, vs $480 in Europe. Prioritizing the South American clay swing makes strong financial sense.',
    trigger_event: 'daily',
    generated_at: new Date(Date.now() - 4 * 86400000).toISOString(),
  },
];

export function useInsights() {
  const query = useQuery({
    queryKey: ['insights'],
    enabled: !DEMO_MODE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('insights')
        .select('*')
        .order('generated_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as Insight[];
    },
    staleTime: 1000 * 60 * 30,
  });

  if (DEMO_MODE) {
    return { ...query, data: DEMO_INSIGHTS, isLoading: false };
  }

  return query;
}

export function useGenerateInsight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params?: { trigger?: string; forced_type?: string }) => {
      if (DEMO_MODE) return null;
      const { data, error } = await supabase.functions.invoke('generate-insight', {
        body: params ?? { trigger: 'daily' },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['insights'] }),
  });
}

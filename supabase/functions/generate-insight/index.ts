import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

const INSIGHT_TYPES = [
  { type: 'weekly_recap',              label: 'WEEKLY RECAP',       desc: 'Summary of last week\'s spending and earnings' },
  { type: 'tournament_roi',            label: 'TOURNAMENT ROI',     desc: 'Net result after a specific tournament ends' },
  { type: 'season_net_position',       label: 'SEASON NET',         desc: 'Total net up/down for the year so far' },
  { type: 'best_worst_tournament',     label: 'BEST VS WORST',      desc: 'Most and least profitable tournament this year' },
  { type: 'monthly_burn_rate',         label: 'BURN RATE',          desc: 'Monthly spending rate and projection to year end' },
  { type: 'prize_money_percentage',    label: 'PRIZE COVERAGE',     desc: 'What % of costs prize money is covering' },
  { type: 'break_even_analysis',       label: 'BREAK EVEN',         desc: 'Rounds needed to break even per category (M15/M25)' },
  { type: 'biggest_cost_category',     label: 'SPENDING PATTERN',   desc: 'Which expense category dominates spending' },
  { type: 'coach_travel_impact',       label: 'COACH IMPACT',       desc: 'Cost and prize money comparison with/without coach' },
  { type: 'hotel_vs_airbnb',           label: 'ACCOMMODATION',      desc: 'Hotel vs Airbnb average cost comparison' },
  { type: 'most_expensive_country',    label: 'COST BY COUNTRY',    desc: 'Which countries cost most per trip' },
  { type: 'spending_spike_alert',      label: 'SPENDING ALERT',     desc: 'When weekly spending is 40%+ above average' },
  { type: 'equipment_trend',           label: 'EQUIPMENT TREND',    desc: 'Monthly equipment/strings spending trend' },
  { type: 'surface_roi',               label: 'SURFACE ROI',        desc: 'Clay vs hard vs grass net results compared' },
  { type: 'tournament_category_analysis', label: 'CATEGORY ANALYSIS', desc: 'M15 vs M25 financial performance' },
  { type: 'geographic_efficiency',     label: 'GEOGRAPHIC ROI',     desc: 'Which regions give best prize-to-cost ratio' },
  { type: 'tournament_frequency',      label: 'TOURNAMENT COST',    desc: 'Average cost per tournament this season' },
  { type: 'optimal_calendar',          label: 'OPTIMAL MONTHS',     desc: 'Most financially efficient months based on data' },
  { type: 'withdrawal_cost_analysis',  label: 'WITHDRAWAL SAVINGS', desc: 'Tournaments withdrawn from and estimated savings' },
  { type: 'personal_milestone',        label: 'MILESTONE',          desc: 'Celebrates tracking achievements' },
  { type: 'progress_comparison',       label: 'YEAR OVER YEAR',     desc: 'This month vs same month last year if data exists' },
  { type: 'consistency_insight',       label: 'CONSISTENCY',        desc: 'Consecutive tournaments with expenses tracked' },
  { type: 'season_summary',            label: 'SEASON SUMMARY',     desc: 'Comprehensive financial report for the season' },
  { type: 'best_decision',             label: 'BEST DECISION',      desc: 'Best financial decision made recently' },
  { type: 'upcoming_cost_estimate',    label: 'COST ESTIMATE',      desc: 'Estimated cost for next tournament based on past similar trips' },
  { type: 'budget_remaining',          label: 'BUDGET OUTLOOK',     desc: 'Estimated budget remaining based on planned schedule' },
  { type: 'ranking_vs_cost',           label: 'RANKING EFFICIENCY', desc: 'Ranking points relative to money spent' },
  { type: 'offseason_recommendation',  label: 'OFFSEASON TIPS',     desc: 'Data-based suggestion on when to reduce frequency' },
];

const VALID_TRIGGERS = ['daily', 'monday', 'tournament_ended', 'expense_logged'];
const VALID_TYPES = INSIGHT_TYPES.map(t => t.type);

function getServiceRoleKey(): string | undefined {
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      const key = parsed.default ?? Object.values(parsed)[0];
      if (key) return key as string;
    } catch {}
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
}

serve(async (req) => {
  try {
    // Validate required environment variables before any work
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = getServiceRoleKey();
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) {
      console.error('[generate-insight] Missing required environment variables');
      return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    // --- Rate limiting: 1 insight per user per 60 minutes ---
    const { data: lastInsight } = await supabase
      .from('insights')
      .select('generated_at')
      .eq('user_id', user.id)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastInsight) {
      const minutesSince = (Date.now() - new Date(lastInsight.generated_at).getTime()) / 60000;
      if (minutesSince < 60) {
        return new Response(
          JSON.stringify({ cooldown: true, minutesRemaining: Math.ceil(60 - minutesSince) }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    const body = await req.json().catch(() => ({}));

    // --- Validate and allowlist user-controlled inputs ---
    const trigger: string = VALID_TRIGGERS.includes(body.trigger) ? body.trigger : 'daily';
    const forcedType: string | null = (body.forced_type && VALID_TYPES.includes(body.forced_type))
      ? body.forced_type
      : null;

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const oneYearAgoStr = oneYearAgo.toISOString().split('T')[0];

    const [tournamentsRes, expensesRes, recentInsightsRes] = await Promise.all([
      supabase
        .from('tournaments')
        .select('*')
        .eq('user_id', user.id)
        .gte('start_date', oneYearAgoStr)
        .order('start_date', { ascending: false }),
      supabase
        .from('expenses')
        .select('*')
        .eq('user_id', user.id)
        .gte('date', oneYearAgoStr)
        .order('date', { ascending: false }),
      supabase
        .from('insights')
        .select('insight_type, generated_at')
        .eq('user_id', user.id)
        .order('generated_at', { ascending: false })
        .limit(20),
    ]);

    const tournaments = tournamentsRes.data ?? [];
    const expenses = expensesRes.data ?? [];
    const recentInsights = recentInsightsRes.data ?? [];

    // Enrich tournament summaries with expense breakdowns
    const tournamentSummaries = tournaments.map((t: any) => {
      const tExpenses = expenses.filter((e: any) => e.tournament_id === t.id);
      const spent = tExpenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
      const prize = (t.singles_prize_money ?? 0) + (t.doubles_prize_money ?? 0) + (t.prize_money ?? 0);
      const byCategory: Record<string, number> = {};
      tExpenses.forEach((e: any) => { byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount; });
      return {
        name: t.name,
        surface: t.surface,
        country: t.country,
        category: t.category,
        startDate: t.start_date,
        endDate: t.end_date,
        isWithdrawn: t.is_withdrawn,
        spent,
        prize,
        net: prize - spent,
        expensesByCategory: byCategory,
        hasCoachExpenses: tExpenses.some((e: any) => e.is_coach_expense),
      };
    });

    const totalExpenses = expenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
    const totalPrize = tournaments.reduce((s: number, t: any) =>
      s + (t.singles_prize_money ?? 0) + (t.doubles_prize_money ?? 0) + (t.prize_money ?? 0), 0);

    const expenseByCategory: Record<string, number> = {};
    expenses.forEach((e: any) => {
      expenseByCategory[e.category] = (expenseByCategory[e.category] ?? 0) + e.amount;
    });

    // Weekly spending for spike detection
    const weeklySpending: Record<string, number> = {};
    expenses.forEach((e: any) => {
      if (!e.date) return;
      const d = new Date(e.date + 'T00:00:00');
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      const key = monday.toISOString().split('T')[0];
      weeklySpending[key] = (weeklySpending[key] ?? 0) + e.amount;
    });
    const weekValues = Object.values(weeklySpending) as number[];
    const avgWeekly = weekValues.length > 1
      ? weekValues.slice(1).reduce((a: number, b: number) => a + b, 0) / (weekValues.length - 1)
      : 0;

    const currentDay = today.getDay();
    const currentMonday = new Date(today);
    currentMonday.setDate(today.getDate() - (currentDay === 0 ? 6 : currentDay - 1));
    const currentWeekKey = currentMonday.toISOString().split('T')[0];
    const currentWeekSpending = weeklySpending[currentWeekKey] ?? 0;
    const spikePct = avgWeekly > 0 ? Math.round(((currentWeekSpending / avgWeekly) - 1) * 100) : 0;

    const recentlyShownTypes = recentInsights.map((i: any) => i.insight_type);
    const dayOfWeek = today.toLocaleDateString('en-US', { weekday: 'long' });
    const coverageRate = totalExpenses > 0 ? ((totalPrize / totalExpenses) * 100).toFixed(0) : '0';

    const categoryLines = Object.entries(expenseByCategory)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .map(([cat, amt]) => `  ${cat}: $${(amt as number).toFixed(0)} (${totalExpenses > 0 ? (((amt as number) / totalExpenses) * 100).toFixed(0) : 0}%)`)
      .join('\n');

    const dataContext = `TODAY: ${todayStr} (${dayOfWeek})

SEASON TOTALS (last 12 months):
  Total expenses: $${totalExpenses.toFixed(0)}
  Total prize money: $${totalPrize.toFixed(0)}
  Net position: ${totalPrize >= totalExpenses ? '+' : ''}$${(totalPrize - totalExpenses).toFixed(0)}
  Tournaments tracked: ${tournaments.length}
  Prize coverage rate: ${coverageRate}%

EXPENSE BREAKDOWN BY CATEGORY:
${categoryLines || '  (no expenses yet)'}

WEEKLY SPENDING:
  Historical average: $${avgWeekly.toFixed(0)}/week
  Current week: $${currentWeekSpending.toFixed(0)}${spikePct >= 40 ? ` ⚠️ ${spikePct}% above average` : ''}

TOURNAMENT RESULTS (most recent first, up to 15):
${JSON.stringify(tournamentSummaries.slice(0, 15), null, 2)}

RECENTLY SHOWN INSIGHT TYPES (avoid repeating): ${recentlyShownTypes.slice(0, 10).join(', ') || 'none yet'}`;

    const insightTypeList = INSIGHT_TYPES.map(t => `  ${t.type} | ${t.label} | ${t.desc}`).join('\n');

    const triggerGuidance: Record<string, string> = {
      monday: 'It is Monday — strongly prefer weekly_recap if last week data exists, otherwise choose most impactful.',
      tournament_ended: 'A tournament just ended — strongly prefer tournament_roi to analyze net result.',
      expense_logged: 'An expense was just logged — consider spending_spike_alert if current week is elevated (40%+ above average), otherwise choose most relevant.',
      daily: 'Regular daily insight — choose the most interesting and actionable type based on the data right now.',
    };

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    let prompt: string;

    if (forcedType) {
      const typeInfo = INSIGHT_TYPES.find(t => t.type === forcedType);
      const label = typeInfo?.label ?? forcedType.replace(/_/g, ' ').toUpperCase();
      prompt = `Generate a "${forcedType}" (${label}) insight for this professional tennis player on the ITF World Tennis Tour.

Return JSON only (no markdown): {"insight_type": "${forcedType}", "insight_label": "${label}", "content": "<2-3 sentence insight>"}

Rules:
- Reference specific numbers from the player's data
- Conversational tone, like a smart financial coach who knows them personally
- 2-3 sentences maximum
- If insufficient data exists for this type, generate the most useful available insight instead and update the type/label accordingly

Player data:
${dataContext}`;
    } else {
      prompt = `You are a financial coach for a professional tennis player on the ITF World Tennis Tour. Choose the single most relevant insight type from the list and generate it.

Trigger context: ${triggerGuidance[trigger] ?? triggerGuidance['daily']}

Available insight types:
${insightTypeList}

Return JSON only (no markdown): {"insight_type": "<type>", "insight_label": "<LABEL>", "content": "<2-3 sentence insight>"}

Rules:
- Choose the type with the most interesting and actionable data RIGHT NOW
- Reference specific numbers from the player's actual data
- Conversational, warm tone — like a coach who knows them well
- 2-3 sentences, never generic
- Avoid repeating recently shown types: ${recentlyShownTypes.slice(0, 10).join(', ') || 'none'}

Player data:
${dataContext}`;
    }

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 400,
      system: 'You are a financial coaching AI for professional tennis players. Generate specific, data-driven insights in conversational English. Respond with valid JSON only — no markdown, no code blocks, no explanation.',
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`Invalid Claude response: ${raw.slice(0, 200)}`);

    const { insight_type, insight_label, content } = JSON.parse(jsonMatch[0]);
    if (!insight_type || !insight_label || !content) throw new Error('Incomplete Claude response fields');

    const { data: saved, error: saveError } = await supabase
      .from('insights')
      .insert({ user_id: user.id, insight_type, insight_label, content, trigger_event: trigger })
      .select()
      .single();

    if (saveError) throw new Error(`DB save: ${saveError.message}`);

    return new Response(JSON.stringify(saved), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[generate-insight]', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

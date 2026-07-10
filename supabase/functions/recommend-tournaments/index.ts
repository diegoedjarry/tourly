import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

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
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = getServiceRoleKey();
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }

    // --- Rate limiting: 1 recommendation per user per 60 minutes ---
    const { data: lastRec } = await supabase
      .from('insights')
      .select('generated_at')
      .eq('user_id', user.id)
      .eq('trigger_event', 'recommendation')
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastRec) {
      const minutesSince = (Date.now() - new Date(lastRec.generated_at).getTime()) / 60000;
      if (minutesSince < 60) {
        return new Response(
          JSON.stringify({ cooldown: true, minutesRemaining: Math.ceil(60 - minutesSince) }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    const [profileRes, tournamentsRes, expensesRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      supabase.from('tournaments').select('*').eq('user_id', user.id).order('start_date', { ascending: false }).limit(50),
      supabase.from('expenses').select('*').eq('user_id', user.id).order('date', { ascending: false }).limit(200),
    ]);

    const profile = profileRes.data;
    const tournaments = tournamentsRes.data ?? [];
    const expenses = expensesRes.data ?? [];

    const totalSpent = expenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
    const avgPerTournament = tournaments.length > 0 ? Math.round(totalSpent / tournaments.length) : 0;

    const surfaceResults: Record<string, { spent: number; prize: number; count: number }> = {};
    for (const t of tournaments) {
      const sf = t.surface ?? 'unknown';
      if (!surfaceResults[sf]) surfaceResults[sf] = { spent: 0, prize: 0, count: 0 };
      surfaceResults[sf].count++;
      surfaceResults[sf].prize += (t.singles_prize_money ?? 0) + (t.doubles_prize_money ?? 0);
      const tExpenses = expenses.filter((e: any) => e.tournament_id === t.id);
      surfaceResults[sf].spent += tExpenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
    }

    const countryResults: Record<string, { spent: number; prize: number; count: number }> = {};
    for (const t of tournaments) {
      const c = t.country ?? 'unknown';
      if (!countryResults[c]) countryResults[c] = { spent: 0, prize: 0, count: 0 };
      countryResults[c].count++;
      countryResults[c].prize += (t.singles_prize_money ?? 0) + (t.doubles_prize_money ?? 0);
      const tExpenses = expenses.filter((e: any) => e.tournament_id === t.id);
      countryResults[c].spent += tExpenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
    }

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const prompt = `You are a tournament strategy advisor for a professional tennis player on the ITF World Tennis Tour circuit.

Player profile:
- Ranking: ${profile?.ranking ?? 'Unknown'}
- Primary surface: ${profile?.primary_surface ?? 'Unknown'}
- Annual budget: $${profile?.annual_budget ?? 'Unknown'}
- Nationality: ${profile?.nationality ?? 'Unknown'}
- Average cost per tournament: $${avgPerTournament}

Surface performance (net = prize - expenses):
${Object.entries(surfaceResults).map(([sf, r]) => `- ${sf}: ${r.count} tournaments, net $${r.prize - r.spent}`).join('\n')}

Country performance:
${Object.entries(countryResults).map(([c, r]) => `- ${c}: ${r.count} tournaments, net $${r.prize - r.spent}`).join('\n')}

Based on this data, provide 3-5 specific tournament recommendations. For each, include:
1. A recommendation title (e.g. "Focus on clay in South America")
2. A brief explanation (2-3 sentences)
3. An impact tag: "high", "medium", or "low"

Respond ONLY in valid JSON format:
{
  "recommendations": [
    {
      "title": "...",
      "explanation": "...",
      "impact": "high|medium|low",
      "icon": "emoji"
    }
  ]
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { recommendations: [] };

    // Record for rate limiting
    await supabase.from('insights').insert({
      user_id: user.id,
      insight_type: 'tournament_recommendation',
      insight_label: 'RECOMMENDATIONS',
      content: JSON.stringify(parsed.recommendations?.map((r: any) => r.title) ?? []),
      trigger_event: 'recommendation',
    });

    return new Response(JSON.stringify(parsed), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[recommend-tournaments]', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});

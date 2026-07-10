import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 204 });
  }

  try {
    // Validate required environment variables before any work
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = getServiceRoleKey();
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) {
      console.error('[generate-reflection] Missing required environment variables');
      return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      SUPABASE_URL,
      SERVICE_ROLE_KEY,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const period_type: 'weekly' | 'monthly' = body.period_type === 'monthly' ? 'monthly' : 'weekly';

    // --- Rate limiting: 1 reflection per period_type per user per 60 minutes ---
    const { data: lastReflection } = await supabase
      .from('reflections')
      .select('created_at')
      .eq('user_id', user.id)
      .eq('period_type', period_type)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastReflection) {
      const minutesSince = (Date.now() - new Date(lastReflection.created_at).getTime()) / 60000;
      if (minutesSince < 60) {
        return new Response(
          JSON.stringify({ cooldown: true, minutesRemaining: Math.ceil(60 - minutesSince) }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    const now = new Date();
    let dateStart: string;
    let dateEnd: string;
    let period_label: string;

    if (period_type === 'weekly') {
      const day = now.getDay();
      const mon = new Date(now);
      mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      mon.setHours(0, 0, 0, 0);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      dateStart = mon.toISOString().slice(0, 10);
      dateEnd = sun.toISOString().slice(0, 10);
      const monLabel = mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      period_label = `Week of ${monLabel}`;
    } else {
      const y = now.getFullYear();
      const m = now.getMonth();
      dateStart = new Date(y, m, 1).toISOString().slice(0, 10);
      dateEnd = new Date(y, m + 1, 0).toISOString().slice(0, 10);
      period_label = `${MONTH_NAMES[m]} ${y}`;
    }

    // Always filter by user_id — defense in depth on top of RLS
    const { data: expenses } = await supabase
      .from('expenses')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', dateStart)
      .lte('date', dateEnd);

    const { data: tournaments } = await supabase
      .from('tournaments')
      .select('*')
      .eq('user_id', user.id)
      .gte('start_date', dateStart)
      .lte('start_date', dateEnd);

    const totalSpent = (expenses ?? []).reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
    const totalPrize = (tournaments ?? []).reduce((s: number, t: any) => {
      const singles = t.singles_prize_money ?? 0;
      const doubles = t.doubles_prize_money ?? 0;
      return s + (singles + doubles > 0 ? singles + doubles : (t.prize_money ?? 0));
    }, 0);
    const net = totalPrize - totalSpent;

    const categoryTotals: Record<string, number> = {};
    for (const e of (expenses ?? [])) {
      const cat = e.category ?? 'other';
      categoryTotals[cat] = (categoryTotals[cat] ?? 0) + (e.amount ?? 0);
    }
    const topCategories = Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cat, amt]) => `${cat} $${amt.toFixed(0)}`)
      .join(', ') || 'no expenses';

    const tournamentNames = (tournaments ?? []).map((t: any) => t.name).join(', ');
    const tournamentSummary = (tournaments ?? []).length > 0
      ? `${(tournaments ?? []).length} tournament(s): ${tournamentNames}`
      : 'no tournaments';

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 250,
      messages: [
        {
          role: 'user',
          content: `You are a financial performance analyst for a professional tennis player on the ITF circuit.

${period_type === 'weekly' ? 'This week' : 'This month'} (${period_label}):
- Tournaments: ${tournamentSummary}
- Total expenses: $${totalSpent.toFixed(0)}
- Top spending categories: ${topCategories}
- Prize money earned: $${totalPrize.toFixed(0)}
- Net result: ${net >= 0 ? '+' : ''}$${net.toFixed(0)}

Write a reflection summary (3-4 sentences) that:
1. Opens with the key financial outcome
2. Notes 1-2 specific spending patterns worth knowing
3. Ends with a concrete, forward-looking insight for the next ${period_type === 'weekly' ? 'week' : 'month'}

Tone: like a smart coach who knows the financial reality of the circuit — honest but encouraging. No bullet points.`,
        },
      ],
    });

    const summary = (response.content[0] as any).text as string;

    const { data: inserted, error: insertError } = await supabase
      .from('reflections')
      .insert({ user_id: user.id, period_type, period_label, summary })
      .select()
      .single();

    if (insertError) throw insertError;

    return new Response(JSON.stringify({ reflection: inserted }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[generate-reflection]', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

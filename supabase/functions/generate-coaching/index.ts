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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 204 });
  }

  try {
    // Validate required environment variables before any work
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = getServiceRoleKey();
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) {
      console.error('[generate-coaching] Missing required environment variables');
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

    // --- Rate limiting: 1 coaching message per user per 6 hours ---
    const { data: lastCoaching } = await supabase
      .from('coaching_messages')
      .select('created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastCoaching) {
      const minutesSince = (Date.now() - new Date(lastCoaching.created_at).getTime()) / 60000;
      if (minutesSince < 360) {
        return new Response(
          JSON.stringify({ cooldown: true, minutesRemaining: Math.ceil(360 - minutesSince) }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Always filter by user_id — defense in depth on top of RLS
    const { data: expenses } = await supabase
      .from('expenses')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', thirtyDaysAgo);

    const { data: tournaments } = await supabase
      .from('tournaments')
      .select('*')
      .eq('user_id', user.id)
      .gte('start_date', thirtyDaysAgo);

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
      .join(', ');
    const categoryBreakdown = topCategories || 'no expenses yet';

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 150,
      messages: [
        {
          role: 'user',
          content: `You are a performance coach for professional tennis players on the ITF World Tennis Tour circuit.

The player's last 30 days:
- Tournaments: ${(tournaments ?? []).length}
- Total expenses: $${totalSpent.toFixed(0)}
- Breakdown: ${categoryBreakdown}
- Prize money: $${totalPrize.toFixed(0)}
- Net: $${net.toFixed(0)}

Write a single coaching nudge (2-3 sentences, max 60 words) that:
1. Is specific to THEIR numbers, not generic
2. Congratulates smart spending or gently nudges improvement
3. Feels warm and human, not robotic
4. References the reality of the tennis circuit

No greetings, no sign-offs. Just the message.`,
        },
      ],
    });

    const message = (response.content[0] as any).text as string;

    await supabase.from('coaching_messages').insert({ user_id: user.id, message });

    return new Response(JSON.stringify({ message }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[generate-coaching]', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
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

    // --- Per-user daily rate limit (cost control for the Anthropic call) ---
    const RATE_LIMIT_PER_DAY = 20;
    const FN_NAME = 'map-import-columns';
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // Opportunistic prune so ai_usage never grows unbounded.
    await supabase.from('ai_usage').delete().eq('user_id', user.id).lt('called_at', dayAgo);
    const { count } = await supabase
      .from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('function_name', FN_NAME)
      .gte('called_at', dayAgo);
    if ((count ?? 0) >= RATE_LIMIT_PER_DAY) {
      return new Response(JSON.stringify({ error: 'Daily limit reached', rate_limited: true }), {
        status: 429, headers: { 'Content-Type': 'application/json' },
      });
    }
    await supabase.from('ai_usage').insert({ user_id: user.id, function_name: FN_NAME });

    const { headers, sampleRows } = await req.json();
    if (!headers || !sampleRows) {
      return new Response(JSON.stringify({ error: 'Missing headers or sampleRows' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // --- Input caps (cost/abuse control before we ever build a prompt) ---
    const MAX_HEADERS = 60;
    const MAX_SAMPLE_ROWS = 10;
    const MAX_COLS_PER_ROW = 60;
    const MAX_CELL_LENGTH = 200;
    if (!Array.isArray(headers) || !Array.isArray(sampleRows)) {
      return new Response(JSON.stringify({ error: 'headers and sampleRows must be arrays' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (headers.length > MAX_HEADERS) {
      return new Response(JSON.stringify({ error: `Too many columns (max ${MAX_HEADERS})` }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (sampleRows.length > MAX_SAMPLE_ROWS) {
      return new Response(JSON.stringify({ error: `Too many sample rows (max ${MAX_SAMPLE_ROWS})` }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (sampleRows.some((r: unknown) => Array.isArray(r) && r.length > MAX_COLS_PER_ROW)) {
      return new Response(JSON.stringify({ error: `Too many columns in a sample row (max ${MAX_COLS_PER_ROW})` }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const safeHeaders: string[] = headers.map((h: unknown) => String(h ?? '').slice(0, MAX_CELL_LENGTH));
    const safeSampleRows: string[][] = sampleRows.map((r: unknown) =>
      (Array.isArray(r) ? r : []).map((cell: unknown) => String(cell ?? '').slice(0, MAX_CELL_LENGTH)),
    );

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const prompt = `You are a data mapping assistant. A user is importing a spreadsheet of tennis tournament expenses into an app.

The app needs these fields:
- "amount" (monetary value, required)
- "date" (date of expense, required)
- "category" (type of expense: Travel, Accommodation, Food, Equipment, Entry Fee, Coaching, Other)
- "note" (description or notes)
- "tournament" (tournament name)

The user's spreadsheet has these column headers:
${JSON.stringify(safeHeaders)}

Here are a few sample rows:
${safeSampleRows.map((r: string[]) => JSON.stringify(r)).join('\n')}

Map each of the app's fields to the best matching column header from the user's spreadsheet. If no column matches a field, omit it.

Respond ONLY in valid JSON:
{
  "mapping": {
    "amount": "their column name",
    "date": "their column name",
    "category": "their column name",
    "note": "their column name",
    "tournament": "their column name"
  }
}`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let parsed: { mapping?: Record<string, unknown> };
    try {
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { mapping: {} };
    } catch {
      parsed = { mapping: {} };
    }

    // Validate every mapping value is actually one of the input headers —
    // drop anything the model hallucinated that doesn't match a real column.
    const headerSet = new Set(safeHeaders);
    const rawMapping = (parsed && typeof parsed.mapping === 'object' && parsed.mapping) ? parsed.mapping : {};
    const mapping: Record<string, string> = {};
    for (const [field, value] of Object.entries(rawMapping)) {
      if (typeof value === 'string' && headerSet.has(value)) {
        mapping[field] = value;
      }
    }

    return new Response(JSON.stringify({ mapping }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[map-import-columns]', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});

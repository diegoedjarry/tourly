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

    const { headers, sampleRows } = await req.json();
    if (!headers || !sampleRows) {
      return new Response(JSON.stringify({ error: 'Missing headers or sampleRows' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const prompt = `You are a data mapping assistant. A user is importing a spreadsheet of tennis tournament expenses into an app.

The app needs these fields:
- "amount" (monetary value, required)
- "date" (date of expense, required)
- "category" (type of expense: Travel, Accommodation, Food, Equipment, Entry Fee, Coaching, Other)
- "note" (description or notes)
- "tournament" (tournament name)

The user's spreadsheet has these column headers:
${JSON.stringify(headers)}

Here are a few sample rows:
${sampleRows.map((r: string[]) => JSON.stringify(r)).join('\n')}

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
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { mapping: {} };

    return new Response(JSON.stringify(parsed), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[map-import-columns]', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});

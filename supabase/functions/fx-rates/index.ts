// fx-rates — indicative FX cache for USD normalization of expenses.
//
// Returns { rates: { EUR: 0.92, TND: 3.1, ... }, updated_at } where each value
// is units-per-USD. Refreshes from frankfurter.app (ECB data, no key) at most
// once per 24h; otherwise serves the cached table. Rates are INDICATIVE only —
// used for approximate USD totals, never for accounting.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: 'Server misconfigured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const { data: cached } = await supabase
      .from('fx_rates')
      .select('currency, rate_to_usd, updated_at')
      .order('updated_at', { ascending: false });

    const newest = cached?.[0]?.updated_at ? new Date(cached[0].updated_at).getTime() : 0;
    const stale = Date.now() - newest > 24 * 60 * 60 * 1000;

    if (stale || !cached?.length) {
      try {
        const res = await fetch('https://api.frankfurter.app/latest?base=USD');
        if (res.ok) {
          const fx = await res.json();
          const rows = Object.entries(fx.rates as Record<string, number>).map(([currency, rate]) => ({
            currency,
            rate_to_usd: rate, // units of `currency` per 1 USD
            updated_at: new Date().toISOString(),
          }));
          rows.push({ currency: 'USD', rate_to_usd: 1, updated_at: new Date().toISOString() });
          await supabase.from('fx_rates').upsert(rows, { onConflict: 'currency' });
          const rates = Object.fromEntries(rows.map((r) => [r.currency, r.rate_to_usd]));
          return new Response(JSON.stringify({ rates, updated_at: new Date().toISOString() }), { headers: { 'Content-Type': 'application/json' } });
        }
      } catch (e) {
        console.error('[fx-rates] refresh failed, serving cache', e);
      }
    }

    // Serve cache (fresh, or stale-but-refresh-failed — better than nothing)
    const rates = Object.fromEntries((cached ?? []).map((r: any) => [r.currency, Number(r.rate_to_usd)]));
    if (!rates.USD) rates.USD = 1;
    return new Response(JSON.stringify({ rates, updated_at: cached?.[0]?.updated_at ?? null }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[fx-rates]', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});

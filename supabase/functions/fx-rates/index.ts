// fx-rates — indicative FX cache for USD normalization of expenses.
//
// Returns { rates: { EUR: 0.92, CLP: 924.7, ... }, updated_at } where each
// value is units-per-USD. Refreshes at most once per 24h; otherwise serves
// the cached table. Rates are INDICATIVE only — used for approximate USD
// totals, never for accounting.
//
// Provider: open.er-api.com (160+ currencies incl. CLP/ARS/PEN/TND — the
// previous ECB/frankfurter source lacked every LatAm currency, and the core
// user base is Chilean). Frankfurter kept as fallback; its 29 ECB currencies
// are a strict subset with identical units-per-USD semantics.
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
        let fetched: Record<string, number> | null = null;
        try {
          const res = await fetch('https://open.er-api.com/v6/latest/USD');
          if (res.ok) {
            const fx = await res.json();
            if (fx?.result === 'success' && fx?.rates) fetched = fx.rates as Record<string, number>;
          }
        } catch { /* fall through to frankfurter */ }
        if (!fetched) {
          const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD');
          if (res.ok) {
            const fx = await res.json();
            if (fx?.rates) fetched = fx.rates as Record<string, number>;
          }
        }
        if (fetched) {
          const now = new Date().toISOString();
          const rows = Object.entries(fetched)
            .filter(([, rate]) => typeof rate === 'number' && rate > 0)
            .map(([currency, rate]) => ({ currency, rate_to_usd: rate, updated_at: now }));
          // er-api already includes USD; only add it when the provider didn't —
          // a duplicate key within one upsert batch is a Postgres error.
          if (!fetched.USD) rows.push({ currency: 'USD', rate_to_usd: 1, updated_at: now });
          const { error: upsertError } = await supabase.from('fx_rates').upsert(rows, { onConflict: 'currency' });
          if (upsertError) console.error('[fx-rates] cache upsert failed', upsertError);
          const rates = Object.fromEntries(rows.map((r) => [r.currency, r.rate_to_usd]));
          if (!rates.USD) rates.USD = 1;
          return new Response(JSON.stringify({ rates, updated_at: now }), { headers: { 'Content-Type': 'application/json' } });
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

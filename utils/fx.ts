// Indicative FX conversion client (fx-rates edge function, 24h server cache).
//
// Used ONLY to compute approximate USD values for display/aggregation
// (`amount_usd` at entry time, "≈USD" toggles). Never for accounting — the
// original amount+currency remain the source of truth on every expense.

import { supabase } from '@/lib/supabase';

let cache: { rates: Record<string, number>; fetchedAt: number } | null = null;
let inflight: Promise<Record<string, number> | null> | null = null;
const TTL_MS = 6 * 60 * 60 * 1000; // client-side TTL; server refreshes daily

export async function getFxRates(): Promise<Record<string, number> | null> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.rates;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke('fx-rates', { body: {} });
      if (error || !data?.rates) return cache?.rates ?? null;
      cache = { rates: data.rates as Record<string, number>, fetchedAt: Date.now() };
      return cache.rates;
    } catch {
      return cache?.rates ?? null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Indicative USD value of an amount in `currency`, or null when the rate is
 * unavailable (offline, exotic currency). Callers must treat null as
 * "unknown", not zero.
 */
export async function toUsd(amount: number, currency: string): Promise<number | null> {
  if (!currency || currency === 'USD') return amount;
  const rates = await getFxRates();
  const perUsd = rates?.[currency];
  if (!perUsd || perUsd <= 0) return null;
  return Math.round((amount / perUsd) * 100) / 100;
}

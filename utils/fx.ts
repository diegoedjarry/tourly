// Indicative FX conversion client (fx-rates edge function, 24h server cache).
//
// Used ONLY to compute approximate USD values for display/aggregation
// (`amount_usd` at entry time, "≈USD" toggles). Never for accounting — the
// original amount+currency remain the source of truth on every expense.

import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = 'fx-rates-cache-v1';
const FETCH_TIMEOUT_MS = 4000;

let cache: { rates: Record<string, number>; fetchedAt: number } | null = null;
let inflight: Promise<Record<string, number> | null> | null = null;
let loadedPersisted = false;
const TTL_MS = 6 * 60 * 60 * 1000; // client-side TTL; server refreshes daily

// Best-effort restore of whatever was last persisted (even if stale), so a
// cold app start has something to fall back on before the network round-trip
// completes or if it fails — stale indicative rates beat no conversion.
async function loadPersistedCache() {
  if (loadedPersisted) return;
  loadedPersisted = true;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw && !cache) {
      const parsed = JSON.parse(raw);
      if (parsed?.rates && parsed?.fetchedAt) cache = parsed;
    }
  } catch {
    // persisted cache is a nice-to-have — never blocks getFxRates()
  }
}

function savePersistedCache(rates: Record<string, number>, fetchedAt: number) {
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ rates, fetchedAt })).catch(() => {});
}

export async function getFxRates(): Promise<Record<string, number> | null> {
  if (!loadedPersisted) await loadPersistedCache();
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.rates;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // Never let a slow/hanging network request block a save — after
      // FETCH_TIMEOUT_MS fall back to whatever cache we have (never reject).
      const result = await Promise.race([
        supabase.functions.invoke('fx-rates', { body: {} }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS)),
      ]);
      if (!result || result.error || !result.data?.rates) return cache?.rates ?? null;
      const rates = result.data.rates as Record<string, number>;
      const fetchedAt = Date.now();
      cache = { rates, fetchedAt };
      savePersistedCache(rates, fetchedAt); // fire-and-forget
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

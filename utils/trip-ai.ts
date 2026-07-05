// AI trip-cost estimator client (estimate-trip-cost edge function).
//
// Calls the deployed Supabase edge function to get an AI-assisted cost
// breakdown for an upcoming tournament trip. The server caches results for
// 14 days, so repeat calls (without force_refresh) are effectively instant.
// This client never throws — callers get `null` on any failure and can show
// a friendly inline message instead of crashing the detail screen.

import { supabase } from '@/lib/supabase';

export type TripCostDataTier = 'personal_history' | 'peer_aggregate' | 'estimated_heuristic';
export type TripCostConfidence = 'high' | 'medium' | 'low';

export interface TripCostCategory {
  amount: number;
  basis: string;
}

export interface TripCostCategories {
  flight: TripCostCategory;
  lodging: TripCostCategory;
  food: TripCostCategory;
  local_transport: TripCostCategory;
  entry_fee: TripCostCategory;
}

export interface TripCostEstimate {
  data_tier: TripCostDataTier;
  confidence: TripCostConfidence;
  sample_size: number | null;
  estimate_currency: 'USD';
  categories: TripCostCategories;
  total: number;
  comparison_to_user_average: string | null;
  caveats: string[];
  generated_at: string;
  cached: boolean;
}

/**
 * Fetches an AI-generated trip cost estimate for a tournament. Never throws —
 * returns null on any error (network, auth, non-200 response, malformed
 * payload) and logs a warning for debugging.
 */
export async function fetchTripCostEstimate(
  tournamentId: string,
  forceRefresh = false,
): Promise<TripCostEstimate | null> {
  try {
    const { data, error } = await supabase.functions.invoke('estimate-trip-cost', {
      body: { tournament_id: tournamentId, ...(forceRefresh ? { force_refresh: true } : {}) },
    });

    if (error) {
      console.warn('fetchTripCostEstimate: edge function error', error);
      return null;
    }
    if (!data || typeof data !== 'object' || 'error' in data) {
      console.warn('fetchTripCostEstimate: error response', (data as any)?.error);
      return null;
    }

    return data as TripCostEstimate;
  } catch (e) {
    console.warn('fetchTripCostEstimate: unexpected failure', e);
    return null;
  }
}

// ─── Trip cost estimator ────────────────────────────────────────────────────
// Pure, framework-free function that estimates the likely total cost of an
// upcoming trip from the player's own historical expense data. No app-level
// imports — only plain types so this stays trivially testable.

export interface TripEstimateTarget {
  country: string;
  category: string;
  startDate: string; // "YYYY-MM-DD"
}

export interface TripEstimateTournament {
  id: string;
  country?: string | null;
  category?: string | null;
  startDate?: string | null;
}

export interface TripEstimateExpense {
  tournamentId?: string | null;
  amount?: number | null;
}

export type TripEstimateBasis = 'country' | 'category' | 'overall';

export interface TripEstimateResult {
  estimate: number;
  low: number;
  high: number;
  sampleSize: number;
  basis: TripEstimateBasis;
}

// Noise floor: a "trip" with less than this total spend is probably a
// partial/incomplete expense record, not a real completed trip.
const MIN_TRIP_TOTAL = 100;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Builds a map of tournamentId -> total expense amount, then filters down to
 * PAST tournaments (startDate before target.startDate — we treat "today" as
 * the target's own start date so this stays a pure function of its inputs)
 * that have at least one expense and a total spend >= MIN_TRIP_TOTAL.
 */
function buildPastTripTotals(
  target: TripEstimateTarget,
  allTournaments: TripEstimateTournament[],
  expenses: TripEstimateExpense[],
): { tournament: TripEstimateTournament; total: number }[] {
  const totalsByTournament = new Map<string, number>();
  const countsByTournament = new Map<string, number>();

  for (const exp of expenses) {
    if (!exp.tournamentId) continue;
    const amount = typeof exp.amount === 'number' ? exp.amount : 0;
    totalsByTournament.set(exp.tournamentId, (totalsByTournament.get(exp.tournamentId) ?? 0) + amount);
    countsByTournament.set(exp.tournamentId, (countsByTournament.get(exp.tournamentId) ?? 0) + 1);
  }

  const results: { tournament: TripEstimateTournament; total: number }[] = [];
  for (const trn of allTournaments) {
    if (!trn.startDate) continue;
    if (!(trn.startDate < target.startDate)) continue; // must be strictly past
    const count = countsByTournament.get(trn.id) ?? 0;
    if (count < 1) continue;
    const total = totalsByTournament.get(trn.id) ?? 0;
    if (total < MIN_TRIP_TOTAL) continue;
    results.push({ tournament: trn, total });
  }
  return results;
}

/**
 * Estimates the likely cost of an upcoming trip based on the player's own
 * past tournaments' expense totals. Basis priority:
 *   1. Same country (>= 1 sample)
 *   2. Same category, e.g. M15/M25 (>= 2 samples)
 *   3. All past tournaments (>= 2 samples)
 * Returns null when there isn't enough historical data to say anything useful.
 */
export function estimateTripCost(
  target: TripEstimateTarget,
  allTournaments: TripEstimateTournament[],
  expenses: TripEstimateExpense[],
): TripEstimateResult | null {
  const pastTrips = buildPastTripTotals(target, allTournaments, expenses);
  if (pastTrips.length === 0) return null;

  const sameCountry = target.country
    ? pastTrips.filter(p => (p.tournament.country ?? '') === target.country)
    : [];
  if (sameCountry.length >= 1) {
    return buildResult(sameCountry.map(p => p.total), 'country');
  }

  const sameCategory = target.category
    ? pastTrips.filter(p => (p.tournament.category ?? '') === target.category)
    : [];
  if (sameCategory.length >= 2) {
    return buildResult(sameCategory.map(p => p.total), 'category');
  }

  if (pastTrips.length >= 2) {
    return buildResult(pastTrips.map(p => p.total), 'overall');
  }

  return null;
}

function buildResult(totals: number[], basis: TripEstimateBasis): TripEstimateResult {
  return {
    estimate: median(totals),
    low: Math.min(...totals),
    high: Math.max(...totals),
    sampleSize: totals.length,
    basis,
  };
}

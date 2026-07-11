// Shared prize-money total logic — used across expenses, insights, index,
// tournaments, settings, and export utilities.
//
// Semantics (matched to the pre-existing duplicated logic at every call site):
// if singles + doubles is greater than 0, use that combined total; otherwise
// fall back to the legacy `prizeMoney` field (pre-split records). This means
// a tournament with singles/doubles both explicitly set to 0 reads as 0 (not
// a stale legacy value) — consistent with every original call site, which all
// gated on `split > 0` rather than presence/non-null of the split fields.
export function totalPrizeMoney(t: {
  singlesPrizeMoney?: number | null;
  doublesPrizeMoney?: number | null;
  prizeMoney?: number | null;
}): number {
  const split = (t.singlesPrizeMoney ?? 0) + (t.doublesPrizeMoney ?? 0);
  return split > 0 ? split : (t.prizeMoney ?? 0);
}

// Fold diacritics: "Miloš" → "Milos". NFD splits base letters from their
// combining accents (U+0300–U+036F), which are then stripped.
export function foldDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Supabase .or() filter matching player_name against both the raw and the
// accent-folded spelling — scraped names are often stored ASCII-folded, so
// "Miloš" must still find rows stored as "Milos" (and vice versa).
export function playerNameFilter(name: string): string {
  const raw = name.trim();
  const folded = foldDiacritics(raw);
  const pat = (s: string) => `player_name.ilike.%${s}%`;
  return folded === raw ? pat(raw) : `${pat(raw)},${pat(folded)}`;
}

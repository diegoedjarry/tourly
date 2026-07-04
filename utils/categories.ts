// Canonical expense categories used by the Excel export, and a normalizer that
// maps the app's stored category names ("food", "travel", …) onto them.
// Shared by export-csv.ts and the import duplicate-detection so that an
// exported file re-imported into Tourly self-dedupes.

export const EXPORT_CATEGORIES = [
  'Equipment',
  'Travel Coach',
  'Academy',
  'Physiotherapy',
  'Flights',
  'Transportation',
  'Hotels',
  'Meals',
  'Physical Trainer',
  'Strings & Grip',
  'Stringing Fee',
  'Other',
];

const CATEGORY_ALIASES: Record<string, string> = {
  travel: 'Transportation',
  flight: 'Flights',
  hotel: 'Hotels',
  accommodation: 'Hotels',
  food: 'Meals',
  coaching: 'Academy',
  physio: 'Physiotherapy',
  'entry fee': 'Other',
  equipment: 'Equipment',
  strings: 'Strings & Grip',
  stringing: 'Stringing Fee',
};

export function normalizeCategory(raw: string): string {
  const lower = (raw ?? '').toLowerCase().trim();
  for (const cat of EXPORT_CATEGORIES) {
    if (cat.toLowerCase() === lower) return cat;
  }
  return CATEGORY_ALIASES[lower] ?? 'Other';
}

// Duplicate-detection key: category is normalized so export labels ("Meals")
// and stored categories ("food") produce the same key.
export function expenseDupeKey(date: string, amount: number, category: string): string {
  return `${date}:${amount}:${normalizeCategory(category).toLowerCase()}`;
}

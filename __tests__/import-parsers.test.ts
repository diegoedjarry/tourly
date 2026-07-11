// xlsx is imported at module top in utils/import-expenses.ts but none of the
// pure functions under test touch it — stub it so jest doesn't need the real lib.
import {
  parseDate,
  parseAmount,
  detectHeaderRow,
  mapColumnsLocal,
  smartParse,
  applyMapping,
} from '@/utils/import-expenses';

jest.mock('xlsx', () => ({}));

// utils/import-expenses.ts also pulls in lib/supabase.ts (for checkDuplicates /
// insertExpenses, unused by the pure functions under test), which in turn
// requires @react-native-async-storage/async-storage's native module and real
// env vars. Stub both so the module can load under plain jest-expo.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

describe('parseAmount — comma/thousands separator regression', () => {
  // Old code did str.replace(',', '.') which only replaces the FIRST comma,
  // corrupting European-format thousands amounts by ~1000x.
  it('parses European format "1.234,56" as 1234.56, not 1.234 or 1234.560', () => {
    expect(parseAmount('1.234,56')).toBeCloseTo(1234.56);
  });

  it('parses US format "1,234.56" as 1234.56', () => {
    expect(parseAmount('1,234.56')).toBeCloseTo(1234.56);
  });

  it('parses plain comma-decimal "1234,56" as 1234.56', () => {
    expect(parseAmount('1234,56')).toBeCloseTo(1234.56);
  });

  it('parses a larger European amount "12.345,67" correctly (regression case)', () => {
    // With the old single-replace bug this would have become 12.345 (dot kept, comma->dot lost precision)
    expect(parseAmount('12.345,67')).toBeCloseTo(12345.67);
  });

  it('strips currency symbols and whitespace', () => {
    expect(parseAmount('$ 1,234.56')).toBeCloseTo(1234.56);
    expect(parseAmount('€1.234,56')).toBeCloseTo(1234.56);
  });

  it('strips currency codes/words stuck to the number', () => {
    expect(parseAmount('CLP5000')).toBe(5000);
    expect(parseAmount('5000 CLP')).toBe(5000);
  });
});

describe('parseAmount — negative / accounting-style amounts', () => {
  it('parses a leading-minus negative amount and keeps the sign', () => {
    expect(parseAmount('-350')).toBe(-350);
  });

  it('parses accounting-style parentheses as negative', () => {
    expect(parseAmount('(350)')).toBe(-350);
  });

  it('parses a negative European-format amount', () => {
    expect(parseAmount('-1.234,56')).toBeCloseTo(-1234.56);
  });
});

describe('parseAmount — garbage / rejection', () => {
  it('rejects null and undefined', () => {
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });

  it('rejects zero', () => {
    expect(parseAmount('0')).toBeNull();
  });

  it('rejects non-numeric garbage with no digits', () => {
    expect(parseAmount('abc')).toBeNull();
  });

  it('rejects amounts at/above the 100,000,000 cap', () => {
    expect(parseAmount('100000000')).toBeNull();
    expect(parseAmount('999999999')).toBeNull();
  });

  it('allows large no-decimal-currency amounts under the cap', () => {
    expect(parseAmount('45000000')).toBe(45000000);
  });
});

describe('parseAmount — Arabic-Indic digit transliteration', () => {
  it('converts Arabic-Indic digits to ASCII before parsing', () => {
    // ٥٠٠ = 500 in Arabic-Indic numerals
    expect(parseAmount('٥٠٠')).toBe(500);
  });
});

describe('parseDate — ISO passthrough', () => {
  it('returns an already-ISO date unchanged', () => {
    expect(parseDate('2026-05-27')).toBe('2026-05-27');
  });
});

describe('parseDate — slash format DD/MM/YYYY heuristic', () => {
  it('treats day > 12 as unambiguous DD/MM/YYYY', () => {
    expect(parseDate('25/12/2026')).toBe('2026-12-25');
  });

  it('treats month > 12 (in first slot) as unambiguous MM/DD/YYYY', () => {
    expect(parseDate('12/25/2026')).toBe('2026-12-25');
  });

  it('defaults ambiguous DD/MM/YYYY-vs-MM/DD/YYYY to DD/MM (South American convention)', () => {
    expect(parseDate('05/06/2026')).toBe('2026-06-05');
  });

  it('expands a 2-digit year using the 50-year pivot (>50 => 19xx, else 20xx)', () => {
    expect(parseDate('01/02/26')).toBe('2026-02-01');
    expect(parseDate('01/02/75')).toBe('1975-02-01');
  });

  it('rejects an impossible date (day out of range for the resolved month)', () => {
    expect(parseDate('31/02/2026')).toBeNull();
  });
});

describe('parseDate — dash and dot formats', () => {
  it('parses DD-MM-YYYY with the same day>12 disambiguation', () => {
    expect(parseDate('25-12-2026')).toBe('2026-12-25');
  });

  it('parses DD.MM.YYYY', () => {
    expect(parseDate('25.12.2026')).toBe('2026-12-25');
  });

  it('rejects an invalid DD.MM.YYYY date', () => {
    expect(parseDate('31.02.2026')).toBeNull();
  });
});

describe('parseDate — Excel serial dates', () => {
  it('converts a numeric Excel serial date to an ISO string', () => {
    // Excel epoch 1899-12-30; serial 45000 => 2023-03-15 (verified via the same
    // 1899-12-30 + N days formula the source uses).
    const expected = (() => {
      const d = new Date(1899, 11, 30);
      d.setDate(d.getDate() + 45000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    expect(parseDate(45000)).toBe(expected);
  });

  it('does NOT treat a numeric-looking STRING as an Excel serial date (only native numbers qualify)', () => {
    // Numeric strings like "45000" are far more likely to be amounts
    // (XOF/INR/CLP) than serial dates. Regression: they used to fall through
    // to new Date("45000") and import as January 1st of the YEAR 45000 —
    // bare integer strings must be rejected outright.
    expect(parseDate('45000')).toBeNull();
    expect(parseDate('2026')).toBeNull();
  });

  it('ignores out-of-range numbers as serial dates (below 30000)', () => {
    expect(parseDate(100)).toBeNull();
  });
});

describe('parseDate — garbage rejection', () => {
  it('returns null for null/undefined', () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });

  it('returns null for unparseable garbage text', () => {
    expect(parseDate('not a date')).toBeNull();
  });
});

describe('detectHeaderRow', () => {
  it('picks the row with the most field-keyword hits as the header', () => {
    const rows = [
      ['My Expense Export', '', ''],
      ['Date', 'Amount', 'Category'],
      ['2026-05-27', '120', 'Hotel'],
      ['2026-05-28', '45', 'Food'],
    ];
    const { headerIdx, headers, dataRows } = detectHeaderRow(rows);
    expect(headerIdx).toBe(1);
    expect(headers).toEqual(['Date', 'Amount', 'Category']);
    expect(dataRows).toEqual([
      ['2026-05-27', '120', 'Hotel'],
      ['2026-05-28', '45', 'Food'],
    ]);
  });

  it('falls back to the first row when nothing scores', () => {
    const rows = [
      ['x', 'y'],
      ['1', '2'],
    ];
    const { headerIdx } = detectHeaderRow(rows);
    expect(headerIdx).toBe(0);
  });
});

describe('mapColumnsLocal', () => {
  it('maps English headers to canonical fields', () => {
    const mapping = mapColumnsLocal(['Date', 'Amount', 'Category', 'Notes']);
    expect(mapping.date).toBe('Date');
    expect(mapping.amount).toBe('Amount');
    expect(mapping.category).toBe('Category');
    expect(mapping.note).toBe('Notes');
  });

  it('maps Spanish headers to canonical fields', () => {
    const mapping = mapColumnsLocal(['Fecha', 'Monto', 'Categoria']);
    expect(mapping.date).toBe('Fecha');
    expect(mapping.amount).toBe('Monto');
    expect(mapping.category).toBe('Categoria');
  });

  it('does not map the same column to two different fields', () => {
    const mapping = mapColumnsLocal(['Date', 'Amount']);
    const used = Object.values(mapping);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe('applyMapping', () => {
  const headers = ['Date', 'Amount', 'Category', 'Notes'];
  const mapping = { date: 'Date', amount: 'Amount', category: 'Category', note: 'Notes' };

  it('maps rows using the given column mapping', () => {
    const rows = [
      ['2026-05-27', '120', 'Hotel', 'stayed downtown'],
      ['2026-05-28', '45,50', 'Food', ''],
    ];
    const result = applyMapping(rows, headers, mapping);
    expect(result.unmapped).toBe(0);
    expect(result.mapped).toHaveLength(2);
    expect(result.mapped[0]).toMatchObject({
      date: '2026-05-27',
      amount: 120,
      category: 'Hotel',
      note: 'stayed downtown',
    });
    expect(result.mapped[1].amount).toBeCloseTo(45.5);
  });

  it('counts a row with an unparseable amount as unmapped', () => {
    const rows = [['2026-05-27', 'not-a-number', 'Hotel', '']];
    const result = applyMapping(rows, headers, mapping);
    expect(result.unmapped).toBe(1);
    expect(result.mapped).toHaveLength(0);
  });

  it('falls back to today when the date column is missing', () => {
    const mappingNoDate = { amount: 'Amount', category: 'Category' };
    const rows = [['2026-05-27', '120', 'Hotel', '']];
    const result = applyMapping(rows, headers, mappingNoDate);
    expect(result.mapped[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('smartParse — row-per-expense end-to-end', () => {
  it('parses a standard date/amount/category file via the row-per-expense path', () => {
    const headers = ['Date', 'Amount', 'Category'];
    const rows = [
      ['2026-05-27', '120', 'Hotel'],
      ['2026-05-28', '1.234,56', 'Flight'],
    ];
    const result = smartParse(headers, rows);
    expect(result.mapped).toHaveLength(2);
    expect(result.mapped[0]).toMatchObject({ date: '2026-05-27', amount: 120 });
    expect(result.mapped[1].amount).toBeCloseTo(1234.56);
  });
});

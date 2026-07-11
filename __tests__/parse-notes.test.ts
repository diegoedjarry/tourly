// utils/parse-notes.ts imports parseAmount from utils/import-expenses.ts, which
// in turn pulls in lib/supabase.ts (for functions unused by parseNotes), which
// requires @react-native-async-storage/async-storage's native module and real
// env vars. Stub both so the module can load under plain jest-expo.
import { parseNotes } from '@/utils/parse-notes';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('xlsx', () => ({}));

describe('parseNotes — ISO dates round-trip exactly', () => {
  it('keeps a YYYY-MM-DD date unchanged (regression: ISO dates were being mangled)', () => {
    const [exp] = parseNotes('2026-05-27 hotel $120');
    expect(exp.date).toBe('2026-05-27');
  });

  it('does not corrupt an ISO date by misreading it as DD/MM (2026-06-01 must stay 2026-06-01)', () => {
    // Comment in source explicitly calls out this case: the unanchored DD/MM
    // pattern could otherwise match "26-06-01" inside "2026-06-01" → 2001-06-26.
    const [exp] = parseNotes('2026-06-01 taxi $15');
    expect(exp.date).toBe('2026-06-01');
  });

  it('carries the last-seen ISO date forward to subsequent dateless lines', () => {
    const [first, second] = parseNotes('2026-03-10 flight $400\ncoffee $5');
    expect(first.date).toBe('2026-03-10');
    expect(second.date).toBe('2026-03-10');
  });
});

describe('parseNotes — header rows produce no expense', () => {
  it('drops a pasted spreadsheet header line entirely (regression: used to become a $1 expense)', () => {
    const expenses = parseNotes('Date Amount Category\n2026-05-27 hotel $120');
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amount).toBe(120);
  });

  it('drops a Spanish header line too', () => {
    const expenses = parseNotes('Fecha Monto Categoria Descripcion\n2026-05-27 comida $20');
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amount).toBe(20);
  });

  it('strips a leading spreadsheet row number before a tab', () => {
    // "17\t..." row-number prefixes are stripped so they are never read as an amount.
    const expenses = parseNotes('17\t2026-05-27 dinner $30');
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amount).toBe(30);
    expect(expenses[0].date).toBe('2026-05-27');
  });

  it('does NOT treat a normal expense line with only 1-2 header-ish words as a header', () => {
    // looksLikeHeader requires >= 3 keyword hits; "date" alone is not enough.
    const expenses = parseNotes('2026-05-27 hotel date night $120');
    expect(expenses).toHaveLength(1);
  });
});

describe('parseNotes — amounts with comma decimals and thousands separators', () => {
  it('parses a European-style amount with thousands dot + comma decimal', () => {
    const [exp] = parseNotes('2026-05-27 flight $1.234,56');
    expect(exp.amount).toBeCloseTo(1234.56);
  });

  it('parses a US-style amount with thousands comma + dot decimal', () => {
    const [exp] = parseNotes('2026-05-27 flight $1,234.56');
    expect(exp.amount).toBeCloseTo(1234.56);
  });

  it('parses a plain comma-as-decimal amount', () => {
    const [exp] = parseNotes('2026-05-27 lunch $12,50');
    expect(exp.amount).toBeCloseTo(12.5);
  });
});

describe('parseNotes — category detection', () => {
  it('detects Travel from a flight keyword', () => {
    const [exp] = parseNotes('2026-05-27 flight to Madrid $400');
    expect(exp.category).toBe('Travel');
  });

  it('detects Accommodation from a hotel keyword', () => {
    const [exp] = parseNotes('2026-05-27 hotel stay $120');
    expect(exp.category).toBe('Accommodation');
  });

  it('detects Food from a restaurant keyword', () => {
    const [exp] = parseNotes('2026-05-27 dinner at restaurant $45');
    expect(exp.category).toBe('Food');
  });

  it('detects Equipment from a racket-string keyword', () => {
    const [exp] = parseNotes('2026-05-27 restring racket $25');
    expect(exp.category).toBe('Equipment');
  });

  it('falls back to Other when no keyword matches', () => {
    const [exp] = parseNotes('2026-05-27 misc thing $10');
    expect(exp.category).toBe('Other');
  });
});

describe('parseNotes — realistic multi-line paste', () => {
  it('parses a mixed paste with header, ISO dates, DD/MM dates, and comma amounts', () => {
    const paste = [
      'Date Amount Category Description',
      '2026-05-27 hotel $120',
      '15/06/2026 flight $1.234,56',
      'dinner at restaurant $45,50',
    ].join('\n');

    const expenses = parseNotes(paste);

    // Header row must not produce an expense.
    expect(expenses).toHaveLength(3);

    expect(expenses[0]).toMatchObject({
      amount: 120,
      date: '2026-05-27',
      category: 'Accommodation',
    });

    // 15/06/2026 — DD/MM/YYYY (ambiguous, defaults to DD/MM per source comment).
    expect(expenses[1]).toMatchObject({
      date: '2026-06-15',
      category: 'Travel',
    });
    expect(expenses[1].amount).toBeCloseTo(1234.56);

    // No date on this line — carries forward the last seen date (15/06/2026 -> 2026-06-15).
    expect(expenses[2]).toMatchObject({
      date: '2026-06-15',
      category: 'Food',
    });
    expect(expenses[2].amount).toBeCloseTo(45.5);
  });

  it('splits a single line with two conjoined expenses into two entries', () => {
    const [a, b] = parseNotes('2026-05-27 taxi $20 and dinner $30');
    expect(a.amount).toBe(20);
    expect(a.category).toBe('Travel');
    expect(b.amount).toBe(30);
    expect(b.category).toBe('Food');
  });
});

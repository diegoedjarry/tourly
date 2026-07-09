import {
  calcDeadlines,
  deadlineInstant,
  fmtDeadline,
  fmtDate,
  fmtDateRange,
  getCircuit,
} from '@/utils/deadlines';

// 2026-07-13 is a Monday — tournaments always start on Monday.
const MONDAY = '2026-07-13';

describe('getCircuit', () => {
  it('classifies ITF, Challenger, ATP, and unknown categories', () => {
    expect(getCircuit('M15')).toBe('itf');
    expect(getCircuit('W100')).toBe('itf');
    expect(getCircuit('Challenger 75')).toBe('challenger');
    expect(getCircuit('challenger 125')).toBe('challenger');
    expect(getCircuit('ATP 250')).toBe('atp');
    expect(getCircuit('Exhibition')).toBe('unknown');
    expect(getCircuit(undefined)).toBe('unknown');
  });
});

describe('calcDeadlines — ITF offsets', () => {
  it('applies −18 / −13 / −4 day offsets from the Monday start', () => {
    expect(calcDeadlines(MONDAY, 'M25')).toEqual({
      signUpDeadline: '2026-06-25',
      withdrawalDeadline: '2026-06-30',
      freezeDeadline: '2026-07-09',
    });
  });

  it('uses ITF offsets as the default for unknown categories', () => {
    expect(calcDeadlines(MONDAY, undefined)).toEqual(calcDeadlines(MONDAY, 'M15'));
  });

  it('crosses month boundaries without drift', () => {
    // 2026-08-03 is a Monday; −18 lands in July.
    expect(calcDeadlines('2026-08-03', 'M15').signUpDeadline).toBe('2026-07-16');
  });

  it('crosses year boundaries without drift', () => {
    // 2026-01-05 is a Monday; −18 lands in December 2025.
    expect(calcDeadlines('2026-01-05', 'M25').signUpDeadline).toBe('2025-12-18');
  });
});

describe('calcDeadlines — Challenger offsets', () => {
  it('applies −21 / −7 / −3 day offsets', () => {
    expect(calcDeadlines(MONDAY, 'Challenger 100')).toEqual({
      signUpDeadline: '2026-06-22',
      freezeDeadline: '2026-07-06',
      withdrawalDeadline: '2026-07-10',
    });
  });
});

describe('deadlineInstant', () => {
  it('ITF deadlines close at 14:00 GMT', () => {
    expect(deadlineInstant('2026-06-25', 'M25', 'signUp').toISOString())
      .toBe('2026-06-25T14:00:00.000Z');
  });

  it('Challenger sign-up closes 12:00 ET (EDT, UTC−4, in July)', () => {
    expect(deadlineInstant('2026-06-22', 'Challenger 100', 'signUp').toISOString())
      .toBe('2026-06-22T16:00:00.000Z');
  });

  it('Challenger withdrawal closes 10:00 ET, and EST (UTC−5) applies in January', () => {
    expect(deadlineInstant('2026-01-16', 'Challenger 75', 'withdrawal').toISOString())
      .toBe('2026-01-16T15:00:00.000Z');
  });
});

describe('date formatting', () => {
  // Regression: date strings must be parsed at fixed midnight, never via
  // new Date('YYYY-MM-DD') local parsing — no off-by-one in any timezone.
  it('fmtDeadline names the correct weekday', () => {
    expect(fmtDeadline('2026-07-13')).toBe('Mon 13 Jul');
    expect(fmtDeadline('2026-07-09', '14:00 GMT')).toBe('Thu 9 Jul · 14:00 GMT');
  });

  it('fmtDate hides the current year and shows other years', () => {
    expect(fmtDate('2026-07-13', 2026)).toBe('13 Jul');
    expect(fmtDate('2025-12-18', 2026)).toBe('18 Dec 2025');
    expect(fmtDate(undefined)).toBe('');
  });

  it('fmtDateRange collapses same-month ranges and expands cross-year ones', () => {
    expect(fmtDateRange('2026-07-13', '2026-07-19', 2026)).toBe('13–19 Jul');
    expect(fmtDateRange('2026-06-29', '2026-07-05', 2026)).toBe('29 Jun – 5 Jul');
    expect(fmtDateRange('2025-12-29', '2026-01-04', 2026)).toBe('29 Dec 2025 – 4 Jan 2026');
  });
});

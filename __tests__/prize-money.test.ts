import { totalPrizeMoney } from '@/utils/prize-money';

describe('totalPrizeMoney', () => {
  it('sums singles + doubles when both are present', () => {
    expect(totalPrizeMoney({ singlesPrizeMoney: 1000, doublesPrizeMoney: 500, prizeMoney: 1 })).toBe(1500);
  });

  it('uses singles only when doubles is absent/zero', () => {
    expect(totalPrizeMoney({ singlesPrizeMoney: 750, doublesPrizeMoney: 0, prizeMoney: 1 })).toBe(750);
    expect(totalPrizeMoney({ singlesPrizeMoney: 750 })).toBe(750);
  });

  it('uses doubles only when singles is absent/zero', () => {
    expect(totalPrizeMoney({ doublesPrizeMoney: 300, prizeMoney: 1 })).toBe(300);
    expect(totalPrizeMoney({ singlesPrizeMoney: 0, doublesPrizeMoney: 300 })).toBe(300);
  });

  it('falls back to legacy prizeMoney when split fields are both zero/absent', () => {
    expect(totalPrizeMoney({ prizeMoney: 2000 })).toBe(2000);
    expect(totalPrizeMoney({ singlesPrizeMoney: 0, doublesPrizeMoney: 0, prizeMoney: 2000 })).toBe(2000);
  });

  it('returns 0 when everything is null/undefined', () => {
    expect(totalPrizeMoney({})).toBe(0);
    expect(totalPrizeMoney({ singlesPrizeMoney: null, doublesPrizeMoney: null, prizeMoney: null })).toBe(0);
  });
});

import { getInitials } from '@/utils/name';
import { countryFlag, nameToIso2 } from '@/utils/countryFlag';
import { normalizeCategory, expenseDupeKey } from '@/utils/categories';
import { normalizeCurrencyCode, currencyForCountry } from '@/utils/currency';

describe('getInitials — first + real last name, not "second word"', () => {
  it('uses first and LAST word for a multi-word name (regression: used to use the second word)', () => {
    // "Juan Carlos Ferrero Donat" -> first "Juan" + last "Donat", not "Juan"+"Carlos".
    expect(getInitials('Juan Carlos Ferrero Donat')).toBe('JD');
  });

  it('handles a simple two-word name', () => {
    expect(getInitials('Rafael Nadal')).toBe('RN');
  });

  it('handles a single name by taking its first two letters', () => {
    expect(getInitials('Novak')).toBe('NO');
  });

  it('returns "?" for empty, null, or undefined input', () => {
    expect(getInitials('')).toBe('?');
    expect(getInitials(null)).toBe('?');
    expect(getInitials(undefined)).toBe('?');
  });

  it('returns "?" for a whitespace-only name', () => {
    expect(getInitials('   ')).toBe('?');
  });
});

describe('countryFlag / nameToIso2 — regression additions (Kosovo, Hong Kong, Puerto Rico, TPE)', () => {
  it('resolves Kosovo full name and 3-letter ITF code KOS to XK', () => {
    expect(nameToIso2('Kosovo')).toBe('XK');
    expect(nameToIso2('KOS')).toBe('XK');
    expect(countryFlag('Kosovo')).toBe(countryFlag('XK'));
  });

  it('resolves Hong Kong full name and 3-letter ITF code HKG to HK', () => {
    expect(nameToIso2('Hong Kong')).toBe('HK');
    expect(nameToIso2('HKG')).toBe('HK');
  });

  it('resolves Puerto Rico full name and 3-letter ITF code PUR to PR', () => {
    expect(nameToIso2('Puerto Rico')).toBe('PR');
    expect(nameToIso2('PUR')).toBe('PR');
  });

  it('resolves the TPE (Chinese Taipei) ITF code to TW', () => {
    expect(nameToIso2('TPE')).toBe('TW');
    expect(nameToIso2('Chinese Taipei')).toBe('TW');
  });

  it('resolves standard countries by full name and ITF 3-letter code', () => {
    expect(nameToIso2('Spain')).toBe('ES');
    expect(nameToIso2('ESP')).toBe('ES');
    expect(nameToIso2('USA')).toBe('US');
    expect(nameToIso2('Chile')).toBe('CL');
    expect(nameToIso2('CHI')).toBe('CL'); // ITF uses CHI for Chile, not the ISO CHL
  });

  it('passes through a bare 2-letter ISO code uppercased', () => {
    expect(nameToIso2('es')).toBe('ES');
  });

  it('returns null / empty-string fallback for unknown input', () => {
    expect(nameToIso2('Narnia')).toBeNull();
    expect(nameToIso2('')).toBeNull();
    expect(countryFlag('Narnia')).toBe('');
    expect(countryFlag('')).toBe('');
  });
});

describe('normalizeCategory', () => {
  it('passes through an already-canonical category name', () => {
    expect(normalizeCategory('Meals')).toBe('Meals');
    expect(normalizeCategory('meals')).toBe('Meals'); // case-insensitive match against EXPORT_CATEGORIES
  });

  it('maps known stored-category aliases to their export label', () => {
    expect(normalizeCategory('food')).toBe('Meals');
    expect(normalizeCategory('travel')).toBe('Transportation');
    expect(normalizeCategory('hotel')).toBe('Hotels');
    expect(normalizeCategory('accommodation')).toBe('Hotels');
    expect(normalizeCategory('coaching')).toBe('Academy');
    expect(normalizeCategory('physio')).toBe('Physiotherapy');
  });

  it('falls back to "Other" for unknown categories, empty, or null-ish input', () => {
    expect(normalizeCategory('made up category')).toBe('Other');
    expect(normalizeCategory('')).toBe('Other');
    expect(normalizeCategory(undefined as unknown as string)).toBe('Other');
  });
});

describe('expenseDupeKey', () => {
  it('builds a key from date, amount, and the NORMALIZED category', () => {
    expect(expenseDupeKey('2026-05-27', 120, 'food')).toBe('2026-05-27:120:meals');
  });

  it('produces the same key for an export label and its aliased stored name', () => {
    // This is the whole point of normalizing in the key: "Meals" (export) and
    // "food" (stored) must collide so re-imports of an export self-dedupe.
    expect(expenseDupeKey('2026-05-27', 120, 'Meals')).toBe(
      expenseDupeKey('2026-05-27', 120, 'food'),
    );
  });
});

describe('normalizeCurrencyCode', () => {
  it('passes through a known ISO 4217 code uppercased', () => {
    expect(normalizeCurrencyCode('usd')).toBe('USD');
    expect(normalizeCurrencyCode('CLP')).toBe('CLP');
  });

  it('maps common currency words/symbols to their ISO code', () => {
    expect(normalizeCurrencyCode('euros')).toBe('EUR');
    expect(normalizeCurrencyCode('€')).toBe('EUR');
    expect(normalizeCurrencyCode('dolares')).toBe('USD');
    expect(normalizeCurrencyCode('pesos')).toBe('CLP'); // ambiguous word defaults to CLP per source comment
  });

  it('rejects junk / unrecognized input', () => {
    expect(normalizeCurrencyCode('not-a-currency')).toBeNull();
    expect(normalizeCurrencyCode('')).toBeNull();
    expect(normalizeCurrencyCode(null)).toBeNull();
    expect(normalizeCurrencyCode(undefined)).toBeNull();
  });
});

describe('currencyForCountry', () => {
  it('looks up currency for standard countries', () => {
    expect(currencyForCountry('CL')).toBe('CLP');
    expect(currencyForCountry('US')).toBe('USD');
    expect(currencyForCountry('DE')).toBe('EUR');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(currencyForCountry(' cl ')).toBe('CLP');
  });

  it('returns null for an unknown or missing country code', () => {
    expect(currencyForCountry('ZZ')).toBeNull();
    expect(currencyForCountry(null)).toBeNull();
    expect(currencyForCountry(undefined)).toBeNull();
  });
});

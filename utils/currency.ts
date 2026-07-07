// Smart currency defaults + display helpers.
//
// Default resolution order (no GPS on purpose — a location permission prompt
// at expense entry erodes trust, and the active tournament already encodes
// where the player is):
//   1. Country of the tournament the expense is being linked to
//   2. Country of the currently active tournament block
//   3. Device locale region
//   4. USD

import { getLocales } from 'expo-localization';

// ISO 3166-1 alpha-2 → ISO 4217. Covers every country with ITF/ATP events
// plus common travel hubs; extend freely — unknown countries fall back to USD.
export const COUNTRY_CURRENCY: Record<string, string> = {
  // Americas
  US: 'USD', CA: 'CAD', MX: 'MXN', GT: 'GTQ', DO: 'DOP', PR: 'USD',
  CO: 'COP', VE: 'VES', EC: 'USD', PE: 'PEN', BO: 'BOB', BR: 'BRL',
  PY: 'PYG', UY: 'UYU', AR: 'ARS', CL: 'CLP', CR: 'CRC', PA: 'USD',
  SV: 'USD', HN: 'HNL', NI: 'NIO', JM: 'JMD', TT: 'TTD', BS: 'BSD',
  BB: 'BBD', CU: 'CUP', HT: 'HTG',
  // Europe (eurozone)
  DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', PT: 'EUR', NL: 'EUR',
  BE: 'EUR', AT: 'EUR', IE: 'EUR', FI: 'EUR', GR: 'EUR', SK: 'EUR',
  SI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR', LU: 'EUR', MT: 'EUR',
  CY: 'EUR', HR: 'EUR', MC: 'EUR', AD: 'EUR', SM: 'EUR', ME: 'EUR', XK: 'EUR',
  // Europe (non-euro)
  GB: 'GBP', CH: 'CHF', LI: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK',
  IS: 'ISK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN',
  RS: 'RSD', BA: 'BAM', MK: 'MKD', AL: 'ALL', MD: 'MDL', UA: 'UAH',
  BY: 'BYN', RU: 'RUB', TR: 'TRY', GE: 'GEL', AM: 'AMD', AZ: 'AZN',
  // Middle East & North Africa
  IL: 'ILS', EG: 'EGP', TN: 'TND', MA: 'MAD', DZ: 'DZD', LY: 'LYD',
  AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR',
  JO: 'JOD', LB: 'LBP', IQ: 'IQD', IR: 'IRR',
  // Sub-Saharan Africa
  ZA: 'ZAR', NG: 'NGN', KE: 'KES', GH: 'GHS', SN: 'XOF', CI: 'XOF',
  BJ: 'XOF', BF: 'XOF', ML: 'XOF', TG: 'XOF', NE: 'XOF', CM: 'XAF',
  GA: 'XAF', CG: 'XAF', TD: 'XAF', CF: 'XAF', GQ: 'XAF',
  ET: 'ETB', TZ: 'TZS', UG: 'UGX', RW: 'RWF', BI: 'BIF', ZM: 'ZMW',
  ZW: 'ZWL', BW: 'BWP', NA: 'NAD', MZ: 'MZN', MG: 'MGA', MU: 'MUR',
  // Asia
  CN: 'CNY', JP: 'JPY', KR: 'KRW', TW: 'TWD', HK: 'HKD', MO: 'MOP',
  IN: 'INR', PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR', TH: 'THB',
  VN: 'VND', MY: 'MYR', SG: 'SGD', ID: 'IDR', PH: 'PHP', KH: 'KHR',
  LA: 'LAK', MM: 'MMK', MN: 'MNT', KZ: 'KZT', UZ: 'UZS', KG: 'KGS',
  TJ: 'TJS', TM: 'TMT', AF: 'AFN', BT: 'BTN', MV: 'MVR', BN: 'BND',
  // Oceania
  AU: 'AUD', NZ: 'NZD', FJ: 'FJD', PG: 'PGK', TO: 'TOP', WS: 'WST',
  VU: 'VUV', SB: 'SBD', NC: 'XPF', PF: 'XPF',
};

// Currencies with no minor unit — format without decimals.
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'PYG', 'ISK', 'XOF', 'XAF', 'XPF', 'UGX', 'RWF', 'VUV', 'KRW', 'MGA']);

// Every ISO 4217 code the app knows about — used by the importers to decide
// whether a token like "CLP" or "ARS" in a spreadsheet/paste is a currency.
export const KNOWN_CURRENCY_CODES: Set<string> = new Set(Object.values(COUNTRY_CURRENCY));

// Currency words/symbols seen in real imports → ISO code.
const CURRENCY_WORDS: Record<string, string> = {
  'US$': 'USD', 'USD$': 'USD', 'DOLLAR': 'USD', 'DOLLARS': 'USD',
  'DOLAR': 'USD', 'DOLARES': 'USD', 'DÓLAR': 'USD', 'DÓLARES': 'USD',
  'EURO': 'EUR', 'EUROS': 'EUR', '€': 'EUR', '£': 'GBP', '¥': 'JPY',
  'R$': 'BRL', 'REAL': 'BRL', 'REAIS': 'BRL', 'REALES': 'BRL',
  'CFA': 'XOF',
  // Ambiguous but the user base is South American; CLP is the safest default.
  'PESO': 'CLP', 'PESOS': 'CLP',
};

/** "clp" / "Dólares" / "€" → "CLP" / "USD" / "EUR"; null when not a currency. */
export function normalizeCurrencyCode(val: unknown): string | null {
  const s = String(val ?? '').trim().toUpperCase();
  if (!s) return null;
  if (KNOWN_CURRENCY_CODES.has(s)) return s;
  return CURRENCY_WORDS[s] ?? null;
}

export function currencyForCountry(iso2?: string | null): string | null {
  if (!iso2) return null;
  return COUNTRY_CURRENCY[iso2.trim().toUpperCase()] ?? null;
}

function deviceRegionCurrency(): string | null {
  try {
    const locales = getLocales();
    const first = locales?.[0];
    // expo-localization exposes the region's currency directly when available.
    if (first?.currencyCode && /^[A-Z]{3}$/.test(first.currencyCode)) return first.currencyCode;
    return currencyForCountry(first?.regionCode ?? null);
  } catch {
    return null;
  }
}

type TournamentLike = {
  country?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  isWithdrawn?: boolean | null;
};

function localTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Smart default currency for a new expense.
 * @param linkedTournament tournament the expense is being linked to (if any)
 * @param allTournaments   full list, used to find the currently active block
 */
export function smartDefaultCurrency(
  linkedTournament?: TournamentLike | null,
  allTournaments?: TournamentLike[] | null,
): string {
  const linked = currencyForCountry(linkedTournament?.country);
  if (linked) return linked;

  const today = localTodayIso();
  const active = (allTournaments ?? []).find(
    (t) => !t.isWithdrawn && !!t.startDate && !!t.endDate && t.startDate! <= today && today <= t.endDate!,
  );
  const activeCur = currencyForCountry(active?.country);
  if (activeCur) return activeCur;

  return deviceRegionCurrency() ?? 'USD';
}

/** "1.234,56 TND"-style display in the user's own locale conventions. */
export function fmtCurrency(amount: number, currency: string): string {
  const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    // Unknown/invalid code — degrade gracefully, never crash a money label.
    return `${amount.toFixed(digits)} ${currency}`;
  }
}

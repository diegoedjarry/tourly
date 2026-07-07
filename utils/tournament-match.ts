// Pure, unit-testable scoring for "does this new ITF tournament match this player's
// profile" — powers useNewTournamentNotifier. No side effects, no I/O.
import { nameToIso2 } from '@/utils/countryFlag';

export interface MatchContext {
  // Shape matches player_profiles.win_loss_by_surface jsonb:
  // {clay:{wins,losses}, hard:{wins,losses}, grass:{wins,losses}}
  winBySurface: Record<string, { wins: number; losses: number }> | null;
  nationality: string | null;   // ISO country name or code as stored in profiles
  homeCity: string | null;
  primarySurface: string | null; // 'clay' | 'hard' | 'grass'
  lang: 'en' | 'es';
}

export interface MatchTournament {
  name: string;
  city: string | null;
  country: string | null;
  surface: string | null;
  category: string | null;
  start_date: string;
  prize_money_total: number | null;
}

export interface TournamentMatch {
  score: number;
  reasons: string[];
}

interface ScoredReason {
  points: number;
  text: string;
}

// ─── Surface name translation (for reason strings only) ──────────────────────

const SURFACE_ES: Record<string, string> = {
  clay: 'polvo de ladrillo',
  hard: 'cancha dura',
  grass: 'césped',
};

function surfaceLabel(surface: string, lang: 'en' | 'es'): string {
  if (lang === 'es') return SURFACE_ES[surface] ?? surface;
  return surface;
}

// ─── Region membership (pragmatic, ISO2-keyed) ────────────────────────────────
// Countries are normalized to ISO2 via nameToIso2() before lookup, so both full
// names and codes coming out of itf_tournaments.country / profiles.nationality work.

const REGIONS: Record<string, string[]> = {
  southAmerica: ['AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'GY', 'PY', 'PE', 'SR', 'UY', 'VE'],
  centralAmericaCaribbean: [
    'BZ', 'CR', 'SV', 'GT', 'HN', 'NI', 'PA',
    'AG', 'BS', 'BB', 'CU', 'DM', 'DO', 'GD', 'HT', 'JM', 'KN', 'LC', 'VC', 'TT', 'PR',
  ],
  northAmerica: ['US', 'CA', 'MX'],
  europe: [
    'AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'XK', 'LV', 'LI', 'LT', 'LU', 'MT', 'MD', 'MC',
    'ME', 'NL', 'MK', 'NO', 'PL', 'PT', 'RO', 'RU', 'SM', 'RS', 'SK', 'SI', 'ES', 'SE',
    'CH', 'UA', 'GB', 'VA',
  ],
  africa: [
    'DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CM', 'CV', 'CF', 'TD', 'KM', 'CG', 'CD', 'CI',
    'DJ', 'EG', 'GQ', 'ER', 'SZ', 'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR',
    'LY', 'MG', 'MW', 'ML', 'MR', 'MU', 'MA', 'MZ', 'NA', 'NE', 'NG', 'RW', 'ST', 'SN',
    'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'TZ', 'TG', 'TN', 'UG', 'ZM', 'ZW',
  ],
  middleEast: ['BH', 'IR', 'IQ', 'IL', 'JO', 'KW', 'LB', 'OM', 'PS', 'QA', 'SA', 'SY', 'TR', 'AE', 'YE'],
  asia: [
    'AF', 'AM', 'AZ', 'BD', 'BT', 'BN', 'KH', 'CN', 'GE', 'IN', 'ID', 'JP', 'KZ', 'KP',
    'KR', 'KG', 'LA', 'MY', 'MV', 'MN', 'MM', 'NP', 'PK', 'PH', 'SG', 'LK', 'TW', 'TJ',
    'TH', 'TM', 'UZ', 'VN',
  ],
  oceania: ['AU', 'FJ', 'KI', 'MH', 'FM', 'NR', 'NZ', 'PW', 'PG', 'WS', 'SB', 'TO', 'TV', 'VU'],
};

function regionOf(iso2: string): string | null {
  for (const [region, codes] of Object.entries(REGIONS)) {
    if (codes.includes(iso2)) return region;
  }
  return null;
}

// ─── Altitude (curated known host cities, meters) ─────────────────────────────
// Cities under 1500m are omitted — not high enough to matter competitively.

const ALTITUDE_CITIES: Record<string, number> = {
  'bogota': 2640,
  'quito': 2850,
  'cuenca': 2560,
  'cochabamba': 2558,
  'sucre': 2810,
  'la paz': 3640,
  'arequipa': 2335,
  'cusco': 3399,
  'mexico city': 2240,
  'toluca': 2660,
  'puebla': 2135,
  'addis ababa': 2355,
  'nairobi': 1795,
  'johannesburg': 1753,
};

function foldCity(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function altitudeOf(city: string | null): number | null {
  if (!city) return null;
  const folded = foldCity(city);
  return ALTITUDE_CITIES[folded] ?? null;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export function scoreTournament(t: MatchTournament, ctx: MatchContext): TournamentMatch {
  const lang = ctx.lang;
  const reasons: ScoredReason[] = [];

  // SURFACE
  if (t.surface) {
    const record = ctx.winBySurface?.[t.surface];
    const total = record ? record.wins + record.losses : 0;
    const winPct = total > 0 ? Math.round((record!.wins / total) * 100) : 0;

    if (total >= 8 && winPct >= 60) {
      reasons.push({
        points: 2,
        text: lang === 'es'
          ? `ganas el ${winPct}% de tus partidos en ${surfaceLabel(t.surface, lang)}`
          : `you win ${winPct}% of matches on ${surfaceLabel(t.surface, lang)}`,
      });
    } else if (total >= 8 && winPct >= 55) {
      reasons.push({
        points: 1,
        text: lang === 'es'
          ? `ganas el ${winPct}% de tus partidos en ${surfaceLabel(t.surface, lang)}`
          : `you win ${winPct}% of matches on ${surfaceLabel(t.surface, lang)}`,
      });
    } else if (t.surface === ctx.primarySurface) {
      reasons.push({
        points: 1,
        text: lang === 'es'
          ? `se juega en tu superficie preferida (${surfaceLabel(t.surface, lang)})`
          : `played on your preferred surface (${surfaceLabel(t.surface, lang)})`,
      });
    }
  }

  // TRAVEL
  const tIso2 = t.country ? nameToIso2(t.country) : null;
  const homeIso2 = ctx.nationality ? nameToIso2(ctx.nationality) : null;

  if (tIso2 && homeIso2 && tIso2 === homeIso2) {
    reasons.push({
      points: 2,
      text: lang === 'es'
        ? 'torneo en casa — sin viaje internacional'
        : 'home tournament — no international travel',
    });
  } else if (tIso2 && homeIso2) {
    const tRegion = regionOf(tIso2);
    const homeRegion = regionOf(homeIso2);
    if (tRegion && tRegion === homeRegion) {
      reasons.push({
        points: 1,
        text: lang === 'es'
          ? `viaje corto desde ${ctx.nationality}`
          : `short-haul trip from ${ctx.nationality}`,
      });
    }
  }

  // CONDITIONS / ALTITUDE
  const meters = altitudeOf(t.city);
  if (meters !== null) {
    const homeIsAltitudeToo = ctx.homeCity && altitudeOf(ctx.homeCity) !== null;
    if (homeIsAltitudeToo) {
      reasons.push({
        points: 2,
        text: lang === 'es'
          ? `altitud (~${meters} m) — condiciones más rápidas que a nivel del mar; entrenas en altitud en ${ctx.homeCity}`
          : `high altitude (~${meters} m) — faster conditions than sea level; you train at altitude in ${ctx.homeCity}`,
      });
    } else {
      reasons.push({
        points: 1,
        text: lang === 'es'
          ? `altitud (~${meters} m) — condiciones más rápidas que a nivel del mar`
          : `high altitude (~${meters} m) — faster conditions than sea level`,
      });
    }
  }

  const score = reasons.reduce((sum, r) => sum + r.points, 0);
  const hasSurfaceReason = reasons.some(r =>
    r.text.includes('%') || r.text.includes('preferida') || r.text.includes('preferred surface'));

  const qualifies = score >= 3 || (score >= 2 && hasSurfaceReason);
  if (!qualifies) return { score, reasons: [] };

  const sorted = reasons.slice().sort((a, b) => b.points - a.points).map(r => r.text);
  return { score, reasons: sorted };
}

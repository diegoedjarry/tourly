// estimate-trip-cost — Tournament Cost Insight Generator (3-tier, consent-aware).
//
// Given one of the user's tournaments, estimates what THIS user would spend to
// compete there, by category. Three data tiers, selected DETERMINISTICALLY here
// (never by the model — tier and confidence are trust rules, so the server
// computes them and overrides whatever the model claims):
//   1. personal_history    — >=3 past trips in the same region (incl. country)
//   2. peer_aggregate      — >=5 distinct OPTED-IN users with expenses for this
//                            city in the last 24 months (medians only; raw peer
//                            rows never reach the model)
//   3. estimated_heuristic — default while the data pool is small; not a failure
//
// Results are cached in trip_estimates (14-day TTL) — repeat opens are free.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5-20251001'; // bump here when upgrading quality
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// ── Region buckets (for "comparable trip" counting only) ─────────────────────
const REGION: Record<string, string> = {
  US: 'north_america', CA: 'north_america',
  MX: 'latam', GT: 'latam', DO: 'latam', CO: 'latam', EC: 'latam', PE: 'latam',
  BO: 'latam', BR: 'latam', PY: 'latam', UY: 'latam', AR: 'latam', CL: 'latam',
  CR: 'latam', PA: 'latam', VE: 'latam', HN: 'latam', SV: 'latam', NI: 'latam', JM: 'latam',
  GB: 'western_europe', IE: 'western_europe', FR: 'western_europe', DE: 'western_europe',
  ES: 'western_europe', PT: 'western_europe', IT: 'western_europe', NL: 'western_europe',
  BE: 'western_europe', AT: 'western_europe', CH: 'western_europe', LU: 'western_europe',
  DK: 'western_europe', SE: 'western_europe', NO: 'western_europe', FI: 'western_europe', IS: 'western_europe',
  PL: 'eastern_europe', CZ: 'eastern_europe', SK: 'eastern_europe', HU: 'eastern_europe',
  RO: 'eastern_europe', BG: 'eastern_europe', RS: 'eastern_europe', HR: 'eastern_europe',
  SI: 'eastern_europe', BA: 'eastern_europe', MK: 'eastern_europe', AL: 'eastern_europe',
  GR: 'eastern_europe', UA: 'eastern_europe', MD: 'eastern_europe', GE: 'eastern_europe', AM: 'eastern_europe', AZ: 'eastern_europe', TR: 'eastern_europe',
  MA: 'mena', TN: 'mena', DZ: 'mena', EG: 'mena', IL: 'mena', JO: 'mena',
  AE: 'mena', SA: 'mena', QA: 'mena', KW: 'mena', BH: 'mena', OM: 'mena', LB: 'mena',
  ZA: 'subsaharan_africa', NG: 'subsaharan_africa', KE: 'subsaharan_africa',
  GH: 'subsaharan_africa', SN: 'subsaharan_africa', CI: 'subsaharan_africa',
  ET: 'subsaharan_africa', TZ: 'subsaharan_africa', UG: 'subsaharan_africa',
  ZW: 'subsaharan_africa', ZM: 'subsaharan_africa', BW: 'subsaharan_africa', MU: 'subsaharan_africa',
  IN: 'south_asia', PK: 'south_asia', BD: 'south_asia', LK: 'south_asia', NP: 'south_asia',
  CN: 'east_asia', JP: 'east_asia', KR: 'east_asia', TW: 'east_asia', HK: 'east_asia', MN: 'east_asia',
  TH: 'southeast_asia', VN: 'southeast_asia', MY: 'southeast_asia', SG: 'southeast_asia',
  ID: 'southeast_asia', PH: 'southeast_asia', KH: 'southeast_asia', LA: 'southeast_asia', MM: 'southeast_asia',
  KZ: 'central_asia', UZ: 'central_asia', KG: 'central_asia', TJ: 'central_asia', TM: 'central_asia',
  AU: 'oceania', NZ: 'oceania', FJ: 'oceania',
};
const regionOf = (iso2?: string | null) => (iso2 ? REGION[iso2.trim().toUpperCase()] ?? 'other' : 'other');

// App expense categories → generator buckets
function bucketOf(category: string | null | undefined): string {
  const c = (category ?? '').toLowerCase();
  if (/flight|vuelo|avion|avión|air/.test(c)) return 'flight';
  if (/hotel|hous|airbnb|lodg|aloja|hostel/.test(c)) return 'lodging';
  if (/food|meal|comida|grocer|restaur/.test(c)) return 'food';
  if (/transport|taxi|uber|bus|train|tren|metro|car|gas/.test(c)) return 'local_transport';
  if (/entry|inscri|sign.?up|ipin/.test(c)) return 'entry_fee';
  return 'other';
}
const isCoachCat = (category: string | null | undefined) => /coach|entrenador/i.test(category ?? '');

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const effective = (e: any): number => {
  if (e.is_reimbursed) return 0;
  const base = e.amount_usd ?? e.amount ?? 0;
  return base * ((e.share_pct ?? 100) / 100);
};

function getServiceRoleKey(): string | undefined {
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      const key = parsed.default ?? Object.values(parsed)[0];
      if (key) return key as string;
    } catch {}
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ── Forced tool-use schema (mirrors the generator's OUTPUT REQUIREMENTS) ─────
const CAT = {
  type: 'object' as const,
  properties: {
    amount: { type: 'number', description: 'Estimated USD amount for the whole trip.' },
    basis: { type: 'string', description: 'Under 20 words: what this figure is based on.' },
  },
  required: ['amount', 'basis'],
};

const ESTIMATE_TOOL = {
  name: 'record_estimate',
  description: 'Record the structured trip-cost estimate.',
  input_schema: {
    type: 'object' as const,
    properties: {
      categories: {
        type: 'object',
        properties: { flight: CAT, lodging: CAT, food: CAT, local_transport: CAT, entry_fee: CAT },
        required: ['flight', 'lodging', 'food', 'local_transport', 'entry_fee'],
      },
      comparison_to_user_average: {
        type: ['string', 'null'],
        description: 'One sentence comparing to the user\'s average comparable trip. ONLY when tier is personal_history with >=3 comparable trips; otherwise null.',
      },
      caveats: {
        type: 'array', items: { type: 'string' },
        description: 'Assumptions and risk factors the user should know (2-5 items).',
      },
    },
    required: ['categories', 'caveats'],
  },
};

const SYSTEM_PROMPT = `You are a travel-cost analyst for professional ITF/Challenger-level tennis players. Estimate what this SPECIFIC user would spend to compete at the given tournament, by category, in USD.

The data tier has ALREADY been selected server-side and is stated in the input. Do not claim a different tier or imply more data than provided.

RULES:
1. Flight estimates must scale with the home-base → tournament-city distance and known regional flight-pricing patterns. Never a flat global number. If no home base is given, assume the capital of the user's nationality and say so in caveats.
2. Lodging and food reflect the DESTINATION city's cost tier, never the home city's.
3. Lodging/food/local_transport cover the full stay (nights given in input).
4. entry_fee: professional ITF World Tennis Tour and ATP Challenger events generally have no per-event entry fee (IPIN/registration is annual). Use the user's own entry-fee history if present in input; otherwise 0 with a basis saying so, and add a caveat to verify with the ITF/ATP.
5. In tier personal_history: anchor every category to the user's per-trip medians given in input, adjusted for the destination's cost tier vs. those trips. Populate comparison_to_user_average.
6. In tier peer_aggregate: anchor to the peer category medians given in input. comparison_to_user_average = null. Refer to peers only as "players who competed here recently" — never identities, cities of origin, or any sub-threshold count.
7. In tier estimated_heuristic: reason from regional cost-of-living and distance heuristics. Every basis must plainly say it is a heuristic, not real traveler data. comparison_to_user_average = null. Do not apologize — this is the normal default.
8. Never invent a specific outside source, article, price quote, or fabricated statistic.
9. If the input notes the user usually travels with a coach, add a caveat that coach costs (shown in their history) are NOT included in this estimate.
10. If tournament dates plausibly overlap a known high-demand period for that city (major holidays, festivals, peak season), flag it in caveats.
11. If the input notes a tier fell through because a threshold wasn't met, mention it neutrally in caveats (e.g. "based on regional averages until you log more trips") — never with specific below-threshold counts.
12. Each basis string under 20 words. Amounts are whole USD numbers for the entire trip.`;

serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = getServiceRoleKey();
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) {
      console.error('[estimate-trip-cost] Missing required environment variables');
      return json({ error: 'Server misconfigured' }, 500);
    }
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const tournamentId: string | undefined = body?.tournament_id;
    const forceRefresh: boolean = body?.force_refresh === true;
    if (!tournamentId) return json({ error: 'tournament_id required' }, 400);

    // ── Cache ────────────────────────────────────────────────────────────────
    if (!forceRefresh) {
      const { data: cached } = await supabase
        .from('trip_estimates').select('payload, generated_at')
        .eq('user_id', user.id).eq('tournament_id', tournamentId).maybeSingle();
      if (cached && Date.now() - new Date(cached.generated_at).getTime() < CACHE_TTL_MS) {
        return json({ ...cached.payload, cached: true });
      }
    }

    // --- Per-user daily rate limit (cost control for the Anthropic call) ---
    // Deliberately AFTER the cache check: serving a cached estimate costs
    // nothing, so only calls that will actually hit Anthropic consume quota.
    const RATE_LIMIT_PER_DAY = 10;
    const FN_NAME = 'estimate-trip-cost';
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // Opportunistic prune so ai_usage never grows unbounded.
    await supabase.from('ai_usage').delete().eq('user_id', user.id).lt('called_at', dayAgo);
    const { count } = await supabase
      .from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('function_name', FN_NAME)
      .gte('called_at', dayAgo);
    if ((count ?? 0) >= RATE_LIMIT_PER_DAY) {
      return json({ error: 'Daily limit reached', rate_limited: true }, 429);
    }
    await supabase.from('ai_usage').insert({ user_id: user.id, function_name: FN_NAME });

    // ── Gather context ───────────────────────────────────────────────────────
    const [{ data: trn }, { data: profile }, { data: myTournaments }, { data: myExpenses }] = await Promise.all([
      supabase.from('tournaments').select('*').eq('id', tournamentId).eq('user_id', user.id).single(),
      supabase.from('profiles').select('home_city, nationality, travel_with_coach').eq('id', user.id).maybeSingle(),
      supabase.from('tournaments').select('id, name, city, country, category, start_date, end_date').eq('user_id', user.id),
      supabase.from('expenses').select('tournament_id, category, amount, amount_usd, share_pct, is_reimbursed, date').eq('user_id', user.id),
    ]);
    if (!trn) return json({ error: 'Tournament not found' }, 404);

    const targetRegion = regionOf(trn.country);
    const todayIso = new Date().toISOString().slice(0, 10);

    // Per-trip summaries from the user's own history (past tournaments, >= $100)
    const tById = new Map((myTournaments ?? []).map((t: any) => [t.id, t]));
    const byTrip = new Map<string, Record<string, number>>();
    let coachSpendTotal = 0, allSpendTotal = 0;
    for (const e of myExpenses ?? []) {
      const t = e.tournament_id ? tById.get(e.tournament_id) : null;
      const amt = effective(e);
      allSpendTotal += amt;
      if (isCoachCat(e.category)) coachSpendTotal += amt;
      if (!t || !(t as any).start_date || (t as any).start_date >= todayIso || (t as any).id === tournamentId) continue;
      const buckets = byTrip.get((t as any).id) ?? {};
      const b = isCoachCat(e.category) ? 'coach' : bucketOf(e.category);
      buckets[b] = (buckets[b] ?? 0) + amt;
      byTrip.set((t as any).id, buckets);
    }
    const trips = Array.from(byTrip.entries())
      .map(([id, buckets]) => {
        const t: any = tById.get(id);
        const total = Object.values(buckets).reduce((s, v) => s + v, 0);
        return { country: t.country, region: regionOf(t.country), category: t.category, startDate: t.start_date, buckets, total };
      })
      .filter((t) => t.total >= 100);

    const regionTrips = trips.filter((t) => t.region !== 'other' && t.region === targetRegion);
    const countryTrips = trips.filter((t) => t.country && trn.country && t.country === trn.country);
    const travelsWithCoach = /yes|si|sí|always|usually/i.test(profile?.travel_with_coach ?? '') ||
      (allSpendTotal > 0 && coachSpendTotal / allSpendTotal > 0.25);

    // ── Deterministic tier selection ────────────────────────────────────────
    let tier: 'personal_history' | 'peer_aggregate' | 'estimated_heuristic' = 'estimated_heuristic';
    let confidence: 'high' | 'medium' | 'low' = 'low';
    let sampleSize: number | null = null;
    let peerMedians: Record<string, number> | null = null;
    const tierNotes: string[] = [];

    if (regionTrips.length >= 3) {
      tier = 'personal_history';
      confidence = regionTrips.length >= 5 ? 'high' : 'medium';
      sampleSize = regionTrips.length;
    } else {
      if (regionTrips.length > 0) tierNotes.push('User has some trips in this region but below the threshold for personal-history basis.');
      // Peer aggregates: opted-in users only, same city (fallback same country), last 24 months.
      const cutoff = new Date(Date.now() - 24 * 30.4 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const { data: consentRows } = await supabase.from('profiles').select('id').eq('share_expense_data', true).neq('id', user.id);
      const consentIds = (consentRows ?? []).map((r: any) => r.id);
      if (consentIds.length >= 5 && (trn.city || trn.country)) {
        let q = supabase.from('tournaments')
          .select('id, user_id, city, country, start_date')
          .in('user_id', consentIds).gte('start_date', cutoff).lt('start_date', todayIso);
        q = trn.city ? q.ilike('city', `%${trn.city}%`) : q.eq('country', trn.country);
        const { data: peerTrns } = await q;
        const peerTrnIds = (peerTrns ?? []).map((t: any) => t.id);
        if (peerTrnIds.length) {
          const { data: peerExp } = await supabase.from('expenses')
            .select('user_id, tournament_id, category, amount, amount_usd, share_pct, is_reimbursed')
            .in('tournament_id', peerTrnIds);
          const perUserTrip = new Map<string, Record<string, number>>();
          for (const e of peerExp ?? []) {
            if (isCoachCat(e.category)) continue;
            const key = `${e.user_id}|${e.tournament_id}`;
            const buckets = perUserTrip.get(key) ?? {};
            const b = bucketOf(e.category);
            buckets[b] = (buckets[b] ?? 0) + effective(e);
            perUserTrip.set(key, buckets);
          }
          const distinctUsers = new Set(Array.from(perUserTrip.keys()).map((k) => k.split('|')[0]));
          if (distinctUsers.size >= 5) {
            tier = 'peer_aggregate';
            sampleSize = distinctUsers.size;
            confidence = distinctUsers.size >= 10 ? 'high' : 'medium';
            peerMedians = {};
            for (const b of ['flight', 'lodging', 'food', 'local_transport', 'entry_fee']) {
              peerMedians[b] = Math.round(median(Array.from(perUserTrip.values()).map((v) => v[b] ?? 0).filter((x) => x > 0)));
            }
          } else if (distinctUsers.size > 0) {
            tierNotes.push('Peer data for this location exists but is below the minimum pool size.');
          }
        }
      }
    }

    // ── Build model input ────────────────────────────────────────────────────
    const start = trn.start_date ? new Date(trn.start_date + 'T00:00:00Z') : null;
    const end = trn.end_date ? new Date(trn.end_date + 'T00:00:00Z') : null;
    const nights = start && end ? Math.max(3, Math.round((end.getTime() - start.getTime()) / 86400000) + 2) : 8;

    const context = {
      tournament: {
        name: trn.name, city: trn.city, country: trn.country, surface: trn.surface,
        tier: trn.category, start_date: trn.start_date, end_date: trn.end_date,
        assumed_nights: nights, note: 'Nights assume arriving the day before Monday start; qualifying would add days.',
      },
      user_home_base: { city: profile?.home_city ?? null, nationality: profile?.nationality ?? null },
      selected_data_tier: tier,
      travels_with_coach: travelsWithCoach,
      personal_history: tier === 'personal_history'
        ? {
            comparable_trips: regionTrips.map((t) => ({ country: t.country, tier: t.category, when: t.startDate, by_category_usd: t.buckets, total_usd: Math.round(t.total) })),
            same_country_trip_count: countryTrips.length,
          }
        : null,
      peer_aggregate: tier === 'peer_aggregate'
        ? { distinct_players: sampleSize, category_medians_usd: peerMedians, window: 'last 24 months, this city' }
        : null,
      tier_notes: tierNotes,
    };

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      tools: [ESTIMATE_TOOL],
      tool_choice: { type: 'tool', name: 'record_estimate' },
      messages: [{ role: 'user', content: `Estimate this trip:\n${JSON.stringify(context, null, 2)}` }],
    });

    const toolUse = response.content.find((b: any) => b.type === 'tool_use') as any;
    if (!toolUse?.input?.categories) return json({ error: 'Estimation failed' }, 502);
    const out = toolUse.input;

    // ── Server-side post-validation: tier/confidence/total are OURS ─────────
    const cats: Record<string, { amount: number; basis: string }> = {};
    for (const b of ['flight', 'lodging', 'food', 'local_transport', 'entry_fee']) {
      const c = out.categories[b] ?? { amount: 0, basis: 'Not estimated.' };
      cats[b] = {
        amount: Math.max(0, Math.round(Number(c.amount) || 0)),
        basis: String(c.basis ?? '').slice(0, 160),
      };
    }
    const payload = {
      data_tier: tier,
      confidence,
      sample_size: sampleSize,
      estimate_currency: 'USD',
      categories: cats,
      total: Object.values(cats).reduce((s, c) => s + c.amount, 0),
      comparison_to_user_average: tier === 'personal_history' && typeof out.comparison_to_user_average === 'string'
        ? out.comparison_to_user_average.slice(0, 240) : null,
      caveats: Array.isArray(out.caveats) ? out.caveats.slice(0, 6).map((c: any) => String(c).slice(0, 200)) : [],
      generated_at: new Date().toISOString(),
    };

    await supabase.from('trip_estimates').upsert({
      user_id: user.id, tournament_id: tournamentId,
      payload, data_tier: tier, generated_at: payload.generated_at,
    });

    return json({ ...payload, cached: false });
  } catch (err) {
    console.error('[estimate-trip-cost]', err);
    return json({ error: 'Internal server error' }, 500);
  }
});

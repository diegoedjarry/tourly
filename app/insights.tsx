import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg from 'react-native-svg';
import { useAppQuery } from '@/hooks/useAppQuery';
import { T } from '@/constants/theme';
import { useLanguage } from '@/hooks/useLanguage';
import { getMonthAbbr } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { LoadingLogo, LoadingFade } from '@/components/ui/LoadingLogo';
import { countryFlag } from '@/utils/countryFlag';

type Surface = 'clay' | 'hard' | 'grass';

const SURFACE_COLORS: Record<Surface, { bg: string; text: string; fill: string }> = {
  clay:  { bg: '#2A1A08', text: T.clayText, fill: T.clayText },
  hard:  { bg: '#081828', text: T.hardText, fill: T.hardText },
  grass: { bg: '#0A1E06', text: T.grassText, fill: T.grassText },
};

const CAT_COLORS: Record<string, string> = {
  Flight: T.accent, 'Coach Fee': '#9333EA', Hotel: T.teal, Meals: T.clayText,
  Transport: T.amber, 'Strings & Grip': T.green, 'Stringing Fee': T.green,
  Physio: T.hardText, Academy: T.grassText, Trainer: '#9333EA',
  'Coach Flight': '#9333EA', 'Coach Hotel': '#9333EA', 'Coach Meals': '#9333EA',
  Other: T.textTertiary,
};

function catColor(cat: string) { return CAT_COLORS[cat] ?? T.textTertiary; }

function fmt(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) return `$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return `$${abs.toLocaleString('en-US')}`;
}
function fmtFull(n: number): string {
  return `$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

// countryFlag is imported from @/utils/countryFlag (handles 2-letter ISO, 3-letter ITF, full names)

// Tournament duration in calendar days (inclusive). Defaults to 7 (ITF standard week) if endDate is missing.
function tournamentDays(t: any): number {
  const start = parseLocalDate(t.startDate ?? t.start_date);
  const end = parseLocalDate(t.endDate ?? t.end_date);
  if (!start) return 7;
  if (!end) return 7;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

function parseLocalDate(val: string | undefined): Date | null {
  if (!val || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return null;
  const [y, m, d] = val.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getPrize(t: any): number {
  // Only tournaments actually played (registered, started, not withdrawn)
  // count toward prize money — an added-but-unregistered tournament's prize
  // field must never read as money won.
  const d = parseLocalDate(t.startDate);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (!t.isRegistered || t.isWithdrawn || !d || d > today) return 0;
  const split = (t.singlesPrizeMoney ?? 0) + (t.doublesPrizeMoney ?? 0);
  return split > 0 ? split : (t.prizeMoney ?? 0);
}

// Single source of truth for effective spend on this screen: USD-normalized
// amount, scaled by the user's ownership share. Reimbursed expenses are
// excluded entirely — callers filter them out before summing (see
// effectiveExpenses / effectiveSum below). Mirrors the rule used in
// app/(tabs)/expenses.tsx.
function effectiveUsd(e: any): number {
  const base = e?.amountUsd ?? e?.amount ?? 0;
  const pct = e?.sharePct ?? 100;
  return base * (pct / 100);
}

function effectiveExpenses(expenses: any[]): any[] {
  return expenses.filter((e: any) => e?.isReimbursed !== true);
}

function effectiveSum(expenses: any[]): number {
  return effectiveExpenses(expenses).reduce((s: number, e: any) => s + effectiveUsd(e), 0);
}

// ─── Shared wrapper ──────────────────────────────────────────────────────────

function DetailScreen({ title, children }: { title: string; children: React.ReactNode }) {
  const router = useRouter();
  const { t } = useLanguage();
  return (
    <SafeAreaView style={ds.safe}>
      <View style={ds.header}>
        <TouchableOpacity onPress={() => router.back()} style={ds.backBtn} activeOpacity={0.7}>
          <Text style={ds.backText}>{t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={ds.headerTitle} numberOfLines={1}>{title}</Text>
        <View style={ds.backBtn} />
      </View>
      <ScrollView style={ds.scroll} contentContainerStyle={ds.scrollContent} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

// Shared narrative-summary card used across financial insight screens. Text is
// deterministic (rule-based from computed data, no API calls) — callers build
// the sentence via i18n template keys + manual {placeholder} substitution.
function SummaryBox({ text }: { text: string }) {
  return (
    <View style={ds.summaryBox}>
      <Text style={ds.summaryEmoji}>💡</Text>
      <Text style={ds.summaryText}>{text}</Text>
    </View>
  );
}

// ─── 1. Where Your Money Goes ────────────────────────────────────────────────

function WhereMoneyGoes({ expenses, tournaments }: { expenses: any[]; tournaments: any[] }) {
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const { t, lang } = useLanguage();

  const effExpenses = useMemo(() => effectiveExpenses(expenses), [expenses]);

  const grouped: Record<string, number> = {};
  for (const e of effExpenses) {
    const cat = e.category ?? 'Other';
    grouped[cat] = (grouped[cat] ?? 0) + effectiveUsd(e);
  }
  const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, v]) => s + v, 0);

  const tMap = useMemo(() => new Map(tournaments.map((t: any) => [t.id, t])), [tournaments]);

  const summary = useMemo(() => {
    if (total <= 0 || sorted.length === 0) return null;
    const [cat1, val1] = sorted[0];
    const pct1 = Math.round((val1 / total) * 100);
    if (sorted.length === 1) {
      return t('insights.summaryTopCategoryOnly')
        .replace('{cat}', cat1).replace('{pct}', String(pct1))
        .replace('{amount}', fmtFull(val1)).replace('{total}', fmtFull(total));
    }
    const [cat2, val2] = sorted[1];
    return t('insights.summaryTopCategoryWithSecond')
      .replace('{cat}', cat1).replace('{pct}', String(pct1))
      .replace('{cat2}', cat2).replace('{amount}', fmtFull(val1 + val2))
      .replace('{total}', fmtFull(total));
  }, [sorted, total, t]);

  return (
    <DetailScreen title={t('insights.whereMoneyGoes')}>
      <Text style={ds.bigLabel}>{fmtFull(total)}</Text>
      <Text style={ds.subLabel}>{t('insights.totalSeasonExpenses')}</Text>
      {summary && (
        <View style={{ marginTop: 16 }}>
          <SummaryBox text={summary} />
        </View>
      )}
      <View style={{ marginTop: summary ? 8 : 24 }}>
        {sorted.map(([cat, val]) => {
          const pct = total > 0 ? (val / total) * 100 : 0;
          const color = catColor(cat);
          const catExpenses = effExpenses
            .filter((e: any) => (e.category ?? 'Other') === cat)
            .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

          return (
            <TouchableOpacity
              key={cat}
              style={ds.barRow}
              activeOpacity={0.8}
              onPress={() => setExpandedCat(prev => prev === cat ? null : cat)}
            >
              <View style={ds.barLabelRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={ds.barCatName}>{cat}</Text>
                  <Text style={{ fontSize: 10, color: T.textTertiary }}>
                    {expandedCat === cat ? '▼' : '▶'}
                  </Text>
                </View>
                <Text style={ds.barAmount}>{fmtFull(val)}</Text>
              </View>
              <View style={ds.barTrack}>
                <View style={[ds.barFill, { width: `${Math.max(pct, 2)}%`, backgroundColor: color }]} />
              </View>
              <Text style={[ds.barPct, { color }]}>{pct.toFixed(0)}%</Text>

              {expandedCat === cat && (
                <View style={ds.barDetailList}>
                  {catExpenses.map((e, idx) => {
                    const t = tMap.get(e.tournamentId);
                    return (
                      <View key={e.id ?? idx} style={[ds.barDetailRow, idx === catExpenses.length - 1 && { borderBottomWidth: 0 }]}>
                        <View style={{ flex: 1, marginRight: 12 }}>
                          <Text style={ds.barDetailTitle}>{t ? t.name : 'General'}</Text>
                          <Text style={ds.barDetailSub} numberOfLines={1}>
                            {[
                              e.date ? (() => {
                                const [, m, d] = e.date.split('-');
                                const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                                return `${+d} ${MO[+m-1]}`;
                              })() : '',
                              e.note
                            ].filter(Boolean).join(' · ')}
                          </Text>
                        </View>
                        <Text style={ds.barDetailAmount}>{fmtFull(effectiveUsd(e))}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </DetailScreen>
  );
}

// ─── 2. Cost By Country ──────────────────────────────────────────────────────

function CostByCountry({ tournaments, expenses }: { tournaments: any[]; expenses: any[] }) {
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null);
  const router = useRouter();
  const { t } = useLanguage();
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const data = useMemo(() => {
    const past = tournaments.filter((t: any) => {
      if (t.isWithdrawn || !t.country) return false;
      const d = parseLocalDate(t.startDate);
      return d && d <= today;
    });

    const byCountry: Record<string, any[]> = {};
    for (const t of past) {
      const key = (t.country as string).toUpperCase();
      if (!byCountry[key]) byCountry[key] = [];
      byCountry[key].push(t);
    }

    return Object.entries(byCountry).map(([country, ts]) => {
      let totalSpent = 0, totalPrize = 0, totalDays = 0;

      const enriched = ts.map((t: any) => {
        const spent = effectiveSum(expenses.filter((e: any) => e.tournamentId === t.id));
        const prize = getPrize(t);
        const days = tournamentDays(t);
        totalSpent += spent;
        totalPrize += prize;
        totalDays += days;
        return { ...t, spent, prize, days, perDay: days > 0 ? spent / days : 0 };
      });

      const count = ts.length;
      return {
        country,
        count,
        totalDays,
        avgSpent: count > 0 ? totalSpent / count : 0,
        avgPrize: count > 0 ? totalPrize / count : 0,
        perDay: totalDays > 0 ? totalSpent / totalDays : 0,
        tournaments: enriched,
      };
    // Primary sort: cost per day (apples-to-apples across trips of different lengths).
    }).sort((a, b) => b.perDay - a.perDay);
  }, [tournaments, expenses]);

  const summary = useMemo(() => {
    if (data.length === 0) return null;
    const sampleSuffix = (count: number) =>
      count >= 3 ? '' : t(count === 1 ? 'insights.summarySampleSuffix' : 'insights.summarySampleSuffixPlural').replace('{count}', String(count));

    if (data.length === 1) {
      const only = data[0];
      return t('insights.summaryCostByCountrySingle')
        .replace('{country}', only.country)
        .replace('{perDay}', fmtFull(only.perDay))
        .replace('{sample}', sampleSuffix(only.count));
    }

    const max = data[0]; // already sorted desc by perDay
    const min = data[data.length - 1];
    return t('insights.summaryCostByCountry')
      .replace('{maxCountry}', max.country).replace('{maxPerDay}', fmtFull(max.perDay)).replace('{maxSample}', sampleSuffix(max.count))
      .replace('{minCountry}', min.country).replace('{minPerDay}', fmtFull(min.perDay)).replace('{minSample}', sampleSuffix(min.count));
  }, [data, t]);

  return (
    <DetailScreen title="Cost By Country">
      <Text style={[ds.subLabel, { marginBottom: 12 }]}>Sorted by cost/day — the comparable number between trips of different lengths</Text>
      {data.length === 0 ? (
        <Text style={ds.emptyText}>Log tournaments and expenses in different countries to see a comparison.</Text>
      ) : (
        <>
          {summary && <SummaryBox text={summary} />}
          {data.map(d => (
        <TouchableOpacity
          key={d.country}
          style={[ds.surfaceCard, { borderColor: '#2A2A48' }]}
          activeOpacity={0.9}
          onPress={() => setExpandedCountry(prev => prev === d.country ? null : d.country)}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={[ds.surfaceIconBox, { backgroundColor: T.card, marginBottom: 0 }]}>
              <Text style={{ fontSize: 28 }}>{countryFlag(d.country)}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[ds.surfaceName, { color: T.textPrimary }]}>{d.country}</Text>
                <Text style={{ fontSize: 12, color: T.textTertiary }}>
                  {expandedCountry === d.country ? '▼' : '▶'}
                </Text>
              </View>
              <Text style={ds.surfaceCount}>
                ({d.count} trips · {d.totalDays} days)
              </Text>
            </View>
          </View>
          <View style={ds.surfaceStats}>
            <View style={ds.surfaceStat}>
              <Text style={ds.surfaceStatLabel}>$/day</Text>
              <Text style={[ds.surfaceStatValue, { color: T.accent }]}>{fmtFull(d.perDay)}</Text>
            </View>
            <View style={ds.surfaceStat}>
              <Text style={ds.surfaceStatLabel}>Avg. total</Text>
              <Text style={ds.surfaceStatValue}>{fmtFull(d.avgSpent)}</Text>
            </View>
            <View style={ds.surfaceStat}>
              <Text style={ds.surfaceStatLabel}>Avg. prize</Text>
              <Text style={[ds.surfaceStatValue, { color: T.green }]}>{fmtFull(d.avgPrize)}</Text>
            </View>
          </View>

          {expandedCountry === d.country && (
            <View style={ds.nestedList}>
              {d.tournaments.map((t: any, idx: number) => (
                <TouchableOpacity
                  key={t.id}
                  style={[ds.nestedRow, idx === d.tournaments.length - 1 && { borderBottomWidth: 0 }]}
                  activeOpacity={0.7}
                  onPress={() => router.push({ pathname: '/(tabs)/expenses', params: { openTournament: t.id } })}
                >
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Text style={ds.nestedTitle}>{t.name}</Text>
                    <Text style={ds.nestedSub}>{t.startDate} · {t.days}d</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={ds.nestedAmount}>{fmtFull(t.spent)}</Text>
                    <Text style={{ fontSize: 11, color: T.textTertiary }}>
                      {fmtFull(t.perDay)}/day
                    </Text>
                    {t.prize > 0 && <Text style={{ fontSize: 11, color: T.green }}>+{fmtFull(t.prize)}</Text>}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </TouchableOpacity>
          ))}
        </>
      )}
    </DetailScreen>
  );
}

// ─── 3. Tournament Costs ─────────────────────────────────────────────────────

function TournamentCosts({ tournaments, expenses }: { tournaments: any[]; expenses: any[] }) {
  const router = useRouter();
  const { t } = useLanguage();
  const ranked = tournaments
    .filter((t: any) => !t.isWithdrawn)
    .map((t: any) => {
      const spent = effectiveSum(expenses.filter((e: any) => e.tournamentId === t.id));
      return { ...t, spent, prize: getPrize(t) };
    })
    .filter(t => t.spent > 0)
    .sort((a, b) => a.spent - b.spent);

  const summary = useMemo(() => {
    if (ranked.length === 0) return null;
    const avg = ranked.reduce((s, tt) => s + tt.spent, 0) / ranked.length;
    if (avg <= 0) return null;
    const top = ranked[ranked.length - 1]; // sorted ascending — last is most expensive
    const multiple = top.spent / avg;
    if (multiple < 1.3) return null; // not enough of an outlier to be worth calling out

    const topExpenses = effectiveExpenses(expenses.filter((e: any) => e.tournamentId === top.id));
    const catTotals: Record<string, number> = {};
    for (const e of topExpenses) {
      const cat = e.category ?? 'Other';
      catTotals[cat] = (catTotals[cat] ?? 0) + effectiveUsd(e);
    }
    const topCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Other';

    return t('insights.summaryTournamentCosts')
      .replace('{avg}', fmtFull(avg))
      .replace('{name}', top.name)
      .replace('{multiple}', multiple.toFixed(1))
      .replace('{category}', topCat.toLowerCase());
  }, [ranked, expenses, t]);

  return (
    <DetailScreen title="Tournament Costs">
      <Text style={ds.subLabel}>{ranked.length} tournaments with expenses</Text>
      {summary && (
        <View style={{ marginTop: 16 }}>
          <SummaryBox text={summary} />
        </View>
      )}
      <View style={{ marginTop: summary ? 8 : 16 }}>
        {ranked.map((t, i) => {
          const sc = SURFACE_COLORS[t.surface as Surface];
          return (
            <TouchableOpacity key={t.id} style={ds.listRow} activeOpacity={0.7}
              onPress={() => router.push({ pathname: '/(tabs)/expenses', params: { openTournament: t.id } })}>
              <Text style={{ fontSize: 16, marginRight: 10 }}>
                {t.surface === 'clay' ? '🟤' : t.surface === 'hard' ? '🔵' : t.surface === 'grass' ? '🟢' : '⚪'}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={ds.listRowTitle}>{countryFlag(t.country)} {t.name}</Text>
                <Text style={ds.listRowSub}>{t.startDate} · {t.surface ?? 'Unknown'}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={ds.listRowAmount}>{fmtFull(t.spent)}</Text>
                {t.prize > 0 && <Text style={{ fontSize: 11, color: T.green }}>+{fmtFull(t.prize)}</Text>}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </DetailScreen>
  );
}

// ─── 5. Coach Impact ─────────────────────────────────────────────────────────

function CoachImpact({ tournaments, expenses }: { tournaments: any[]; expenses: any[] }) {
  const router = useRouter();
  const withCoach: any[] = [];
  const solo: any[] = [];

  for (const t of tournaments.filter((t: any) => !t.isWithdrawn)) {
    const tExp = expenses.filter((e: any) => e.tournamentId === t.id);
    if (tExp.length === 0) continue;
    const hasCoachExp = tExp.some((e: any) => e.isCoachExpense);
    const total = effectiveSum(tExp);
    if (hasCoachExp || t.traveledWithCoach) {
      withCoach.push({ ...t, totalSpent: total });
    } else {
      solo.push({ ...t, totalSpent: total });
    }
  }

  const avgWith = withCoach.length > 0 ? withCoach.reduce((s, t) => s + t.totalSpent, 0) / withCoach.length : 0;
  const avgSolo = solo.length > 0 ? solo.reduce((s, t) => s + t.totalSpent, 0) / solo.length : 0;
  const diff = avgWith - avgSolo;
  const maxAvg = Math.max(avgWith, avgSolo, 1);

  return (
    <DetailScreen title="Coach Impact">
      {withCoach.length === 0 && solo.length === 0 ? (
        <Text style={ds.emptyText}>Log expenses for tournaments to see coach impact analysis.</Text>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={[ds.impactCard, { flex: 1 }]}>
              <Text style={ds.impactLabel}>WITH COACH</Text>
              <Text style={ds.impactAmount}>{fmtFull(avgWith)}</Text>
              <Text style={ds.impactSub}>avg per tournament</Text>
              <Text style={ds.impactCount}>{withCoach.length} tournament{withCoach.length !== 1 ? 's' : ''}</Text>
            </View>
            <View style={[ds.impactCard, { flex: 1 }]}>
              <Text style={ds.impactLabel}>SOLO</Text>
              <Text style={ds.impactAmount}>{fmtFull(avgSolo)}</Text>
              <Text style={ds.impactSub}>avg per tournament</Text>
              <Text style={ds.impactCount}>{solo.length} tournament{solo.length !== 1 ? 's' : ''}</Text>
            </View>
          </View>

          {withCoach.length > 0 && solo.length > 0 && (
            <>
              <View style={{ marginTop: 24, gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{ fontSize: 13, color: T.textSecondary, width: 80 }}>With coach</Text>
                  <View style={{ flex: 1, height: 24, backgroundColor: T.card, borderRadius: 6, overflow: 'hidden' }}>
                    <View style={{ width: `${(avgWith / maxAvg) * 100}%`, height: '100%', backgroundColor: T.accent, borderRadius: 6 }} />
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{ fontSize: 13, color: T.textSecondary, width: 80 }}>Solo</Text>
                  <View style={{ flex: 1, height: 24, backgroundColor: T.card, borderRadius: 6, overflow: 'hidden' }}>
                    <View style={{ width: `${(avgSolo / maxAvg) * 100}%`, height: '100%', backgroundColor: T.teal, borderRadius: 6 }} />
                  </View>
                </View>
              </View>
              <View style={ds.insightBox}>
                <Text style={ds.insightText}>
                  Traveling with your coach costs you an average of {fmtFull(Math.abs(diff))} {diff > 0 ? 'more' : 'less'} per tournament.
                </Text>
              </View>
            </>
          )}

          <Text style={[ds.sectionLabel, { marginTop: 24 }]}>WITH COACH</Text>
          {withCoach.map(t => (
            <TouchableOpacity
              key={t.id}
              style={ds.miniRow}
              activeOpacity={0.7}
              onPress={() => router.push({ pathname: '/(tabs)/expenses', params: { openTournament: t.id } })}
            >
              <Text style={ds.miniRowTitle}>{countryFlag(t.country)} {t.name}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={ds.miniRowAmt}>{fmtFull(t.totalSpent)}</Text>
                <Text style={{ color: T.textTertiary, fontSize: 14 }}>›</Text>
              </View>
            </TouchableOpacity>
          ))}
          <Text style={[ds.sectionLabel, { marginTop: 16 }]}>SOLO</Text>
          {solo.map(t => (
            <TouchableOpacity
              key={t.id}
              style={ds.miniRow}
              activeOpacity={0.7}
              onPress={() => router.push({ pathname: '/(tabs)/expenses', params: { openTournament: t.id } })}
            >
              <Text style={ds.miniRowTitle}>{countryFlag(t.country)} {t.name}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={ds.miniRowAmt}>{fmtFull(t.totalSpent)}</Text>
                <Text style={{ color: T.textTertiary, fontSize: 14 }}>›</Text>
              </View>
            </TouchableOpacity>
          ))}
        </>
      )}
    </DetailScreen>
  );
}

// ─── 6. Biggest Expenses ─────────────────────────────────────────────────────

function BiggestExpenses({ expenses, tournaments }: { expenses: any[]; tournaments: any[] }) {
  const { t } = useLanguage();
  const eff = effectiveExpenses(expenses);
  const total = effectiveSum(expenses);
  const sorted = [...eff].sort((a, b) => effectiveUsd(b) - effectiveUsd(a)).slice(0, 10);
  const tMap = new Map(tournaments.map((t: any) => [t.id, t]));

  const summary = useMemo(() => {
    if (sorted.length === 0 || total <= 0) return null;
    const topSum = sorted.reduce((s, e) => s + effectiveUsd(e), 0);
    const pct = Math.round((topSum / total) * 100);

    const catTotals: Record<string, number> = {};
    for (const e of sorted) {
      const cat = e.category ?? 'Other';
      catTotals[cat] = (catTotals[cat] ?? 0) + effectiveUsd(e);
    }
    const [topCat, topCatAmt] = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
    const allSameCat = Object.keys(catTotals).length === 1;

    if (allSameCat) {
      return t('insights.summaryBiggestExpensesCategory')
        .replace('{count}', String(sorted.length))
        .replace('{category}', topCat.toLowerCase())
        .replace('{amount}', fmtFull(topSum))
        .replace('{pct}', String(pct));
    }
    const catPct = Math.round((topCatAmt / topSum) * 100);
    return t('insights.summaryBiggestExpensesMixed')
      .replace('{count}', String(sorted.length))
      .replace('{amount}', fmtFull(topSum))
      .replace('{pct}', String(pct))
      .replace('{category}', topCat)
      .replace('{catPct}', String(catPct));
  }, [sorted, total, t]);

  return (
    <DetailScreen title="Biggest Expenses">
      <Text style={ds.bigLabel}>{fmtFull(total)}</Text>
      <Text style={ds.subLabel}>Total season expenses</Text>
      {summary && (
        <View style={{ marginTop: 16 }}>
          <SummaryBox text={summary} />
        </View>
      )}
      <View style={{ marginTop: summary ? 4 : 20 }}>
        {sorted.map((e, i) => {
          const t = tMap.get(e.tournamentId);
          return (
            <View key={e.id ?? i} style={ds.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={ds.listRowTitle}>{e.category ?? 'Other'}</Text>
                <Text style={ds.listRowSub}>{t ? t.name : 'General'}{e.date ? ` · ${(() => { const [,m,d] = e.date.split('-'); const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${+d} ${MO[+m-1]}`; })()}` : ''}{e.note ? ` · ${e.note}` : ''}</Text>
              </View>
              <Text style={ds.listRowAmount}>{fmtFull(effectiveUsd(e))}</Text>
            </View>
          );
        })}
      </View>
    </DetailScreen>
  );
}

// ─── 8. Points per Dollar (efficiency) ───────────────────────────────────────
// Replaces the old Cost Per Point screen: inverted framing (points per $1,000
// invested), ranked per tournament — a scheduling tool, not a report card.

// Match a scraped match-history entry to one of the user's tournament records:
// dates within 10 days AND a meaningful word shared between the names (tier
// prefixes like M15/M25/CH stripped first). Conservative on purpose — an
// unmatched entry degrades to a "points only" row rather than a wrong pairing.
function matchHistoryToTournament(h: any, tournaments: any[]): any | null {
  const hDate = parseLocalDate(h.date);
  if (!hDate) return null;
  const stripTier = (s: string) =>
    (s ?? '').toLowerCase().replace(/\b(m15|m25|m50|m100|ch|wtt|challenger)\b/g, '').trim();
  const hName = stripTier(h.tournamentName ?? '');
  const hWords = new Set(hName.split(/[^a-zà-ÿ]+/).filter((w: string) => w.length >= 4));
  for (const t of tournaments) {
    const tDate = parseLocalDate(t.startDate);
    if (!tDate) continue;
    if (Math.abs(tDate.getTime() - hDate.getTime()) > 10 * 86400000) continue;
    const tName = stripTier(t.name ?? '');
    if (!tName || !hName) continue;
    if (tName.includes(hName) || hName.includes(tName)) return t;
    const tWords = tName.split(/[^a-zà-ÿ]+/).filter((w: string) => w.length >= 4);
    if (tWords.some((w: string) => hWords.has(w))) return t;
  }
  return null;
}

function PointsPerDollar({ expenses, tournaments, atpMatchHistory }: {
  expenses: any[]; tournaments: any[]; atpMatchHistory: any[];
}) {
  const router = useRouter();
  const totalPoints = atpMatchHistory.reduce((s: number, m: any) => s + (m.pointsEarned ?? 0), 0);
  const totalSpent = effectiveSum(expenses);

  const { ranked, pointsOnly } = useMemo(() => {
    const ranked: any[] = [];
    const pointsOnly: any[] = [];
    for (const h of atpMatchHistory) {
      const pts = h.pointsEarned ?? 0;
      if (pts <= 0) continue;
      const t = matchHistoryToTournament(h, tournaments);
      const cost = t ? effectiveSum(expenses.filter((e: any) => e.tournamentId === t.id)) : 0;
      if (t && cost > 0) {
        ranked.push({ id: t.id, name: t.name, country: t.country, date: h.date, pts, cost, per1k: pts / (cost / 1000) });
      } else {
        pointsOnly.push({ name: h.tournamentName, date: h.date, pts });
      }
    }
    ranked.sort((a, b) => b.per1k - a.per1k);
    return { ranked: ranked.slice(0, 12), pointsOnly: pointsOnly.slice(0, 12 - Math.min(ranked.length, 12)) };
  }, [atpMatchHistory, tournaments, expenses]);

  if (totalPoints === 0) {
    return (
      <DetailScreen title="Points per $1k">
        <View style={{ alignItems: 'center', marginTop: 40 }}>
          <Text style={{ fontSize: 48 }}>📊</Text>
          <Text style={{ fontSize: 18, fontWeight: '700', color: T.textPrimary, marginTop: 16 }}>Log match results to unlock</Text>
          <Text style={{ fontSize: 14, color: T.textSecondary, marginTop: 8, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 }}>
            Once your match results are in, you&apos;ll see which tournaments earn you ranking points at the lowest cost.
          </Text>
        </View>
      </DetailScreen>
    );
  }

  const seasonPer1k = totalSpent > 0 ? totalPoints / (totalSpent / 1000) : 0;
  const best = ranked[0];

  return (
    <DetailScreen title="Points per $1k">
      <View style={{ alignItems: 'center', marginTop: 16 }}>
        <Text style={{ fontSize: 42, fontWeight: '800', color: T.textPrimary }}>{seasonPer1k.toFixed(1)} pts</Text>
        <Text style={{ fontSize: 15, color: T.textSecondary, marginTop: 4 }}>per $1,000 invested</Text>
      </View>
      <View style={[ds.insightBox, { marginTop: 24 }]}>
        <Text style={ds.insightText}>
          {best
            ? `Your most efficient event was ${best.name}: ${best.per1k.toFixed(1)} pts per $1k vs. your season average of ${seasonPer1k.toFixed(1)}. More weeks like that one climb the ranking cheapest.`
            : `You've earned ${totalPoints} points on ${fmtFull(totalSpent)} invested this season. Link expenses to tournaments to see which events earn points cheapest.`}
        </Text>
      </View>
      {ranked.length > 0 && (
        <View style={{ marginTop: 24 }}>
          <Text style={ds.subLabel}>Ranked by efficiency — best first</Text>
          {ranked.map((r, i) => (
            <TouchableOpacity key={r.id + r.date} style={ds.listRow} activeOpacity={0.7}
              onPress={() => router.push({ pathname: '/(tabs)/expenses', params: { openTournament: r.id } })}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: T.textTertiary, width: 24 }}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={ds.listRowTitle}>{countryFlag(r.country)} {r.name}</Text>
                <Text style={ds.listRowSub}>{r.pts} pts · {fmtFull(r.cost)}</Text>
              </View>
              <Text style={[ds.listRowAmount, { color: T.accent }]}>{r.per1k.toFixed(1)} /$1k</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {pointsOnly.length > 0 && (
        <View style={{ marginTop: 20 }}>
          <Text style={ds.subLabel}>Points earned, no expenses linked</Text>
          {pointsOnly.map((r, i) => (
            <View key={`${r.name}-${i}`} style={ds.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={[ds.listRowTitle, { color: T.textSecondary }]}>{r.name}</Text>
                <Text style={ds.listRowSub}>{r.date}</Text>
              </View>
              <Text style={[ds.listRowAmount, { color: T.textTertiary }]}>{r.pts} pts</Text>
            </View>
          ))}
        </View>
      )}
    </DetailScreen>
  );
}

// ─── 9. Points By Surface ────────────────────────────────────────────────────

function PointsBySurface({ tournaments, atpMatchHistory }: { tournaments: any[]; atpMatchHistory: any[] }) {
  const [expandedSurface, setExpandedSurface] = useState<Surface | null>(null);
  const router = useRouter();

  const hasPoints = atpMatchHistory.some((m: any) => (m.pointsEarned ?? 0) > 0);

  if (!hasPoints) {
    return (
      <DetailScreen title="Points By Surface">
        <View style={{ alignItems: 'center', marginTop: 40 }}>
          <Text style={{ fontSize: 48 }}>🎾</Text>
          <Text style={{ fontSize: 18, fontWeight: '700', color: T.textPrimary, marginTop: 16 }}>Log results to unlock</Text>
          <Text style={{ fontSize: 14, color: T.textSecondary, marginTop: 8, textAlign: 'center' }}>
            Enter match results to see your points breakdown by surface.
          </Text>
        </View>
      </DetailScreen>
    );
  }

  const surfaces: Surface[] = ['clay', 'hard', 'grass'];
  const data = surfaces.map(s => {
    const entries = atpMatchHistory.filter((m: any) => m.surface === s);
    const totalPts = entries.reduce((sum: number, m: any) => sum + (m.pointsEarned ?? 0), 0);
    const best = entries.reduce((b: any, m: any) => (!b || (m.pointsEarned ?? 0) > (b.pointsEarned ?? 0)) ? m : b, null);
    return { surface: s as Surface, count: entries.length, totalPts, avgPts: entries.length > 0 ? totalPts / entries.length : 0, best, entries };
  }).filter(d => d.count > 0);

  return (
    <DetailScreen title="Points By Surface">
      {data.map(d => {
        const sc = SURFACE_COLORS[d.surface];
        return (
          <TouchableOpacity
            key={d.surface}
            style={[ds.surfaceCard, { borderColor: sc.fill + '30' }]}
            activeOpacity={0.9}
            onPress={() => setExpandedSurface(prev => prev === d.surface ? null : d.surface)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={[ds.surfaceIconBox, { backgroundColor: sc.bg, marginBottom: 0 }]}>
                <Text style={{ fontSize: 28 }}>{d.surface === 'clay' ? '🟤' : d.surface === 'hard' ? '🔵' : '🟢'}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[ds.surfaceName, { color: sc.text }]}>{d.surface.charAt(0).toUpperCase() + d.surface.slice(1)}</Text>
                  <Text style={{ fontSize: 12, color: sc.text + '80' }}>
                    {expandedSurface === d.surface ? '▼' : '▶'}
                  </Text>
                </View>
                <Text style={ds.surfaceCount}>{d.count} tournament{d.count !== 1 ? 's' : ''} · {d.totalPts} pts total</Text>
              </View>
            </View>
            <View style={ds.surfaceStats}>
              <View style={ds.surfaceStat}>
                <Text style={ds.surfaceStatLabel}>Avg. Points</Text>
                <Text style={ds.surfaceStatValue}>{d.avgPts.toFixed(1)}</Text>
              </View>
              <View style={ds.surfaceStat}>
                <Text style={ds.surfaceStatLabel}>Tournaments</Text>
                <Text style={ds.surfaceStatValue}>{d.count}</Text>
              </View>
            </View>
            {d.best && (d.best.pointsEarned ?? 0) > 0 && (
              <Text style={{ fontSize: 12, color: T.textSecondary, marginTop: 8 }}>
                Best: {d.best.tournamentName} ({d.best.pointsEarned} pts)
              </Text>
            )}

            {expandedSurface === d.surface && (
              <View style={ds.nestedList}>
                {d.entries.map((m: any, idx: number) => {
                  const linked = tournaments.find((t: any) =>
                    t.name?.toLowerCase().includes((m.tournamentName ?? '').toLowerCase().split(' ')[0]) &&
                    Math.abs(new Date(t.startDate).getTime() - new Date(m.date).getTime()) < 14 * 86400000
                  );
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[ds.nestedRow, idx === d.entries.length - 1 && { borderBottomWidth: 0 }]}
                      activeOpacity={linked ? 0.7 : 1}
                      onPress={() => linked && router.push({ pathname: '/(tabs)/expenses', params: { openTournament: linked.id } })}
                    >
                      <View style={{ flex: 1, marginRight: 12 }}>
                        <Text style={ds.nestedTitle}>{m.tournamentName ?? '—'}</Text>
                        <Text style={ds.nestedSub}>{m.date}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={[ds.nestedAmount, { color: T.green }]}>+{m.pointsEarned ?? 0} pts</Text>
                        {linked && <Text style={{ color: T.textTertiary, fontSize: 14 }}>›</Text>}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </DetailScreen>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function InsightsScreen() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const { data } = useAppQuery({ tournaments: {}, expenses: {} });
  const tournaments = data?.tournaments ?? [];
  const expenses = data?.expenses ?? [];

  const [atpMatchHistory, setAtpMatchHistory] = useState<any[] | null>(null);

  const ATP_TYPES = ['cost-per-point', 'points-per-dollar', 'points-by-surface'];
  const needsAtp = ATP_TYPES.includes(type ?? '');

  useEffect(() => {
    if (!needsAtp) return;
    // Reset synchronously so LoadingLogo renders from the very first frame.
    setAtpMatchHistory(null);
    let cancelled = false;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled || !user) { if (!cancelled) setAtpMatchHistory([]); return; }
      supabase.from('profiles').select('atp_player_name').eq('id', user.id).single()
        .then(({ data: prof }) => {
          if (cancelled || !prof?.atp_player_name) { if (!cancelled) setAtpMatchHistory([]); return; }
          const nameParts = prof.atp_player_name.trim().split(/\s+/).slice(0, 2).join(' ');
          supabase.from('player_profiles').select('match_history')
            .ilike('player_name', `%${nameParts}%`)
            .order('last_updated', { ascending: false }).limit(1)
            .then(({ data: rows }) => {
              if (cancelled) return;
              setAtpMatchHistory(rows?.[0]?.match_history ?? []);
            }, () => { if (!cancelled) setAtpMatchHistory([]); });
        }, () => { if (!cancelled) setAtpMatchHistory([]); });
    });

    return () => { cancelled = true; };
  }, [type]);

  if (needsAtp && atpMatchHistory === null) return <LoadingLogo />;

  const safeAtp = atpMatchHistory ?? [];

  switch (type) {
    case 'where-money-goes':    return <WhereMoneyGoes expenses={expenses} tournaments={tournaments} />;
    case 'cost-by-country':    return <CostByCountry tournaments={tournaments} expenses={expenses} />;
    case 'tournament-costs':    return <TournamentCosts tournaments={tournaments} expenses={expenses} />;
    case 'coach-impact':        return <CoachImpact tournaments={tournaments} expenses={expenses} />;
    case 'biggest-expenses':    return <BiggestExpenses expenses={expenses} tournaments={tournaments} />;
    // 'cost-per-point' kept as an alias so any old links still resolve
    case 'cost-per-point':
    case 'points-per-dollar':   return <LoadingFade isLoading={false}><PointsPerDollar expenses={expenses} tournaments={tournaments} atpMatchHistory={safeAtp} /></LoadingFade>;
    case 'points-by-surface':   return <LoadingFade isLoading={false}><PointsBySurface tournaments={tournaments} atpMatchHistory={safeAtp} /></LoadingFade>;
    default:
      return (
        <DetailScreen title="Insight">
          <Text style={ds.emptyText}>Unknown insight type.</Text>
        </DetailScreen>
      );
  }
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const ds = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: T.cardBorder,
  },
  backBtn: { width: 70 },
  backText: { fontSize: 15, fontWeight: '600', color: T.teal },
  headerTitle: { fontSize: 17, fontWeight: '700', color: T.textPrimary, flex: 1, textAlign: 'center' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },

  bigLabel: { fontSize: 32, fontWeight: '800', color: T.textPrimary },
  subLabel: { fontSize: 14, color: T.textSecondary, marginTop: 4 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: T.textTertiary, letterSpacing: 0.8, marginBottom: 8 },
  emptyText: { fontSize: 15, color: T.textTertiary, textAlign: 'center', marginTop: 40, lineHeight: 22 },

  barDetailList: {
    marginTop: 12,
    backgroundColor: '#161626',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  barDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
  },
  barDetailTitle: { fontSize: 13, fontWeight: '600', color: T.textPrimary },
  barDetailSub: { fontSize: 11, color: T.textSecondary, marginTop: 2 },
  barDetailAmount: { fontSize: 13, fontWeight: '700', color: T.textPrimary },

  nestedList: {
    marginTop: 16,
    backgroundColor: '#11111E',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  nestedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.card,
  },
  nestedTitle: { fontSize: 13, fontWeight: '600', color: T.textPrimary },
  nestedSub: { fontSize: 11, color: T.textSecondary, marginTop: 2 },
  nestedAmount: { fontSize: 13, fontWeight: '700', color: T.textPrimary },

  barRow: { marginBottom: 18 },
  barLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  barCatName: { fontSize: 14, fontWeight: '600', color: T.textPrimary, textTransform: 'capitalize' },
  barAmount: { fontSize: 14, fontWeight: '600', color: T.textPrimary },
  barTrack: { height: 8, backgroundColor: T.card, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  barPct: { fontSize: 11, fontWeight: '600', marginTop: 4 },

  surfaceCard: {
    backgroundColor: T.card, borderRadius: 16, padding: 20, marginBottom: 14,
    borderWidth: 1,
  },
  surfaceIconBox: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  surfaceName: { fontSize: 20, fontWeight: '700' },
  surfaceCount: { fontSize: 13, color: T.textSecondary, marginTop: 2 },
  surfaceStats: { flexDirection: 'row', gap: 24, marginTop: 14 },
  surfaceStat: {},
  surfaceStatLabel: { fontSize: 11, color: T.textTertiary, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 },
  surfaceStatValue: { fontSize: 20, fontWeight: '700', color: T.textPrimary },

  listRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: T.card,
  },
  listRowTitle: { fontSize: 14, fontWeight: '600', color: T.textPrimary },
  listRowSub: { fontSize: 12, color: T.textSecondary, marginTop: 2 },
  listRowAmount: { fontSize: 15, fontWeight: '700', color: T.textPrimary },

  impactCard: {
    backgroundColor: T.card, borderRadius: 16, padding: 16, alignItems: 'center',
  },
  impactLabel: { fontSize: 11, fontWeight: '700', color: T.textTertiary, letterSpacing: 0.6 },
  impactAmount: { fontSize: 24, fontWeight: '800', color: T.textPrimary, marginTop: 8 },
  impactSub: { fontSize: 12, color: T.textSecondary, marginTop: 4 },
  impactCount: { fontSize: 12, color: T.textTertiary, marginTop: 8 },

  insightBox: {
    backgroundColor: T.card, borderRadius: 14, padding: 16,
    borderLeftWidth: 3, borderLeftColor: T.teal,
  },
  insightText: { fontSize: 14, color: T.textPrimary, lineHeight: 21 },

  summaryBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: T.accent + '14', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: T.accent + '30',
    marginBottom: 20,
  },
  summaryEmoji: { fontSize: 15, lineHeight: 19 },
  summaryText: { flex: 1, fontSize: 13, lineHeight: 19, color: T.textSecondary },

  miniRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.card,
  },
  miniRowTitle: { fontSize: 14, color: T.textPrimary, fontWeight: '500' },
  miniRowAmt: { fontSize: 14, fontWeight: '600', color: T.textPrimary },

  statRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: T.card,
  },
  statLabel: { fontSize: 14, color: T.textSecondary },
  statValue: { fontSize: 15, fontWeight: '700', color: T.textPrimary },
});

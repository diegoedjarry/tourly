import React, { useMemo, useState } from 'react';
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
import Svg, { Path } from 'react-native-svg';
import { useAppQuery } from '@/hooks/useAppQuery';
import { T } from '@/constants/theme';
import { useLanguage } from '@/hooks/useLanguage';
import { getMonthAbbr } from '@/lib/i18n';

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

function countryFlag(c: string): string {
  const code = (c ?? '').toUpperCase();
  if (code.length !== 2) return '🌍';
  return String.fromCodePoint(...[...code].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
}

function parseLocalDate(val: string | undefined): Date | null {
  if (!val || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return null;
  const [y, m, d] = val.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getPrize(t: any): number {
  const s = t.singlesPrizeMoney ?? 0;
  const d = t.doublesPrizeMoney ?? 0;
  return s + d > 0 ? s + d : (t.prizeMoney ?? 0);
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

// ─── 1. Where Your Money Goes ────────────────────────────────────────────────

function WhereMoneyGoes({ expenses, tournaments }: { expenses: any[]; tournaments: any[] }) {
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const { t, lang } = useLanguage();

  const grouped: Record<string, number> = {};
  for (const e of expenses) {
    const cat = e.category ?? 'Other';
    grouped[cat] = (grouped[cat] ?? 0) + (e.amount ?? 0);
  }
  const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, v]) => s + v, 0);

  const tMap = useMemo(() => new Map(tournaments.map((t: any) => [t.id, t])), [tournaments]);

  return (
    <DetailScreen title={t('insights.whereMoneyGoes')}>
      <Text style={ds.bigLabel}>{fmtFull(total)}</Text>
      <Text style={ds.subLabel}>{t('insights.totalSeasonExpenses')}</Text>
      <View style={{ marginTop: 24 }}>
        {sorted.map(([cat, val]) => {
          const pct = total > 0 ? (val / total) * 100 : 0;
          const color = catColor(cat);
          const catExpenses = expenses
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
                        <Text style={ds.barDetailAmount}>{fmtFull(e.amount ?? 0)}</Text>
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

// ─── 2. Cost By Surface ──────────────────────────────────────────────────────

function CostBySurface({ tournaments, expenses }: { tournaments: any[]; expenses: any[] }) {
  const surfaces: Surface[] = ['clay', 'hard', 'grass'];
  const [expandedSurface, setExpandedSurface] = useState<Surface | null>(null);
  const router = useRouter();
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const data = surfaces.map(s => {
    const ts = tournaments.filter((t: any) => {
      if (t.surface !== s || t.isWithdrawn) return false;
      const d = parseLocalDate(t.startDate);
      return d && d <= today;
    });
    const count = ts.length;
    const totalSpent = ts.reduce((sum: number, t: any) => {
      return sum + expenses.filter((e: any) => e.tournamentId === t.id).reduce((s2: number, e: any) => s2 + (e.amount ?? 0), 0);
    }, 0);
    const totalPrize = ts.reduce((sum: number, t: any) => sum + getPrize(t), 0);
    return { surface: s, count, avgSpent: count > 0 ? totalSpent / count : 0, avgPrize: count > 0 ? totalPrize / count : 0 };
  }).filter(d => d.count > 0);

  return (
    <DetailScreen title="Cost By Surface">
      {data.length === 0 ? (
        <Text style={ds.emptyText}>No tournament data yet. Add tournaments with surface info to see insights.</Text>
      ) : data.map(d => {
        const sc = SURFACE_COLORS[d.surface];
        const surfaceTournaments = tournaments.filter((t: any) => {
          if (t.surface !== d.surface || t.isWithdrawn) return false;
          const dt = parseLocalDate(t.startDate);
          return dt && dt <= today;
        });
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
                <Text style={ds.surfaceCount}>{d.count} tournament{d.count !== 1 ? 's' : ''}</Text>
              </View>
            </View>
            <View style={ds.surfaceStats}>
              <View style={ds.surfaceStat}>
                <Text style={ds.surfaceStatLabel}>Avg. Spend</Text>
                <Text style={ds.surfaceStatValue}>{fmtFull(d.avgSpent)}</Text>
              </View>
              <View style={ds.surfaceStat}>
                <Text style={ds.surfaceStatLabel}>Avg. Prize</Text>
                <Text style={[ds.surfaceStatValue, { color: T.green }]}>{fmtFull(d.avgPrize)}</Text>
              </View>
            </View>

            {expandedSurface === d.surface && (
              <View style={ds.nestedList}>
                {surfaceTournaments.map((t: any, idx: number) => {
                  const spent = expenses.filter((e: any) => e.tournamentId === t.id).reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
                  const prize = getPrize(t);
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={[ds.nestedRow, idx === surfaceTournaments.length - 1 && { borderBottomWidth: 0 }]}
                      activeOpacity={0.7}
                      onPress={() => router.push({ pathname: '/(tabs)/expenses', params: { openTournament: t.id } })}
                    >
                      <View style={{ flex: 1, marginRight: 12 }}>
                        <Text style={ds.nestedTitle}>{countryFlag(t.country)} {t.name}</Text>
                        <Text style={ds.nestedSub}>{t.startDate}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={ds.nestedAmount}>{fmtFull(spent)}</Text>
                        {prize > 0 && <Text style={{ fontSize: 11, color: T.green }}>+{fmtFull(prize)}</Text>}
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

// ─── 3. Tournament Costs ─────────────────────────────────────────────────────

function TournamentCosts({ tournaments, expenses }: { tournaments: any[]; expenses: any[] }) {
  const router = useRouter();
  const ranked = tournaments
    .filter((t: any) => !t.isWithdrawn)
    .map((t: any) => {
      const spent = expenses.filter((e: any) => e.tournamentId === t.id).reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
      return { ...t, spent, prize: getPrize(t) };
    })
    .filter(t => t.spent > 0)
    .sort((a, b) => a.spent - b.spent);

  return (
    <DetailScreen title="Tournament Costs">
      <Text style={ds.subLabel}>{ranked.length} tournaments with expenses</Text>
      <View style={{ marginTop: 16 }}>
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

// ─── 4. Season Heatmap ───────────────────────────────────────────────────────

function SeasonHeatmap({ expenses, tournaments }: { expenses: any[]; tournaments: any[] }) {
  const { width } = useWindowDimensions();
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  const GAP = 3;
  const CELL = Math.floor((width - 40 - 11 * GAP) / 12);
  const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Build Monday-start weeks for the selected year, grouped by month
  const { monthWeeks, weekData } = useMemo(() => {
    // Find the first Monday on or before Jan 1
    const jan1 = new Date(selectedYear, 0, 1);
    const jan1Day = jan1.getDay(); // 0=Sun
    const firstMonday = new Date(selectedYear, 0, 1 - ((jan1Day + 6) % 7));

    // Generate all Monday-start weeks that have at least one day in this year
    const allWeeks: { start: Date; end: Date; month: number; weekIndex: number }[] = [];
    let weekIndex = 0;
    let monday = new Date(firstMonday);
    while (monday.getFullYear() <= selectedYear) {
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      // A week belongs to the month of its Monday
      const weekMonth = monday.getMonth();
      const weekYear = monday.getFullYear();
      // Only include if the Monday is in the selected year
      if (weekYear === selectedYear) {
        allWeeks.push({ start: new Date(monday), end: sunday, month: weekMonth, weekIndex });
        weekIndex++;
      }
      monday.setDate(monday.getDate() + 7);
    }

    // Group weeks by month
    const grouped: { start: Date; end: Date; month: number; weekIndex: number }[][] = Array.from({ length: 12 }, () => []);
    for (const w of allWeeks) {
      grouped[w.month].push(w);
    }

    // Calculate spending per week
    const spendByWeek: Record<number, number> = {};
    const tournamentsByWeek: Record<number, any[]> = {};
    for (const w of allWeeks) {
      spendByWeek[w.weekIndex] = 0;
      tournamentsByWeek[w.weekIndex] = [];
    }

    for (const e of expenses) {
      const d = parseLocalDate(e.date);
      if (!d || d.getFullYear() !== selectedYear) continue;
      // Find which week this date falls into
      for (const w of allWeeks) {
        if (d >= w.start && d <= w.end) {
          spendByWeek[w.weekIndex] += e.amount ?? 0;
          break;
        }
      }
    }

    // Map tournaments to weeks by startDate
    for (const t of tournaments) {
      const d = parseLocalDate(t.startDate);
      if (!d || d.getFullYear() !== selectedYear) continue;
      for (const w of allWeeks) {
        if (d >= w.start && d <= w.end) {
          if (!tournamentsByWeek[w.weekIndex]) tournamentsByWeek[w.weekIndex] = [];
          tournamentsByWeek[w.weekIndex].push(t);
          break;
        }
      }
    }

    return {
      monthWeeks: grouped,
      weekData: { allWeeks, spendByWeek, tournamentsByWeek },
    };
  }, [expenses, tournaments, selectedYear]);

  // Calculate thresholds from non-zero spending
  const { lowThreshold, highThreshold } = useMemo(() => {
    const nonZero = Object.values(weekData.spendByWeek).filter(s => s > 0).sort((a, b) => a - b);
    if (nonZero.length === 0) return { lowThreshold: 1, highThreshold: 2 };
    const third = Math.ceil(nonZero.length / 3);
    return {
      lowThreshold: nonZero[Math.min(third, nonZero.length - 1)],
      highThreshold: nonZero[Math.min(third * 2, nonZero.length - 1)],
    };
  }, [weekData.spendByWeek]);

  // Current week index
  const currentWeekIndex = useMemo(() => {
    if (selectedYear !== now.getFullYear()) return -1;
    for (const w of weekData.allWeeks) {
      if (now >= w.start && now <= w.end) return w.weekIndex;
    }
    return -1;
  }, [selectedYear, weekData.allWeeks]);

  function weekColor(spend: number): string {
    if (spend === 0) return T.card;
    if (spend <= lowThreshold) return T.accentMuted;
    if (spend <= highThreshold) return T.accent;
    return T.red;
  }

  // Detail for selected week
  const selectedDetail = useMemo(() => {
    if (selectedWeek === null) return null;
    const w = weekData.allWeeks.find(w => w.weekIndex === selectedWeek);
    if (!w) return null;
    const spend = weekData.spendByWeek[selectedWeek] ?? 0;
    const tourns = weekData.tournamentsByWeek[selectedWeek] ?? [];
    const startStr = `${MONTH_NAMES[w.start.getMonth()]} ${w.start.getDate()}`;
    const endStr = `${MONTH_NAMES[w.end.getMonth()]} ${w.end.getDate()}`;
    return { dateRange: `${startStr} — ${endStr}`, spend, tournaments: tourns };
  }, [selectedWeek, weekData]);

  const maxRows = Math.max(...monthWeeks.map(mw => mw.length), 1);

  return (
    <DetailScreen title="Season Heatmap">
      {/* Year navigation */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 20, paddingVertical: 8 }}>
        <TouchableOpacity onPress={() => { setSelectedYear(y => y - 1); setSelectedWeek(null); }} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 28, color: T.accent, fontWeight: '300' }}>{'‹'}</Text>
        </TouchableOpacity>
        <View style={{ backgroundColor: T.cardBorder, borderRadius: 22, paddingHorizontal: 24, paddingVertical: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: T.textPrimary }}>{selectedYear}</Text>
        </View>
        {selectedYear < now.getFullYear() ? (
          <TouchableOpacity onPress={() => { setSelectedYear(y => y + 1); setSelectedWeek(null); }} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 28, color: T.accent, fontWeight: '300' }}>{'›'}</Text>
          </TouchableOpacity>
        ) : <View style={{ width: 44 }} />}
      </View>

      <Text style={[ds.subLabel, { textAlign: 'center', marginBottom: 16 }]}>Weekly spending intensity</Text>

      {/* Month headers */}
      <View style={{ flexDirection: 'row', gap: GAP, marginBottom: 6, paddingHorizontal: 0 }}>
        {MONTHS.map((m, i) => (
          <View key={i} style={{ width: CELL, alignItems: 'center' }}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: T.textTertiary, letterSpacing: 0.5 }}>{m}</Text>
          </View>
        ))}
      </View>

      {/* Grid: 12 columns (months) x maxRows rows (weeks) */}
      {Array.from({ length: maxRows }).map((_, rowIdx) => (
        <View key={rowIdx} style={{ flexDirection: 'row', gap: GAP, marginBottom: GAP }}>
          {monthWeeks.map((mw, monthIdx) => {
            const week = mw[rowIdx];
            if (!week) {
              return <View key={monthIdx} style={{ width: CELL, height: CELL }} />;
            }
            const spend = weekData.spendByWeek[week.weekIndex] ?? 0;
            const isCurrent = week.weekIndex === currentWeekIndex;
            const isSelected = week.weekIndex === selectedWeek;
            return (
              <TouchableOpacity
                key={monthIdx}
                activeOpacity={0.7}
                onPress={() => setSelectedWeek(prev => prev === week.weekIndex ? null : week.weekIndex)}
                style={{
                  width: CELL,
                  height: CELL,
                  borderRadius: 3,
                  backgroundColor: weekColor(spend),
                  borderWidth: isCurrent ? 1.5 : isSelected ? 1.5 : 0,
                  borderColor: isCurrent ? T.accent : isSelected ? T.textPrimary : 'transparent',
                }}
              />
            );
          })}
        </View>
      ))}

      {/* Legend */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: T.card }} />
          <Text style={{ fontSize: 12, color: T.textSecondary }}>No data</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: T.accentMuted }} />
          <Text style={{ fontSize: 12, color: T.textSecondary }}>Low</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: T.accent }} />
          <Text style={{ fontSize: 12, color: T.textSecondary }}>Medium</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: T.red }} />
          <Text style={{ fontSize: 12, color: T.textSecondary }}>High</Text>
        </View>
      </View>

      {/* Selected week detail card */}
      {selectedDetail && (
        <View style={{ backgroundColor: T.card, borderRadius: 14, padding: 16, marginTop: 20, borderLeftWidth: 3, borderLeftColor: T.accent }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: T.textPrimary }}>{selectedDetail.dateRange}</Text>
          {selectedDetail.tournaments.length > 0 && (
            <Text style={{ fontSize: 13, color: T.textSecondary, marginTop: 6 }}>
              {selectedDetail.tournaments.map((t: any) => t.name).join(', ')}
            </Text>
          )}
          <Text style={{ fontSize: 15, fontWeight: '700', color: selectedDetail.spend > 0 ? T.textPrimary : T.textTertiary, marginTop: 8 }}>
            {selectedDetail.spend > 0 ? fmtFull(selectedDetail.spend) : 'No expenses'}
          </Text>
        </View>
      )}
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
    const total = tExp.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
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
  const total = expenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
  const sorted = [...expenses].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, 10);
  const tMap = new Map(tournaments.map((t: any) => [t.id, t]));

  return (
    <DetailScreen title="Biggest Expenses">
      <Text style={ds.bigLabel}>{fmtFull(total)}</Text>
      <Text style={ds.subLabel}>Total season expenses</Text>
      <View style={{ marginTop: 20 }}>
        {sorted.map((e, i) => {
          const t = tMap.get(e.tournamentId);
          return (
            <View key={e.id ?? i} style={ds.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={ds.listRowTitle}>{e.category ?? 'Other'}</Text>
                <Text style={ds.listRowSub}>{t ? t.name : 'General'}{e.date ? ` · ${(() => { const [,m,d] = e.date.split('-'); const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${+d} ${MO[+m-1]}`; })()}` : ''}{e.note ? ` · ${e.note}` : ''}</Text>
              </View>
              <Text style={ds.listRowAmount}>{fmtFull(e.amount ?? 0)}</Text>
            </View>
          );
        })}
      </View>
    </DetailScreen>
  );
}

// ─── 7. Tracking Streak ──────────────────────────────────────────────────────

function TrackingStreak({ tournaments, expenses }: { tournaments: any[]; expenses: any[] }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const past = tournaments
    .filter((t: any) => {
      if (t.isWithdrawn) return false;
      const d = parseLocalDate(t.startDate);
      return d && d <= today;
    })
    .sort((a: any, b: any) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));

  const tracked = past.map((t: any) => ({
    ...t,
    hasExpenses: expenses.some((e: any) => e.tournamentId === t.id),
  }));

  let streak = 0;
  for (const t of tracked) {
    if (t.hasExpenses) streak++;
    else break;
  }

  const messages = [
    { min: 0, text: 'Start tracking expenses for your tournaments to build your streak!' },
    { min: 1, text: 'Great start! Keep logging expenses for every tournament.' },
    { min: 3, text: 'Nice consistency! You\'re building a financial edge.' },
    { min: 5, text: 'Strong streak! Your data is becoming really valuable.' },
    { min: 8, text: 'Incredible discipline! Most players don\'t track like this.' },
    { min: 12, text: 'Elite tracking! You have complete financial visibility.' },
  ];
  const msg = [...messages].reverse().find(m => streak >= m.min)?.text ?? messages[0].text;

  return (
    <DetailScreen title="Tracking Streak">
      <View style={{ alignItems: 'center', marginTop: 32 }}>
        <Text style={{ fontSize: 48 }}>🔥</Text>
        <Text style={{ fontSize: 56, fontWeight: '800', color: T.textPrimary, marginTop: 8 }}>{streak}</Text>
        <Text style={{ fontSize: 15, color: T.textSecondary, marginTop: 4 }}>consecutive tournaments tracked</Text>
      </View>
      <View style={{ marginTop: 32 }}>
        {tracked.map((t, i) => (
          <View key={t.id} style={[ds.miniRow, { paddingVertical: 12 }]}>
            <Text style={{ fontSize: 16, marginRight: 10 }}>{t.hasExpenses ? '✅' : '—'}</Text>
            <Text style={[ds.miniRowTitle, { flex: 1, color: t.hasExpenses ? T.textPrimary : T.textTertiary }]}>
              {countryFlag(t.country)} {t.name}
            </Text>
          </View>
        ))}
      </View>
      <View style={[ds.insightBox, { marginTop: 24 }]}>
        <Text style={ds.insightText}>{msg}</Text>
      </View>
    </DetailScreen>
  );
}

// ─── 8. Cost Per Point ───────────────────────────────────────────────────────

function CostPerPoint({ tournaments, expenses }: { tournaments: any[]; expenses: any[] }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const past = tournaments.filter((t: any) => {
    const d = parseLocalDate(t.startDate);
    return d && d <= today && !t.isWithdrawn;
  });

  const totalPoints = past.reduce((s: number, t: any) => s + (t.pointsEarned ?? 0), 0);
  const totalSpent = past.reduce((s: number, t: any) => {
    return s + expenses.filter((e: any) => e.tournamentId === t.id).reduce((s2: number, e: any) => s2 + (e.amount ?? 0), 0);
  }, 0);

  if (totalPoints === 0) {
    return (
      <DetailScreen title="Cost Per Point">
        <View style={{ alignItems: 'center', marginTop: 40 }}>
          <Text style={{ fontSize: 48 }}>📊</Text>
          <Text style={{ fontSize: 18, fontWeight: '700', color: T.textPrimary, marginTop: 16 }}>Log match results to unlock</Text>
          <Text style={{ fontSize: 14, color: T.textSecondary, marginTop: 8, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 }}>
            Enter your match results and points earned in the tournament detail screen to see your cost per ranking point.
          </Text>
        </View>
      </DetailScreen>
    );
  }

  const costPerPoint = totalSpent / totalPoints;

  return (
    <DetailScreen title="Cost Per Point">
      <View style={{ alignItems: 'center', marginTop: 16 }}>
        <Text style={{ fontSize: 42, fontWeight: '800', color: T.textPrimary }}>{fmtFull(costPerPoint)}</Text>
        <Text style={{ fontSize: 15, color: T.textSecondary, marginTop: 4 }}>per ranking point</Text>
      </View>
      <View style={[ds.insightBox, { marginTop: 24 }]}>
        <Text style={ds.insightText}>
          You are spending {fmtFull(costPerPoint)} for every ranking point you earn. The average Futures player spends approximately $800–$1,200 per point.
        </Text>
      </View>
      <View style={{ marginTop: 24 }}>
        <View style={ds.statRow}>
          <Text style={ds.statLabel}>Total points earned</Text>
          <Text style={ds.statValue}>{totalPoints}</Text>
        </View>
        <View style={ds.statRow}>
          <Text style={ds.statLabel}>Total invested</Text>
          <Text style={ds.statValue}>{fmtFull(totalSpent)}</Text>
        </View>
        <View style={ds.statRow}>
          <Text style={ds.statLabel}>Tournaments played</Text>
          <Text style={ds.statValue}>{past.length}</Text>
        </View>
      </View>
    </DetailScreen>
  );
}

// ─── 9. Points By Surface ────────────────────────────────────────────────────

function PointsBySurface({ tournaments }: { tournaments: any[] }) {
  const [expandedSurface, setExpandedSurface] = useState<Surface | null>(null);
  const router = useRouter();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const past = tournaments.filter((t: any) => {
    const d = parseLocalDate(t.startDate);
    return d && d <= today && !t.isWithdrawn;
  });

  const hasPoints = past.some((t: any) => (t.pointsEarned ?? 0) > 0);

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
    const ts = past.filter((t: any) => t.surface === s);
    const totalPts = ts.reduce((sum: number, t: any) => sum + (t.pointsEarned ?? 0), 0);
    const best = ts.reduce((best: any, t: any) => (!best || (t.pointsEarned ?? 0) > (best.pointsEarned ?? 0)) ? t : best, null);
    return { surface: s, count: ts.length, totalPts, avgPts: ts.length > 0 ? totalPts / ts.length : 0, best };
  }).filter(d => d.count > 0);

  return (
    <DetailScreen title="Points By Surface">
      {data.map(d => {
        const sc = SURFACE_COLORS[d.surface];
        const surfaceTournaments = past.filter((t: any) => t.surface === d.surface);
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
                <Text style={ds.surfaceCount}>{d.count} tournament{d.count !== 1 ? 's' : ''}</Text>
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
                Best: {d.best.name} ({d.best.pointsEarned} pts)
              </Text>
            )}

            {expandedSurface === d.surface && (
              <View style={ds.nestedList}>
                {surfaceTournaments.map((t: any, idx: number) => (
                  <TouchableOpacity
                    key={t.id}
                    style={[ds.nestedRow, idx === surfaceTournaments.length - 1 && { borderBottomWidth: 0 }]}
                    activeOpacity={0.7}
                    onPress={() => router.push({ pathname: '/(tabs)/expenses', params: { openTournament: t.id } })}
                  >
                    <View style={{ flex: 1, marginRight: 12 }}>
                      <Text style={ds.nestedTitle}>{countryFlag(t.country)} {t.name}</Text>
                      <Text style={ds.nestedSub}>{t.startDate}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[ds.nestedAmount, { color: T.green }]}>+{t.pointsEarned ?? 0} pts</Text>
                      <Text style={{ color: T.textTertiary, fontSize: 14 }}>›</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </DetailScreen>
  );
}

// ─── 10. Ranking Efficiency ──────────────────────────────────────────────────

function RankingEfficiency({ tournaments, expenses }: { tournaments: any[]; expenses: any[] }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const past = tournaments.filter((t: any) => {
    const d = parseLocalDate(t.startDate);
    return d && d <= today && !t.isWithdrawn && (t.pointsEarned ?? 0) > 0;
  });

  if (past.length === 0) {
    return (
      <DetailScreen title="Ranking Efficiency">
        <View style={{ alignItems: 'center', marginTop: 40 }}>
          <Text style={{ fontSize: 48 }}>📈</Text>
          <Text style={{ fontSize: 18, fontWeight: '700', color: T.textPrimary, marginTop: 16 }}>Log results to unlock</Text>
          <Text style={{ fontSize: 14, color: T.textSecondary, marginTop: 8, textAlign: 'center' }}>
            Enter match results and points earned to see which tournaments give you the best value.
          </Text>
        </View>
      </DetailScreen>
    );
  }

  const ranked = past.map((t: any) => {
    const spent = expenses.filter((e: any) => e.tournamentId === t.id).reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
    const points = t.pointsEarned ?? 0;
    const efficiency = spent > 0 ? points / (spent / 1000) : points * 10;
    return { ...t, spent, points, efficiency };
  }).sort((a, b) => b.efficiency - a.efficiency);

  function effColor(eff: number): string {
    const max = ranked[0]?.efficiency ?? 1;
    const ratio = eff / max;
    if (ratio > 0.6) return T.green;
    if (ratio > 0.3) return T.amber;
    return T.red;
  }

  return (
    <DetailScreen title="Ranking Efficiency">
      <Text style={ds.subLabel}>Higher score = more points per dollar spent</Text>
      <View style={{ marginTop: 16 }}>
        {ranked.map(t => (
          <View key={t.id} style={ds.listRow}>
            <Text style={{ fontSize: 16, marginRight: 10 }}>
              {t.surface === 'clay' ? '🟤' : t.surface === 'hard' ? '🔵' : t.surface === 'grass' ? '🟢' : '⚪'}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={ds.listRowTitle}>{countryFlag(t.country)} {t.name}</Text>
              <Text style={ds.listRowSub}>{t.points} pts · {fmtFull(t.spent)}</Text>
            </View>
            <View style={[ds.effPill, { backgroundColor: effColor(t.efficiency) + '20' }]}>
              <Text style={[ds.effPillText, { color: effColor(t.efficiency) }]}>{t.efficiency.toFixed(1)}</Text>
            </View>
          </View>
        ))}
      </View>
    </DetailScreen>
  );
}

// ─── 11. Points vs Investment ────────────────────────────────────────────────

function PointsVsInvestment({ tournaments, expenses }: { tournaments: any[]; expenses: any[] }) {
  const { width } = useWindowDimensions();
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const past = tournaments
    .filter((t: any) => { const d = parseLocalDate(t.startDate); return d && d <= today && !t.isWithdrawn; })
    .sort((a: any, b: any) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));

  const hasPoints = past.some((t: any) => (t.pointsEarned ?? 0) > 0);
  if (!hasPoints) {
    return (
      <DetailScreen title="Points vs Investment">
        <View style={{ alignItems: 'center', marginTop: 40 }}>
          <Text style={{ fontSize: 48 }}>📉</Text>
          <Text style={{ fontSize: 18, fontWeight: '700', color: T.textPrimary, marginTop: 16 }}>Log results to unlock</Text>
          <Text style={{ fontSize: 14, color: T.textSecondary, marginTop: 8, textAlign: 'center' }}>
            Enter match results to see your points vs investment trend over the season.
          </Text>
        </View>
      </DetailScreen>
    );
  }

  let cumPoints = 0, cumExpenses = 0;
  const dataPoints = past.map((t: any) => {
    cumPoints += t.pointsEarned ?? 0;
    cumExpenses += expenses.filter((e: any) => e.tournamentId === t.id).reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
    return { label: t.name?.substring(0, 8) ?? '', cumPoints, cumExpenses };
  });

  const chartW = width - 80;
  const chartH = 200;
  const maxPts = Math.max(...dataPoints.map(d => d.cumPoints), 1);
  const maxExp = Math.max(...dataPoints.map(d => d.cumExpenses), 1);

  function pointsPath() {
    return dataPoints.map((d, i) => {
      const x = dataPoints.length === 1 ? chartW / 2 : (i / (dataPoints.length - 1)) * chartW;
      const y = chartH - (d.cumPoints / maxPts) * (chartH - 20);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  }

  function expPath() {
    return dataPoints.map((d, i) => {
      const x = dataPoints.length === 1 ? chartW / 2 : (i / (dataPoints.length - 1)) * chartW;
      const y = chartH - (d.cumExpenses / maxExp) * (chartH - 20);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  }

  return (
    <DetailScreen title="Points vs Investment">
      <View style={{ marginTop: 16, alignItems: 'center' }}>
        <Svg width={chartW} height={chartH}>
          <Path d={pointsPath()} stroke={T.green} strokeWidth={2.5} fill="none" strokeLinecap="round" />
          <Path d={expPath()} stroke={T.accent} strokeWidth={2.5} fill="none" strokeLinecap="round" />
        </Svg>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 12, height: 3, backgroundColor: T.green, borderRadius: 2 }} />
          <Text style={{ fontSize: 12, color: T.textSecondary }}>Ranking Points</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 12, height: 3, backgroundColor: T.accent, borderRadius: 2 }} />
          <Text style={{ fontSize: 12, color: T.textSecondary }}>Expenses</Text>
        </View>
      </View>
      <View style={[ds.insightBox, { marginTop: 24 }]}>
        <Text style={ds.insightText}>
          {cumPoints > 0 && cumExpenses > 0
            ? `You've earned ${cumPoints} points while investing ${fmtFull(cumExpenses)}. That's ${fmtFull(cumExpenses / cumPoints)} per point over the season.`
            : 'Keep logging results to build a clearer picture of your investment efficiency.'}
        </Text>
      </View>
    </DetailScreen>
  );
}

// ─── 12. Cost to Gain 10 Spots ───────────────────────────────────────────────

function CostToGain10({ tournaments, expenses }: { tournaments: any[]; expenses: any[] }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const past = tournaments.filter((t: any) => {
    const d = parseLocalDate(t.startDate);
    return d && d <= today && !t.isWithdrawn && (t.pointsEarned ?? 0) > 0;
  });

  if (past.length < 5) {
    return (
      <DetailScreen title="Cost to Gain 10 Spots">
        <View style={{ alignItems: 'center', marginTop: 40 }}>
          <Text style={{ fontSize: 48 }}>🎯</Text>
          <Text style={{ fontSize: 18, fontWeight: '700', color: T.textPrimary, marginTop: 16 }}>Need more data</Text>
          <Text style={{ fontSize: 14, color: T.textSecondary, marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
            Need at least 5 tournaments with match results to estimate your cost to gain ranking positions.
          </Text>
        </View>
      </DetailScreen>
    );
  }

  const totalPoints = past.reduce((s: number, t: any) => s + (t.pointsEarned ?? 0), 0);
  const totalSpent = past.reduce((s: number, t: any) => {
    return s + expenses.filter((e: any) => e.tournamentId === t.id).reduce((s2: number, e: any) => s2 + (e.amount ?? 0), 0);
  }, 0);
  const costPerPoint = totalSpent / totalPoints;
  const estimatedPointsFor10 = Math.ceil(totalPoints / past.length) * 3;
  const estimatedCost = costPerPoint * estimatedPointsFor10;
  const avgPtsPerTournament = totalPoints / past.length;
  const tournamentsNeeded = Math.ceil(estimatedPointsFor10 / avgPtsPerTournament);

  return (
    <DetailScreen title="Cost to Gain 10 Spots">
      <View style={{ alignItems: 'center', marginTop: 16 }}>
        <Text style={{ fontSize: 42, fontWeight: '800', color: T.textPrimary }}>Est. {fmtFull(estimatedCost)}</Text>
        <Text style={{ fontSize: 15, color: T.textSecondary, marginTop: 4 }}>to gain 10 ranking positions</Text>
      </View>
      <View style={{ marginTop: 32 }}>
        <View style={ds.statRow}>
          <Text style={ds.statLabel}>Your avg cost per point</Text>
          <Text style={ds.statValue}>{fmtFull(costPerPoint)}</Text>
        </View>
        <View style={ds.statRow}>
          <Text style={ds.statLabel}>Est. points needed</Text>
          <Text style={ds.statValue}>{estimatedPointsFor10}</Text>
        </View>
        <View style={ds.statRow}>
          <Text style={ds.statLabel}>Est. tournaments needed</Text>
          <Text style={ds.statValue}>{tournamentsNeeded}</Text>
        </View>
        <View style={ds.statRow}>
          <Text style={ds.statLabel}>Avg points per tournament</Text>
          <Text style={ds.statValue}>{avgPtsPerTournament.toFixed(1)}</Text>
        </View>
      </View>
      <View style={[ds.insightBox, { marginTop: 24 }]}>
        <Text style={ds.insightText}>
          Based on your {past.length} tournaments with results, you earn an average of {avgPtsPerTournament.toFixed(1)} points per tournament at a cost of {fmtFull(costPerPoint)} per point. You'd need approximately {tournamentsNeeded} more tournaments to climb 10 spots.
        </Text>
      </View>
    </DetailScreen>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function InsightsScreen() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const { data } = useAppQuery({ tournaments: {}, expenses: {} });
  const tournaments = data?.tournaments ?? [];
  const expenses = data?.expenses ?? [];

  switch (type) {
    case 'where-money-goes':    return <WhereMoneyGoes expenses={expenses} tournaments={tournaments} />;
    case 'cost-by-surface':     return <CostBySurface tournaments={tournaments} expenses={expenses} />;
    case 'tournament-costs':    return <TournamentCosts tournaments={tournaments} expenses={expenses} />;
    case 'season-heatmap':      return <SeasonHeatmap expenses={expenses} tournaments={tournaments} />;
    case 'coach-impact':        return <CoachImpact tournaments={tournaments} expenses={expenses} />;
    case 'biggest-expenses':    return <BiggestExpenses expenses={expenses} tournaments={tournaments} />;
    case 'tracking-streak':     return <TrackingStreak tournaments={tournaments} expenses={expenses} />;
    case 'cost-per-point':      return <CostPerPoint tournaments={tournaments} expenses={expenses} />;
    case 'points-by-surface':   return <PointsBySurface tournaments={tournaments} />;
    case 'ranking-efficiency':  return <RankingEfficiency tournaments={tournaments} expenses={expenses} />;
    case 'points-vs-investment':return <PointsVsInvestment tournaments={tournaments} expenses={expenses} />;
    case 'cost-to-gain-10':     return <CostToGain10 tournaments={tournaments} expenses={expenses} />;
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

  miniRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.card,
  },
  miniRowTitle: { fontSize: 14, color: T.textPrimary, fontWeight: '500' },
  miniRowAmt: { fontSize: 14, fontWeight: '600', color: T.textPrimary },

  effPill: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  effPillText: { fontSize: 13, fontWeight: '700' },

  statRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: T.card,
  },
  statLabel: { fontSize: 14, color: T.textSecondary },
  statValue: { fontSize: 15, fontWeight: '700', color: T.textPrimary },
});

import React, { useMemo } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/text';
import { useAppQuery } from '@/hooks/useAppQuery';

const SURFACES: Array<{ key: 'clay' | 'hard' | 'grass'; label: string; color: string }> = [
  { key: 'clay',  label: 'Clay',  color: '#D4915A' },
  { key: 'hard',  label: 'Hard',  color: '#5A8CD4' },
  { key: 'grass', label: 'Grass', color: '#5ABE6E' },
];

const CATEGORY_ORDER = ['M15', 'M25', 'M50', 'M60', 'Challenger', 'ATP 250', 'ATP 500', 'ATP 1000'];

function fmtUSD(amount: number) {
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export default function MyPerformanceScreen() {
  const router = useRouter();
  const { data } = useAppQuery({});
  const tournaments = data?.tournaments ?? [];
  const expenses    = data?.expenses ?? [];

  const bySurface = useMemo(() => {
    const map: Record<string, any[]> = { clay: [], hard: [], grass: [] };
    tournaments.forEach((t: any) => {
      if (t.surface && map[t.surface]) map[t.surface].push(t);
    });
    return map;
  }, [tournaments]);

  function expensesForTournament(tId: string): number {
    return expenses
      .filter((e: any) => e.tournamentId === tId)
      .reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
  }

  // Best conditions
  const bestSurface = useMemo(() => {
    const entries = Object.entries(bySurface).sort((a, b) => b[1].length - a[1].length);
    return entries[0]?.[0] ?? null;
  }, [bySurface]);

  const bestCategory = useMemo(() => {
    if (!tournaments.length) return null;
    const counts: Record<string, number> = {};
    tournaments.forEach((t: any) => { const c = t.category ?? 'Unknown'; counts[c] = (counts[c] ?? 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [tournaments]);

  // Expense efficiency by surface
  const surfaceExpenses = useMemo(() => {
    const map: Record<string, { total: number; count: number }> = { clay: { total: 0, count: 0 }, hard: { total: 0, count: 0 }, grass: { total: 0, count: 0 } };
    Object.entries(bySurface).forEach(([surf, ts]) => {
      ts.forEach((t: any) => {
        const cost = expensesForTournament(t.id);
        if (cost > 0) { map[surf].total += cost; map[surf].count += 1; }
      });
    });
    return map;
  }, [bySurface, expenses]);

  const tournamentsWithExpenses = useMemo(() =>
    tournaments.filter((t: any) => expensesForTournament(t.id) > 0).length
  , [tournaments, expenses]);

  // By category
  const byCategory = useMemo(() => {
    const map: Record<string, { count: number; totalPrize: number }> = {};
    tournaments.forEach((t: any) => {
      const cat = t.category ?? 'Other';
      if (!map[cat]) map[cat] = { count: 0, totalPrize: 0 };
      map[cat].count += 1;
      const singles = t.singlesPrizeMoney ?? 0;
      const doubles = t.doublesPrizeMoney ?? 0;
      map[cat].totalPrize += singles + doubles > 0 ? singles + doubles : (t.prizeMoney ?? 0);
    });
    return map;
  }, [tournaments]);

  const sortedCategories = useMemo(() =>
    Object.entries(byCategory).sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a[0]);
      const bi = CATEGORY_ORDER.indexOf(b[0]);
      const ar = ai === -1 ? 99 : ai;
      const br = bi === -1 ? 99 : bi;
      return ar !== br ? ar - br : b[1].count - a[1].count;
    })
  , [byCategory]);

  // Season timeline — past tournaments only (start date before today)
  const timeline = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return [...tournaments]
      .filter((t: any) => {
        if (!t.startDate) return false;
        const [y, m, d] = t.startDate.split('-').map(Number);
        return new Date(y, m - 1, d) < today;
      })
      .sort((a: any, b: any) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
  }, [tournaments]);

  // Optimal suggestion (needs ≥ 3 tournaments with expenses)
  const optimalSuggestion = useMemo(() => {
    if (tournamentsWithExpenses < 3) return null;
    let best: { surface: string; category: string; avgCost: number } | null = null;
    SURFACES.forEach(({ key }) => {
      const ts = bySurface[key] ?? [];
      ts.forEach((t: any) => {
        const cost = expensesForTournament(t.id);
        if (cost === 0) return;
        const cat = t.category ?? 'Unknown';
        if (!best || cost < best.avgCost) best = { surface: key, category: cat, avgCost: cost };
      });
    });
    return best;
  }, [bySurface, expenses, tournamentsWithExpenses]);

  function abbrevDate(dateStr: string | undefined): string {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[m - 1]} ${d}`;
  }

  const surfaceLabel: Record<string, string> = { clay: 'Clay', hard: 'Hard', grass: 'Grass' };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0F0F1A" />

      {/* Header */}
      <View style={s.header}>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>My Performance</Text>
        </View>
        <TouchableOpacity style={s.closeBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="close" size={22} color="#FAFAFA" />
        </TouchableOpacity>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>

        {/* BEST CONDITIONS */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>BEST CONDITIONS</Text>
          {tournaments.length < 2 ? (
            <View style={s.card}>
              <Text style={s.lockedText}>Add more tournaments to unlock</Text>
            </View>
          ) : (
            <View style={s.rowCards}>
              {/* Surface */}
              <View style={[s.condCard, { flex: 1 }]}>
                <Text style={s.condCardLabel}>Surface</Text>
                <Text style={s.condCardValue}>{bestSurface ? (surfaceLabel[bestSurface] ?? bestSurface) : '—'}</Text>
                <Text style={s.condCardCount}>{bestSurface ? bySurface[bestSurface].length : 0} tourns</Text>
              </View>
              {/* Category */}
              <View style={[s.condCard, { flex: 1 }]}>
                <Text style={s.condCardLabel}>Category</Text>
                <Text style={s.condCardValue}>{bestCategory ?? '—'}</Text>
                <Text style={s.condCardCount}>{bestCategory ? (byCategory[bestCategory]?.count ?? 0) : 0} tourns</Text>
              </View>
            </View>
          )}
        </View>

        {/* WIN RATE BY SURFACE */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>WIN RATE BY SURFACE</Text>
          <View style={s.card}>
            {SURFACES.map(({ key, label, color }) => (
              <View key={key} style={s.surfaceRow}>
                <View style={[s.surfaceDot, { backgroundColor: color }]} />
                <Text style={s.surfaceLabel}>{label}</Text>
                <Text style={s.surfaceCount}>({bySurface[key].length})</Text>
                <View style={s.barTrack}>
                  <View style={[s.barFill, { width: '0%', backgroundColor: color }]} />
                </View>
                <Ionicons name="lock-closed" size={12} color="#6060A0" style={{ marginRight: 4 }} />
                <Text style={s.lockedSmall}>Log results</Text>
              </View>
            ))}
          </View>
        </View>

        {/* EXPENSE EFFICIENCY BY SURFACE */}
        {tournamentsWithExpenses >= 2 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>EXPENSE EFFICIENCY BY SURFACE</Text>
            <View style={s.card}>
              {SURFACES.map(({ key, label, color }) => {
                const data = surfaceExpenses[key];
                const avg = data.count > 0 ? Math.round(data.total / data.count) : null;
                return (
                  <View key={key} style={s.surfaceRow}>
                    <View style={[s.surfaceDot, { backgroundColor: color }]} />
                    <Text style={s.surfaceLabel}>{label}</Text>
                    <View style={{ flex: 1 }} />
                    {avg !== null ? (
                      <Text style={s.effValue}>{fmtUSD(avg)} avg/tournament</Text>
                    ) : (
                      <Text style={s.lockedSmall}>No data</Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* TOURNAMENTS BY CATEGORY */}
        {tournaments.length >= 1 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>TOURNAMENTS BY CATEGORY</Text>
            <View style={s.card}>
              {sortedCategories.map(([cat, stats]) => {
                const avgPrize = stats.count > 0 ? Math.round(stats.totalPrize / stats.count) : 0;
                return (
                  <View key={cat} style={s.catRow}>
                    <Text style={s.catName}>{cat}</Text>
                    <Text style={s.catCount}>{stats.count} {stats.count === 1 ? 'tournament' : 'tournaments'}</Text>
                    {avgPrize > 0 && (
                      <Text style={s.catPrize}>{fmtUSD(avgPrize)} avg prize</Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* SEASON TIMELINE — past tournaments only */}
        {timeline.length >= 1 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>SEASON TIMELINE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.timelineScroll}>
              {timeline.map((t: any) => {
                const surf = SURFACES.find(sf => sf.key === t.surface);
                const singles = t.singlesPrizeMoney ?? 0;
                const doubles = t.doublesPrizeMoney ?? 0;
                const prize = singles + doubles > 0 ? singles + doubles : (t.prizeMoney ?? 0);
                return (
                  <View key={t.id} style={s.miniCard}>
                    <View style={s.miniCardTop}>
                      <View style={[s.miniDot, { backgroundColor: surf?.color ?? '#6060A0' }]} />
                      <Text style={s.miniDate}>{abbrevDate(t.startDate)}</Text>
                    </View>
                    <Text style={s.miniCity} numberOfLines={1}>{t.city ?? t.name}</Text>
                    {prize > 0 && <Text style={s.miniPrize}>{fmtUSD(prize)}</Text>}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* OPTIMAL CALENDAR SUGGESTION */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>OPTIMAL CALENDAR SUGGESTION</Text>
          {tournamentsWithExpenses < 3 ? (
            <View style={s.card}>
              <Text style={s.lockedText}>Add 3+ tournaments with expenses to get your personalized calendar suggestion</Text>
            </View>
          ) : optimalSuggestion ? (
            <View style={s.suggestionCard}>
              <Ionicons name="bulb-outline" size={20} color="#FAFAFA" style={{ marginBottom: 8 }} />
              <Text style={s.suggestionText}>
                Based on your data,{' '}
                <Text style={s.suggestionHighlight}>
                  {surfaceLabel[optimalSuggestion.surface] ?? optimalSuggestion.surface} {optimalSuggestion.category}
                </Text>
                {' '}tournaments offer your best cost efficiency at{' '}
                <Text style={s.suggestionHighlight}>{fmtUSD(optimalSuggestion.avgCost)}</Text>
                {' '}per tournament.
              </Text>
            </View>
          ) : (
            <View style={s.card}>
              <Text style={s.lockedText}>Not enough expense data yet</Text>
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0F0F1A' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },

  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A4A',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#FAFAFA' },
  closeBtn: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1A1A2E',
    alignItems: 'center',
    justifyContent: 'center',
  },

  section: { marginHorizontal: 16, marginTop: 20 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#A0A0C8',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },

  card: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2A2A4A',
  },

  rowCards: { flexDirection: 'row', gap: 10 },
  condCard: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2A2A4A',
    alignItems: 'center',
  },
  condCardLabel: { fontSize: 10, fontWeight: '600', color: '#A0A0C8', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 },
  condCardValue: { fontSize: 16, fontWeight: '700', color: '#FAFAFA', marginBottom: 2 },
  condCardCount: { fontSize: 11, color: '#6060A0' },

  surfaceRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  surfaceDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  surfaceLabel: { fontSize: 13, fontWeight: '600', color: '#FAFAFA', width: 38 },
  surfaceCount: { fontSize: 11, color: '#6060A0', marginRight: 8, width: 24 },
  barTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#252540',
    borderRadius: 3,
    overflow: 'hidden',
    marginRight: 8,
  },
  barFill: { height: '100%', borderRadius: 3 },

  lockedText: { fontSize: 13, color: '#6060A0', textAlign: 'center', lineHeight: 20 },
  lockedSmall: { fontSize: 10, color: '#6060A0' },
  effValue: { fontSize: 12, fontWeight: '600', color: '#FAFAFA' },

  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A4A',
    gap: 8,
  },
  catName: { fontSize: 14, fontWeight: '700', color: '#FAFAFA', width: 80 },
  catCount: { fontSize: 12, color: '#A0A0C8', flex: 1 },
  catPrize: { fontSize: 12, fontWeight: '600', color: '#5B5BD6' },

  timelineScroll: { paddingRight: 8, gap: 10 },
  miniCard: {
    backgroundColor: '#1A1A2E',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#2A2A4A',
    width: 110,
  },
  miniCardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 5 },
  miniDot: { width: 7, height: 7, borderRadius: 4 },
  miniDate: { fontSize: 10, color: '#A0A0C8', fontWeight: '600' },
  miniCity: { fontSize: 12, fontWeight: '700', color: '#FAFAFA', marginBottom: 4 },
  miniPrize: { fontSize: 11, color: '#5B5BD6', fontWeight: '600' },

  suggestionCard: {
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(91,91,214,0.4)',
    backgroundColor: 'rgba(91,91,214,0.12)',
    alignItems: 'flex-start',
  },
  suggestionText: { fontSize: 14, color: '#FAFAFA', lineHeight: 22 },
  suggestionHighlight: { fontWeight: '700', color: '#5B5BD6' },
});

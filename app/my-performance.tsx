import React, { useMemo, useState, useEffect } from 'react';
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
import { supabase } from '@/lib/supabase';

const SURFACES: Array<{ key: 'clay' | 'hard'; label: string; color: string }> = [
  { key: 'clay', label: 'Clay', color: '#D4915A' },
  { key: 'hard', label: 'Hard', color: '#5A8CD4' },
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

  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  // Only tournaments already played (start date in the past)
  const pastTournaments = useMemo(() => {
    return tournaments.filter((t: any) => {
      if (!t.startDate) return false;
      const [y, m, d] = t.startDate.split('-').map(Number);
      return new Date(y, m - 1, d) < today;
    });
  }, [tournaments, today]);

  // Past tournaments grouped by surface
  const bySurface = useMemo(() => {
    const map: Record<string, any[]> = { clay: [], hard: [] };
    pastTournaments.forEach((t: any) => {
      if (t.surface && map[t.surface]) map[t.surface].push(t);
    });
    return map;
  }, [pastTournaments]);

  function expensesForTournament(tId: string): number {
    return expenses
      .filter((e: any) => e.tournamentId === tId)
      .reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
  }

  // Expense efficiency by surface
  const surfaceExpenses = useMemo(() => {
    const map: Record<string, { total: number; count: number }> = { clay: { total: 0, count: 0 }, hard: { total: 0, count: 0 } };
    Object.entries(bySurface).forEach(([surf, ts]) => {
      ts.forEach((t: any) => {
        const cost = expensesForTournament(t.id);
        if (cost > 0) { map[surf].total += cost; map[surf].count += 1; }
      });
    });
    return map;
  }, [bySurface, expenses]);

  const tournamentsWithExpenses = useMemo(() =>
    pastTournaments.filter((t: any) => expensesForTournament(t.id) > 0).length
  , [pastTournaments, expenses]);

  // By category — past tournaments only
  const byCategory = useMemo(() => {
    const map: Record<string, { count: number; totalPrize: number; tournaments: any[] }> = {};
    pastTournaments.forEach((t: any) => {
      const cat = t.category ?? 'Other';
      if (!map[cat]) map[cat] = { count: 0, totalPrize: 0, tournaments: [] };
      map[cat].count += 1;
      map[cat].tournaments.push(t);
      const singles = t.singlesPrizeMoney ?? 0;
      const doubles = t.doublesPrizeMoney ?? 0;
      map[cat].totalPrize += singles + doubles > 0 ? singles + doubles : (t.prizeMoney ?? 0);
    });
    return map;
  }, [pastTournaments]);

  const sortedCategories = useMemo(() =>
    Object.entries(byCategory).sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a[0]);
      const bi = CATEGORY_ORDER.indexOf(b[0]);
      const ar = ai === -1 ? 99 : ai;
      const br = bi === -1 ? 99 : bi;
      return ar !== br ? ar - br : b[1].count - a[1].count;
    })
  , [byCategory]);

  // Season timeline — merge local past tournaments + ATP match history
  const timeline = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const local = [...tournaments]
      .filter((t: any) => {
        if (!t.startDate) return false;
        const [y, m, d] = t.startDate.split('-').map(Number);
        return new Date(y, m - 1, d) < today;
      })
      .map((t: any) => ({
        id: t.id,
        name: t.city ?? t.name ?? '',
        startDate: t.startDate,
        surface: t.surface,
        prize: (t.singlesPrizeMoney ?? 0) + (t.doublesPrizeMoney ?? 0) || (t.prizeMoney ?? 0),
        roundReached: undefined as string | undefined,
        pointsEarned: undefined as number | undefined,
        source: 'local' as const,
      }));

    // ATP match history entries — add ones not already covered by a local entry
    const atpEntries = (atpProfile?.match_history as any[] ?? []).map((m: any) => ({
      id: `atp-${m.tournamentName}-${m.date}`,
      name: m.tournamentName ?? '',
      startDate: m.date ?? '',
      surface: m.surface,
      prize: 0,
      roundReached: m.roundReached as string | undefined,
      pointsEarned: m.pointsEarned as number | undefined,
      source: 'atp' as const,
    }));

    // Deduplicate: skip ATP entry if a local entry has the same start date or close name match
    const localDates = new Set(local.map(t => t.startDate?.slice(0, 7))); // year-month
    const localNames = local.map(t => t.name.toLowerCase());
    const deduped = atpEntries.filter(a => {
      const monthKey = a.startDate?.slice(0, 7);
      if (monthKey && localDates.has(monthKey)) return false;
      const aName = a.name.toLowerCase();
      return !localNames.some(n => n.includes(aName.split(' ')[0]) || aName.includes(n.split(' ')[0]));
    });

    return [...local, ...deduped].sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
  }, [tournaments, atpProfile]);

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

  // ── ATP player profile from Supabase ────────────────────────────────────────
  const [atpProfile, setAtpProfile] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('profiles').select('atp_player_name, ipin_number').eq('id', user.id).single()
        .then(({ data: prof }) => {
          if (!prof?.ipin_number && !prof?.atp_player_name) return;
          const query = prof.ipin_number
            ? supabase.from('player_profiles').select('*').eq('ipin', prof.ipin_number).limit(1)
            : supabase.from('player_profiles').select('*').ilike('player_name', `%${prof.atp_player_name.trim().split(/\s+/).slice(0, 2).join(' ')}%`).limit(1);
          query.then(({ data }) => { if (data?.[0]) setAtpProfile(data[0]); });
        });
    });
  }, []);

  const atpMatchHistory = useMemo(() => {
    if (!atpProfile?.match_history) return [];
    return (atpProfile.match_history as any[]).slice(0, 20);
  }, [atpProfile]);

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

        {/* ATP RANKING */}
        {atpProfile && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>ATP RANKING</Text>
            <View style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#5B5BD6', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: '#FAFAFA' }}>#{atpProfile.current_ranking ?? '—'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#FAFAFA' }}>{atpProfile.player_name}</Text>
                <Text style={{ fontSize: 12, color: '#A0A0C8', marginTop: 2 }}>ATP Singles Ranking</Text>
                {atpProfile.last_updated && (
                  <Text style={{ fontSize: 11, color: '#6060A0', marginTop: 4 }}>
                    Updated {abbrevDate(atpProfile.last_updated.slice(0, 10))}
                  </Text>
                )}
              </View>
            </View>
          </View>
        )}

        {/* MATCH RECORD */}
        {atpProfile?.win_loss_by_surface && (() => {
          const wl = atpProfile.win_loss_by_surface as Record<string, { wins: number; losses: number }>;
          const total = wl.total ?? { wins: 0, losses: 0 };
          const totalW = total.wins ?? 0;
          const totalL = total.losses ?? 0;
          const pct = totalW + totalL > 0 ? Math.round((totalW / (totalW + totalL)) * 100) : null;
          const surfaces: Array<{ key: string; label: string; color: string }> = [
            { key: 'clay', label: 'Clay', color: '#D4915A' },
            { key: 'hard', label: 'Hard', color: '#5A8CD4' },
            { key: 'grass', label: 'Grass', color: '#5A9E5A' },
          ];
          return (
            <View style={s.section}>
              <Text style={s.sectionLabel}>MATCH RECORD</Text>
              <View style={s.card}>
                {/* Overall row */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                  <View style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={{ fontSize: 28, fontWeight: '800', color: '#2D9E6B' }}>{totalW}</Text>
                    <Text style={{ fontSize: 11, color: '#A0A0C8', marginTop: 2 }}>Wins</Text>
                  </View>
                  {pct !== null && (
                    <View style={{ alignItems: 'center', paddingHorizontal: 16 }}>
                      <Text style={{ fontSize: 22, fontWeight: '800', color: '#5B5BD6' }}>{pct}%</Text>
                      <Text style={{ fontSize: 11, color: '#A0A0C8', marginTop: 2 }}>Win rate</Text>
                    </View>
                  )}
                  <View style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={{ fontSize: 28, fontWeight: '800', color: '#E24B4A' }}>{totalL}</Text>
                    <Text style={{ fontSize: 11, color: '#A0A0C8', marginTop: 2 }}>Losses</Text>
                  </View>
                </View>
                {/* Surface breakdown */}
                {surfaces.map(({ key, label, color }) => {
                  const s2 = wl[key];
                  if (!s2 || (s2.wins === 0 && s2.losses === 0)) return null;
                  const sp = s2.wins + s2.losses > 0 ? Math.round((s2.wins / (s2.wins + s2.losses)) * 100) : 0;
                  return (
                    <View key={key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#2A2A4A' }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginRight: 8 }} />
                      <Text style={{ fontSize: 13, color: '#A0A0C8', width: 44 }}>{label}</Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: '#FAFAFA' }}>{s2.wins}W – {s2.losses}L</Text>
                      <View style={{ flex: 1 }} />
                      <Text style={{ fontSize: 12, color: '#5B5BD6', fontWeight: '600' }}>{sp}%</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })()}

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
                      <Text style={s.effValue}>{fmtUSD(avg)}{'\n'}avg/tournament</Text>
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
        {pastTournaments.length >= 1 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>TOURNAMENTS BY CATEGORY</Text>
            <View style={s.card}>
              {sortedCategories.map(([cat, stats]) => {
                const avgPrize = stats.count > 0 ? Math.round(stats.totalPrize / stats.count) : 0;
                const isOpen = expandedCategory === cat;
                return (
                  <View key={cat}>
                    <TouchableOpacity
                      style={s.catRow}
                      onPress={() => setExpandedCategory(v => v === cat ? null : cat)}
                      activeOpacity={0.7}
                    >
                      <Text style={s.catName}>{cat}</Text>
                      <Text style={s.catCount}>{stats.count} {stats.count === 1 ? 'tournament' : 'tournaments'}</Text>
                      {avgPrize > 0 && (
                        <Text style={s.catPrize}>{fmtUSD(avgPrize)} avg prize</Text>
                      )}
                      <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={13} color="#6060A0" style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                    {isOpen && (
                      <View style={s.resultsPanel}>
                        {[...(stats.tournaments ?? [])]
                          .sort((a: any, b: any) => {
                            const pa = (a.singlesPrizeMoney ?? 0) + (a.doublesPrizeMoney ?? 0) || (a.prizeMoney ?? 0);
                            const pb = (b.singlesPrizeMoney ?? 0) + (b.doublesPrizeMoney ?? 0) || (b.prizeMoney ?? 0);
                            return pb - pa;
                          })
                          .map((t: any) => {
                            const prize = (t.singlesPrizeMoney ?? 0) + (t.doublesPrizeMoney ?? 0) || (t.prizeMoney ?? 0);
                            return (
                              <View key={t.id} style={s.resultRow}>
                                <View style={{ flex: 1 }}>
                                  <Text style={s.resultCity}>{t.city ?? t.name}</Text>
                                  <Text style={s.resultDate}>{abbrevDate(t.startDate)} · {t.surface}</Text>
                                </View>
                                {prize > 0 && <Text style={s.resultPrize}>{fmtUSD(prize)}</Text>}
                              </View>
                            );
                          })}
                      </View>
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
              {timeline.map((t) => {
                const surf = SURFACES.find(sf => sf.key === t.surface);
                return (
                  <View key={t.id} style={s.miniCard}>
                    <View style={s.miniCardTop}>
                      <View style={[s.miniDot, { backgroundColor: surf?.color ?? '#6060A0' }]} />
                      <Text style={s.miniDate}>{abbrevDate(t.startDate)}</Text>
                    </View>
                    <Text style={s.miniCity} numberOfLines={1}>{t.name}</Text>
                    {t.roundReached ? (
                      <Text style={s.miniPrize}>{t.roundReached}{t.pointsEarned ? ` · ${t.pointsEarned}pts` : ''}</Text>
                    ) : t.prize > 0 ? (
                      <Text style={s.miniPrize}>{fmtUSD(t.prize)}</Text>
                    ) : null}
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

        {/* ── ATP MATCH HISTORY ── */}
        {atpProfile && atpMatchHistory.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>ATP RESULTS THIS YEAR</Text>
            <View style={s.card}>
              {atpMatchHistory.map((m: any, i: number) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: i < atpMatchHistory.length - 1 ? 1 : 0, borderBottomColor: '#2A2A4A' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#FAFAFA' }} numberOfLines={1}>{m.tournamentName}</Text>
                    <Text style={{ fontSize: 11, color: '#A0A0C8', marginTop: 2 }}>{m.date} · {m.surface}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#5B5BD6' }}>{m.roundReached}</Text>
                    {m.pointsEarned > 0 && <Text style={{ fontSize: 11, color: '#A0A0C8' }}>{m.pointsEarned} pts</Text>}
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

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

  condExpand: {
    backgroundColor: '#0F0F1A',
    borderRadius: 10,
    marginTop: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#2A2A4A',
    gap: 6,
  },
  condExpandTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#A0A0C8',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  surfaceRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  surfaceDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  surfaceLabel: { fontSize: 13, fontWeight: '600', color: '#FAFAFA', width: 44 },
  surfaceCount: { fontSize: 11, color: '#6060A0', marginRight: 10 },
  barTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#252540',
    borderRadius: 3,
    overflow: 'hidden',
    marginRight: 8,
  },
  barFill: { height: '100%', borderRadius: 3 },

  lockedText: { fontSize: 13, color: '#6060A0', textAlign: 'center', lineHeight: 22 },
  lockedSmall: { fontSize: 11, color: '#6060A0' },

  resultsPanel: {
    backgroundColor: '#0F0F1A',
    borderRadius: 8,
    marginTop: 4,
    marginBottom: 6,
    padding: 10,
    gap: 8,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E38',
  },
  resultCity: { fontSize: 13, fontWeight: '600', color: '#FAFAFA' },
  resultDate: { fontSize: 11, color: '#A0A0C8', marginTop: 1 },
  resultPrize: { fontSize: 12, fontWeight: '700', color: '#5B5BD6' },
  effValue: { fontSize: 13, fontWeight: '600', color: '#FAFAFA' },

  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A4A',
    gap: 8,
    flexWrap: 'wrap',
  },
  catName: { fontSize: 14, fontWeight: '700', color: '#FAFAFA', minWidth: 90, flexShrink: 0 },
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

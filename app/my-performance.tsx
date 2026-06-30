import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Modal,
  ActivityIndicator,
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

function inferTour(rawCat: string, name: string, pointsEarned?: number): 'ATP Tour' | 'ITF Tour' {
  const c = (rawCat + ' ' + name).toUpperCase();
  if (
    c.includes('CHALLENGER') ||
    c.includes('ATP 250') || c.includes('ATP 500') || c.includes('ATP 1000') ||
    /\bCH\s*\d{2,3}\b/.test(c) ||
    /\b(50|75|100|125)\b/.test(c)
  ) return 'ATP Tour';
  // Points heuristic: Challenger 50 SF = 80 pts; M25 max = 30 pts; M15 max = 18 pts
  if ((pointsEarned ?? 0) >= 40) return 'ATP Tour';
  return 'ITF Tour';
}

const ROUND_WINS: Record<string, number> = { W: 6, F: 5, SF: 4, QF: 3, R16: 2, R32: 1, R64: 0, R128: 0 };

function fmtUSD(amount: number) {
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function abbrevDate(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${d}`;
}

export default function MyPerformanceScreen() {
  const router = useRouter();
  const { data } = useAppQuery({});
  const tournaments = data?.tournaments ?? [];
  const expenses    = data?.expenses ?? [];

  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [matchModal, setMatchModal] = useState<{ type: 'wins' | 'losses' | 'all'; surface: string | null } | null>(null);
  const [detailMatch, setDetailMatch] = useState<any | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const currentYear = new Date().getFullYear();

  // ── ATP player profile — must come BEFORE any memos that use it ──────────────
  const [atpProfile, setAtpProfile] = useState<any>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { setIsLoadingProfile(false); return; }
      supabase.from('profiles').select('atp_player_name').eq('id', user.id).single()
        .then(({ data: prof }) => {
          if (!prof?.atp_player_name) { setIsLoadingProfile(false); return; }
          const nameParts = prof.atp_player_name.trim().split(/\s+/).slice(0, 2).join(' ');
          supabase.from('player_profiles').select('*')
            .ilike('player_name', `%${nameParts}%`)
            .order('last_updated', { ascending: false }).limit(1)
            .then(({ data }) => { 
              if (data?.[0]) setAtpProfile(data[0]); 
              setIsLoadingProfile(false);
            })
            .catch(() => setIsLoadingProfile(false));
        })
        .catch(() => setIsLoadingProfile(false));
    });
  }, []);

  const atpMatchHistory: any[] = useMemo(() =>
    (atpProfile?.match_history as any[] ?? [])
      .filter((m: any) => (m.date ?? '').startsWith(String(selectedYear)))
      .slice(0, 50)
  , [atpProfile, selectedYear]);

  // Expense efficiency by surface — kept for the expense section
  const expensesForTournament = (tId: string): number =>
    expenses.filter((e: any) => e.tournamentId === tId).reduce((s: number, e: any) => s + (e.amount ?? 0), 0);

  const surfaceExpenses = useMemo(() => {
    const map: Record<string, { total: number; count: number }> = { clay: { total: 0, count: 0 }, hard: { total: 0, count: 0 } };
    tournaments.forEach((t: any) => {
      if (!t.surface || t.isWithdrawn || !map[t.surface]) return;
      const cost = expensesForTournament(t.id);
      if (cost > 0) { map[t.surface].total += cost; map[t.surface].count += 1; }
    });
    return map;
  }, [tournaments, expenses]);

  const tournamentsWithExpenses = useMemo(() =>
    tournaments.filter((t: any) => !t.isWithdrawn && expensesForTournament(t.id) > 0).length
  , [tournaments, expenses]);

  // ATP-only buckets — scraper data is the single source of truth for played tournaments
  const tourBuckets = useMemo(() => {
    const map: Record<'ATP Tour' | 'ITF Tour', { count: number; tournaments: any[] }> = {
      'ATP Tour': { count: 0, tournaments: [] },
      'ITF Tour': { count: 0, tournaments: [] },
    };
    atpMatchHistory.forEach((m: any) => {
      const bucket = inferTour('', m.tournamentName ?? '', m.pointsEarned);
      map[bucket].count += 1;
      map[bucket].tournaments.push({ name: m.tournamentName, date: m.date, surface: m.surface, roundReached: m.roundReached, prize: 0, matches: m.matches ?? [] });
    });
    return map;
  }, [atpMatchHistory]);

  // Season timeline — ATP scraper only
  const timeline = useMemo(() =>
    [...atpMatchHistory]
      .sort((a: any, b: any) => (a.date ?? '').localeCompare(b.date ?? ''))
      .map((m: any) => ({
        id: `atp-${m.tournamentName}-${m.date}`,
        name: m.tournamentName ?? '',
        startDate: m.date ?? '',
        surface: m.surface,
        prize: 0,
        roundReached: m.roundReached as string | undefined,
        source: 'atp' as const,
      }))
  , [atpMatchHistory]);

  // Optimal suggestion (needs ≥ 3 tournaments with expenses)

  // Match detail modal data
  const matchModalEntries = useMemo(() => {
    if (!matchModal) return [];
    return atpMatchHistory
      .filter((m: any) => {
        if (matchModal.surface && m.surface !== matchModal.surface) return false;
        const rnd = (m.roundReached ?? '').toUpperCase().replace(' ', '');
        const wins = ROUND_WINS[rnd] ?? 0;
        if (matchModal.type === 'wins') return wins > 0;
        if (matchModal.type === 'losses') return rnd !== 'W';
        return true;

      })
      .sort((a: any, b: any) => (b.date ?? '').localeCompare(a.date ?? ''));
  }, [matchModal, atpMatchHistory]);

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
        {isLoadingProfile ? (
          <View style={{ flex: 1, paddingTop: 60, alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#5B5BD6" />
          </View>
        ) : (
          <>
            {/* Year toggle */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              {[currentYear - 1, currentYear].map(yr => (
                <TouchableOpacity
                  key={yr}
                  onPress={() => { setSelectedYear(yr); setExpandedCategory(null); }}
                  style={{ paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, backgroundColor: selectedYear === yr ? '#5B5BD6' : '#1A1A2E', borderWidth: 1, borderColor: selectedYear === yr ? '#5B5BD6' : '#2A2A4A' }}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 14, fontWeight: '700', color: selectedYear === yr ? '#FAFAFA' : '#6060A0' }}>{yr}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ATP RANKING */}
            {atpProfile && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>ATP RANKING</Text>
            <View style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#5B5BD6', alignItems: 'center', justifyContent: 'center' }}>
                <Text adjustsFontSizeToFit numberOfLines={1} style={{ fontSize: 22, fontWeight: '800', color: '#FAFAFA', paddingHorizontal: 4 }}>
                  #{atpProfile.current_ranking ?? '—'}
                </Text>
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
                  <TouchableOpacity style={{ flex: 1, alignItems: 'center' }} onPress={() => setMatchModal({ type: 'wins', surface: null })} activeOpacity={0.7}>
                    <Text style={{ fontSize: 28, fontWeight: '800', color: '#2D9E6B' }}>{totalW}</Text>
                    <Text style={{ fontSize: 11, color: '#A0A0C8', marginTop: 2 }}>Wins</Text>
                  </TouchableOpacity>
                  {pct !== null && (
                    <View style={{ alignItems: 'center', paddingHorizontal: 16 }}>
                      <Text style={{ fontSize: 22, fontWeight: '800', color: '#5B5BD6' }}>{pct}%</Text>
                      <Text style={{ fontSize: 11, color: '#A0A0C8', marginTop: 2 }}>Win rate</Text>
                    </View>
                  )}
                  <TouchableOpacity style={{ flex: 1, alignItems: 'center' }} onPress={() => setMatchModal({ type: 'losses', surface: null })} activeOpacity={0.7}>
                    <Text style={{ fontSize: 28, fontWeight: '800', color: '#E24B4A' }}>{totalL}</Text>
                    <Text style={{ fontSize: 11, color: '#A0A0C8', marginTop: 2 }}>Losses</Text>
                  </TouchableOpacity>
                </View>
                {/* Surface breakdown */}
                {surfaces.map(({ key, label, color }) => {
                  const s2 = wl[key];
                  if (!s2 || (s2.wins === 0 && s2.losses === 0)) return null;
                  const sp = s2.wins + s2.losses > 0 ? Math.round((s2.wins / (s2.wins + s2.losses)) * 100) : 0;
                  return (
                    <TouchableOpacity
                      key={key}
                      onPress={() => setMatchModal({ type: 'all', surface: key })}
                      activeOpacity={0.7}
                      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#2A2A4A' }}
                    >
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginRight: 8 }} />
                      <Text style={{ fontSize: 13, color: '#A0A0C8', width: 44 }}>{label}</Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: '#FAFAFA' }}>{s2.wins}W – {s2.losses}L</Text>
                      <View style={{ flex: 1 }} />
                      <Text style={{ fontSize: 12, color: '#5B5BD6', fontWeight: '600' }}>{sp}%</Text>
                    </TouchableOpacity>
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
        {atpMatchHistory.length >= 1 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>TOURNAMENTS BY CATEGORY</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {(['ATP Tour', 'ITF Tour'] as const).map(bucket => {
                const stats = tourBuckets[bucket];
                const isOpen = expandedCategory === bucket;
                return (
                  <View key={bucket} style={{ flex: 1 }}>
                    <TouchableOpacity
                      style={[s.card, { alignItems: 'center', paddingVertical: 16, borderColor: isOpen ? '#5B5BD6' : '#2A2A4A' }]}
                      onPress={() => setExpandedCategory(v => v === bucket ? null : bucket)}
                      activeOpacity={0.7}
                    >
                      <Text style={{ fontSize: 22, fontWeight: '800', color: '#5B5BD6' }}>{stats.count}</Text>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#FAFAFA', marginTop: 4 }}>{bucket}</Text>
                      <Text style={{ fontSize: 10, color: '#6060A0', marginTop: 2 }}>
                        {stats.count === 1 ? 'tournament' : 'tournaments'}
                      </Text>
                      <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={13} color="#6060A0" style={{ marginTop: 6 }} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
            {(['ATP Tour', 'ITF Tour'] as const).map(bucket => {
              if (expandedCategory !== bucket) return null;
              const stats = tourBuckets[bucket];
              return (
                <View key={bucket} style={[s.resultsPanel, { marginTop: 8 }]}>
                  {[...stats.tournaments]
                    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
                    .map((t: any, idx: number) => (
                      <TouchableOpacity key={idx} style={s.resultRow} onPress={() => setDetailMatch(t)} activeOpacity={0.7}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.resultCity}>{t.name}</Text>
                          <Text style={s.resultDate}>
                            {abbrevDate(t.date)} · {t.surface ?? '—'}
                            {t.roundReached ? ` · ${t.roundReached}` : ''}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={14} color="#6060A0" />
                      </TouchableOpacity>
                    ))}
                </View>
              );
            })}
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
                      <Text style={s.miniPrize}>{t.roundReached}</Text>
                    ) : t.prize > 0 ? (
                      <Text style={s.miniPrize}>{fmtUSD(t.prize)}</Text>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* OPTIMAL CALENDAR SUGGESTION — coming soon */}
        <View style={s.section}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Text style={s.sectionLabel}>OPTIMAL CALENDAR SUGGESTION</Text>
            <View style={{ backgroundColor: '#2A2A4A', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ fontSize: 9, fontWeight: '700', color: '#6060A0', letterSpacing: 0.5 }}>COMING SOON</Text>
            </View>
          </View>
          <View style={s.card}>
            <Text style={s.lockedText}>We're working on this. Once you have enough data, Tourly will suggest which tournaments give you the best return.</Text>
          </View>
        </View>

        {/* ── ATP MATCH HISTORY ── */}
        {atpProfile && atpMatchHistory.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>ATP RESULTS THIS YEAR</Text>
            <View style={s.card}>
              {atpMatchHistory.map((m: any, i: number) => (
                <TouchableOpacity key={i} onPress={() => setDetailMatch(m)} activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: i < atpMatchHistory.length - 1 ? 1 : 0, borderBottomColor: '#2A2A4A' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#FAFAFA' }} numberOfLines={1}>{m.tournamentName}</Text>
                    <Text style={{ fontSize: 11, color: '#A0A0C8', marginTop: 2 }}>{abbrevDate(m.date)} · {m.surface}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', marginLeft: 12 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#5B5BD6' }}>{m.roundReached}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color="#6060A0" style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* TOURNAMENT DETAIL MODAL */}
      <Modal visible={!!detailMatch} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={[s.modalTitle, { fontSize: 16 }]} numberOfLines={2}>
                {detailMatch?.tournamentName ?? detailMatch?.name ?? ''}
              </Text>
              <TouchableOpacity onPress={() => setDetailMatch(null)} style={s.modalClose} activeOpacity={0.7}>
                <Ionicons name="close" size={20} color="#FAFAFA" />
              </TouchableOpacity>
            </View>
            {/* Meta row */}
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              {(detailMatch?.date) && <Text style={{ fontSize: 12, color: '#A0A0C8' }}>{abbrevDate(detailMatch.date)}</Text>}
              {(detailMatch?.surface) && <Text style={{ fontSize: 12, color: '#A0A0C8', textTransform: 'capitalize' }}>{detailMatch.surface}</Text>}
              {(detailMatch?.roundReached) && (
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#5B5BD6' }}>{detailMatch.roundReached}</Text>
              )}
              {((detailMatch?.pointsEarned ?? 0) > 0) && (
                <Text style={{ fontSize: 12, color: '#A0A0C8' }}>{detailMatch.pointsEarned} pts</Text>
              )}
            </View>
            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {(detailMatch?.matches ?? []).length > 0 ? (
                (detailMatch.matches as any[]).map((mx: any, i: number, arr: any[]) => {
                  const isLast = i === arr.length - 1;
                  const isWin = detailMatch.roundReached === 'W' ? true : !isLast;
                  return (
                    <View key={i} style={[s.modalRow, { paddingVertical: 10 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: isWin ? 'rgba(45,158,107,0.18)' : 'rgba(226,75,74,0.18)', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: isWin ? '#2D9E6B' : '#E24B4A' }}>{isWin ? 'W' : 'L'}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#6060A0' }}>{mx.round}</Text>
                          <Text style={{ fontSize: 13, color: '#FAFAFA', marginTop: 1 }} numberOfLines={1}>{mx.opponent}</Text>
                        </View>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#FAFAFA' }}>{mx.score}</Text>
                      </View>
                    </View>
                  );
                })
              ) : (
                <Text style={{ color: '#6060A0', textAlign: 'center', padding: 24, fontSize: 13 }}>
                  No match details available yet.{'\n'}Re-run the scraper to fetch scores.
                </Text>
              )}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* MATCH DETAIL MODAL */}
      <Modal visible={!!matchModal} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>
                {matchModal?.surface ? surfaceLabel[matchModal.surface] + ' ' : ''}
                {matchModal?.type === 'wins' ? 'Wins' : matchModal?.type === 'losses' ? 'Losses' : 'Match Record'}
              </Text>
              <TouchableOpacity onPress={() => setMatchModal(null)} style={s.modalClose} activeOpacity={0.7}>
                <Ionicons name="close" size={20} color="#FAFAFA" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              {matchModalEntries.map((m: any, i: number) => {
                return (
                  <View key={i} style={s.modalRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.modalTournName} numberOfLines={1}>{m.tournamentName}</Text>
                        <Text style={s.modalTournDate}>{m.date} · {m.surface}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', marginLeft: 16 }}>
                        <Text style={s.modalRound}>{m.roundReached}</Text>
                      </View>
                    </View>
                    
                    {m.matches && m.matches.length > 0 && (
                      <View style={{ marginTop: 12, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: '#2A2A4A', gap: 6 }}>
                        {m.matches.map((match: any, j: number) => (
                          <View key={j} style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ fontSize: 11, fontWeight: '700', color: '#6060A0', width: 36 }}>{match.round}</Text>
                            <Text style={{ fontSize: 12, color: '#A0A0C8', flex: 1 }} numberOfLines={1}>{match.opponent}</Text>
                            <Text style={{ fontSize: 12, fontWeight: '600', color: '#FAFAFA', marginLeft: 8 }}>{match.score}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
              {matchModalEntries.length === 0 && (
                <Text style={{ color: '#A0A0C8', textAlign: 'center', padding: 20 }}>No matches found.</Text>
              )}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
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

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1A1A2E', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 16 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#FAFAFA' },
  modalClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#2A2A4A', alignItems: 'center', justifyContent: 'center' },
  modalRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#2A2A4A' },
  modalTournName: { fontSize: 14, fontWeight: '600', color: '#FAFAFA' },
  modalTournDate: { fontSize: 12, color: '#A0A0C8', marginTop: 2 },
  modalRound: { fontSize: 13, fontWeight: '700', color: '#5B5BD6' },
  modalWL: { fontSize: 12, color: '#A0A0C8', marginTop: 2 },
});

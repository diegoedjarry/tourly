import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Modal,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/text';
import { useAppQuery } from '@/hooks/useAppQuery';
import { useLanguage } from '@/hooks/useLanguage';
import { supabase } from '@/lib/supabase';
import { foldDiacritics, playerNameFilter } from '@/utils/text';
import { LoadingLogo } from '@/components/ui/LoadingLogo';
import { RankingChart } from '@/components/ui/RankingChart';
import { T } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

const SURFACES: { key: 'clay' | 'hard'; label: string; color: string }[] = [
  { key: 'clay', label: 'Clay', color: '#D4915A' },
  { key: 'hard', label: 'Hard', color: '#5A8CD4' },
];

function inferTour(rawCat: string, name: string, pointsEarned?: number): 'ATP Tour' | 'Challenger Tour' | 'ITF Tour' {
  const c = (rawCat + ' ' + name).toUpperCase();
  if (c.includes('ATP 250') || c.includes('ATP 500') || c.includes('ATP 1000')) return 'ATP Tour';
  if (
    c.includes('CHALLENGER') ||
    /\bCH\b/.test(c) ||
    /\b(50|75|100|125|175)\b/.test(c)
  ) return 'Challenger Tour';
  if ((pointsEarned ?? 0) > 30) return 'Challenger Tour';
  return 'ITF Tour';
}

const ROUND_WINS: Record<string, number> = { W: 6, F: 5, SF: 4, QF: 3, R16: 2, R32: 1, R64: 0, R128: 0 };

function cleanTournName(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\s*,?\s*ATP Ranking[:\s]*[\d\-–]+.*/i, '')
    .replace(/\s*,?\s*Prize Money.*/i, '')
    .trim();
}

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
  const { t } = useLanguage();
  const { refreshing, onRefresh } = usePullToRefresh();
  const { data } = useAppQuery({});
  const tournaments = data?.tournaments ?? [];
  const expenses    = data?.expenses ?? [];

  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [matchModal, setMatchModal] = useState<{ type: 'wins' | 'losses' | 'all'; surface: string | null } | null>(null);
  const [detailMatch, setDetailMatch] = useState<any | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [yearDropOpen, setYearDropOpen] = useState(false);

  const currentYear = new Date().getFullYear();

  // ── ATP player profile — must come BEFORE any memos that use it ──────────────
  const [atpProfile, setAtpProfile] = useState<any>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const [rankingEvolution, setRankingEvolution] = useState<any[]>([]);
  const [chartYear, setChartYear] = useState<number>(new Date().getFullYear());
  const [chartYearOpen, setChartYearOpen] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      setIsLoadingProfile(true);
      setProfileError(false);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data: prof } = await supabase
          .from('profiles').select('atp_player_name').eq('id', user.id).single();
        if (!prof?.atp_player_name || cancelled) return;
        const fullName = prof.atp_player_name.trim();
        const nameParts = fullName.split(/\s+/).slice(0, 2).join(' ');
        // Match both raw and accent-folded spellings (scraper may store "Milos" for "Miloš")
        const { data: rows, error } = await supabase.from('player_profiles').select('*')
          .or(playerNameFilter(nameParts))
          .order('last_updated', { ascending: false }).limit(5);
        if (error) throw error;
        if (cancelled) return;
        if (rows && rows.length > 0) {
          // Prefer an exact name match (diacritic-insensitive) over the fuzzy result
          const foldedFull = foldDiacritics(fullName).toLowerCase();
          const exact = rows.find((r: any) =>
            foldDiacritics((r.player_name ?? '').trim()).toLowerCase() === foldedFull);
          const row = exact ?? rows[0];
          setAtpProfile(row);
          setRankingEvolution(row.ranking_evolution ?? []);
        }
      } catch {
        if (!cancelled) setProfileError(true);
      } finally {
        if (!cancelled) setIsLoadingProfile(false);
      }
    }
    loadProfile();
    return () => { cancelled = true; };
  }, [loadAttempt]);

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
    const map: Record<'ATP Tour' | 'Challenger Tour' | 'ITF Tour', { count: number; tournaments: any[] }> = {
      'ATP Tour': { count: 0, tournaments: [] },
      'Challenger Tour': { count: 0, tournaments: [] },
      'ITF Tour': { count: 0, tournaments: [] },
    };
    atpMatchHistory.forEach((m: any) => {
      const bucket = inferTour('', m.tournamentName ?? '', m.pointsEarned);
      map[bucket].count += 1;
      map[bucket].tournaments.push({ name: m.tournamentName, date: m.date, surface: m.surface, roundReached: m.roundReached, prize: 0, matches: m.matches ?? [] });
    });
    return map;
  }, [atpMatchHistory]);

  // Win/loss counts computed from atpMatchHistory (year-filtered, actual match arrays)
  // Falls back to ROUND_WINS estimate when matches array is empty for a tournament.
  const computedWL = useMemo(() => {
    const result: Record<string, { wins: number; losses: number }> = {
      clay:  { wins: 0, losses: 0 },
      hard:  { wins: 0, losses: 0 },
      grass: { wins: 0, losses: 0 },
      total: { wins: 0, losses: 0 },
    };
    atpMatchHistory.forEach((m: any) => {
      const surf = (m.surface ?? 'hard') as string;
      const bucket = result[surf] ? surf : 'hard';
      const rawMatches: any[] = m.matches ?? [];
      const isTitle = (m.roundReached ?? '').toUpperCase() === 'W';

      if (rawMatches.length === 0) {
        // No match-level data — fall back to round-based estimate
        const rnd = (m.roundReached ?? '').toUpperCase().replace(' ', '');
        const w = ROUND_WINS[rnd] ?? 0;
        const l = rnd === 'W' ? 0 : 1;
        result[bucket].wins  += w; result.total.wins  += w;
        result[bucket].losses += l; result.total.losses += l;
      } else {
        // Count from actual match entries (reverse = chronological; last entry = loss)
        const matches = [...rawMatches].reverse();
        matches.forEach((mx: any, i: number) => {
          const isWin = isTitle ? true : i !== matches.length - 1;
          if (isWin) { result[bucket].wins++;  result.total.wins++;  }
          else       { result[bucket].losses++; result.total.losses++; }
        });
      }
    });
    return result;
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

  // Match detail modal data — flat individual match rows (not per-tournament)
  const matchModalEntries = useMemo(() => {
    if (!matchModal) return [];
    const entries: {
      tournamentName: string; date: string; surface: string;
      round: string; opponent: string; score: string; isWin: boolean;
    }[] = [];

    atpMatchHistory.forEach((m: any) => {
      if (matchModal.surface && m.surface !== matchModal.surface) return;
      const rawMatches: any[] = m.matches ?? [];
      if (rawMatches.length === 0) return;
      // Scraper stores reverse-chronological; reverse for chronological order
      const matches = [...rawMatches].reverse();
      const isTitle = (m.roundReached ?? '').toUpperCase() === 'W';

      matches.forEach((mx: any, i: number) => {
        const isLast = i === matches.length - 1;
        const isWin = isTitle ? true : !isLast;
        if (matchModal.type === 'wins' && !isWin) return;
        if (matchModal.type === 'losses' && isWin) return;
        entries.push({
          tournamentName: m.tournamentName ?? '',
          date: m.date ?? '',
          surface: m.surface ?? '',
          round: mx.round ?? '',
          opponent: mx.opponent ?? '',
          score: mx.score ?? '',
          isWin,
        });
      });
    });

    return entries.sort((a, b) => b.date.localeCompare(a.date));
  }, [matchModal, atpMatchHistory]);

  const surfaceLabel: Record<string, string> = { clay: 'Clay', hard: 'Hard', grass: 'Grass' };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0F0F1A" />

      {/* Header */}
      <View style={s.header}>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>{t('performance.title')}</Text>
        </View>
        <TouchableOpacity
          style={s.closeBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <Ionicons name="close" size={22} color="#FAFAFA" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.textSecondary} />}>
        {isLoadingProfile ? (
          <LoadingLogo />
        ) : profileError ? (
          /* NETWORK / AUTH ERROR — show retry instead of hanging or a blank screen */
          <View style={[s.section, { marginTop: 24 }]}>
            <View style={[s.card, { alignItems: 'center', paddingVertical: 32 }]}>
              <Text style={{ fontSize: 14, color: '#A0A0C8', textAlign: 'center', lineHeight: 22 }}>
                {t('performance.couldNotLoadData')}
              </Text>
              <Text style={{ fontSize: 12, color: '#6060A0', marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
                {t('performance.checkConnectionRetry')}
              </Text>
              <TouchableOpacity
                style={{ marginTop: 16, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, backgroundColor: '#5B5BD6' }}
                onPress={() => setLoadAttempt(a => a + 1)}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#FAFAFA' }}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            {/* Year toggle — single bubble, expands to options */}
            <View style={{ alignItems: 'center', marginTop: 16 }}>
              <TouchableOpacity
                onPress={() => setYearDropOpen(o => !o)}
                style={{ paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, backgroundColor: '#5B5BD6', borderWidth: 1, borderColor: '#5B5BD6', flexDirection: 'row', alignItems: 'center', gap: 4 }}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#FAFAFA' }}>{selectedYear}</Text>
                <Text style={{ fontSize: 10, color: '#FAFAFA' }}>{yearDropOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {yearDropOpen && (
                <TouchableOpacity
                  onPress={() => { setSelectedYear(selectedYear === currentYear ? currentYear - 1 : currentYear); setExpandedCategory(null); setYearDropOpen(false); }}
                  style={{ marginTop: 4, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1A1A2E', borderWidth: 1, borderColor: '#2A2A4A' }}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 14, fontWeight: '700', color: T.textMuted }}>{selectedYear === currentYear ? currentYear - 1 : currentYear}</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* NO PROFILE — empty state */}
            {!atpProfile && (
              <View style={[s.section, { marginTop: 24 }]}>
                <View style={[s.card, { alignItems: 'center', paddingVertical: 32 }]}>
                  <Text style={{ fontSize: 14, color: T.textSecondary, textAlign: 'center', lineHeight: 22 }}>
                    {t('performance.noDataYet')}
                  </Text>
                  <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
                    {t('performance.addAtpNameHint')}
                  </Text>
                </View>
              </View>
            )}

            {/* ATP RANKING */}
            {atpProfile && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>{t('performance.atpRanking')}</Text>
            <View style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: T.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Text adjustsFontSizeToFit numberOfLines={1} style={{ fontSize: 22, fontWeight: '800', color: T.textPrimary, paddingHorizontal: 4 }}>
                  #{atpProfile.current_ranking ?? '—'}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: T.textPrimary }}>{atpProfile.player_name}</Text>
                <Text style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>ATP Singles Ranking</Text>
                {atpProfile.last_updated && (
                  <Text style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
                    Updated {abbrevDate(atpProfile.last_updated.slice(0, 10))}
                  </Text>
                )}
              </View>
            </View>
          </View>
        )}

        {/* NO MATCH HISTORY — syncing notice */}
        {atpProfile && atpMatchHistory.length === 0 && (
          <View style={s.section}>
            <View style={[s.card, { alignItems: 'center', paddingVertical: 20 }]}>
              <Text style={{ fontSize: 14, color: T.textSecondary, textAlign: 'center', lineHeight: 22 }}>
                {t('performance.matchHistorySyncing')}
              </Text>
              <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 6, textAlign: 'center' }}>
                {t('performance.goToSettingsSync')}
              </Text>
            </View>
          </View>
        )}

        {/* MATCH RECORD */}
        {atpMatchHistory.length > 0 && (() => {
          const wl = computedWL;
          const total = wl.total;
          const totalW = total.wins;
          const totalL = total.losses;
          const pct = totalW + totalL > 0 ? Math.round((totalW / (totalW + totalL)) * 100) : null;
          const surfaces: { key: string; label: string; color: string }[] = [
            { key: 'clay', label: 'Clay', color: '#D4915A' },
            { key: 'hard', label: 'Hard', color: '#5A8CD4' },
            { key: 'grass', label: 'Grass', color: '#5A9E5A' },
          ];
          return (
            <View style={s.section}>
              <Text style={s.sectionLabel}>{t('performance.matchRecord')}</Text>
              <View style={s.card}>
                {/* Overall row */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                  <TouchableOpacity style={{ flex: 1, alignItems: 'center' }} onPress={() => setMatchModal({ type: 'wins', surface: null })} activeOpacity={0.7}>
                    <Text style={{ fontSize: 28, fontWeight: '800', color: T.green }}>{totalW}</Text>
                    <Text style={{ fontSize: 11, color: T.textSecondary, marginTop: 2 }}>{t('performance.wins')}</Text>
                  </TouchableOpacity>
                  {pct !== null && (
                    <View style={{ alignItems: 'center', paddingHorizontal: 16 }}>
                      <Text style={{ fontSize: 22, fontWeight: '800', color: T.accent }}>{pct}%</Text>
                      <Text style={{ fontSize: 11, color: T.textSecondary, marginTop: 2 }}>{t('performance.winRate')}</Text>
                    </View>
                  )}
                  <TouchableOpacity style={{ flex: 1, alignItems: 'center' }} onPress={() => setMatchModal({ type: 'losses', surface: null })} activeOpacity={0.7}>
                    <Text style={{ fontSize: 28, fontWeight: '800', color: T.red }}>{totalL}</Text>
                    <Text style={{ fontSize: 11, color: T.textSecondary, marginTop: 2 }}>{t('performance.losses')}</Text>
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
                      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: T.cardBorder }}
                    >
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginRight: 8 }} />
                      <Text style={{ fontSize: 13, color: T.textSecondary, width: 44 }}>{label}</Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: T.textPrimary }}>{s2.wins}W – {s2.losses}L</Text>
                      <View style={{ flex: 1 }} />
                      <Text style={{ fontSize: 12, color: T.accent, fontWeight: '600' }}>{sp}%</Text>
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
            <Text style={s.sectionLabel}>{t('performance.expenseEfficiencyBySurface')}</Text>
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
              {(['ITF Tour', 'Challenger Tour', 'ATP Tour'] as const).filter(b => tourBuckets[b].count > 0).map(bucket => {
                const stats = tourBuckets[bucket];
                const isOpen = expandedCategory === bucket;
                return (
                  <View key={bucket} style={{ flex: 1 }}>
                    <TouchableOpacity
                      style={[s.card, { alignItems: 'center', paddingVertical: 16, borderColor: isOpen ? T.accent : T.cardBorder }]}
                      onPress={() => setExpandedCategory(v => v === bucket ? null : bucket)}
                      activeOpacity={0.7}
                    >
                      <Text style={{ fontSize: 22, fontWeight: '800', color: T.accent }}>{stats.count}</Text>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: T.textPrimary, marginTop: 4 }}>{bucket}</Text>
                      <Text style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>
                        {stats.count === 1 ? 'tournament' : 'tournaments'}
                      </Text>
                      <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={13} color={T.textMuted} style={{ marginTop: 6 }} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
            {(['ITF Tour', 'Challenger Tour', 'ATP Tour'] as const).map(bucket => {
              if (expandedCategory !== bucket) return null;
              const stats = tourBuckets[bucket];
              return (
                <View key={bucket} style={[s.resultsPanel, { marginTop: 8 }]}>
                  {[...stats.tournaments]
                    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
                    .map((t: any, idx: number) => (
                      <TouchableOpacity key={idx} style={s.resultRow} onPress={() => setDetailMatch(t)} activeOpacity={0.7}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.resultCity}>{cleanTournName(t.name)}</Text>
                          <Text style={s.resultDate}>
                            {abbrevDate(t.date)} · {t.surface ?? '—'}
                            {t.roundReached ? ` · ${t.roundReached}` : ''}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={14} color={T.textMuted} />
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
                      <View style={[s.miniDot, { backgroundColor: surf?.color ?? T.textMuted }]} />
                      <Text style={s.miniDate}>{abbrevDate(t.startDate)}</Text>
                    </View>
                    <Text style={s.miniCity} numberOfLines={1}>{cleanTournName(t.name)}</Text>
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

        {/* ── ATP MATCH HISTORY ── */}
        {atpProfile && atpMatchHistory.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>{t('performance.atpResultsThisYear')}</Text>
            <View style={s.card}>
              {atpMatchHistory.map((m: any, i: number) => (
                <TouchableOpacity key={i} onPress={() => setDetailMatch(m)} activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: i < atpMatchHistory.length - 1 ? 1 : 0, borderBottomColor: T.cardBorder }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: T.textPrimary }} numberOfLines={1}>{cleanTournName(m.tournamentName)}</Text>
                    <Text style={{ fontSize: 11, color: T.textSecondary, marginTop: 2 }}>{abbrevDate(m.date)} · {m.surface}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', marginLeft: 12 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: T.accent }}>{m.roundReached}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={T.textMuted} style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

          </>
        )}

        {/* ── Points to Defend ── */}
        {atpProfile && (() => {
          const defending: any[] = atpProfile.points_defending ?? [];
          if (defending.length === 0) return null;

          const fullMH: any[] = atpProfile.match_history ?? [];
          const prevYear = new Date().getFullYear() - 1;

          const enriched = defending.map((p: any) => {
            const mhEntry = fullMH.find((m: any) =>
              m.tournamentName === p.tournamentName &&
              typeof m.date === 'string' &&
              parseInt(m.date.slice(0, 4)) === prevYear
            );
            const n = (p.tournamentName ?? '').toUpperCase();
            const cat = (n.includes('M15') || n.includes('M25')) ? 'ITF Futures' : 'Challenger';
            return {
              ...p,
              roundReached: mhEntry?.roundReached ?? '—',
              playedDate: mhEntry?.date ?? null,
              category: cat,
            };
          });

          const groups: { label: string; entries: any[] }[] = [
            {
              label: 'Challenger',
              entries: enriched.filter((e: any) => e.category === 'Challenger')
                .sort((a: any, b: any) => (a.weekOf ?? '').localeCompare(b.weekOf ?? '')),
            },
            {
              label: 'ITF Futures',
              entries: enriched.filter((e: any) => e.category === 'ITF Futures')
                .sort((a: any, b: any) => (a.weekOf ?? '').localeCompare(b.weekOf ?? '')),
            },
          ].filter(g => g.entries.length > 0);

          return (
            <View style={s.section}>
              <Text style={s.sectionLabel}>{t('performance.pointsToDefend')}</Text>
              {groups.map(({ label, entries }) => (
                <View key={label} style={{ marginBottom: 12 }}>
                  <Text style={pt.groupLabel}>{label}</Text>
                  <View style={s.card}>
                    <View style={pt.headerRow}>
                      <Text style={[pt.hCell, { flex: 1.6 }]}>Tournament</Text>
                      <Text style={[pt.hCell, { width: 36, textAlign: 'center' }]}>Rd</Text>
                      <Text style={[pt.hCell, { width: 36, textAlign: 'right' }]}>Pts</Text>
                      <Text style={[pt.hCell, { width: 56, textAlign: 'right' }]}>Drop</Text>
                    </View>
                    {entries.map((e: any, i: number) => (
                      <View key={i} style={[pt.row, i < entries.length - 1 && pt.rowBorder]}>
                        <View style={{ flex: 1.6 }}>
                          <Text style={pt.tournName} numberOfLines={1}>{cleanTournName(e.tournamentName)}</Text>
                          {e.playedDate && <Text style={pt.playedDate}>{abbrevDate(e.playedDate)}</Text>}
                        </View>
                        <Text style={[pt.cell, { width: 36, textAlign: 'center' }]}>{e.roundReached}</Text>
                        <Text style={[pt.pts, { width: 36, textAlign: 'right' }]}>{e.points}</Text>
                        <Text style={[pt.cell, { width: 56, textAlign: 'right' }]}>{abbrevDate(e.weekOf)}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          );
        })()}

        {/* ── Ranking Evolution Chart ── */}
        {(() => {
          const allChartYears = [...new Set([
            ...atpMatchHistory.filter((m: any) => m.rankingThatWeek > 0).map((m: any) => parseInt((m.date ?? '').slice(0, 4))),
            ...rankingEvolution.map((r: any) => parseInt((r.date ?? '').slice(0, 4))),
          ].filter(y => y > 2000))].sort((a, b) => b - a);

          const chartPoints = (() => {
            const evoFiltered = rankingEvolution
              .filter((r: any) => (r.date ?? '').startsWith(String(chartYear)) && r.ranking > 0)
              .map((r: any) => ({ date: r.date, ranking: r.ranking }));
            if (evoFiltered.length >= 2) return evoFiltered;
            return atpMatchHistory
              .filter((m: any) => (m.date ?? '').startsWith(String(chartYear)) && m.rankingThatWeek > 0)
              .map((m: any) => ({ date: m.date, ranking: m.rankingThatWeek, label: m.tournamentName }));
          })();

          if (allChartYears.length === 0 && chartPoints.length === 0) return null;

          return (
            <View style={[s.section, { marginTop: 8 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={s.sectionLabel}>{t('performance.rankingEvolution')}</Text>
                {allChartYears.length > 1 && (
                  <View style={{ alignItems: 'flex-end' }}>
                    <TouchableOpacity
                      style={{ paddingHorizontal: 14, paddingVertical: 5, borderRadius: 16, backgroundColor: T.accent,
                        flexDirection: 'row', alignItems: 'center', gap: 4 }}
                      onPress={() => setChartYearOpen(o => !o)} activeOpacity={0.7}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: T.textPrimary }}>{chartYear}</Text>
                      <Text style={{ fontSize: 9, color: T.textPrimary }}>{chartYearOpen ? '▲' : '▼'}</Text>
                    </TouchableOpacity>
                    {chartYearOpen && (
                      <View style={{ marginTop: 4, gap: 3 }}>
                        {allChartYears.filter(y => y !== chartYear).map(y => (
                          <TouchableOpacity key={y}
                            style={{ paddingHorizontal: 14, paddingVertical: 5, borderRadius: 16,
                              backgroundColor: '#1A1A3A', borderWidth: 1, borderColor: T.accentMuted }}
                            onPress={() => { setChartYear(y); setChartYearOpen(false); }} activeOpacity={0.7}>
                            <Text style={{ fontSize: 12, fontWeight: '600', color: T.textSecondary, textAlign: 'center' }}>{y}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                )}
              </View>
              <View style={s.card}>
                {chartPoints.length >= 2 ? (
                  <>
                    <Text style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>
                      {rankingEvolution.filter((r: any) => (r.date ?? '').startsWith(String(chartYear))).length >= 2
                        ? t('performance.weeklyRankingData') : t('performance.basedOnTournamentRanking')}
                    </Text>
                    <RankingChart points={chartPoints} />
                  </>
                ) : chartPoints.length === 1 ? (
                  <Text style={{ fontSize: 12, color: T.textSecondary, padding: 8 }}>
                    {t('performance.rankingAtLastTournament').replace('{ranking}', String(chartPoints[0].ranking))}
                  </Text>
                ) : (
                  <Text style={{ fontSize: 12, color: T.textSecondary, padding: 8 }}>
                    {t('performance.noRankingDataForYear').replace('{year}', String(chartYear))}
                  </Text>
                )}
              </View>
            </View>
          );
        })()}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* TOURNAMENT DETAIL MODAL */}
      <Modal visible={!!detailMatch} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={[s.modalTitle, { fontSize: 16 }]} numberOfLines={2}>
                {cleanTournName(detailMatch?.tournamentName ?? detailMatch?.name ?? '')}
              </Text>
              <TouchableOpacity onPress={() => setDetailMatch(null)} style={s.modalClose} activeOpacity={0.7}>
                <Ionicons name="close" size={20} color={T.textPrimary} />
              </TouchableOpacity>
            </View>
            {/* Meta row */}
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              {(detailMatch?.date) && <Text style={{ fontSize: 12, color: T.textSecondary }}>{abbrevDate(detailMatch.date)}</Text>}
              {(detailMatch?.surface) && <Text style={{ fontSize: 12, color: T.textSecondary, textTransform: 'capitalize' }}>{detailMatch.surface}</Text>}
              {(detailMatch?.roundReached) && (
                <Text style={{ fontSize: 12, fontWeight: '700', color: T.accent }}>{detailMatch.roundReached}</Text>
              )}
              {((detailMatch?.pointsEarned ?? 0) > 0) && (
                <Text style={{ fontSize: 12, color: T.textSecondary }}>{detailMatch.pointsEarned} pts</Text>
              )}
              {detailMatch?.rankingThatWeek && (
                <Text style={{ fontSize: 12, color: T.accent, fontWeight: '700' }}>Rank #{detailMatch.rankingThatWeek}</Text>
              )}
            </View>
            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {(detailMatch?.matches ?? []).length > 0 ? (
                // Scraper stores reverse-chronological; reverse for display (R32 → R16 → QF)
                ([...(detailMatch.matches as any[])].reverse()).map((mx: any, i: number, arr: any[]) => {
                  const isLast = i === arr.length - 1;
                  const isWin = detailMatch.roundReached === 'W' ? true : !isLast;
                  return (
                    <View key={i} style={[s.modalRow, { paddingVertical: 10 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: isWin ? 'rgba(45,158,107,0.18)' : 'rgba(226,75,74,0.18)', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: isWin ? T.green : T.red }}>{isWin ? 'W' : 'L'}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 12, fontWeight: '700', color: T.textMuted }}>{mx.round}</Text>
                          <Text style={{ fontSize: 13, color: T.textPrimary, marginTop: 1 }} numberOfLines={1}>{mx.opponent}</Text>
                        </View>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: T.textPrimary }}>{mx.score}</Text>
                      </View>
                    </View>
                  );
                })
              ) : (
                <Text style={{ color: T.textMuted, textAlign: 'center', padding: 24, fontSize: 13 }}>
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
                {matchModal?.type === 'wins' ? t('performance.wins') : matchModal?.type === 'losses' ? t('performance.losses') : 'Match Record'}
              </Text>
              <TouchableOpacity onPress={() => setMatchModal(null)} style={s.modalClose} activeOpacity={0.7}>
                <Ionicons name="close" size={20} color={T.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              {matchModalEntries.map((m, i: number) => (
                <View key={i} style={[s.modalRow, { paddingVertical: 10 }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: m.isWin ? 'rgba(45,158,107,0.18)' : 'rgba(226,75,74,0.18)', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 11, fontWeight: '800', color: m.isWin ? T.green : T.red }}>{m.isWin ? 'W' : 'L'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: T.textMuted, minWidth: 32 }}>{m.round}</Text>
                        <Text style={{ fontSize: 13, color: T.textPrimary, flex: 1 }} numberOfLines={1}>{m.opponent}</Text>
                      </View>
                      <Text style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }} numberOfLines={1}>{cleanTournName(m.tournamentName)} · {abbrevDate(m.date)}</Text>
                    </View>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: T.textSecondary, marginLeft: 4 }}>{m.score}</Text>
                  </View>
                </View>
              ))}
              {matchModalEntries.length === 0 && (
                <Text style={{ color: T.textSecondary, textAlign: 'center', padding: 20 }}>No matches found.</Text>
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
  safe: { flex: 1, backgroundColor: T.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },

  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '700', color: T.textPrimary },
  closeBtn: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: T.card,
    alignItems: 'center',
    justifyContent: 'center',
  },

  section: { marginHorizontal: 16, marginTop: 20 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: T.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },

  card: {
    backgroundColor: T.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: T.cardBorder,
  },

  rowCards: { flexDirection: 'row', gap: 10 },
  condCard: {
    backgroundColor: T.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: T.cardBorder,
    alignItems: 'center',
  },
  condCardLabel: { fontSize: 10, fontWeight: '600', color: T.textSecondary, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 },
  condCardValue: { fontSize: 16, fontWeight: '700', color: T.textPrimary, marginBottom: 2 },
  condCardCount: { fontSize: 11, color: T.textMuted },

  condExpand: {
    backgroundColor: T.bg,
    borderRadius: 10,
    marginTop: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: T.cardBorder,
    gap: 6,
  },
  condExpandTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: T.textSecondary,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  surfaceRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  surfaceDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  surfaceLabel: { fontSize: 13, fontWeight: '600', color: T.textPrimary, width: 44 },
  surfaceCount: { fontSize: 11, color: T.textMuted, marginRight: 10 },
  barTrack: {
    flex: 1,
    height: 6,
    backgroundColor: T.cardElevated,
    borderRadius: 3,
    overflow: 'hidden',
    marginRight: 8,
  },
  barFill: { height: '100%', borderRadius: 3 },

  lockedText: { fontSize: 13, color: T.textMuted, textAlign: 'center', lineHeight: 22 },
  lockedSmall: { fontSize: 11, color: T.textMuted },

  resultsPanel: {
    backgroundColor: T.bg,
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
  resultCity: { fontSize: 13, fontWeight: '600', color: T.textPrimary },
  resultDate: { fontSize: 11, color: T.textSecondary, marginTop: 1 },
  resultPrize: { fontSize: 12, fontWeight: '700', color: T.accent },
  effValue: { fontSize: 13, fontWeight: '600', color: T.textPrimary },

  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
    gap: 8,
    flexWrap: 'wrap',
  },
  catName: { fontSize: 14, fontWeight: '700', color: T.textPrimary, minWidth: 90, flexShrink: 0 },
  catCount: { fontSize: 12, color: T.textSecondary, flex: 1 },
  catPrize: { fontSize: 12, fontWeight: '600', color: T.accent },

  timelineScroll: { paddingRight: 8, gap: 10 },
  miniCard: {
    backgroundColor: T.card,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: T.cardBorder,
    width: 110,
  },
  miniCardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 5 },
  miniDot: { width: 7, height: 7, borderRadius: 4 },
  miniDate: { fontSize: 10, color: T.textSecondary, fontWeight: '600' },
  miniCity: { fontSize: 12, fontWeight: '700', color: T.textPrimary, marginBottom: 4 },
  miniPrize: { fontSize: 11, color: T.accent, fontWeight: '600' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: T.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 16 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: T.textPrimary },
  modalClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: T.cardBorder, alignItems: 'center', justifyContent: 'center' },
  modalRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.cardBorder },
  modalTournName: { fontSize: 14, fontWeight: '600', color: T.textPrimary },
  modalTournDate: { fontSize: 12, color: T.textSecondary, marginTop: 2 },
  modalRound: { fontSize: 13, fontWeight: '700', color: T.accent },
  modalWL: { fontSize: 12, color: T.textSecondary, marginTop: 2 },
});

const pt = StyleSheet.create({
  groupLabel: { fontSize: 10, fontWeight: '700', color: T.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: T.cardBorder, marginBottom: 2 },
  hCell: { fontSize: 10, fontWeight: '600', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: T.cardBorder },
  tournName: { fontSize: 13, fontWeight: '600', color: T.textPrimary },
  playedDate: { fontSize: 10, color: T.textMuted, marginTop: 1 },
  cell: { fontSize: 12, color: T.textSecondary },
  pts: { fontSize: 14, fontWeight: '700', color: T.amber },
});

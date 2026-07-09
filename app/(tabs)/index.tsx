import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ScrollView,
  View,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAppQuery } from '@/hooks/useAppQuery';
import { CourtIcon } from '@/components/ui/court-icon';
import { TournamentDetail } from '@/app/(tabs)/tournaments';
import { fmtDateRange } from '@/utils/deadlines';
import { countryFlag } from '@/utils/countryFlag';
import { useInsights, useGenerateInsight } from '@/hooks/useInsights';
import { DEMO_MODE } from '@/config/demo';
import { useFirstVisit } from '@/hooks/useFirstVisit';
import { useTabSwipe } from '@/hooks/useTabSwipe';
import { ScreenWalkthrough } from '@/components/ui/screen-walkthrough';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { supabase } from '@/lib/supabase';

import { FloatingInsight } from '@/components/ui/floating-insight';
import { useProfile } from '@/hooks/useProfile';
import { T, SURFACE_STRIPE } from '@/constants/theme';
import { TourlyLogo } from '@/components/ui/tourly-logo';
import { LoadingLogo } from '@/components/ui/LoadingLogo';
import { useLanguage } from '@/hooks/useLanguage';
import { getInitials } from '@/utils/name';


function daysUntil(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = parseLocalDate(dateStr);
  if (!target) return null;
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function getUpcomingDeadlines(tournaments: any[]) {
  const items: Array<{ t: any; type: string; date: string; days: number | null; isToday: boolean }> = [];
  for (const t of tournaments) {
    if (t.isWithdrawn || t.isInMyList === false) continue;
    // Withdrawal only applies once registered
    if (t.isRegistered && t.withdrawalDeadline) {
      const d = daysUntil(t.withdrawalDeadline);
      if (d !== null && d >= 0 && d <= 7) {
        items.push({ t, type: 'Withdrawal', date: t.withdrawalDeadline, days: d, isToday: d === 0 });
      }
    }
    if (!t.isRegistered && t.signUpDeadline) {
      const d = daysUntil(t.signUpDeadline);
      if (d !== null && d >= 0 && d <= 7) {
        items.push({ t, type: 'Sign up', date: t.signUpDeadline, days: d, isToday: d === 0 });
      }
    }
    if (t.freezeDeadline) {
      const d = daysUntil(t.freezeDeadline);
      if (d !== null && d >= 0 && d <= 7) {
        items.push({ t, type: 'Doubles entry', date: t.freezeDeadline, days: d, isToday: d === 0 });
      }
    }
  }
  return items.sort((a, b) => (a.days ?? 99) - (b.days ?? 99)).slice(0, 5);
}

function parseLocalDate(val: any): Date | null {
  if (!val) return null;
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(typeof val === 'number' ? val : String(val));
  return isNaN(d.getTime()) ? null : d;
}

function deadlineUrgencyColor(days: number | null): string {
  if (days === null) return T.textTertiary;
  if (days <= 3) return T.red;
  if (days <= 7) return T.amber;
  return T.textTertiary;
}

function getActiveTournament(tournaments: any[]): any | null {
  const now = new Date();
  for (const t of tournaments) {
    if (t.isWithdrawn || !t.startDate || !t.endDate) continue;
    const start = parseLocalDate(t.startDate);
    const end   = parseLocalDate(t.endDate);
    if (!start || !end) continue;
    end.setHours(23, 59, 59, 999);
    if (now >= start && now <= end) return t;
  }
  return null;
}

export default function HomeScreen() {
  const { data, isLoading, error } = useAppQuery({ tournaments: {}, expenses: {} });
  const [detailId, setDetailId] = useState<string | null>(null);
  const router = useRouter();

  const { data: insights, isLoading: insightsLoading } = useInsights();
  const generateInsight = useGenerateInsight();
  const { isFirstVisit, markVisited } = useFirstVisit('home');
  const swipeHandlers = useTabSwipe();
  const { isOnline, pendingCount } = useOfflineSync();
  const { t, lang } = useLanguage();
  const { data: profileData } = useProfile();
  const profileInitials = getInitials(profileData?.full_name);
  const hasGeneratedRef = useRef(false);

  const [scrapedMatchHistory, setScrapedMatchHistory] = useState<any[]>([]);

  useEffect(() => {
    if (DEMO_MODE) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('profiles').select('atp_player_name').eq('id', user.id).single()
        .then(({ data: prof }) => {
          if (!prof?.atp_player_name) return;
          const nameParts = prof.atp_player_name.trim().split(/\s+/).slice(0, 2).join(' ');
          supabase.from('player_profiles')
            .select('match_history')
            .ilike('player_name', `%${nameParts}%`)
            .order('last_updated', { ascending: false })
            .limit(1)
            .then(({ data }) => {
              setScrapedMatchHistory(data?.[0]?.match_history ?? []);
            });
        });
    }).catch((err) => {
      // A failure here must be visible during debugging — silently leaving
      // scrapedMatchHistory at [] reads identically to "no match history yet".
      console.warn('[home] scraped match history fetch failed', err);
    });
  }, []);

  const tournaments = data?.tournaments ?? [];
  const expenses = data?.expenses ?? [];
  // A failed fetch with nothing to show must not silently render as the
  // "no tournaments yet" empty state or $0 season stats — that reads as
  // "you have no data" instead of "we couldn't load your data".
  const hasLoadError = !!error && !isLoading && tournaments.length === 0 && expenses.length === 0;

  const deadlines = useMemo(() => getUpcomingDeadlines(tournaments), [tournaments]);
  const activeTournament = useMemo(() => getActiveTournament(tournaments), [tournaments]);

  const upcomingTournaments = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return tournaments
      .filter((t: any) => {
        if (t.isWithdrawn) return false;
        const start = parseLocalDate(t.startDate);
        return start && start > today;
      })
      .sort((a: any, b: any) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))
      .slice(0, 4);
  }, [tournaments]);

  const seasonStats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();
    // Prefer scraped match history count for accuracy; fall back to local tournament count
    const scrapedPlayed = scrapedMatchHistory.filter((m: any) =>
      (m.date ?? '').startsWith(String(currentYear))
    ).length;
    const localPlayed = tournaments.filter((t: any) => {
      const d = parseLocalDate(t.startDate);
      return d && d <= today && !t.isWithdrawn;
    }).length;
    const played = scrapedPlayed > 0 ? scrapedPlayed : localPlayed;
    const totalSpent = expenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
    // Only count prize money for tournaments actually played: registered,
    // started, not withdrawn. Previously this summed EVERY tournament in the
    // list — including ones merely added to consider and never entered —
    // so an unregistered upcoming tournament's prize field inflated the total.
    const totalPrize = tournaments.reduce((s: number, t: any) => {
      const d = parseLocalDate(t.startDate);
      const wasPlayed = t.isRegistered && d && d <= today && !t.isWithdrawn;
      if (!wasPlayed) return s;
      const split = (t.singlesPrizeMoney ?? 0) + (t.doublesPrizeMoney ?? 0);
      // Fall back to legacy prizeMoney for records created before the singles/doubles split
      return s + (split > 0 ? split : (t.prizeMoney ?? 0));
    }, 0);
    return { played, totalSpent, totalPrize, net: totalPrize - totalSpent };
  }, [tournaments, expenses, scrapedMatchHistory]);

  const { activeTournamentSpent, recentExpenses, activePrizeMoney, activeNet } = useMemo(() => {
    const atExpenses = activeTournament
      ? expenses.filter((e: any) => e.tournamentId === activeTournament.id)
      : [];
    const spent = atExpenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
    const recent = [...atExpenses]
      .sort((a: any, b: any) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, 3);
    const split = (activeTournament?.singlesPrizeMoney ?? 0) + (activeTournament?.doublesPrizeMoney ?? 0);
    const prize = split > 0 ? split : (activeTournament?.prizeMoney ?? 0);
    return { activeTournamentSpent: spent, recentExpenses: recent, activePrizeMoney: prize, activeNet: prize - spent };
  }, [activeTournament, expenses]);

  useEffect(() => {
    if (DEMO_MODE || insightsLoading || generateInsight.isPending) return;
    if (hasGeneratedRef.current) return;
    if (!tournaments.length && !expenses.length) return;
    const now = new Date();
    const isMonday = now.getDay() === 1;
    const insightsList = insights ?? [];
    const latest = insightsList[0];
    const hoursSince = latest
      ? (now.getTime() - new Date(latest.generated_at).getTime()) / 3600000
      : Infinity;
    if (hoursSince < 20) return;
    const trigger = isMonday ? 'monday' : 'daily';
    hasGeneratedRef.current = true;
    generateInsight.mutate(
      { tournaments, expenses, trigger },
      { onError: () => { hasGeneratedRef.current = false; } },
    );
  }, [insights, insightsLoading, tournaments, expenses]);

  return (
    <SafeAreaView style={st.safe}>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      <View style={{ flex: 1 }}>
        <ScrollView style={st.scroll} contentContainerStyle={st.scrollContent} showsVerticalScrollIndicator={false} {...swipeHandlers}>

          {/* Top bar */}
          <View style={st.topBar}>
            <TouchableOpacity onPress={() => router.push('/settings' as any)} activeOpacity={0.75}>
              <TourlyLogo width={220} height={58} />
            </TouchableOpacity>
          </View>

          {!isOnline && (
            <View style={st.offlineBanner}>
              <Text style={st.offlineText}>
                {t('home.offline')}{pendingCount > 0 ? ` — ${pendingCount} ${pendingCount > 1 ? t('home.changesQueuedPlural') : t('home.changesQueued')}` : ''}
              </Text>
            </View>
          )}

          {isLoading ? (
            <LoadingLogo style={{ minHeight: 200 }} />
          ) : hasLoadError ? (
            <View style={st.errorBanner}>
              <Text style={st.errorBannerText}>
                {lang === 'es'
                  ? 'No se pudieron cargar tus datos. Desliza hacia abajo o vuelve a intentarlo más tarde.'
                  : "Couldn't load your data. Pull to refresh or try again later."}
              </Text>
            </View>
          ) : (
            <>
              {/* Upcoming Deadlines — shown only when tournaments exist */}
              {tournaments.length > 0 && (
                <View style={st.section}>
                  <Text style={st.sectionLabel}>{t('home.upcomingDeadlines')}</Text>
                  {deadlines.length === 0 ? (
                    <Text style={st.emptyNote}>{t('home.noUrgentDeadlines')}</Text>
                  ) : (
                    deadlines.map((item, idx) => {
                      const stripe = SURFACE_STRIPE[item.t.surface] ?? T.cardBorder;
                      return (
                        <TouchableOpacity
                          key={idx}
                          style={[st.deadlineCard, { borderLeftColor: stripe }]}
                          onPress={() => setDetailId(item.t.id)}
                          activeOpacity={0.8}
                        >
                          <View style={st.cardLeft}>
                            <Text style={st.cardTitle}>
                              {item.t.country ? countryFlag(item.t.country) + ' ' : ''}{item.t.name}
                            </Text>
                            <View style={st.cardSubRow}>
                              <Text style={st.cardSub}>{item.type}</Text>
                              {item.t.surface ? <CourtIcon surface={item.t.surface} /> : null}
                            </View>
                          </View>
                          {item.isToday ? (
                            <View style={st.todayPill}><Text style={st.todayPillText}>{t('home.today')}</Text></View>
                          ) : (
                            <Text style={[st.daysText, { color: deadlineUrgencyColor(item.days) }]}>{item.days}d</Text>
                          )}
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
              )}

              {/* Current Tournament */}
              {activeTournament && (
                <View style={st.section}>
                  <Text style={st.sectionLabel}>{t('home.currentTournament')}</Text>
                  <TouchableOpacity
                    style={[st.activeCard, { borderLeftColor: SURFACE_STRIPE[activeTournament.surface] ?? T.cardBorder }]}
                    onPress={() => router.push({ pathname: '/(tabs)/expenses', params: { openTournament: activeTournament.id } })}
                    activeOpacity={0.8}
                  >
                    <View style={st.activeTop}>
                      <View style={st.cardLeft}>
                        <Text style={st.cardTitle}>
                          {activeTournament.country ? countryFlag(activeTournament.country) + ' ' : ''}{activeTournament.name}
                        </Text>
                        <View style={st.cardSubRow}>
                          <Text style={st.cardSub}>{fmtDateRange(activeTournament.startDate, activeTournament.endDate)}</Text>
                          {activeTournament.surface ? <CourtIcon surface={activeTournament.surface} /> : null}
                        </View>
                      </View>
                      <View style={st.expenseRight}>
                        <Text style={st.spentAmount}>${activeTournamentSpent.toLocaleString('en-US')}</Text>
                        <Text style={[st.netResult, activeNet >= 0 && st.netPositive]}>
                          {activeNet >= 0 ? '+' : '-'}${Math.abs(activeNet).toLocaleString('en-US')} net
                        </Text>
                      </View>
                    </View>
                    {recentExpenses.length > 0 && (
                      <View style={st.miniList}>
                        {recentExpenses.map((e: any, i: number) => (
                          <View key={e.id ?? i} style={st.miniRow}>
                            <Text style={st.miniCat}>{e.category ?? 'expense'}</Text>
                            <Text style={st.miniAmt}>-${(e.amount ?? 0).toLocaleString('en-US')}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => router.push({ pathname: '/(tabs)/expenses', params: { openTournament: activeTournament.id } })}
                  >
                    <Text style={st.seeAll}>{t('home.seeAllExpenses')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Upcoming Tournaments */}
              {upcomingTournaments.length > 0 && (
                <View style={st.section}>
                  <Text style={st.sectionLabel}>{t('home.upcomingTournaments')}</Text>
                  {upcomingTournaments.map((t: any) => {
                    const d = daysUntil(t.startDate);
                    const stripe = SURFACE_STRIPE[t.surface] ?? T.cardBorder;
                    return (
                      <TouchableOpacity
                        key={t.id}
                        style={[st.deadlineCard, { borderLeftColor: stripe }]}
                        onPress={() => setDetailId(t.id)}
                        activeOpacity={0.8}
                      >
                        <View style={st.cardLeft}>
                          <Text style={st.cardTitle}>
                            {t.country ? countryFlag(t.country) + ' ' : ''}{t.name}
                          </Text>
                          <View style={st.cardSubRow}>
                            <Text style={st.cardSub}>{fmtDateRange(t.startDate, t.endDate)}</Text>
                            {t.surface ? <CourtIcon surface={t.surface} /> : null}
                          </View>
                        </View>
                        <Text style={st.upcomingDays}>{d !== null ? `${d}d` : ''}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity activeOpacity={0.7} onPress={() => router.push('/(tabs)/tournaments' as any)}>
                    <Text style={st.seeAll}>{t('home.viewAllTournaments')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* No tournaments yet — inline prompt, does not replace the page */}
              {tournaments.length === 0 && (
                <View style={st.section}>
                  <TouchableOpacity style={st.emptyStateCta} activeOpacity={0.8} onPress={() => router.push('/(tabs)/tournaments' as any)}>
                    <Text style={st.emptyStateCtaText}>{t('home.goToTournaments')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* My Performance & Compare Players — always visible */}
              <View style={st.section}>
                <Text style={st.sectionLabel}>{t('home.analytics')}</Text>
                <TouchableOpacity
                  style={[st.deadlineCard, { borderLeftColor: T.accent, marginBottom: 6 }]}
                  onPress={() => router.push('/my-performance' as any)}
                  activeOpacity={0.8}
                >
                  <View style={st.cardLeft}>
                    <Text style={st.cardTitle}>{t('home.myPerformance')}</Text>
                    <Text style={st.cardSub}>{t('home.myPerformanceSub')}</Text>
                  </View>
                  <Text style={st.featureChevron}>›</Text>
                </TouchableOpacity>
              </View>

              {/* Season Snapshot — always visible */}
              <View style={st.section}>
                <Text style={st.sectionLabel}>{t('home.seasonSnapshot')}</Text>
                <View style={st.seasonBar}>
                  <View style={st.seasonStat}>
                    <Text style={st.seasonStatLabel}>{t('home.played')}</Text>
                    <Text style={st.seasonStatValue}>{seasonStats.played}</Text>
                  </View>
                  <View style={st.seasonDivider} />
                  <View style={st.seasonStat}>
                    <Text style={st.seasonStatLabel}>{t('home.spent')}</Text>
                    <Text style={st.seasonStatValue}>${seasonStats.totalSpent > 999 ? `${(seasonStats.totalSpent / 1000).toFixed(1)}k` : seasonStats.totalSpent}</Text>
                  </View>
                  <View style={st.seasonDivider} />
                  <View style={st.seasonStat}>
                    <Text style={st.seasonStatLabel}>{t('home.prize')}</Text>
                    <Text style={st.seasonStatValue}>${seasonStats.totalPrize > 999 ? `${(seasonStats.totalPrize / 1000).toFixed(1)}k` : seasonStats.totalPrize}</Text>
                  </View>
                  <View style={st.seasonDivider} />
                  <View style={st.seasonStat}>
                    <Text style={st.seasonStatLabel}>{t('home.net')}</Text>
                    <Text style={[st.seasonStatValue, seasonStats.net >= 0 ? st.netPositive : st.netResult]}>
                      {seasonStats.net >= 0 ? '+' : '-'}${Math.abs(seasonStats.net) > 999 ? `${(Math.abs(seasonStats.net) / 1000).toFixed(1)}k` : Math.abs(seasonStats.net)}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={{ height: 80 }} />
            </>
          )}
        </ScrollView>

        <FloatingInsight
          insights={insights ?? []}
          locked={!insightsLoading && (!insights || insights.length === 0)}
        />
      </View>

      {detailId && (
        <TournamentDetail tournamentId={detailId} onClose={() => setDetailId(null)} />
      )}
      <ScreenWalkthrough
        steps={[
          { icon: '✦', title: t('walkthrough.home.ai.title'), body: t('walkthrough.home.ai.body') },
          { icon: '📊', title: t('walkthrough.home.season.title'), body: t('walkthrough.home.season.body') },
        ]}
        visible={isFirstVisit}
        onDismiss={markVisited}
      />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },

  topBar: { paddingTop: 16, paddingBottom: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },

  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 11, fontWeight: '600', color: T.textSecondary, letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' },

  deadlineCard: {
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: T.card, borderLeftWidth: 3, borderLeftColor: T.cardBorder,
  },
  cardLeft: { flex: 1, marginRight: 12 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: T.textPrimary, marginBottom: 2 },
  cardSubRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardSub: { fontSize: 12, color: T.textSecondary, fontWeight: '400' },

  todayPill: { backgroundColor: T.accent, borderRadius: 12, paddingHorizontal: 8, height: 24, alignItems: 'center', justifyContent: 'center' },
  todayPillText: { color: '#FFF', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  daysText: { fontSize: 13, fontWeight: '700' },

  activeCard: {
    borderRadius: 12, padding: 14, marginBottom: 6,
    backgroundColor: T.card, borderLeftWidth: 3, borderLeftColor: T.cardBorder,
  },
  activeTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  expenseRight: { alignItems: 'flex-end' },
  spentAmount: { fontSize: 16, fontWeight: '600', color: T.textPrimary, marginBottom: 2 },
  netResult: { fontSize: 12, color: T.red, fontWeight: '600' },
  netPositive: { color: T.green },

  miniList: { marginTop: 10, borderTopWidth: 1, borderTopColor: T.cardBorder, paddingTop: 10, gap: 4 },
  miniRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  miniCat: { fontSize: 13, color: T.textSecondary, fontWeight: '400', textTransform: 'capitalize' },
  miniAmt: { fontSize: 13, color: T.red, fontWeight: '600' },

  seeAll: { fontSize: 13, color: T.accent, fontWeight: '600', marginTop: 8 },

  offlineBanner: { backgroundColor: T.amber, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 16, marginBottom: 16, alignItems: 'center' },
  offlineText: { fontSize: 13, fontWeight: '600', color: '#FFF' },

  errorBanner: { backgroundColor: T.red, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginTop: 24, alignItems: 'center' },
  errorBannerText: { fontSize: 13, fontWeight: '600', color: '#FFF', textAlign: 'center' },

  emptyNote: { fontSize: 13, color: T.textTertiary, fontStyle: 'italic', marginBottom: 16 },
  featureChevron: { fontSize: 20, color: T.accent, fontWeight: '300' },

  upcomingDays: { fontSize: 13, fontWeight: '600', color: T.textSecondary },

  seasonBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.card, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8 },
  seasonStat: { flex: 1, alignItems: 'center' },
  seasonStatLabel: { fontSize: 10, fontWeight: '600', color: T.textTertiary, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 },
  seasonStatValue: { fontSize: 14, fontWeight: '700', color: T.textPrimary },
  seasonDivider: { width: 1, height: 24, backgroundColor: T.cardBorder },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 64 },
  emptyStateIcon: { fontSize: 48, marginBottom: 16 },
  emptyStateTitle: { fontSize: 18, fontWeight: '700', color: T.textPrimary, textAlign: 'center', marginBottom: 8 },
  emptyStateBody: { fontSize: 14, color: T.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  emptyStateCta: { backgroundColor: T.accent, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  emptyStateCtaText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});

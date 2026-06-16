import React, { useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Image,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAppQuery } from '@/hooks/useAppQuery';
import { CourtIcon } from '@/components/ui/court-icon';
import { TournamentDetail } from '@/app/(tabs)/tournaments';
import { fmtDateRange } from '@/utils/deadlines';

function countryFlag(country: string): string {
  const map: Record<string, string> = {
    BR: '🇧🇷', AR: '🇦🇷', US: '🇺🇸', ES: '🇪🇸', AU: '🇦🇺', FR: '🇫🇷',
    GB: '🇬🇧', DE: '🇩🇪', IT: '🇮🇹', CL: '🇨🇱', MX: '🇲🇽', PT: '🇵🇹',
  };
  return map[(country ?? '').toUpperCase()] ?? '🌍';
}

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
    if (t.isWithdrawn) continue;
    if (t.withdrawalDeadline) {
      const d = daysUntil(t.withdrawalDeadline);
      if (d !== null && d >= 0 && d <= 30) {
        items.push({ t, type: 'Withdrawal', date: t.withdrawalDeadline, days: d, isToday: d === 0 });
      }
    }
    if (!t.isRegistered && t.signUpDeadline) {
      const d = daysUntil(t.signUpDeadline);
      if (d !== null && d >= 0 && d <= 30) {
        items.push({ t, type: 'Sign up', date: t.signUpDeadline, days: d, isToday: d === 0 });
      }
    }
  }
  return items.sort((a, b) => (a.days ?? 99) - (b.days ?? 99)).slice(0, 5);
}

// Parse a date value into a LOCAL midnight Date, avoiding the UTC-parse timezone trap.
// "2026-06-14" via new Date() → UTC midnight → wrong local day in negative-offset zones.
// This always gives local midnight so comparisons against new Date() work correctly.
function parseLocalDate(val: any): Date | null {
  if (!val) return null;
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split('-').map(Number);
    return new Date(y, m - 1, d); // local midnight — no UTC shift
  }
  // Timestamp (ms) or other string — let the Date constructor handle it
  const d = new Date(typeof val === 'number' ? val : String(val));
  return isNaN(d.getTime()) ? null : d;
}

function deadlineUrgencyColor(days: number | null): string {
  if (days === null) return '#AAAAAA';
  if (days <= 3) return '#E24B4A';
  if (days <= 7) return '#EF9F27';
  return '#AAAAAA';
}

function getActiveTournament(tournaments: any[]): any | null {
  const now = new Date();

  console.log('[HomeScreen] ── date debug ──────────────────────────────');
  console.log('[HomeScreen] now =', now.toString());
  console.log('[HomeScreen] tournament count =', tournaments.length);

  let result: any = null;

  for (const t of tournaments) {
    console.log(`[HomeScreen] "${t.name}" raw: startDate=${JSON.stringify(t.startDate)} endDate=${JSON.stringify(t.endDate)} isWithdrawn=${t.isWithdrawn}`);

    if (t.isWithdrawn) { console.log('  → skip: withdrawn'); continue; }
    if (!t.startDate || !t.endDate) { console.log('  → skip: missing dates'); continue; }

    const start = parseLocalDate(t.startDate);
    const end   = parseLocalDate(t.endDate);
    if (!start || !end) { console.log('  → skip: unparseable dates'); continue; }

    // End of the last day (local time) — include the full final day
    end.setHours(23, 59, 59, 999);

    const match = now >= start && now <= end;
    console.log(`  → start=${start.toLocaleDateString()} end=${end.toLocaleDateString()} match=${match}`);

    if (match) { result = t; break; }
  }

  console.log('[HomeScreen] active tournament =', result ? result.name : 'none');
  console.log('[HomeScreen] ──────────────────────────────────────────────');
  return result;
}

export default function HomeScreen() {
  const { data, isLoading } = useAppQuery({ tournaments: {}, expenses: {} });
  const [detailId, setDetailId] = useState<string | null>(null);
  const router = useRouter();

  const tournaments = data?.tournaments ?? [];
  const expenses = data?.expenses ?? [];

  const deadlines = getUpcomingDeadlines(tournaments);
  const activeTournament = getActiveTournament(tournaments);

  const activeTournamentExpenses = activeTournament
    ? expenses.filter((e: any) => e.tournamentId === activeTournament.id)
    : [];
  const activeTournamentSpent = activeTournamentExpenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
  // Most recent 3 expenses for the mini list (sort descending by creation order if available)
  const recentExpenses = [...activeTournamentExpenses]
    .sort((a: any, b: any) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, 3);
  const activeSingles    = activeTournament?.singlesPrizeMoney ?? 0;
  const activeDoubles    = activeTournament?.doublesPrizeMoney ?? 0;
  const activePrizeMoney = activeSingles + activeDoubles > 0
    ? activeSingles + activeDoubles
    : (activeTournament?.prizeMoney ?? 0);
  const activeNet = activePrizeMoney - activeTournamentSpent;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAFAFA" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Top bar */}
        <View style={styles.topBar}>
          <Image source={require('@/assets/images/tourly-logo.png')} style={styles.logo} resizeMode="contain" />
        </View>

        {isLoading ? (
          <ActivityIndicator color="#5B5BD6" style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Section 1: Upcoming deadlines */}
            <Text style={styles.sectionLabel}>UPCOMING DEADLINES</Text>

            {deadlines.length === 0 ? (
              <Text style={styles.emptyNote}>No upcoming deadlines in the next 30 days.</Text>
            ) : (
              deadlines.map((item, idx) => {
                return (
                  <TouchableOpacity
                    key={idx}
                    style={styles.card}
                    onPress={() => setDetailId(item.t.id)}
                    activeOpacity={0.8}>
                    <View style={styles.cardLeft}>
                      <Text style={styles.cardTitle}>
                        {item.t.country ? countryFlag(item.t.country) + ' ' : ''}{item.t.name}
                      </Text>
                      <View style={styles.cardSubRow}>
                        <Text style={styles.cardSub}>{item.type}</Text>
                        {item.t.surface ? <CourtIcon surface={item.t.surface} /> : null}
                      </View>
                    </View>
                    {item.isToday ? (
                      <View style={styles.todayPill}><Text style={styles.todayPillText}>today</Text></View>
                    ) : (
                      <Text style={[styles.daysText, { color: deadlineUrgencyColor(item.days) }]}>{item.days}d</Text>
                    )}
                  </TouchableOpacity>
                );
              })
            )}

            <View style={styles.divider} />

            {/* Section 2: Current tournament */}
            {activeTournament && (
              <>
                <Text style={styles.sectionLabel}>CURRENT TOURNAMENT</Text>

                {/* Active tournament card — taps into expenses for this tournament */}
                <TouchableOpacity
                  style={styles.activeTournamentCard}
                  onPress={() => router.push({ pathname: '/(tabs)/expenses', params: { openTournament: activeTournament.id } })}
                  activeOpacity={0.8}>
                  <View style={styles.activeTournamentTop}>
                    <View style={styles.cardLeft}>
                      <Text style={styles.cardTitle}>
                        {activeTournament.country ? countryFlag(activeTournament.country) + ' ' : ''}{activeTournament.name}
                      </Text>
                      <View style={styles.cardSubRow}>
                        <Text style={styles.cardSub}>
                          {fmtDateRange(activeTournament.startDate, activeTournament.endDate)}
                        </Text>
                        {activeTournament.surface ? <CourtIcon surface={activeTournament.surface} /> : null}
                      </View>
                    </View>
                    <View style={styles.expenseRight}>
                      <Text style={styles.spentAmount}>${activeTournamentSpent.toLocaleString('en-US')} spent</Text>
                      <Text style={[styles.netResult, activeNet >= 0 && styles.netPositive]}>
                        {activeNet >= 0 ? '+' : ''}{activeNet < 0 ? '-' : ''}${Math.abs(activeNet).toLocaleString('en-US')} net
                      </Text>
                    </View>
                  </View>

                  {/* Mini expenses list — last 3 */}
                  {recentExpenses.length > 0 && (
                    <View style={styles.miniExpenseList}>
                      {recentExpenses.map((e: any, i: number) => (
                        <View key={e.id ?? i} style={styles.miniExpenseRow}>
                          <Text style={styles.miniExpenseCategory}>{e.category ?? 'expense'}</Text>
                          <Text style={styles.miniExpenseAmount}>-${(e.amount ?? 0).toLocaleString('en-US')}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </TouchableOpacity>

                <TouchableOpacity activeOpacity={0.7} onPress={() => router.push({ pathname: '/(tabs)/expenses', params: { openTournament: activeTournament.id } })}>
                  <Text style={styles.seeAll}>see all expenses →</Text>
                </TouchableOpacity>
              </>
            )}

          </>
        )}

      </ScrollView>

      {detailId && (
        <TournamentDetail tournamentId={detailId} onClose={() => setDetailId(null)} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAFAFA' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 32 },
  topBar: { paddingTop: 18, paddingBottom: 24 },
  logo: { height: 64, width: 220 },
  sectionLabel: { fontSize: 11, fontWeight: '600', color: '#AAAAAA', letterSpacing: 0.8, marginBottom: 12 },
  card: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFFFF' },
  cardLeft: { flex: 1, marginRight: 12 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#2D2B55', marginBottom: 3 },
  cardSubRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 3 },
  cardSub: { fontSize: 12, color: '#999999', fontWeight: '400' },
  todayPill: { backgroundColor: '#E24B4A', borderRadius: 20, paddingHorizontal: 11, paddingVertical: 4 },
  todayPillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  daysText: { fontSize: 13, fontWeight: '700' },
  expenseRight: { alignItems: 'flex-end' },
  spentAmount: { fontSize: 16, fontWeight: '700', color: '#2D2B55', marginBottom: 2 },
  netResult: { fontSize: 12, color: '#E24B4A', fontWeight: '500' },
  netPositive: { color: '#2D9E6B' },
  divider: { height: 1, backgroundColor: '#EBEBEB', marginVertical: 22 },
  emptyNote: { fontSize: 13, color: '#BBBBBB', marginBottom: 12 },
  // Active tournament card (taller — includes mini expense list)
  activeTournamentCard: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 8, backgroundColor: '#FFFFFF' },
  activeTournamentTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  miniExpenseList: { marginTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.07)', paddingTop: 10, gap: 6 },
  miniExpenseRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  miniExpenseCategory: { fontSize: 13, color: '#555555', fontWeight: '400', textTransform: 'capitalize' },
  miniExpenseAmount: { fontSize: 13, color: '#E24B4A', fontWeight: '600' },
  seeAll: { fontSize: 13, color: '#5B5BD6', fontWeight: '500', marginTop: 4, marginBottom: 4 },
});

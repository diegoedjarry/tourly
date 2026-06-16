import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '@/db';
import { useAppQuery } from '@/hooks/useAppQuery';
import { TournamentDetail } from '@/app/(tabs)/tournaments';
import { CourtIcon } from '@/components/ui/court-icon';

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SURFACE: Record<string, { bg: string; text: string }> = {
  clay:  { bg: '#FAEEDA', text: '#854F0B' },
  hard:  { bg: '#E6F1FB', text: '#185FA5' },
  grass: { bg: '#EAF3DE', text: '#3B6D11' },
};

const FLAG: Record<string, string> = {
  AR: '🇦🇷', AU: '🇦🇺', BR: '🇧🇷', CL: '🇨🇱', DE: '🇩🇪', ES: '🇪🇸',
  FR: '🇫🇷', GB: '🇬🇧', IT: '🇮🇹', MX: '🇲🇽', PT: '🇵🇹', US: '🇺🇸',
};
function flag(code: string | undefined) {
  return code ? (FLAG[code.toUpperCase()] ?? '') : '';
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function parseDate(str: string | undefined): Date | null {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

// Monday-aligned week start
function getMonday(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  const dow = copy.getDay();
  copy.setDate(copy.getDate() - (dow === 0 ? 6 : dow - 1));
  return copy;
}

// Build 6 weeks × 7 days grid, starting Monday on/before the 1st
function buildGrid(year: number, month: number): Date[][] {
  const start = getMonday(new Date(year, month, 1));
  return Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const day = new Date(start);
      day.setDate(start.getDate() + w * 7 + d);
      return day;
    })
  );
}

function surfaceKey(t: any): keyof typeof SURFACE {
  const s = t.surface?.toLowerCase() ?? '';
  return (s in SURFACE ? s : 'clay') as keyof typeof SURFACE;
}

// Tournaments that overlap the Mon–Sun range of a week
function tournamentsForWeek(weekDays: Date[], tournaments: any[]): any[] {
  const monday = weekDays[0];
  const sunday = weekDays[6];
  return tournaments.filter((t: any) => {
    const start = parseDate(t.startDate);
    const end = parseDate(t.endDate) ?? start;
    if (!start) return false;
    return start <= sunday && end >= monday;
  });
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data } = useAppQuery({ tournaments: {} });
  const tournaments = (data?.tournaments ?? []).filter(
    (t: any) => !t.isWithdrawn && t.isInMyList !== false
  );

  const weeks = buildGrid(year, month);

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  return (
    <SafeAreaView style={s.safe}>

      {/* Sticky: month nav + day-of-week labels */}
      <View style={s.stickyTop}>
        <View style={s.header}>
          <TouchableOpacity onPress={prevMonth} style={s.navBtn} activeOpacity={0.7}>
            <Text style={s.navArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={s.monthTitle}>{MONTHS[month]} {year}</Text>
          <TouchableOpacity onPress={nextMonth} style={s.navBtn} activeOpacity={0.7}>
            <Text style={s.navArrow}>›</Text>
          </TouchableOpacity>
        </View>
        <View style={s.dayHeaders}>
          {DAYS.map(d => (
            <View key={d} style={s.dayHeaderCell}>
              <Text style={s.dayHeaderText}>{d}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Scrollable grid */}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}>

        {/* Calendar grid */}
        <View style={s.grid}>
          {weeks.map((week, wi) => {
            const weekTournaments = tournamentsForWeek(week, tournaments);

            return (
              <View key={wi} style={s.weekBlock}>
                {/* Number row */}
                <View style={s.numberRow}>
                  {week.map((day, di) => {
                    const inMonth = day.getMonth() === month;
                    const isToday = sameDay(day, now);
                    return (
                      <View key={di} style={s.dayCell}>
                        <View style={[s.dayNum, isToday && s.todayCircle]}>
                          <Text style={[
                            s.dayText,
                            !inMonth && s.fadedText,
                            isToday && s.todayText,
                          ]}>
                            {day.getDate()}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>

                {/* Tournament banners — one per overlapping tournament */}
                {weekTournaments.map((t: any) => {
                  const label = [flag(t.country), t.name].filter(Boolean).join(' ');
                  return (
                    <TouchableOpacity key={t.id} style={s.banner}
                      onPress={() => setDetailId(t.id)} activeOpacity={0.75}>
                      <View style={s.bannerRow}>
                        <Text style={s.bannerText} numberOfLines={1}>{label}</Text>
                        <CourtIcon surface={t.surface} size="sm" />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })}
        </View>

      </ScrollView>

      {detailId && (
        <TournamentDetail tournamentId={detailId} onClose={() => setDetailId(null)} />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAFAFA' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 40 },

  // Sticky top area (outside ScrollView)
  stickyTop: {
    backgroundColor: '#FAFAFA',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEF2',
  },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingTop: 20, paddingBottom: 14,
  },
  navBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  navArrow: { fontSize: 30, color: '#5B5BD6', fontWeight: '300', lineHeight: 34 },
  monthTitle: { fontSize: 20, fontWeight: '700', color: '#2D2B55' },

  // Day-of-week labels
  dayHeaders: { flexDirection: 'row', marginBottom: 8 },
  dayHeaderCell: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  dayHeaderText: { fontSize: 11, fontWeight: '600', color: '#AAAAAA', letterSpacing: 0.3 },

  // Grid — no overflow:hidden so each week card shows its own rounded corners
  grid: { gap: 8 },

  // Each week is its own card
  weekBlock: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: 10,
    borderWidth: 1,
    borderColor: '#EEEEF2',
  },
  numberRow: { flexDirection: 'row', paddingBottom: 6 },

  // Individual day cell
  dayCell: { flex: 1, alignItems: 'center' },
  dayNum: {
    width: 30, height: 30,
    alignItems: 'center', justifyContent: 'center', borderRadius: 15,
  },
  todayCircle: { backgroundColor: '#5B5BD6' },
  dayText: { fontSize: 13, fontWeight: '500', color: '#2D2B55' },
  fadedText: { color: '#D0D0D8' },
  todayText: { color: '#FFFFFF', fontWeight: '700' },

  // Tournament banner — light indigo tint to stand out from the week card
  banner: {
    marginHorizontal: 4, marginBottom: 4,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: '#EDEDFF',
  },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bannerText: { fontSize: 12, fontWeight: '600', color: '#3B3A7A', flex: 1 },
});

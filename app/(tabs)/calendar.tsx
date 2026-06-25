import React, { useState, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Pressable,
  PanResponder,
  TextInput,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppQuery } from '@/hooks/useAppQuery';
import { TournamentDetail, AddTournamentModal } from '@/app/(tabs)/tournaments';
import { AddExpenseModal } from '@/app/(tabs)/expenses';
import { CourtIcon } from '@/components/ui/court-icon';
import { useFirstVisit } from '@/hooks/useFirstVisit';
import { AgentIcon } from '@/components/ui/agent-icon';
import { ScreenWalkthrough } from '@/components/ui/screen-walkthrough';
import { useRouter } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTrainingBlocks, useAddTrainingBlock, useDeleteTrainingBlock } from '@/hooks/useTrainingBlocks';
import { TournamentMap } from '@/components/ui/tournament-map';
import { useProfile } from '@/hooks/useProfile';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { DEMO_MODE } from '@/config/demo';
import { T } from '@/constants/theme';
import { useLanguage } from '@/hooks/useLanguage';

const CALENDAR_WALKTHROUGH = [
  { icon: '📅', title: 'Monthly overview', body: 'See all your tournaments laid out week by week. Each one is color-coded by surface — clay, hard, or grass.' },
  { icon: '⬅️', title: 'Navigate months', body: 'Tap the arrows to move between months, or hit "Today" to jump back to the current week.' },
  { icon: '👆', title: 'Tournament details', body: 'Tap any tournament banner to open its full details — deadlines, expenses, and more.' },
];

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAYS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const SURFACE: Record<string, { bg: string; text: string }> = {
  clay:  { bg: '#2A1A08', text: '#E8964A' },
  hard:  { bg: '#081828', text: '#5AABEE' },
  grass: { bg: '#0A1E06', text: '#68B83A' },
};

function flag(code: string | undefined): string {
  const upper = (code ?? '').toUpperCase();
  if (upper.length !== 2) return '';
  return String.fromCodePoint(...[...upper].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
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
    if (!start || !end) return false;
    return start <= sunday && end >= monday;
  });
}

interface MappedBlock { id: string; title: string; startDate: string; endDate: string; note: string | null }

function blocksForWeek(weekDays: Date[], blocks: MappedBlock[]): MappedBlock[] {
  const monday = weekDays[0];
  const sunday = weekDays[6];
  return blocks.filter(b => {
    const start = parseDate(b.startDate);
    const end = parseDate(b.endDate) ?? start;
    if (!start || !end) return false;
    return start <= sunday && end >= monday;
  });
}

const BLOCK_TYPES = [
  { key: 'Training', icon: '💪' },
  { key: 'Rest', icon: '😴' },
  { key: 'Travel', icon: '✈️' },
  { key: 'Off', icon: '🏖️' },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const { lang, t } = useLanguage();
  const DAYS = lang === 'es' ? DAYS_ES : DAYS_EN;
  const MONTHS = lang === 'es' ? MONTHS_ES : MONTHS_EN;

  const { data: _prof } = useProfile();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [tappedDate, setTappedDate]           = useState<Date | null>(null);
  const [showDaySheet, setShowDaySheet]       = useState(false);
  const [showAddTournament, setShowAddTournament] = useState(false);
  const [showAddExpense, setShowAddExpense]   = useState(false);
  const [showAddBlock, setShowAddBlock]       = useState(false);
  const [showMap, setShowMap]                 = useState(false);
  const [selectedBlock, setSelectedBlock]     = useState<MappedBlock | null>(null);
  const [calendarMode, setCalendarMode] = useState<'calendar' | 'points'>('calendar');
  const [showModeSheet, setShowModeSheet] = useState(false);
  const { isFirstVisit, markVisited } = useFirstVisit('calendar');
  const router = useRouter();

  const { data } = useAppQuery({ tournaments: {} });
  const allTournaments = data?.tournaments ?? [];
  const tournaments = useMemo(
    () => allTournaments.filter((t: any) => !t.isWithdrawn && t.isInMyList !== false),
    [allTournaments],
  );

  const { data: rawBlocks } = useTrainingBlocks();
  const addBlock = useAddTrainingBlock();
  const deleteBlock = useDeleteTrainingBlock();
  const trainingBlocks: MappedBlock[] = useMemo(
    () => (rawBlocks ?? []).map(b => ({
      id: b.id, title: b.title, startDate: b.start_date, endDate: b.end_date, note: b.note,
    })),
    [rawBlocks],
  );

  const weeks = useMemo(() => buildGrid(year, month), [year, month]);

  const weekTournamentMap = useMemo(() =>
    weeks.map(week => tournamentsForWeek(week, tournaments)),
    [weeks, tournaments],
  );

  const weekBlockMap = useMemo(() =>
    weeks.map(week => blocksForWeek(week, trainingBlocks)),
    [weeks, trainingBlocks],
  );

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  const prevRef = useRef(prevMonth);
  const nextRef = useRef(nextMonth);
  prevRef.current = prevMonth;
  nextRef.current = nextMonth;

  const swipedRef = useRef(false);
  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 30 && Math.abs(gs.dy) < 40,
    onPanResponderMove: (_, gs) => {
      if (swipedRef.current) return;
      if (Math.abs(gs.dx) > 50) {
        swipedRef.current = true;
        if (gs.dx < 0) nextRef.current();
        else prevRef.current();
      }
    },
    onPanResponderRelease: () => { swipedRef.current = false; },
    onPanResponderTerminate: () => { swipedRef.current = false; },
  })).current;

  return (
    <SafeAreaView style={s.safe}>

      {/* Sticky: month nav + day-of-week labels */}
      <View style={s.stickyTop}>
        <View style={s.topRow}>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
            activeOpacity={0.7}
            onPress={() => setShowModeSheet(true)}>
            <AgentIcon size={70} />
            <Text style={s.monthTitle}>
              {calendarMode === 'calendar' ? t('calendar.title') : t('calendar.pointsTitle')}
            </Text>
            <Text style={{ fontSize: 12, color: T.textTertiary }}>▼</Text>
          </TouchableOpacity>
          {(year !== now.getFullYear() || month !== now.getMonth()) && (
            <TouchableOpacity
              style={s.todayBtn}
              onPress={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); }}
              activeOpacity={0.7}>
              <Text style={s.todayBtnText}>{t('calendar.today')}</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={s.header}>
          <TouchableOpacity onPress={prevMonth} style={s.navBtn} activeOpacity={0.7}>
            <Text style={s.navArrow}>‹</Text>
          </TouchableOpacity>
          <View style={s.monthPill}>
            <Text style={s.monthTitle}>{MONTHS[month]} {year}</Text>
          </View>
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

      {calendarMode === 'points' ? (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
          {...panResponder.panHandlers}>

          {/* IPIN placeholder — shown when no IPIN is configured */}
          {!_prof?.ipin_number && (
            <View style={ptStyles.ipinCard}>
              <Text style={ptStyles.ipinIcon}>📡</Text>
              <View style={{ flex: 1 }}>
                <Text style={ptStyles.ipinText}>
                  {t('calendar.ipinPrompt')}
                </Text>
                <TouchableOpacity
                  style={ptStyles.ipinBtn}
                  activeOpacity={0.8}
                  onPress={() => router.push('/settings')}>
                  <Text style={ptStyles.ipinBtnText}>{t('calendar.goToSettings')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Points info banner */}
          <View style={ptStyles.infoBanner}>
            <Text style={ptStyles.infoIcon}>🏆</Text>
            <Text style={ptStyles.infoText}>
              {t('calendar.pointsInfo')}
            </Text>
          </View>

          {/* Same calendar grid but with points banners */}
          <View style={s.grid}>
            {weeks.map((week, wi) => {
              const weekTournaments = weekTournamentMap[wi];
              return (
                <View key={wi} style={s.weekBlock}>
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
                  {weekTournaments.map((t: any) => {
                    const label = [flag(t.country), t.name].filter(Boolean).join(' ');
                    return (
                      <TouchableOpacity key={t.id} style={ptStyles.pointsBanner}
                        onPress={() => setDetailId(t.id)} activeOpacity={0.75}>
                        <View style={ptStyles.pointsBannerRow}>
                          <View style={ptStyles.pointsBadge}>
                            <Text style={ptStyles.pointsBadgeText}>? pts</Text>
                          </View>
                          <Text style={ptStyles.pointsBannerText} numberOfLines={1}>{label}</Text>
                          <CourtIcon surface={t.surface} size="sm" />
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  {weekTournaments.length === 0 && (
                    <View style={ptStyles.emptyWeek}>
                      <Text style={ptStyles.emptyWeekText}>{t('calendar.noPointsDefend')}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </ScrollView>
      ) : (
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        {...panResponder.panHandlers}>

        {/* Calendar grid */}
        <View style={s.grid}>
          {weeks.map((week, wi) => {
            const weekTournaments = weekTournamentMap[wi];
            const weekBlocks = weekBlockMap[wi];

            return (
              <View key={wi} style={s.weekBlock}>
                {/* Number row */}
                <View style={s.numberRow}>
                  {week.map((day, di) => {
                    const inMonth = day.getMonth() === month;
                    const isToday = sameDay(day, now);
                    return (
                      <TouchableOpacity
                        key={di}
                        style={s.dayCell}
                        activeOpacity={0.6}
                        onPress={() => {
                          setTappedDate(day);
                          setShowDaySheet(true);
                        }}>
                        <View style={[s.dayNum, isToday && s.todayCircle]}>
                          <Text style={[
                            s.dayText,
                            !inMonth && s.fadedText,
                            isToday && s.todayText,
                          ]}>
                            {day.getDate()}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Tournament banners */}
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

                {/* Training block banners */}
                {weekBlocks.map((b) => {
                  const icon = BLOCK_TYPES.find(bt => bt.key === b.title)?.icon ?? '💪';
                  return (
                    <TouchableOpacity key={b.id} style={s.blockBanner}
                      onPress={() => setSelectedBlock(b)} activeOpacity={0.75}>
                      <View style={s.bannerRow}>
                        <Text style={s.blockBannerText} numberOfLines={1}>{icon} {b.title}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })}
        </View>

        {/* View Map button */}
        <TouchableOpacity style={s.viewMapBtn} activeOpacity={0.8}
          onPress={() => setShowMap(true)}>
          <Text style={s.viewMapIcon}>🌍</Text>
          <Text style={s.viewMapText}>{t('calendar.viewMap')}</Text>
          <Text style={s.viewMapArrow}>›</Text>
        </TouchableOpacity>

      </ScrollView>
      )}

      {showMap && (
        <TournamentMap
          tournaments={tournaments}
          onOpenTournament={(id) => { setShowMap(false); setDetailId(id); }}
          onClose={() => setShowMap(false)}
        />
      )}

      {detailId && (
        <TournamentDetail tournamentId={detailId} onClose={() => setDetailId(null)} />
      )}

      {/* Day-tap action sheet */}
      {showDaySheet && tappedDate && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowDaySheet(false)}>
          <Pressable style={s.sheetBackdrop} onPress={() => setShowDaySheet(false)}>
            <Pressable style={s.sheetContainer} onPress={() => {}}>
              <View style={s.sheetHandle} />
              <Text style={s.sheetDate}>
                {tappedDate.toLocaleDateString(lang === 'es' ? 'es-CL' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </Text>
              <TouchableOpacity
                style={s.sheetCard}
                activeOpacity={0.8}
                onPress={() => {
                  setShowDaySheet(false);
                  setShowAddTournament(true);
                }}>
                <Text style={s.sheetCardIcon}>🎾</Text>
                <View style={s.sheetCardBody}>
                  <Text style={s.sheetCardTitle}>{t('calendar.addTournament')}</Text>
                  <Text style={s.sheetCardSub}>{t('calendar.weekStarting')}</Text>
                </View>
                <Text style={s.sheetCardArrow}>›</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.sheetCard}
                activeOpacity={0.8}
                onPress={() => {
                  setShowDaySheet(false);
                  setShowAddExpense(true);
                }}>
                <Text style={s.sheetCardIcon}>💰</Text>
                <View style={s.sheetCardBody}>
                  <Text style={s.sheetCardTitle}>{t('calendar.addExpense')}</Text>
                  <Text style={s.sheetCardSub}>{t('calendar.preFilledDate')}</Text>
                </View>
                <Text style={s.sheetCardArrow}>›</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.sheetCard}
                activeOpacity={0.8}
                onPress={() => {
                  setShowDaySheet(false);
                  setShowAddBlock(true);
                }}>
                <Text style={s.sheetCardIcon}>💪</Text>
                <View style={s.sheetCardBody}>
                  <Text style={s.sheetCardTitle}>{t('calendar.addTrainingBlock')}</Text>
                  <Text style={s.sheetCardSub}>{t('calendar.trainingDays')}</Text>
                </View>
                <Text style={s.sheetCardArrow}>›</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.sheetCancelBtn} onPress={() => setShowDaySheet(false)} activeOpacity={0.7}>
                <Text style={s.sheetCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Add Tournament — pre-filled with Monday of tapped day's week */}
      {showAddTournament && tappedDate && (() => {
        const monday = getMonday(tappedDate);
        const pad = (n: number) => String(n).padStart(2, '0');
        const mondayStr = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
        return (
          <AddTournamentModal
            defaultStartDate={mondayStr}
            onClose={() => setShowAddTournament(false)}
          />
        );
      })()}

      {/* Add Expense — pre-filled with tapped date */}
      {showAddExpense && tappedDate && (() => {
        const pad = (n: number) => String(n).padStart(2, '0');
        const dateStr = `${tappedDate.getFullYear()}-${pad(tappedDate.getMonth() + 1)}-${pad(tappedDate.getDate())}`;
        return (
          <AddExpenseModal
            tournaments={allTournaments}
            defaultDate={dateStr}
            onClose={() => setShowAddExpense(false)}
          />
        );
      })()}

      {/* Add Training Block modal */}
      {showAddBlock && tappedDate && (
        <AddTrainingBlockModal
          defaultDate={tappedDate}
          onSave={async (block) => {
            if (DEMO_MODE) {
              Alert.alert(t('calendar.demoMode'), t('calendar.demoTrainingMsg'));
              setShowAddBlock(false);
              return;
            }
            try {
              await addBlock.mutateAsync(block);
              setShowAddBlock(false);
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Could not save.');
            }
          }}
          onClose={() => setShowAddBlock(false)}
        />
      )}

      {/* Training Block detail */}
      {selectedBlock && (
        <Modal transparent animationType="slide" onRequestClose={() => setSelectedBlock(null)}>
          <Pressable style={s.sheetBackdrop} onPress={() => setSelectedBlock(null)}>
            <Pressable style={s.sheetContainer} onPress={() => {}}>
              <View style={s.sheetHandle} />
              <Text style={s.blockDetailTitle}>
                {BLOCK_TYPES.find(bt => bt.key === selectedBlock.title)?.icon ?? '💪'} {selectedBlock.title}
              </Text>
              <Text style={s.blockDetailDates}>
                {fmtBlockRange(selectedBlock.startDate, selectedBlock.endDate)}
              </Text>
              {selectedBlock.note ? <Text style={s.blockDetailNote}>{selectedBlock.note}</Text> : null}
              <TouchableOpacity
                style={s.blockDeleteBtn}
                activeOpacity={0.8}
                onPress={() => {
                  Alert.alert(t('common.delete'), `Remove this ${selectedBlock.title.toLowerCase()} block?`, [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                      text: t('common.delete'), style: 'destructive',
                      onPress: async () => {
                        try {
                          await deleteBlock.mutateAsync(selectedBlock.id);
                          setSelectedBlock(null);
                        } catch {}
                      },
                    },
                  ]);
                }}>
                <Text style={s.blockDeleteText}>{t('calendar.deleteBlock')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.sheetCancelBtn} onPress={() => setSelectedBlock(null)} activeOpacity={0.7}>
                <Text style={s.sheetCancelText}>{t('common.close')}</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Mode selection sheet */}
      {showModeSheet && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowModeSheet(false)}>
          <Pressable style={s.sheetBackdrop} onPress={() => setShowModeSheet(false)}>
            <Pressable style={s.sheetContainer} onPress={() => {}}>
              <View style={s.sheetHandle} />
              <Text style={[s.sheetDate, { fontSize: 13, letterSpacing: 0.5 }]}>{t('calendar.switchView')}</Text>
              <TouchableOpacity
                style={[s.sheetCard, calendarMode === 'calendar' && { borderWidth: 1.5, borderColor: T.accent }]}
                activeOpacity={0.8}
                onPress={() => { setCalendarMode('calendar'); setShowModeSheet(false); }}>
                <Text style={s.sheetCardIcon}>📅</Text>
                <View style={s.sheetCardBody}>
                  <Text style={s.sheetCardTitle}>{t('calendar.title')}</Text>
                  <Text style={s.sheetCardSub}>{t('calendar.schedule')}</Text>
                </View>
                {calendarMode === 'calendar' && <Text style={{ fontSize: 16, color: T.accent }}>✓</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.sheetCard, calendarMode === 'points' && { borderWidth: 1.5, borderColor: T.accent }]}
                activeOpacity={0.8}
                onPress={() => { setCalendarMode('points'); setShowModeSheet(false); }}>
                <Text style={s.sheetCardIcon}>🏆</Text>
                <View style={s.sheetCardBody}>
                  <Text style={s.sheetCardTitle}>{t('calendar.pointsTitle')}</Text>
                  <Text style={s.sheetCardSub}>{t('calendar.weekByWeek')}</Text>
                </View>
                {calendarMode === 'points' && <Text style={{ fontSize: 16, color: T.accent }}>✓</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={s.sheetCancelBtn} onPress={() => setShowModeSheet(false)} activeOpacity={0.7}>
                <Text style={s.sheetCancelText}>{t('calendar.cancel')}</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      <ScreenWalkthrough steps={CALENDAR_WALKTHROUGH} visible={isFirstVisit} onDismiss={markVisited} />
    </SafeAreaView>
  );
}

// ─── Add Training Block Modal ────────────────────────────────────────────────

function fmtBlockRange(start: string, end: string): string {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  if (start === end) return `${sd} ${MONTHS[sm - 1]} ${sy}`;
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS[sm - 1]} ${sy}`;
  return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]} ${ey}`;
}

function pad2(n: number) { return String(n).padStart(2, '0'); }
function dateToStr(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function AddTrainingBlockModal({ defaultDate, onSave, onClose }: {
  defaultDate: Date;
  onSave: (block: { title: string; start_date: string; end_date: string; note: string | null }) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [title, setTitle] = useState('Training');
  const [startDate, setStartDate] = useState(dateToStr(defaultDate));
  const [endDate, setEndDate] = useState(dateToStr(defaultDate));
  const [note, setNote] = useState('');

  const BLOCK_TYPE_LABELS: Record<string, string> = {
    Training: t('calendar.training'),
    Rest: t('calendar.rest'),
    Travel: t('calendar.travel'),
    Off: t('calendar.off'),
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={tb.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={s.sheetBackdrop} onPress={onClose} />
        <View style={tb.sheet}>
          <View style={s.sheetHandle} />
          <Text style={tb.title}>{t('calendar.addTrainingBlock')}</Text>

          <Text style={tb.label}>{t('calendar.type')}</Text>
          <View style={tb.typeRow}>
            {BLOCK_TYPES.map(bt => (
              <TouchableOpacity
                key={bt.key}
                style={[tb.typeChip, title === bt.key && tb.typeChipActive]}
                onPress={() => setTitle(bt.key)}
                activeOpacity={0.8}>
                <Text style={tb.typeEmoji}>{bt.icon}</Text>
                <Text style={[tb.typeLabel, title === bt.key && tb.typeLabelActive]}>{BLOCK_TYPE_LABELS[bt.key] ?? bt.key}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={tb.label}>{t('calendar.startDate')}</Text>
          <DatePickerField value={startDate} onChange={(v) => {
            setStartDate(v);
            if (v > endDate) setEndDate(v);
          }} />

          <Text style={tb.label}>{t('calendar.endDate')}</Text>
          <DatePickerField value={endDate} onChange={(v) => {
            if (v >= startDate) setEndDate(v);
          }} />

          <Text style={tb.label}>{t('calendar.noteOptional')}</Text>
          <TextInput
            style={tb.noteInput}
            value={note}
            onChangeText={setNote}
            placeholder={t('calendar.notePlaceholder')}
            placeholderTextColor="#3A3A4C"
            multiline
          />

          <TouchableOpacity
            style={tb.saveBtn}
            activeOpacity={0.8}
            onPress={() => onSave({ title, start_date: startDate, end_date: endDate, note: note.trim() || null })}>
            <Text style={tb.saveBtnText}>{t('common.save')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={tb.cancelBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={s.sheetCancelText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },

  stickyTop: {
    backgroundColor: T.bg,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
  },

  topRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingTop: 16, paddingBottom: 0,
  },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', paddingVertical: 8,
  },
  navBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  navArrow: { fontSize: 28, color: T.accent, fontWeight: '300' },
  monthPill: { backgroundColor: T.cardBorder, borderRadius: 22, paddingHorizontal: 24, paddingVertical: 8 },
  monthTitle: { fontSize: 18, fontWeight: '700', color: T.textPrimary },
  avatarBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: T.card, borderWidth: 1.5, borderColor: T.accent, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 13, fontWeight: '700', color: T.accent },

  dayHeaders: { flexDirection: 'row', marginBottom: 8 },
  dayHeaderCell: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  dayHeaderText: { fontSize: 11, fontWeight: '600', color: T.textTertiary, letterSpacing: 0.5, textTransform: 'uppercase' },

  grid: { gap: 8 },

  weekBlock: {
    backgroundColor: T.card,
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 8,
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  numberRow: { flexDirection: 'row', paddingBottom: 8 },

  dayCell: { flex: 1, alignItems: 'center' },
  dayNum: {
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center', borderRadius: 16,
  },
  todayCircle: { backgroundColor: T.accent },
  dayText: { fontSize: 13, fontWeight: '500', color: T.textSecondary },
  fadedText: { color: T.textMuted },
  todayText: { color: T.textPrimary, fontWeight: '700' },

  viewMapBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: T.card, borderRadius: 16, padding: 16,
    marginTop: 16, marginBottom: 8,
    borderWidth: 1, borderColor: T.cardBorder,
  },
  viewMapIcon: { fontSize: 20 },
  viewMapText: { flex: 1, fontSize: 15, fontWeight: '600', color: T.textPrimary },
  viewMapArrow: { fontSize: 22, color: T.textMuted, fontWeight: '300' },

  banner: {
    marginHorizontal: 8, marginBottom: 4,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8,
    backgroundColor: T.cardElevated,
  },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bannerText: { fontSize: 11, fontWeight: '600', color: T.textSecondary, flex: 1 },

  todayBtn: {
    backgroundColor: T.accent,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  todayBtnText: { fontSize: 11, fontWeight: '700', color: T.textPrimary, textTransform: 'uppercase' },

  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: T.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 48,
  },
  sheetHandle: {
    width: 32, height: 4, borderRadius: 2,
    backgroundColor: T.cardBorder, alignSelf: 'center', marginBottom: 24,
  },
  sheetDate: {
    fontSize: 11, fontWeight: '600', color: T.textSecondary,
    textAlign: 'center', marginBottom: 16, letterSpacing: 1, textTransform: 'uppercase',
  },
  sheetCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: T.bg, borderRadius: 16,
    padding: 16, marginBottom: 8,
  },
  sheetCardIcon: { fontSize: 24, marginRight: 16 },
  sheetCardBody: { flex: 1 },
  sheetCardTitle: { fontSize: 16, fontWeight: '600', color: T.textPrimary, marginBottom: 4 },
  sheetCardSub: { fontSize: 11, color: T.textTertiary },
  sheetCardArrow: { fontSize: 22, color: T.accent, fontWeight: '300' },
  sheetCancelBtn: {
    backgroundColor: T.bg, borderRadius: 16,
    minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  sheetCancelText: { fontSize: 16, fontWeight: '600', color: T.textSecondary },

  blockBanner: {
    marginHorizontal: 8, marginBottom: 4,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8,
    backgroundColor: 'rgba(45, 106, 45, 0.15)',
    borderLeftWidth: 4, borderLeftColor: T.grassSurface,
  },
  blockBannerText: { fontSize: 11, fontWeight: '600', color: T.grassText, flex: 1 },

  blockDetailTitle: { fontSize: 22, fontWeight: '700', color: T.textPrimary, textAlign: 'center', marginBottom: 8 },
  blockDetailDates: { fontSize: 13, color: T.accent, textAlign: 'center', marginBottom: 16 },
  blockDetailNote: { fontSize: 13, color: T.textSecondary, textAlign: 'center', marginBottom: 24 },
  blockDeleteBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: 16,
    minHeight: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  blockDeleteText: { fontSize: 16, fontWeight: '600', color: T.red },
});

const tb = StyleSheet.create({
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: T.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48,
  },
  title: { fontSize: 22, fontWeight: '700', color: T.textPrimary, textAlign: 'center', marginBottom: 24 },
  label: { fontSize: 11, fontWeight: '600', color: T.textSecondary, letterSpacing: 1, marginTop: 16, marginBottom: 8, textTransform: 'uppercase' },
  typeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  typeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 12, backgroundColor: T.bg,
    borderWidth: 1, borderColor: T.cardBorder,
  },
  typeChipActive: { backgroundColor: T.accentMuted, borderColor: T.accent },
  typeEmoji: { fontSize: 16 },
  typeLabel: { fontSize: 13, fontWeight: '600', color: T.textSecondary },
  typeLabelActive: { color: T.accent },
  noteInput: {
    backgroundColor: T.bg, borderRadius: 12, borderWidth: 1, borderColor: T.cardBorder,
    color: T.textPrimary, fontSize: 13, padding: 16, minHeight: 64, textAlignVertical: 'top',
  },
  saveBtn: {
    backgroundColor: T.accent, borderRadius: 16,
    minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 24,
  },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: T.textPrimary },
  cancelBtn: {
    backgroundColor: T.bg, borderRadius: 16,
    minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
});

const ptStyles = StyleSheet.create({
  infoBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: T.card, borderRadius: 12, padding: 12,
    marginBottom: 12, borderWidth: 1, borderColor: T.cardBorder,
  },
  infoIcon: { fontSize: 20 },
  infoText: { flex: 1, fontSize: 12, color: T.textSecondary, lineHeight: 16 },
  pointsBanner: {
    marginHorizontal: 8, marginBottom: 4,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8,
    backgroundColor: 'rgba(0, 212, 170, 0.08)',
    borderLeftWidth: 3, borderLeftColor: T.accent,
  },
  pointsBannerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pointsBadge: {
    backgroundColor: T.accent, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  pointsBadgeText: { fontSize: 10, fontWeight: '700', color: T.bg },
  pointsBannerText: { fontSize: 11, fontWeight: '600', color: T.textSecondary, flex: 1 },
  emptyWeek: { paddingHorizontal: 12, paddingVertical: 4 },
  emptyWeekText: { fontSize: 10, color: T.textMuted, fontStyle: 'italic' },
  ipinCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: T.card, borderRadius: 14, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: T.cardBorder,
  },
  ipinIcon: { fontSize: 22, marginTop: 2 },
  ipinText: { fontSize: 13, color: T.textSecondary, lineHeight: 18, marginBottom: 12 },
  ipinBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#5B5BD6', borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  ipinBtnText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
});

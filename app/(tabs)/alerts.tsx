import React, { useState, useMemo } from 'react';
import {
  ScrollView,
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppQuery } from '@/hooks/useAppQuery';
import { DEMO_MODE } from '@/config/demo';
import { apiPatchTournament } from '@/lib/api';
import { useDemoData } from '@/hooks/useDemoData';
import { CourtIcon } from '@/components/ui/court-icon';
import { fmtDate, calcDeadlines, getOnsiteDeadlines, getCircuit, deadlineInstant } from '@/utils/deadlines';
import type { StoredDeadlineKind } from '@/utils/deadlines';
import { useFirstVisit } from '@/hooks/useFirstVisit';
import { useTabSwipe } from '@/hooks/useTabSwipe';
import { ScreenWalkthrough } from '@/components/ui/screen-walkthrough';
import { TournamentDetail } from '@/app/(tabs)/tournaments';
import { AgentIcon } from '@/components/ui/agent-icon';
import { T } from '@/constants/theme';
import { useLanguage } from '@/hooks/useLanguage';
import { useRouter } from 'expo-router';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

import { countryFlag } from '@/utils/countryFlag';

type Urgency = 'urgent' | 'week' | 'upcoming';

type DeadlineKind = 'withdrawal' | 'signup' | 'freeze';

interface AlertItem {
  id: string;
  flag: string;
  tournament: string;
  tournamentId: string;
  kind: DeadlineKind;
  deadlineType: string; // localized display label
  surface: string;
  exactDate: string;
  urgency: Urgency;
  timeLabel: string;
  // Signed day/hour counts (negative = overdue) — the source of truth for
  // sorting. timeLabel ("3d ago") is display-only; parsing it with parseInt
  // loses the sign and makes overdue items sort as +3 days in the future.
  daysSigned: number;
  hoursSigned: number | null;
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

function daysUntil(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = parseLocalDate(dateStr);
  if (!target) return null;
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function hoursUntil(dateStr: string | undefined, category?: string, kind: StoredDeadlineKind = 'signUp'): number | null {
  if (!dateStr) return null;
  const target = parseLocalDate(dateStr);
  if (!target) return null;
  // Anchor the countdown to the deadline's real closing instant
  // (ITF 14:00 GMT, Challenger US ET) — not 14:00 device-local time.
  const iso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
  return Math.round((deadlineInstant(iso, category, kind).getTime() - Date.now()) / 3600000);
}

function buildAlerts(tournaments: any[], tr: (key: any) => string): AlertItem[] {
  const items: AlertItem[] = [];
  for (const t of tournaments) {
    if (t.isWithdrawn || t.isInMyList === false) continue;

    // Stored deadlines are authoritative (they may be user-overridden);
    // the formula only fills in missing values.
    const calc = t.startDate ? calcDeadlines(t.startDate, t.category) : null;
    const withdrawal = t.withdrawalDeadline || calc?.withdrawalDeadline;
    const signUp = t.signUpDeadline || calc?.signUpDeadline;
    const freeze = t.freezeDeadline || calc?.freezeDeadline;

    // For unregistered tournaments, suppress all alerts until sign-up is within 14 days
    if (!t.isRegistered && signUp) {
      const signUpDays = daysUntil(signUp);
      if (signUpDays !== null && signUpDays > 14) continue;
    }

    // Withdrawal alerts must mirror buildSpecs' eligibility in utils/notifications.ts:
    // only shown once the player is registered (wdOn && t.isRegistered && t.withdrawalDeadline).
    if (t.isRegistered && withdrawal) {
      const days = daysUntil(withdrawal);
      if (days !== null && days >= -7 && days <= 30) {
        const hours = hoursUntil(withdrawal, t.category, 'withdrawal');
        const urgency: Urgency = days < 0 ? 'urgent' : days === 0 ? 'urgent' : (hours !== null && hours < 48) ? 'urgent' : days <= 7 ? 'week' : 'upcoming';
        items.push({
          id: `${t.id}-withdrawal`,
          flag: t.country ? countryFlag(t.country) : '🌍',
          tournament: t.name,
          tournamentId: t.id,
          kind: 'withdrawal',
          deadlineType: tr('alerts.typeWithdrawal'),
          surface: t.surface ?? '',
          exactDate: withdrawal,
          urgency,
          timeLabel: days < 0 ? `${Math.abs(days)}d ago` : days === 0 ? 'today'
            : (hours !== null && hours > 0 && hours < 36) ? `${hours}h` : `${days}d`,
          daysSigned: days,
          hoursSigned: hours,
        });
      }
    }

    // Signup alerts must mirror buildSpecs' eligibility: only shown while the
    // player is NOT yet registered (singlesOn && !t.isRegistered && t.signUpDeadline).
    if (!t.isRegistered && signUp) {
      const days = daysUntil(signUp);
      if (days !== null && days >= -7 && days <= 14) {
        const hours = hoursUntil(signUp, t.category, 'signUp');
        const urgency: Urgency = days < 0 ? 'urgent' : days === 0 ? 'urgent' : (hours !== null && hours < 48) ? 'urgent' : days <= 7 ? 'week' : 'upcoming';
        items.push({
          id: `${t.id}-signup`,
          flag: t.country ? countryFlag(t.country) : '🌍',
          tournament: t.name,
          tournamentId: t.id,
          kind: 'signup',
          deadlineType: tr('alerts.typeSignup'),
          surface: t.surface ?? '',
          exactDate: signUp,
          urgency,
          timeLabel: days < 0 ? `${Math.abs(days)}d ago` : days === 0 ? 'today'
            : (hours !== null && hours > 0 && hours < 36) ? `${hours}h` : `${days}d`,
          daysSigned: days,
          hoursSigned: hours,
        });
      }
    }

    // Freeze alerts must mirror buildSpecs' eligibility: shown regardless of
    // registration status (fzOn && t.freezeDeadline — no isRegistered gate).
    if (freeze) {
      const days = daysUntil(freeze);
      if (days !== null && days >= -7 && days <= 14) {
        const hours = hoursUntil(freeze, t.category, 'freeze');
        const urgency: Urgency = days < 0 ? 'urgent' : days === 0 ? 'urgent' : (hours !== null && hours < 48) ? 'urgent' : days <= 7 ? 'week' : 'upcoming';
        items.push({
          id: `${t.id}-freeze`,
          flag: t.country ? countryFlag(t.country) : '🌍',
          tournament: t.name,
          tournamentId: t.id,
          kind: 'freeze',
          deadlineType: tr('alerts.typeFreeze'),
          surface: t.surface ?? '',
          exactDate: freeze,
          urgency,
          timeLabel: days < 0 ? `${Math.abs(days)}d ago` : days === 0 ? 'today'
            : (hours !== null && hours > 0 && hours < 36) ? `${hours}h` : `${days}d`,
          daysSigned: days,
          hoursSigned: hours,
        });
      }
    }
  }
  return items.sort((a, b) => a.exactDate.localeCompare(b.exactDate));
}

interface OnsiteAlertItem {
  id: string;
  flag: string;
  tournament: string;
  tournamentId: string;
  label: string;
  time: string;
  surface: string;
  dateStr: string;
}

function buildOnsiteAlerts(tournaments: any[]): OnsiteAlertItem[] {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const items: OnsiteAlertItem[] = [];
  for (const t of tournaments) {
    if (t.isWithdrawn || t.isInMyList === false) continue;
    if (!['challenger', 'itf'].includes(getCircuit(t.category))) continue;
    if (!t.startDate) continue;
    const onsiteDeadlines = getOnsiteDeadlines(t.startDate, t.category);
    for (const od of onsiteDeadlines) {
      if (od.dateStr !== todayStr) continue;
      items.push({
        id: `${t.id}-onsite-${od.label}`,
        flag: t.country ? countryFlag(t.country) : '🌍',
        tournament: t.name,
        tournamentId: t.id,
        label: od.label,
        time: od.time,
        surface: t.surface ?? '',
        dateStr: od.dateStr,
      });
    }
  }
  return items.sort((a, b) => a.time.localeCompare(b.time));
}

const TIME_COLOR: Record<Urgency, string> = { urgent: T.red, week: T.amber, upcoming: T.green };
const DOT_COLOR: Record<Urgency, string> = { urgent: T.red, week: T.amber, upcoming: T.green };
function getGroupLabels(t: (key: any) => string): { key: Urgency; label: string }[] {
  return [
    { key: 'urgent', label: t('alerts.urgent') },
    { key: 'week', label: t('alerts.week') },
    { key: 'upcoming', label: t('alerts.upcomingLabel') },
  ];
}
const URGENCY_ORDER: Record<Urgency, number> = { urgent: 0, week: 1, upcoming: 2 };

interface TournamentAlertGroup {
  tournamentId: string;
  name: string;
  flag: string;
  surface: string;
  section: Urgency;
  minDays: number;
  deadlines: AlertItem[];
}

function buildTournamentGroups(alerts: AlertItem[]): TournamentAlertGroup[] {
  const map = new Map<string, TournamentAlertGroup>();
  for (const alert of alerts) {
    // Use the real signed day count, not a re-parse of the display timeLabel
    // ("3d ago" parsed with parseInt gives +3, ranking an overdue deadline as
    // 3 days in the FUTURE instead of the most urgent item).
    const days = alert.daysSigned;
    if (!map.has(alert.tournamentId)) {
      map.set(alert.tournamentId, {
        tournamentId: alert.tournamentId,
        name: alert.tournament,
        flag: alert.flag,
        surface: alert.surface,
        section: alert.urgency,
        minDays: days,
        deadlines: [alert],
      });
    } else {
      const g = map.get(alert.tournamentId)!;
      g.deadlines.push(alert);
      if (URGENCY_ORDER[alert.urgency] < URGENCY_ORDER[g.section]) g.section = alert.urgency;
      if (days < g.minDays) g.minDays = days;
    }
  }
  for (const g of map.values()) {
    g.deadlines.sort((a, b) => {
      // Overdue (negative daysSigned) sorts first — most urgent first —
      // then by real day count, falling back to the exact date.
      if (a.daysSigned !== b.daysSigned) return a.daysSigned - b.daysSigned;
      return a.exactDate.localeCompare(b.exactDate);
    });
  }
  return Array.from(map.values()).sort((a, b) => {
    const sd = URGENCY_ORDER[a.section] - URGENCY_ORDER[b.section];
    return sd !== 0 ? sd : a.minDays - b.minDays;
  });
}

function TournamentDeadlineGroup({
  group,
  onPressItem,
  onViewTournament,
}: {
  group: TournamentAlertGroup;
  onPressItem: (item: AlertItem) => void;
  onViewTournament: (tournamentId: string) => void;
}) {
  return (
    <View style={s.tGroup}>
      <TouchableOpacity style={s.tGroupHeader} onPress={() => onViewTournament(group.tournamentId)} activeOpacity={0.7}>
        <View style={s.tGroupNameRow}>
          <Text style={s.tGroupName} numberOfLines={1}>{group.flag} {group.name}</Text>
          {group.surface ? <CourtIcon surface={group.surface} size="sm" /> : null}
        </View>
        <Text style={s.tGroupArrow}>›</Text>
      </TouchableOpacity>
      {group.deadlines.map((item, idx) => {
        const isPast = item.timeLabel.includes('ago');
        return (
          <View key={item.id}>
            <TouchableOpacity style={[s.deadlineRow, isPast && s.deadlineRowPast]} onPress={() => onPressItem(item)} activeOpacity={0.6}>
              <View style={[s.urgencyDot, { backgroundColor: isPast ? T.textMuted : DOT_COLOR[item.urgency] }]} />
              <Text style={[s.deadlineType, isPast && s.deadlineTypePast]}>{item.deadlineType}</Text>
              <Text style={[s.timeLabel, { color: isPast ? T.textMuted : TIME_COLOR[item.urgency] }]}>{item.timeLabel}</Text>
            </TouchableOpacity>
            {idx < group.deadlines.length - 1 && <View style={s.tGroupSep} />}
          </View>
        );
      })}
    </View>
  );
}

function AlertDetail({ item, onDismiss, onWithdraw, onViewTournament }: {
  item: AlertItem; onDismiss: () => void; onWithdraw?: () => void; onViewTournament: () => void;
}) {
  const { t } = useLanguage();
  return (
    <Modal transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={s.backdrop} onPress={onDismiss}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.sheetHandle} />
          <Text style={s.sheetFlag}>{item.flag}</Text>
          <Text style={s.sheetTournament}>{item.tournament}</Text>
          <View style={s.detailRows}>
            <View style={s.detailRow}>
              <Text style={s.detailLabel}>{t('alerts.deadline')}</Text>
              <Text style={s.detailValue}>{item.deadlineType}</Text>
            </View>
            <View style={s.detailSep} />
            <View style={s.detailRow}>
              <Text style={s.detailLabel}>{t('alerts.date')}</Text>
              <Text style={s.detailValue}>{fmtDate(item.exactDate)}</Text>
            </View>
            <View style={s.detailSep} />
            <View style={s.detailRow}>
              <Text style={s.detailLabel}>{t('alerts.surfaceLabel')}</Text>
              <Text style={s.detailValue}>{item.surface}</Text>
            </View>
          </View>
          <TouchableOpacity style={s.viewTournamentBtn} onPress={onViewTournament} activeOpacity={0.8}>
            <Text style={s.viewTournamentText}>{t('alerts.viewTournament')}</Text>
            <Text style={s.viewTournamentArrow}>›</Text>
          </TouchableOpacity>
          {item.kind === 'withdrawal' && onWithdraw && (
            <TouchableOpacity style={s.withdrawBtn} onPress={onWithdraw} activeOpacity={0.8}>
              <Text style={s.withdrawBtnText}>{t('alerts.withdrawAction')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.gotItBtn} onPress={onDismiss} activeOpacity={0.8}>
            <Text style={s.gotItText}>{t('alerts.gotIt')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function WithdrawConfirmModal({ item, onConfirm, onCancel, loading }: {
  item: AlertItem; onConfirm: () => void; onCancel: () => void; loading?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={s.dialogBackdrop} onPress={onCancel}>
        <Pressable style={s.dialog} onPress={() => {}}>
          <Text style={s.dialogTitle}>{t('alerts.withdrawConfirm')}</Text>
          <Text style={s.dialogBody}>
            {item.flag} {item.tournament} {t('alerts.withdrawWarning')}
          </Text>
          <View style={s.dialogActions}>
            <TouchableOpacity style={s.cancelBtn} onPress={onCancel} activeOpacity={0.7} disabled={loading}>
              <Text style={s.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.confirmWithdrawBtn} onPress={onConfirm} activeOpacity={0.8} disabled={loading}>
              {loading ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={s.confirmWithdrawText}>{t('alerts.withdrawAction')}</Text>}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function AlertsScreen() {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const { data, isLoading, error: queryError } = useAppQuery({ tournaments: {} });
  const { refreshing, onRefresh } = usePullToRefresh();
  const demoCtx = useDemoData();
  const [selected, setSelected] = useState<AlertItem | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pendingWithdraw, setPendingWithdraw] = useState<AlertItem | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const { isFirstVisit, markVisited } = useFirstVisit('alerts');
  const swipeHandlers = useTabSwipe();

  const tournaments = data?.tournaments ?? [];
  const onsiteAlerts = useMemo(() => buildOnsiteAlerts(tournaments), [tournaments]);
  const alerts = useMemo(() => buildAlerts(tournaments, t), [tournaments, t]);
  const tournamentGroups = useMemo(() => buildTournamentGroups(alerts), [alerts]);

  const groupLabels = useMemo(() => getGroupLabels(t), [t]);
  const sections = useMemo(() => {
    const result: { key: Urgency; label: string; groups: TournamentAlertGroup[] }[] = [];
    for (const g of tournamentGroups) {
      const last = result[result.length - 1];
      if (!last || last.key !== g.section) {
        result.push({
          key: g.section,
          label: groupLabels.find(l => l.key === g.section)?.label ?? g.section.toUpperCase(),
          groups: [g],
        });
      } else {
        last.groups.push(g);
      }
    }
    return result;
  }, [tournamentGroups, groupLabels]);

  async function handleWithdrawConfirm() {
    if (!pendingWithdraw || withdrawing) return;
    setWithdrawing(true);
    try {
      if (DEMO_MODE) {
        demoCtx?.patchTournament(pendingWithdraw.tournamentId, { isWithdrawn: true });
      } else {
        await apiPatchTournament(pendingWithdraw.tournamentId, { isWithdrawn: true });
      }
      setPendingWithdraw(null);
    } catch (e: any) {
      Alert.alert(t('common.couldNotWithdraw'), e?.message ?? t('common.tryAgain'));
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.textSecondary} />}
        {...swipeHandlers}>

        <View style={s.topBar}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              onPress={() => router.push('/settings' as any)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={t('settings.title')}
            >
              <AgentIcon size={70} />
            </TouchableOpacity>
            <Text style={s.topTitle}>{t('alerts.title')}</Text>
          </View>
        </View>

        {onsiteAlerts.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>{t('alerts.todayOnSite')}</Text>
            {onsiteAlerts.map(item => (
              <View key={item.id} style={s.tGroup}>
                <TouchableOpacity style={s.tGroupHeader} onPress={() => setDetailId(item.tournamentId)} activeOpacity={0.7}>
                  <View style={s.tGroupNameRow}>
                    <Text style={{ fontSize: 16 }}>🎾</Text>
                    <Text style={s.tGroupName}>{item.flag} {item.tournament}</Text>
                  </View>
                  <Text style={s.tGroupArrow}>›</Text>
                </TouchableOpacity>
                <View style={s.deadlineRow}>
                  <View style={[s.urgencyDot, { backgroundColor: T.amber }]} />
                  <Text style={s.deadlineType}>{item.label}</Text>
                  <Text style={[s.timeLabel, { color: T.amber }]}>{item.time}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {isLoading ? (
          <ActivityIndicator color={T.accent} style={{ marginTop: 48 }} />
        ) : queryError && tournaments.length === 0 ? (
          <View style={s.errorBanner}>
            <Text style={s.errorBannerText}>
              {lang === 'es'
                ? 'No se pudieron cargar tus alertas. Revisa tu conexión e inténtalo de nuevo.'
                : 'Could not load your alerts. Check your connection and try again.'}
            </Text>
            <TouchableOpacity style={s.errorBannerBtn} activeOpacity={0.8} onPress={onRefresh}>
              <Text style={s.errorBannerBtnText}>{t('common.tryAgain')}</Text>
            </TouchableOpacity>
          </View>
        ) : sections.length === 0 && onsiteAlerts.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>📅</Text>
            <Text style={s.emptyText}>{t('alerts.noUpcomingDeadlines')}</Text>
          </View>
        ) : (
          sections.map(({ key, label, groups }) => (
            <View key={key} style={s.section}>
              <Text style={s.sectionLabel}>{label}</Text>
              {groups.map((group) => (
                <TournamentDeadlineGroup
                  key={group.tournamentId}
                  group={group}
                  onPressItem={setSelected}
                  onViewTournament={setDetailId}
                />
              ))}
            </View>
          ))
        )}

      </ScrollView>

      {selected && (
        <AlertDetail
          item={selected}
          onDismiss={() => setSelected(null)}
          onWithdraw={selected.kind === 'withdrawal' ? () => { setSelected(null); setPendingWithdraw(selected); } : undefined}
          onViewTournament={() => { const id = selected.tournamentId; setSelected(null); setDetailId(id); }}
        />
      )}

      {detailId && (
        <TournamentDetail tournamentId={detailId} onClose={() => setDetailId(null)} />
      )}

      {pendingWithdraw && (
        <WithdrawConfirmModal
          item={pendingWithdraw}
          onConfirm={handleWithdrawConfirm}
          onCancel={() => setPendingWithdraw(null)}
          loading={withdrawing}
        />
      )}
      <ScreenWalkthrough
        steps={[
          { icon: '🔔', title: t('walkthrough.alerts.tapAny.title'), body: t('walkthrough.alerts.tapAny.body') },
        ]}
        visible={isFirstVisit}
        onDismiss={markVisited}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 32 },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16, paddingBottom: 24 },
  topTitle: { fontSize: 18, fontWeight: '700', color: T.textPrimary },
  avatarBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: T.card, borderWidth: 1.5, borderColor: T.accent, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 13, fontWeight: '700', color: T.accent },

  sectionLabel: { fontSize: 11, fontWeight: '600', color: T.textSecondary, letterSpacing: 1, marginBottom: 8, marginTop: 16, textTransform: 'uppercase' },
  section: { marginBottom: 8 },

  tGroup: { backgroundColor: T.card, borderRadius: 12, marginBottom: 8, overflow: 'hidden' },
  tGroupHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: T.cardBorder,
  },
  tGroupNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  tGroupArrow: { fontSize: 20, color: T.accent, fontWeight: '300' },
  tGroupName: { fontSize: 14, fontWeight: '600', color: T.textPrimary, flexShrink: 1 },

  deadlineRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 12, gap: 12 },
  deadlineRowPast: { opacity: 0.45 },
  urgencyDot: { width: 10, height: 10, borderRadius: 5 },
  deadlineType: { fontSize: 12, color: T.textSecondary, flex: 1 },
  deadlineTypePast: { textDecorationLine: 'line-through' as const },
  tGroupSep: { height: 1, backgroundColor: T.cardBorder, marginLeft: 40 },

  timeLabel: { fontSize: 12, fontWeight: '700', flexShrink: 0 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 120, gap: 32 },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontSize: 16, color: T.textSecondary, fontWeight: '400' },
  errorBanner: { backgroundColor: T.red, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginTop: 24, marginHorizontal: 16, alignItems: 'center' },
  errorBannerText: { fontSize: 13, fontWeight: '600', color: '#FFF', textAlign: 'center' },
  errorBannerBtn: { marginTop: 10, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16 },
  errorBannerBtnText: { fontSize: 13, fontWeight: '700', color: '#FFF' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingBottom: 48, paddingTop: 24, alignItems: 'center' },
  sheetHandle: { width: 32, height: 4, borderRadius: 2, backgroundColor: T.cardBorder, marginBottom: 24 },
  sheetFlag: { fontSize: 48, marginBottom: 8 },
  sheetTournament: { fontSize: 22, fontWeight: '700', color: T.textPrimary, marginBottom: 24, textAlign: 'center' },

  detailRows: { width: '100%', backgroundColor: T.bg, borderRadius: 12, marginBottom: 12, overflow: 'hidden' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14 },
  detailSep: { height: 1, backgroundColor: T.cardBorder, marginHorizontal: 16 },
  detailLabel: { fontSize: 13, color: T.textTertiary, fontWeight: '400' },
  detailValue: { fontSize: 13, color: T.textPrimary, fontWeight: '600' },

  viewTournamentBtn: {
    width: '100%', backgroundColor: T.card, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14,
    marginBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: T.cardBorder, minHeight: 40,
  },
  viewTournamentText: { color: T.accent, fontSize: 16, fontWeight: '600' },
  viewTournamentArrow: { color: T.accent, fontSize: 22, fontWeight: '300' },

  withdrawBtn: { width: '100%', backgroundColor: T.red, borderRadius: 16, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  withdrawBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  gotItBtn: { width: '100%', backgroundColor: T.accent, borderRadius: 16, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  gotItText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  dialogBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  dialog: { backgroundColor: T.card, borderRadius: 16, padding: 24, width: '100%' },
  dialogTitle: { fontSize: 16, fontWeight: '700', color: T.textPrimary, marginBottom: 8, textAlign: 'center' },
  dialogBody: { fontSize: 13, color: T.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  dialogActions: { flexDirection: 'row', gap: 8 },
  cancelBtn: { flex: 1, backgroundColor: T.cardBorder, borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 16, fontWeight: '600', color: T.textSecondary },
  confirmWithdrawBtn: { flex: 1, backgroundColor: T.red, borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  confirmWithdrawText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});

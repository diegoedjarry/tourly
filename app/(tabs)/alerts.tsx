import React, { useState, useMemo } from 'react';
import {
  ScrollView,
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppQuery } from '@/hooks/useAppQuery';
import { DEMO_MODE } from '@/config/demo';
import { apiPatchTournament } from '@/lib/api';
import { useDemoData } from '@/hooks/useDemoData';
import { CourtIcon } from '@/components/ui/court-icon';
import { fmtDate, calcDeadlines, getOnsiteDeadlines, getCircuit } from '@/utils/deadlines';
import { useFirstVisit } from '@/hooks/useFirstVisit';
import { useTabSwipe } from '@/hooks/useTabSwipe';
import { ScreenWalkthrough } from '@/components/ui/screen-walkthrough';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { TournamentDetail } from '@/app/(tabs)/tournaments';
import { AgentIcon } from '@/components/ui/agent-icon';
import { T } from '@/constants/theme';
import { useLanguage } from '@/hooks/useLanguage';

const ALERTS_WALKTHROUGH = [
  { icon: '🔔', title: 'Deadline alerts', body: 'See all upcoming ITF & ATP Tour deadlines grouped by urgency — urgent (red), this week (amber), and upcoming (green).' },
  { icon: '✍️', title: 'Quick actions', body: 'Tap any alert to see details. For withdrawal deadlines, you can mark a tournament as withdrawn right from here.' },
];

type Urgency = 'urgent' | 'week' | 'upcoming';

interface AlertItem {
  id: string;
  flag: string;
  tournament: string;
  tournamentId: string;
  deadlineType: string;
  surface: string;
  exactDate: string;
  urgency: Urgency;
  timeLabel: string;
}

function countryFlag(country: string): string {
  const code = (country ?? '').toUpperCase();
  if (code.length !== 2) return '🌍';
  return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
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

function hoursUntil(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const target = parseLocalDate(dateStr);
  if (!target) return null;
  target.setHours(14, 0, 0, 0);
  return Math.round((target.getTime() - Date.now()) / 3600000);
}

function buildAlerts(tournaments: any[]): AlertItem[] {
  const items: AlertItem[] = [];
  for (const t of tournaments) {
    if (t.isWithdrawn) continue;

    const calc = t.startDate ? calcDeadlines(t.startDate, t.category) : null;
    const withdrawal = calc?.withdrawalDeadline ?? t.withdrawalDeadline;
    const signUp = calc?.signUpDeadline ?? t.signUpDeadline;
    const freeze = calc?.freezeDeadline ?? t.freezeDeadline;

    if (withdrawal) {
      const days = daysUntil(withdrawal);
      if (days !== null && days >= -7 && days <= 30) {
        const hours = hoursUntil(withdrawal);
        const urgency: Urgency = days < 0 ? 'urgent' : days === 0 ? 'urgent' : days <= 7 ? 'week' : 'upcoming';
        items.push({
          id: `${t.id}-withdrawal`,
          flag: t.country ? countryFlag(t.country) : '🌍',
          tournament: t.name,
          tournamentId: t.id,
          deadlineType: 'Withdrawal',
          surface: t.surface ?? '',
          exactDate: withdrawal,
          urgency,
          timeLabel: days < 0 ? `${Math.abs(days)}d ago` : days === 0 ? 'today'
            : (hours !== null && hours > 0 && hours < 36) ? `${hours}h` : `${days}d`,
        });
      }
    }

    if (!t.isRegistered && signUp) {
      const days = daysUntil(signUp);
      if (days !== null && days >= -7 && days <= 30) {
        const hours = hoursUntil(signUp);
        const urgency: Urgency = days < 0 ? 'urgent' : days === 0 ? 'urgent' : days <= 7 ? 'week' : 'upcoming';
        items.push({
          id: `${t.id}-signup`,
          flag: t.country ? countryFlag(t.country) : '🌍',
          tournament: t.name,
          tournamentId: t.id,
          deadlineType: 'Sign up',
          surface: t.surface ?? '',
          exactDate: signUp,
          urgency,
          timeLabel: days < 0 ? `${Math.abs(days)}d ago` : days === 0 ? 'today'
            : (hours !== null && hours > 0 && hours < 36) ? `${hours}h` : `${days}d`,
        });
      }
    }

    if (freeze) {
      const days = daysUntil(freeze);
      if (days !== null && days >= -7 && days <= 14) {
        const hours = hoursUntil(freeze);
        const urgency: Urgency = days < 0 ? 'urgent' : days === 0 ? 'urgent' : days <= 7 ? 'week' : 'upcoming';
        items.push({
          id: `${t.id}-freeze`,
          flag: t.country ? countryFlag(t.country) : '🌍',
          tournament: t.name,
          tournamentId: t.id,
          deadlineType: 'Doubles entry',
          surface: t.surface ?? '',
          exactDate: freeze,
          urgency,
          timeLabel: days < 0 ? `${Math.abs(days)}d ago` : days === 0 ? 'today'
            : (hours !== null && hours > 0 && hours < 36) ? `${hours}h` : `${days}d`,
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
    if (t.isWithdrawn) continue;
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
    const days = alert.timeLabel === 'today' ? 0 : (parseInt(alert.timeLabel, 10) || 999);
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
      const aPast = a.timeLabel.includes('ago') ? 1 : 0;
      const bPast = b.timeLabel.includes('ago') ? 1 : 0;
      if (aPast !== bPast) return aPast - bPast;
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
          {item.deadlineType === 'Withdrawal' && onWithdraw && (
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
  const { t } = useLanguage();
  const { data, isLoading } = useAppQuery({ tournaments: {} });
  const demoCtx = useDemoData();
  const [selected, setSelected] = useState<AlertItem | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pendingWithdraw, setPendingWithdraw] = useState<AlertItem | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const { isFirstVisit, markVisited } = useFirstVisit('alerts');
  const swipeHandlers = useTabSwipe();

  const tournaments = data?.tournaments ?? [];
  const onsiteAlerts = useMemo(() => buildOnsiteAlerts(tournaments), [tournaments]);
  const alerts = useMemo(() => buildAlerts(tournaments), [tournaments]);
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
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false} {...swipeHandlers}>

        <View style={s.topBar}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <AgentIcon size={70} />
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
          onWithdraw={selected.deadlineType === 'Withdrawal' ? () => { setSelected(null); setPendingWithdraw(selected); } : undefined}
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
      <ScreenWalkthrough steps={ALERTS_WALKTHROUGH} visible={isFirstVisit} onDismiss={markVisited} />
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
  emptyText: { fontSize: 16, color: T.textTertiary, fontWeight: '400' },

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

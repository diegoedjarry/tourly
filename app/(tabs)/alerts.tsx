import React, { useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppQuery } from '@/hooks/useAppQuery';
import { DEMO_MODE } from '@/config/demo';
import { apiPatchTournament } from '@/lib/api';
import { useDemoData } from '@/hooks/useDemoData';
import { CourtIcon } from '@/components/ui/court-icon';
import { fmtDate } from '@/utils/deadlines';

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
  const map: Record<string, string> = {
    BR: '🇧🇷', AR: '🇦🇷', US: '🇺🇸', ES: '🇪🇸', AU: '🇦🇺', FR: '🇫🇷',
    GB: '🇬🇧', DE: '🇩🇪', IT: '🇮🇹', CL: '🇨🇱', MX: '🇲🇽', PT: '🇵🇹',
  };
  return map[(country ?? '').toUpperCase()] ?? '🌍';
}

function daysUntil(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function buildAlerts(tournaments: any[]): AlertItem[] {
  const items: AlertItem[] = [];
  for (const t of tournaments) {
    if (t.isWithdrawn) continue;

    if (t.withdrawalDeadline) {
      const days = daysUntil(t.withdrawalDeadline);
      if (days !== null && days >= 0 && days <= 30) {
        const urgency: Urgency = days === 0 ? 'urgent' : days <= 7 ? 'week' : 'upcoming';
        items.push({
          id: `${t.id}-withdrawal`,
          flag: t.country ? countryFlag(t.country) : '🌍',
          tournament: t.name,
          tournamentId: t.id,
          deadlineType: 'Withdrawal',
          surface: t.surface ?? '',
          exactDate: t.withdrawalDeadline,
          urgency,
          timeLabel: days === 0 ? 'today' : `${days}d`,
        });
      }
    }

    if (!t.isRegistered && t.signUpDeadline) {
      const days = daysUntil(t.signUpDeadline);
      if (days !== null && days >= 0 && days <= 30) {
        const urgency: Urgency = days === 0 ? 'urgent' : days <= 7 ? 'week' : 'upcoming';
        items.push({
          id: `${t.id}-signup`,
          flag: t.country ? countryFlag(t.country) : '🌍',
          tournament: t.name,
          tournamentId: t.id,
          deadlineType: 'Sign up',
          surface: t.surface ?? '',
          exactDate: t.signUpDeadline,
          urgency,
          timeLabel: days === 0 ? 'today' : `${days}d`,
        });
      }
    }

    if (t.freezeDeadline) {
      const days = daysUntil(t.freezeDeadline);
      if (days !== null && days >= 0 && days <= 14) {
        const urgency: Urgency = days === 0 ? 'urgent' : days <= 7 ? 'week' : 'upcoming';
        items.push({
          id: `${t.id}-freeze`,
          flag: t.country ? countryFlag(t.country) : '🌍',
          tournament: t.name,
          tournamentId: t.id,
          deadlineType: 'Freeze / doubles entry',
          surface: t.surface ?? '',
          exactDate: t.freezeDeadline,
          urgency,
          timeLabel: days === 0 ? 'today' : `${days}d`,
        });
      }
    }
  }
  return items.sort((a, b) => a.exactDate.localeCompare(b.exactDate));
}

const TIME_COLOR: Record<Urgency, string> = { urgent: '#E24B4A', week: '#EF9F27', upcoming: '#2D9E6B' };
const GROUP_LABELS: { key: Urgency; label: string }[] = [
  { key: 'urgent', label: 'URGENT' },
  { key: 'week', label: 'THIS WEEK' },
  { key: 'upcoming', label: 'UPCOMING' },
];
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
      const uo = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
      return uo !== 0 ? uo : a.exactDate.localeCompare(b.exactDate);
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
}: {
  group: TournamentAlertGroup;
  onPressItem: (item: AlertItem) => void;
}) {
  return (
    <View style={styles.tGroup}>
      <View style={styles.tGroupHeader}>
        <View style={styles.tGroupNameRow}>
          <Text style={styles.tGroupName} numberOfLines={1}>{group.flag} {group.name}</Text>
          {group.surface ? <CourtIcon surface={group.surface} size="sm" /> : null}
        </View>
      </View>
      {group.deadlines.map((item, idx) => (
        <View key={item.id}>
          <TouchableOpacity style={styles.deadlineRow} onPress={() => onPressItem(item)} activeOpacity={0.6}>
            <Text style={styles.deadlineType}>{item.deadlineType}</Text>
            <Text style={[styles.timeLabel, { color: TIME_COLOR[item.urgency] }]}>{item.timeLabel}</Text>
          </TouchableOpacity>
          {idx < group.deadlines.length - 1 && <View style={styles.tGroupSep} />}
        </View>
      ))}
    </View>
  );
}

function AlertDetail({ item, onDismiss, onWithdraw }: {
  item: AlertItem; onDismiss: () => void; onWithdraw?: () => void;
}) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetFlag}>{item.flag}</Text>
          <Text style={styles.sheetTournament}>{item.tournament}</Text>
          <View style={styles.detailRows}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>deadline</Text>
              <Text style={styles.detailValue}>{item.deadlineType}</Text>
            </View>
            <View style={styles.detailSep} />
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>date</Text>
              <Text style={styles.detailValue}>{fmtDate(item.exactDate)}</Text>
            </View>
            <View style={styles.detailSep} />
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>surface</Text>
              <Text style={styles.detailValue}>{item.surface}</Text>
            </View>
          </View>
          {item.deadlineType === 'withdrawal' && onWithdraw && (
            <TouchableOpacity style={styles.withdrawBtn} onPress={onWithdraw} activeOpacity={0.8}>
              <Text style={styles.withdrawBtnText}>withdraw</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.gotItBtn} onPress={onDismiss} activeOpacity={0.8}>
            <Text style={styles.gotItText}>got it</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function WithdrawConfirmModal({ item, onConfirm, onCancel }: {
  item: AlertItem; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.dialogBackdrop} onPress={onCancel}>
        <Pressable style={styles.dialog} onPress={() => {}}>
          <Text style={styles.dialogTitle}>Withdraw from this tournament?</Text>
          <Text style={styles.dialogBody}>
            {item.flag} {item.tournament} will be removed from your list. This cannot be undone.
          </Text>
          <View style={styles.dialogActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.7}>
              <Text style={styles.cancelText}>cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmWithdrawBtn} onPress={onConfirm} activeOpacity={0.8}>
              <Text style={styles.confirmWithdrawText}>withdraw</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function AlertsScreen() {
  const { data, isLoading } = useAppQuery({ tournaments: {} });
  const demoCtx = useDemoData();
  const [selected, setSelected] = useState<AlertItem | null>(null);
  const [pendingWithdraw, setPendingWithdraw] = useState<AlertItem | null>(null);

  const alerts = buildAlerts(data?.tournaments ?? []);
  const tournamentGroups = buildTournamentGroups(alerts);

  // Urgency sections; each contains one or more tournament groups
  const sections: { key: Urgency; label: string; groups: TournamentAlertGroup[] }[] = [];
  for (const g of tournamentGroups) {
    const last = sections[sections.length - 1];
    if (!last || last.key !== g.section) {
      sections.push({
        key: g.section,
        label: GROUP_LABELS.find(l => l.key === g.section)?.label ?? g.section.toUpperCase(),
        groups: [g],
      });
    } else {
      last.groups.push(g);
    }
  }

  async function handleWithdrawConfirm() {
    if (!pendingWithdraw) return;
    if (DEMO_MODE) {
      demoCtx?.patchTournament(pendingWithdraw.tournamentId, { isWithdrawn: true });
    } else {
      await apiPatchTournament(pendingWithdraw.tournamentId, { isWithdrawn: true });
    }
    setPendingWithdraw(null);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        <View style={styles.topBar}>
          <Text style={styles.topTitle}>Alerts</Text>
        </View>

        {isLoading ? (
          <ActivityIndicator color="#5B5BD6" style={{ marginTop: 40 }} />
        ) : sections.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📅</Text>
            <Text style={styles.emptyText}>no upcoming deadlines</Text>
          </View>
        ) : (
          sections.map(({ key, label, groups }) => (
            <View key={key} style={styles.section}>
              <Text style={styles.sectionLabel}>{label}</Text>
              {groups.map((group) => (
                <TournamentDeadlineGroup
                  key={group.tournamentId}
                  group={group}
                  onPressItem={setSelected}
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
          onWithdraw={selected.deadlineType === 'withdrawal' ? () => { setSelected(null); setPendingWithdraw(selected); } : undefined}
        />
      )}

      {pendingWithdraw && (
        <WithdrawConfirmModal
          item={pendingWithdraw}
          onConfirm={handleWithdrawConfirm}
          onCancel={() => setPendingWithdraw(null)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAFAFA' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 32 },
  topBar: { paddingTop: 18, paddingBottom: 20 },
  topTitle: { fontSize: 20, fontWeight: '700', color: '#2D2B55' },
  sectionLabel: { fontSize: 11, fontWeight: '600', color: '#AAAAAA', letterSpacing: 0.8, marginBottom: 8, marginTop: 4 },
  section: { marginBottom: 8 },
  // Tournament deadline group card
  tGroup: { backgroundColor: '#FFFFFF', borderRadius: 14, marginBottom: 10, overflow: 'hidden' },
  tGroupHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  tGroupNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tGroupName: { fontSize: 14, fontWeight: '700', color: '#2D2B55', flexShrink: 1 },
  deadlineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, gap: 12 },
  deadlineType: { fontSize: 13, color: '#666666', flex: 1 },
  tGroupSep: { height: 1, backgroundColor: '#F0F0F0', marginLeft: 36 },

  timeLabel: { fontSize: 13, fontWeight: '700', flexShrink: 0 },
  separator: { height: 1, backgroundColor: '#F0F0F0', marginLeft: 36 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 120, gap: 10 },
  emptyIcon: { fontSize: 32 },
  emptyText: { fontSize: 14, color: '#AAAAAA', fontWeight: '500' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingBottom: 40, paddingTop: 16, alignItems: 'center' },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#DDDDDD', marginBottom: 24 },
  sheetFlag: { fontSize: 36, marginBottom: 8 },
  sheetTournament: { fontSize: 20, fontWeight: '700', color: '#2D2B55', marginBottom: 24, textAlign: 'center' },
  detailRows: { width: '100%', backgroundColor: '#F8F8FB', borderRadius: 14, marginBottom: 16, overflow: 'hidden' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 },
  detailSep: { height: 1, backgroundColor: '#EEEEEE', marginHorizontal: 16 },
  detailLabel: { fontSize: 14, color: '#AAAAAA', fontWeight: '500' },
  detailValue: { fontSize: 14, color: '#2D2B55', fontWeight: '600' },
  withdrawBtn: { width: '100%', backgroundColor: '#E24B4A', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  withdrawBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  gotItBtn: { width: '100%', backgroundColor: '#5B5BD6', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  gotItText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  dialogBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 },
  dialog: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24, width: '100%' },
  dialogTitle: { fontSize: 17, fontWeight: '700', color: '#2D2B55', marginBottom: 10, textAlign: 'center' },
  dialogBody: { fontSize: 14, color: '#777777', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  dialogActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, backgroundColor: '#F0F0F8', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: '#666666' },
  confirmWithdrawBtn: { flex: 1, backgroundColor: '#E24B4A', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmWithdrawText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
});

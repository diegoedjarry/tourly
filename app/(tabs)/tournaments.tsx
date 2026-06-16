import React, { useState, useEffect } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { db } from '@/db';
import { useAppQuery } from '@/hooks/useAppQuery';
import { id } from '@instantdb/react-native';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { CourtIcon } from '@/components/ui/court-icon';
import { calcDeadlines, fmtDeadline, fmtDate, fmtDateRange } from '@/utils/deadlines';
import { DEMO_MODE } from '@/config/demo';
import { useDemoData } from '@/hooks/useDemoData';

// ─── Types & constants ────────────────────────────────────────────────────────

type Surface = 'clay' | 'hard' | 'grass';
type Filter  = 'all' | 'active' | 'upcoming' | 'past' | 'withdrawn';

const SURFACE_BG:   Record<string, string> = { clay: '#FAEEDA', hard: '#E6F1FB', grass: '#EAF3DE' };
const SURFACE_TEXT: Record<string, string> = { clay: '#854F0B', hard: '#185FA5', grass: '#3B6D11' };

const COUNTRY_NAME: Record<string, string> = {
  AR: 'Argentina', AU: 'Australia', BR: 'Brazil',  CL: 'Chile',
  DE: 'Germany',   ES: 'Spain',     FR: 'France',  GB: 'United Kingdom',
  IT: 'Italy',     MX: 'Mexico',    PT: 'Portugal', US: 'United States',
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'withdrawn', label: 'Withdrawn' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Parse "YYYY-MM-DD" as local midnight (not UTC) to avoid timezone off-by-one day.
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

function getGroup(t: any): 'active' | 'upcoming' | 'past' {
  const now   = new Date();
  const start = parseLocalDate(t.startDate);
  const end   = parseLocalDate(t.endDate);
  if (end) { end.setHours(23, 59, 59, 999); }
  if (end && now > end) return 'past';
  if (start && now >= start) return 'active';
  // Missed sign-up deadline without registering → treat as past
  if (!t.isRegistered && t.signUpDeadline) {
    const signUp = parseLocalDate(t.signUpDeadline);
    if (signUp) { signUp.setHours(23, 59, 59, 999); }
    if (signUp && now > signUp) return 'past';
  }
  return 'upcoming';
}

function getPill(t: any): { type: string; label: string } | null {
  if (getGroup(t) === 'past') return null;
  if (getGroup(t) === 'active' && t.isRegistered) return null;
  if (!t.isRegistered) {
    const days = daysUntil(t.signUpDeadline);
    if (days === null) return { type: 'signup', label: 'sign up' };
    if (days < 0) return null;
    return { type: 'signup', label: `sign up ${days}d` };
  }
  const wd = daysUntil(t.withdrawalDeadline);
  if (wd !== null && wd <= 0) return { type: 'withdraw', label: 'withdrawal today' };
  return null;
}

function calcEndDate(startDateStr: string): string {
  const [y, m, d] = startDateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + 6);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function deadlineColor(dateStr: string | undefined): string {
  const d = daysUntil(dateStr);
  if (d === null) return '#CCCCCC';
  if (d <= 0) return '#E24B4A';
  if (d <= 7) return '#EF9F27';
  return '#999999';
}

function deadlineLabel(dateStr: string | undefined): string {
  const d = daysUntil(dateStr);
  if (d === null) return '—';
  if (d < 0) return `${Math.abs(d)}d ago`;
  if (d === 0) return 'today';
  return `in ${d}d`;
}

function countryFlag(country: string): string {
  const map: Record<string, string> = {
    BR: '🇧🇷', AR: '🇦🇷', US: '🇺🇸', ES: '🇪🇸', AU: '🇦🇺', FR: '🇫🇷',
    GB: '🇬🇧', DE: '🇩🇪', IT: '🇮🇹', CL: '🇨🇱', MX: '🇲🇽', PT: '🇵🇹',
  };
  return map[(country ?? '').toUpperCase()] ?? '🌍';
}

function fmt(n: number) {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0 });
}

// ─── Tournament card (list) ───────────────────────────────────────────────────

function TournamentCard({ item, onPress }: { item: any; onPress: () => void }) {
  const dateRange = fmtDateRange(item.startDate, item.endDate);
  const pill      = getPill(item);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.cardTopRow}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.country ? countryFlag(item.country) + ' ' : ''}{item.name}
        </Text>
        {getGroup(item) === 'past' ? (
          item.isRegistered
            ? <View style={styles.playedBadge}><Text style={styles.playedText}>Played</Text></View>
            : null
        ) : (
          item.isRegistered
            ? <View style={styles.registeredBadge}><Text style={styles.registeredText}>Registered</Text></View>
            : <View style={styles.notRegisteredBadge}><Text style={styles.notRegisteredText}>Not registered</Text></View>
        )}
      </View>
      <View style={styles.cardMetaRow}>
        <Text style={styles.cardMeta}>{dateRange}</Text>
        {item.surface && <CourtIcon surface={item.surface} />}
      </View>
      {pill && (
        <View style={styles.pillRow}>
          <View style={[styles.pill, pill.type === 'signup' ? styles.pillAmber : styles.pillRed]}>
            <Text style={styles.pillText}>{pill.label}</Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Withdraw confirmation dialog ─────────────────────────────────────────────

function WithdrawDialog({ name, undoing, onConfirm, onCancel }: {
  name: string; undoing?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.dialogBackdrop} onPress={onCancel}>
        <Pressable style={styles.dialog} onPress={() => {}}>
          <Text style={styles.dialogTitle}>
            {undoing ? 'Undo withdrawal?' : 'Withdraw from this tournament?'}
          </Text>
          <Text style={styles.dialogBody}>
            {undoing
              ? `You will be marked as not withdrawn from ${name}.`
              : `You will be marked as withdrawn from ${name}.`}
          </Text>
          <View style={styles.dialogActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.7}>
              <Text style={styles.cancelBtnText}>cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.withdrawConfirmBtn, undoing && { backgroundColor: '#5B5BD6' }]}
              onPress={onConfirm} activeOpacity={0.8}>
              <Text style={styles.withdrawConfirmText}>{undoing ? 'undo' : 'withdraw'}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function formatDateRange(start: string | undefined, end: string | undefined): string {
  return fmtDateRange(start, end);
}

// ─── Shared form constants ────────────────────────────────────────────────────

const SURFACES   = ['clay', 'hard', 'grass'];
const CATEGORIES = ['M15', 'M25', 'M100', 'ATP 250', 'ATP 500', 'ATP 1000', 'Grand Slam'];
const COUNTRIES  = [
  { code: 'AR', name: 'Argentina' }, { code: 'AU', name: 'Australia' }, { code: 'BR', name: 'Brazil' },
  { code: 'CL', name: 'Chile' },     { code: 'FR', name: 'France' },    { code: 'DE', name: 'Germany' },
  { code: 'IT', name: 'Italy' },     { code: 'MX', name: 'Mexico' },    { code: 'PT', name: 'Portugal' },
  { code: 'ES', name: 'Spain' },     { code: 'GB', name: 'United Kingdom' }, { code: 'US', name: 'United States' },
];

// ─── Tournament detail screen ─────────────────────────────────────────────────

interface EditState {
  name: string; country: string; city: string; surface: string; category: string;
  startDate: string; endDate: string; signUpDeadline: string; withdrawalDeadline: string;
  freezeDeadline: string;
}

export function TournamentDetail({ tournamentId, onClose }: { tournamentId: string; onClose: () => void }) {
  const { data } = useAppQuery({ tournaments: {} });

  const t = (data?.tournaments ?? []).find((x: any) => x.id === tournamentId);

  const [showWithdraw,    setShowWithdraw]    = useState(false);
  const [undoingWithdraw, setUndoingWithdraw] = useState(false);
  const [savingAction,    setSavingAction]    = useState<string | null>(null);
  const [editing,         setEditing]         = useState(false);
  const [editState,       setEditState]       = useState<EditState | null>(null);
  const [editOverrides,   setEditOverrides]   = useState({ signUp: false, withdrawal: false, freeze: false });
  const [saving,          setSaving]          = useState(false);
  const [editError,       setEditError]       = useState('');
  const demoCtx = useDemoData();

  if (!t) { onClose(); return null; }

  const surfaceBg   = SURFACE_BG[(editing ? editState?.surface : t.surface) as Surface]   ?? '#FAEEDA';
  const surfaceText = SURFACE_TEXT[(editing ? editState?.surface : t.surface) as Surface]  ?? '#854F0B';
  const group       = getGroup(t);
  const metaLine    = [formatDateRange(t.startDate, t.endDate), COUNTRY_NAME[t.country?.toUpperCase()] ?? t.country]
    .filter(Boolean).join('  ·  ');

  function startEdit() {
    const start = t.startDate ?? '';
    const calc  = start ? calcDeadlines(start) : null;
    setEditState({
      name: t.name ?? '',
      country: t.country ?? 'US',
      city: t.city ?? '',
      surface: t.surface ?? 'clay',
      category: t.category ?? 'M25',
      startDate: start,
      endDate: t.endDate ?? '',
      signUpDeadline:     t.signUpDeadline     ?? calc?.signUpDeadline     ?? '',
      withdrawalDeadline: t.withdrawalDeadline ?? calc?.withdrawalDeadline ?? '',
      freezeDeadline:     t.freezeDeadline     ?? calc?.freezeDeadline     ?? '',
    });
    setEditOverrides({ signUp: false, withdrawal: false, freeze: false });
    setEditError('');
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditState(null);
    setEditError('');
  }

  function setEF(key: keyof EditState, value: string) {
    if (key === 'startDate' && value) {
      const calc = calcDeadlines(value);
      setEditState(prev => !prev ? prev : {
        ...prev,
        startDate: value,
        endDate: calcEndDate(value),
        ...(!editOverrides.signUp      ? { signUpDeadline:     calc.signUpDeadline }     : {}),
        ...(!editOverrides.withdrawal  ? { withdrawalDeadline: calc.withdrawalDeadline } : {}),
        ...(!editOverrides.freeze      ? { freezeDeadline:     calc.freezeDeadline }     : {}),
      });
    } else {
      setEditState((prev) => prev ? { ...prev, [key]: value } : prev);
    }
  }

  async function saveEdit() {
    if (!editState) return;
    if (!editState.name.trim()) { setEditError('Tournament name is required.'); return; }
    if (!editState.startDate)   { setEditError('Start date is required.'); return; }
    setSaving(true); setEditError('');
    const updates = {
      name: editState.name.trim(),
      country: editState.country,
      city: editState.city.trim(),
      surface: editState.surface,
      category: editState.category,
      startDate: editState.startDate,
      endDate: editState.endDate,
      signUpDeadline: editState.signUpDeadline,
      withdrawalDeadline: editState.withdrawalDeadline,
      freezeDeadline: editState.freezeDeadline,
    };
    try {
      if (DEMO_MODE) {
        demoCtx?.patchTournament(t.id, updates);
      } else {
        await db.transact(db.tx.tournaments[t.id].update(updates));
        const { rescheduleAllNotifications } = await import('@/utils/notifications');
        rescheduleAllNotifications(data?.tournaments ?? []);
      }
      setEditing(false);
      setEditState(null);
    } catch (e: any) {
      setEditError(e?.message ?? 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  async function doAction(key: string, updates: Record<string, any>) {
    setSavingAction(key);
    try {
      if (DEMO_MODE) {
        demoCtx?.patchTournament(t.id, updates);
      } else {
        await db.transact(db.tx.tournaments[t.id].update(updates));
      }
      onClose();
    } finally { setSavingAction(null); }
  }

  async function confirmWithdraw() {
    const newValue = !undoingWithdraw;
    setSavingAction('withdraw');
    try {
      if (DEMO_MODE) {
        demoCtx?.patchTournament(t.id, { isWithdrawn: newValue });
      } else {
        await db.transact(db.tx.tournaments[t.id].update({ isWithdrawn: newValue }));
      }
      setShowWithdraw(false);
      onClose();
    } finally { setSavingAction(null); }
  }

  return (
    <Modal animationType="slide" onRequestClose={editing ? cancelEdit : onClose} statusBarTranslucent>
      <SafeAreaView style={det.safe}>

        {/* Nav bar */}
        <View style={det.navbar}>
          <TouchableOpacity onPress={editing ? cancelEdit : onClose} style={det.backBtn} activeOpacity={0.7}>
            <Text style={det.backText}>{editing ? '← cancel' : '← back'}</Text>
          </TouchableOpacity>
          {!editing && (
            <TouchableOpacity onPress={startEdit} style={det.editBtn} activeOpacity={0.7}>
              <Text style={det.editBtnText}>✏️</Text>
            </TouchableOpacity>
          )}
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">

          {/* Surface-colored header band */}
          <View style={[det.headerBand, { backgroundColor: surfaceBg }]}>
            {editing && editState ? (
              <>
                <TextInput
                  style={[det.headerName, { color: surfaceText, borderBottomWidth: 1, borderBottomColor: surfaceText + '44' }]}
                  value={editState.name}
                  onChangeText={(v) => setEF('name', v)}
                  placeholder="Tournament name"
                  placeholderTextColor={surfaceText + '88'}
                />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  <CourtIcon surface={editState.surface} />
                  <Text style={[det.headerMeta, { color: surfaceText + 'CC' }]}>
                    {COUNTRY_NAME[editState.country?.toUpperCase()] ?? editState.country}
                  </Text>
                </View>
              </>
            ) : (
              <>
                <Text style={[det.headerName, { color: surfaceText }]} numberOfLines={2}>
                  {t.country ? countryFlag(t.country) + ' ' : ''}{t.name}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  <CourtIcon surface={t.surface} />
                  <Text style={[det.headerMeta, { color: surfaceText + 'CC' }]}>
                    {metaLine}
                  </Text>
                </View>
              </>
            )}
          </View>

          {editing && editState ? (
            /* ── EDIT MODE ── */
            <View style={det.body}>

              <Text style={det.sectionLabel}>SURFACE</Text>
              <View style={det.editChipRow}>
                {SURFACES.map((s) => (
                  <TouchableOpacity key={s}
                    style={[det.editChip, editState.surface === s && { backgroundColor: SURFACE_BG[s] }]}
                    onPress={() => setEF('surface', s)} activeOpacity={0.7}>
                    <Text style={[det.editChipText, editState.surface === s && { color: SURFACE_TEXT[s], fontWeight: '700' }]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={det.sectionLabel}>CATEGORY</Text>
              <View style={det.editChipRow}>
                {CATEGORIES.map((c) => (
                  <TouchableOpacity key={c}
                    style={[det.editChip, editState.category === c && det.editChipActive]}
                    onPress={() => setEF('category', c)} activeOpacity={0.7}>
                    <Text style={[det.editChipText, editState.category === c && det.editChipTextActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={det.sectionLabel}>COUNTRY</Text>
              <View style={det.editChipRow}>
                {COUNTRIES.map((c) => (
                  <TouchableOpacity key={c.code}
                    style={[det.editChip, editState.country === c.code && det.editChipActive]}
                    onPress={() => setEF('country', c.code)} activeOpacity={0.7}>
                    <Text style={[det.editChipText, editState.country === c.code && det.editChipTextActive]}>
                      {countryFlag(c.code)} {c.code}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={det.sectionLabel}>CITY</Text>
              <TextInput style={det.editInput} value={editState.city} onChangeText={(v) => setEF('city', v)}
                placeholder="City" placeholderTextColor="#BBBBBB" />

              <Text style={det.sectionLabel}>DATES</Text>
              <Text style={det.editDateLabel}>Start date (end date auto-calculated)</Text>
              <DatePickerField value={editState.startDate} onChange={(v) => setEF('startDate', v)} placeholder="YYYY-MM-DD" />

              <Text style={det.sectionLabel}>DEADLINES</Text>
              {(
                [
                  { ok: 'signUp' as const,     label: 'Singles entry',       field: 'signUpDeadline' as const },
                  { ok: 'withdrawal' as const,  label: 'Withdrawal',          field: 'withdrawalDeadline' as const },
                  { ok: 'freeze' as const,      label: 'Freeze / doubles',    field: 'freezeDeadline' as const },
                ]
              ).map(({ ok, label, field }) => (
                <View key={field} style={det.editDeadlineItem}>
                  <View style={det.editDeadlineHeader}>
                    <Text style={det.editDateLabel}>{label}</Text>
                    <TouchableOpacity
                      onPress={() => setEditOverrides(prev => ({ ...prev, [ok]: !prev[ok] }))}
                      activeOpacity={0.7}
                    >
                      <Text style={det.overrideBtn}>{editOverrides[ok] ? 'use formula' : 'override'}</Text>
                    </TouchableOpacity>
                  </View>
                  {editOverrides[ok] ? (
                    <DatePickerField value={editState[field]} onChange={(v) => setEF(field, v)} placeholder="YYYY-MM-DD" />
                  ) : (
                    <Text style={det.deadlinePreviewText}>
                      {editState[field] ? fmtDeadline(editState[field]) : '— select start date first'}
                    </Text>
                  )}
                </View>
              ))}

              {editError ? <Text style={det.editError}>{editError}</Text> : null}

              <View style={det.editActions}>
                <TouchableOpacity style={det.editCancelBtn} onPress={cancelEdit} activeOpacity={0.7} disabled={saving}>
                  <Text style={det.editCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={det.editSaveBtn} onPress={saveEdit} activeOpacity={0.8} disabled={saving}>
                  {saving
                    ? <ActivityIndicator color="#FFFFFF" />
                    : <Text style={det.editSaveText}>Save changes</Text>}
                </TouchableOpacity>
              </View>

            </View>
          ) : (
            /* ── VIEW MODE ── */
            <View style={det.body}>

              {/* FUTURE: registered toggle + withdraw toggle + all deadlines */}
              {group === 'upcoming' && (
                <>
                  <Text style={det.sectionLabel}>STATUS</Text>
                  <View style={det.toggleCard}>
                    {!t.isWithdrawn && (
                      <View style={det.toggleRow}>
                        <Text style={det.toggleLabel}>{t.isRegistered ? 'Registered' : 'Not registered'}</Text>
                        {savingAction === 'register' || savingAction === 'unregister'
                          ? <ActivityIndicator size="small" color="#5B5BD6" />
                          : <Switch
                              value={!!t.isRegistered}
                              onValueChange={(v) => doAction(v ? 'register' : 'unregister', { isRegistered: v })}
                              trackColor={{ false: '#E0E0EA', true: '#5B5BD6' }}
                              thumbColor="#FFFFFF"
                              disabled={!!savingAction}
                            />}
                      </View>
                    )}
                    <View style={det.toggleDivider} />
                    <View style={det.toggleRow}>
                      <Text style={[det.toggleLabel, det.toggleLabelWithdraw]}>
                        {t.isWithdrawn ? 'Withdrawn' : 'Withdraw'}
                      </Text>
                      {savingAction === 'withdraw'
                        ? <ActivityIndicator size="small" color="#E24B4A" />
                        : <Switch
                            value={!!t.isWithdrawn}
                            onValueChange={(v) => { setUndoingWithdraw(!v); setShowWithdraw(true); }}
                            trackColor={{ false: '#E0E0EA', true: '#E24B4A' }}
                            thumbColor="#FFFFFF"
                            disabled={!!savingAction}
                          />}
                    </View>
                  </View>

                  {(t.signUpDeadline || t.withdrawalDeadline || t.freezeDeadline) && (
                    <>
                      <Text style={det.sectionLabel}>DEADLINES</Text>
                      <View style={det.deadlinesCard}>
                        {(
                          [
                            { dateStr: t.signUpDeadline,     label: 'Singles entry' },
                            { dateStr: t.withdrawalDeadline, label: 'Withdrawal' },
                            { dateStr: t.freezeDeadline,     label: 'Freeze / doubles' },
                          ] as { dateStr: string | undefined; label: string }[]
                        ).filter(r => !!r.dateStr).map((r, idx, arr) => (
                          <React.Fragment key={r.label}>
                            <View style={det.deadlineRow}>
                              <Text style={det.deadlineName}>{r.label}</Text>
                              <View style={det.deadlineRight}>
                                <Text style={det.deadlineDate}>{fmtDeadline(r.dateStr!)}</Text>
                                <Text style={[det.deadlineDays, { color: deadlineColor(r.dateStr) }]}>
                                  {deadlineLabel(r.dateStr)}
                                </Text>
                              </View>
                            </View>
                            {idx < arr.length - 1 && <View style={det.deadlineDivider} />}
                          </React.Fragment>
                        ))}
                      </View>
                    </>
                  )}
                </>
              )}

              {/* CURRENT: single non-interactive "Playing" pill — no toggles, no deadlines */}
              {group === 'active' && (
                <View style={det.playingPillWrap}>
                  <View style={det.playingPill}>
                    <Text style={det.playingPillText}>Playing</Text>
                  </View>
                </View>
              )}

              {/* PAST: nothing here — header shows name/dates, expenses section (if added) below */}

            </View>
          )}

        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {showWithdraw && (
        <WithdrawDialog
          name={t.name}
          undoing={undoingWithdraw}
          onConfirm={confirmWithdraw}
          onCancel={() => setShowWithdraw(false)}
        />
      )}
    </Modal>
  );
}

// ─── Add Tournament Form ──────────────────────────────────────────────────────

interface FormState {
  name: string; country: string; city: string; surface: string; category: string;
  startDate: string; endDate: string;
  signUpDeadline: string; withdrawalDeadline: string; freezeDeadline: string;
  isRegistered: boolean;
}
const EMPTY_FORM: FormState = {
  name: '', country: 'US', city: '', surface: 'clay', category: 'M25',
  startDate: '', endDate: '',
  signUpDeadline: '', withdrawalDeadline: '', freezeDeadline: '',
  isRegistered: false,
};

function LabeledInput({ label, value, onChangeText, placeholder, hint }: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; hint?: string;
}) {
  return (
    <View style={form.field}>
      <Text style={form.label}>{label}</Text>
      {hint && <Text style={form.hint}>{hint}</Text>}
      <TextInput style={form.input} value={value} onChangeText={onChangeText}
        placeholder={placeholder ?? ''} placeholderTextColor="#BBBBBB" />
    </View>
  );
}

function ChipPicker({ label, options, value, onChange }: {
  label: string; options: string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <View style={form.field}>
      <Text style={form.label}>{label}</Text>
      <View style={form.chipRow}>
        {options.map((o) => (
          <TouchableOpacity key={o} style={[form.chip, value === o && form.chipActive]}
            onPress={() => onChange(o)} activeOpacity={0.7}>
            <Text style={[form.chipText, value === o && form.chipTextActive]}>{o}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function DeadlineRow({ label, value, overridden, onToggle, onChange }: {
  label: string; value: string; overridden: boolean;
  onToggle: () => void; onChange: (v: string) => void;
}) {
  return (
    <View style={form.deadlineItem}>
      <View style={form.deadlineHeader}>
        <Text style={form.deadlineItemLabel}>{label}</Text>
        <TouchableOpacity onPress={onToggle} activeOpacity={0.7}>
          <Text style={form.overrideBtn}>{overridden ? 'use formula' : 'override'}</Text>
        </TouchableOpacity>
      </View>
      {overridden ? (
        <DatePickerField value={value} onChange={onChange} placeholder="YYYY-MM-DD" />
      ) : (
        <Text style={form.deadlinePreviewText}>
          {value ? fmtDeadline(value) : '— select start date first'}
        </Text>
      )}
    </View>
  );
}

function AddTournamentModal({ onClose }: { onClose: () => void }) {
  const { data } = useAppQuery({ tournaments: {} });
  const demoCtx  = useDemoData();
  const [query, setQuery]     = useState('');
  const [mode, setMode]       = useState<'search' | 'manual'>('search');
  const [f, setF]             = useState<FormState>(EMPTY_FORM);
  const [overrides, setOverrides] = useState({ signUp: false, withdrawal: false, freeze: false });
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  const pool = (data?.tournaments ?? []).filter((t: any) => t.isInMyList === false);
  const searchResults = query.trim().length > 0
    ? pool.filter((t: any) => t.name?.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  // True when the sign-up deadline has already passed end-of-day
  const signUpPassed = (() => {
    if (!f.signUpDeadline) return false;
    const d = parseLocalDate(f.signUpDeadline);
    if (!d) return false;
    d.setHours(23, 59, 59, 999);
    return new Date() > d;
  })();

  function setField(key: keyof FormState, value: any) {
    setF((prev) => ({ ...prev, [key]: value }));
  }

  function handleStartDateChange(v: string) {
    const calc = v ? calcDeadlines(v) : null;
    setF(prev => ({
      ...prev,
      startDate: v,
      endDate: v ? calcEndDate(v) : '',
      ...(calc && !overrides.signUp     ? { signUpDeadline:     calc.signUpDeadline }     : {}),
      ...(calc && !overrides.withdrawal ? { withdrawalDeadline: calc.withdrawalDeadline } : {}),
      ...(calc && !overrides.freeze     ? { freezeDeadline:     calc.freezeDeadline }     : {}),
    }));
  }

  async function handleAddFromSearch(tournament: any) {
    setSaving(true);
    try {
      const _now2 = new Date();
      const _s2   = parseLocalDate(tournament.startDate);
      const _e2   = tournament.endDate ? parseLocalDate(tournament.endDate) : null;
      if (_e2) _e2.setHours(23, 59, 59, 999);
      const _su2  = tournament.signUpDeadline ? parseLocalDate(tournament.signUpDeadline) : null;
      if (_su2) _su2.setHours(23, 59, 59, 999);
      const updates: any = { isInMyList: true };
      if ((_su2 !== null && _now2 > _su2) || (_s2 !== null && _now2 >= _s2) || (_e2 !== null && _now2 > _e2)) {
        updates.isRegistered = true;
      }
      if (tournament.startDate && !tournament.freezeDeadline) {
        const calc = calcDeadlines(tournament.startDate);
        if (!tournament.signUpDeadline)     updates.signUpDeadline     = calc.signUpDeadline;
        if (!tournament.withdrawalDeadline) updates.withdrawalDeadline = calc.withdrawalDeadline;
        updates.freezeDeadline = calc.freezeDeadline;
      }
      if (DEMO_MODE) {
        demoCtx?.patchTournament(tournament.id, updates);
        onClose();
      } else {
        await db.transact(db.tx.tournaments[tournament.id].update(updates));
        onClose();
      }
    } catch (e: any) { setError(e?.message ?? 'Failed to add.'); setSaving(false); }
  }

  async function handleSaveManual() {
    if (!f.name.trim()) { setError('Tournament name is required.'); return; }
    if (!f.startDate)   { setError('Start date is required.'); return; }
    setSaving(true); setError('');
    // Auto-register if sign-up has passed or tournament has started/ended
    const _now = new Date();
    const _start = parseLocalDate(f.startDate);
    const _end   = f.endDate ? parseLocalDate(f.endDate) : null;
    if (_end) _end.setHours(23, 59, 59, 999);
    const _signUp = f.signUpDeadline ? parseLocalDate(f.signUpDeadline) : null;
    if (_signUp) _signUp.setHours(23, 59, 59, 999);
    const autoRegistered = f.isRegistered
      || (_signUp !== null && _now > _signUp)
      || (_start !== null && _now >= _start)
      || (_end !== null && _now > _end);
    try {
      if (DEMO_MODE) {
        demoCtx?.addTournament({
          id: id(),
          name: f.name.trim(), country: f.country, city: f.city.trim(),
          surface: f.surface, category: f.category, startDate: f.startDate,
          endDate: f.endDate,
          signUpDeadline: f.signUpDeadline,
          withdrawalDeadline: f.withdrawalDeadline,
          freezeDeadline: f.freezeDeadline,
          isRegistered: autoRegistered,
          isWithdrawn: false, isInMyList: true, status: 'upcoming',
          prizeMoney: 0, singlesPrizeMoney: 0, doublesPrizeMoney: 0,
        });
        onClose();
      } else {
        await db.transact(
          db.tx.tournaments[id()].update({
            name: f.name.trim(), country: f.country, city: f.city.trim(),
            surface: f.surface, category: f.category, startDate: f.startDate,
            endDate: f.endDate,
            signUpDeadline: f.signUpDeadline,
            withdrawalDeadline: f.withdrawalDeadline,
            freezeDeadline: f.freezeDeadline,
            isRegistered: autoRegistered,
            isWithdrawn: false, isInMyList: true, status: 'upcoming',
          })
        );
        onClose();
      }
    } catch (e: any) { setError(e?.message ?? 'Failed to save.'); setSaving(false); }
  }

  const showManualPrompt = mode === 'search' && query.trim().length > 0 && searchResults.length === 0;

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={form.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={form.backdrop} onPress={onClose} />
        <View style={form.sheet}>
          <View style={form.sheetHandle} />
          <View style={form.sheetHeader}>
            {mode === 'manual'
              ? <TouchableOpacity onPress={() => { setMode('search'); setError(''); }} activeOpacity={0.7} style={form.backBtn}>
                  <Text style={form.backBtnText}>← back</Text>
                </TouchableOpacity>
              : <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={form.backBtn}>
                  <Text style={form.backBtnText}>cancel</Text>
                </TouchableOpacity>}
            <Text style={form.sheetTitle}>{mode === 'manual' ? 'add manually' : 'add tournament'}</Text>
          </View>

          {mode === 'search' ? (
            <>
              <View style={form.searchWrap}>
                <Text style={form.searchIcon}>🔍</Text>
                <TextInput style={form.searchInput} value={query} onChangeText={setQuery}
                  placeholder="search tournament name…" placeholderTextColor="#BBBBBB" autoFocus returnKeyType="search" />
                {query.length > 0 && (
                  <TouchableOpacity onPress={() => setQuery('')} activeOpacity={0.7}>
                    <Text style={form.searchClear}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
              <ScrollView showsVerticalScrollIndicator={false} style={form.scrollArea} keyboardShouldPersistTaps="handled">
                {searchResults.map((t: any) => (
                  <TouchableOpacity key={t.id} style={form.resultCard} onPress={() => handleAddFromSearch(t)}
                    activeOpacity={0.75} disabled={saving}>
                    <View style={form.resultCardInner}>
                      <View style={{ flex: 1 }}>
                        <Text style={form.resultName} numberOfLines={1}>
                          {t.country ? countryFlag(t.country) + ' ' : ''}{t.name}
                        </Text>
                        <Text style={form.resultMeta}>{[t.city, t.surface, fmtDate(t.startDate)].filter(Boolean).join(' · ')}</Text>
                      </View>
                      {t.category && (
                        <View style={form.categoryBadge}>
                          <Text style={form.categoryBadgeText}>{t.category}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={form.resultAddLabel}>tap to add →</Text>
                  </TouchableOpacity>
                ))}
                {query.trim().length > 0 && searchResults.length === 0 && (
                  <View style={form.noResults}><Text style={form.noResultsText}>No matches for "{query}"</Text></View>
                )}
                {(showManualPrompt || query.trim().length === 0) && (
                  <TouchableOpacity style={form.manualPrompt} onPress={() => setMode('manual')} activeOpacity={0.8}>
                    <Text style={form.manualPromptIcon}>✏️</Text>
                    <View>
                      <Text style={form.manualPromptTitle}>Add manually</Text>
                      <Text style={form.manualPromptSub}>Tournament not in the database? Fill in the details yourself.</Text>
                    </View>
                  </TouchableOpacity>
                )}
                {error ? <Text style={form.error}>{error}</Text> : null}
              </ScrollView>
            </>
          ) : (
            <>
              <ScrollView showsVerticalScrollIndicator={false} style={form.scrollArea} keyboardShouldPersistTaps="handled">
                <LabeledInput label="name" placeholder="e.g. M25 Cuiabá" value={f.name} onChangeText={(v) => setField('name', v)} />
                <LabeledInput label="city" placeholder="e.g. Cuiabá" value={f.city} onChangeText={(v) => setField('city', v)} />
                <View style={form.field}>
                  <Text style={form.label}>country</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={form.chipRow}>
                      {COUNTRIES.map((c) => (
                        <TouchableOpacity key={c.code} style={[form.chip, f.country === c.code && form.chipActive]}
                          onPress={() => setField('country', c.code)} activeOpacity={0.7}>
                          <Text style={[form.chipText, f.country === c.code && form.chipTextActive]}>
                            {countryFlag(c.code)} {c.code}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>
                <ChipPicker label="surface" options={SURFACES} value={f.surface} onChange={(v) => setField('surface', v)} />
                <ChipPicker label="category" options={CATEGORIES} value={f.category} onChange={(v) => setField('category', v)} />
                <DatePickerField label="start date (end date auto-calculated)" value={f.startDate} onChange={handleStartDateChange} />
                <View style={form.field}>
                  <Text style={form.label}>deadlines (auto-calculated)</Text>
                  <DeadlineRow
                    label="Singles entry"
                    value={f.signUpDeadline}
                    overridden={overrides.signUp}
                    onToggle={() => setOverrides(p => ({ ...p, signUp: !p.signUp }))}
                    onChange={(v) => setField('signUpDeadline', v)}
                  />
                  <DeadlineRow
                    label="Withdrawal"
                    value={f.withdrawalDeadline}
                    overridden={overrides.withdrawal}
                    onToggle={() => setOverrides(p => ({ ...p, withdrawal: !p.withdrawal }))}
                    onChange={(v) => setField('withdrawalDeadline', v)}
                  />
                  <DeadlineRow
                    label="Freeze / doubles"
                    value={f.freezeDeadline}
                    overridden={overrides.freeze}
                    onToggle={() => setOverrides(p => ({ ...p, freeze: !p.freeze }))}
                    onChange={(v) => setField('freezeDeadline', v)}
                  />
                </View>
                {signUpPassed ? (
                  <View style={form.deadlineWarning}>
                    <Text style={form.deadlineWarningTitle}>⚠️ Sign-up deadline has passed</Text>
                    <Text style={form.deadlineWarningBody}>
                      This will be added as a past tournament. Still competing? (wildcard, late entry, or forgot to log it) — tap below to keep it active.
                    </Text>
                    <TouchableOpacity
                      style={[form.playingBtn, f.isRegistered && form.playingBtnActive]}
                      onPress={() => setField('isRegistered', !f.isRegistered)}
                      activeOpacity={0.8}
                    >
                      <Text style={[form.playingBtnText, f.isRegistered && form.playingBtnTextActive]}>
                        {f.isRegistered ? '✓  I\'m playing this' : 'I\'m playing this'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={form.field}>
                    <Text style={form.label}>already registered?</Text>
                    <View style={form.chipRow}>
                      {(['yes', 'no'] as const).map((opt) => {
                        const active = f.isRegistered === (opt === 'yes');
                        return (
                          <TouchableOpacity key={opt} style={[form.chip, active && form.chipActive]}
                            onPress={() => setField('isRegistered', opt === 'yes')} activeOpacity={0.7}>
                            <Text style={[form.chipText, active && form.chipTextActive]}>{opt}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}
                {error ? <Text style={form.error}>{error}</Text> : null}
              </ScrollView>
              <TouchableOpacity style={form.saveBtn} onPress={handleSaveManual} activeOpacity={0.8} disabled={saving}>
                {saving ? <ActivityIndicator color="#FFF" /> : <Text style={form.saveBtnText}>add tournament</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TournamentsScreen() {
  const { data, isLoading } = useAppQuery({ tournaments: {} });
  const [activeFilter, setActiveFilter]   = useState<Filter>('all');
  const [showAddForm, setShowAddForm]      = useState(false);
  const [detailId, setDetailId]           = useState<string | null>(null);

  const { openTournament } = useLocalSearchParams<{ openTournament?: string }>();
  useEffect(() => {
    if (openTournament) setDetailId(openTournament);
  }, [openTournament]);

  const allMyTournaments = (data?.tournaments ?? []).filter(
    (t: any) => t.isInMyList !== false
  );
  const nonWithdrawn   = allMyTournaments.filter((t: any) => !t.isWithdrawn);
  const withdrawnGroup = allMyTournaments.filter((t: any) => t.isWithdrawn);

  const filtered = activeFilter === 'withdrawn' || activeFilter === 'all'
    ? nonWithdrawn
    : nonWithdrawn.filter((t: any) => getGroup(t) === activeFilter);

  const activeGroup   = filtered.filter((t: any) => getGroup(t) === 'active');
  const upcomingGroup = filtered.filter((t: any) => getGroup(t) === 'upcoming');
  const pastGroup     = filtered.filter((t: any) => getGroup(t) === 'past');

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        <View style={styles.topBar}>
          <Text style={styles.topTitle}>My Tournaments</Text>
          <TouchableOpacity style={styles.addButton} onPress={() => setShowAddForm(true)} activeOpacity={0.8}>
            <Text style={styles.addIcon}>+</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.filterRow}>
          {FILTERS.map((f) => (
            <TouchableOpacity key={f.key}
              style={[styles.filterChip, activeFilter === f.key ? styles.filterChipActive : styles.filterChipInactive]}
              onPress={() => setActiveFilter(f.key)} activeOpacity={0.7}>
              <Text style={[styles.filterChipText, activeFilter === f.key ? styles.filterChipTextActive : styles.filterChipTextInactive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {isLoading && <ActivityIndicator color="#5B5BD6" style={{ marginTop: 40 }} />}

        {!isLoading && activeFilter !== 'withdrawn' && filtered.length === 0 && (
          <Text style={styles.emptyText}>No tournaments yet. Tap + to add one.</Text>
        )}
        {!isLoading && activeFilter === 'withdrawn' && withdrawnGroup.length === 0 && (
          <Text style={styles.emptyText}>No withdrawn tournaments.</Text>
        )}

        {activeFilter !== 'withdrawn' && activeGroup.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>ACTIVE</Text>
            {activeGroup.map((t: any) => (
              <TournamentCard key={t.id} item={t} onPress={() => setDetailId(t.id)} />
            ))}
          </>
        )}
        {activeFilter !== 'withdrawn' && upcomingGroup.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>UPCOMING</Text>
            {upcomingGroup.map((t: any) => (
              <TournamentCard key={t.id} item={t} onPress={() => setDetailId(t.id)} />
            ))}
          </>
        )}
        {activeFilter !== 'withdrawn' && pastGroup.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>PAST</Text>
            {pastGroup.map((t: any) => (
              <TournamentCard key={t.id} item={t} onPress={() => setDetailId(t.id)} />
            ))}
          </>
        )}
        {activeFilter === 'withdrawn' && withdrawnGroup.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>WITHDRAWN</Text>
            {withdrawnGroup.map((t: any) => (
              <TouchableOpacity key={t.id} style={styles.cardWithdrawn}
                onPress={() => setDetailId(t.id)} activeOpacity={0.7}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardTitleMuted} numberOfLines={1}>
                    {t.country ? countryFlag(t.country) + ' ' : ''}{t.name}
                  </Text>
                  <View style={styles.withdrawnBadge}><Text style={styles.withdrawnBadgeText}>withdrawn</Text></View>
                </View>
                <Text style={styles.cardMetaMuted}>
                  {fmtDateRange(t.startDate, t.endDate)}{t.surface ? ` · ${t.surface}` : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>

      {showAddForm && <AddTournamentModal onClose={() => setShowAddForm(false)} />}
      {detailId   && <TournamentDetail tournamentId={detailId} onClose={() => setDetailId(null)} />}
    </SafeAreaView>
  );
}

// ─── List styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAFAFA' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 32 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 18, paddingBottom: 20 },
  topTitle: { fontSize: 20, fontWeight: '700', color: '#2D2B55' },
  addButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#5B5BD6', alignItems: 'center', justifyContent: 'center' },
  addIcon: { color: '#FFFFFF', fontSize: 22, lineHeight: 26, fontWeight: '300' },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  filterChip: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7 },
  filterChipActive: { backgroundColor: '#5B5BD6' },
  filterChipInactive: { backgroundColor: '#F0F0F8' },
  filterChipText: { fontSize: 13, fontWeight: '600' },
  filterChipTextActive: { color: '#FFFFFF' },
  filterChipTextInactive: { color: '#999999' },
  sectionLabel: { fontSize: 11, fontWeight: '600', color: '#AAAAAA', letterSpacing: 0.8, marginBottom: 10, marginTop: 4 },
  card: { borderRadius: 14, padding: 14, marginBottom: 10, backgroundColor: '#FFFFFF' },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#2D2B55', flex: 1, marginRight: 8 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  cardMeta: { fontSize: 12, color: '#999999' },
  registeredBadge: { backgroundColor: '#EDEDFF', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  registeredText: { fontSize: 11, fontWeight: '600', color: '#5B5BD6' },
  notRegisteredBadge: { backgroundColor: '#F0F0F0', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  notRegisteredText: { fontSize: 11, fontWeight: '600', color: '#999999' },
  playedBadge: { backgroundColor: '#E8F5EE', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  playedText: { fontSize: 11, fontWeight: '600', color: '#2D9E6B' },
  pillRow: { flexDirection: 'row', gap: 6 },
  pill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  pillRed: { backgroundColor: '#E24B4A' },
  pillAmber: { backgroundColor: '#EF9F27' },
  pillText: { fontSize: 11, color: '#FFFFFF', fontWeight: '600' },
  emptyText: { fontSize: 14, color: '#AAAAAA', textAlign: 'center', marginTop: 40 },
  cardWithdrawn: {
    borderRadius: 14, padding: 14, marginBottom: 10,
    backgroundColor: '#F5F0EE', borderWidth: 1, borderColor: '#E8DEDA',
  },
  cardTitleMuted: { fontSize: 15, fontWeight: '600', color: '#AAAAAA', flex: 1, marginRight: 8 },
  cardMetaMuted: { fontSize: 12, color: '#CCCCCC' },
  withdrawnBadge: { backgroundColor: '#F9ECEA', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  withdrawnBadgeText: { fontSize: 11, fontWeight: '600', color: '#C0524A' },
  dialogBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 },
  dialog: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24, width: '100%' },
  dialogTitle: { fontSize: 17, fontWeight: '700', color: '#2D2B55', marginBottom: 10, textAlign: 'center' },
  dialogBody: { fontSize: 14, color: '#777777', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  dialogActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, backgroundColor: '#F0F0F8', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: '#666666' },
  withdrawConfirmBtn: { flex: 1, backgroundColor: '#E24B4A', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  withdrawConfirmText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
});

// ─── Add-tournament form styles ───────────────────────────────────────────────

const form = StyleSheet.create({
  kav: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingBottom: 36, paddingTop: 16, maxHeight: '92%' },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#DDDDDD', alignSelf: 'center', marginBottom: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  backBtn: { marginRight: 12 },
  backBtnText: { fontSize: 14, color: '#5B5BD6', fontWeight: '600' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: '#2D2B55' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F4F4F8', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16 },
  searchIcon: { fontSize: 14, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, color: '#2D2B55' },
  searchClear: { fontSize: 13, color: '#BBBBBB', paddingLeft: 8 },
  resultCard: { backgroundColor: '#F7F7FC', borderRadius: 12, padding: 14, marginBottom: 8 },
  resultCardInner: { flexDirection: 'row', alignItems: 'center' },
  resultName: { fontSize: 14, fontWeight: '600', color: '#2D2B55', marginBottom: 3 },
  resultMeta: { fontSize: 12, color: '#999999' },
  resultAddLabel: { fontSize: 12, color: '#5B5BD6', fontWeight: '600', marginTop: 8, textAlign: 'right' },
  categoryBadge: { backgroundColor: '#EDEDFF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 10 },
  categoryBadgeText: { fontSize: 11, fontWeight: '700', color: '#5B5BD6' },
  noResults: { paddingVertical: 16, alignItems: 'center' },
  noResultsText: { fontSize: 14, color: '#BBBBBB' },
  manualPrompt: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#F4F4F8', borderRadius: 14, padding: 16, marginTop: 8, marginBottom: 8 },
  manualPromptIcon: { fontSize: 22 },
  manualPromptTitle: { fontSize: 15, fontWeight: '700', color: '#2D2B55', marginBottom: 2 },
  manualPromptSub: { fontSize: 12, color: '#999999', lineHeight: 16 },
  scrollArea: { flexGrow: 0 },
  field: { marginBottom: 18 },
  label: { fontSize: 12, fontWeight: '600', color: '#AAAAAA', letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' },
  hint: { fontSize: 11, color: '#BBBBBB', marginBottom: 4 },
  input: { backgroundColor: '#F4F4F8', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#2D2B55' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#F0F0F8' },
  chipActive: { backgroundColor: '#5B5BD6' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#999999' },
  chipTextActive: { color: '#FFFFFF' },
  error: { fontSize: 13, color: '#E24B4A', marginBottom: 12, textAlign: 'center' },
  deadlineWarning: { backgroundColor: '#FFF8EC', borderRadius: 12, padding: 14, marginBottom: 4, borderWidth: 1, borderColor: '#F5D68A' },
  deadlineWarningTitle: { fontSize: 13, fontWeight: '700', color: '#8B6914', marginBottom: 4 },
  deadlineWarningBody: { fontSize: 12, color: '#7A5C0F', lineHeight: 17 },
  playingBtn: {
    marginTop: 10, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14,
    backgroundColor: '#FFF0D4', borderWidth: 1, borderColor: '#F0C840', alignItems: 'center',
  },
  playingBtnActive: { backgroundColor: '#5B5BD6', borderColor: '#5B5BD6' },
  playingBtnText: { fontSize: 14, fontWeight: '700', color: '#8B6914' },
  playingBtnTextActive: { color: '#FFFFFF' },
  saveBtn: { backgroundColor: '#5B5BD6', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  // Deadline rows in manual form
  deadlineItem: { marginBottom: 14 },
  deadlineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  deadlineItemLabel: { fontSize: 12, color: '#555555', fontWeight: '500' },
  overrideBtn: { fontSize: 12, color: '#5B5BD6', fontWeight: '600' },
  deadlinePreviewText: { fontSize: 13, color: '#444444', paddingVertical: 6, paddingHorizontal: 2 },
});

// ─── Detail screen styles ─────────────────────────────────────────────────────

const det = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAFAFA' },
  navbar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: '#FAFAFA',
    borderBottomWidth: 1, borderBottomColor: '#EBEBF0',
  },
  backBtn: { paddingRight: 16 },
  backText: { fontSize: 15, fontWeight: '600', color: '#5B5BD6' },
  // Header band
  headerBand: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 28 },
  headerName: { fontSize: 22, fontWeight: '800', lineHeight: 28, marginBottom: 6 },
  headerMeta: { fontSize: 13, fontWeight: '500', lineHeight: 18 },
  // Body
  body: { paddingHorizontal: 20, paddingTop: 24 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#AAAAAA', letterSpacing: 0.8, marginBottom: 12, marginTop: 8 },
  // Toggle card (settings-style rows)
  toggleCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: '#EBEBF0', marginBottom: 8,
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 13,
  },
  toggleDivider: { height: 1, backgroundColor: '#F3F3F6', marginHorizontal: 16 },
  toggleLabel: { fontSize: 15, fontWeight: '500', color: '#2D2B55' },
  toggleLabelWithdraw: { color: '#E24B4A' },
  // Deadlines
  deadlinesCard: { backgroundColor: '#FFFFFF', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#EBEBF0', marginBottom: 8 },
  deadlineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  deadlineDivider: { height: 1, backgroundColor: '#F5F5F5', marginHorizontal: 16 },
  deadlineName: { fontSize: 14, color: '#2D2B55', fontWeight: '500' },
  deadlineRight: { alignItems: 'flex-end' },
  deadlineDate: { fontSize: 13, color: '#666666', marginBottom: 2 },
  deadlineDays: { fontSize: 12, fontWeight: '600' },
  // Edit mode
  editBtn: { marginLeft: 'auto', paddingLeft: 16, paddingVertical: 4 },
  editBtnText: { fontSize: 20 },
  editChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  editChip: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#F0F0F8' },
  editChipActive: { backgroundColor: '#5B5BD6' },
  editChipText: { fontSize: 13, fontWeight: '600', color: '#999999' },
  editChipTextActive: { color: '#FFFFFF' },
  editInput: {
    backgroundColor: '#FFFFFF', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#2D2B55', borderWidth: 1, borderColor: '#EBEBF0', marginBottom: 20,
  },
  editDateRow: { flexDirection: 'row', marginBottom: 20 },
  editDateLabel: { fontSize: 11, fontWeight: '600', color: '#AAAAAA', marginBottom: 6, letterSpacing: 0.4 },
  editError: { fontSize: 13, color: '#E24B4A', textAlign: 'center', marginBottom: 12 },
  editActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  editCancelBtn: { flex: 1, backgroundColor: '#F0F0F8', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  editCancelText: { fontSize: 15, fontWeight: '600', color: '#666666' },
  editSaveBtn: { flex: 2, backgroundColor: '#5B5BD6', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  editSaveText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  // Deadline override rows in edit mode
  editDeadlineItem: { marginBottom: 16 },
  editDeadlineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  overrideBtn: { fontSize: 12, color: '#5B5BD6', fontWeight: '600' },
  deadlinePreviewText: { fontSize: 13, color: '#444444', paddingVertical: 6, paddingHorizontal: 2 },
  playingPillWrap: { paddingVertical: 12, paddingHorizontal: 16 },
  playingPill: { backgroundColor: '#EDEDFF', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, alignSelf: 'flex-start' },
  playingPillText: { fontSize: 13, fontWeight: '700', color: '#5B5BD6' },
});

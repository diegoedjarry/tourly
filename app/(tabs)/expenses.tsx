import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Modal,
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
import { DEMO_MODE } from '@/config/demo';
import { useDemoData } from '@/hooks/useDemoData';

type Surface = 'clay' | 'hard' | 'grass';

const SURFACE_BG = { clay: '#FAEEDA', hard: '#E6F1FB', grass: '#EAF3DE' } as const;

const PERSONAL_CATS = ['flight', 'hotel', 'meals', 'transport', 'strings & grip', 'stringing fee', 'physio', 'academy', 'trainer', 'other'];
const COACH_CATS    = ['coach fee', 'coach flight', 'coach hotel', 'coach meals'];

function fmt(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-US');
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

function countryFlag(country: string): string {
  const map: Record<string, string> = {
    BR: '🇧🇷', AR: '🇦🇷', US: '🇺🇸', ES: '🇪🇸', AU: '🇦🇺', FR: '🇫🇷',
    GB: '🇬🇧', DE: '🇩🇪', IT: '🇮🇹', CL: '🇨🇱', MX: '🇲🇽', PT: '🇵🇹',
  };
  return map[(country ?? '').toUpperCase()] ?? '🌍';
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function findActiveTournament(tournaments: any[]): any | null {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return tournaments.find((t) => {
    if (t.isWithdrawn) return false;
    const s = t.startDate ? new Date(t.startDate) : null;
    const e = t.endDate   ? new Date(t.endDate)   : null;
    return s && e && s <= today && today <= e;
  }) ?? null;
}

// ─── Add Expense Screen (full-screen modal) ───────────────────────────────────

function AddExpenseModal({ tournaments, onClose, defaultTournamentId }: {
  tournaments: any[]; onClose: () => void; defaultTournamentId?: string;
}) {
  const demoCtx = useDemoData();
  const defaultTournament = useMemo(
    () => {
      if (defaultTournamentId) return tournaments.find((t) => t.id === defaultTournamentId) ?? null;
      return findActiveTournament(tournaments) ?? tournaments[0] ?? null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [tournamentId, setTournamentId]         = useState(defaultTournament?.id ?? '');
  const [dropdownOpen, setDropdownOpen]          = useState(false);
  const [withCoach, setWithCoach]                = useState(false);
  const [category, setCategory]                  = useState('flight');
  const [customMode, setCustomMode]              = useState(false);
  const [customText, setCustomText]              = useState('');
  const [amount, setAmount]                      = useState('');
  const [date, setDate]                          = useState(todayIso());
  const [note, setNote]                          = useState('');
  const [saving, setSaving]                      = useState(false);
  const [error, setError]                        = useState('');

  const selectedTournament = tournaments.find((t) => t.id === tournamentId);

  const allCategories = withCoach ? [...PERSONAL_CATS, ...COACH_CATS] : PERSONAL_CATS;
  const isCoachExpense = COACH_CATS.includes(category);

  function selectCategory(cat: string) {
    setCategory(cat);
    setCustomMode(false);
    setCustomText('');
  }

  function confirmCustom() {
    const trimmed = customText.trim();
    if (trimmed) { setCategory(trimmed); setCustomMode(false); }
  }

  async function handleSave() {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { setError('Enter a valid amount.'); return; }
    if (!date) { setError('Please select a date.'); return; }
    const finalCategory = customMode ? customText.trim() : category;
    if (!finalCategory) { setError('Please select a category.'); return; }
    setSaving(true);
    setError('');
    try {
      if (DEMO_MODE) {
        demoCtx?.addExpense({
          id: id(),
          tournamentId,
          category: finalCategory,
          amount: amt,
          note: note.trim(),
          date,
          isCoachExpense,
        });
        onClose();
      } else {
        await db.transact(
          db.tx.expenses[id()].update({
            tournamentId,
            category: finalCategory,
            amount: amt,
            note: note.trim(),
            date,
            isCoachExpense,
          })
        );
        onClose();
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save.');
      setSaving(false);
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={form.safe}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

          {/* Header */}
          <View style={form.header}>
            <TouchableOpacity onPress={onClose} style={form.backBtn} activeOpacity={0.7}>
              <Text style={form.backText}>← back</Text>
            </TouchableOpacity>
            <Text style={form.headerTitle}>add expense</Text>
            <View style={form.backBtn} />
          </View>

          <ScrollView
            style={form.scroll}
            contentContainerStyle={form.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>

            {/* ── Coach toggle ── */}
            <View style={form.coachRow}>
              <View style={{ flex: 1 }}>
                <Text style={form.coachLabel}>traveling with coach this week</Text>
              </View>
              <Switch
                value={withCoach}
                onValueChange={(v) => {
                  setWithCoach(v);
                  if (!v && COACH_CATS.includes(category)) setCategory('flight');
                }}
                trackColor={{ false: '#E0E0EA', true: '#5B5BD6' }}
                thumbColor="#FFFFFF"
              />
            </View>

            {/* ── Tournament ── */}
            {tournaments.length > 0 && (
              <View style={form.section}>
                <Text style={form.sectionLabel}>TOURNAMENT</Text>
                <TouchableOpacity
                  style={form.dropdown}
                  onPress={() => setDropdownOpen((o) => !o)}
                  activeOpacity={0.8}>
                  <Text style={selectedTournament ? form.dropdownValue : form.dropdownPlaceholder} numberOfLines={1}>
                    {selectedTournament
                      ? `${selectedTournament.country ? countryFlag(selectedTournament.country) + ' ' : ''}${selectedTournament.name}`
                      : 'Select tournament'}
                  </Text>
                  <Text style={form.dropdownChevron}>{dropdownOpen ? '▲' : '▼'}</Text>
                </TouchableOpacity>
                {dropdownOpen && (
                  <View style={form.dropdownList}>
                    {tournaments.map((t) => (
                      <TouchableOpacity
                        key={t.id}
                        style={[form.dropdownRow, t.id === tournamentId && form.dropdownRowActive]}
                        onPress={() => { setTournamentId(t.id); setDropdownOpen(false); }}
                        activeOpacity={0.75}>
                        <Text style={[form.dropdownRowText, t.id === tournamentId && form.dropdownRowTextActive]} numberOfLines={1}>
                          {t.country ? countryFlag(t.country) + ' ' : ''}{t.name}
                        </Text>
                        {t.id === tournamentId && <Text style={form.dropdownCheck}>✓</Text>}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* ── Category ── */}
            <View style={form.section}>
              <Text style={form.sectionLabel}>CATEGORY</Text>

              {withCoach && (
                <Text style={form.subLabel}>personal</Text>
              )}
              <View style={form.chipRow}>
                {PERSONAL_CATS.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[form.chip, category === c && !customMode && form.chipActive]}
                    onPress={() => selectCategory(c)}
                    activeOpacity={0.7}>
                    <Text style={[form.chipText, category === c && !customMode && form.chipTextActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {withCoach && (
                <>
                  <Text style={[form.subLabel, { marginTop: 12 }]}>coach</Text>
                  <View style={form.chipRow}>
                    {COACH_CATS.map((c) => (
                      <TouchableOpacity
                        key={c}
                        style={[form.chip, category === c && !customMode && form.chipActive]}
                        onPress={() => selectCategory(c)}
                        activeOpacity={0.7}>
                        <Text style={[form.chipText, category === c && !customMode && form.chipTextActive]}>{c}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {/* Custom category */}
              {customMode ? (
                <View style={form.customRow}>
                  <TextInput
                    style={form.customInput}
                    value={customText}
                    onChangeText={setCustomText}
                    placeholder="custom category name"
                    placeholderTextColor="#BBBBBB"
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={confirmCustom}
                  />
                  <TouchableOpacity style={form.customDoneBtn} onPress={confirmCustom} activeOpacity={0.8}>
                    <Text style={form.customDoneText}>done</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={form.customPill}
                  onPress={() => { setCustomMode(true); setCustomText(''); }}
                  activeOpacity={0.7}>
                  <Text style={form.customPillText}>+ add custom</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* ── Amount ── */}
            <View style={form.section}>
              <Text style={form.sectionLabel}>AMOUNT (USD)</Text>
              <View style={form.amountRow}>
                <Text style={form.currencySign}>$</Text>
                <TextInput
                  style={form.amountInput}
                  value={amount}
                  onChangeText={setAmount}
                  placeholder="0.00"
                  placeholderTextColor="#BBBBBB"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            {/* ── Date ── */}
            <View style={form.section}>
              <DatePickerField label="date" value={date} onChange={setDate} />
            </View>

            {/* ── Note ── */}
            <View style={form.section}>
              <Text style={form.sectionLabel}>NOTE (OPTIONAL)</Text>
              <TextInput
                style={form.input}
                value={note}
                onChangeText={setNote}
                placeholder="e.g. SCL → BSB · LATAM"
                placeholderTextColor="#BBBBBB"
              />
            </View>

            {error ? <Text style={form.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[form.saveBtn, saving && { opacity: 0.7 }]}
              onPress={handleSave}
              activeOpacity={0.85}
              disabled={saving}>
              {saving
                ? <ActivityIndicator color="#FFF" />
                : <Text style={form.saveBtnText}>save expense</Text>}
            </TouchableOpacity>

            <View style={{ height: 20 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Edit Expense Modal ───────────────────────────────────────────────────────

function EditExpenseModal({ expense, onClose }: { expense: any; onClose: () => void }) {
  const isCoach = COACH_CATS.includes(expense.category);
  const knownCat = [...PERSONAL_CATS, ...COACH_CATS].includes(expense.category);

  const [category,   setCategory]   = useState(expense.category ?? 'flight');
  const [customMode, setCustomMode] = useState(!knownCat);
  const [customText, setCustomText] = useState(knownCat ? '' : expense.category ?? '');
  const [amount,     setAmount]     = useState(String(expense.amount ?? ''));
  const [date,       setDate]       = useState(expense.date ?? todayIso());
  const [note,       setNote]       = useState(expense.note ?? '');
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');

  function selectCategory(cat: string) {
    setCategory(cat);
    setCustomMode(false);
    setCustomText('');
  }

  function confirmCustom() {
    const trimmed = customText.trim();
    if (trimmed) { setCategory(trimmed); setCustomMode(false); }
  }

  async function handleSave() {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { setError('Enter a valid amount.'); return; }
    if (!date) { setError('Please select a date.'); return; }
    const finalCategory = customMode ? customText.trim() : category;
    if (!finalCategory) { setError('Please select a category.'); return; }
    setSaving(true); setError('');
    try {
      await db.transact(
        db.tx.expenses[expense.id].update({
          category: finalCategory,
          amount: amt,
          note: note.trim(),
          date,
          isCoachExpense: COACH_CATS.includes(finalCategory),
        })
      );
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save.');
      setSaving(false);
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={form.safe}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

          <View style={form.header}>
            <TouchableOpacity onPress={onClose} style={form.backBtn} activeOpacity={0.7}>
              <Text style={form.backText}>← back</Text>
            </TouchableOpacity>
            <Text style={form.headerTitle}>edit expense</Text>
            <View style={form.backBtn} />
          </View>

          <ScrollView style={form.scroll} contentContainerStyle={form.scrollContent}
            keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

            {/* ── Category ── */}
            <View style={form.section}>
              <Text style={form.sectionLabel}>CATEGORY</Text>
              {isCoach && <Text style={form.subLabel}>personal</Text>}
              <View style={form.chipRow}>
                {PERSONAL_CATS.map((c) => (
                  <TouchableOpacity key={c}
                    style={[form.chip, category === c && !customMode && form.chipActive]}
                    onPress={() => selectCategory(c)} activeOpacity={0.7}>
                    <Text style={[form.chipText, category === c && !customMode && form.chipTextActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {isCoach && (
                <>
                  <Text style={[form.subLabel, { marginTop: 12 }]}>coach</Text>
                  <View style={form.chipRow}>
                    {COACH_CATS.map((c) => (
                      <TouchableOpacity key={c}
                        style={[form.chip, category === c && !customMode && form.chipActive]}
                        onPress={() => selectCategory(c)} activeOpacity={0.7}>
                        <Text style={[form.chipText, category === c && !customMode && form.chipTextActive]}>{c}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              {customMode ? (
                <View style={form.customRow}>
                  <TextInput style={form.customInput} value={customText} onChangeText={setCustomText}
                    placeholder="custom category name" placeholderTextColor="#BBBBBB"
                    autoFocus returnKeyType="done" onSubmitEditing={confirmCustom} />
                  <TouchableOpacity style={form.customDoneBtn} onPress={confirmCustom} activeOpacity={0.8}>
                    <Text style={form.customDoneText}>done</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={form.customPill}
                  onPress={() => { setCustomMode(true); setCustomText(''); }} activeOpacity={0.7}>
                  <Text style={form.customPillText}>+ add custom</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* ── Amount ── */}
            <View style={form.section}>
              <Text style={form.sectionLabel}>AMOUNT (USD)</Text>
              <View style={form.amountRow}>
                <Text style={form.currencySign}>$</Text>
                <TextInput style={form.amountInput} value={amount} onChangeText={setAmount}
                  placeholder="0.00" placeholderTextColor="#BBBBBB" keyboardType="decimal-pad" />
              </View>
            </View>

            {/* ── Date ── */}
            <View style={form.section}>
              <DatePickerField label="date" value={date} onChange={setDate} />
            </View>

            {/* ── Note ── */}
            <View style={form.section}>
              <Text style={form.sectionLabel}>NOTE (OPTIONAL)</Text>
              <TextInput style={form.input} value={note} onChangeText={setNote}
                placeholder="e.g. SCL → BSB · LATAM" placeholderTextColor="#BBBBBB" />
            </View>

            {error ? <Text style={form.error}>{error}</Text> : null}

            <TouchableOpacity style={[form.saveBtn, saving && { opacity: 0.7 }]}
              onPress={handleSave} activeOpacity={0.85} disabled={saving}>
              {saving ? <ActivityIndicator color="#FFF" /> : <Text style={form.saveBtnText}>save changes</Text>}
            </TouchableOpacity>

            <View style={{ height: 20 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Expense action sheet ─────────────────────────────────────────────────────

function ExpenseActionSheet({ expense, onEdit, onDelete, onCancel }: {
  expense: any; onEdit: () => void; onDelete: () => void; onCancel: () => void;
}) {
  const label = [expense.category, expense.note].filter(Boolean).join(' · ');
  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={sheet.backdrop} onPress={onCancel}>
        <Pressable style={sheet.container} onPress={() => {}}>
          <View style={sheet.handle} />
          <Text style={sheet.title} numberOfLines={1}>{label}</Text>
          <Text style={sheet.amount}>{fmt(expense.amount)}</Text>

          <TouchableOpacity style={sheet.row} onPress={onEdit} activeOpacity={0.75}>
            <Text style={sheet.rowIcon}>✏️</Text>
            <Text style={sheet.rowLabel}>Edit expense</Text>
            <Text style={[sheet.rowArrow, { color: '#5B5BD6' }]}>›</Text>
          </TouchableOpacity>

          <View style={sheet.rowDivider} />

          <TouchableOpacity style={sheet.row} onPress={onDelete} activeOpacity={0.75}>
            <Text style={sheet.rowIcon}>🗑️</Text>
            <Text style={[sheet.rowLabel, { color: '#E24B4A' }]}>Delete expense</Text>
            <Text style={[sheet.rowArrow, { color: '#E24B4A' }]}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={sheet.cancelBtn} onPress={onCancel} activeOpacity={0.8}>
            <Text style={sheet.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Delete confirmation dialog ───────────────────────────────────────────────

function DeleteExpenseDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={sheet.dialogBackdrop} onPress={onCancel}>
        <Pressable style={sheet.dialog} onPress={() => {}}>
          <Text style={sheet.dialogTitle}>Delete this expense?</Text>
          <Text style={sheet.dialogBody}>This cannot be undone.</Text>
          <View style={sheet.dialogActions}>
            <TouchableOpacity style={sheet.dialogCancel} onPress={onCancel} activeOpacity={0.7}>
              <Text style={sheet.dialogCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={sheet.dialogDelete} onPress={onConfirm} activeOpacity={0.8}>
              <Text style={sheet.dialogDeleteText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Prize money row (reusable inside TournamentExpenseDetail) ────────────────

function PrizeRow({ label, icon, amount, onSave }: {
  label: string; icon: string; amount: number;
  onSave: (val: number) => Promise<void>;
}) {
  const [editing,       setEditing]       = useState(false);
  const [input,         setInput]         = useState('');
  // Optimistic display: update immediately on save, sync from prop when DB confirms
  const [displayAmount, setDisplayAmount] = useState(amount);
  const [saving,        setSaving]        = useState(false);

  useEffect(() => {
    if (!saving) setDisplayAmount(amount);
  }, [amount, saving]);

  async function handleSave() {
    if (saving) return; // guard against double-fire from onBlur + onPress
    const val = parseFloat(input);
    setEditing(false);
    if (!isNaN(val) && val >= 0) {
      setDisplayAmount(val); // optimistic — show immediately
      setSaving(true);
      try { await onSave(val); }
      finally { setSaving(false); }
    }
  }

  if (editing) {
    return (
      <View style={det.prizeRowEditing}>
        <Text style={det.prizeRowIcon}>{icon}</Text>
        <Text style={det.prizeRowLabel}>{label}</Text>
        <View style={det.prizeEditingRight}>
          <Text style={det.prizeSign}>$</Text>
          <TextInput
            style={det.prizeInput}
            value={input}
            onChangeText={setInput}
            keyboardType="decimal-pad"
            autoFocus
            onSubmitEditing={handleSave}
            selectTextOnFocus
            placeholder="0"
            placeholderTextColor="#CCCCCC"
          />
          <TouchableOpacity onPress={handleSave} activeOpacity={0.7} style={det.prizeDoneBtn}>
            <Text style={det.prizeDoneText}>done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={det.prizeRowView}
      onPress={() => { setInput(displayAmount > 0 ? String(displayAmount) : ''); setEditing(true); }}
      activeOpacity={0.7}>
      <Text style={det.prizeRowIcon}>{icon}</Text>
      <Text style={det.prizeRowLabel}>{label}</Text>
      {displayAmount > 0 ? (
        <View style={det.prizeRowRight}>
          <Text style={det.prizeAmount}>{fmt(displayAmount)}</Text>
          <Text style={det.prizeEditHint}>✎</Text>
        </View>
      ) : (
        <Text style={det.prizeEmpty}>Add prize money</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Tournament expense detail ────────────────────────────────────────────────

function TournamentExpenseDetail({ tournament, onClose, allTournaments }: {
  tournament: any; onClose: () => void; allTournaments: any[];
}) {
  const { data } = useAppQuery({ expenses: {}, tournaments: {} });
  const demoCtx  = useDemoData();

  // Always read prize fields from the live query so DB writes reflect immediately.
  // Fall back to the prop only for display metadata (name, surface, etc.) never for amounts.
  const liveT        = (data?.tournaments ?? []).find((x: any) => x.id === tournament.id);
  const t            = liveT ?? tournament;
  const expenses     = (data?.expenses ?? []).filter((e: any) => e.tournamentId === tournament.id);

  const [showAddExpense,  setShowAddExpense]  = useState(false);
  const [actionExpense,   setActionExpense]   = useState<any | null>(null);
  const [editExpense,     setEditExpense]     = useState<any | null>(null);
  const [deleteExpense,   setDeleteExpense]   = useState<any | null>(null);
  const [deleting,        setDeleting]        = useState(false);

  async function confirmDelete(expense: any) {
    setDeleting(true);
    try { await db.transact(db.tx.expenses[expense.id].delete()); }
    finally { setDeleting(false); setDeleteExpense(null); }
  }

  const sortedExpenses = [...expenses].sort((a: any, b: any) =>
    (b.date ?? '').localeCompare(a.date ?? '')
  );
  const totalSpent   = expenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
  // Read prize money from live record only; default 0 until data loads
  const singlesPrize = (liveT?.singlesPrizeMoney ?? tournament.singlesPrizeMoney) ?? 0;
  const doublesPrize = (liveT?.doublesPrizeMoney ?? tournament.doublesPrizeMoney) ?? 0;
  const totalPrize   = singlesPrize + doublesPrize;
  const net          = totalPrize - totalSpent;

  const surfaceBg   = SURFACE_BG[(t.surface as Surface)] ?? '#FAEEDA';
  const SURFACE_TEXT_MAP: Record<string, string> = { clay: '#854F0B', hard: '#185FA5', grass: '#3B6D11' };
  const surfaceText = SURFACE_TEXT_MAP[t.surface as Surface] ?? '#854F0B';
  const dateRange   = [t.startDate, t.endDate].filter(Boolean).join(' – ');

  async function saveSingles(val: number) {
    if (DEMO_MODE) {
      demoCtx?.patchTournament(t.id, { singlesPrizeMoney: val, prizeMoney: val + doublesPrize });
    } else {
      await db.transact(db.tx.tournaments[t.id].update({ singlesPrizeMoney: val, prizeMoney: val + doublesPrize }));
    }
  }

  async function saveDoubles(val: number) {
    if (DEMO_MODE) {
      demoCtx?.patchTournament(t.id, { doublesPrizeMoney: val, prizeMoney: singlesPrize + val });
    } else {
      await db.transact(db.tx.tournaments[t.id].update({ doublesPrizeMoney: val, prizeMoney: singlesPrize + val }));
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={det.safe}>

        {/* Nav bar */}
        <View style={det.navbar}>
          <TouchableOpacity onPress={onClose} style={det.backBtn} activeOpacity={0.7}>
            <Text style={det.backText}>← back</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>

          {/* Surface-colored header */}
          <View style={[det.headerBand, { backgroundColor: surfaceBg }]}>
            <Text style={[det.headerName, { color: surfaceText }]} numberOfLines={2}>
              {t.country ? countryFlag(t.country) + ' ' : ''}{t.name}
            </Text>
            <Text style={[det.headerMeta, { color: surfaceText + 'CC' }]}>
              {[dateRange, t.surface, t.city].filter(Boolean).join('  ·  ')}
            </Text>
          </View>

          <View style={det.body}>

            {/* ── PRIZE MONEY ── */}
            <Text style={det.sectionLabel}>PRIZE MONEY</Text>
            <View style={det.prizeCard}>
              <PrizeRow label="Singles" icon="🎾" amount={singlesPrize} onSave={saveSingles} />
              <View style={det.prizeDivider} />
              <PrizeRow label="Doubles" icon="🤝" amount={doublesPrize} onSave={saveDoubles} />
            </View>

            {/* ── EXPENSES ── */}
            <Text style={det.sectionLabel}>EXPENSES</Text>
            {sortedExpenses.length > 0 ? (
              <View style={det.expenseList}>
                {sortedExpenses.map((e: any) => (
                  <TouchableOpacity key={e.id} style={det.expenseRow}
                    onPress={() => setActionExpense(e)} activeOpacity={0.75}>
                    <View style={det.expenseLeft}>
                      <Text style={det.expenseCat}>{e.category}</Text>
                      {e.note ? <Text style={det.expenseNote} numberOfLines={1}>{e.note}</Text> : null}
                    </View>
                    <View style={det.expenseRight}>
                      <Text style={det.expenseAmt}>{fmt(e.amount)}</Text>
                      <Text style={det.expenseDate}>{e.date}</Text>
                    </View>
                    <Text style={det.expenseMoreDot}>⋯</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={det.noExpensesText}>No expenses logged yet.</Text>
            )}

            {/* ── SUMMARY ── */}
            <View style={det.summaryCard}>
              <View style={det.summaryRow}>
                <Text style={det.summaryLabel}>total spent</Text>
                <Text style={det.summaryAmt}>{fmt(totalSpent)}</Text>
              </View>
              <View style={det.summaryDivider} />
              <View style={det.summaryRow}>
                <Text style={[det.summaryLabel, { fontWeight: '700' }]}>net</Text>
                <Text style={[det.summaryAmt, { fontWeight: '700' }, net < 0 ? det.netNeg : det.netPos]}>
                  {net >= 0 ? '+' : ''}{fmt(net)}
                </Text>
              </View>
            </View>

            <TouchableOpacity style={det.addExpenseBtn} onPress={() => setShowAddExpense(true)} activeOpacity={0.85}>
              <Text style={det.addExpenseBtnText}>+ add expense</Text>
            </TouchableOpacity>

          </View>
        </ScrollView>
      </SafeAreaView>

      {showAddExpense && (
        <AddExpenseModal
          tournaments={allTournaments}
          defaultTournamentId={tournament.id}
          onClose={() => setShowAddExpense(false)}
        />
      )}

      {actionExpense && (
        <ExpenseActionSheet
          expense={actionExpense}
          onEdit={() => { setEditExpense(actionExpense); setActionExpense(null); }}
          onDelete={() => { setDeleteExpense(actionExpense); setActionExpense(null); }}
          onCancel={() => setActionExpense(null)}
        />
      )}

      {editExpense && (
        <EditExpenseModal
          expense={editExpense}
          onClose={() => setEditExpense(null)}
        />
      )}

      {deleteExpense && (
        <DeleteExpenseDialog
          onConfirm={() => confirmDelete(deleteExpense)}
          onCancel={() => setDeleteExpense(null)}
        />
      )}
    </Modal>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ExpensesScreen() {
  const { data, isLoading } = useAppQuery({ tournaments: {}, expenses: {}, monthlyExpenses: {} });
  const [showAddForm, setShowAddForm] = useState(false);
  const [detailTournament, setDetailTournament] = useState<any | null>(null);
  const { openTournament } = useLocalSearchParams<{ openTournament?: string }>();
  const autoOpenedRef = useRef<string | undefined>(undefined);

  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week');

  function periodRange(p: 'week' | 'month' | 'year'): [string, string] {
    const now = new Date();
    if (p === 'week') {
      const day = now.getDay();
      const mon = new Date(now);
      mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      mon.setHours(0, 0, 0, 0);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      return [mon.toISOString().slice(0, 10), sun.toISOString().slice(0, 10)];
    }
    if (p === 'month') {
      const y = now.getFullYear(), m = now.getMonth();
      return [
        new Date(y, m, 1).toISOString().slice(0, 10),
        new Date(y, m + 1, 0).toISOString().slice(0, 10),
      ];
    }
    const y = now.getFullYear();
    return [`${y}-01-01`, `${y}-12-31`];
  }

  useEffect(() => {
    if (!openTournament || isLoading) return;
    if (openTournament === autoOpenedRef.current) return;
    autoOpenedRef.current = openTournament;
    const allT = (data?.tournaments ?? []).filter((t: any) => !t.isWithdrawn);
    const t = allT.find((t: any) => t.id === openTournament);
    if (t) {
      const tExpenses = (data?.expenses ?? []).filter((e: any) => e.tournamentId === t.id);
      const spent = tExpenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
      const singles = t.singlesPrizeMoney ?? 0;
      const doubles = t.doublesPrizeMoney ?? 0;
      const prize = singles + doubles > 0 ? singles + doubles : (t.prizeMoney ?? 0);
      setDetailTournament({ ...t, spent, prize });
    }
  }, [openTournament, isLoading]);

  const tournaments = (data?.tournaments ?? []).filter((t: any) => !t.isWithdrawn);
  const expenses = data?.expenses ?? [];
  const monthlyExpenses = data?.monthlyExpenses ?? [];

  // Period range — computed first so it can filter both summary and tournament list
  const [pStart, pEnd] = periodRange(period);

  // Compute per-tournament totals, filtered to the selected period
  const tournamentTotals = tournaments.map((t: any) => {
    const tExpenses = expenses.filter((e: any) => e.tournamentId === t.id);
    const spent = tExpenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
    const singles = t.singlesPrizeMoney ?? 0;
    const doubles = t.doublesPrizeMoney ?? 0;
    // Prefer new split fields; fall back to legacy prizeMoney for old records
    const prize = singles + doubles > 0 ? singles + doubles : (t.prizeMoney ?? 0);
    return { ...t, spent, prize };
  }).filter((t: any) => t.spent > 0 && t.startDate && t.startDate >= pStart && t.startDate <= pEnd);

  const totalTournamentSpent = tournamentTotals.reduce((s: number, t: any) => s + t.spent, 0);
  const totalMonthly = monthlyExpenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
  const periodExpenses = expenses.filter((e: any) => e.date && e.date >= pStart && e.date <= pEnd);
  const periodSpent = periodExpenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
  const periodPrizeMoney = tournaments.reduce((s: number, t: any) => {
    if (!t.startDate || t.startDate < pStart || t.startDate > pEnd) return s;
    const singles = t.singlesPrizeMoney ?? 0;
    const doubles = t.doublesPrizeMoney ?? 0;
    return s + (singles + doubles > 0 ? singles + doubles : (t.prizeMoney ?? 0));
  }, 0);
  const periodNet = periodPrizeMoney - periodSpent;

  const totalPrizeMoney = tournaments.reduce((s: number, t: any) => {
    const singles = t.singlesPrizeMoney ?? 0;
    const doubles = t.doublesPrizeMoney ?? 0;
    return s + (singles + doubles > 0 ? singles + doubles : (t.prizeMoney ?? 0));
  }, 0);
  const totalSpent = totalTournamentSpent + totalMonthly;
  const totalNet   = totalPrizeMoney - totalSpent;

  // Group monthly expenses by month/year
  const monthlyGroups = monthlyExpenses.reduce((acc: any, e: any) => {
    const key = `${e.year}-${String(e.month).padStart(2, '0')}`;
    if (!acc[key]) acc[key] = { month: e.month, year: e.year, total: 0, categories: new Set<string>() };
    acc[key].total += e.amount ?? 0;
    acc[key].categories.add(e.category);
    return acc;
  }, {});
  const monthlyRows = Object.values(monthlyGroups) as any[];

  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        <View style={styles.topBar}>
          <Text style={styles.topTitle}>Expenses</Text>
          <TouchableOpacity style={styles.addButton} onPress={() => setShowAddForm(true)} activeOpacity={0.8}>
            <Text style={styles.addIcon}>+</Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator color="#5B5BD6" style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Period picker */}
            <View style={styles.periodRow}>
              {(['week', 'month', 'year'] as const).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.periodChip, period === p && styles.periodChipActive]}
                  onPress={() => setPeriod(p)}
                  activeOpacity={0.7}>
                  <Text style={[styles.periodChipText, period === p && styles.periodChipTextActive]}>{p.charAt(0).toUpperCase() + p.slice(1)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Summary bar */}
            <View style={styles.summaryRow}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Total spent</Text>
                <Text style={styles.summaryAmount}>{fmt(periodSpent)}</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Prize money</Text>
                <Text style={styles.summaryAmount}>{fmt(periodPrizeMoney)}</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Net</Text>
                <Text style={[styles.summaryAmount, periodNet <= 0 ? styles.netNegative : styles.netPositive]}>
                  {fmt(periodNet)}
                </Text>
              </View>
            </View>

            {/* Tournament expenses */}
            {tournamentTotals.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>TOURNAMENTS</Text>
                {tournamentTotals.map((t: any) => {
                  const net = t.prize - t.spent;
                  return (
                    <TouchableOpacity key={t.id} style={styles.card}
                      onPress={() => setDetailTournament(t)} activeOpacity={0.8}>
                      <View style={styles.cardLeft}>
                        <Text style={styles.cardTitle}>
                          {t.country ? countryFlag(t.country) + ' ' : ''}{t.name}
                        </Text>
                        <Text style={styles.cardMeta}>
                          {t.startDate}{t.surface ? ` · ${t.surface}` : ''}
                        </Text>
                      </View>
                      <View style={styles.cardRight}>
                        <Text style={styles.cardSpent}>{fmt(t.spent)}</Text>
                        <Text style={[styles.cardNet, net < 0 ? styles.netNegative : styles.netPositive]}>
                          {net >= 0 ? '+' : ''}{fmt(net)} net
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}

            {/* Monthly fixed */}
            {monthlyRows.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 8 }]}>MONTHLY FIXED</Text>
                {monthlyRows.map((row: any, i: number) => (
                  <View key={i} style={[styles.card, styles.fixedCard]}>
                    <View style={styles.cardLeft}>
                      <Text style={styles.cardTitle}>
                        {MONTH_NAMES[(row.month ?? 1) - 1]} {row.year}
                      </Text>
                      <Text style={styles.cardMeta}>
                        {[...row.categories].join(' · ')}
                      </Text>
                    </View>
                    <View style={styles.cardRight}>
                      <Text style={styles.cardSpent}>{fmt(row.total)}</Text>
                    </View>
                  </View>
                ))}
              </>
            )}

            {tournamentTotals.length === 0 && monthlyRows.length === 0 && (
              <Text style={styles.emptyText}>No expenses this {period}. Tap + to add one.</Text>
            )}
          </>
        )}

      </ScrollView>

      {showAddForm && (
        <AddExpenseModal
          tournaments={tournaments}
          onClose={() => setShowAddForm(false)}
        />
      )}

      {detailTournament && (
        <TournamentExpenseDetail
          tournament={detailTournament}
          allTournaments={tournaments}
          onClose={() => setDetailTournament(null)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAFAFA' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 32 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 18, paddingBottom: 20 },
  topTitle: { fontSize: 20, fontWeight: '700', color: '#2D2B55' },
  addButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#5B5BD6', alignItems: 'center', justifyContent: 'center' },
  addIcon: { color: '#FFFFFF', fontSize: 22, lineHeight: 26, fontWeight: '300' },
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  summaryCard: { flex: 1, backgroundColor: '#F0F0F8', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center' },
  summaryLabel: { fontSize: 10, color: '#AAAAAA', fontWeight: '500', marginBottom: 4, textAlign: 'center' },
  summaryAmount: { fontSize: 15, fontWeight: '700', color: '#2D2B55' },
  sectionLabel: { fontSize: 11, fontWeight: '600', color: '#AAAAAA', letterSpacing: 0.8, marginBottom: 10 },
  card: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFFFF' },
  fixedCard: { backgroundColor: '#F0F0F8' },
  cardLeft: { flex: 1, marginRight: 12 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#2D2B55', marginBottom: 3 },
  cardMeta: { fontSize: 12, color: '#999999' },
  cardRight: { alignItems: 'flex-end' },
  cardSpent: { fontSize: 15, fontWeight: '700', color: '#2D2B55', marginBottom: 2 },
  cardNet: { fontSize: 12, fontWeight: '500' },
  netNegative: { color: '#E24B4A' },
  netPositive: { color: '#2D9E6B' },
  emptyText: { fontSize: 14, color: '#AAAAAA', textAlign: 'center', marginTop: 40 },
  periodRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  periodChip: { borderRadius: 20, paddingHorizontal: 18, paddingVertical: 7, backgroundColor: '#F0F0F8' },
  periodChipActive: { backgroundColor: '#5B5BD6' },
  periodChipText: { fontSize: 13, fontWeight: '600', color: '#999999' },
  periodChipTextActive: { color: '#FFFFFF' },
});

const det = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#FAFAFA' },
  navbar:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#FAFAFA', borderBottomWidth: 1, borderBottomColor: '#EBEBF0' },
  backBtn: { paddingRight: 16 },
  backText: { fontSize: 15, fontWeight: '600', color: '#5B5BD6' },
  headerBand: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 28 },
  headerName: { fontSize: 22, fontWeight: '800', lineHeight: 28, marginBottom: 6 },
  headerMeta: { fontSize: 13, fontWeight: '500', lineHeight: 18 },
  body: { paddingHorizontal: 20, paddingTop: 24 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#AAAAAA', letterSpacing: 0.8, marginBottom: 10, marginTop: 4 },
  // Prize money section
  prizeCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14,
    borderWidth: 1, borderColor: '#EBEBF0',
    overflow: 'hidden',
    marginBottom: 20,
  },
  prizeDivider: { height: 1, backgroundColor: '#F5F5F5', marginHorizontal: 16 },
  // Shared row styles (view + editing)
  prizeRowView: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    gap: 10,
  },
  prizeRowEditing: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    gap: 10,
  },
  prizeRowIcon: { fontSize: 16 },
  prizeRowLabel: { fontSize: 14, fontWeight: '600', color: '#2D2B55', width: 62 },
  prizeRowRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  prizeEditingRight: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  prizeEmpty: { flex: 1, textAlign: 'right', fontSize: 14, color: '#CCCCCC', fontWeight: '400' },
  prizeAmount: { fontSize: 16, fontWeight: '700', color: '#2D9E6B' },
  prizeEditHint: { fontSize: 12, color: '#5B5BD6' },
  prizeSign: { fontSize: 16, color: '#2D2B55', fontWeight: '600' },
  prizeInput: { flex: 1, fontSize: 16, fontWeight: '700', color: '#2D9E6B', borderBottomWidth: 2, borderBottomColor: '#5B5BD6', paddingVertical: 2 },
  prizeDoneBtn: { backgroundColor: '#5B5BD6', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  prizeDoneText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  noExpensesText: { fontSize: 14, color: '#CCCCCC', textAlign: 'center', paddingVertical: 20 },
  expenseList: { backgroundColor: '#FFFFFF', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#EBEBF0', marginBottom: 12 },
  expenseRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#F7F7F7' },
  expenseLeft: { flex: 1 },
  expenseCat: { fontSize: 14, color: '#2D2B55', textTransform: 'capitalize', fontWeight: '500' },
  expenseNote: { fontSize: 12, color: '#BBBBBB', marginTop: 2 },
  expenseRight: { alignItems: 'flex-end' },
  expenseAmt: { fontSize: 14, fontWeight: '700', color: '#2D2B55' },
  expenseDate: { fontSize: 11, color: '#BBBBBB', marginTop: 2 },
  expenseMoreDot: { fontSize: 16, color: '#CCCCCC', marginLeft: 8, alignSelf: 'center' },
  summaryCard: { backgroundColor: '#FFFFFF', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#EBEBF0', marginBottom: 14 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  summaryDivider: { height: 1, backgroundColor: '#F5F5F5', marginHorizontal: 16 },
  summaryLabel: { fontSize: 14, color: '#666666' },
  summaryAmt: { fontSize: 15, fontWeight: '600', color: '#2D2B55' },
  summaryAmtMuted: { color: '#CCCCCC', fontWeight: '400' },
  netNeg: { color: '#E24B4A' },
  netPos: { color: '#2D9E6B' },
  addExpenseBtn: { backgroundColor: '#5B5BD6', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  addExpenseBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});

// ─── Action sheet / dialog styles ────────────────────────────────────────────

const sheet = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 36,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#DDDDDD', alignSelf: 'center', marginBottom: 18,
  },
  title: { fontSize: 13, color: '#AAAAAA', fontWeight: '500', marginBottom: 2, textAlign: 'center' },
  amount: { fontSize: 18, fontWeight: '800', color: '#2D2B55', textAlign: 'center', marginBottom: 20 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 16, gap: 14,
  },
  rowDivider: { height: 1, backgroundColor: '#F3F3F6' },
  rowIcon: { fontSize: 18, width: 26, textAlign: 'center' },
  rowLabel: { flex: 1, fontSize: 16, fontWeight: '600', color: '#2D2B55' },
  rowArrow: { fontSize: 20, fontWeight: '300' },
  cancelBtn: {
    marginTop: 12, backgroundColor: '#F0F0F8', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  cancelText: { fontSize: 15, fontWeight: '600', color: '#666666' },
  // Delete dialog
  dialogBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28,
  },
  dialog: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24, width: '100%' },
  dialogTitle: { fontSize: 17, fontWeight: '700', color: '#2D2B55', marginBottom: 10, textAlign: 'center' },
  dialogBody: { fontSize: 14, color: '#777777', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  dialogActions: { flexDirection: 'row', gap: 10 },
  dialogCancel: {
    flex: 1, backgroundColor: '#F0F0F8', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  dialogCancelText: { fontSize: 15, fontWeight: '600', color: '#666666' },
  dialogDelete: {
    flex: 1, backgroundColor: '#E24B4A', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  dialogDeleteText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
});

const form = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAFAFA' },
  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#EBEBF0',
    backgroundColor: '#FAFAFA',
  },
  backBtn: { width: 70 },
  backText: { fontSize: 15, color: '#5B5BD6', fontWeight: '600' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#2D2B55' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
  // Coach toggle
  coachRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F0F0F8', borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 13,
    marginBottom: 24,
  },
  coachLabel: { fontSize: 14, fontWeight: '500', color: '#2D2B55' },
  // Sections
  section: { marginBottom: 24 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#AAAAAA', letterSpacing: 0.8, marginBottom: 10 },
  subLabel: { fontSize: 11, fontWeight: '600', color: '#BBBBBB', letterSpacing: 0.4, marginBottom: 8 },
  // Tournament dropdown
  dropdown: {
    backgroundColor: '#F4F4F8', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  dropdownValue: { fontSize: 15, color: '#2D2B55', fontWeight: '500', flex: 1, marginRight: 8 },
  dropdownPlaceholder: { fontSize: 15, color: '#BBBBBB', flex: 1, marginRight: 8 },
  dropdownChevron: { fontSize: 11, color: '#AAAAAA' },
  dropdownList: {
    backgroundColor: '#FFFFFF', borderRadius: 12, marginTop: 4,
    borderWidth: 1, borderColor: '#EBEBF0', overflow: 'hidden',
  },
  dropdownRow: {
    paddingHorizontal: 16, paddingVertical: 13,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: '#F5F5F5',
  },
  dropdownRowActive: { backgroundColor: '#F4F4FF' },
  dropdownRowText: { fontSize: 14, color: '#2D2B55', flex: 1 },
  dropdownRowTextActive: { color: '#5B5BD6', fontWeight: '600' },
  dropdownCheck: { fontSize: 14, color: '#5B5BD6', marginLeft: 8 },
  // Category chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#F0F0F8' },
  chipActive: { backgroundColor: '#5B5BD6' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#999999' },
  chipTextActive: { color: '#FFFFFF' },
  // Custom category
  customPill: {
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1.5, borderColor: '#5B5BD6', borderStyle: 'dashed',
    marginTop: 8, alignSelf: 'flex-start',
  },
  customPillText: { fontSize: 13, fontWeight: '600', color: '#5B5BD6' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  customInput: {
    flex: 1, backgroundColor: '#F4F4F8', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#2D2B55',
  },
  customDoneBtn: { backgroundColor: '#5B5BD6', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  customDoneText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  // Amount
  amountRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F4F4F8', borderRadius: 12,
    paddingHorizontal: 14,
  },
  currencySign: { fontSize: 18, color: '#2D2B55', fontWeight: '600', marginRight: 4 },
  amountInput: { flex: 1, fontSize: 22, fontWeight: '700', color: '#2D2B55', paddingVertical: 14 },
  // Note
  input: {
    backgroundColor: '#F4F4F8', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15, color: '#2D2B55',
  },
  error: { fontSize: 13, color: '#E24B4A', marginBottom: 12, textAlign: 'center' },
  saveBtn: {
    backgroundColor: '#5B5BD6', borderRadius: 14,
    paddingVertical: 17, alignItems: 'center', marginTop: 8,
  },
  saveBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});

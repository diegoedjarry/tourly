import React, { useState, useMemo, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { LoadingLogo } from '@/components/ui/LoadingLogo';
import {
  ScrollView,
  View,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Switch,
  useWindowDimensions,
  PanResponder,
  Alert,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { PieChart } from 'react-native-gifted-charts';
import Svg, { Path, Line as SvgLine, Rect, Defs, ClipPath, Circle } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAppQuery } from '@/hooks/useAppQuery';
import { apiAddExpense, apiUpdateExpense, apiDeleteExpense, apiPatchTournament, apiAddTournament } from '@/lib/api';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { T } from '@/constants/theme';
import { DEMO_MODE } from '@/config/demo';
import { useLanguage } from '@/hooks/useLanguage';
import { getMonthAbbr } from '@/lib/i18n';
import { useDemoData } from '@/hooks/useDemoData';
import { useGenerateInsight } from '@/hooks/useInsights';
import { useFirstVisit } from '@/hooks/useFirstVisit';
import { useTabSwipe } from '@/hooks/useTabSwipe';
import { ScreenWalkthrough } from '@/components/ui/screen-walkthrough';
import { parseNotes, ParsedExpense } from '@/utils/parse-notes';
import { useProfile } from '@/hooks/useProfile';
import { AgentIcon } from '@/components/ui/agent-icon';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { parseReceipt, RECEIPT_TO_APP_CATEGORY } from '@/utils/receipt';
import { ReceiptCaptureSheet, CapturedReceipt } from '@/components/ui/ReceiptCaptureSheet';
import { smartDefaultCurrency, fmtCurrency } from '@/utils/currency';
import { toUsd } from '@/utils/fx';
import { SwipeableRow } from '@/components/ui/SwipeableRow';
import * as Haptics from 'expo-haptics';

const EXPENSES_WALKTHROUGH = [
  { icon: '💸', title: 'Log Your First Expense', body: 'Tap + to log your first expense. Link it to a tournament to track your weekly costs and see which tournaments give the best financial return.' },
];

function genId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

type Surface = 'clay' | 'hard' | 'grass';

const SURFACE_BG = { clay: '#2A1A08', hard: '#081828', grass: '#0A1E06' } as const;

// English labels are stable identifiers stored in DB; translated labels are display-only
const PERSONAL_CATS = ['Flights', 'Hotel', 'Meals', 'Transport', 'Strings & Grip', 'Stringing Fee', 'Physio', 'Academy', 'Trainer', 'Other'];
const COACH_CATS    = ['Coach Fee', 'Coach Flight', 'Coach Hotel', 'Coach Meals'];
const FIXED_CATS    = new Set(['academy', 'trainer', 'strings & grip', 'stringing fee']);

// Extended categories available only in monthly fixed mode
const MONTHLY_FIXED_CATS = [
  'Flights', 'Hotel', 'Meals', 'Transport', 'Strings & Grip', 'Stringing Fee', 'Physio',
  'Academy', 'Trainer', 'Physical Trainer', 'Physiotherapy', 'Gym', 'Nutritionist',
  'Psychologist', 'Agent Fee', 'Strings Budget', 'Equipment', 'Other',
];

const MONTH_NAMES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// i18n key maps (index-aligned with the arrays above)
const PERSONAL_CAT_KEYS = ['cat.flight', 'cat.hotel', 'cat.meals', 'cat.transport', 'cat.stringsGrip', 'cat.stringingFee', 'cat.physio', 'cat.academy', 'cat.trainer', 'cat.other'] as const;
const COACH_CAT_KEYS    = ['cat.coachFee', 'cat.coachFlight', 'cat.coachHotel', 'cat.coachMeals'] as const;

function fmt(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-US');
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

// Per-row amount display: non-USD expenses render in their original currency
// with the ISO code as a subtle suffix. Aggregates (totals, charts, P&L) stay
// in USD — amounts are stored as entered, never converted.
function fmtRowAmount(e: any): string {
  const cur = e?.currency;
  if (!cur || cur === 'USD') return fmt(e?.amount ?? 0);
  const s = fmtCurrency(e.amount ?? 0, cur);
  return s.includes(cur) ? s : `${s} ${cur}`;
}

// Single source of truth for every aggregate on this screen (totals, charts,
// per-tournament sums, budget card): USD-normalized amount, scaled by the
// user's ownership share. Reimbursed expenses are excluded entirely — callers
// filter them out before summing (see effectiveExpenses / effectiveSum below).
function effectiveUsd(e: any): number {
  const base = e?.amountUsd ?? e?.amount ?? 0;
  const pct = e?.sharePct ?? 100;
  return base * (pct / 100);
}

// Filters out reimbursed expenses — the set every aggregate on this screen
// should sum over instead of the raw `expenses` array.
function effectiveExpenses(expenses: any[]): any[] {
  return expenses.filter((e: any) => e?.isReimbursed !== true);
}

function effectiveSum(expenses: any[]): number {
  return effectiveExpenses(expenses).reduce((s: number, e: any) => s + effectiveUsd(e), 0);
}

// Receipt buckets → the exact chip values used by this form, so the scanned
// category highlights in the picker. Falls back to the raw mapped value.
const RECEIPT_CAT_TO_CHIP: Record<string, string> = {
  'Hotels': 'Hotel',
  'Food': 'Meals',
  'Stringing': 'Stringing Fee',
};
function receiptCategoryToChip(receiptCategory: string): string {
  const mapped = RECEIPT_TO_APP_CATEGORY[receiptCategory as keyof typeof RECEIPT_TO_APP_CATEGORY] ?? 'Other';
  return RECEIPT_CAT_TO_CHIP[mapped] ?? mapped;
}

// ─── Daily-rotating insight messages ──────────────────────────────────────────

const DAY_IDX = Math.floor(Date.now() / 86400000);
function pickMsg<T>(arr: T[]): T { return arr[DAY_IDX % arr.length]; }

type ID = { net: string; spent: string; earned: string };
const INSIGHTS: Record<string, Record<string, Array<(d: ID) => string>>> = {
  week: {
    profitable: [
      d => `Up ${d.net} this week. Prize money covering the grind — that's the goal.`,
      d => `Green week — ${d.net} net positive. Keep this up and the tour starts paying for itself.`,
      d => `${d.earned} earned, ${d.spent} spent. You're running it right this week.`,
      d => `Positive week — ${d.net} net. Discipline on court and off it.`,
      d => `${d.net} ahead this week. This is what building a pro career looks like.`,
    ],
    spending: [
      d => `${d.spent} into the tour this week. Every dollar logged is one you can learn from.`,
      d => `Investment week — ${d.spent} out. Track it all, the wins will follow.`,
      d => `${d.spent} spent this week. The best players track every dollar — you're doing it right.`,
      d => `Heavy week at ${d.spent}. You showed up, competed, and tracked it. That's professional.`,
      d => `${d.spent} this week. Control what you can — your numbers are sharp.`,
    ],
    empty: [
      () => `Fresh week. Log your first expense and you're already ahead of most players on tour.`,
      () => `Week just started. Every dollar you track is data that works for you.`,
      () => `No expenses yet this week — discipline or early days, either way you're on it.`,
      () => `Clean slate this week. Start logging and build your financial edge.`,
      () => `New week, new opportunity to track everything. Start now.`,
    ],
  },
  month: {
    profitable: [
      d => `${d.net} net positive this month. You're making the numbers work.`,
      d => `Month's looking green — ${d.net} ahead. Prize money doing its job.`,
      d => `${d.earned} earned vs ${d.spent} spent this month. You're ahead of the curve.`,
      d => `Profitable month — ${d.net} net. Not luck, that's discipline.`,
      d => `Green month. ${d.net} ahead. This is what financial control on tour looks like.`,
    ],
    spending: [
      d => `${d.spent} invested this month. Every court fee, flight, and hotel — you're building something.`,
      d => `Heavy month at ${d.spent}. You showed up, competed, and tracked it all. That's professional.`,
      d => `${d.spent} into the tour this month. Every dollar you log is leverage most players don't have.`,
      d => `${d.spent} this month. The data you're building now tells you exactly where to cut next.`,
      d => `${d.spent} out this month. Control what you can — your tracking is sharp.`,
    ],
    empty: [
      () => `Month's still fresh. Log your first expense and start building your financial picture.`,
      () => `No expenses yet this month. Every entry you add puts you ahead of players who wing it.`,
      () => `Clean month so far. When expenses start rolling in, you'll be ready.`,
      () => `Month just started — your tracking edge begins with the first entry.`,
      () => `Fresh month. Log everything and you'll have the full picture at the end.`,
    ],
  },
  year: {
    profitable: [
      d => `${d.net} net positive for the year. You're running the tour like a business.`,
      d => `Year-to-date: ${d.earned} earned, ${d.spent} spent. You're in the green.`,
      d => `Positive year — ${d.net} ahead. Wins plus discipline equals this.`,
      d => `Green year. ${d.net} net. Most players don't track this — you do, and it shows.`,
      d => `${d.net} net this year. You're treating this career like a business. Keep it up.`,
    ],
    spending: [
      d => `${d.spent} invested in your career this year. Every tournament, flight, and string job.`,
      d => `Big year of investment — ${d.spent} out. Tracking this turns data into decisions.`,
      d => `${d.spent} into the tour this year. You're treating this like a business — that's the right call.`,
      d => `Year's been a grind — ${d.spent} out. But every dollar tracked gives you the edge others don't have.`,
      d => `${d.spent} this year. You know where every dollar went — that's power most players don't have.`,
    ],
    empty: [
      () => `Year on the books. Start logging and build a financial record of your whole season.`,
      () => `No expenses logged this year yet. Every tournament you track builds your full career picture.`,
      () => `Year's just getting started. Log everything — at year end, this data tells your whole story.`,
      () => `Clean year so far. When expenses start rolling, you'll have the fullest picture on tour.`,
      () => `Fresh year. Track from day one and you'll have the clearest financial picture in the locker room.`,
    ],
  },
};

import { countryFlag } from '@/utils/countryFlag';
import { playerNameFilter } from '@/utils/text';

// ─── helpers ──────────────────────────────────────────────────────────────────

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseLocalDate(val: string | undefined): Date | null {
  if (!val || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return null;
  const [y, m, d] = val.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// End of the tournament week: stored endDate, or Monday start + 6 days (Mon–Sun).
function tournamentEnd(t: any): Date | null {
  const e = parseLocalDate(t.endDate);
  if (e) return e;
  const s = parseLocalDate(t.startDate);
  if (!s) return null;
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
}

function findActiveTournament(tournaments: any[]): any | null {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return tournaments.find((t) => {
    if (t.isWithdrawn) return false;
    const s = parseLocalDate(t.startDate);
    const e = tournamentEnd(t);
    return s && e && s <= today && today <= e;
  }) ?? null;
}

function matchTournamentByDate(dateStr: string | undefined, tournaments: any[]): string | undefined {
  if (!dateStr) return undefined;
  const d = parseLocalDate(dateStr);
  if (!d) return undefined;
  for (const t of tournaments) {
    if (t.isWithdrawn) continue;
    const s = parseLocalDate(t.startDate);
    const e = tournamentEnd(t);
    if (s && e && d >= s && d <= e) return t.id;
  }
  return undefined;
}

// ─── Currency selector (chips + free 3-letter code entry) ────────────────────

function CurrencyChips({ value, onChange, quickPicks }: {
  value: string; onChange: (code: string) => void; quickPicks: string[];
}) {
  const { t } = useLanguage();
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');

  // Smart default first, then quick picks, then whatever is currently selected
  // (e.g. a scanned receipt's currency) — deduped, one tap for the default.
  const chips = Array.from(new Set([...quickPicks, value].filter(Boolean)));

  function confirmCustom() {
    const code = customText.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code)) {
      onChange(code);
      setCustomOpen(false);
      setCustomText('');
    }
  }

  return (
    <View>
      <View style={form.chipRow}>
        {chips.map((c) => (
          <TouchableOpacity
            key={c}
            style={[form.chip, value === c && form.chipActive]}
            onPress={() => onChange(c)}
            activeOpacity={0.7}>
            <Text style={[form.chipText, value === c && form.chipTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
        {!customOpen && (
          <TouchableOpacity
            style={rc.otherPill}
            onPress={() => { setCustomOpen(true); setCustomText(''); }}
            activeOpacity={0.7}>
            <Text style={rc.otherPillText}>{t('expense.currencyOther')}</Text>
          </TouchableOpacity>
        )}
      </View>
      {customOpen && (
        <View style={form.customRow}>
          <TextInput
            style={form.customInput}
            value={customText}
            onChangeText={(v) => setCustomText(v.toUpperCase())}
            placeholder={t('expense.currencyCodeHint')}
            placeholderTextColor={T.textSecondary}
            autoFocus
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={3}
            returnKeyType="done"
            onSubmitEditing={confirmCustom}
          />
          <TouchableOpacity style={form.customDoneBtn} onPress={confirmCustom} activeOpacity={0.8}>
            <Text style={form.customDoneText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Add Expense Screen (full-screen modal) ───────────────────────────────────

export function AddExpenseModal({ tournaments, onClose, defaultTournamentId, defaultDate, autoOpenScan }: {
  tournaments: any[]; onClose: () => void; defaultTournamentId?: string; defaultDate?: string; autoOpenScan?: boolean;
}) {
  const { t, lang } = useLanguage();
  const monthNames        = lang === 'es' ? MONTH_NAMES_ES : MONTH_NAMES_EN;
  const personalCatLabels = PERSONAL_CAT_KEYS.map(k => t(k));
  const coachCatLabels    = COACH_CAT_KEYS.map(k => t(k));
  const demoCtx = useDemoData();
  const generateInsight = useGenerateInsight();
  // Auto-match by date only — never default to an arbitrary tournament.
  // When the date falls outside every tournament week, start unlinked.
  const autoMatchedId = useMemo(
    () => defaultTournamentId ? undefined : matchTournamentByDate(defaultDate ?? todayIso(), tournaments),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [tournamentId, setTournamentId]         = useState(defaultTournamentId ?? autoMatchedId ?? '');
  const [manuallyPicked, setManuallyPicked]     = useState(!!defaultTournamentId);
  const [dropdownOpen, setDropdownOpen]          = useState(false);
  const [withCoach, setWithCoach]                = useState(false);
  const [category, setCategory]                  = useState('flight');
  const [customMode, setCustomMode]              = useState(false);
  const [customText, setCustomText]              = useState('');
  const [amount, setAmount]                      = useState('');
  const [date, setDate]                          = useState(defaultDate ?? todayIso());
  const [note, setNote]                          = useState('');
  const [saving, setSaving]                      = useState(false);
  const [error, setError]                        = useState('');

  // Zero-Click receipt scanning
  const [showScanSheet, setShowScanSheet]        = useState(!!autoOpenScan);
  const [scanning, setScanning]                  = useState(false);
  const [scanHint, setScanHint]                  = useState('');
  const [merchant, setMerchant]                  = useState('');

  // Currency — smart default from the linked/active tournament; one tap to keep.
  const [currency, setCurrency]                  = useState(() =>
    smartDefaultCurrency(tournaments.find((x) => x.id === (defaultTournamentId ?? autoMatchedId ?? '')), tournaments));
  const [currencyTouched, setCurrencyTouched]    = useState(false);

  // Monthly fixed expense mode
  const [isMonthlyFixed, setIsMonthlyFixed]      = useState(false);
  const nowForFixed = new Date();
  const [fixedMonth, setFixedMonth]              = useState(nowForFixed.getMonth() + 1); // 1–12
  const [fixedYear, setFixedYear]                = useState(nowForFixed.getFullYear());

  // Reimbursed + split-cost (collapsed by default to keep the form clean)
  const [isReimbursed, setIsReimbursed]          = useState(false);
  const [splitOpen, setSplitOpen]                = useState(false);
  const [sharePctText, setSharePctText]          = useState('100');

  const selectedTournament = tournaments.find((t) => t.id === tournamentId);

  // Re-derive the smart default when the linked tournament changes — but never
  // override a currency the user (or a scanned receipt) explicitly picked.
  useEffect(() => {
    if (currencyTouched) return;
    setCurrency(smartDefaultCurrency(selectedTournament, tournaments));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  const allCategories = withCoach ? [...PERSONAL_CATS, ...COACH_CATS] : PERSONAL_CATS;
  const isCoachExpense = COACH_CATS.includes(category);
  const isFixedCat = FIXED_CATS.has(category.toLowerCase());

  async function handleReceiptCaptured(file: CapturedReceipt) {
    setScanning(true);
    setScanHint('');
    try {
      const result = await parseReceipt(file.base64, file.mediaType);
      if (result.ok) {
        const r = result.receipt;
        setAmount(String(r.amount));
        setCurrency(r.currency);
        setCurrencyTouched(true);
        const d = r.date ?? todayIso();
        setDate(d);
        const chip = receiptCategoryToChip(r.category);
        setCategory(chip);
        setCustomMode(false);
        setCustomText('');
        if (r.merchant) {
          setMerchant(r.merchant);
          setNote((prev) => prev || r.merchant);
        }
        if (!manuallyPicked && !FIXED_CATS.has(chip.toLowerCase())) {
          setTournamentId(matchTournamentByDate(d, tournaments) ?? '');
        }
        if (r.confidence === 'low') setScanHint(t('receipt.readFailed'));
      } else {
        // Graceful fallback — pre-fill whatever was readable, never crash.
        const p = result.partial;
        if (p.amount != null) setAmount(String(p.amount));
        if (p.currency) { setCurrency(p.currency); setCurrencyTouched(true); }
        if (p.date) {
          setDate(p.date);
          if (!manuallyPicked) setTournamentId(matchTournamentByDate(p.date, tournaments) ?? '');
        }
        if (p.category) { setCategory(receiptCategoryToChip(p.category)); setCustomMode(false); setCustomText(''); }
        if (p.merchant) {
          setMerchant(p.merchant);
          setNote((prev) => prev || p.merchant!);
        }
        setScanHint(result.reason || t('receipt.readFailed'));
      }
    } finally {
      setScanning(false);
    }
  }

  function selectCategory(cat: string) {
    setCategory(cat);
    setCustomMode(false);
    setCustomText('');
    if (!manuallyPicked) {
      if (FIXED_CATS.has(cat.toLowerCase())) {
        setTournamentId('');
      } else {
        const matched = matchTournamentByDate(date, tournaments);
        setTournamentId(matched ?? '');
      }
    }
  }

  function confirmCustom() {
    const trimmed = customText.trim();
    if (trimmed) { setCategory(trimmed); setCustomMode(false); }
  }

  async function handleSave() {
    // Accept comma decimals — locale decimal-pad keyboards only offer ","
    const amt = parseFloat(amount.replace(',', '.'));
    if (isNaN(amt) || amt <= 0) { setError(t('expense.validAmount')); return; }
    const finalCategory = customMode ? customText.trim() : category;
    if (!finalCategory) { setError(t('expense.selectCategory')); return; }
    if (!isMonthlyFixed && !date) { setError(t('expense.selectDate')); return; }
    setSaving(true);
    setError('');

    const fixedDateStr = `${fixedYear}-${String(fixedMonth).padStart(2, '0')}-01`;
    const fixedMonthStr = `${fixedYear}-${String(fixedMonth).padStart(2, '0')}`;
    const sharePctVal = (() => {
      const n = parseInt(sharePctText, 10);
      return !isNaN(n) && n >= 1 && n <= 100 ? n : 100;
    })();
    // Indicative USD value at entry time — null when the currency is USD
    // already (no conversion needed) or when the rate is unavailable.
    const amountUsd = currency !== 'USD' ? await toUsd(amt, currency) : null;

    try {
      if (DEMO_MODE) {
        demoCtx?.addExpense({
          id: genId(),
          tournamentId: isMonthlyFixed ? null : tournamentId,
          category: finalCategory,
          amount: amt,
          currency,
          merchant: merchant.trim() || null,
          note: note.trim(),
          date: isMonthlyFixed ? fixedDateStr : date,
          isCoachExpense: isMonthlyFixed ? false : isCoachExpense,
          isMonthlyFixed: isMonthlyFixed,
          fixedMonth: isMonthlyFixed ? fixedMonthStr : null,
          isReimbursed,
          sharePct: sharePctVal,
          amountUsd,
        });
        onClose();
      } else {
        await apiAddExpense({
          tournamentId: isMonthlyFixed ? null : tournamentId,
          category: finalCategory,
          amount: amt,
          currency,
          merchant: merchant.trim() || null,
          note: note.trim(),
          date: isMonthlyFixed ? fixedDateStr : date,
          isCoachExpense: isMonthlyFixed ? false : isCoachExpense,
          isMonthlyFixed: isMonthlyFixed,
          fixedMonth: isMonthlyFixed ? fixedMonthStr : null,
          isReimbursed,
          sharePct: sharePctVal,
          amountUsd,
        });
        generateInsight.mutate({ trigger: 'expense_logged' }); // fire and forget
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
              <Text style={form.backText}>{t('common.back')}</Text>
            </TouchableOpacity>
            <Text style={form.headerTitle}>{t('expense.addExpense')}</Text>
            <View style={form.backBtn} />
          </View>

          <ScrollView
            style={form.scroll}
            contentContainerStyle={form.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>

            {/* ── Monthly fixed banner ── */}
            {isMonthlyFixed && (
              <View style={form.fixedBanner}>
                <Text style={form.fixedBannerText}>{t('expense.monthlyFixedBanner')}</Text>
              </View>
            )}

            {/* ── Scan receipt (Zero-Click entry point) ── */}
            {!isMonthlyFixed && (
              <TouchableOpacity
                style={rc.scanBtn}
                onPress={() => setShowScanSheet(true)}
                disabled={scanning}
                activeOpacity={0.8}>
                {scanning ? (
                  <>
                    <ActivityIndicator size="small" color={T.teal} />
                    <Text style={rc.scanBtnText}>{t('receipt.reading')}</Text>
                  </>
                ) : (
                  <>
                    <Text style={rc.scanBtnIcon}>📷</Text>
                    <Text style={rc.scanBtnText}>{t('receipt.scanButton')}</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {/* Amber hint — partial/low-confidence read, review before saving */}
            {!isMonthlyFixed && !!scanHint && (
              <Text style={rc.scanHint}>{scanHint}</Text>
            )}

            {/* ── Tournament (hidden in monthly fixed mode) ── */}
            {!isMonthlyFixed && tournaments.length > 0 && (
              <View style={form.section}>
                <Text style={form.sectionLabel}>{t('expense.tournament')}</Text>
                <TouchableOpacity
                  style={form.dropdown}
                  onPress={() => setDropdownOpen((o) => !o)}
                  activeOpacity={0.8}>
                  <Text style={selectedTournament ? form.dropdownValue : form.dropdownPlaceholder} numberOfLines={1}>
                    {selectedTournament
                      ? `${selectedTournament.country ? countryFlag(selectedTournament.country) + ' ' : ''}${selectedTournament.name}`
                      : t('expense.noTournament')}
                  </Text>
                  <Text style={form.dropdownChevron}>{dropdownOpen ? '▲' : '▼'}</Text>
                </TouchableOpacity>
                {dropdownOpen && (
                  <View style={form.dropdownList}>
                    <TouchableOpacity
                      style={[form.dropdownRow, !tournamentId && form.dropdownRowActive]}
                      onPress={() => { setTournamentId(''); setManuallyPicked(true); setDropdownOpen(false); }}
                      activeOpacity={0.75}>
                      <Text style={[form.dropdownRowText, !tournamentId && form.dropdownRowTextActive]}>{t('expense.noTournamentShort')}</Text>
                      {!tournamentId && <Text style={form.dropdownCheck}>✓</Text>}
                    </TouchableOpacity>
                    {tournaments.map((t) => (
                      <TouchableOpacity
                        key={t.id}
                        style={[form.dropdownRow, t.id === tournamentId && form.dropdownRowActive]}
                        onPress={() => { setTournamentId(t.id); setManuallyPicked(true); setDropdownOpen(false); }}
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

            {/* ── Month/Year picker (monthly fixed mode only) ── */}
            {isMonthlyFixed && (
              <View style={form.section}>
                <Text style={form.sectionLabel}>{t('expense.selectMonthYear')}</Text>
                <View style={form.monthYearRow}>
                  {/* Month picker */}
                  <ScrollView
                    style={form.monthPicker}
                    showsVerticalScrollIndicator={false}
                    nestedScrollEnabled>
                    {monthNames.map((name, i) => {
                      const m = i + 1;
                      return (
                        <TouchableOpacity
                          key={m}
                          style={[form.monthPickerRow, fixedMonth === m && form.monthPickerRowActive]}
                          onPress={() => setFixedMonth(m)}
                          activeOpacity={0.7}>
                          <Text style={[form.monthPickerText, fixedMonth === m && form.monthPickerTextActive]}>{name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  {/* Year picker */}
                  <View style={form.yearPicker}>
                    {[fixedYear - 1, fixedYear, fixedYear + 1].map((y) => (
                      <TouchableOpacity
                        key={y}
                        style={[form.monthPickerRow, fixedYear === y && form.monthPickerRowActive]}
                        onPress={() => setFixedYear(y)}
                        activeOpacity={0.7}>
                        <Text style={[form.monthPickerText, fixedYear === y && form.monthPickerTextActive]}>{y}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            )}

            {/* ── Category ── */}
            <View style={form.section}>
              <Text style={form.sectionLabel}>{t('expense.category')}</Text>

              {!isMonthlyFixed && <Text style={form.subLabel}>{t('expense.personal')}</Text>}
              <View style={form.chipRow}>
                {(isMonthlyFixed ? MONTHLY_FIXED_CATS : PERSONAL_CATS).map((c, i) => (
                  <TouchableOpacity
                    key={c}
                    style={[form.chip, category === c && !customMode && form.chipActive]}
                    onPress={() => selectCategory(c)}
                    activeOpacity={0.7}>
                    <Text style={[form.chipText, category === c && !customMode && form.chipTextActive]}>
                      {isMonthlyFixed ? c : personalCatLabels[i]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {!isMonthlyFixed && (
                <>
                  <Text style={[form.subLabel, { marginTop: 12 }]}>{t('expense.coach')}</Text>
                  <View style={form.chipRow}>
                    {COACH_CATS.map((c, i) => (
                      <TouchableOpacity
                        key={c}
                        style={[form.chip, category === c && !customMode && form.chipActive]}
                        onPress={() => selectCategory(c)}
                        activeOpacity={0.7}>
                        <Text style={[form.chipText, category === c && !customMode && form.chipTextActive]}>{coachCatLabels[i]}</Text>
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
                    placeholder={t('expense.customCategoryName')}
                    placeholderTextColor={T.textSecondary}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={confirmCustom}
                  />
                  <TouchableOpacity style={form.customDoneBtn} onPress={confirmCustom} activeOpacity={0.8}>
                    <Text style={form.customDoneText}>{t('common.done')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={form.customPill}
                  onPress={() => { setCustomMode(true); setCustomText(''); }}
                  activeOpacity={0.7}>
                  <Text style={form.customPillText}>{t('expense.addCustom')}</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* ── Amount ── */}
            <View style={form.section}>
              <Text style={form.sectionLabel}>{t('expense.amount')}</Text>
              <View style={form.amountRow}>
                <Text style={form.currencySign}>{currency === 'USD' ? '$' : currency}</Text>
                <TextInput
                  style={form.amountInput}
                  value={amount}
                  onChangeText={setAmount}
                  placeholder="0.00"
                  placeholderTextColor={T.textSecondary}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            {/* ── Currency ── */}
            <View style={form.section}>
              <Text style={form.sectionLabel}>{t('expense.currency')}</Text>
              <CurrencyChips
                value={currency}
                onChange={(c) => { setCurrency(c); setCurrencyTouched(true); }}
                quickPicks={[smartDefaultCurrency(selectedTournament, tournaments), 'USD', 'EUR']}
              />
              {currency !== 'USD' && (
                <Text style={{ fontSize: 11, color: T.textSecondary, marginTop: 6 }}>{t('expense.currencyNote')}</Text>
              )}
            </View>

            {/* ── Date (hidden in monthly fixed mode, date derived from month/year) ── */}
            {!isMonthlyFixed && (
              <View style={form.section}>
                <DatePickerField label="date" value={date} onChange={(v) => {
                  setDate(v);
                  if (!manuallyPicked && !isFixedCat) {
                    const matched = matchTournamentByDate(v, tournaments);
                    setTournamentId(matched ?? '');
                  }
                }} />
              </View>
            )}

            {/* ── Note ── */}
            <View style={form.section}>
              <Text style={form.sectionLabel}>{t('expense.noteOptional')}</Text>
              <TextInput
                style={form.input}
                value={note}
                onChangeText={setNote}
                placeholder={t('expense.notePlaceholder')}
                placeholderTextColor={T.textSecondary}
              />
            </View>

            {/* ── Reimbursed toggle ── */}
            <View style={form.coachToggleRow}>
              <Text style={form.coachToggleLabel}>{t('expense.reimbursedToggle')}</Text>
              <Switch value={isReimbursed} onValueChange={setIsReimbursed}
                trackColor={{ false: T.cardBorder, true: T.teal }} thumbColor={T.textPrimary} />
            </View>

            {/* ── Split cost (collapsed by default) ── */}
            {splitOpen ? (
              <View style={form.section}>
                <Text style={form.sectionLabel}>{t('expense.myShare')}</Text>
                <View style={form.amountRow}>
                  <TextInput
                    style={form.amountInput}
                    value={sharePctText}
                    onChangeText={(v) => setSharePctText(v.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    placeholder="100"
                    placeholderTextColor={T.textSecondary}
                    maxLength={3}
                  />
                  <Text style={form.currencySign}>%</Text>
                </View>
                <Text style={{ fontSize: 11, color: T.textSecondary, marginTop: 6 }}>{t('expense.myShareHint')}</Text>
              </View>
            ) : (
              <TouchableOpacity style={form.customPill} onPress={() => setSplitOpen(true)} activeOpacity={0.7}>
                <Text style={form.customPillText}>{t('expense.splitCost')}</Text>
              </TouchableOpacity>
            )}

            {error ? <Text style={form.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[form.saveBtn, saving && { opacity: 0.7 }]}
              onPress={handleSave}
              activeOpacity={0.85}
              disabled={saving}>
              {saving
                ? <ActivityIndicator color={T.textPrimary} />
                : <Text style={form.saveBtnText}>{t('expense.saveExpense')}</Text>}
            </TouchableOpacity>

            {/* ── Mode switch link ── */}
            {!isMonthlyFixed ? (
              <TouchableOpacity
                style={form.fixedSwitchLink}
                onPress={() => { setIsMonthlyFixed(true); setCustomMode(false); setCategory('Flights'); }}
                activeOpacity={0.7}>
                <Text style={form.fixedSwitchLinkText}>{t('expense.switchToMonthlyFixed')}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={form.fixedSwitchLink}
                onPress={() => { setIsMonthlyFixed(false); setCategory('flight'); }}
                activeOpacity={0.7}>
                <Text style={form.fixedSwitchLinkText}>{t('expense.switchToNormal')}</Text>
              </TouchableOpacity>
            )}

            <View style={{ height: 20 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <ReceiptCaptureSheet
        visible={showScanSheet}
        onClose={() => setShowScanSheet(false)}
        onCaptured={handleReceiptCaptured}
      />
    </Modal>
  );
}

// ─── Edit Expense Modal ───────────────────────────────────────────────────────

function EditExpenseModal({ expense, onClose }: { expense: any; onClose: () => void }) {
  const { t, lang } = useLanguage();
  const monthNames        = lang === 'es' ? MONTH_NAMES_ES : MONTH_NAMES_EN;
  const personalCatLabels = PERSONAL_CAT_KEYS.map(k => t(k));
  const coachCatLabels    = COACH_CAT_KEYS.map(k => t(k));
  const demoCtx = useDemoData();
  const isCoach = COACH_CATS.includes(expense.category);
  const knownCat = [...PERSONAL_CATS, ...COACH_CATS, ...MONTHLY_FIXED_CATS].includes(expense.category);

  const expIsFixed = !!(expense.is_monthly_fixed || expense.isMonthlyFixed);
  const expFixedMonth = expense.fixed_month ?? expense.fixedMonth ?? null;
  const nowEdit = new Date();
  const initMonth = expIsFixed && expFixedMonth
    ? parseInt(expFixedMonth.split('-')[1], 10)
    : nowEdit.getMonth() + 1;
  const initYear = expIsFixed && expFixedMonth
    ? parseInt(expFixedMonth.split('-')[0], 10)
    : nowEdit.getFullYear();

  const [isMonthlyFixed, setIsMonthlyFixed] = useState(expIsFixed);
  const [fixedMonth,     setFixedMonth]     = useState(initMonth);
  const [fixedYear,      setFixedYear]      = useState(initYear);
  const [withCoach,  setWithCoach]  = useState(isCoach);
  const [category,   setCategory]   = useState(expense.category ?? 'Flights');
  const [customMode, setCustomMode] = useState(!knownCat);
  const [customText, setCustomText] = useState(knownCat ? '' : expense.category ?? '');
  const [amount,     setAmount]     = useState(String(expense.amount ?? ''));
  const [currency,   setCurrency]   = useState(expense.currency ?? 'USD');
  const [date,       setDate]       = useState(expense.date ?? todayIso());
  const [note,       setNote]       = useState(expense.note ?? '');
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');

  // Reimbursed + split-cost — collapsed by default unless already split
  const initialSharePct = expense.sharePct ?? expense.share_pct ?? 100;
  const [isReimbursed, setIsReimbursed] = useState(!!(expense.isReimbursed ?? expense.is_reimbursed));
  const [splitOpen,    setSplitOpen]    = useState(initialSharePct !== 100);
  const [sharePctText, setSharePctText] = useState(String(initialSharePct));

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
    // Accept comma decimals — locale decimal-pad keyboards only offer ","
    const amt = parseFloat(amount.replace(',', '.'));
    if (isNaN(amt) || amt <= 0) { setError(t('expense.validAmount')); return; }
    if (!isMonthlyFixed && !date) { setError(t('expense.selectDate')); return; }
    const finalCategory = customMode ? customText.trim() : category;
    if (!finalCategory) { setError(t('expense.selectCategory')); return; }
    setSaving(true); setError('');
    const fixedMonthStr = `${fixedYear}-${String(fixedMonth).padStart(2, '0')}`;
    const sharePctVal = (() => {
      const n = parseInt(sharePctText, 10);
      return !isNaN(n) && n >= 1 && n <= 100 ? n : 100;
    })();
    // Recompute the indicative USD value whenever amount or currency changed
    // from what was originally stored; null when USD or the rate is unavailable.
    const amountUsd = currency !== 'USD' ? await toUsd(amt, currency) : null;
    const updates: Record<string, any> = {
      category: finalCategory,
      amount: amt,
      currency,
      note: note.trim(),
      date: isMonthlyFixed ? `${fixedMonthStr}-01` : date,
      isCoachExpense: isMonthlyFixed ? false : COACH_CATS.includes(finalCategory),
      isMonthlyFixed,
      fixedMonth: isMonthlyFixed ? fixedMonthStr : null,
      tournamentId: isMonthlyFixed ? null : (expense.tournament_id ?? expense.tournamentId ?? null),
      isReimbursed,
      sharePct: sharePctVal,
      amountUsd,
    };
    try {
      if (DEMO_MODE) {
        demoCtx?.patchExpense(expense.id, updates);
      } else {
        await apiUpdateExpense(expense.id, updates);
      }
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
              <Text style={form.backText}>{t('common.back')}</Text>
            </TouchableOpacity>
            <Text style={form.headerTitle}>{t('expense.editExpense')}</Text>
            <View style={form.backBtn} />
          </View>

          <ScrollView style={form.scroll} contentContainerStyle={form.scrollContent}
            keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

            {/* ── Monthly fixed banner ── */}
            {isMonthlyFixed && (
              <View style={form.fixedBanner}>
                <Text style={form.fixedBannerText}>{t('expense.monthlyFixedBanner')}</Text>
              </View>
            )}

            {/* ── Category ── */}
            <View style={form.section}>
              <Text style={form.sectionLabel}>{t('expense.category')}</Text>
              {!isMonthlyFixed && <Text style={form.subLabel}>{t('expense.personal')}</Text>}
              <View style={form.chipRow}>
                {(isMonthlyFixed ? MONTHLY_FIXED_CATS : PERSONAL_CATS).map((c, i) => (
                  <TouchableOpacity key={c}
                    style={[form.chip, category === c && !customMode && form.chipActive]}
                    onPress={() => selectCategory(c)} activeOpacity={0.7}>
                    <Text style={[form.chipText, category === c && !customMode && form.chipTextActive]}>
                      {isMonthlyFixed ? c : personalCatLabels[i]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {!isMonthlyFixed && (
                <>
                  <Text style={[form.subLabel, { marginTop: 12 }]}>{t('expense.coach')}</Text>
                  <View style={form.chipRow}>
                    {COACH_CATS.map((c, i) => (
                      <TouchableOpacity key={c}
                        style={[form.chip, category === c && !customMode && form.chipActive]}
                        onPress={() => selectCategory(c)} activeOpacity={0.7}>
                        <Text style={[form.chipText, category === c && !customMode && form.chipTextActive]}>{coachCatLabels[i]}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              {customMode ? (
                <View style={form.customRow}>
                  <TextInput style={form.customInput} value={customText} onChangeText={setCustomText}
                    placeholder={t('expense.customCategoryName')} placeholderTextColor={T.textSecondary}
                    autoFocus returnKeyType="done" onSubmitEditing={confirmCustom} />
                  <TouchableOpacity style={form.customDoneBtn} onPress={confirmCustom} activeOpacity={0.8}>
                    <Text style={form.customDoneText}>{t('common.done')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={form.customPill}
                  onPress={() => { setCustomMode(true); setCustomText(''); }} activeOpacity={0.7}>
                  <Text style={form.customPillText}>{t('expense.addCustom')}</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* ── Month & Year picker (monthly fixed mode only) ── */}
            {isMonthlyFixed && (
              <View style={form.section}>
                <Text style={form.sectionLabel}>{t('expense.selectMonthYear')}</Text>
                <View style={form.monthYearRow}>
                  <ScrollView style={form.monthPicker} showsVerticalScrollIndicator={false} nestedScrollEnabled>
                    {monthNames.map((name, i) => {
                      const m = i + 1;
                      return (
                        <TouchableOpacity key={m}
                          style={[form.monthPickerRow, fixedMonth === m && form.monthPickerRowActive]}
                          onPress={() => setFixedMonth(m)} activeOpacity={0.7}>
                          <Text style={[form.monthPickerText, fixedMonth === m && form.monthPickerTextActive]}>{name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  <View style={form.yearPicker}>
                    {[fixedYear - 1, fixedYear, fixedYear + 1].map((y) => (
                      <TouchableOpacity key={y}
                        style={[form.monthPickerRow, fixedYear === y && form.monthPickerRowActive]}
                        onPress={() => setFixedYear(y)} activeOpacity={0.7}>
                        <Text style={[form.monthPickerText, fixedYear === y && form.monthPickerTextActive]}>{y}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            )}

            {/* ── Amount ── */}
            <View style={form.section}>
              <Text style={form.sectionLabel}>{t('expense.amount')}</Text>
              <View style={form.amountRow}>
                <Text style={form.currencySign}>{currency === 'USD' ? '$' : currency}</Text>
                <TextInput style={form.amountInput} value={amount} onChangeText={setAmount}
                  placeholder="0.00" placeholderTextColor={T.textSecondary} keyboardType="decimal-pad" />
              </View>
            </View>

            {/* ── Currency ── */}
            <View style={form.section}>
              <Text style={form.sectionLabel}>{t('expense.currency')}</Text>
              <CurrencyChips
                value={currency}
                onChange={setCurrency}
                quickPicks={[expense.currency ?? 'USD', 'USD', 'EUR']}
              />
              {currency !== 'USD' && (
                <Text style={{ fontSize: 11, color: T.textSecondary, marginTop: 6 }}>{t('expense.currencyNote')}</Text>
              )}
            </View>

            {/* ── Date (regular mode only) ── */}
            {!isMonthlyFixed && (
              <View style={form.section}>
                <DatePickerField label="date" value={date} onChange={setDate} />
              </View>
            )}

            {/* ── Note ── */}
            <View style={form.section}>
              <Text style={form.sectionLabel}>{t('expense.noteOptional')}</Text>
              <TextInput style={form.input} value={note} onChangeText={setNote}
                placeholder={t('expense.notePlaceholder')} placeholderTextColor={T.textSecondary} />
            </View>

            {/* ── Reimbursed toggle ── */}
            <View style={form.coachToggleRow}>
              <Text style={form.coachToggleLabel}>{t('expense.reimbursedToggle')}</Text>
              <Switch value={isReimbursed} onValueChange={setIsReimbursed}
                trackColor={{ false: T.cardBorder, true: T.teal }} thumbColor={T.textPrimary} />
            </View>

            {/* ── Split cost (collapsed by default) ── */}
            {splitOpen ? (
              <View style={form.section}>
                <Text style={form.sectionLabel}>{t('expense.myShare')}</Text>
                <View style={form.amountRow}>
                  <TextInput
                    style={form.amountInput}
                    value={sharePctText}
                    onChangeText={(v) => setSharePctText(v.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    placeholder="100"
                    placeholderTextColor={T.textSecondary}
                    maxLength={3}
                  />
                  <Text style={form.currencySign}>%</Text>
                </View>
                <Text style={{ fontSize: 11, color: T.textSecondary, marginTop: 6 }}>{t('expense.myShareHint')}</Text>
              </View>
            ) : (
              <TouchableOpacity style={form.customPill} onPress={() => setSplitOpen(true)} activeOpacity={0.7}>
                <Text style={form.customPillText}>{t('expense.splitCost')}</Text>
              </TouchableOpacity>
            )}

            {error ? <Text style={form.error}>{error}</Text> : null}

            <TouchableOpacity style={[form.saveBtn, saving && { opacity: 0.7 }]}
              onPress={handleSave} activeOpacity={0.85} disabled={saving}>
              {saving ? <ActivityIndicator color={T.textPrimary} /> : <Text style={form.saveBtnText}>{t('expense.saveChanges')}</Text>}
            </TouchableOpacity>

            {/* ── Mode switch link ── */}
            {!isMonthlyFixed ? (
              <TouchableOpacity style={form.fixedSwitchLink}
                onPress={() => { setIsMonthlyFixed(true); setCustomMode(false); setCategory('Flights'); }}
                activeOpacity={0.7}>
                <Text style={form.fixedSwitchLinkText}>{t('expense.switchToMonthlyFixed')}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={form.fixedSwitchLink}
                onPress={() => { setIsMonthlyFixed(false); setCategory('Flights'); }}
                activeOpacity={0.7}>
                <Text style={form.fixedSwitchLinkText}>{t('expense.switchToNormal')}</Text>
              </TouchableOpacity>
            )}

            <View style={{ height: 20 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Expense action sheet ─────────────────────────────────────────────────────

function ExpenseActionSheet({ expense, onEdit, onDelete, onLink, onCancel }: {
  expense: any; onEdit: () => void; onDelete: () => void; onLink: () => void; onCancel: () => void;
}) {
  const { t } = useLanguage();
  const label = [expense.category, expense.note].filter(Boolean).join(' · ');
  const isLinked = !!expense.tournamentId;
  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={sheet.backdrop} onPress={onCancel}>
        <Pressable style={sheet.container} onPress={() => {}}>
          <View style={sheet.handle} />
          <Text style={sheet.title} numberOfLines={1}>{label}</Text>
          <Text style={sheet.amount}>{fmtRowAmount(expense)}</Text>

          <TouchableOpacity style={sheet.row} onPress={onEdit} activeOpacity={0.75}>
            <Text style={sheet.rowIcon}>✏️</Text>
            <Text style={sheet.rowLabel}>{t('expense.editAction')}</Text>
            <Text style={[sheet.rowArrow, { color: T.teal }]}>›</Text>
          </TouchableOpacity>

          <View style={sheet.rowDivider} />

          <TouchableOpacity style={sheet.row} onPress={onLink} activeOpacity={0.75}>
            <Text style={sheet.rowIcon}>{isLinked ? '🔗' : '🏆'}</Text>
            <Text style={sheet.rowLabel}>{isLinked ? 'Unlink from Tournament' : 'Link to Tournament'}</Text>
            <Text style={[sheet.rowArrow, { color: T.accent }]}>›</Text>
          </TouchableOpacity>

          <View style={sheet.rowDivider} />

          <TouchableOpacity style={sheet.row} onPress={onDelete} activeOpacity={0.75}>
            <Text style={sheet.rowIcon}>🗑️</Text>
            <Text style={[sheet.rowLabel, { color: T.red }]}>{t('expense.deleteAction')}</Text>
            <Text style={[sheet.rowArrow, { color: T.red }]}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={sheet.cancelBtn} onPress={onCancel} activeOpacity={0.8}>
            <Text style={sheet.cancelText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Link to Tournament modal ─────────────────────────────────────────────────

type TournamentOption = {
  id?: string;
  name: string;
  startDate: string;
  endDate?: string;
  surface?: string;
  country?: string | null;
};

// Accepts one OR many expenses — links all of them to the chosen tournament.
function LinkTournamentModal({ expenses, tournaments, onClose }: {
  expenses: any[]; tournaments: any[]; onClose: () => void;
}) {
  const demoCtx = useDemoData();
  // null = still loading; [] = loaded with no scraped results
  const [scrapedOptions, setScrapedOptions] = useState<TournamentOption[] | null>(
    DEMO_MODE ? [] : null
  );
  const [linking, setLinking] = useState(false);
  const currentYear = new Date().getFullYear();
  const todayStr = new Date().toISOString().slice(0, 10);

  // Fetch scraped match history from player_profiles — same source as My Performance.
  // Start immediately on mount so data arrives as the slide animation completes.
  useEffect(() => {
    if (DEMO_MODE) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { setScrapedOptions([]); return; }
      supabase.from('profiles').select('atp_player_name').eq('id', user.id).single()
        .then(({ data: prof }) => {
          if (!prof?.atp_player_name) { setScrapedOptions([]); return; }
          const nameParts = prof.atp_player_name.trim().split(/\s+/).slice(0, 2).join(' ');
          supabase.from('player_profiles').select('match_history')
            .or(playerNameFilter(nameParts))
            .order('last_updated', { ascending: false }).limit(1)
            .then(({ data }) => {
              if (!data?.[0]?.match_history) { setScrapedOptions([]); return; }
              const history: any[] = data[0].match_history;
              const seen = new Set<string>();
              const opts: TournamentOption[] = [];
              history.forEach((m: any) => {
                const name = m.tournamentName ?? '';
                const startDate = m.date ?? '';
                if (!name || !startDate) return;
                // Current year only; match_history entries are played matches so
                // startDate < today is sufficient — no need for the +6-day end-of-week guard
                // that was silently dropping tournaments stored with mid-week dates (e.g. Quito).
                if (!startDate.startsWith(String(currentYear))) return;
                if (startDate >= todayStr) return;
                const key = `${name}|${startDate}`;
                if (seen.has(key)) return;
                seen.add(key);
                opts.push({ name, startDate, surface: m.surface });
              });
              setScrapedOptions(opts);
            }, () => setScrapedOptions([]));
        }, () => setScrapedOptions([]));
    }).catch((err) => {
      console.warn('[expenses] scraped history fetch failed', err);
      setScrapedOptions([]);
    });
  }, []);

  const pastTournaments = useMemo(() => {
    const now = new Date();
    const existing: TournamentOption[] = tournaments
      .filter((t: any) => {
        if (!t.startDate || !t.startDate.startsWith(String(currentYear))) return false;
        const endStr = t.endDate ?? (() => {
          const d = new Date(t.startDate + 'T00:00:00');
          d.setDate(d.getDate() + 6);
          return d.toISOString().slice(0, 10);
        })();
        return new Date(endStr + 'T23:59:59') < now;
      })
      .map((t: any) => ({
        id: t.id,
        name: t.name ?? `${t.category ?? ''} ${t.city ?? ''}`.trim(),
        startDate: t.startDate ?? '',
        surface: t.surface,
      }));

    // Don't compute until scraped fetch is done (null = still loading)
    if (scrapedOptions === null) return null;

    // Deduplicate by name+date combined — same tournament name on different weeks = different event
    const existingKeys = new Set(existing.map(t => `${t.name.toLowerCase()}|${t.startDate}`));
    const scraped = scrapedOptions.filter(s => !existingKeys.has(`${s.name.toLowerCase()}|${s.startDate}`));

    return [...existing, ...scraped].sort((a, b) => b.startDate.localeCompare(a.startDate));
  }, [tournaments, scrapedOptions, currentYear]);

  const isLoading = pastTournaments === null;

  async function link(opt: TournamentOption | null) {
    setLinking(true);
    try {
      if (!opt) {
        // Unlink all
        for (const exp of expenses) {
          if (DEMO_MODE) { demoCtx?.patchExpense?.(exp.id, { tournamentId: null }); }
          else { await apiUpdateExpense(exp.id, { tournamentId: null }); }
        }
        onClose();
        return;
      }
      let tournamentId = opt.id;
      if (!tournamentId && !DEMO_MODE) {
        // Scraped tournament — auto-create a minimal record so the FK works.
        // Derive endDate from startDate + 6 days (ITF/Challenger standard week) if not supplied.
        const derivedEnd = opt.endDate ?? (() => {
          if (!opt.startDate) return undefined;
          const [y, m, d] = (opt.startDate as string).split('-').map(Number);
          const end = new Date(y, m - 1, d + 6);
          return `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;
        })();
        const row = await apiAddTournament({
          name: opt.name,
          startDate: opt.startDate,
          endDate: derivedEnd,
          country: opt.country ?? null,
          surface: opt.surface ?? null,
          isRegistered: false,
          isWithdrawn: false,
          isInMyList: false,
          prizeMoney: 0,
          singlesPrizeMoney: 0,
          doublesPrizeMoney: 0,
        });
        tournamentId = row?.id;
      }
      for (const exp of expenses) {
        if (DEMO_MODE) {
          // Only real ids — a tournament name is not a valid link target.
          if (opt.id) demoCtx?.patchExpense?.(exp.id, { tournamentId: opt.id });
        } else if (tournamentId) {
          await apiUpdateExpense(exp.id, { tournamentId });
        }
      }
      onClose();
    } catch (e: any) {
      Alert.alert('Could not link expenses', e?.message ?? 'Please try again.');
    } finally {
      setLinking(false);
    }
  }

  const anyLinked = expenses.some(e => !!e.tournamentId);

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={sheet.backdrop} onPress={onClose}>
        <Pressable style={[sheet.container, { maxHeight: '75%' }]} onPress={() => {}}>
          <View style={sheet.handle} />
          <Text style={[sheet.title, { marginBottom: 4 }]}>Link to Tournament</Text>
          {expenses.length > 1 && (
            <Text style={{ fontSize: 12, color: '#6060A0', marginBottom: 8, textAlign: 'center' }}>
              {expenses.length} expenses will be linked
            </Text>
          )}
          {anyLinked && !isLoading && (
            <TouchableOpacity style={sheet.row} onPress={() => link(null)} activeOpacity={0.75} disabled={linking}>
              <Text style={sheet.rowIcon}>🔗</Text>
              <Text style={[sheet.rowLabel, { color: T.red }]}>Remove tournament link</Text>
              <Text style={[sheet.rowArrow, { color: T.red }]}>›</Text>
            </TouchableOpacity>
          )}
          {isLoading ? (
            <View style={{ paddingVertical: 32, alignItems: 'center' }}>
              <ActivityIndicator color={T.accent} />
            </View>
          ) : pastTournaments!.length === 0 ? (
            <Text style={{ color: '#6060A0', textAlign: 'center', marginVertical: 24 }}>
              No past tournaments found for {currentYear}
            </Text>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {pastTournaments!.map((t) => (
                <TouchableOpacity key={t.id ?? `${t.name}|${t.startDate}`} style={sheet.row} onPress={() => link(t)} activeOpacity={0.75} disabled={linking}>
                  <Text style={sheet.rowIcon}>🏆</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={sheet.rowLabel} numberOfLines={1}>{t.name}</Text>
                    <Text style={{ fontSize: 11, color: '#6060A0' }}>{t.startDate}</Text>
                  </View>
                  {linking ? <ActivityIndicator size="small" color={T.accent} /> : <Text style={[sheet.rowArrow, { color: T.accent }]}>›</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          <TouchableOpacity style={sheet.cancelBtn} onPress={onClose} activeOpacity={0.8} disabled={linking}>
            <Text style={sheet.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Delete confirmation dialog ───────────────────────────────────────────────

function DeleteExpenseDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const { t } = useLanguage();
  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={sheet.dialogBackdrop} onPress={onCancel}>
        <Pressable style={sheet.dialog} onPress={() => {}}>
          <Text style={sheet.dialogTitle}>{t('expense.deleteConfirm')}</Text>
          <Text style={sheet.dialogBody}>{t('expense.cannotUndo')}</Text>
          <View style={sheet.dialogActions}>
            <TouchableOpacity style={sheet.dialogCancel} onPress={onCancel} activeOpacity={0.7}>
              <Text style={sheet.dialogCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={sheet.dialogDelete} onPress={onConfirm} activeOpacity={0.8}>
              <Text style={sheet.dialogDeleteText}>{t('common.delete')}</Text>
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
    const val = parseFloat(input.replace(',', '.'));
    setEditing(false);
    if (!isNaN(val) && val >= 0) {
      setDisplayAmount(val); // optimistic — show immediately
      setSaving(true);
      try { await onSave(val); }
      finally { setSaving(false); }
    }
  }

  const { t } = useLanguage();

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
            placeholderTextColor={T.textSecondary}
          />
          <TouchableOpacity onPress={handleSave} activeOpacity={0.7} style={det.prizeDoneBtn}>
            <Text style={det.prizeDoneText}>{t('common.done')}</Text>
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
        <Text style={det.prizeEmpty}>{t('prize.addPrizeMoney')}</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Tournament expense detail ────────────────────────────────────────────────

// ── Scraped match results for a played tournament (from player_profiles) ─────
// Matches the tournament by (name, startDate) against the player's match_history.
function ScrapedResultsSection({ tournament }: { tournament: any }) {
  const { t: tr } = useLanguage();
  const [entry, setEntry] = useState<any | null>(null);

  useEffect(() => {
    if (DEMO_MODE) return;
    let cancelled = false;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || cancelled) return;
      supabase.from('profiles').select('atp_player_name').eq('id', user.id).single()
        .then(({ data: prof }) => {
          if (!prof?.atp_player_name || cancelled) return;
          const nameParts = prof.atp_player_name.trim().split(/\s+/).slice(0, 2).join(' ');
          supabase.from('player_profiles').select('match_history')
            .or(playerNameFilter(nameParts))
            .order('last_updated', { ascending: false }).limit(1)
            .then(({ data }) => {
              if (cancelled) return;
              const history: any[] = data?.[0]?.match_history ?? [];
              const found = history.find((m: any) =>
                (m.tournamentName ?? '').trim().toLowerCase() === (tournament.name ?? '').trim().toLowerCase() &&
                m.date === tournament.startDate);
              setEntry(found ?? null);
            }, () => {});
        }, () => {});
    }).catch((err) => console.warn('[expenses] match results fetch failed', err));
    return () => { cancelled = true; };
  }, [tournament.id, tournament.name, tournament.startDate]);

  if (!entry) return null; // no scraped results for this week — section simply absent

  const matches: any[] = [...(entry.matches ?? [])].reverse(); // chronological: Q1 → deepest round
  return (
    <>
      <Text style={det.sectionLabel}>{tr('tournament.matchResults')}</Text>
      <View style={det.prizeCard}>
        {matches.map((m: any, i: number) => (
          <View key={i}>
            {i > 0 && <View style={det.prizeDivider} />}
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 }}>
              <Text style={{ width: 36, fontSize: 12, fontWeight: '700', color: T.textTertiary }}>{m.round}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: T.textPrimary }} numberOfLines={1}>{m.opponent}</Text>
                <Text style={{ fontSize: 12, color: T.textTertiary, marginTop: 1 }}>{m.score}</Text>
              </View>
              <Text style={{ fontSize: 13, fontWeight: '800', color: m.playerWon ? T.green : T.red }}>
                {m.playerWon ? 'W' : 'L'}
              </Text>
            </View>
          </View>
        ))}
        <View style={det.prizeDivider} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 14 }}>
          <Text style={{ fontSize: 12, color: T.textTertiary }}>
            {tr('tournament.pointsEarned')}{': '}
            <Text style={{ color: T.textPrimary, fontWeight: '700' }}>+{entry.pointsEarned ?? 0}</Text>
          </Text>
          {entry.rankingThatWeek != null && (
            <Text style={{ fontSize: 12, color: T.textTertiary }}>
              {tr('tournament.rankingThatWeek')}{': '}
              <Text style={{ color: T.textPrimary, fontWeight: '700' }}>#{entry.rankingThatWeek}</Text>
            </Text>
          )}
        </View>
      </View>
    </>
  );
}

export function TournamentExpenseDetail({ tournament, onClose, allTournaments }: {
  tournament: any; onClose: () => void; allTournaments: any[];
}) {
  const { t: tr } = useLanguage();
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
  const [linkExpenses,    setLinkExpenses]    = useState<any[]>([]);
  const [deleting,        setDeleting]        = useState(false);

  async function confirmDelete(expense: any) {
    setDeleting(true);
    try {
      if (DEMO_MODE) {
        demoCtx?.deleteExpense(expense.id);
      } else {
        await apiDeleteExpense(expense.id);
      }
    } catch (e: any) {
      Alert.alert('Could not delete', e?.message ?? 'Please try again.');
    } finally { setDeleting(false); setDeleteExpense(null); }
  }

  const sortedExpenses = [...expenses].sort((a: any, b: any) =>
    (b.date ?? '').localeCompare(a.date ?? '')
  );
  const totalSpent   = effectiveSum(expenses);
  // Read prize money from live record only; default 0 until data loads
  const singlesPrize = (liveT?.singlesPrizeMoney ?? tournament.singlesPrizeMoney) ?? 0;
  const doublesPrize = (liveT?.doublesPrizeMoney ?? tournament.doublesPrizeMoney) ?? 0;
  // Legacy records only have prizeMoney — fall back for the total
  const totalPrize   = (singlesPrize + doublesPrize) > 0
    ? singlesPrize + doublesPrize
    : ((liveT?.prizeMoney ?? tournament.prizeMoney) ?? 0);
  const net          = totalPrize - totalSpent;

  const surfaceBg   = SURFACE_BG[(t.surface as Surface)] ?? '#FAEEDA';
  const SURFACE_TEXT_MAP: Record<string, string> = { clay: T.clayText, hard: T.hardText, grass: T.grassText };
  const surfaceText = SURFACE_TEXT_MAP[t.surface as Surface] ?? '#854F0B';
  const dateRange   = [t.startDate, t.endDate].filter(Boolean).join(' – ');

  async function saveSingles(val: number) {
    if (DEMO_MODE) {
      demoCtx?.patchTournament(t.id, { singlesPrizeMoney: val, prizeMoney: val + doublesPrize });
    } else {
      await apiPatchTournament(t.id, { singlesPrizeMoney: val, prizeMoney: val + doublesPrize });
    }
  }

  async function saveDoubles(val: number) {
    if (DEMO_MODE) {
      demoCtx?.patchTournament(t.id, { doublesPrizeMoney: val, prizeMoney: singlesPrize + val });
    } else {
      await apiPatchTournament(t.id, { doublesPrizeMoney: val, prizeMoney: singlesPrize + val });
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={det.safe}>

        {/* Nav bar */}
        <View style={det.navbar}>
          <TouchableOpacity onPress={onClose} style={det.backBtn} activeOpacity={0.7}>
            <Text style={det.backText}>{tr('common.back')}</Text>
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">

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

            {/* ── MATCH RESULTS (played tournaments with scraped history) ── */}
            {!!t.startDate && t.startDate < new Date().toISOString().slice(0, 10) && (
              <ScrapedResultsSection tournament={t} />
            )}

            {/* ── PRIZE MONEY ── */}
            <Text style={det.sectionLabel}>{tr('prize.prizeMoney')}</Text>
            <View style={det.prizeCard}>
              <PrizeRow label={tr('prize.singles')} icon="🎾" amount={singlesPrize} onSave={saveSingles} />
              <View style={det.prizeDivider} />
              <PrizeRow label={tr('prize.doubles')} icon="🤝" amount={doublesPrize} onSave={saveDoubles} />
            </View>

            {/* ── EXPENSES ── */}
            <Text style={det.sectionLabel}>{tr('prize.expensesLabel')}</Text>
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
                      <Text style={det.expenseAmt}>{fmtRowAmount(e)}</Text>
                      {e.currency && e.currency !== 'USD' && e.amountUsd != null && (
                        <Text style={det.expenseDate}>≈ {fmt(e.amountUsd)}</Text>
                      )}
                      <Text style={det.expenseDate}>{e.date}</Text>
                    </View>
                    <Text style={det.expenseMoreDot}>⋯</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={det.noExpensesText}>{tr('prize.noExpenses')}</Text>
            )}

            {/* ── SUMMARY ── */}
            <View style={det.summaryCard}>
              <View style={det.summaryRow}>
                <Text style={det.summaryLabel}>{tr('prize.totalSpent')}</Text>
                <Text style={det.summaryAmt}>{fmt(totalSpent)}</Text>
              </View>
              <View style={det.summaryDivider} />
              <View style={det.summaryRow}>
                <Text style={[det.summaryLabel, { fontWeight: '700' }]}>{tr('expenses.net')}</Text>
                <Text style={[det.summaryAmt, { fontWeight: '700' }, net < 0 ? det.netNeg : det.netPos]}>
                  {net >= 0 ? '+' : ''}{fmt(net)}
                </Text>
              </View>
            </View>

            <TouchableOpacity style={det.addExpenseBtn} onPress={() => setShowAddExpense(true)} activeOpacity={0.85}>
              <Text style={det.addExpenseBtnText}>{tr('tournament.addExpense')}</Text>
            </TouchableOpacity>

          </View>
        </ScrollView>
        </KeyboardAvoidingView>
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
          onLink={() => { setLinkExpenses([actionExpense]); setActionExpense(null); }}
          onCancel={() => setActionExpense(null)}
        />
      )}

      {linkExpenses.length > 0 && (
        <LinkTournamentModal
          expenses={linkExpenses}
          tournaments={allTournaments}
          onClose={() => setLinkExpenses([])}
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

// ─── Paste from Notes Modal ───────────────────────────────────────────────────

type PasteItem = ParsedExpense & { selected: boolean; id: string };

function PasteFromNotesModal({ tournaments, onClose }: {
  tournaments: any[]; onClose: () => void;
}) {
  const { t } = useLanguage();
  const demoCtx = useDemoData();
  const generateInsight = useGenerateInsight();

  const [rawText,      setRawText]      = useState('');
  const [parsed,       setParsed]       = useState<PasteItem[]>([]);
  const [step,         setStep]         = useState<'paste' | 'review'>('paste');
  const [tournamentId, setTournamentId] = useState('__auto__');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [importing,    setImporting]    = useState(false);
  const [error,        setError]        = useState('');

  const isAutoMatch = tournamentId === '__auto__';
  const selectedTournament = isAutoMatch ? null : tournaments.find((t: any) => t.id === tournamentId);

  function handleParse() {
    const results = parseNotes(rawText);
    if (results.length === 0) {
      setError('No expenses found. Try pasting lines like "Flight $350" or "Hotel – $120 – 15/06/2025".');
      return;
    }
    setError('');
    setParsed(results.map((r, i) => ({ ...r, selected: true, id: `parsed-${i}-${Date.now()}` })));
    setStep('review');
  }

  function toggleItem(id: string) {
    setParsed(prev => prev.map(p => p.id === id ? { ...p, selected: !p.selected } : p));
  }

  function toggleAll() {
    const allSelected = parsed.every(p => p.selected);
    setParsed(prev => prev.map(p => ({ ...p, selected: !allSelected })));
  }

  async function handleImport() {
    const toImport = parsed.filter(p => p.selected);
    if (toImport.length === 0) { setError('Select at least one expense to import.'); return; }
    setImporting(true);
    setError('');
    const isAuto = tournamentId === '__auto__';
    try {
      if (DEMO_MODE) {
        for (const item of toImport) {
          const isFixed = FIXED_CATS.has(item.category.toLowerCase());
          let tId: string | undefined;
          if (isAuto && !isFixed) {
            tId = matchTournamentByDate(item.date ?? undefined, tournaments);
          } else if (isAuto) {
            tId = undefined;
          } else {
            tId = tournamentId === '' ? undefined : tournamentId;
          }
          demoCtx?.addExpense({
            id: genId(),
            tournamentId: tId,
            category: item.category.toLowerCase(),
            amount: item.amount,
            note: item.description,
            date: item.date ?? todayIso(),
            isCoachExpense: false,
          });
        }
        onClose();
      } else {
        await Promise.all(toImport.map(item => {
          const isFixed = FIXED_CATS.has(item.category.toLowerCase());
          let tId: string | undefined;
          if (isAuto && !isFixed) {
            tId = matchTournamentByDate(item.date ?? undefined, tournaments);
          } else if (isAuto) {
            tId = undefined;
          } else {
            tId = tournamentId === '' ? undefined : tournamentId;
          }
          return apiAddExpense({
            tournamentId: tId,
            category: item.category.toLowerCase(),
            amount: item.amount,
            note: item.description,
            date: item.date ?? todayIso(),
            isCoachExpense: false,
          });
        }));
        generateInsight.mutate({ trigger: 'expense_logged' });
        onClose();
      }
    } catch (e: any) {
      setError(e?.message ?? 'Import failed. Try again.');
      setImporting(false);
    }
  }

  const selectedCount = parsed.filter(p => p.selected).length;
  const allSelected   = parsed.length > 0 && parsed.every(p => p.selected);

  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={form.safe}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

          {/* Header */}
          <View style={form.header}>
            <TouchableOpacity
              onPress={step === 'review' ? () => { setStep('paste'); setError(''); } : onClose}
              style={form.backBtn} activeOpacity={0.7}>
              <Text style={form.backText}>{t('common.back')}</Text>
            </TouchableOpacity>
            <Text style={form.headerTitle}>{step === 'paste' ? t('paste.title') : t('paste.reviewTitle')}</Text>
            <View style={form.backBtn} />
          </View>

          {step === 'paste' ? (
            <ScrollView style={form.scroll} contentContainerStyle={form.scrollContent}
              keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

              {/* Tournament selector */}
              {tournaments.length > 0 && (
                <View style={form.section}>
                  <Text style={form.sectionLabel}>LINK TO TOURNAMENT (OPTIONAL)</Text>
                  <TouchableOpacity style={form.dropdown} onPress={() => setDropdownOpen(o => !o)} activeOpacity={0.8}>
                    <Text style={(isAutoMatch || selectedTournament) ? form.dropdownValue : form.dropdownPlaceholder} numberOfLines={1}>
                      {isAutoMatch
                        ? '🔄 Auto-match by date'
                        : selectedTournament
                        ? `${selectedTournament.country ? countryFlag(selectedTournament.country) + ' ' : ''}${selectedTournament.name}`
                        : 'No tournament (general expense)'}
                    </Text>
                    <Text style={form.dropdownChevron}>{dropdownOpen ? '▲' : '▼'}</Text>
                  </TouchableOpacity>
                  {dropdownOpen && (
                    <View style={form.dropdownList}>
                      <TouchableOpacity
                        style={[form.dropdownRow, isAutoMatch && form.dropdownRowActive]}
                        onPress={() => { setTournamentId('__auto__'); setDropdownOpen(false); }}
                        activeOpacity={0.75}>
                        <Text style={[form.dropdownRowText, isAutoMatch && form.dropdownRowTextActive]}>🔄 Auto-match by date</Text>
                        {isAutoMatch && <Text style={form.dropdownCheck}>✓</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[form.dropdownRow, tournamentId === '' && form.dropdownRowActive]}
                        onPress={() => { setTournamentId(''); setDropdownOpen(false); }}
                        activeOpacity={0.75}>
                        <Text style={[form.dropdownRowText, tournamentId === '' && form.dropdownRowTextActive]}>No tournament</Text>
                        {tournamentId === '' && <Text style={form.dropdownCheck}>✓</Text>}
                      </TouchableOpacity>
                      {tournaments.map((t: any) => (
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

              {/* Paste area */}
              <View style={form.section}>
                <Text style={form.sectionLabel}>PASTE YOUR NOTES</Text>
                <Text style={pn.hint}>
                  Paste anything — one expense per line. Amounts like $350, "350 USD", or standalone numbers work. Dates and categories are auto-detected.
                </Text>
                <TextInput
                  style={pn.textArea}
                  value={rawText}
                  onChangeText={setRawText}
                  placeholder={'ex.\nFlight SCL → MIA $480\nHotel 5 nights $320 15/06/2025\nMeals $45'}
                  placeholderTextColor={T.textMuted}
                  multiline
                  textAlignVertical="top"
                  autoFocus
                />
              </View>

              {error ? <Text style={form.error}>{error}</Text> : null}

              <TouchableOpacity
                style={[form.saveBtn, !rawText.trim() && { opacity: 0.45 }]}
                onPress={handleParse}
                activeOpacity={0.85}
                disabled={!rawText.trim()}>
                <Text style={form.saveBtnText}>Parse Expenses</Text>
              </TouchableOpacity>

              <View style={{ height: 20 }} />
            </ScrollView>
          ) : (
            /* Review step */
            <View style={{ flex: 1 }}>
              <ScrollView style={form.scroll} contentContainerStyle={[form.scrollContent, { paddingBottom: 110 }]}
                showsVerticalScrollIndicator={false}>

                <View style={pn.reviewHeader}>
                  <Text style={pn.reviewCount}>{parsed.length} expense{parsed.length !== 1 ? 's' : ''} found</Text>
                  <TouchableOpacity onPress={toggleAll} activeOpacity={0.7}>
                    <Text style={pn.selectAllText}>{allSelected ? 'Deselect all' : 'Select all'}</Text>
                  </TouchableOpacity>
                </View>

                {parsed.map((item) => (
                  <TouchableOpacity key={item.id} style={pn.reviewRow} onPress={() => toggleItem(item.id)} activeOpacity={0.75}>
                    <View style={[pn.checkbox, item.selected && pn.checkboxOn]}>
                      {item.selected && <Text style={pn.checkmark}>✓</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Text style={pn.reviewAmt}>${item.amount.toFixed(2)}</Text>
                        <View style={pn.catBadge}>
                          <Text style={pn.catBadgeText}>{item.category}</Text>
                        </View>
                      </View>
                      {item.description ? <Text style={pn.reviewDesc} numberOfLines={2}>{item.description}</Text> : null}
                      <Text style={pn.reviewDate}>{item.date ?? 'No date detected — will use today'}</Text>
                    </View>
                  </TouchableOpacity>
                ))}

                {error ? <Text style={[form.error, { marginTop: 8 }]}>{error}</Text> : null}
              </ScrollView>

              {/* Fixed import button */}
              <View style={pn.importBar}>
                <TouchableOpacity
                  style={[pn.importBtn, (importing || selectedCount === 0) && { opacity: 0.5 }]}
                  onPress={handleImport}
                  activeOpacity={0.85}
                  disabled={importing || selectedCount === 0}>
                  {importing
                    ? <ActivityIndicator color={T.textPrimary} />
                    : <Text style={pn.importBtnText}>import {selectedCount} expense{selectedCount !== 1 ? 's' : ''}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Chart helpers ────────────────────────────────────────────────────────────

// All coach-related DB category values that must be unified under "Travel Coach"
const COACH_CAT_VALUES = new Set(
  ['coach fee', 'coach flight', 'coach hotel', 'coach meals', 'travel coach']
);

// Normalise raw DB category to its canonical display/group name.
// "Flight" (legacy) → "Flights"; all coach variants → "Travel Coach".
function groupCategory(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower === 'flight') return 'Flights';
  if (COACH_CAT_VALUES.has(lower)) return 'Travel Coach';
  return raw;
}

const CAT_PIE_COLORS: Record<string, string> = {
  flight: T.accent, flights: T.accent, hotel: T.teal, meals: T.clayText,
  transport: T.amber, 'strings & grip': T.green, 'stringing fee': T.green,
  physio: T.hardText, academy: T.grassText, trainer: '#9333EA',
  'travel coach': '#9333EA',
  other: T.textTertiary,
};
const PIE_FALLBACK = [T.teal, T.accent, T.clayText, T.hardText, T.red, T.green, T.amber, '#9333EA', T.grassText, '#C084FC', '#A855F7', '#F472B6'];

function tPrize(t: any): number {
  const split = (t.singlesPrizeMoney ?? 0) + (t.doublesPrizeMoney ?? 0);
  // Fall back to legacy prizeMoney for records created before the singles/doubles split
  return split > 0 ? split : (t.prizeMoney ?? 0);
}

function buildChartData(expensesRaw: any[], tournaments: any[], period: 'week' | 'month' | 'year', monthOffset = 0, yearOffset = 0, monthAbbr = getMonthAbbr('en')) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const expenses = effectiveExpenses(expensesRaw);
  // Withdrawn tournaments never contribute prize money — consistent across all periods
  const activeTournaments = tournaments.filter((t: any) => !t.isWithdrawn);

  if (period === 'week') {
    const dow = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
    const daysToShow = dow === 0 ? 7 : dow;
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    // Single pass: bucket spent/earned by exact ISO date
    const spentByDate: Record<string, number> = {};
    for (const e of expenses) {
      if (!e.date) continue;
      spentByDate[e.date] = (spentByDate[e.date] ?? 0) + effectiveUsd(e);
    }
    const earnedByDate: Record<string, number> = {};
    for (const t of activeTournaments) {
      const iso = t.endDate ?? t.startDate;
      if (!iso) continue;
      earnedByDate[iso] = (earnedByDate[iso] ?? 0) + tPrize(t);
    }
    return Array.from({ length: daysToShow }, (_, i) => {
      const d = new Date(mon); d.setDate(mon.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { value: (spentByDate[iso] ?? 0) - (earnedByDate[iso] ?? 0), label: labels[i] };
    });
  }

  if (period === 'month') {
    const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const y = target.getFullYear(), m = target.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const isPast = monthOffset < 0;
    const todayD = isPast ? daysInMonth : now.getDate();
    const prefix = `${y}-${String(m + 1).padStart(2, '0')}-`;
    // Single pass: bucket by week-of-month index (day 1–7 → 0, 8–14 → 1, …)
    const weekCount = Math.ceil(Math.min(daysInMonth, todayD) / 7);
    const spentByWeek = new Array(weekCount).fill(0);
    const earnedByWeek = new Array(weekCount).fill(0);
    const bucketOf = (iso: string): number | null => {
      if (!iso.startsWith(prefix)) return null;
      const day = +iso.slice(8, 10);
      if (day > todayD) return null;
      const idx = Math.floor((day - 1) / 7);
      return idx < weekCount ? idx : null;
    };
    for (const e of expenses) {
      if (!e.date) continue;
      const idx = bucketOf(e.date);
      if (idx !== null) spentByWeek[idx] += effectiveUsd(e);
    }
    for (const t of activeTournaments) {
      const iso = t.endDate ?? t.startDate;
      if (!iso) continue;
      const idx = bucketOf(iso);
      if (idx !== null) earnedByWeek[idx] += tPrize(t);
    }
    return spentByWeek.map((spent, i) => ({
      value: spent - earnedByWeek[i],
      label: `${monthAbbr[m]} ${i * 7 + 1}`,
    }));
  }

  // year — one bucket per calendar month, single pass
  const y = now.getFullYear() + yearOffset;
  const monthCount = yearOffset < 0 ? 12 : now.getMonth() + 1;
  const spentByMonth = new Array(monthCount).fill(0);
  const earnedByMonth = new Array(monthCount).fill(0);
  for (const e of expenses) {
    if (!e.date || +e.date.slice(0, 4) !== y) continue;
    const mi = +e.date.slice(5, 7) - 1;
    if (mi >= 0 && mi < monthCount) spentByMonth[mi] += effectiveUsd(e);
  }
  for (const t of activeTournaments) {
    const iso = t.endDate ?? t.startDate;
    if (!iso || +iso.slice(0, 4) !== y) continue;
    const mi = +iso.slice(5, 7) - 1;
    if (mi >= 0 && mi < monthCount) earnedByMonth[mi] += tPrize(t);
  }
  return spentByMonth.map((spent, mi) => ({ value: spent - earnedByMonth[mi], label: monthAbbr[mi] }));
}

function catmullRomPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

const LC_H = 130;
const LC_PAD = { t: 10, b: 28, l: 2, r: 2 };

function SpendingLineChart({ expenses, tournaments, period, onPeriodChange, monthOffset, onMonthOffsetChange, yearOffset, onYearOffsetChange }: { expenses: any[]; tournaments: any[]; period: 'week' | 'month' | 'year'; onPeriodChange: (p: 'week' | 'month' | 'year') => void; monthOffset: number; onMonthOffsetChange: (o: number) => void; yearOffset: number; onYearOffsetChange: (o: number) => void }) {
  const { lang, t } = useLanguage();
  const { width: windowWidth } = useWindowDimensions();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [cardWidth, setCardWidth] = useState(windowWidth - 40);

  const data = useMemo(() => buildChartData(expenses, tournaments, period, monthOffset, yearOffset, getMonthAbbr(lang)), [expenses, tournaments, period, monthOffset, yearOffset, lang]);
  const hasData = data.length >= 2;

  const W = cardWidth - 32;
  const H = LC_H;
  const chartW = W - LC_PAD.l - LC_PAD.r;
  const chartH = H - LC_PAD.t - LC_PAD.b;
  const zeroY  = LC_PAD.t + chartH / 2;

  const maxAbs = hasData ? Math.max(...data.map(d => Math.abs(d.value)), 1) : 1;
  const cap    = maxAbs * 1.3;

  const pts = data.map((d, i) => ({
    x: LC_PAD.l + (data.length === 1 ? chartW / 2 : (i / (data.length - 1)) * chartW),
    y: zeroY - (d.value / cap) * (chartH / 2),
    value: d.value,
  }));

  const ptsRef = useRef(pts);
  ptsRef.current = pts;

  const linePath = catmullRomPath(pts);
  const areaPath = hasData
    ? linePath + ` L ${pts[pts.length - 1].x.toFixed(1)} ${zeroY.toFixed(1)} L ${pts[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`
    : '';

  const totalRaw = data.reduce((s, d) => s + d.value, 0);
  const isProfitable = totalRaw < 0;
  const displayNet = -totalRaw;

  function findClosest(touchX: number) {
    const currentPts = ptsRef.current;
    let closest = 0, minDist = Infinity;
    currentPts.forEach((p, i) => { const d = Math.abs(p.x - touchX); if (d < minDist) { minDist = d; closest = i; } });
    return closest;
  }

  const monthOffsetRef = useRef(monthOffset);
  monthOffsetRef.current = monthOffset;
  const periodRef = useRef(period);
  periodRef.current = period;
  const swipedRef = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 10 && Math.abs(gs.dy) < 10,
      onPanResponderGrant: (evt) => { swipedRef.current = false; setSelectedIdx(findClosest(evt.nativeEvent.locationX)); },
      onPanResponderMove: (evt, gs) => {
        if (periodRef.current === 'month' && Math.abs(gs.dx) > 50 && !swipedRef.current) {
          swipedRef.current = true;
          onMonthOffsetChange(monthOffsetRef.current + (gs.dx < 0 ? -1 : 1));
          setSelectedIdx(null);
        } else if (!swipedRef.current) {
          setSelectedIdx(findClosest(evt.nativeEvent.locationX));
        }
      },
      onPanResponderRelease: () => { swipedRef.current = false; setSelectedIdx(null); },
    })
  ).current;

  const MK: Array<Parameters<typeof t>[0]> = ['month.january','month.february','month.march','month.april','month.may','month.june','month.july','month.august','month.september','month.october','month.november','month.december'];
  const monthLabel = useMemo(() => {
    const now = new Date();
    const selectedYear = now.getFullYear() + yearOffset;
    const baseMonth = yearOffset === 0 ? now.getMonth() : 0;
    const d = new Date(selectedYear, baseMonth + monthOffset, 1);
    return t(MK[d.getMonth()]);
  }, [monthOffset, yearOffset, t]);

  return (
    <View style={lc.card} onLayout={e => setCardWidth(e.nativeEvent.layout.width)}>

      {/* Period toggle */}
      <View style={lc.toggle}>
        {(['week', 'month', 'year'] as const).map(p => (
          <TouchableOpacity key={p} style={[lc.pill, period === p && lc.pillActive]}
            onPress={() => { onPeriodChange(p); setSelectedIdx(null); }} activeOpacity={0.7}>
            <Text style={[lc.pillText, period === p && lc.pillTextActive]}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Month navigation — only in month mode */}
      {period === 'month' && (
        <View style={lc.monthNav}>
          <TouchableOpacity onPress={() => onMonthOffsetChange(monthOffset - 1)} activeOpacity={0.7} style={lc.monthArrow}>
            <Text style={lc.monthArrowText}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => monthOffset !== 0 && onMonthOffsetChange(0)} activeOpacity={monthOffset === 0 ? 1 : 0.7}>
            <Text style={[lc.monthLabel, monthOffset === 0 && lc.monthLabelCurrent]}>{monthLabel}</Text>
          </TouchableOpacity>
          {monthOffset < 0 ? (
            <TouchableOpacity onPress={() => onMonthOffsetChange(monthOffset + 1)} activeOpacity={0.7} style={lc.monthArrow}>
              <Text style={lc.monthArrowText}>›</Text>
            </TouchableOpacity>
          ) : <View style={lc.monthArrow} />}
        </View>
      )}

      {/* Total net */}
      <Text style={[lc.netAmount, isProfitable ? lc.netGreen : lc.netPurple]}>
        {displayNet >= 0 ? '+' : ''}{fmt(displayNet)}
      </Text>

      {hasData ? (
        <View style={{ height: H, position: 'relative' }} {...panResponder.panHandlers}>
          <Svg width={W} height={H}>
            <Defs>
              <ClipPath id="lc-above">
                <Rect x={0} y={0} width={W} height={zeroY} />
              </ClipPath>
              <ClipPath id="lc-below">
                <Rect x={0} y={zeroY} width={W} height={H - zeroY} />
              </ClipPath>
            </Defs>

            {/* Zero reference line */}
            <SvgLine x1={0} y1={zeroY} x2={W} y2={zeroY} stroke={T.textMuted} strokeWidth={1} strokeDasharray="5 4" />

            {/* Area fills */}
            <Path d={areaPath} fill={T.teal} opacity={0.13} clipPath="url(#lc-above)" />
            <Path d={areaPath} fill={T.green} opacity={0.13} clipPath="url(#lc-below)" />

            {/* Colored line segments */}
            <Path d={linePath} stroke={T.teal} strokeWidth={2.5} fill="none" clipPath="url(#lc-above)" strokeLinecap="round" strokeLinejoin="round" />
            <Path d={linePath} stroke={T.green} strokeWidth={2.5} fill="none" clipPath="url(#lc-below)" strokeLinecap="round" strokeLinejoin="round" />

            {/* Selected point */}
            {selectedIdx !== null && (
              <>
                <SvgLine x1={pts[selectedIdx].x} y1={LC_PAD.t} x2={pts[selectedIdx].x} y2={H - LC_PAD.b}
                  stroke={T.textMuted} strokeWidth={1} strokeDasharray="3 3" />
                <Circle cx={pts[selectedIdx].x} cy={pts[selectedIdx].y} r={5}
                  fill={pts[selectedIdx].value <= 0 ? T.green : T.teal} />
              </>
            )}
          </Svg>

          {/* Floating tooltip */}
          {selectedIdx !== null && (() => {
            const pt   = pts[selectedIdx];
            const raw  = data[selectedIdx].value;
            const disp = -raw;
            const tx   = Math.max(2, Math.min(W - 82, pt.x - 38));
            const ty   = Math.max(2, pt.y - 42);
            return (
              <View style={[lc.tooltip, { left: tx, top: ty }]} pointerEvents="none">
                <Text style={[lc.tooltipText, raw <= 0 ? lc.netGreen : lc.netPurple]}>
                  {disp >= 0 ? '+' : ''}{fmt(disp)}
                </Text>
              </View>
            );
          })()}
        </View>
      ) : (
        <View style={lc.empty}>
          <Text style={lc.emptyText}>No data for this {period}</Text>
        </View>
      )}

      {/* X-axis labels */}
      {hasData && (
        <View style={lc.xAxis}>
          {data.map((d, i) => (
            <Text key={i} style={[lc.xLabel, i === data.length - 1 && lc.xLabelToday]}>{d.label}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

const lc = StyleSheet.create({
  card:          { backgroundColor: T.card, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: T.cardBorder },
  toggle:        { flexDirection: 'row', gap: 8, marginBottom: 10 },
  pill:          { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20 },
  pillActive:    { backgroundColor: T.cardBorder },
  pillText:      { fontSize: 13, fontWeight: '600', color: T.textTertiary },
  pillTextActive:{ color: T.textPrimary },
  netAmount:     { fontSize: 28, fontWeight: '700', marginBottom: 6 },
  netGreen:      { color: T.green },
  netPurple:     { color: T.teal },
  xAxis:         { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  xLabel:        { fontSize: 9, color: T.textTertiary, textAlign: 'center', flex: 1 },
  xLabelToday:   { color: T.textPrimary, fontWeight: '700' },
  tooltip:       { position: 'absolute', backgroundColor: T.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: T.cardBorder },
  tooltipText:   { fontSize: 13, fontWeight: '700' },
  empty:         { height: 110, alignItems: 'center', justifyContent: 'center' },
  emptyText:     { fontSize: 13, color: T.textTertiary },
  monthNav:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  monthArrow:    { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  monthArrowText:{ fontSize: 24, color: T.teal, fontWeight: '300' },
  monthLabel:    { fontSize: 14, fontWeight: '600', color: T.textSecondary },
  monthLabelCurrent: { color: T.textPrimary },
});

// ─── Expense Histogram ───────────────────────────────────────────────────────

type HgMode = 'category' | 'timeline';

interface HgBar { label: string; value: number; color?: string; sub?: string }

function buildHgTimeline(expensesRaw: any[], period: 'month' | 'year' | 'week', monthOffset: number, yearOffset: number, monthAbbr = getMonthAbbr('en')): HgBar[] {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const expenses = effectiveExpenses(expensesRaw);
  if (period === 'month') {
    // Single pass: bucket by week-of-month index
    const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const y = target.getFullYear(), m = target.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const prefix = `${y}-${String(m + 1).padStart(2, '0')}-`;
    const weekCount = Math.ceil(daysInMonth / 7);
    const totals = new Array(weekCount).fill(0);
    for (const e of expenses) {
      if (!e.date || !e.date.startsWith(prefix)) continue;
      const idx = Math.floor((+e.date.slice(8, 10) - 1) / 7);
      if (idx >= 0 && idx < weekCount) totals[idx] += effectiveUsd(e);
    }
    return totals.map((value, i) => ({
      label: `${i * 7 + 1}–${Math.min(i * 7 + 7, daysInMonth)}`,
      value,
    }));
  }
  // Single pass: bucket by calendar month
  const y = now.getFullYear() + yearOffset;
  const monthCount = yearOffset < 0 ? 12 : now.getMonth() + 1;
  const totals = new Array(monthCount).fill(0);
  for (const e of expenses) {
    if (!e.date || +e.date.slice(0, 4) !== y) continue;
    const mi = +e.date.slice(5, 7) - 1;
    if (mi >= 0 && mi < monthCount) totals[mi] += effectiveUsd(e);
  }
  return totals.map((value, mi) => ({ label: monthAbbr[mi], value }));
}

function buildHgByCategory(expensesRaw: any[]): HgBar[] {
  const expenses = effectiveExpenses(expensesRaw);
  const grouped: Record<string, number> = {};
  for (const e of expenses) {
    const raw = (e.category ?? 'Other').trim().toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase());
    const cat = groupCategory(raw);
    grouped[cat] = (grouped[cat] ?? 0) + effectiveUsd(e);
  }
  return Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, val]) => ({
      label: cat,
      value: val,
      color: CAT_PIE_COLORS[cat.toLowerCase()],
    }));
}


const HG_MODES: { key: HgMode; label: string }[] = [
  { key: 'category', label: 'Category' },
  { key: 'timeline', label: 'Timeline' },
];

function ExpenseHistogram({ expenses, periodExpenses, period, monthOffset, yearOffset, onSelectCategory }: {
  expenses: any[]; periodExpenses: any[]; period: 'month' | 'year' | 'week'; monthOffset: number; yearOffset: number;
  onSelectCategory: (cat: string, color: string) => void;
}) {
  const { lang } = useLanguage();
  const { width: windowWidth } = useWindowDimensions();
  const [cardWidth, setCardWidth] = useState(windowWidth - 40);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [mode, setMode] = useState<HgMode>('category');

  const data = useMemo(() => {
    if (mode === 'timeline') return buildHgTimeline(expenses, period, monthOffset, yearOffset, getMonthAbbr(lang));
    return buildHgByCategory(periodExpenses);
  }, [expenses, periodExpenses, period, monthOffset, yearOffset, mode, lang]);

  const totalSpent = data.reduce((s, d) => s + d.value, 0);
  const maxVal = Math.max(...data.map(d => d.value), 1);

  const PAD = { t: 8, b: 0, l: 0, r: 0 };
  const W = cardWidth - 32;
  const isHorizontal = mode !== 'timeline';

  // Horizontal bars (each / category)
  const ROW_H = 32;
  const hBarH = isHorizontal ? Math.max(80, data.length * ROW_H + PAD.t) : 0;

  // Vertical bars (timeline)
  const V_H = 120;
  const chartH_v = V_H - PAD.t - 22;
  const gap_v = 6;
  const barW_v = data.length > 0 ? Math.max(4, (W - gap_v * (data.length - 1)) / data.length) : 10;

  const panDataRef = useRef(data);
  panDataRef.current = data;
  const barGeomRef = useRef({ barW: barW_v, gap: gap_v });
  barGeomRef.current = { barW: barW_v, gap: gap_v };

  function findVBar(touchX: number): number {
    const { barW, gap } = barGeomRef.current;
    const step = barW + gap;
    const idx = Math.floor(touchX / step);
    return Math.max(0, Math.min(panDataRef.current.length - 1, idx));
  }

  const vPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => setActiveIdx(findVBar(evt.nativeEvent.locationX)),
      onPanResponderMove: (evt) => setActiveIdx(findVBar(evt.nativeEvent.locationX)),
      onPanResponderRelease: () => setActiveIdx(null),
    }),
  ).current;

  // Reset active index on mode change
  useEffect(() => { setActiveIdx(null); }, [mode]);

  if (data.length === 0 && mode !== 'timeline') return null;

  const activeBar = activeIdx !== null && activeIdx < data.length ? data[activeIdx] : null;

  return (
    <View style={hg.card} onLayout={e => setCardWidth(e.nativeEvent.layout.width)}>
      {/* Toggle row */}
      <View style={hg.toggleRow}>
        {HG_MODES.map(m => (
          <TouchableOpacity key={m.key} style={[hg.togglePill, mode === m.key && hg.togglePillActive]}
            onPress={() => setMode(m.key)} activeOpacity={0.7}>
            <Text style={[hg.toggleText, mode === m.key && hg.toggleTextActive]}>{m.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Header */}
      <View style={hg.headerRow}>
        <Text style={hg.title}>
          {mode === 'category' ? 'By category' : 'Over time'}
        </Text>
        {activeBar && activeBar.value > 0 ? (
          <View style={hg.tooltipPill}>
            <Text style={hg.tooltipLabel} numberOfLines={1}>{activeBar.label}</Text>
            <Text style={hg.tooltipValue}>${Math.round(activeBar.value).toLocaleString()}</Text>
          </View>
        ) : (
          <Text style={hg.totalValue}>${Math.round(totalSpent).toLocaleString()}</Text>
        )}
      </View>

      {isHorizontal ? (
        /* ── Horizontal bar chart (each / category) ── */
        <View style={{ marginTop: 4 }}>
          {data.map((d, i) => {
            const pct = maxVal > 0 ? (d.value / maxVal) * 100 : 0;
            const barColor = d.color ?? PIE_FALLBACK[i % PIE_FALLBACK.length];
            const isActive = activeIdx === i;
            return (
              <TouchableOpacity key={i} style={hg.hRow} activeOpacity={0.7}
                onPressIn={() => setActiveIdx(i)} onPressOut={() => setActiveIdx(null)}
                onPress={() => {
                  const cat = d.label;
                  const color = d.color ?? PIE_FALLBACK[i % PIE_FALLBACK.length];
                  onSelectCategory(cat, color);
                }}>
                <View style={hg.hLabelCol}>
                  <Text style={[hg.hLabel, isActive && { color: T.teal }]} numberOfLines={1}>{d.label}</Text>
                </View>
                <View style={hg.hBarTrack}>
                  <View style={[hg.hBarFill, {
                    width: `${Math.max(pct, 2)}%`,
                    backgroundColor: barColor,
                    opacity: activeIdx !== null ? (isActive ? 1 : 0.35) : 0.85,
                  }]} />
                </View>
                <Text style={[hg.hAmt, isActive && { color: T.teal }]}>${Math.round(d.value).toLocaleString()}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        /* ── Vertical bar chart (timeline) ── */
        <>
          <View style={{ height: V_H, position: 'relative' }} {...vPanResponder.panHandlers}>
            <Svg width={W} height={V_H}>
              {data.map((d, i) => {
                const barH = maxVal > 0 ? (d.value / maxVal) * chartH_v : 0;
                const x = i * (barW_v + gap_v);
                const y = PAD.t + chartH_v - barH;
                const isActive = activeIdx === i;
                const opacity = activeIdx !== null ? (isActive ? 1 : 0.35) : (d.value > 0 ? 0.85 : 0.2);
                return (
                  <Rect key={i}
                    x={x} y={d.value > 0 ? y : PAD.t + chartH_v - 2}
                    width={barW_v} height={d.value > 0 ? barH : 2}
                    rx={barW_v > 10 ? 4 : 2} ry={barW_v > 10 ? 4 : 2}
                    fill={isActive ? T.teal : T.accent} opacity={opacity}
                  />
                );
              })}
              <SvgLine x1={0} y1={PAD.t + chartH_v} x2={W} y2={PAD.t + chartH_v} stroke={T.cardBorder} strokeWidth={1} />
            </Svg>
          </View>
          <View style={hg.xAxis}>
            {data.map((d, i) => (
              <Text key={i} style={[hg.xLabel, activeIdx === i && hg.xLabelActive]}>{d.label}</Text>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const hg = StyleSheet.create({
  card: {
    backgroundColor: T.card, borderRadius: 16, padding: 16,
    marginBottom: 16, borderWidth: 1, borderColor: T.cardBorder,
  },
  toggleRow: {
    flexDirection: 'row', gap: 6, marginBottom: 14,
  },
  togglePill: {
    paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20,
  },
  togglePillActive: {
    backgroundColor: T.cardBorder,
  },
  toggleText: {
    fontSize: 12, fontWeight: '600', color: T.textTertiary,
  },
  toggleTextActive: {
    color: T.textPrimary,
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: {
    fontSize: 11, fontWeight: '600', color: T.textTertiary,
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
  totalValue: {
    fontSize: 18, fontWeight: '700', color: T.textPrimary,
  },
  tooltipPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: T.accentMuted, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 4, maxWidth: '55%',
  },
  tooltipLabel: {
    fontSize: 12, fontWeight: '500', color: T.textSecondary, flexShrink: 1,
  },
  tooltipValue: {
    fontSize: 14, fontWeight: '700', color: T.teal,
  },
  // Horizontal bars
  hRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 5,
  },
  hLabelCol: {
    width: 80,
  },
  hLabel: {
    fontSize: 12, fontWeight: '600', color: T.textSecondary,
  },
  hSub: {
    fontSize: 10, color: T.textTertiary, marginTop: 1,
  },
  hBarTrack: {
    flex: 1, height: 14, borderRadius: 7,
    backgroundColor: T.cardBorder, overflow: 'hidden',
  },
  hBarFill: {
    height: '100%', borderRadius: 7,
  },
  hAmt: {
    fontSize: 12, fontWeight: '700', color: T.textPrimary,
    width: 56, textAlign: 'right',
  },
  // Vertical bars (timeline)
  xAxis: {
    flexDirection: 'row', justifyContent: 'space-around', marginTop: 4,
  },
  xLabel: {
    fontSize: 9, color: T.textTertiary, textAlign: 'center', flex: 1,
  },
  xLabelActive: {
    color: T.teal, fontWeight: '700',
  },
});

function normalizeCat(raw: string): string {
  return raw.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function buildPieData(expensesRaw: any[]) {
  const expenses = effectiveExpenses(expensesRaw);
  const grouped: Record<string, number> = {};
  for (const e of expenses) {
    const cat = groupCategory(normalizeCat(e.category ?? 'Other'));
    grouped[cat] = (grouped[cat] ?? 0) + effectiveUsd(e);
  }
  const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, v]) => s + v, 0);
  const usedColors = new Set<string>();
  return { total, slices: sorted.map(([cat, val], i) => {
    let color = CAT_PIE_COLORS[cat.toLowerCase()] ?? PIE_FALLBACK[i % PIE_FALLBACK.length];
    if (usedColors.has(color)) {
      color = PIE_FALLBACK.find(c => !usedColors.has(c)) ?? PIE_FALLBACK[i % PIE_FALLBACK.length];
    }
    usedColors.add(color);
    return {
      value: val,
      color,
      text: total > 0 ? `${Math.round((val / total) * 100)}%` : '',
      label: cat as string,
    };
  }) };
}

function CategoryBreakdown({ expenses, onSelectCategory }: {
  expenses: any[]; onSelectCategory: (cat: string, color: string) => void;
}) {
  const { total, slices } = buildPieData(expenses);
  if (slices.length === 0) return null;

  return (
    <View style={ch.card}>
      <Text style={ch.cardTitle}>By category</Text>
      <View style={ch.pieRow}>
        <PieChart
          data={slices.map(s => ({
            ...s,
            text: total > 0 && (s.value / total) >= 0.12 ? `${Math.round((s.value / total) * 100)}%` : '',
          }))}
          donut
          radius={75}
          innerRadius={46}
          showText
          textColor="#FFFFFF"
          textSize={10}
          fontWeight="700"
          labelsPosition="mid"
          centerLabelComponent={() => (
            <View style={ch.pieCenter}>
              <AgentIcon size={78} color={T.bg} />
            </View>
          )}
        />
        <View style={ch.legend}>
          {slices.map((s, i) => (
            <TouchableOpacity key={i} style={ch.legendRow} activeOpacity={0.6}
              onPress={() => onSelectCategory(s.label, s.color)}>
              <View style={[ch.legendDot, { backgroundColor: s.color }]} />
              <Text style={ch.legendLabel} numberOfLines={1}>{s.label}</Text>
              <Text style={ch.legendAmt}>${s.value.toFixed(0)}</Text>
              <Text style={{ color: T.textMuted, fontSize: 14 }}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

function TournamentBreakdown({ expenses: expensesRaw, tournaments, onTap }: {
  expenses: any[]; tournaments: any[]; onTap: (t: any) => void;
}) {
  const expenses = effectiveExpenses(expensesRaw);
  const rows = useMemo(() => {
    const byTournament: Record<string, number> = {};
    const unlinked = { total: 0, count: 0 };
    for (const e of expenses) {
      if (e.tournamentId) {
        byTournament[e.tournamentId] = (byTournament[e.tournamentId] ?? 0) + effectiveUsd(e);
      } else {
        unlinked.total += effectiveUsd(e);
        unlinked.count++;
      }
    }
    const mapped = Object.entries(byTournament)
      .map(([id, total]) => {
        const t = tournaments.find((t: any) => t.id === id);
        return t ? { id, name: t.name, country: t.country, surface: t.surface, startDate: t.startDate, total, tournament: t } : null;
      })
      .filter(Boolean)
      .sort((a: any, b: any) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
    return { mapped: mapped as any[], unlinked };
  }, [expenses, tournaments]);

  if (rows.mapped.length === 0 && rows.unlinked.count === 0) return null;

  return (
    <View style={tb.card}>
      <Text style={tb.title}>BY TOURNAMENT</Text>
      {rows.mapped.map((r: any) => {
        const surfaceBg = SURFACE_BG[(r.surface as Surface)] ?? T.card;
        return (
          <TouchableOpacity key={r.id} style={[tb.row, { backgroundColor: surfaceBg }]} activeOpacity={0.7} onPress={() => onTap(r.tournament)}>
            <View style={tb.rowLeft}>
              <Text style={tb.rowName} numberOfLines={1}>
                {r.country ? countryFlag(r.country) + ' ' : ''}{r.name}
              </Text>
              {r.startDate && <Text style={tb.rowDate}>{r.startDate}</Text>}
            </View>
            <Text style={tb.rowAmount}>${Math.round(r.total).toLocaleString()}</Text>
          </TouchableOpacity>
        );
      })}
      {rows.unlinked.count > 0 && (
        <View style={tb.row}>
          <View style={tb.rowLeft}>
            <Text style={tb.rowName}>General expenses</Text>
            <Text style={tb.rowDate}>{rows.unlinked.count} item{rows.unlinked.count !== 1 ? 's' : ''}</Text>
          </View>
          <Text style={tb.rowAmount}>${Math.round(rows.unlinked.total).toLocaleString()}</Text>
        </View>
      )}
    </View>
  );
}

const tb = StyleSheet.create({
  card: { backgroundColor: T.card, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: T.cardBorder },
  title: { fontSize: 11, fontWeight: '600', color: T.textTertiary, letterSpacing: 0.6, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, marginBottom: 4 },
  rowLeft: { flex: 1, marginRight: 12 },
  rowName: { fontSize: 14, fontWeight: '600', color: T.textPrimary },
  rowDate: { fontSize: 11, color: T.textTertiary, marginTop: 2 },
  rowAmount: { fontSize: 14, fontWeight: '700', color: T.textPrimary },
});

const ch = StyleSheet.create({
  card: { backgroundColor: T.card, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: T.cardBorder },
  cardTitle: { fontSize: 11, fontWeight: '600', color: T.textTertiary, letterSpacing: 0.6, textTransform: 'uppercase' },
  chartHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14 },
  chartNetAmount: { fontSize: 22, fontWeight: '700' },
  netGreen: { color: T.green },
  netRed: { color: T.red },
  xLabel: { fontSize: 9, color: T.textTertiary, textAlign: 'center', marginTop: 2 },
  xLabelToday: { color: T.textPrimary, fontWeight: '700' },
  tooltip: { backgroundColor: T.tealMuted, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center' },
  tooltipText: { fontWeight: '700', fontSize: 13 },
  pieRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  pieCenter: { alignItems: 'center' },
  pieCenterAmount: { fontSize: 14, fontWeight: '700', color: T.textPrimary, marginTop: 2 },
  legend: { flex: 1, gap: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  legendLabel: { flex: 1, fontSize: 12, color: T.textSecondary, textTransform: 'capitalize' },
  legendAmt: { fontSize: 12, fontWeight: '600', color: T.textPrimary },
});

const drillStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: T.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingBottom: 36, paddingTop: 12, maxHeight: '70%',
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: T.textMuted, alignSelf: 'center', marginBottom: 16 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: T.textPrimary, textTransform: 'capitalize' },
  total: { fontSize: 18, fontWeight: '700', color: T.textPrimary },
  empty: { fontSize: 14, color: T.textTertiary, textAlign: 'center', paddingVertical: 24 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: T.cardBorder,
  },
  rowNote: { fontSize: 14, fontWeight: '500', color: T.textPrimary },
  rowSubcat: { fontSize: 11, color: '#9333EA', marginTop: 1, fontWeight: '600' },
  rowDate: { fontSize: 12, color: T.textTertiary, marginTop: 2 },
  rowTournament: { fontSize: 11, color: '#6060A0', marginTop: 2 },
  rowAmt: { fontSize: 15, fontWeight: '700', color: T.textPrimary, flexShrink: 0 },
  rowSelected: { backgroundColor: T.accentMuted },
  selectBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12, paddingVertical: 8, paddingHorizontal: 4,
  },
  selectCount: { fontSize: 14, fontWeight: '600', color: T.teal },
  selectCancel: { fontSize: 14, fontWeight: '600', color: T.textSecondary },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: T.textMuted,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  checkboxOn: { backgroundColor: T.teal, borderColor: T.teal },
  checkmark: { color: T.textPrimary, fontSize: 13, fontWeight: '700' },
  closeBtn: {
    marginTop: 16, backgroundColor: T.cardBorder, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  closeBtnText: { fontSize: 15, fontWeight: '600', color: T.textSecondary },
  deleteBtn: {
    backgroundColor: T.red, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  deleteBtnText: { fontSize: 15, fontWeight: '700', color: T.textPrimary },
  linkBtn: {
    backgroundColor: '#5B5BD6', borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center',
  },
  linkBtnText: { fontSize: 15, fontWeight: '700', color: '#FAFAFA' },
});

// ─── Prize Money Modal ────────────────────────────────────────────────────────

function PrizeMoneyModal({ tournaments, onClose }: { tournaments: any[]; onClose: () => void }) {
  const demoCtx = useDemoData();
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const eligibleTournaments = tournaments.filter((t: any) => {
    const end = parseLocalDate(t.endDate ?? t.startDate);
    return end && end <= today;
  });
  const activeTournament = findActiveTournament(tournaments) ?? eligibleTournaments[0] ?? null;
  const [tournamentId, setTournamentId] = useState(activeTournament?.id ?? '');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [singlesAmount, setSinglesAmount] = useState('');
  const [doublesAmount, setDoublesAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedTournament = eligibleTournaments.find((t: any) => t.id === tournamentId);

  async function handleSave() {
    const singles = parseFloat(singlesAmount.replace(',', '.')) || 0;
    const doubles = parseFloat(doublesAmount.replace(',', '.')) || 0;
    if (singles === 0 && doubles === 0) { setError('Enter at least one amount.'); return; }
    setSaving(true); setError('');
    try {
      const updates: any = {
        singlesPrizeMoney: singles,
        doublesPrizeMoney: doubles,
        prizeMoney: singles + doubles,
      };
      if (DEMO_MODE) {
        demoCtx?.patchTournament(tournamentId, updates);
      } else {
        await apiPatchTournament(tournamentId, updates);
      }
      onClose();
    } catch (e: any) { setError(e?.message ?? 'Failed to save.'); setSaving(false); }
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={form.safe}>
        <View style={form.header}>
          <TouchableOpacity onPress={onClose} style={form.backBtn} activeOpacity={0.7}>
            <Text style={form.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={form.headerTitle}>Prize Money</Text>
          <View style={form.backBtn} />
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView style={form.scroll} contentContainerStyle={form.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={form.sectionLabel}>TOURNAMENT</Text>
          <TouchableOpacity style={form.dropdown} onPress={() => setDropdownOpen(!dropdownOpen)} activeOpacity={0.7}>
            <Text style={selectedTournament ? form.dropdownValue : form.dropdownPlaceholder} numberOfLines={1}>
              {selectedTournament ? selectedTournament.name : 'Select tournament'}
            </Text>
            <Text style={form.dropdownChevron}>{dropdownOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {dropdownOpen && (
            <View style={form.dropdownList}>
              {eligibleTournaments.map((t: any) => (
                <TouchableOpacity
                  key={t.id}
                  style={[form.dropdownRow, t.id === tournamentId && form.dropdownRowActive]}
                  onPress={() => { setTournamentId(t.id); setDropdownOpen(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={[form.dropdownRowText, t.id === tournamentId && form.dropdownRowTextActive]} numberOfLines={1}>
                    {t.name}
                  </Text>
                  {t.id === tournamentId && <Text style={form.dropdownCheck}>✓</Text>}
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={form.sectionLabel}>SINGLES PRIZE MONEY</Text>
          <View style={form.amountRow}>
            <Text style={form.currencySign}>$</Text>
            <TextInput
              style={form.amountInput}
              value={singlesAmount}
              onChangeText={setSinglesAmount}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={T.textTertiary}
            />
          </View>

          <Text style={form.sectionLabel}>DOUBLES PRIZE MONEY</Text>
          <View style={form.amountRow}>
            <Text style={form.currencySign}>$</Text>
            <TextInput
              style={form.amountInput}
              value={doublesAmount}
              onChangeText={setDoublesAmount}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={T.textTertiary}
            />
          </View>

          {error ? <Text style={form.error}>{error}</Text> : null}

          <TouchableOpacity style={form.saveBtn} onPress={handleSave} activeOpacity={0.85} disabled={saving}>
            {saving ? <ActivityIndicator color={T.textPrimary} /> : <Text style={form.saveBtnText}>Save Prize Money</Text>}
          </TouchableOpacity>
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Monthly Fixed Section ────────────────────────────────────────────────────

function MonthlyFixedSection({ expenses }: { expenses: any[] }) {
  const { t, lang } = useLanguage();
  const monthNames = lang === 'es' ? MONTH_NAMES_ES : MONTH_NAMES_EN;
  // Filter only monthly fixed expenses
  const fixedExpenses = expenses.filter((e: any) => e.isMonthlyFixed || e.is_monthly_fixed);
  if (fixedExpenses.length === 0) return null;

  // Group by fixedMonth (YYYY-MM)
  const grouped: Record<string, { month: number; year: number; items: any[]; total: number }> = {};
  for (const e of fixedExpenses) {
    const key: string = e.fixedMonth ?? e.fixed_month ?? e.date?.slice(0, 7) ?? 'unknown';
    if (!grouped[key]) {
      const [y, m] = key.split('-').map(Number);
      grouped[key] = { month: m, year: y, items: [], total: 0 };
    }
    grouped[key].items.push(e);
    grouped[key].total += effectiveUsd(e);
  }

  const sortedKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <View style={{ marginBottom: 24 }}>
      <Text style={mf.sectionHeader}>{t('expense.monthlyFixedSection')}</Text>
      {sortedKeys.map((key) => {
        const { month, year, items, total } = grouped[key];
        const monthName = monthNames[(month ?? 1) - 1] ?? key;
        return (
          <View key={key} style={mf.monthCard}>
            <View style={mf.monthHeaderRow}>
              <Text style={mf.monthLabel}>{monthName} {year}</Text>
              <Text style={mf.monthTotal}>{fmt(total)}</Text>
            </View>
            {items.map((e: any) => (
              <View key={e.id} style={mf.expenseRow}>
                <Text style={mf.expenseCat} numberOfLines={1}>{e.category}</Text>
                <Text style={mf.expenseAmt}>{fmtRowAmount(e)}</Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const mf = StyleSheet.create({
  sectionHeader: {
    fontSize: 10,
    fontWeight: '700',
    color: T.textTertiary,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  monthCard: {
    backgroundColor: '#1E1E30',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  monthHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  monthLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: T.textSecondary,
  },
  monthTotal: {
    fontSize: 14,
    fontWeight: '700',
    color: T.textPrimary,
  },
  expenseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: T.cardBorder,
  },
  expenseCat: {
    fontSize: 13,
    color: T.textTertiary,
    textTransform: 'capitalize',
    flex: 1,
    marginRight: 8,
  },
  expenseAmt: {
    fontSize: 13,
    fontWeight: '600',
    color: T.textSecondary,
  },
});

// ─── Active-Tournament Budget Card ────────────────────────────────────────────
// Shown only during a live tournament week (startDate <= today <= end, not
// withdrawn). Running spend uses effective amounts (see effectiveUsd rule).

function ActiveTournamentBudgetCard({ tournament, expenses, onTap }: {
  tournament: any; expenses: any[]; onTap: () => void;
}) {
  const { t: tr } = useLanguage();
  const tExpenses = expenses.filter((e: any) => e.tournamentId === tournament.id);
  const spent = effectiveSum(tExpenses);
  const singles = tournament.singlesPrizeMoney ?? 0;
  const doubles = tournament.doublesPrizeMoney ?? 0;
  const prize = (singles + doubles) > 0 ? singles + doubles : (tournament.prizeMoney ?? 0);
  const net = prize - spent;

  const start = parseLocalDate(tournament.startDate);
  const end = tournamentEnd(tournament);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let dayCurrent = 1, dayTotal = 7;
  if (start && end) {
    dayTotal = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
    dayCurrent = Math.min(dayTotal, Math.max(1, Math.round((today.getTime() - start.getTime()) / 86400000) + 1));
  }

  const surfaceBg = SURFACE_BG[(tournament.surface as Surface)] ?? T.card;

  return (
    <TouchableOpacity style={[abc.card, { backgroundColor: surfaceBg }]} onPress={onTap} activeOpacity={0.85}>
      <View style={abc.headerRow}>
        <Text style={abc.label}>{tr('expenses.budgetTitle')}</Text>
        <Text style={abc.days}>
          {tr('expenses.budgetDayOf')} {dayCurrent} {tr('expenses.budgetDayOfSep')} {dayTotal}
        </Text>
      </View>
      <Text style={abc.name} numberOfLines={1}>
        {tournament.country ? countryFlag(tournament.country) + ' ' : ''}{tournament.name}
      </Text>
      <View style={abc.statsRow}>
        <View style={abc.stat}>
          <Text style={abc.statLabel}>{tr('expenses.spent')}</Text>
          <Text style={[abc.statValue, { color: T.red }]}>{fmt(spent)}</Text>
        </View>
        {prize > 0 && (
          <View style={abc.stat}>
            <Text style={abc.statLabel}>{tr('expenses.prize')}</Text>
            <Text style={[abc.statValue, { color: T.accent }]}>{fmt(prize)}</Text>
          </View>
        )}
        <View style={abc.stat}>
          <Text style={abc.statLabel}>{tr('expenses.net')}</Text>
          <Text style={[abc.statValue, net >= 0 ? { color: T.green } : { color: T.red }]}>
            {net >= 0 ? '+' : ''}{fmt(net)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const abc = StyleSheet.create({
  card: { borderRadius: 16, padding: 16, marginBottom: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  label: { fontSize: 11, fontWeight: '700', color: 'rgba(10,17,40,0.6)', letterSpacing: 0.6, textTransform: 'uppercase' },
  days: { fontSize: 11, fontWeight: '600', color: 'rgba(10,17,40,0.6)' },
  name: { fontSize: 16, fontWeight: '800', color: '#0A1128', marginBottom: 12 },
  statsRow: { flexDirection: 'row', gap: 18 },
  stat: { flex: 1 },
  statLabel: { fontSize: 10, fontWeight: '600', color: 'rgba(10,17,40,0.55)', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 },
  statValue: { fontSize: 15, fontWeight: '800' },
});

// ─── Recent expenses (flat, cross-category) ───────────────────────────────────

const RECENT_CAT_ICON: Record<string, string> = {
  flights: '✈️', flight: '✈️', hotel: '🏨', meals: '🍽️', transport: '🚕',
  'strings & grip': '🎾', 'stringing fee': '🎾', physio: '💆', academy: '🏫',
  trainer: '🏋️', 'coach fee': '🧑‍🏫', 'coach flight': '✈️', 'coach hotel': '🏨',
  'coach meals': '🍽️', other: '💳',
};
function recentCatIcon(cat: string): string {
  return RECENT_CAT_ICON[(cat ?? '').toLowerCase()] ?? '💳';
}

function RecentExpensesRow({ expense, onPress }: { expense: any; onPress: () => void }) {
  const { t: tr } = useLanguage();
  const isReimbursed = expense.isReimbursed === true;
  const showApprox = expense.currency && expense.currency !== 'USD' && expense.amountUsd != null;
  return (
    <TouchableOpacity style={rec.row} onPress={onPress} activeOpacity={0.75}>
      <Text style={rec.icon}>{recentCatIcon(expense.category)}</Text>
      <View style={rec.mid}>
        <Text style={rec.title} numberOfLines={1}>{expense.merchant || expense.note || expense.category}</Text>
        <Text style={rec.date}>{expense.date}</Text>
      </View>
      <View style={rec.right}>
        <Text style={[rec.amt, isReimbursed && rec.amtStruck]}>{fmtRowAmount(expense)}</Text>
        {showApprox && !isReimbursed && (
          <Text style={rec.approx}>≈ {fmt(expense.amountUsd)}</Text>
        )}
        {isReimbursed && (
          <View style={rec.badge}>
            <Text style={rec.badgeText}>{tr('expense.reimbursed')}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// Swipe-to-delete with a 5s undo window: the row disappears immediately, the
// delete fires only after the snackbar's timeout expires unless cancelled.
function RecentExpensesSection({ expenses, onOpen, onRequestDelete }: {
  expenses: any[]; onOpen: (e: any) => void; onRequestDelete: (e: any) => void;
}) {
  const { t: tr } = useLanguage();
  const recent = useMemo(
    () => [...expenses].sort((a: any, b: any) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, 10),
    [expenses]
  );
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  function handleSwipeDelete(e: any) {
    setHiddenIds(prev => new Set(prev).add(e.id));
    onRequestDelete(e);
  }

  const visible = recent.filter((e: any) => !hiddenIds.has(e.id));
  if (visible.length === 0 && hiddenIds.size === 0) return null;

  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.sectionLabel}>{tr('expenses.recent')}</Text>
      <GestureHandlerRootView>
        <View style={rec.card}>
          {visible.map((e: any, i: number) => (
            <View key={e.id}>
              {i > 0 && <View style={rec.divider} />}
              <SwipeableRow actionLabel={tr('common.delete')} onAction={() => handleSwipeDelete(e)}>
                <RecentExpensesRow expense={e} onPress={() => onOpen(e)} />
              </SwipeableRow>
            </View>
          ))}
        </View>
      </GestureHandlerRootView>
    </View>
  );
}

const rec = StyleSheet.create({
  card: { backgroundColor: T.card, borderRadius: 14, borderWidth: 1, borderColor: T.cardBorder, overflow: 'hidden' },
  divider: { height: 1, backgroundColor: T.cardBorder },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  icon: { fontSize: 18, width: 26, textAlign: 'center' },
  mid: { flex: 1, marginRight: 8 },
  title: { fontSize: 14, fontWeight: '600', color: T.textPrimary },
  date: { fontSize: 11, color: T.textTertiary, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  amt: { fontSize: 14, fontWeight: '700', color: T.textPrimary },
  amtStruck: { textDecorationLine: 'line-through', color: T.textMuted },
  approx: { fontSize: 11, color: T.textTertiary, marginTop: 1 },
  badge: { backgroundColor: T.tealMuted, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2 },
  badgeText: { fontSize: 9, fontWeight: '700', color: T.teal, textTransform: 'uppercase' },
});

// Bottom snackbar with UNDO — shown while a swipe-delete is pending.
function UndoSnackbar({ visible, onUndo }: { visible: boolean; onUndo: () => void }) {
  const { t: tr } = useLanguage();
  if (!visible) return null;
  return (
    <View style={snack.container} pointerEvents="box-none">
      <View style={snack.bar}>
        <Text style={snack.text}>{tr('expenses.deletedUndo')}</Text>
        <TouchableOpacity onPress={onUndo} activeOpacity={0.7}>
          <Text style={snack.undo}>{tr('expenses.undo')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const snack = StyleSheet.create({
  container: { position: 'absolute', left: 0, right: 0, bottom: 24, alignItems: 'center', paddingHorizontal: 20 },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1E1E30', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16,
    width: '100%', borderWidth: 1, borderColor: T.cardBorder,
  },
  text: { fontSize: 13, fontWeight: '600', color: T.textPrimary },
  undo: { fontSize: 13, fontWeight: '800', color: T.teal, marginLeft: 16 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ExpensesScreen() {
  const { lang, t } = useLanguage();
  const { data, isLoading } = useAppQuery({ tournaments: {}, expenses: {} });
  const { data: _prof } = useProfile();
  const [showAddForm, setShowAddForm] = useState(false);
  const [autoScanOnAdd, setAutoScanOnAdd] = useState(false);
  const [showAddChoice, setShowAddChoice] = useState(false);
  const [showPrizeBreakdown, setShowPrizeBreakdown] = useState(false);
  const [selectedPrizeIds, setSelectedPrizeIds] = useState<Set<string>>(new Set());
  const [showSpentBreakdown, setShowSpentBreakdown] = useState(false);
  const [spentMonth, setSpentMonth] = useState<number | null>(null);
  const [selectedSpentIds, setSelectedSpentIds] = useState<Set<string>>(new Set());
  const [showPrizeMoney, setShowPrizeMoney] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [detailTournament, setDetailTournament] = useState<any | null>(null);
  const { openTournament } = useLocalSearchParams<{ openTournament?: string }>();
  const autoOpenedRef = useRef<string | undefined>(undefined);

  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('year');
  const [periodDropOpen, setPeriodDropOpen] = useState(false);
  const { isFirstVisit, markVisited } = useFirstVisit('expenses');
  const swipeHandlers = useTabSwipe();
  const router = useRouter();
  const [monthOffset, setMonthOffset] = useState(0);
  const [yearOffset, setYearOffset] = useState(0);
  const [actionExpense, setActionExpense] = useState<any | null>(null);
  const [editExpense, setEditExpense] = useState<any | null>(null);
  const [deleteExpense, setDeleteExpense] = useState<any | null>(null);
  const [linkExpenses, setLinkExpenses] = useState<any[]>([]);
  const [deleting, setDeleting] = useState(false);
  const demoCtx = useDemoData();
  const [drillCategory, setDrillCategory] = useState<{ cat: string; color: string } | null>(null);
  const [atpMatchHistory, setAtpMatchHistory] = useState<any[]>([]);

  // ── Undo-snackbar delete (Recent list) ──
  // The row is hidden immediately by RecentExpensesSection; the actual delete
  // only fires 5s later unless cancelled. Only one pending delete at a time —
  // starting a new one (or unmounting) flushes whatever was already pending.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingDeleteRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  function flushPendingDelete() {
    const pending = pendingDeleteRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingDeleteRef.current = null;
    setPendingDeleteId(null);
    if (DEMO_MODE) { demoCtx?.deleteExpense(pending.id); }
    else { apiDeleteExpense(pending.id).catch((e: any) => Alert.alert('Could not delete', e?.message ?? 'Please try again.')); }
  }

  function requestUndoableDelete(expense: any) {
    flushPendingDelete(); // only one pending delete at a time
    const timer = setTimeout(() => {
      pendingDeleteRef.current = null;
      setPendingDeleteId(null);
      if (DEMO_MODE) { demoCtx?.deleteExpense(expense.id); }
      else { apiDeleteExpense(expense.id).catch((e: any) => Alert.alert('Could not delete', e?.message ?? 'Please try again.')); }
    }, 5000);
    pendingDeleteRef.current = { id: expense.id, timer };
    setPendingDeleteId(expense.id);
  }

  function undoPendingDelete() {
    const pending = pendingDeleteRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingDeleteRef.current = null;
    setPendingDeleteId(null);
  }

  // Fire any pending delete immediately on unmount — never silently drop it.
  // Intentionally empty deps: this must run exactly once, on unmount only.
  useEffect(() => () => flushPendingDelete(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);

  useEffect(() => {
    if (DEMO_MODE) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('profiles').select('atp_player_name').eq('id', user.id).single()
        .then(({ data: prof }) => {
          if (!prof?.atp_player_name) return;
          const nameParts = prof.atp_player_name.trim().split(/\s+/).slice(0, 2).join(' ');
          supabase.from('player_profiles').select('match_history')
            .or(playerNameFilter(nameParts))
            .order('last_updated', { ascending: false }).limit(1)
            .then(({ data: rows }) => {
              if (rows?.[0]?.match_history) setAtpMatchHistory(rows[0].match_history);
            });
        });
    });
  }, []);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectMode = selectedIds.size > 0;

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function deleteSelected() {
    setDeleting(true);
    try {
      for (const id of selectedIds) {
        if (DEMO_MODE) { demoCtx?.deleteExpense(id); }
        else { await apiDeleteExpense(id); }
      }
    } catch (e: any) {
      Alert.alert('Could not delete', e?.message ?? 'Please try again.');
    } finally {
      setDeleting(false);
      setSelectedIds(new Set());
    }
  }

  async function confirmDeleteGeneral(expense: any) {
    setDeleting(true);
    try {
      if (DEMO_MODE) {
        demoCtx?.deleteExpense(expense.id);
      } else {
        await apiDeleteExpense(expense.id);
      }
    } catch (e: any) {
      Alert.alert('Could not delete', e?.message ?? 'Please try again.');
    } finally { setDeleting(false); setDeleteExpense(null); }
  }

  function localIso(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function periodRange(p: 'week' | 'month' | 'year', mOffset = 0, yOffset = 0): [string, string] {
    const now = new Date();
    if (p === 'week') {
      const day = now.getDay();
      const mon = new Date(now);
      mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      mon.setHours(0, 0, 0, 0);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      return [localIso(mon), localIso(sun)];
    }
    if (p === 'month') {
      const target = new Date(now.getFullYear(), now.getMonth() + mOffset, 1);
      return [localIso(target), localIso(new Date(target.getFullYear(), target.getMonth() + 1, 0))];
    }
    const y = now.getFullYear() + yOffset;
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
      const spent = effectiveSum(tExpenses);
      const singles = t.singlesPrizeMoney ?? 0;
      const doubles = t.doublesPrizeMoney ?? 0;
      const prize = singles + doubles;
      setDetailTournament({ ...t, spent, prize });
    }
  }, [openTournament, isLoading]);

  const tournaments = (data?.tournaments ?? []).filter((t: any) => !t.isWithdrawn);
  const expenses = data?.expenses ?? [];
  const activeTournament = useMemo(() => findActiveTournament(tournaments), [tournaments]);

  // id → display name map — must live AFTER tournaments is declared
  const tournamentMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of tournaments) {
      if (t?.id) map[t.id] = t.name ?? `${t.category ?? ''} ${t.city ?? ''}`.trim();
    }
    return map;
  }, [tournaments]);

  // Single-pass index of expenses per tournament — reused by the insight cards
  // and detail handlers instead of re-filtering the full list per tournament.
  const expensesByTournament = useMemo(() => {
    const map = new Map<string, { list: any[]; total: number }>();
    for (const e of effectiveExpenses(expenses)) {
      if (!e.tournamentId) continue;
      let entry = map.get(e.tournamentId);
      if (!entry) { entry = { list: [], total: 0 }; map.set(e.tournamentId, entry); }
      entry.list.push(e);
      entry.total += effectiveUsd(e);
    }
    return map;
  }, [expenses]);

  const [pStart, pEnd] = useMemo(() => periodRange(period, monthOffset, yearOffset), [period, monthOffset, yearOffset]);

  const MONTH_KEYS: Array<Parameters<typeof t>[0]> = [
    'month.january','month.february','month.march','month.april','month.may','month.june',
    'month.july','month.august','month.september','month.october','month.november','month.december'
  ];
  const currentMonthLabel = useMemo(() => {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    return `${t(MONTH_KEYS[target.getMonth()])} ${target.getFullYear()}`;
  }, [monthOffset, lang]);

  const periodExpenses = expenses.filter((e: any) => e.date && e.date >= pStart && e.date <= pEnd);
  const periodSpent = effectiveSum(periodExpenses);
  const periodPrizeMoney = tournaments.reduce((s: number, t: any) => {
    if (!t.startDate || t.startDate < pStart || t.startDate > pEnd) return s;
    return s + tPrize(t);
  }, 0);
  const periodNet = periodPrizeMoney - periodSpent;

  // ── Compute summary card data for FINANCIAL INSIGHTS grid ──
  const insightCards = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const pastT = tournaments.filter((t: any) => {
      const d = parseLocalDate(t.startDate);
      return d && d <= today && !t.isWithdrawn;
    });

    // 1. Where your money goes — top category
    const catGrouped: Record<string, number> = {};
    for (const e of effectiveExpenses(expenses)) catGrouped[e.category ?? 'Other'] = (catGrouped[e.category ?? 'Other'] ?? 0) + effectiveUsd(e);
    const topCat = Object.entries(catGrouped).sort((a, b) => b[1] - a[1])[0];
    const catTotal = Object.values(catGrouped).reduce((s, v) => s + v, 0);
    const topCatPct = topCat && catTotal > 0 ? Math.round((topCat[1] / catTotal) * 100) : 0;

    // 2. Cost by surface — cheapest surface
    const surfaceAvgs: { s: string; avg: number }[] = [];
    for (const surf of ['clay', 'hard', 'grass']) {
      const ts = pastT.filter((t: any) => t.surface === surf);
      if (ts.length === 0) continue;
      const avg = ts.reduce((sum: number, t: any) => sum + (expensesByTournament.get(t.id)?.total ?? 0), 0) / ts.length;
      surfaceAvgs.push({ s: surf.charAt(0).toUpperCase() + surf.slice(1), avg });
    }
    const cheapest = surfaceAvgs.sort((a, b) => a.avg - b.avg)[0];

    // 2b. Cost by country — most expensive country
    const countryAvgs: { c: string; avg: number; perDay: number }[] = [];
    const byCountry: Record<string, number[]> = {};
    for (const t of pastT) {
      if (!t.country) continue;
      const key = (t.country as string).toUpperCase();
      const tSpent = expensesByTournament.get(t.id)?.total ?? 0;
      if (!byCountry[key]) byCountry[key] = [];
      byCountry[key].push(tSpent);
    }
    // Also track days per country for $/day metric
    const byCountryDays: Record<string, number> = {};
    for (const t of pastT) {
      if (!t.country) continue;
      const key = (t.country as string).toUpperCase();
      const start = t.startDate ? (() => { const [y,m,d] = (t.startDate as string).split('-').map(Number); return new Date(y,m-1,d); })() : null;
      const end = t.endDate ? (() => { const [y,m,d] = (t.endDate as string).split('-').map(Number); return new Date(y,m-1,d); })() : null;
      const days = (start && end) ? Math.max(1, Math.round((end.getTime()-start.getTime())/86400000)+1) : 7;
      byCountryDays[key] = (byCountryDays[key] ?? 0) + days;
    }
    for (const [c, spends] of Object.entries(byCountry)) {
      if (spends.length === 0) continue;
      const total = spends.reduce((s, v) => s + v, 0);
      const days = byCountryDays[c] ?? spends.length * 7;
      countryAvgs.push({ c, avg: total / spends.length, perDay: days > 0 ? total / days : 0 });
    }
    countryAvgs.sort((a, b) => b.perDay - a.perDay);
    const mostExpensiveCountry = countryAvgs[0];

    // 3. Tournament costs — count
    const trackedCount = tournaments.filter((t: any) => !t.isWithdrawn && expensesByTournament.has(t.id)).length;

    // 4. Season heatmap — this week's spend level
    const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay() + 1);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
    const weekExpenses = expenses.filter((e: any) => { const d = parseLocalDate(e.date); return d && d >= weekStart && d <= weekEnd; });
    const weekSpend = effectiveSum(weekExpenses);
    const weekLevel = weekSpend > 2000 ? 'High' : weekSpend > 800 ? 'Medium' : weekSpend > 0 ? 'Low' : 'None';

    // 5. Coach impact
    let withCoachTotal = 0, withCoachCount = 0, soloTotal = 0, soloCount = 0;
    for (const t of pastT) {
      const entry = expensesByTournament.get(t.id);
      if (!entry || entry.list.length === 0) continue;
      if (entry.list.some((e: any) => e.isCoachExpense)) { withCoachTotal += entry.total; withCoachCount++; }
      else { soloTotal += entry.total; soloCount++; }
    }
    const coachDiff = withCoachCount > 0 && soloCount > 0 ? (withCoachTotal / withCoachCount) - (soloTotal / soloCount) : 0;

    // 7. Tracking streak
    const sortedPast = [...pastT].sort((a: any, b: any) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
    let streak = 0;
    for (const t of sortedPast) {
      if (expensesByTournament.has(t.id)) streak++;
      else break;
    }

    // 8-12. Points-based — read from scraped atpMatchHistory, not InstantDB tournaments
    const totalPoints = atpMatchHistory.reduce((s: number, m: any) => s + (m.pointsEarned ?? 0), 0);
    const hasPoints = totalPoints > 0;
    const totalInvested = effectiveSum(expenses);
    const costPP = hasPoints && totalInvested > 0 ? totalInvested / totalPoints : 0;

    // Best surface for points
    let bestSurf = '';
    let bestAvg = 0;
    for (const surf of ['clay', 'hard', 'grass']) {
      const ms = atpMatchHistory.filter((m: any) => m.surface === surf && (m.pointsEarned ?? 0) > 0);
      if (ms.length === 0) continue;
      const avg = ms.reduce((s: number, m: any) => s + (m.pointsEarned ?? 0), 0) / ms.length;
      if (avg > bestAvg) { bestAvg = avg; bestSurf = surf.charAt(0).toUpperCase() + surf.slice(1); }
    }

    return [
      { type: 'where-money-goes', label: t('expenses.whereMoneyGoes'), value: topCat ? `${topCat[0]} · ${topCatPct}%` : t('expenses.needMoreData') },
      { type: 'cost-by-surface', label: t('expenses.costBySurface'), value: cheapest ? `${cheapest.s} · $${Math.round(cheapest.avg)} avg` : t('expenses.needMoreData') },
      { type: 'cost-by-country', label: t('expenses.costByCountry'), value: mostExpensiveCountry ? `${mostExpensiveCountry.c} · $${Math.round(mostExpensiveCountry.perDay)}/day` : t('expenses.needMoreData') },
      { type: 'tournament-costs', label: t('expenses.tournamentCosts'), value: `${trackedCount} tournament${trackedCount !== 1 ? 's' : ''}` },
      { type: 'coach-impact', label: t('expenses.coachImpact'), value: coachDiff !== 0 ? `${coachDiff > 0 ? '+' : ''}$${Math.abs(Math.round(coachDiff))}` : t('expenses.needMoreData') },
      { type: 'cost-per-point', label: t('expenses.pointsVsInvestment'), value: hasPoints ? `$${Math.round(costPP)} / pt` : t('expenses.logToUnlock') },
      { type: 'points-by-surface', label: t('expenses.pointsBySurface'), value: bestSurf ? `${bestSurf} · ${bestAvg.toFixed(0)} pts avg` : t('expenses.logToUnlock') },
    ];
  }, [tournaments, expenses, expensesByTournament, atpMatchHistory]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} {...swipeHandlers}>

        <View style={styles.topBar}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity onPress={() => router.push('/settings' as any)} activeOpacity={0.75}>
              <AgentIcon size={70} />
            </TouchableOpacity>
            <Text style={styles.topTitle}>{t('expenses.title')}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <TouchableOpacity style={styles.pasteButton} onPress={() => setShowPasteModal(true)} activeOpacity={0.8}>
              <Text style={styles.pasteIcon}>📋</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => setShowAddChoice(true)}
              onLongPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setAutoScanOnAdd(true);
                setShowAddForm(true);
              }}
              activeOpacity={0.8}>
              <Text style={styles.addIcon}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Period Selector Toggle — single bubble, expands to options */}
        <View style={{ alignItems: 'center', marginBottom: 8 }}>
          <TouchableOpacity
            style={[styles.periodChip, styles.periodChipActive, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}
            onPress={() => setPeriodDropOpen(o => !o)}
            activeOpacity={0.7}
          >
            <Text style={styles.periodChipTextActive}>
              {period === 'month' ? t('expenses.monthly') : t('expenses.yearly')}
            </Text>
            <Text style={{ fontSize: 10, color: '#FAFAFA' }}>{periodDropOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {periodDropOpen && (
            <TouchableOpacity
              style={[styles.periodChip, { marginTop: 4 }]}
              onPress={() => {
                const next = period === 'year' ? 'month' : 'year';
                setPeriod(next);
                setMonthOffset(0);
                setYearOffset(0);
                setPeriodDropOpen(false);
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.periodChipText}>
                {period === 'year' ? t('expenses.monthly') : t('expenses.yearly')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── WHOOP-style Time Navigation ── */}
        <View style={styles.yearNav}>
          <TouchableOpacity
            onPress={() => {
              if (period === 'month') {
                setMonthOffset(monthOffset - 1);
              } else {
                setYearOffset(yearOffset - 1);
              }
            }}
            activeOpacity={0.7}
            style={styles.yearNavArrow}
          >
            <Text style={styles.yearNavArrowText}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              if (period === 'month') {
                setMonthOffset(0);
              } else {
                setYearOffset(0);
              }
            }}
            activeOpacity={(period === 'month' ? monthOffset === 0 : yearOffset === 0) ? 1 : 0.7}
            style={styles.yearNavPill}
          >
            <Text style={styles.yearNavLabel}>
              {period === 'month' ? currentMonthLabel : (new Date().getFullYear() + yearOffset)}
            </Text>
          </TouchableOpacity>
          {((period === 'month' ? monthOffset < 0 : yearOffset < 0)) ? (
            <TouchableOpacity
              onPress={() => {
                if (period === 'month') {
                  setMonthOffset(monthOffset + 1);
                } else {
                  setYearOffset(yearOffset + 1);
                }
              }}
              activeOpacity={0.7}
              style={styles.yearNavArrow}
            >
              <Text style={styles.yearNavArrowText}>›</Text>
            </TouchableOpacity>
          ) : <View style={styles.yearNavArrow} />}
        </View>

        {isLoading ? (
          <LoadingLogo style={{ minHeight: 300 }} />
        ) : (
          <>
            {/* ── Active-Tournament Budget Card ── */}
            {activeTournament && (
              <ActiveTournamentBudgetCard
                tournament={activeTournament}
                expenses={expenses}
                onTap={() => {
                  const tExp = expenses.filter((e: any) => e.tournamentId === activeTournament.id);
                  const spent = effectiveSum(tExp);
                  const singles = activeTournament.singlesPrizeMoney ?? 0;
                  const doubles = activeTournament.doublesPrizeMoney ?? 0;
                  const prize = singles + doubles;
                  setDetailTournament({ ...activeTournament, spent, prize });
                }}
              />
            )}

            {/* ── Recent expenses (flat, cross-category) ── */}
            <RecentExpensesSection
              expenses={pendingDeleteId ? expenses.filter((e: any) => e.id !== pendingDeleteId) : expenses}
              onOpen={(e) => setActionExpense(e)}
              onRequestDelete={requestUndoableDelete}
            />

            {/* ── Season Summary Bar ── */}
            <View style={styles.seasonBar}>
              <View style={styles.seasonStat}>
                <Text style={styles.seasonStatLabel}>{t('expenses.played')}</Text>
                <Text style={styles.seasonStatValue}>{(() => {
                  const today = new Date(); today.setHours(0,0,0,0);
                  return tournaments.filter((t: any) => { const d = parseLocalDate(t.startDate); return d && d <= today && !t.isWithdrawn; }).length;
                })()}</Text>
              </View>
              <View style={styles.seasonDivider} />
              <TouchableOpacity style={styles.seasonStat} onPress={() => { setSpentMonth(null); setSelectedSpentIds(new Set()); setShowSpentBreakdown(true); }} activeOpacity={0.7}>
                <Text style={styles.seasonStatLabel}>{t('expenses.spent')}</Text>
                <Text style={[styles.seasonStatValue, { color: '#E24B4A' }]}>{fmt(periodSpent)}</Text>
              </TouchableOpacity>
              <View style={styles.seasonDivider} />
              <TouchableOpacity style={styles.seasonStat} onPress={() => setShowPrizeBreakdown(true)} activeOpacity={0.7}>
                <Text style={styles.seasonStatLabel}>{t('expenses.prize')}</Text>
                <Text style={[styles.seasonStatValue, { color: '#5B5BD6' }]}>{fmt(periodPrizeMoney)}</Text>
              </TouchableOpacity>
              <View style={styles.seasonDivider} />
              <View style={styles.seasonStat}>
                <Text style={styles.seasonStatLabel}>{t('expenses.net')}</Text>
                <Text style={[styles.seasonStatValue, periodNet >= 0 ? styles.netPositive : styles.netNegative]}>{fmt(periodNet)}</Text>
              </View>
            </View>

            <ExpenseHistogram expenses={expenses} periodExpenses={periodExpenses} period={period} monthOffset={monthOffset} yearOffset={yearOffset}
              onSelectCategory={(cat, color) => setDrillCategory({ cat, color })} />

            <CategoryBreakdown expenses={periodExpenses}
              onSelectCategory={(cat, color) => setDrillCategory({ cat, color })} />

            <TournamentBreakdown expenses={periodExpenses} tournaments={tournaments} onTap={(t) => {
              const tExp = expenses.filter((e: any) => e.tournamentId === t.id);
              const spent = effectiveSum(tExp);
              const singles = t.singlesPrizeMoney ?? 0;
              const doubles = t.doublesPrizeMoney ?? 0;
              const prize = singles + doubles;
              setDetailTournament({ ...t, spent, prize });
            }} />

            {/* ── Monthly Fixed Expenses ── */}
            <MonthlyFixedSection expenses={expenses} />

            {/* ── Financial Insights Grid ── */}
            <Text style={styles.sectionLabel}>{t('expenses.financialInsights')}</Text>
            <View style={styles.insightGrid}>
              {insightCards.map((card) => (
                <TouchableOpacity key={card.type} style={styles.insightCard}
                  onPress={() => router.push({ pathname: '/insights', params: { type: card.type } } as any)} activeOpacity={0.7}>
                  <Text style={styles.insightCardLabel}>{card.label}</Text>
                  <Text style={styles.insightCardChevron}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

      </ScrollView>

      {/* ── Add choice sheet ── */}
      {/* ── Spent Breakdown Modal ── */}
      {showSpentBreakdown && (() => {
        const closeSpent = () => { setShowSpentBreakdown(false); setSpentMonth(null); setSelectedSpentIds(new Set()); };

        // Determine which expenses to show
        const activeExpenses: any[] = period === 'year' && spentMonth === null
          ? [] // will show month picker instead
          : (() => {
              if (period === 'year' && spentMonth !== null) {
                const now = new Date(); const y = now.getFullYear() + yearOffset;
                const mStr = `${y}-${String(spentMonth + 1).padStart(2, '0')}`;
                return expenses.filter((e: any) => e.date && e.date.startsWith(mStr));
              }
              return periodExpenses;
            })();

        // Group by tournament
        const grouped: { tournament: any | null; exps: any[] }[] = [];
        if (activeExpenses.length > 0) {
          const byTrn: Record<string, any[]> = {};
          const standalone: any[] = [];
          for (const e of activeExpenses) {
            if (e.tournamentId) { (byTrn[e.tournamentId] = byTrn[e.tournamentId] ?? []).push(e); }
            else { standalone.push(e); }
          }
          Object.entries(byTrn).forEach(([tid, exps]) => {
            const trn = tournaments.find((t: any) => t.id === tid) ?? null;
            grouped.push({ tournament: trn, exps });
          });
          grouped.sort((a, b) => ((b.tournament?.startDate ?? '') > (a.tournament?.startDate ?? '')) ? 1 : -1);
          if (standalone.length > 0) grouped.push({ tournament: null, exps: standalone });
        }

        // Month picker data (yearly only)
        const monthRows: { label: string; idx: number; total: number }[] = [];
        if (period === 'year' && spentMonth === null) {
          const now = new Date(); const y = now.getFullYear() + yearOffset;
          const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
          for (let m = 0; m < 12; m++) {
            const mStr = `${y}-${String(m + 1).padStart(2, '0')}`;
            const total = effectiveSum(expenses.filter((e: any) => e.date?.startsWith(mStr)));
            if (total > 0) monthRows.push({ label: MONTHS[m], idx: m, total });
          }
        }

        return (
          <Modal transparent animationType="slide" onRequestClose={closeSpent}>
            <Pressable style={styles.choiceBackdrop} onPress={closeSpent}>
              <Pressable style={[styles.choiceSheet, { maxHeight: '88%' }]} onPress={() => {}}>
                <View style={styles.choiceHandle} />
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                  {period === 'year' && spentMonth !== null && (
                    <TouchableOpacity onPress={() => { setSpentMonth(null); setSelectedSpentIds(new Set()); }} style={{ marginRight: 8 }}>
                      <Text style={{ color: '#5B5BD6', fontSize: 16 }}>‹</Text>
                    </TouchableOpacity>
                  )}
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#FAFAFA', flex: 1, textAlign: 'center' }}>
                    {period === 'year' && spentMonth === null ? 'Expenses by Month' : 'Expenses Breakdown'}
                  </Text>
                </View>
                {selectedSpentIds.size === 0
                  ? <Text style={{ fontSize: 12, color: '#6060A0', textAlign: 'center', marginBottom: 12 }}>
                      {period === 'year' && spentMonth === null ? 'Tap a month to drill in' : 'Tap an expense to select'}
                    </Text>
                  : <Text style={{ fontSize: 12, color: '#5B5BD6', textAlign: 'center', marginBottom: 12 }}>{selectedSpentIds.size} selected</Text>
                }

                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* Month picker */}
                  {period === 'year' && spentMonth === null && monthRows.map(({ label, idx, total }) => (
                    <TouchableOpacity key={idx} onPress={() => setSpentMonth(idx)} activeOpacity={0.7}
                      style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#2A2A4A' }}>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: '#FAFAFA' }}>{label}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontSize: 15, fontWeight: '700', color: '#E24B4A' }}>{fmt(total)}</Text>
                        <Text style={{ color: '#6060A0' }}>›</Text>
                      </View>
                    </TouchableOpacity>
                  ))}

                  {/* Expense list grouped by tournament */}
                  {(period !== 'year' || spentMonth !== null) && grouped.map((group, gi) => (
                    <View key={gi} style={{ marginBottom: 12 }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#A0A0C8', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6, marginTop: gi > 0 ? 8 : 0 }}>
                        {group.tournament ? (group.tournament.city ?? group.tournament.name) : 'Other expenses'}
                      </Text>
                      {group.exps.map((exp: any) => {
                        const sel = selectedSpentIds.has(exp.id);
                        return (
                          <TouchableOpacity key={exp.id} activeOpacity={0.7}
                            onPress={() => setSelectedSpentIds(prev => { const n = new Set(prev); n.has(exp.id) ? n.delete(exp.id) : n.add(exp.id); return n; })}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 8, backgroundColor: sel ? 'rgba(91,91,214,0.12)' : 'transparent', marginBottom: 2 }}>
                            <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: sel ? '#5B5BD6' : '#3A3A5A', backgroundColor: sel ? '#5B5BD6' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                              {sel && <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '700' }}>✓</Text>}
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 13, fontWeight: '600', color: '#FAFAFA' }}>{exp.category}</Text>
                              <Text style={{ fontSize: 11, color: '#A0A0C8' }}>{exp.date}</Text>
                            </View>
                            <Text style={{ fontSize: 14, fontWeight: '700', color: '#E24B4A' }}>{fmtRowAmount(exp)}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ))}
                  <View style={{ height: 80 }} />
                </ScrollView>

                {/* Action footer */}
                {selectedSpentIds.size > 0 && (
                  <View style={{ flexDirection: 'row', gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#2A2A4A' }}>
                    {selectedSpentIds.size === 1 && (
                      <TouchableOpacity
                        style={{ flex: 1, backgroundColor: '#5B5BD6', borderRadius: 10, paddingVertical: 13, alignItems: 'center' }}
                        activeOpacity={0.8}
                        onPress={() => {
                          const id = [...selectedSpentIds][0];
                          const exp = expenses.find((e: any) => e.id === id);
                          if (exp) { setShowSpentBreakdown(false); setSelectedSpentIds(new Set()); setEditExpense(exp); }
                        }}>
                        <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 14 }}>Edit</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={{ flex: 1, backgroundColor: '#3A1A1A', borderRadius: 10, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: '#E24B4A' }}
                      activeOpacity={0.8}
                      onPress={() => {
                        const count = selectedSpentIds.size;
                        Alert.alert(
                          `Delete ${count} expense${count !== 1 ? 's' : ''}?`,
                          'This cannot be undone.',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Delete',
                              style: 'destructive',
                              onPress: async () => {
                                try {
                                  for (const id of selectedSpentIds) {
                                    if (DEMO_MODE) { demoCtx?.deleteExpense(id); }
                                    else { await apiDeleteExpense(id); }
                                  }
                                  setSelectedSpentIds(new Set());
                                } catch (e: any) {
                                  Alert.alert('Could not delete', e?.message ?? 'Please try again.');
                                }
                              },
                            },
                          ],
                        );
                      }}>
                      <Text style={{ color: '#E24B4A', fontWeight: '700', fontSize: 14 }}>
                        Delete{selectedSpentIds.size > 1 ? ` (${selectedSpentIds.size})` : ''}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </Pressable>
            </Pressable>
          </Modal>
        );
      })()}

      {/* ── Prize Breakdown Modal ── */}
      {showPrizeBreakdown && (
        <Modal transparent animationType="slide" onRequestClose={() => { setShowPrizeBreakdown(false); setSelectedPrizeIds(new Set()); }}>
          <Pressable style={styles.choiceBackdrop} onPress={() => { setShowPrizeBreakdown(false); setSelectedPrizeIds(new Set()); }}>
            <Pressable style={[styles.choiceSheet, { maxHeight: '85%' }]} onPress={() => {}}>
              <View style={styles.choiceHandle} />
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#FAFAFA', marginBottom: 4, textAlign: 'center' }}>Prize Money by Tournament</Text>
              {selectedPrizeIds.size === 0
                ? <Text style={{ fontSize: 12, color: '#6060A0', textAlign: 'center', marginBottom: 12 }}>Tap a row to select</Text>
                : <Text style={{ fontSize: 12, color: '#5B5BD6', textAlign: 'center', marginBottom: 12 }}>{selectedPrizeIds.size} selected</Text>
              }
              <ScrollView showsVerticalScrollIndicator={false}>
                {(() => {
                  const rows = tournaments
                    .map((trn: any) => {
                      const singles = trn.singlesPrizeMoney ?? 0;
                      const doubles = trn.doublesPrizeMoney ?? 0;
                      const prize = singles + doubles;
                      return { trn, prize, singles, doubles };
                    })
                    .filter(({ prize }: any) => prize > 0)
                    .sort((a: any, b: any) => b.prize - a.prize);

                  if (rows.length === 0) return (
                    <Text style={{ color: '#A0A0C8', textAlign: 'center', marginVertical: 24 }}>No prize money logged yet</Text>
                  );

                  return rows.map(({ trn, prize, singles, doubles }: any) => {
                    const selected = selectedPrizeIds.has(trn.id);
                    return (
                      <TouchableOpacity
                        key={trn.id}
                        activeOpacity={0.7}
                        onPress={() => setSelectedPrizeIds(prev => {
                          const next = new Set(prev);
                          next.has(trn.id) ? next.delete(trn.id) : next.add(trn.id);
                          return next;
                        })}
                        style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#2A2A4A', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: selected ? 'rgba(91,91,214,0.12)' : 'transparent', borderRadius: 8, paddingHorizontal: 4 }}
                      >
                        <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: selected ? '#5B5BD6' : '#3A3A5A', backgroundColor: selected ? '#5B5BD6' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                          {selected && <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>✓</Text>}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: '#FAFAFA' }} numberOfLines={1}>{trn.city ?? trn.name}</Text>
                          <Text style={{ fontSize: 11, color: '#A0A0C8', marginTop: 2 }}>
                            {trn.startDate ? trn.startDate.slice(0, 7).replace('-', '/') : ''} · {trn.category}
                          </Text>
                          {singles > 0 && doubles > 0 && (
                            <Text style={{ fontSize: 11, color: '#6060A0', marginTop: 2 }}>Singles {fmt(singles)} · Doubles {fmt(doubles)}</Text>
                          )}
                        </View>
                        <Text style={{ fontSize: 15, fontWeight: '800', color: '#5B5BD6' }}>{fmt(prize)}</Text>
                      </TouchableOpacity>
                    );
                  });
                })()}
                <View style={{ height: 80 }} />
              </ScrollView>

              {/* Action footer */}
              {selectedPrizeIds.size > 0 && (
                <View style={{ flexDirection: 'row', gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#2A2A4A' }}>
                  {selectedPrizeIds.size === 1 && (
                    <TouchableOpacity
                      style={{ flex: 1, backgroundColor: '#5B5BD6', borderRadius: 10, paddingVertical: 13, alignItems: 'center' }}
                      activeOpacity={0.8}
                      onPress={() => {
                        const id = [...selectedPrizeIds][0];
                        const trn = tournaments.find((t: any) => t.id === id);
                        if (trn) {
                          const tExp = (data?.expenses ?? []).filter((e: any) => e.tournamentId === trn.id);
                          const spent = effectiveSum(tExp);
                          const singles = trn.singlesPrizeMoney ?? 0;
                          const doubles = trn.doublesPrizeMoney ?? 0;
                          const prize = singles + doubles;
                          setShowPrizeBreakdown(false);
                          setSelectedPrizeIds(new Set());
                          setDetailTournament({ ...trn, spent, prize });
                        }
                      }}
                    >
                      <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 14 }}>Edit Prize</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: '#3A1A1A', borderRadius: 10, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: '#E24B4A' }}
                    activeOpacity={0.8}
                    onPress={() => {
                      const count = selectedPrizeIds.size;
                      Alert.alert(
                        `Clear prize money for ${count} tournament${count !== 1 ? 's' : ''}?`,
                        'Singles and doubles amounts will be reset to $0.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Clear',
                            style: 'destructive',
                            onPress: async () => {
                              try {
                                for (const id of selectedPrizeIds) {
                                  const updates = { singlesPrizeMoney: 0, doublesPrizeMoney: 0, prizeMoney: 0 };
                                  if (DEMO_MODE) { demoCtx?.patchTournament(id, updates); }
                                  else { await apiPatchTournament(id, updates); }
                                }
                                setSelectedPrizeIds(new Set());
                              } catch (e: any) {
                                Alert.alert('Could not clear prize money', e?.message ?? 'Please try again.');
                              }
                            },
                          },
                        ],
                      );
                    }}
                  >
                    <Text style={{ color: '#E24B4A', fontWeight: '700', fontSize: 14 }}>
                      Clear Prize{selectedPrizeIds.size > 1 ? ` (${selectedPrizeIds.size})` : ''}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {showAddChoice && (
        <Modal transparent animationType="fade" onRequestClose={() => setShowAddChoice(false)}>
          <Pressable style={styles.choiceBackdrop} onPress={() => setShowAddChoice(false)}>
            <Pressable style={styles.choiceSheet} onPress={() => {}}>
              <View style={styles.choiceHandle} />
              <TouchableOpacity
                style={styles.choiceOption}
                activeOpacity={0.7}
                onPress={() => { setShowAddChoice(false); setShowAddForm(true); }}
              >
                <Text style={styles.choiceIcon}>💸</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.choiceTitle}>{t('expenses.addExpenseAction')}</Text>
                  <Text style={styles.choiceDesc}>{t('expenses.addExpenseDesc')}</Text>
                </View>
                <Text style={styles.choiceArrow}>›</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.choiceOption}
                activeOpacity={0.7}
                onPress={() => { setShowAddChoice(false); setShowPrizeMoney(true); }}
              >
                <Text style={styles.choiceIcon}>🏆</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.choiceTitle}>{t('expenses.registerPrize')}</Text>
                  <Text style={styles.choiceDesc}>{t('expenses.registerPrizeDesc')}</Text>
                </View>
                <Text style={styles.choiceArrow}>›</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {showAddForm && (
        <AddExpenseModal
          tournaments={tournaments}
          autoOpenScan={autoScanOnAdd}
          onClose={() => { setShowAddForm(false); setAutoScanOnAdd(false); }}
        />
      )}

      {/* ── Prize money modal ── */}
      {showPrizeMoney && (
        <PrizeMoneyModal
          tournaments={tournaments}
          onClose={() => setShowPrizeMoney(false)}
        />
      )}

      {detailTournament && (
        <TournamentExpenseDetail
          tournament={detailTournament}
          allTournaments={tournaments}
          onClose={() => setDetailTournament(null)}
        />
      )}

      {showPasteModal && (
        <PasteFromNotesModal
          tournaments={tournaments}
          onClose={() => setShowPasteModal(false)}
        />
      )}

      {actionExpense && (
        <ExpenseActionSheet
          expense={actionExpense}
          onEdit={() => { setEditExpense(actionExpense); setActionExpense(null); }}
          onDelete={() => { setDeleteExpense(actionExpense); setActionExpense(null); }}
          onLink={() => { setLinkExpenses([actionExpense]); setActionExpense(null); }}
          onCancel={() => setActionExpense(null)}
        />
      )}

      {linkExpenses.length > 0 && (
        <LinkTournamentModal
          expenses={linkExpenses}
          tournaments={tournaments}
          onClose={() => { setLinkExpenses([]); setSelectedIds(new Set()); }}
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
          onConfirm={() => confirmDeleteGeneral(deleteExpense)}
          onCancel={() => setDeleteExpense(null)}
        />
      )}

      {drillCategory && (() => {
        const catExpenses = periodExpenses
          .filter((e: any) => {
            const grouped = groupCategory(normalizeCat(e.category ?? 'Other'));
            return grouped === drillCategory.cat;
          })
          .sort((a: any, b: any) => (b.date ?? '').localeCompare(a.date ?? ''));
        const catTotal = effectiveSum(catExpenses);
        const closeDrill = () => { setDrillCategory(null); setSelectedIds(new Set()); };
        return (
          <Modal transparent animationType="slide" onRequestClose={closeDrill}>
            <Pressable style={drillStyles.backdrop} onPress={closeDrill}>
              <Pressable style={drillStyles.sheet} onPress={() => {}}>
                <View style={drillStyles.handle} />
                <View style={drillStyles.header}>
                  <View style={[drillStyles.dot, { backgroundColor: drillCategory.color }]} />
                  <Text style={drillStyles.title}>{drillCategory.cat}</Text>
                  <Text style={drillStyles.total}>{fmt(catTotal)}</Text>
                </View>
                {selectMode && (
                  <View style={drillStyles.selectBar}>
                    <Text style={drillStyles.selectCount}>{selectedIds.size} selected</Text>
                    <TouchableOpacity onPress={() => setSelectedIds(new Set())} activeOpacity={0.7}>
                      <Text style={drillStyles.selectCancel}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <GestureHandlerRootView>
                <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
                  {catExpenses.length === 0 ? (
                    <Text style={drillStyles.empty}>No expenses in this category.</Text>
                  ) : catExpenses.map((e: any, i: number) => {
                    const isSelected = selectedIds.has(e.id);
                    return (
                      <SwipeableRow key={e.id ?? i}
                        actionLabel={t('common.delete')}
                        enabled={!selectMode}
                        onAction={() => setDeleteExpense(e)}>
                      <TouchableOpacity
                        style={[drillStyles.row, isSelected && drillStyles.rowSelected]}
                        activeOpacity={0.7}
                        onPress={() => selectMode ? toggleSelect(e.id) : setActionExpense(e)}
                        onLongPress={() => { if (!selectMode) toggleSelect(e.id); }}>
                        {selectMode && (
                          <View style={[drillStyles.checkbox, isSelected && drillStyles.checkboxOn]}>
                            {isSelected && <Text style={drillStyles.checkmark}>✓</Text>}
                          </View>
                        )}
                        <View style={{ flex: 1, marginRight: 12 }}>
                          <Text style={drillStyles.rowNote} numberOfLines={1}>{e.note || 'No description'}</Text>
                          {/* Show specific sub-category when the drill group name differs (e.g. Travel Coach → Coach Flight) */}
                          {e.category && normalizeCat(e.category) !== drillCategory.cat && (
                            <Text style={drillStyles.rowSubcat} numberOfLines={1}>{e.category}</Text>
                          )}
                          <Text style={drillStyles.rowDate}>{e.date}</Text>
                          {e.tournamentId && tournamentMap[e.tournamentId] ? (
                            <Text style={drillStyles.rowTournament} numberOfLines={1}>
                              🏆 {tournamentMap[e.tournamentId]}
                            </Text>
                          ) : null}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={drillStyles.rowAmt}>{fmtRowAmount(e)}</Text>
                          {e.currency && e.currency !== 'USD' && e.amountUsd != null && (
                            <Text style={{ fontSize: 11, color: T.textTertiary, marginTop: 1 }}>≈ {fmt(e.amountUsd)}</Text>
                          )}
                        </View>
                        {!selectMode && <Text style={{ color: T.textTertiary, fontSize: 16, marginLeft: 8 }}>›</Text>}
                      </TouchableOpacity>
                      </SwipeableRow>
                    );
                  })}
                </ScrollView>
                </GestureHandlerRootView>
                {selectMode ? (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                    <TouchableOpacity
                      style={drillStyles.linkBtn}
                      onPress={() => {
                        const sel = catExpenses.filter((e: any) => selectedIds.has(e.id));
                        setLinkExpenses(sel);
                      }}
                      activeOpacity={0.8}>
                      <Text style={drillStyles.linkBtnText}>🏆 Link</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[drillStyles.deleteBtn, { flex: 1 }, deleting && { opacity: 0.5 }]}
                      onPress={deleteSelected}
                      disabled={deleting}
                      activeOpacity={0.8}>
                      {deleting
                        ? <ActivityIndicator color={T.textPrimary} />
                        : <Text style={drillStyles.deleteBtnText}>Delete {selectedIds.size}</Text>}
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={drillStyles.closeBtn} onPress={closeDrill} activeOpacity={0.7}>
                    <Text style={drillStyles.closeBtnText}>Close</Text>
                  </TouchableOpacity>
                )}
              </Pressable>
            </Pressable>
          </Modal>
        );
      })()}

      <ScreenWalkthrough steps={EXPENSES_WALKTHROUGH} visible={isFirstVisit} onDismiss={markVisited} />

      <UndoSnackbar visible={!!pendingDeleteId} onUndo={undoPendingDelete} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 32 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 18, paddingBottom: 20 },
  topTitle: { fontSize: 18, fontWeight: '700', color: T.textPrimary },
  avatarBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: T.card, borderWidth: 1.5, borderColor: T.teal, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 13, fontWeight: '800', color: T.teal },
  pasteButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: T.card, alignItems: 'center', justifyContent: 'center' },
  pasteIcon: { fontSize: 16 },
  addButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: T.teal, alignItems: 'center', justifyContent: 'center' },
  addIcon: { color: T.textPrimary, fontSize: 22, lineHeight: 26, fontWeight: '300' },
  yearSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 16, gap: 4 },
  yearArrow: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  yearArrowText: { fontSize: 28, color: T.teal, fontWeight: '300' },
  yearLabel: { fontSize: 20, fontWeight: '700', color: T.textTertiary, paddingHorizontal: 16 },
  yearLabelCurrent: { color: T.textPrimary },
  choiceBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  choiceSheet: { backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 36, paddingTop: 12 },
  choiceHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: T.cardBorder, alignSelf: 'center', marginBottom: 20 },
  choiceOption: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: T.bg, borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: T.cardBorder },
  choiceIcon: { fontSize: 24 },
  choiceTitle: { fontSize: 16, fontWeight: '600', color: T.textPrimary, marginBottom: 2 },
  choiceDesc: { fontSize: 13, color: T.textSecondary },
  choiceArrow: { fontSize: 22, color: T.teal, fontWeight: '300' },
  summaryRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  summaryCard: { flex: 1, backgroundColor: T.card, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 8, alignItems: 'center' },
  summaryLabel: { fontSize: 10, color: T.textTertiary, fontWeight: '500', marginBottom: 4, textAlign: 'center' },
  summaryAmount: { fontSize: 15, fontWeight: '700', color: T.textPrimary },
  sectionLabel: { fontSize: 11, fontWeight: '600', color: T.textTertiary, letterSpacing: 0.8, marginBottom: 10 },
  card: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: T.card },
  fixedCard: { backgroundColor: T.card },
  cardLeft: { flex: 1, marginRight: 10 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: T.textPrimary, marginBottom: 2 },
  cardMeta: { fontSize: 11, color: T.textTertiary },
  cardRight: { alignItems: 'flex-end' },
  cardSpent: { fontSize: 14, fontWeight: '700', color: T.textPrimary, marginBottom: 1 },
  cardNet: { fontSize: 11, fontWeight: '500' },
  netNegative: { color: T.red },
  netPositive: { color: T.green },
  emptyText: { fontSize: 14, color: T.textTertiary, textAlign: 'center', marginTop: 40 },
  yearNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 20, paddingVertical: 8 },
  yearNavArrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  yearNavArrowText: { fontSize: 28, color: T.accent, fontWeight: '300' },
  yearNavPill: { backgroundColor: T.cardBorder, borderRadius: 22, paddingHorizontal: 24, paddingVertical: 8 },
  yearNavLabel: { fontSize: 16, fontWeight: '700', color: T.textPrimary },
  seasonBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.card, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8, marginBottom: 12 },
  seasonStat: { flex: 1, alignItems: 'center' },
  seasonStatLabel: { fontSize: 10, fontWeight: '600', color: T.textTertiary, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 3 },
  seasonStatValue: { fontSize: 14, fontWeight: '700', color: T.textPrimary },
  seasonDivider: { width: 1, height: 22, backgroundColor: T.cardBorder },
  insightGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  insightCard: {
    flexBasis: '47%', flexGrow: 1, backgroundColor: T.card, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 12, paddingRight: 24, position: 'relative',
  },
  insightCardLabel: { fontSize: 12, fontWeight: '700', color: T.textPrimary, letterSpacing: 0.3 },
  insightCardChevron: { position: 'absolute', top: 12, right: 10, fontSize: 14, color: T.textMuted, fontWeight: '300' },
  periodRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  periodChip: { borderRadius: 20, paddingHorizontal: 18, paddingVertical: 7, backgroundColor: T.card },
  periodChipActive: { backgroundColor: T.teal },
  periodChipText: { fontSize: 13, fontWeight: '600', color: T.textTertiary },
  periodChipTextActive: { color: T.textPrimary },
  reflectionCard: {
    backgroundColor: T.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  reflectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  reflectionIcon: { fontSize: 14 },
  reflectionLabel: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    color: T.teal,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  reflectionBtn: {
    backgroundColor: T.accentMuted,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
    minWidth: 36,
    alignItems: 'center',
  },
  reflectionBtnText: { fontSize: 12, fontWeight: '700', color: T.teal },
  reflectionPeriod: { fontSize: 11, color: T.textTertiary, fontWeight: '600', marginBottom: 6 },
  reflectionText: { fontSize: 14, color: T.textPrimary, lineHeight: 21 },
  reflectionEmpty: { fontSize: 13, color: T.textTertiary, fontStyle: 'italic' },
});

const det = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: T.bg },
  navbar:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: T.bg, borderBottomWidth: 1, borderBottomColor: T.cardBorder },
  backBtn: { paddingRight: 16 },
  backText: { fontSize: 15, fontWeight: '600', color: T.teal },
  headerBand: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 28 },
  headerName: { fontSize: 22, fontWeight: '800', lineHeight: 28, marginBottom: 6 },
  headerMeta: { fontSize: 13, fontWeight: '500', lineHeight: 18 },
  body: { paddingHorizontal: 20, paddingTop: 24 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: T.textTertiary, letterSpacing: 0.8, marginBottom: 10, marginTop: 4 },
  // Prize money section
  prizeCard: {
    backgroundColor: T.card, borderRadius: 14,
    borderWidth: 1, borderColor: T.cardBorder,
    overflow: 'hidden',
    marginBottom: 20,
  },
  prizeDivider: { height: 1, backgroundColor: T.cardBorder, marginHorizontal: 16 },
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
  prizeRowLabel: { fontSize: 14, fontWeight: '600', color: T.textPrimary, flexShrink: 0 },
  prizeRowRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  prizeEditingRight: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  prizeEmpty: { flex: 1, textAlign: 'right', fontSize: 14, color: T.textMuted, fontWeight: '400' },
  prizeAmount: { fontSize: 16, fontWeight: '700', color: T.green },
  prizeEditHint: { fontSize: 12, color: T.teal },
  prizeSign: { fontSize: 16, color: T.textPrimary, fontWeight: '600' },
  prizeInput: { flex: 1, fontSize: 16, fontWeight: '700', color: T.green, borderBottomWidth: 2, borderBottomColor: T.teal, paddingVertical: 2 },
  prizeDoneBtn: { backgroundColor: T.teal, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  prizeDoneText: { fontSize: 12, fontWeight: '700', color: T.textPrimary },
  noExpensesText: { fontSize: 14, color: T.textMuted, textAlign: 'center', paddingVertical: 20 },
  expenseList: { backgroundColor: T.card, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: T.cardBorder, marginBottom: 12 },
  expenseRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: T.cardBorder },
  expenseLeft: { flex: 1 },
  expenseCat: { fontSize: 14, color: T.textPrimary, textTransform: 'capitalize', fontWeight: '500' },
  expenseNote: { fontSize: 12, color: T.textTertiary, marginTop: 2 },
  expenseRight: { alignItems: 'flex-end' },
  expenseAmt: { fontSize: 14, fontWeight: '700', color: T.textPrimary },
  expenseDate: { fontSize: 11, color: T.textTertiary, marginTop: 2 },
  expenseMoreDot: { fontSize: 16, color: T.textMuted, marginLeft: 8, alignSelf: 'center' },
  summaryCard: { backgroundColor: T.card, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: T.cardBorder, marginBottom: 14 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  summaryDivider: { height: 1, backgroundColor: T.cardBorder, marginHorizontal: 16 },
  summaryLabel: { fontSize: 14, color: T.textSecondary },
  summaryAmt: { fontSize: 15, fontWeight: '600', color: T.textPrimary },
  summaryAmtMuted: { color: T.textMuted, fontWeight: '400' },
  netNeg: { color: T.red },
  netPos: { color: T.green },
  addExpenseBtn: { backgroundColor: T.teal, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  addExpenseBtnText: { color: T.textPrimary, fontSize: 16, fontWeight: '700' },
});

// ─── Action sheet / dialog styles ────────────────────────────────────────────

const sheet = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: T.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 36,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: T.cardBorder, alignSelf: 'center', marginBottom: 18,
  },
  title: { fontSize: 13, color: T.textTertiary, fontWeight: '500', marginBottom: 2, textAlign: 'center' },
  amount: { fontSize: 18, fontWeight: '800', color: T.textPrimary, textAlign: 'center', marginBottom: 20 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 16, gap: 14,
  },
  rowDivider: { height: 1, backgroundColor: T.cardBorder },
  rowIcon: { fontSize: 18, width: 26, textAlign: 'center' },
  rowLabel: { flex: 1, fontSize: 16, fontWeight: '600', color: T.textPrimary },
  rowArrow: { fontSize: 20, fontWeight: '300' },
  cancelBtn: {
    marginTop: 12, backgroundColor: T.card, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  cancelText: { fontSize: 15, fontWeight: '600', color: T.textSecondary },
  // Delete dialog
  dialogBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28,
  },
  dialog: { backgroundColor: T.card, borderRadius: 20, padding: 24, width: '100%' },
  dialogTitle: { fontSize: 17, fontWeight: '700', color: T.textPrimary, marginBottom: 10, textAlign: 'center' },
  dialogBody: { fontSize: 14, color: T.textTertiary, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  dialogActions: { flexDirection: 'row', gap: 10 },
  dialogCancel: {
    flex: 1, backgroundColor: T.card, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  dialogCancelText: { fontSize: 15, fontWeight: '600', color: T.textSecondary },
  dialogDelete: {
    flex: 1, backgroundColor: T.red, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  dialogDeleteText: { fontSize: 15, fontWeight: '700', color: T.textPrimary },
});

const form = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: T.cardBorder,
    backgroundColor: T.bg,
  },
  backBtn: { width: 70 },
  backText: { fontSize: 15, color: T.teal, fontWeight: '600' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: T.textPrimary },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
  // Coach toggle
  coachRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: T.card, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 13,
    marginBottom: 24,
  },
  coachLabel: { fontSize: 14, fontWeight: '500', color: T.textPrimary },
  coachToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: T.card, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: 12,
  },
  coachToggleLabel: { fontSize: 14, fontWeight: '500', color: T.textPrimary },
  // Sections
  section: { marginBottom: 24 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: T.textTertiary, letterSpacing: 0.8, marginBottom: 10 },
  subLabel: { fontSize: 11, fontWeight: '600', color: T.textTertiary, letterSpacing: 0.4, marginBottom: 8 },
  // Tournament dropdown
  dropdown: {
    backgroundColor: T.card, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  dropdownValue: { fontSize: 15, color: T.textPrimary, fontWeight: '500', flex: 1, marginRight: 8 },
  dropdownPlaceholder: { fontSize: 15, color: T.textTertiary, flex: 1, marginRight: 8 },
  dropdownChevron: { fontSize: 11, color: T.textTertiary },
  dropdownList: {
    backgroundColor: T.card, borderRadius: 12, marginTop: 4,
    borderWidth: 1, borderColor: T.cardBorder, overflow: 'hidden',
  },
  dropdownRow: {
    paddingHorizontal: 16, paddingVertical: 13,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: T.cardBorder,
  },
  dropdownRowActive: { backgroundColor: T.accentMuted },
  dropdownRowText: { fontSize: 14, color: T.textPrimary, flex: 1 },
  dropdownRowTextActive: { color: T.teal, fontWeight: '600' },
  dropdownCheck: { fontSize: 14, color: T.teal, marginLeft: 8 },
  // Category chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: T.card },
  chipActive: { backgroundColor: T.teal },
  chipText: { fontSize: 13, fontWeight: '600', color: T.textTertiary },
  chipTextActive: { color: T.textPrimary },
  // Custom category
  customPill: {
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1.5, borderColor: T.teal, borderStyle: 'dashed',
    marginTop: 8, alignSelf: 'flex-start',
  },
  customPillText: { fontSize: 13, fontWeight: '600', color: T.teal },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  customInput: {
    flex: 1, backgroundColor: T.card, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: T.textPrimary,
  },
  customDoneBtn: { backgroundColor: T.teal, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  customDoneText: { color: T.textPrimary, fontWeight: '700', fontSize: 13 },
  // Amount
  amountRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: T.card, borderRadius: 12,
    paddingHorizontal: 14,
  },
  currencySign: { fontSize: 18, color: T.textPrimary, fontWeight: '600', marginRight: 4 },
  amountInput: { flex: 1, fontSize: 22, fontWeight: '700', color: T.textPrimary, paddingVertical: 14 },
  // Note
  input: {
    backgroundColor: T.card, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15, color: T.textPrimary,
  },
  error: { fontSize: 13, color: T.red, marginBottom: 12, textAlign: 'center' },
  saveBtn: {
    backgroundColor: T.teal, borderRadius: 14,
    paddingVertical: 17, alignItems: 'center', marginTop: 8,
  },
  saveBtnText: { color: T.textPrimary, fontSize: 16, fontWeight: '700' },
  // Monthly fixed mode styles
  fixedBanner: {
    backgroundColor: '#2A2A3E',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 20,
    alignSelf: 'flex-start',
  },
  fixedBannerText: {
    fontSize: 10,
    fontWeight: '700',
    color: T.textTertiary,
    letterSpacing: 1.2,
  },
  fixedSwitchLink: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  fixedSwitchLinkText: {
    fontSize: 13,
    color: T.textMuted,
    textDecorationLine: 'underline',
  },
  monthYearRow: {
    flexDirection: 'row',
    gap: 12,
  },
  monthPicker: {
    flex: 2,
    backgroundColor: T.card,
    borderRadius: 12,
    maxHeight: 180,
  },
  yearPicker: {
    flex: 1,
    backgroundColor: T.card,
    borderRadius: 12,
  },
  monthPickerRow: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: T.cardBorder,
  },
  monthPickerRowActive: {
    backgroundColor: T.accentMuted,
  },
  monthPickerText: {
    fontSize: 14,
    color: T.textSecondary,
    fontWeight: '500',
  },
  monthPickerTextActive: {
    color: T.teal,
    fontWeight: '700',
  },
});

// ─── Receipt scan + currency styles ──────────────────────────────────────────

const rc = StyleSheet.create({
  scanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: T.tealMuted, borderRadius: 14,
    borderWidth: 1.5, borderColor: T.teal,
    paddingVertical: 15, marginBottom: 16,
  },
  scanBtnIcon: { fontSize: 18 },
  scanBtnText: { fontSize: 15, fontWeight: '700', color: T.teal },
  scanHint: { fontSize: 12, color: T.amber, marginBottom: 16, lineHeight: 17 },
  otherPill: {
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1.5, borderColor: T.cardBorder, borderStyle: 'dashed',
  },
  otherPillText: { fontSize: 13, fontWeight: '600', color: T.textTertiary },
});

const pn = StyleSheet.create({
  hint: { fontSize: 13, color: T.textTertiary, lineHeight: 19, marginBottom: 12 },
  textArea: {
    backgroundColor: T.card, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 14,
    fontSize: 15, color: T.textPrimary, minHeight: 180,
    lineHeight: 22,
  },
  reviewHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 16,
  },
  reviewCount: { fontSize: 14, fontWeight: '600', color: T.textPrimary },
  selectAllText: { fontSize: 13, fontWeight: '600', color: T.teal },
  reviewRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: T.card, borderRadius: 12,
    padding: 14, marginBottom: 8, gap: 12,
  },
  checkbox: {
    width: 24, height: 24, borderRadius: 6,
    borderWidth: 2, borderColor: T.textMuted,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  checkboxOn: { backgroundColor: T.teal, borderColor: T.teal },
  checkmark: { color: T.textPrimary, fontSize: 14, fontWeight: '700' },
  reviewAmt: { fontSize: 16, fontWeight: '700', color: T.textPrimary },
  catBadge: {
    backgroundColor: T.cardBorder, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  catBadgeText: { fontSize: 11, fontWeight: '600', color: T.teal },
  reviewDesc: { fontSize: 13, color: T.textSecondary, marginTop: 4 },
  reviewDate: { fontSize: 12, color: T.textTertiary, marginTop: 4 },
  importBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: T.bg, borderTopWidth: 1, borderTopColor: T.cardBorder,
    paddingHorizontal: 20, paddingVertical: 16, paddingBottom: 30,
  },
  importBtn: {
    backgroundColor: T.teal, borderRadius: 14,
    paddingVertical: 17, alignItems: 'center',
  },
  importBtnText: { color: T.textPrimary, fontSize: 16, fontWeight: '700' },
});

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ScrollView,
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Switch,
  Linking,
  Alert,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAppQuery } from '@/hooks/useAppQuery';
import { apiPatchTournament, apiAddTournament, apiDeleteTournament } from '@/lib/api';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { CourtIcon } from '@/components/ui/court-icon';
import { AgentIcon } from '@/components/ui/agent-icon';
import { calcDeadlines, fmtDeadline, fmtDate, fmtDateRange, getDeadlineLabels, getStoredDeadlineFields, getOnsiteDeadlines } from '@/utils/deadlines';
import { T } from '@/constants/theme';
import { DEMO_MODE } from '@/config/demo';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
import { useLanguage } from '@/hooks/useLanguage';
import { useDemoData } from '@/hooks/useDemoData';
import { useFirstVisit } from '@/hooks/useFirstVisit';
import { useTabSwipe } from '@/hooks/useTabSwipe';
import { ScreenWalkthrough } from '@/components/ui/screen-walkthrough';
import { countryFlag, nameToIso2 } from '@/utils/countryFlag';
import { playerNameFilter } from '@/utils/text';
import { SwipeableRow } from '@/components/ui/SwipeableRow';
import { estimateTripCost } from '@/utils/trip-estimate';
import { fetchTripCostEstimate, TripCostEstimate } from '@/utils/trip-ai';

const TOURNAMENTS_WALKTHROUGH = [
  { icon: '➕', title: 'Add a Tournament', body: 'Tap + to add your first tournament. Tourly calculates all deadlines automatically from the start date.' },
  { icon: '📋', title: 'Tournament details', body: 'Tap any tournament to see its full breakdown — deadlines, expenses, prize money, and net result.' },
];
import { TournamentExpenseDetail } from '@/app/(tabs)/expenses';
import { LoadingLogo } from '@/components/ui/LoadingLogo';

function genId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ─── Types & constants ────────────────────────────────────────────────────────

type Surface = 'clay' | 'hard' | 'grass';
type Filter  = 'all' | 'active' | 'upcoming' | 'past' | 'withdrawn';

const SURFACE_BG:   Record<string, string> = { clay: '#2A1A08', hard: '#081828', grass: '#0A1E06' };
const SURFACE_TEXT: Record<string, string> = { clay: T.clayText, hard: T.hardText, grass: T.grassText };

// FILTERS is computed inside TournamentsScreen using t() — see getFilters() below

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
  return 'upcoming';
}

function getPill(t: any): { type: string; label: string } | null {
  if (getGroup(t) === 'past') return null;
  if (!t.isRegistered) {
    const days = daysUntil(t.signUpDeadline);
    if (days === null) return { type: 'signup', label: 'Sign Up' };
    if (days < 0) return null;
    return { type: 'signup', label: `Sign Up ${days}d` };
  }
  // Registered: always show withdrawal deadline while it's still in the future
  const wd = daysUntil(t.withdrawalDeadline);
  if (wd === null) return null;
  if (wd < 0) return null;
  if (wd === 0) return { type: 'withdraw', label: 'Withdraw today' };
  return { type: 'withdraw', label: `Withdraw in ${wd}d` };
}

function calcEndDate(startDateStr: string): string {
  const [y, m, d] = startDateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + 6);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function deadlineColor(dateStr: string | undefined): string {
  const d = daysUntil(dateStr);
  if (d === null) return T.textMuted;
  if (d <= 0) return T.red;
  if (d <= 7) return T.amber;
  return T.textTertiary;
}

function deadlineLabel(dateStr: string | undefined): string {
  const d = daysUntil(dateStr);
  if (d === null) return '—';
  if (d < 0) return `${Math.abs(d)}d ago`;
  if (d === 0) return 'today';
  return `in ${d}d`;
}


function fmt(n: number) {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0 });
}

function fmtShortDate(iso: string): string {
  if (!iso) return '…';
  const [, m, d] = iso.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${months[m - 1]}`;
}

function challengerDisplayName(trn: { name?: string; city?: string; category?: string }): string {
  const cat = trn.category ?? '';
  if (!cat.toLowerCase().includes('challenger')) return trn.name ?? '';
  const tierMatch = cat.match(/\d+/);
  const city = (trn.city ?? '').trim();
  if (city && tierMatch) {
    return `${city.toUpperCase()} CH ${tierMatch[0]}`;
  }
  // Fallback: city or tier missing — use category + name to avoid blank label
  return `${cat} ${trn.name ?? ''}`.trim();
}

function getWeekMonday(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dow = date.getDay();
  date.setDate(date.getDate() - (dow === 0 ? 6 : dow - 1));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function groupByWeek(tournaments: any[], noDateLabel: string): { weekLabel: string; weekKey: string; items: any[] }[] {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const grouped: Record<string, any[]> = {};
  for (const t of tournaments) {
    const key = getWeekMonday(t.startDate) || 'unknown';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(t);
  }
  return Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => {
      if (key === 'unknown') return { weekLabel: noDateLabel, weekKey: key, items };
      const [y, m, d] = key.split('-').map(Number);
      const mon = new Date(y, m - 1, d);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      const label = mon.getMonth() === sun.getMonth()
        ? `${d}–${sun.getDate()} ${MONTHS[m - 1]} ${y}`
        : `${d} ${MONTHS[m - 1]} – ${sun.getDate()} ${MONTHS[sun.getMonth()]} ${y}`;
      return { weekLabel: label, weekKey: key, items };
    });
}

// ─── Tournament card (list) ───────────────────────────────────────────────────

function TournamentCard({ item, onPress, selected, selectMode, onLongPress, t }: {
  item: any; onPress: () => void; selected?: boolean; selectMode?: boolean; onLongPress?: () => void; t: (key: any) => string;
}) {
  const group     = getGroup(item);
  const pill      = getPill(item);

  return (
    <TouchableOpacity style={[styles.card, selected && styles.cardSelected]} onPress={onPress} onLongPress={onLongPress} activeOpacity={0.8}>
      <View style={styles.cardTopRow}>
        {selectMode && (
          <View style={[styles.selectBox, selected && styles.selectBoxOn]}>
            {selected && <Text style={styles.selectCheck}>✓</Text>}
          </View>
        )}
        {item.surface && <CourtIcon surface={item.surface} size="sm" />}
        <Text style={styles.cardTitle} numberOfLines={2}>
          {item.country ? countryFlag(item.country) + ' ' : ''}{item.name}
        </Text>
        {group === 'past' ? (
          // Every past tournament reads "History" regardless of origin
          // (user-registered vs scraper-materialized) — one consistent badge,
          // not two visually different ones for the same past state.
          <View style={styles.scrapedBadge}><Text style={styles.scrapedBadgeText}>{t('tournaments.history')}</Text></View>
        ) : (
          item.isRegistered
            ? <View style={styles.registeredBadge}><Text style={styles.registeredText}>{t('tournaments.registeredBadge')}</Text></View>
            : <View style={styles.notRegisteredBadge}><Text style={styles.notRegisteredText}>{t('tournaments.notRegistered')}</Text></View>
        )}
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

function WithdrawDialog({ name, undoing, onConfirm, onCancel, t }: {
  name: string; undoing?: boolean; onConfirm: () => void; onCancel: () => void; t: (key: any) => string;
}) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.dialogBackdrop} onPress={onCancel}>
        <Pressable style={styles.dialog} onPress={() => {}}>
          <Text style={styles.dialogTitle}>
            {undoing ? t('tournament.undoWithdraw') : t('alerts.withdrawConfirm')}
          </Text>
          <Text style={styles.dialogBody}>
            {undoing
              ? `${t('tournament.undoWithdrawMsg')} ${name}.`
              : `${t('tournament.withdrawMsg')} ${name}.`}
          </Text>
          <View style={styles.dialogActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.7}>
              <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.withdrawConfirmBtn, undoing && { backgroundColor: T.teal }]}
              onPress={onConfirm} activeOpacity={0.8}>
              <Text style={styles.withdrawConfirmText}>{undoing ? t('tournament.undo') : t('tournament.withdraw')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}


// ─── Shared form constants ────────────────────────────────────────────────────

const SURFACES   = ['clay', 'hard', 'grass'];
const CATEGORY_GROUPS = [
  { label: 'ITF Men', items: ['M15', 'M25'] },
  { label: 'ITF Women', items: ['W15', 'W25', 'W35', 'W50', 'W75', 'W100'] },
  { label: 'ATP Challengers', items: ['Challenger 50', 'Challenger 75', 'Challenger 100', 'Challenger 125', 'Challenger 175'] },
  { label: 'ATP Tour', items: ['ATP 250', 'ATP 500', 'Masters 1000', 'Grand Slam'] },
];
const CATEGORIES = CATEGORY_GROUPS.flatMap(g => g.items);
const COUNTRIES = [
  {code:'AF',name:'Afghanistan'},{code:'AL',name:'Albania'},{code:'DZ',name:'Algeria'},{code:'AD',name:'Andorra'},
  {code:'AO',name:'Angola'},{code:'AG',name:'Antigua and Barbuda'},{code:'AR',name:'Argentina'},{code:'AM',name:'Armenia'},
  {code:'AU',name:'Australia'},{code:'AT',name:'Austria'},{code:'AZ',name:'Azerbaijan'},{code:'BS',name:'Bahamas'},
  {code:'BH',name:'Bahrain'},{code:'BD',name:'Bangladesh'},{code:'BB',name:'Barbados'},{code:'BY',name:'Belarus'},
  {code:'BE',name:'Belgium'},{code:'BZ',name:'Belize'},{code:'BJ',name:'Benin'},{code:'BT',name:'Bhutan'},
  {code:'BO',name:'Bolivia'},{code:'BA',name:'Bosnia and Herzegovina'},{code:'BW',name:'Botswana'},{code:'BR',name:'Brazil'},
  {code:'BN',name:'Brunei'},{code:'BG',name:'Bulgaria'},{code:'BF',name:'Burkina Faso'},{code:'BI',name:'Burundi'},
  {code:'CV',name:'Cabo Verde'},{code:'KH',name:'Cambodia'},{code:'CM',name:'Cameroon'},{code:'CA',name:'Canada'},
  {code:'CF',name:'Central African Republic'},{code:'TD',name:'Chad'},{code:'CL',name:'Chile'},{code:'CN',name:'China'},
  {code:'CO',name:'Colombia'},{code:'KM',name:'Comoros'},{code:'CG',name:'Congo'},{code:'CR',name:'Costa Rica'},
  {code:'CI',name:"Côte d'Ivoire"},{code:'HR',name:'Croatia'},{code:'CU',name:'Cuba'},{code:'CY',name:'Cyprus'},
  {code:'CZ',name:'Czech Republic'},{code:'CD',name:'DR Congo'},{code:'DK',name:'Denmark'},{code:'DJ',name:'Djibouti'},
  {code:'DM',name:'Dominica'},{code:'DO',name:'Dominican Republic'},{code:'EC',name:'Ecuador'},{code:'EG',name:'Egypt'},
  {code:'SV',name:'El Salvador'},{code:'GQ',name:'Equatorial Guinea'},{code:'ER',name:'Eritrea'},{code:'EE',name:'Estonia'},
  {code:'SZ',name:'Eswatini'},{code:'ET',name:'Ethiopia'},{code:'FJ',name:'Fiji'},{code:'FI',name:'Finland'},
  {code:'FR',name:'France'},{code:'GA',name:'Gabon'},{code:'GM',name:'Gambia'},{code:'GE',name:'Georgia'},
  {code:'DE',name:'Germany'},{code:'GH',name:'Ghana'},{code:'GR',name:'Greece'},{code:'GD',name:'Grenada'},
  {code:'GT',name:'Guatemala'},{code:'GN',name:'Guinea'},{code:'GW',name:'Guinea-Bissau'},{code:'GY',name:'Guyana'},
  {code:'HT',name:'Haiti'},{code:'HN',name:'Honduras'},{code:'HK',name:'Hong Kong'},{code:'HU',name:'Hungary'},
  {code:'IS',name:'Iceland'},{code:'IN',name:'India'},{code:'ID',name:'Indonesia'},{code:'IR',name:'Iran'},
  {code:'IQ',name:'Iraq'},{code:'IE',name:'Ireland'},{code:'IL',name:'Israel'},{code:'IT',name:'Italy'},
  {code:'JM',name:'Jamaica'},{code:'JP',name:'Japan'},{code:'JO',name:'Jordan'},{code:'KZ',name:'Kazakhstan'},
  {code:'KE',name:'Kenya'},{code:'KI',name:'Kiribati'},{code:'KW',name:'Kuwait'},{code:'KG',name:'Kyrgyzstan'},
  {code:'LA',name:'Laos'},{code:'LV',name:'Latvia'},{code:'LB',name:'Lebanon'},{code:'LS',name:'Lesotho'},
  {code:'LR',name:'Liberia'},{code:'LY',name:'Libya'},{code:'LI',name:'Liechtenstein'},{code:'LT',name:'Lithuania'},
  {code:'LU',name:'Luxembourg'},{code:'MG',name:'Madagascar'},{code:'MW',name:'Malawi'},{code:'MY',name:'Malaysia'},
  {code:'MV',name:'Maldives'},{code:'ML',name:'Mali'},{code:'MT',name:'Malta'},{code:'MH',name:'Marshall Islands'},
  {code:'MR',name:'Mauritania'},{code:'MU',name:'Mauritius'},{code:'MX',name:'Mexico'},{code:'FM',name:'Micronesia'},
  {code:'MD',name:'Moldova'},{code:'MC',name:'Monaco'},{code:'MN',name:'Mongolia'},{code:'ME',name:'Montenegro'},
  {code:'MA',name:'Morocco'},{code:'MZ',name:'Mozambique'},{code:'MM',name:'Myanmar'},{code:'NA',name:'Namibia'},
  {code:'NR',name:'Nauru'},{code:'NP',name:'Nepal'},{code:'NL',name:'Netherlands'},{code:'NZ',name:'New Zealand'},
  {code:'NI',name:'Nicaragua'},{code:'NE',name:'Niger'},{code:'NG',name:'Nigeria'},{code:'KP',name:'North Korea'},
  {code:'MK',name:'North Macedonia'},{code:'NO',name:'Norway'},{code:'OM',name:'Oman'},{code:'PK',name:'Pakistan'},
  {code:'PW',name:'Palau'},{code:'PS',name:'Palestine'},{code:'PA',name:'Panama'},{code:'PG',name:'Papua New Guinea'},
  {code:'PY',name:'Paraguay'},{code:'PE',name:'Peru'},{code:'PH',name:'Philippines'},{code:'PL',name:'Poland'},
  {code:'PT',name:'Portugal'},{code:'QA',name:'Qatar'},{code:'RO',name:'Romania'},{code:'RU',name:'Russia'},
  {code:'RW',name:'Rwanda'},{code:'KN',name:'Saint Kitts and Nevis'},{code:'LC',name:'Saint Lucia'},
  {code:'VC',name:'Saint Vincent'},{code:'WS',name:'Samoa'},{code:'SM',name:'San Marino'},
  {code:'ST',name:'Sao Tome and Principe'},{code:'SA',name:'Saudi Arabia'},{code:'SN',name:'Senegal'},
  {code:'RS',name:'Serbia'},{code:'SC',name:'Seychelles'},{code:'SL',name:'Sierra Leone'},{code:'SG',name:'Singapore'},
  {code:'SK',name:'Slovakia'},{code:'SI',name:'Slovenia'},{code:'SB',name:'Solomon Islands'},{code:'SO',name:'Somalia'},
  {code:'ZA',name:'South Africa'},{code:'KR',name:'South Korea'},{code:'SS',name:'South Sudan'},{code:'ES',name:'Spain'},
  {code:'LK',name:'Sri Lanka'},{code:'SD',name:'Sudan'},{code:'SR',name:'Suriname'},{code:'SE',name:'Sweden'},
  {code:'CH',name:'Switzerland'},{code:'SY',name:'Syria'},{code:'TW',name:'Taiwan'},{code:'TJ',name:'Tajikistan'},
  {code:'TZ',name:'Tanzania'},{code:'TH',name:'Thailand'},{code:'TL',name:'Timor-Leste'},{code:'TG',name:'Togo'},
  {code:'TO',name:'Tonga'},{code:'TT',name:'Trinidad and Tobago'},{code:'TN',name:'Tunisia'},{code:'TR',name:'Turkey'},
  {code:'TM',name:'Turkmenistan'},{code:'TV',name:'Tuvalu'},{code:'UG',name:'Uganda'},{code:'UA',name:'Ukraine'},
  {code:'AE',name:'United Arab Emirates'},{code:'GB',name:'United Kingdom'},{code:'US',name:'United States'},
  {code:'UY',name:'Uruguay'},{code:'UZ',name:'Uzbekistan'},{code:'VU',name:'Vanuatu'},{code:'VA',name:'Vatican City'},
  {code:'VE',name:'Venezuela'},{code:'VN',name:'Vietnam'},{code:'YE',name:'Yemen'},{code:'ZM',name:'Zambia'},
  {code:'ZW',name:'Zimbabwe'},
];
const COUNTRY_NAME: Record<string, string> = Object.fromEntries(COUNTRIES.map(c => [c.code, c.name]));

// Localized country display name (Hermes may lack Intl.DisplayNames — fall back
// to the English COUNTRY_NAME map, then to the raw code).
function countryDisplayName(code: string | undefined, lang: string): string {
  if (!code) return '';
  const up = code.toUpperCase();
  try {
    const name = new (Intl as any).DisplayNames([lang], { type: 'region' }).of(up);
    if (name && name !== up) return name;
  } catch {}
  return COUNTRY_NAME[up] ?? code;
}

// ─── Country Picker ──────────────────────────────────────────────────────────

function CountryPicker({ value, onChange, label, labelStyle, t }: { value: string; onChange: (code: string) => void; label?: string; labelStyle?: any; t: (key: any) => string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = search.trim()
    ? COUNTRIES.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.code.toLowerCase().includes(search.toLowerCase()))
    : COUNTRIES;
  const selected = COUNTRIES.find(c => c.code === value);

  return (
    <>
      {label && <Text style={[cpStyles.label, labelStyle]}>{label}</Text>}
      <TouchableOpacity style={cpStyles.trigger} onPress={() => { setOpen(true); setSearch(''); }} activeOpacity={0.7}>
        <Text style={cpStyles.triggerText}>
          {selected ? `${countryFlag(selected.code)} ${selected.name}` : t('tournament.selectCountry')}
        </Text>
        <Text style={cpStyles.triggerArrow}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent>
        <Pressable style={cpStyles.backdrop} onPress={() => setOpen(false)} />
        <View style={cpStyles.sheet}>
          <View style={cpStyles.handle} />
          <TextInput
            style={cpStyles.searchInput}
            placeholder={t('tournament.searchCountry')}
            placeholderTextColor="#888"
            value={search}
            onChangeText={setSearch}
            autoFocus
          />
          <ScrollView keyboardShouldPersistTaps="handled" style={cpStyles.list}>
            {filtered.map(c => (
              <TouchableOpacity key={c.code} style={[cpStyles.row, value === c.code && cpStyles.rowActive]}
                onPress={() => { onChange(c.code); setOpen(false); }} activeOpacity={0.7}>
                <Text style={cpStyles.rowFlag}>{countryFlag(c.code)}</Text>
                <Text style={[cpStyles.rowName, value === c.code && cpStyles.rowNameActive]}>{c.name}</Text>
                <Text style={cpStyles.rowCode}>{c.code}</Text>
              </TouchableOpacity>
            ))}
            {filtered.length === 0 && <Text style={cpStyles.empty}>{t('tournament.noCountriesFound')}</Text>}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const cpStyles = StyleSheet.create({
  label: { color: T.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, marginTop: 12 },
  trigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: T.card, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: T.cardBorder },
  triggerText: { color: T.textPrimary, fontSize: 15 },
  triggerArrow: { color: T.textTertiary, fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: T.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%', paddingBottom: 30 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#3A3A5C', alignSelf: 'center', marginTop: 10, marginBottom: 10 },
  searchInput: { backgroundColor: T.bg, color: T.textPrimary, fontSize: 15, borderRadius: 10, marginHorizontal: 16, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8, borderWidth: 1, borderColor: T.cardBorder },
  list: { paddingHorizontal: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10 },
  rowActive: { backgroundColor: '#1A2A28' },
  rowFlag: { fontSize: 22, marginRight: 12 },
  rowName: { flex: 1, color: T.textPrimary, fontSize: 15 },
  rowNameActive: { color: T.teal, fontWeight: '600' },
  rowCode: { color: T.textTertiary, fontSize: 13, marginLeft: 8 },
  empty: { color: T.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 20 },
});

// ─── Category Picker ─────────────────────────────────────────────────────────

function CategoryPicker({ value, onChange, label, t }: { value: string; onChange: (v: string) => void; label?: string; t: (key: any) => string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {label && <Text style={cpStyles.label}>{label}</Text>}
      <TouchableOpacity style={cpStyles.trigger} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={cpStyles.triggerText}>{value || t('tournament.selectCategoryAction')}</Text>
        <Text style={cpStyles.triggerArrow}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent>
        <Pressable style={cpStyles.backdrop} onPress={() => setOpen(false)} />
        <View style={catStyles.sheet}>
          <View style={cpStyles.handle} />
          <Text style={catStyles.title}>{t('tournament.selectCategory')}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={catStyles.list}>
            {CATEGORY_GROUPS.map(group => (
              <View key={group.label} style={catStyles.group}>
                <Text style={catStyles.groupLabel}>{group.label}</Text>
                {group.items.map(item => (
                  <TouchableOpacity key={item} style={[catStyles.row, value === item && catStyles.rowActive]}
                    onPress={() => { onChange(item); setOpen(false); }} activeOpacity={0.7}>
                    <Text style={[catStyles.rowText, value === item && catStyles.rowTextActive]}>{item}</Text>
                    {value === item && <Text style={catStyles.check}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const catStyles = StyleSheet.create({
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: T.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '60%', paddingBottom: 30 },
  title: { color: T.textPrimary, fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  list: { paddingHorizontal: 16 },
  group: { marginBottom: 16 },
  groupLabel: { color: T.teal, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 12, borderRadius: 10 },
  rowActive: { backgroundColor: '#1A2A28' },
  rowText: { color: T.textPrimary, fontSize: 15 },
  rowTextActive: { color: T.teal, fontWeight: '600' },
  check: { color: T.teal, fontSize: 16, fontWeight: '700' },
});

// ─── Match Results Section ───────────────────────────────────────────────────

// ─── Ranking Impact Section ──────────────────────────────────────────────────

function RankingImpactSection({ tournament }: { tournament: any }) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [rankBefore, setRankBefore] = useState(String(tournament.rankingBefore ?? ''));
  const [rankAfter, setRankAfter] = useState(String(tournament.rankingAfter ?? ''));
  const demoCtx = useDemoData();

  const totalPoints = (tournament.matchResults ?? []).reduce((s: number, r: any) => s + (r.points ?? 0), 0) + (tournament.pointsEarned ?? 0);
  const rb = parseInt(rankBefore) || 0;
  const ra = parseInt(rankAfter) || 0;
  const change = rb > 0 && ra > 0 ? rb - ra : 0;

  async function save() {
    const updates = { rankingBefore: parseInt(rankBefore) || null, rankingAfter: parseInt(rankAfter) || null };
    if (DEMO_MODE) {
      demoCtx?.patchTournament(tournament.id, updates);
    } else {
      await apiPatchTournament(tournament.id, updates);
    }
    setEditing(false);
  }

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={det.sectionLabel}>{t('tournament.rankingImpact')}</Text>
          <Text style={{ fontSize: 10, color: T.accent }}>⚡</Text>
        </View>
        <TouchableOpacity onPress={() => setEditing(!editing)} activeOpacity={0.7}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: T.teal }}>{editing ? t('common.cancel') : t('common.edit')}</Text>
        </TouchableOpacity>
      </View>
      <Text style={{ fontSize: 11, color: T.textTertiary, fontStyle: 'italic', marginBottom: 10 }}>{t('tournament.autoFilled')}</Text>

      <View style={det.prizeCard}>
        <View style={det.prizeRow}>
          <Text style={det.prizeLabel}>{t('tournament.pointsEarned')}</Text>
          <Text style={{ fontSize: 15, fontWeight: '700', color: totalPoints > 0 ? T.green : T.textTertiary }}>
            {totalPoints > 0 ? `+${totalPoints}` : '—'}
          </Text>
        </View>
        <View style={det.deadlineDivider} />
        {editing ? (
          <>
            <View style={{ padding: 16 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: T.textTertiary, letterSpacing: 0.6, marginBottom: 8 }}>{t('tournament.rankingBefore')}</Text>
              <TextInput style={det.editInput} value={rankBefore} onChangeText={setRankBefore}
                placeholder="e.g. 450" placeholderTextColor={T.textTertiary} keyboardType="numeric" />
              <Text style={{ fontSize: 11, fontWeight: '700', color: T.textTertiary, letterSpacing: 0.6, marginBottom: 8, marginTop: 14 }}>{t('tournament.rankingAfter')}</Text>
              <TextInput style={det.editInput} value={rankAfter} onChangeText={setRankAfter}
                placeholder="e.g. 420" placeholderTextColor={T.textTertiary} keyboardType="numeric" />
              <TouchableOpacity onPress={save} activeOpacity={0.8}
                style={{ backgroundColor: T.teal, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 14 }}>
                <Text style={{ color: T.textPrimary, fontSize: 15, fontWeight: '700' }}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <View style={det.prizeRow}>
              <Text style={det.prizeLabel}>{t('tournament.rankingBefore')}</Text>
              <Text style={{ fontSize: 15, fontWeight: '600', color: rb > 0 ? T.textPrimary : T.textTertiary }}>
                {rb > 0 ? `#${rb}` : '—'}
              </Text>
            </View>
            <View style={det.deadlineDivider} />
            <View style={det.prizeRow}>
              <Text style={det.prizeLabel}>{t('tournament.rankingAfter')}</Text>
              <Text style={{ fontSize: 15, fontWeight: '600', color: ra > 0 ? T.textPrimary : T.textTertiary }}>
                {ra > 0 ? `#${ra}` : '—'}
              </Text>
            </View>
            {change !== 0 && (
              <>
                <View style={det.deadlineDivider} />
                <View style={det.prizeRow}>
                  <Text style={[det.prizeLabel, { fontWeight: '700' }]}>{t('tournament.netChange')}</Text>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: change > 0 ? T.green : T.red }}>
                    {change > 0 ? `+${change}` : `${change}`} {t('tournament.positions')}
                  </Text>
                </View>
              </>
            )}
          </>
        )}
      </View>
    </>
  );
}

// ─── Tournament detail screen ─────────────────────────────────────────────────

interface EditState {
  name: string; country: string; city: string; surface: string; category: string;
  startDate: string; endDate: string; signUpDeadline: string; withdrawalDeadline: string;
  freezeDeadline: string;
  singlesPrizeMoney: string; doublesPrizeMoney: string;
  taxWithholdingPct: string;
}

export function TournamentDetail({ tournamentId, onClose }: { tournamentId: string; onClose: () => void }) {
  const { t, lang } = useLanguage();
  const { data } = useAppQuery({ tournaments: {}, expenses: {} });

  const tournament = (data?.tournaments ?? []).find((x: any) => x.id === tournamentId);

  const tripEstimate = useMemo(() => {
    if (!tournament) return null;
    const todayIso = new Date().toISOString().slice(0, 10);
    if (!(tournament.startDate > todayIso)) return null; // only for upcoming tournaments the player hasn't played yet
    return estimateTripCost(
      { country: tournament.country ?? '', category: tournament.category ?? '', startDate: tournament.startDate },
      data?.tournaments ?? [],
      data?.expenses ?? [],
    );
  }, [tournament, data?.tournaments, data?.expenses]);

  const [showWithdraw,    setShowWithdraw]    = useState(false);
  const [undoingWithdraw, setUndoingWithdraw] = useState(false);
  const [savingAction,    setSavingAction]    = useState<string | null>(null);
  const [editing,         setEditing]         = useState(false);
  const [editState,       setEditState]       = useState<EditState | null>(null);
  const [editOverrides,   setEditOverrides]   = useState({ signUp: false, withdrawal: false, freeze: false });
  const [saving,          setSaving]          = useState(false);
  const [editError,       setEditError]       = useState('');
  const demoCtx = useDemoData();

  // AI trip-cost breakdown sheet — cached per tournament id so reopening
  // doesn't refetch (server also caches for 14 days, this is just to avoid
  // an extra round-trip while the sheet is open/closed repeatedly).
  const [showAiBreakdown, setShowAiBreakdown] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiEstimates, setAiEstimates] = useState<Record<string, TripCostEstimate | null>>({});
  const [aiErrored, setAiErrored] = useState<Record<string, boolean>>({});

  if (!tournament) return null;

  const surfaceBg   = SURFACE_BG[(editing ? editState?.surface : tournament.surface) as Surface]   ?? '#FAEEDA';
  const surfaceText = SURFACE_TEXT[(editing ? editState?.surface : tournament.surface) as Surface]  ?? '#854F0B';
  const group       = getGroup(tournament);
  const metaLine    = [fmtDateRange(tournament.startDate, tournament.endDate), countryDisplayName(tournament.country, lang) || tournament.country]
    .filter(Boolean).join('  ·  ');

  function startEdit() {
    const start = tournament.startDate ?? '';
    const calc  = start ? calcDeadlines(start, tournament.category) : null;
    setEditState({
      name: tournament.name ?? '',
      country: tournament.country ?? '',
      city: tournament.city ?? '',
      surface: tournament.surface ?? 'clay',
      category: tournament.category ?? 'M25',
      startDate: start,
      endDate: tournament.endDate ?? '',
      signUpDeadline:     tournament.signUpDeadline     ?? calc?.signUpDeadline     ?? '',
      withdrawalDeadline: tournament.withdrawalDeadline ?? calc?.withdrawalDeadline ?? '',
      freezeDeadline:     tournament.freezeDeadline     ?? calc?.freezeDeadline     ?? '',
      singlesPrizeMoney:  (tournament.singlesPrizeMoney ?? 0) > 0 ? String(tournament.singlesPrizeMoney) : '',
      doublesPrizeMoney:  (tournament.doublesPrizeMoney ?? 0) > 0 ? String(tournament.doublesPrizeMoney) : '',
      taxWithholdingPct:  (tournament.taxWithholdingPct ?? 0) > 0 ? String(tournament.taxWithholdingPct) : '',
    });
    // A stored deadline that differs from the formula is a user override —
    // start with the override flag ON so saving doesn't silently reset it.
    setEditOverrides({
      signUp:     !!(tournament.signUpDeadline     && calc && tournament.signUpDeadline     !== calc.signUpDeadline),
      withdrawal: !!(tournament.withdrawalDeadline && calc && tournament.withdrawalDeadline !== calc.withdrawalDeadline),
      freeze:     !!(tournament.freezeDeadline     && calc && tournament.freezeDeadline     !== calc.freezeDeadline),
    });
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
      setEditState(prev => {
        if (!prev) return prev;
        const calc = calcDeadlines(value, prev.category);
        return {
          ...prev,
          startDate: value,
          endDate: calcEndDate(value),
          ...(!editOverrides.signUp      ? { signUpDeadline:     calc.signUpDeadline }     : {}),
          ...(!editOverrides.withdrawal  ? { withdrawalDeadline: calc.withdrawalDeadline } : {}),
          ...(!editOverrides.freeze      ? { freezeDeadline:     calc.freezeDeadline }     : {}),
        };
      });
    } else if (key === 'category') {
      setEditState(prev => {
        if (!prev) return prev;
        const updated = { ...prev, category: value };
        if (prev.startDate) {
          const calc = calcDeadlines(prev.startDate, value);
          if (!editOverrides.signUp)     updated.signUpDeadline     = calc.signUpDeadline;
          if (!editOverrides.withdrawal) updated.withdrawalDeadline = calc.withdrawalDeadline;
          if (!editOverrides.freeze)     updated.freezeDeadline     = calc.freezeDeadline;
        }
        return updated;
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
    const editCalc = calcDeadlines(editState.startDate, editState.category);
    const updates = {
      name: editState.name.trim(),
      country: editState.country,
      city: editState.city.trim(),
      surface: editState.surface,
      category: editState.category,
      startDate: editState.startDate,
      endDate: editState.endDate,
      signUpDeadline: editOverrides.signUp ? editState.signUpDeadline : editCalc.signUpDeadline,
      withdrawalDeadline: editOverrides.withdrawal ? editState.withdrawalDeadline : editCalc.withdrawalDeadline,
      freezeDeadline: editOverrides.freeze ? editState.freezeDeadline : editCalc.freezeDeadline,
      // Accept comma decimals — locale decimal-pad keyboards only offer ","
      singlesPrizeMoney: parseFloat(editState.singlesPrizeMoney.replace(',', '.')) || 0,
      doublesPrizeMoney: parseFloat(editState.doublesPrizeMoney.replace(',', '.')) || 0,
      taxWithholdingPct: editState.taxWithholdingPct.trim()
        ? Math.min(100, Math.max(0, parseFloat(editState.taxWithholdingPct.replace(',', '.')) || 0))
        : null,
    };
    try {
      if (DEMO_MODE) {
        demoCtx?.patchTournament(tournament.id, updates);
      } else {
        // Notifications are rescheduled by useNotificationSetup when the
        // tournaments query refreshes — no direct call here (it would use
        // stale data and ignore the user's notification preferences).
        await apiPatchTournament(tournament.id, updates);
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
        demoCtx?.patchTournament(tournament.id, updates);
      } else {
        await apiPatchTournament(tournament.id, updates);
      }
      onClose();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? 'Please try again.');
    } finally { setSavingAction(null); }
  }

  async function confirmWithdraw() {
    const newValue = !undoingWithdraw;
    setSavingAction('withdraw');
    try {
      if (DEMO_MODE) {
        demoCtx?.patchTournament(tournament.id, { isWithdrawn: newValue });
      } else {
        // Re-registering reschedules via the useNotificationSetup effect.
        await apiPatchTournament(tournament.id, { isWithdrawn: newValue });
        if (newValue) {
          const { cancelTournamentNotifications } = await import('@/utils/notifications');
          await cancelTournamentNotifications(tournament.id);
        }
      }
      setShowWithdraw(false);
      onClose();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? 'Please try again.');
    } finally { setSavingAction(null); }
  }

  async function openAiBreakdown(forceRefresh = false) {
    setShowAiBreakdown(true);
    const cached = aiEstimates[tournament.id];
    if (cached && !forceRefresh) return;
    setAiLoading(true);
    setAiErrored(prev => ({ ...prev, [tournament.id]: false }));
    const result = await fetchTripCostEstimate(tournament.id, forceRefresh);
    setAiLoading(false);
    if (result) {
      setAiEstimates(prev => ({ ...prev, [tournament.id]: result }));
    } else {
      setAiErrored(prev => ({ ...prev, [tournament.id]: true }));
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={editing ? cancelEdit : onClose} statusBarTranslucent>
      <SafeAreaView style={det.safe}>

        {/* Nav bar */}
        <View style={det.navbar}>
          <TouchableOpacity onPress={editing ? cancelEdit : onClose} style={det.backBtn} activeOpacity={0.7}>
            <Text style={det.backText}>{editing ? t('common.cancel') : t('common.back')}</Text>
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
                    {countryDisplayName(editState.country, lang) || editState.country}
                  </Text>
                </View>
              </>
            ) : (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                  <Text style={[det.headerName, { color: surfaceText, flex: 1 }]} numberOfLines={2}>
                    {tournament.country ? countryFlag(tournament.country) + ' ' : ''}{tournament.name}
                  </Text>
                  <Text style={{ fontSize: 12, color: T.accent, marginTop: 4 }}>⚡</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  <CourtIcon surface={tournament.surface} />
                  <Text style={[det.headerMeta, { color: surfaceText + 'CC' }]}>
                    {metaLine}
                  </Text>
                </View>
              </>
            )}
          </View>

          {!editing && !tournament.country && (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(240,168,48,0.12)', borderRadius: 10, marginHorizontal: 20, marginTop: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(240,168,48,0.35)' }}
              activeOpacity={0.8}
              onPress={() => setEditing(true)}
            >
              <Text style={{ fontSize: 14 }}>⚠️</Text>
              <Text style={{ flex: 1, fontSize: 12, color: T.amber, fontWeight: '600' }}>Country missing — tap to add it so this tournament appears in Cost by Country.</Text>
            </TouchableOpacity>
          )}

          {editing && editState ? (
            /* ── EDIT MODE ── */
            <View style={det.body}>

              <Text style={det.sectionLabel}>{t('tournament.surface').toUpperCase()}</Text>
              <View style={det.editChipRow}>
                {SURFACES.map((s) => (
                  <TouchableOpacity key={s}
                    style={[det.editChip, editState.surface === s && { backgroundColor: SURFACE_BG[s] }]}
                    onPress={() => setEF('surface', s)} activeOpacity={0.7}>
                    <Text style={[det.editChipText, editState.surface === s && { color: SURFACE_TEXT[s], fontWeight: '700' }]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <CategoryPicker label="CATEGORY" value={editState.category} onChange={(v) => setEF('category', v)} t={t} />

              <CountryPicker
                label={!editState.country ? '⚠ COUNTRY — missing' : 'COUNTRY'}
                labelStyle={!editState.country ? { color: T.amber } : undefined}
                value={editState.country}
                onChange={(v) => setEF('country', v)}
                t={t}
              />

              <Text style={det.sectionLabel}>{t('tournament.city').toUpperCase()}</Text>
              <TextInput style={det.editInput} value={editState.city} onChangeText={(v) => setEF('city', v)}
                placeholder="City" placeholderTextColor={T.textSecondary} />

              <Text style={det.sectionLabel}>{t('tournament.dates').toUpperCase()}</Text>
              <Text style={det.editDateLabel}>{t('tournament.startDateHint')}</Text>
              <DatePickerField value={editState.startDate} onChange={(v) => setEF('startDate', v)} placeholder="YYYY-MM-DD" />

              <Text style={det.sectionLabel}>{t('tournament.deadlinesAuto')}</Text>
              {getStoredDeadlineFields(editState.category).map(({ field, label }) => {
                const ok = field === 'signUpDeadline' ? 'signUp' as const : field === 'withdrawalDeadline' ? 'withdrawal' as const : 'freeze' as const;
                return (
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
                    <DatePickerField value={editState[field]} onChange={(v) => setEF(field as keyof EditState, v)} placeholder="YYYY-MM-DD" />
                  ) : (
                    <Text style={det.deadlinePreviewText}>
                      {editState[field as keyof EditState] ? fmtDeadline(editState[field as keyof EditState]) : t('tournament.selectStartFirst')}
                    </Text>
                  )}
                </View>
                );
              })}

              <Text style={det.sectionLabel}>{t('tournament.prizeMoneyWon')}</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={det.editDateLabel}>{t('prize.singles')}</Text>
                  <TextInput
                    style={det.editInput}
                    value={editState.singlesPrizeMoney}
                    onChangeText={(v) => setEditState(prev => prev ? { ...prev, singlesPrizeMoney: v } : prev)}
                    placeholder="0"
                    placeholderTextColor={T.textSecondary}
                    keyboardType="numeric"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={det.editDateLabel}>{t('prize.doubles')}</Text>
                  <TextInput
                    style={det.editInput}
                    value={editState.doublesPrizeMoney}
                    onChangeText={(v) => setEditState(prev => prev ? { ...prev, doublesPrizeMoney: v } : prev)}
                    placeholder="0"
                    placeholderTextColor={T.textSecondary}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <Text style={det.editDateLabel}>{t('tournament.taxWithholding')}</Text>
              <TextInput
                style={det.editInput}
                value={editState.taxWithholdingPct}
                onChangeText={(v) => setEditState(prev => prev ? { ...prev, taxWithholdingPct: v } : prev)}
                placeholder="0"
                placeholderTextColor={T.textSecondary}
                keyboardType="numeric"
              />

              {editError ? <Text style={det.editError}>{editError}</Text> : null}

              <View style={det.editActions}>
                <TouchableOpacity style={det.editCancelBtn} onPress={cancelEdit} activeOpacity={0.7} disabled={saving}>
                  <Text style={det.editCancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={det.editSaveBtn} onPress={saveEdit} activeOpacity={0.8} disabled={saving}>
                  {saving
                    ? <ActivityIndicator color={T.textPrimary} />
                    : <Text style={det.editSaveText}>{t('tournament.saveChanges')}</Text>}
                </TouchableOpacity>
              </View>

            </View>
          ) : (
            /* ── VIEW MODE ── */
            <View style={det.body}>

              {/* Player portal links */}
              {tournament.category ? (() => {
                const isItf = /m15|m25|itf/i.test(tournament.category);
                const isChallenger = /challenger|atp/i.test(tournament.category);
                const itfUrl = tournament.factSheetUrl ?? 'https://ipin.itftennis.com/';
                const linkStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'flex-end' as const, gap: 6, marginBottom: 10 };
                if (isItf) {
                  return (
                    <TouchableOpacity style={linkStyle} onPress={() => Linking.openURL(itfUrl)} activeOpacity={0.7}>
                      <IconSymbol name="arrow.up.right.square" size={14} color="#5B5BD6" />
                      <Text style={{ fontSize: 13, fontWeight: '600', color: '#5B5BD6' }}>{t('tournament.ipinLogin')}</Text>
                    </TouchableOpacity>
                  );
                }
                if (isChallenger) {
                  return (
                    <View style={{ marginBottom: 10, gap: 6 }}>
                      <TouchableOpacity style={linkStyle} onPress={() => Linking.openURL('https://www.atppz.com/registration/login#nbb')} activeOpacity={0.7}>
                        <IconSymbol name="arrow.up.right.square" size={14} color="#5B5BD6" />
                        <Text style={{ fontSize: 13, fontWeight: '600', color: '#5B5BD6' }}>{t('tournament.playerZoneWeb')}</Text>
                      </TouchableOpacity>
                    </View>
                  );
                }
                return null;
              })() : null}

              {/* FUTURE: registered toggle + withdraw toggle + all deadlines */}
              {group === 'upcoming' && (
                <>
                  <Text style={det.sectionLabel}>{t('tournament.status')}</Text>
                  <View style={det.toggleCard}>
                    {!tournament.isWithdrawn && (() => {
                      const signUpClosed = !tournament.isRegistered && (daysUntil(tournament.signUpDeadline) ?? 0) < 0;
                      return (
                        <View style={det.toggleRow}>
                          <Text style={[det.toggleLabel, signUpClosed && { color: T.red }]}>
                            {tournament.isRegistered
                              ? t('tournaments.registeredBadge')
                              : signUpClosed
                                ? t('tournaments.signUpClosed')
                                : t('tournaments.notRegistered')}
                          </Text>
                          {savingAction === 'register' || savingAction === 'unregister'
                            ? <ActivityIndicator size="small" color={T.teal} />
                            : <Switch
                                value={!!tournament.isRegistered}
                                onValueChange={(v) => doAction(v ? 'register' : 'unregister', { isRegistered: v })}
                                trackColor={{ false: T.cardBorder, true: T.teal }}
                                thumbColor={T.textPrimary}
                                disabled={!!savingAction || signUpClosed}
                              />}
                        </View>
                      );
                    })()}
                    <View style={det.toggleDivider} />
                    <View style={det.toggleRow}>
                      <Text style={[det.toggleLabel, det.toggleLabelWithdraw]}>
                        {tournament.isWithdrawn ? t('tournaments.withdrawn') : t('tournament.withdraw')}
                      </Text>
                      {savingAction === 'withdraw'
                        ? <ActivityIndicator size="small" color={T.red} />
                        : <Switch
                            value={!!tournament.isWithdrawn}
                            onValueChange={(v) => { setUndoingWithdraw(!v); setShowWithdraw(true); }}
                            trackColor={{ false: T.cardBorder, true: T.red }}
                            thumbColor={T.textPrimary}
                            disabled={!!savingAction}
                          />}
                    </View>
                  </View>

                  {(tournament.signUpDeadline || tournament.withdrawalDeadline || tournament.freezeDeadline) && (() => {
                    const stored = { signUpDeadline: tournament.signUpDeadline ?? '', withdrawalDeadline: tournament.withdrawalDeadline ?? '', freezeDeadline: tournament.freezeDeadline ?? '' };
                    const allDeadlines = getDeadlineLabels(tournament.category, stored, tournament.startDate)
                      .filter(d => d.dateStr);
                    if (allDeadlines.length === 0) return null;
                    return (
                      <>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={det.sectionLabel}>{t('tournament.deadlinesAuto')}</Text>
                          <Text style={{ fontSize: 10, color: T.accent, marginBottom: 10 }}>⚡</Text>
                        </View>
                        <View style={det.deadlinesCard}>
                          {allDeadlines.map((d, idx) => (
                            <React.Fragment key={d.field}>
                              <View style={det.deadlineRow}>
                                <Text style={det.deadlineName}>{d.label}</Text>
                                <View style={det.deadlineRight}>
                                  <Text style={det.deadlineDate}>{fmtDeadline(d.dateStr, d.time)}</Text>
                                  <Text style={[det.deadlineDays, { color: deadlineColor(d.dateStr) }]}>
                                    {deadlineLabel(d.dateStr)}
                                  </Text>
                                </View>
                              </View>
                              {idx < allDeadlines.length - 1 && <View style={det.deadlineDivider} />}
                            </React.Fragment>
                          ))}
                        </View>
                      </>
                    );
                  })()}

                  {tournament.startDate && (() => {
                    const onsiteDeadlines = getOnsiteDeadlines(tournament.startDate, tournament.category);
                    if (onsiteDeadlines.length === 0) return null;
                    return (
                      <>
                        <View style={{ height: 1, backgroundColor: T.cardBorder, marginVertical: 16 }} />
                        <Text style={{ fontSize: 11, fontWeight: '600', color: T.amber, letterSpacing: 1, marginBottom: 8, lineHeight: 16 }}>ON-SITE SIGN-INS</Text>
                        {onsiteDeadlines.map((od, i) => (
                          <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, gap: 12 }}>
                            <Text style={{ fontSize: 14, color: T.amber, fontWeight: '500', lineHeight: 20, flex: 1 }}>{od.label}</Text>
                            <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                              <Text style={{ fontSize: 13, color: T.textPrimary, lineHeight: 18 }}>{fmtDate(od.dateStr)}</Text>
                              <Text style={{ fontSize: 12, color: T.textSecondary, lineHeight: 16, marginTop: 2 }}>{od.time}</Text>
                            </View>
                          </View>
                        ))}
                      </>
                    );
                  })()}
                </>
              )}

              {/* CURRENT: single non-interactive "Playing" pill — no toggles, no deadlines */}
              {group === 'active' && (
                <View style={det.playingPillWrap}>
                  <View style={det.playingPill}>
                    <Text style={det.playingPillText}>{t('tournament.playing')}</Text>
                  </View>
                </View>
              )}

              {/* PAST: nothing here — header shows name/dates, expenses section (if added) below */}

              {/* Prize money — shown for all groups if any prize money exists.
                  Legacy records only have `prizeMoney`; fall back to it for the total. */}
              {(() => {
                const splitPrize = (tournament.singlesPrizeMoney ?? 0) + (tournament.doublesPrizeMoney ?? 0);
                const totalPrize = splitPrize > 0 ? splitPrize : (tournament.prizeMoney ?? 0);
                if (totalPrize <= 0) return null;
                return (
                <>
                  <Text style={det.sectionLabel}>{t('prize.prizeMoney')}</Text>
                  <View style={det.prizeCard}>
                    {(tournament.singlesPrizeMoney ?? 0) > 0 && (
                      <View style={det.prizeRow}>
                        <Text style={det.prizeLabel}>{t('prize.singles')}</Text>
                        <Text style={det.prizeAmount}>${tournament.singlesPrizeMoney.toLocaleString()}</Text>
                      </View>
                    )}
                    {(tournament.singlesPrizeMoney ?? 0) > 0 && (tournament.doublesPrizeMoney ?? 0) > 0 && <View style={det.deadlineDivider} />}
                    {(tournament.doublesPrizeMoney ?? 0) > 0 && (
                      <View style={det.prizeRow}>
                        <Text style={det.prizeLabel}>{t('prize.doubles')}</Text>
                        <Text style={det.prizeAmount}>${tournament.doublesPrizeMoney.toLocaleString()}</Text>
                      </View>
                    )}
                    {splitPrize > 0 && <View style={det.deadlineDivider} />}
                    <View style={det.prizeRow}>
                      <Text style={[det.prizeLabel, { fontWeight: '700' }]}>{t('prize.total')}</Text>
                      <Text style={[det.prizeAmount, { color: T.green, fontWeight: '700' }]}>
                        ${totalPrize.toLocaleString()}
                      </Text>
                    </View>
                    {(tournament.taxWithholdingPct ?? 0) > 0 && (() => {
                      const pct = tournament.taxWithholdingPct;
                      const net = totalPrize * (1 - pct / 100);
                      return (
                        <>
                          <View style={det.deadlineDivider} />
                          <View style={det.prizeRow}>
                            <Text style={det.prizeLabel}>
                              {t('tournament.netAfterWithholdingPrefix')} {pct}% {t('tournament.netAfterWithholdingSuffix')}
                            </Text>
                            <Text style={det.prizeAmount}>${net.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                          </View>
                        </>
                      );
                    })()}
                  </View>
                </>
                );
              })()}

              {/* Trip cost estimator — upcoming, not-yet-played tournaments only */}
              {group === 'upcoming' && (tripEstimate || !DEMO_MODE) && (() => {
                const basisLabel = tripEstimate?.basis === 'country'
                  ? t('tournament.tripEstimateBasisCountry')
                  : tripEstimate?.basis === 'category'
                    ? t('tournament.tripEstimateBasisCategory')
                    : t('tournament.tripEstimateBasisOverall');
                const tournamentWord = tripEstimate?.sampleSize === 1
                  ? t('tournament.estimatedTripCostTournament')
                  : t('tournament.estimatedTripCostTournaments');
                return (
                  <>
                    <Text style={det.sectionLabel}>{t('tournament.estimatedTripCost')}</Text>
                    <View style={det.tripEstimateCard}>
                      {tripEstimate ? (
                        <>
                          <IconSymbol name="paperplane.fill" size={18} color={T.amber} style={{ marginRight: 10 }} />
                          <View style={{ flex: 1 }}>
                            <Text style={det.tripEstimateAmount}>
                              ~${Math.round(tripEstimate.estimate).toLocaleString()}
                              <Text style={det.tripEstimateRange}>
                                {'  '}({t('tournament.estimatedTripCostRangeLabel')} ${Math.round(tripEstimate.low).toLocaleString()}–${Math.round(tripEstimate.high).toLocaleString()})
                              </Text>
                            </Text>
                            <Text style={det.tripEstimateMeta}>
                              {t('tournament.estimatedTripCostBasedOnPast')} {tripEstimate.sampleSize} {tournamentWord} {basisLabel}
                            </Text>
                          </View>
                        </>
                      ) : (
                        <View style={{ flex: 1 }} />
                      )}
                      {!DEMO_MODE && (
                        <TouchableOpacity
                          style={det.aiBreakdownBtn}
                          onPress={() => openAiBreakdown(false)}
                          activeOpacity={0.7}
                        >
                          <Text style={det.aiBreakdownBtnText}>{t('tournament.aiBreakdown')}</Text>
                          <Text style={det.aiBreakdownChevron}>›</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </>
                );
              })()}

              {/* ── Tournament Contact ── */}
              {(tournament.supervisorName || tournament.supervisorEmail || tournament.supervisorPhone) && (
                <>
                  <Text style={[det.sectionLabel, { marginTop: 16 }]}>CONTACTO DEL TORNEO</Text>
                  <View style={{ backgroundColor: '#1A1A2E', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                    {tournament.supervisorName ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: tournament.supervisorEmail || tournament.supervisorPhone ? 12 : 0 }}>
                        <IconSymbol name="person" size={15} color={T.textTertiary} />
                        <Text style={{ fontSize: 14, fontWeight: '600', color: T.textPrimary }}>{tournament.supervisorName}</Text>
                      </View>
                    ) : null}
                    {tournament.supervisorEmail ? (
                      <TouchableOpacity
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: tournament.supervisorPhone ? 12 : 0 }}
                        onPress={() => Linking.openURL('mailto:' + tournament.supervisorEmail)}
                        activeOpacity={0.7}
                      >
                        <IconSymbol name="envelope" size={15} color={T.textTertiary} />
                        <Text style={{ fontSize: 13, color: T.textSecondary }}>{tournament.supervisorEmail}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {tournament.supervisorPhone ? (
                      <TouchableOpacity
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
                        onPress={() => Linking.openURL('tel:' + tournament.supervisorPhone)}
                        activeOpacity={0.7}
                      >
                        <IconSymbol name="phone" size={15} color={T.textTertiary} />
                        <Text style={{ fontSize: 13, color: T.textSecondary }}>{tournament.supervisorPhone}</Text>
                      </TouchableOpacity>
                    ) : null}
                    <Text style={{ fontSize: 11, fontStyle: 'italic', color: T.textTertiary, marginTop: 12, lineHeight: 16 }}>
                      Contacta al supervisor para confirmar inscripciones presenciales
                    </Text>
                  </View>
                </>
              )}

              {/* ── Ranking Impact — only shown after tournament has concluded ── */}
              {group === 'past' && <RankingImpactSection tournament={tournament} />}

            </View>
          )}

        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {showWithdraw && (
        <WithdrawDialog
          name={tournament.name}
          undoing={undoingWithdraw}
          onConfirm={confirmWithdraw}
          onCancel={() => setShowWithdraw(false)}
          t={t}
        />
      )}

      {showAiBreakdown && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowAiBreakdown(false)}>
          <Pressable style={det.aiSheetBackdrop} onPress={() => setShowAiBreakdown(false)} />
          <View style={det.aiSheet}>
            <View style={det.aiSheetHandle} />
            <ScrollView style={det.aiSheetScroll} keyboardShouldPersistTaps="handled">
              {aiLoading ? (
                <View style={det.aiLoadingWrap}>
                  <ActivityIndicator size="small" color={T.accent} />
                  <Text style={det.aiLoadingText}>{t('tournament.aiBreakdownLoading')}</Text>
                </View>
              ) : aiErrored[tournament.id] || !aiEstimates[tournament.id] ? (
                <View style={det.aiErrorWrap}>
                  <Text style={det.aiErrorText}>{t('tournament.aiErrorMessage')}</Text>
                </View>
              ) : (() => {
                const est = aiEstimates[tournament.id]!;
                const tierChip = est.data_tier === 'personal_history'
                  ? { label: t('tournament.aiTierPersonalHistory'), bg: T.accentMuted, color: T.accent }
                  : est.data_tier === 'peer_aggregate'
                    ? { label: t('tournament.aiTierPeerAggregate'), bg: T.tealMuted, color: T.teal }
                    : { label: t('tournament.aiTierHeuristic'), bg: 'rgba(217, 119, 6, 0.16)', color: T.amber };
                const confidenceLabel = est.confidence === 'high'
                  ? t('tournament.aiConfidenceHigh')
                  : est.confidence === 'medium'
                    ? t('tournament.aiConfidenceMedium')
                    : t('tournament.aiConfidenceLow');
                const sampleUnit = est.data_tier === 'personal_history'
                  ? t('tournament.aiSampleTrips')
                  : t('tournament.aiSamplePlayers');
                const categoryRows: { key: keyof typeof est.categories; icon: string; labelKey: any }[] = [
                  { key: 'flight', icon: '✈️', labelKey: 'tournament.aiCategoryFlight' },
                  { key: 'lodging', icon: '🏨', labelKey: 'tournament.aiCategoryLodging' },
                  { key: 'food', icon: '🍽️', labelKey: 'tournament.aiCategoryFood' },
                  { key: 'local_transport', icon: '🚕', labelKey: 'tournament.aiCategoryLocalTransport' },
                  { key: 'entry_fee', icon: '🎾', labelKey: 'tournament.aiCategoryEntryFee' },
                ];
                return (
                  <>
                    <View style={det.aiSheetHeaderRow}>
                      <Text style={det.aiSheetTitle}>{tournament.name}</Text>
                      <View style={det.aiBadgeRow}>
                        <View style={[det.aiTierChip, { backgroundColor: tierChip.bg }]}>
                          <Text style={[det.aiTierChipText, { color: tierChip.color }]}>{tierChip.label}</Text>
                        </View>
                        <View style={det.aiConfidencePill}>
                          <Text style={det.aiConfidencePillText}>{confidenceLabel}</Text>
                        </View>
                        {typeof est.sample_size === 'number' && (
                          <Text style={det.aiSampleText}>{est.sample_size} {sampleUnit}</Text>
                        )}
                      </View>
                    </View>

                    {categoryRows.map(row => {
                      const cat = est.categories[row.key];
                      if (!cat) return null;
                      return (
                        <View key={row.key} style={det.aiCategoryRow}>
                          <Text style={det.aiCategoryIcon}>{row.icon}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={det.aiCategoryLabel}>{t(row.labelKey)}</Text>
                            <Text style={det.aiCategoryBasis}>{cat.basis}</Text>
                          </View>
                          <Text style={det.aiCategoryAmount}>${Math.round(cat.amount).toLocaleString()}</Text>
                        </View>
                      );
                    })}

                    <View style={det.aiTotalRow}>
                      <Text style={det.aiTotalLabel}>{t('tournament.aiTotal')}</Text>
                      <Text style={det.aiTotalAmount}>${Math.round(est.total).toLocaleString()}</Text>
                    </View>

                    {est.comparison_to_user_average && (
                      <Text style={det.aiComparisonText}>{est.comparison_to_user_average}</Text>
                    )}

                    {est.caveats.length > 0 && (
                      <View style={det.aiCaveatsWrap}>
                        {est.caveats.map((c, i) => (
                          <View key={i} style={det.aiCaveatRow}>
                            <Text style={det.aiCaveatDot}>●</Text>
                            <Text style={det.aiCaveatText}>{c}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    <View style={det.aiFooter}>
                      <TouchableOpacity style={det.aiRefreshBtn} onPress={() => openAiBreakdown(true)} activeOpacity={0.7}>
                        <Text style={det.aiRefreshBtnText}>{t('tournament.aiRefresh')}</Text>
                      </TouchableOpacity>
                      <Text style={det.aiDisclaimerText}>{t('tournament.aiDisclaimer')}</Text>
                    </View>
                  </>
                );
              })()}
            </ScrollView>
          </View>
        </Modal>
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
        placeholder={placeholder ?? ''} placeholderTextColor={T.textSecondary} />
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

function DeadlineRow({ label, value, overridden, onToggle, onChange, selectStartFirstLabel }: {
  label: string; value: string; overridden: boolean;
  onToggle: () => void; onChange: (v: string) => void; selectStartFirstLabel: string;
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
          {value ? fmtDeadline(value) : selectStartFirstLabel}
        </Text>
      )}
    </View>
  );
}

export function AddTournamentModal({ onClose, defaultStartDate }: { onClose: () => void; defaultStartDate?: string }) {
  const { t } = useLanguage();
  const { data } = useAppQuery({ tournaments: {} });
  const demoCtx  = useDemoData();
  const [query, setQuery]     = useState('');
  const [mode, setMode]       = useState<'search' | 'manual'>('search');
  const [f, setF]             = useState<FormState>(() => {
    if (defaultStartDate) {
      const calc = calcDeadlines(defaultStartDate, EMPTY_FORM.category);
      return {
        ...EMPTY_FORM,
        startDate: defaultStartDate,
        endDate: calcEndDate(defaultStartDate),
        signUpDeadline: calc.signUpDeadline,
        withdrawalDeadline: calc.withdrawalDeadline,
        freezeDeadline: calc.freezeDeadline,
      };
    }
    return EMPTY_FORM;
  });
  const [overrides, setOverrides] = useState({ signUp: false, withdrawal: false, freeze: false });
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  const pool = (data?.tournaments ?? []).filter((trn: any) => trn.isInMyList === false);
  const searchResults = query.trim().length > 0
    ? pool.filter((trn: any) => trn.name?.toLowerCase().includes(query.trim().toLowerCase()))
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
    const calc = v ? calcDeadlines(v, f.category) : null;
    setF(prev => ({
      ...prev,
      startDate: v,
      endDate: v ? calcEndDate(v) : '',
      ...(calc && !overrides.signUp     ? { signUpDeadline:     calc.signUpDeadline }     : {}),
      ...(calc && !overrides.withdrawal ? { withdrawalDeadline: calc.withdrawalDeadline } : {}),
      ...(calc && !overrides.freeze     ? { freezeDeadline:     calc.freezeDeadline }     : {}),
    }));
  }

  function handleCategoryChange(v: string) {
    setField('category', v);
    if (f.startDate) {
      const calc = calcDeadlines(f.startDate, v);
      setF(prev => ({
        ...prev,
        category: v,
        ...(!overrides.signUp     ? { signUpDeadline:     calc.signUpDeadline }     : {}),
        ...(!overrides.withdrawal ? { withdrawalDeadline: calc.withdrawalDeadline } : {}),
        ...(!overrides.freeze     ? { freezeDeadline:     calc.freezeDeadline }     : {}),
      }));
    }
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
      const composedName2 = challengerDisplayName(tournament);
      if (composedName2 !== tournament.name) updates.name = composedName2;
      if ((_su2 !== null && _now2 > _su2) || (_s2 !== null && _now2 >= _s2) || (_e2 !== null && _now2 > _e2)) {
        updates.isRegistered = true;
      }
      if (tournament.startDate && !tournament.freezeDeadline) {
        const calc = calcDeadlines(tournament.startDate, tournament.category);
        if (!tournament.signUpDeadline)     updates.signUpDeadline     = calc.signUpDeadline;
        if (!tournament.withdrawalDeadline) updates.withdrawalDeadline = calc.withdrawalDeadline;
        updates.freezeDeadline = calc.freezeDeadline;
      }
      if (DEMO_MODE) {
        demoCtx?.patchTournament(tournament.id, updates);
        onClose();
      } else {
        await apiPatchTournament(tournament.id, updates);
        onClose();
      }
    } catch (e: any) { setError(e?.message ?? 'Failed to add.'); setSaving(false); }
  }

  async function handleSaveManual() {
    if (!f.name.trim()) { setError(t('tournaments.nameRequired')); return; }
    if (!f.startDate)   { setError(t('tournaments.dateRequired')); return; }
    setSaving(true); setError('');
    const finalCalc = calcDeadlines(f.startDate, f.category);
    const finalSignUp = overrides.signUp ? f.signUpDeadline : finalCalc.signUpDeadline;
    const finalWithdrawal = overrides.withdrawal ? f.withdrawalDeadline : finalCalc.withdrawalDeadline;
    const finalFreeze = overrides.freeze ? f.freezeDeadline : finalCalc.freezeDeadline;
    const _now = new Date();
    const _start = parseLocalDate(f.startDate);
    const _end   = f.endDate ? parseLocalDate(f.endDate) : null;
    if (_end) _end.setHours(23, 59, 59, 999);
    const _signUp = finalSignUp ? parseLocalDate(finalSignUp) : null;
    if (_signUp) _signUp.setHours(23, 59, 59, 999);
    const autoRegistered = f.isRegistered
      || (_signUp !== null && _now > _signUp)
      || (_start !== null && _now >= _start)
      || (_end !== null && _now > _end);
    try {
      if (DEMO_MODE) {
        demoCtx?.addTournament({
          id: genId(),
          name: f.name.trim(), country: f.country, city: f.city.trim(),
          surface: f.surface, category: f.category, startDate: f.startDate,
          endDate: f.endDate,
          signUpDeadline: finalSignUp,
          withdrawalDeadline: finalWithdrawal,
          freezeDeadline: finalFreeze,
          isRegistered: autoRegistered,
          isWithdrawn: false, isInMyList: true, status: 'upcoming',
          prizeMoney: 0, singlesPrizeMoney: 0, doublesPrizeMoney: 0,
        });
        onClose();
      } else {
        await apiAddTournament({
          name: f.name.trim(), country: f.country, city: f.city.trim(),
          surface: f.surface, category: f.category, startDate: f.startDate,
          endDate: f.endDate,
          signUpDeadline: finalSignUp,
          withdrawalDeadline: finalWithdrawal,
          freezeDeadline: finalFreeze,
          isRegistered: autoRegistered,
          isWithdrawn: false, isInMyList: true, status: 'upcoming',
          prizeMoney: 0, singlesPrizeMoney: 0, doublesPrizeMoney: 0,
        });
        // Notifications reschedule via useNotificationSetup once the query refreshes.
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
                  <Text style={form.backBtnText}>{t('common.back')}</Text>
                </TouchableOpacity>
              : <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={form.backBtn}>
                  <Text style={form.backBtnText}>{t('common.cancel')}</Text>
                </TouchableOpacity>}
            <Text style={form.sheetTitle}>{mode === 'manual' ? t('tournaments.addManually') : t('tournaments.addNew')}</Text>
          </View>

          {mode === 'search' ? (
            <>
              <View style={form.searchWrap}>
                <Text style={form.searchIcon}>🔍</Text>
                <TextInput style={form.searchInput} value={query} onChangeText={setQuery}
                  placeholder={t('tournaments.searchPlaceholder')} placeholderTextColor={T.textSecondary} autoFocus returnKeyType="search" />
                {query.length > 0 && (
                  <TouchableOpacity onPress={() => setQuery('')} activeOpacity={0.7}>
                    <Text style={form.searchClear}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
              <ScrollView showsVerticalScrollIndicator={false} style={form.scrollArea} keyboardShouldPersistTaps="handled">
                {searchResults.map((trn: any) => (
                  <TouchableOpacity key={trn.id} style={form.resultCard} onPress={() => handleAddFromSearch(trn)}
                    activeOpacity={0.75} disabled={saving}>
                    <View style={form.resultCardInner}>
                      <View style={{ flex: 1 }}>
                        <Text style={form.resultName} numberOfLines={1}>
                          {trn.country ? countryFlag(trn.country) + ' ' : ''}{trn.name}
                        </Text>
                        <Text style={form.resultMeta}>{[trn.city, trn.surface, fmtDate(trn.startDate)].filter(Boolean).join(' · ')}</Text>
                      </View>
                      {trn.category && (
                        <View style={form.categoryBadge}>
                          <Text style={form.categoryBadgeText}>{trn.category}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={form.resultAddLabel}>{t('tournaments.tapToAdd')}</Text>
                  </TouchableOpacity>
                ))}
                {query.trim().length > 0 && searchResults.length === 0 && (
                  <View style={form.noResults}><Text style={form.noResultsText}>{t('tournaments.noMatches')} "{query}"</Text></View>
                )}
                {(showManualPrompt || query.trim().length === 0) && (
                  <TouchableOpacity style={form.manualPrompt} onPress={() => setMode('manual')} activeOpacity={0.8}>
                    <Text style={form.manualPromptIcon}>✏️</Text>
                    <View>
                      <Text style={form.manualPromptTitle}>{t('tournaments.addManually')}</Text>
                      <Text style={form.manualPromptSub}>{t('tournaments.addManuallyDesc')}</Text>
                    </View>
                  </TouchableOpacity>
                )}
                {error ? <Text style={form.error}>{error}</Text> : null}
              </ScrollView>
            </>
          ) : (
            <>
              <ScrollView showsVerticalScrollIndicator={false} style={form.scrollArea} keyboardShouldPersistTaps="handled">
                <Text style={{ fontSize: 11, color: T.accent, marginBottom: 12 }}>{t('tournaments.autoFillHint')}</Text>
                <LabeledInput label={`Name ⚡`} placeholder="ex. M25 Cuiabá" value={f.name} onChangeText={(v) => setField('name', v)} />
                <LabeledInput label={`City ⚡`} placeholder="ex. Cuiabá" value={f.city} onChangeText={(v) => setField('city', v)} />
                <View style={form.field}>
                  <CountryPicker label="Country ⚡" value={f.country} onChange={(v) => setField('country', v)} t={t} />
                </View>
                <ChipPicker label={`Surface ⚡`} options={SURFACES} value={f.surface} onChange={(v) => setField('surface', v)} />
                <View style={form.field}>
                  <CategoryPicker label="Category ⚡" value={f.category} onChange={handleCategoryChange} t={t} />
                </View>
                <DatePickerField label={`${t('tournament.startDateHint')} ⚡`} value={f.startDate} onChange={handleStartDateChange} />
                <View style={form.field}>
                  <Text style={form.label}>Deadlines ⚡ (auto-calculated)</Text>
                  {getStoredDeadlineFields(f.category).map(({ field, label }) => {
                    const ok = field === 'signUpDeadline' ? 'signUp' as const : field === 'withdrawalDeadline' ? 'withdrawal' as const : 'freeze' as const;
                    return (
                      <DeadlineRow
                        key={field}
                        label={label}
                        value={f[field as keyof typeof f] as string}
                        overridden={overrides[ok]}
                        onToggle={() => setOverrides(p => ({ ...p, [ok]: !p[ok] }))}
                        onChange={(v) => setField(field as any, v)}
                        selectStartFirstLabel={t('tournament.selectStartFirst')}
                      />
                    );
                  })}
                </View>
                {signUpPassed ? (
                  <View style={form.deadlineWarning}>
                    <Text style={form.deadlineWarningTitle}>{t('tournaments.signupPassed')}</Text>
                    <Text style={form.deadlineWarningBody}>
                      {t('tournaments.signupPassedDesc')}
                    </Text>
                    <TouchableOpacity
                      style={[form.playingBtn, f.isRegistered && form.playingBtnActive]}
                      onPress={() => setField('isRegistered', !f.isRegistered)}
                      activeOpacity={0.8}
                    >
                      <Text style={[form.playingBtnText, f.isRegistered && form.playingBtnTextActive]}>
                        {f.isRegistered ? `✓  ${t('tournaments.imPlaying')}` : t('tournaments.imPlaying')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={form.field}>
                    <Text style={form.label}>{t('tournaments.alreadyRegistered')}</Text>
                    <View style={form.chipRow}>
                      {[{ key: 'yes' as const, label: t('tournaments.yes') }, { key: 'no' as const, label: t('tournaments.no') }].map((opt) => {
                        const active = f.isRegistered === (opt.key === 'yes');
                        return (
                          <TouchableOpacity key={opt.key} style={[form.chip, active && form.chipActive]}
                            onPress={() => setField('isRegistered', opt.key === 'yes')} activeOpacity={0.7}>
                            <Text style={[form.chipText, active && form.chipTextActive]}>{opt.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}
                {error ? <Text style={form.error}>{error}</Text> : null}
              </ScrollView>
              <TouchableOpacity style={form.saveBtn} onPress={handleSaveManual} activeOpacity={0.8} disabled={saving}>
                {saving ? <ActivityIndicator color={T.textPrimary} /> : <Text style={form.saveBtnText}>{t('tournaments.addNew')}</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Tournament Discovery Modal ───────────────────────────────────────────────

// No DISCOVERY_PILLS — replaced by structured filter panel

function TournamentDiscoveryModal({
  visible, onClose, allTournaments, itfTournaments = [], onOpenAddManual,
}: {
  visible: boolean;
  onClose: () => void;
  allTournaments: any[];
  itfTournaments?: any[];
  onOpenAddManual: () => void;
}) {
  const { t } = useLanguage();
  const [browseMode, setBrowseMode]               = useState<'itf' | 'challenger'>('itf');
  const [discoverySearch, setDiscoverySearch]     = useState('');
  const [showFilterPanel, setShowFilterPanel]     = useState(false);
  const [showDatePanel, setShowDatePanel]         = useState(false);
  const [showRestModal, setShowRestModal]         = useState(false);
  const [showTrainingModal, setShowTrainingModal] = useState(false);

  // Structured filter state
  const [filterCountry,    setFilterCountry]    = useState('');
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterSurfaces,   setFilterSurfaces]   = useState<string[]>([]);
  const [filterVenueTypes, setFilterVenueTypes] = useState<string[]>([]);
  const [filterDateStart,  setFilterDateStart]  = useState('');
  const [filterDateEnd,    setFilterDateEnd]    = useState('');

  // Distinct country names from ITF data for autocomplete
  const itfCountryNames = useMemo(() => {
    const names = new Set(itfTournaments.map((t: any) => t.country).filter(Boolean));
    return Array.from(names).sort() as string[];
  }, [itfTournaments]);

  // Pending filter state (applied on APPLY)
  const [pendingCountry,    setPendingCountry]    = useState('');
  const [pendingCountryLocked, setPendingCountryLocked] = useState(false);
  const [pendingCategories, setPendingCategories] = useState<string[]>([]);
  const [pendingSurfaces,   setPendingSurfaces]   = useState<string[]>([]);
  const [pendingVenueTypes, setPendingVenueTypes] = useState<string[]>([]);

  function openFilters() {
    setPendingCountry(filterCountry);
    setPendingCountryLocked(!!filterCountry);
    setPendingCategories([...filterCategories]);
    setPendingSurfaces([...filterSurfaces]);
    setPendingVenueTypes([...filterVenueTypes]);
    setShowFilterPanel(true);
  }
  function applyFilters() {
    setFilterCountry(pendingCountry);
    setFilterCategories(pendingCategories);
    setFilterSurfaces(pendingSurfaces);
    setFilterVenueTypes(pendingVenueTypes);
    setShowFilterPanel(false);
  }
  function clearFilters() {
    setPendingCountry(''); setPendingCountryLocked(false); setPendingCategories([]); setPendingSurfaces([]); setPendingVenueTypes([]);
  }

  function toggleArr(arr: string[], set: (v: string[]) => void, val: string) {
    set(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]);
  }

  const activeFilterCount = (filterCountry ? 1 : 0) + filterCategories.length + filterSurfaces.length + filterVenueTypes.length + (filterDateStart || filterDateEnd ? 1 : 0);

  // Rest week state
  const [restMonday, setRestMonday]   = useState('');
  const [restNote, setRestNote]       = useState('');
  const [savingRest, setSavingRest]   = useState(false);

  // Training block state
  const [trainStart, setTrainStart]   = useState('');
  const [trainEnd, setTrainEnd]       = useState('');
  const [trainLabel, setTrainLabel]   = useState('');
  const [trainNote, setTrainNote]     = useState('');
  const [savingTrain, setSavingTrain] = useState(false);

  const myCalendarIds = new Set(allTournaments.filter((t: any) => t.isInMyList !== false).map((t: any) => t.id));
  const discoverable = allTournaments.filter((trn: any) => trn.isInMyList === false);

  // ITF tournaments from Supabase that user hasn't added yet
  const itfDiscoverable = itfTournaments.filter(t => !myCalendarIds.has(t.id));

  async function handleAddFromITF(tournament: any) {
    try {
      const calc = tournament.startDate ? calcDeadlines(tournament.startDate, tournament.category) : {};
      await apiAddTournament({
        name: challengerDisplayName(tournament),
        city: tournament.city,
        country: tournament.country,
        surface: tournament.surface,
        category: tournament.category,
        startDate: tournament.startDate,
        endDate: tournament.endDate ?? (tournament.startDate ? calcEndDate(tournament.startDate) : undefined),
        prizeMoney: 0, singlesPrizeMoney: 0, doublesPrizeMoney: 0,
        isInMyList: true,
        isRegistered: false,
        ...calc,
      });
      onClose();
    } catch (e: any) {
      Alert.alert('Could not add tournament', e?.message ?? 'Please try again.');
    }
  }

  const activeList = browseMode === 'challenger'
    ? itfDiscoverable.filter(t => (t.category ?? '').toLowerCase().includes('challenger'))
    : itfDiscoverable.filter(t => ['M15', 'M25'].includes(t.category ?? ''));

  const filtered = activeList.filter((trn: any) => {
    if (discoverySearch.trim()) {
      const q = discoverySearch.toLowerCase();
      const match =
        (trn.name ?? '').toLowerCase().includes(q) ||
        (trn.city ?? '').toLowerCase().includes(q) ||
        (trn.country ?? '').toLowerCase().includes(q);
      if (!match) return false;
    }
    if (filterCountry) {
      const filterLower = filterCountry.trim().toLowerCase();
      const trnCountryRaw = (trn.country ?? '');
      // Match full country name (Supabase stores "Romania", "USA", etc.)
      const nameMatch = trnCountryRaw.toLowerCase() === filterLower;
      // Fallback: match ISO 2-letter or 3-letter code (for any InstantDB records using codes)
      const isoCode = COUNTRIES.find(c => c.name.toLowerCase() === filterLower)?.code.toUpperCase() ?? '';
      const ISO3: Record<string, string> = {
        'RO':'ROU','ES':'ESP','FR':'FRA','DE':'GER','IT':'ITA','GB':'GBR','US':'USA',
        'AR':'ARG','BR':'BRA','AU':'AUS','CH':'SUI','BE':'BEL','NL':'NED','PL':'POL',
        'CZ':'CZE','PT':'POR','SE':'SWE','AT':'AUT','GR':'GRE','HU':'HUN','BG':'BUL',
        'HR':'CRO','RS':'SRB','RU':'RUS','UA':'UKR','KZ':'KAZ','JP':'JPN','CN':'CHN',
        'KR':'KOR','IN':'IND','CL':'CHI','CO':'COL','PE':'PER','MX':'MEX','CA':'CAN',
        'ZA':'RSA','EG':'EGY','MA':'MAR','TN':'TUN','SK':'SVK','SI':'SLO','TR':'TUR',
        'IL':'ISR','TH':'THA','MY':'MAS','ID':'INA','PH':'PHI','UZ':'UZB',
      };
      const trnUpper = trnCountryRaw.toUpperCase();
      const codeMatch = isoCode && (trnUpper === isoCode || trnUpper === (ISO3[isoCode] ?? ''));
      if (!nameMatch && !codeMatch) return false;
    }
    if (filterCategories.length > 0 && !filterCategories.some(c => (trn.category ?? '').includes(c))) return false;
    if (filterSurfaces.length > 0 && !filterSurfaces.some(s => (trn.surface ?? '').toLowerCase().includes(s))) return false;
    if (filterDateStart && trn.startDate && trn.startDate < filterDateStart) return false;
    if (filterDateEnd && trn.startDate && trn.startDate > filterDateEnd) return false;
    return true;
  });

  async function handleAddFromDiscovery(tournament: any) {
    try {
      const updates: any = { isInMyList: true };
      const composedName = challengerDisplayName(tournament);
      if (composedName !== tournament.name) updates.name = composedName;
      if (tournament.startDate && !tournament.freezeDeadline) {
        const calc = calcDeadlines(tournament.startDate, tournament.category);
        if (!tournament.signUpDeadline)     updates.signUpDeadline     = calc.signUpDeadline;
        if (!tournament.withdrawalDeadline) updates.withdrawalDeadline = calc.withdrawalDeadline;
        updates.freezeDeadline = calc.freezeDeadline;
      }
      await apiPatchTournament(tournament.id, updates);
      onClose();
    } catch (e: any) {
      Alert.alert('Could not add tournament', e?.message ?? 'Please try again.');
    }
  }

  async function saveRestWeek() {
    if (!restMonday) return;
    setSavingRest(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('training_blocks').insert({
        title: 'Descanso 😴',
        start_date: restMonday,
        end_date: addDays(restMonday, 6),
        note: restNote,
        user_id: user?.id,
        block_type: 'rest',
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['training_blocks'] });
      setShowRestModal(false);
      setRestMonday(''); setRestNote('');
    } catch (e: any) {
      Alert.alert('Could not save rest week', e?.message ?? 'Please try again.');
    }
    setSavingRest(false);
  }

  async function saveTrainingBlock() {
    if (!trainStart || !trainEnd || !trainLabel.trim()) return;
    setSavingTrain(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('training_blocks').insert({
        title: trainLabel.trim(),
        start_date: trainStart,
        end_date: trainEnd,
        note: trainNote,
        user_id: user?.id,
        block_type: 'training',
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['training_blocks'] });
      setShowTrainingModal(false);
      setTrainStart(''); setTrainEnd(''); setTrainLabel(''); setTrainNote('');
    } catch (e: any) {
      Alert.alert('Could not save training block', e?.message ?? 'Please try again.');
    }
    setSavingTrain(false);
  }

  function CheckRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
    return (
      <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }} onPress={onToggle} activeOpacity={0.7}>
        <View style={{ width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: checked ? T.accent : T.cardBorder, backgroundColor: checked ? T.accent : T.card, marginRight: 12, alignItems: 'center', justifyContent: 'center' }}>
          {checked && <Text style={{ color: T.textPrimary, fontSize: 13, fontWeight: '700' }}>✓</Text>}
        </View>
        <Text style={{ fontSize: 15, color: T.textPrimary }}>{label}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <>
      {/* ── Main discovery modal ── */}
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <SafeAreaView style={disc.safe}>
          <View style={disc.header}>
            <Text style={disc.headerTitle}>{t('discovery.title')}</Text>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={disc.closeBtn}>
              <IconSymbol name="xmark" size={18} color="#AAA" />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 48 }}>

              {/* Browse ITF / Browse Challenger toggle */}
              <View style={{ flexDirection: 'row', marginHorizontal: 20, marginBottom: 16, backgroundColor: '#1A1A2E', borderRadius: 10, padding: 3 }}>
                <TouchableOpacity
                  style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: browseMode === 'itf' ? '#5B5BD6' : 'transparent' }}
                  onPress={() => setBrowseMode('itf')} activeOpacity={0.8}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: browseMode === 'itf' ? '#FFF' : '#777' }}>Browse ITF</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: browseMode === 'challenger' ? '#5B5BD6' : 'transparent' }}
                  onPress={() => setBrowseMode('challenger')} activeOpacity={0.8}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: browseMode === 'challenger' ? '#FFF' : '#777' }}>Browse Challenger</Text>
                </TouchableOpacity>
              </View>

              {/* Search + filter row */}
              <View style={disc.searchWrap}>
                <IconSymbol name="magnifyingglass" size={16} color="#888" style={{ marginRight: 8 }} />
                <TextInput style={disc.searchInput} value={discoverySearch} onChangeText={setDiscoverySearch}
                  placeholder={t('discovery.search')} placeholderTextColor="#666" />
                {discoverySearch.length > 0 && (
                  <TouchableOpacity onPress={() => setDiscoverySearch('')} activeOpacity={0.7}>
                    <Text style={{ color: '#666', fontSize: 14, paddingLeft: 8 }}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Active filter chips */}
              {(filterCountry || filterSurfaces.length > 0 || filterCategories.length > 0 || filterVenueTypes.length > 0 || filterDateStart || filterDateEnd) ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, marginBottom: 12 }}>
                  {filterCountry ? (
                    <TouchableOpacity style={disc.activeChip} onPress={() => setFilterCountry('')} activeOpacity={0.8}>
                      <Text style={disc.activeChipText}>{filterCountry} ✕</Text>
                    </TouchableOpacity>
                  ) : null}
                  {filterSurfaces.map(s => (
                    <TouchableOpacity key={s} style={disc.activeChip} onPress={() => setFilterSurfaces(filterSurfaces.filter(x => x !== s))} activeOpacity={0.8}>
                      <Text style={disc.activeChipText}>{s.charAt(0).toUpperCase() + s.slice(1)} ✕</Text>
                    </TouchableOpacity>
                  ))}
                  {filterCategories.map(c => (
                    <TouchableOpacity key={c} style={disc.activeChip} onPress={() => setFilterCategories(filterCategories.filter(x => x !== c))} activeOpacity={0.8}>
                      <Text style={disc.activeChipText}>{c} ✕</Text>
                    </TouchableOpacity>
                  ))}
                  {filterVenueTypes.map(v => (
                    <TouchableOpacity key={v} style={disc.activeChip} onPress={() => setFilterVenueTypes(filterVenueTypes.filter(x => x !== v))} activeOpacity={0.8}>
                      <Text style={disc.activeChipText}>{v} ✕</Text>
                    </TouchableOpacity>
                  ))}
                  {(filterDateStart || filterDateEnd) ? (
                    <TouchableOpacity style={disc.activeChip} onPress={() => { setFilterDateStart(''); setFilterDateEnd(''); }} activeOpacity={0.8}>
                      <Text style={disc.activeChipText}>{fmtShortDate(filterDateStart)} – {fmtShortDate(filterDateEnd)} ✕</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}

              {/* Filter / Date range chips */}
              <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginBottom: 20 }}>
                <TouchableOpacity style={[disc.filterChip, activeFilterCount > 0 && disc.filterChipActive]} onPress={openFilters} activeOpacity={0.8}>
                  <IconSymbol name="line.3.horizontal.decrease" size={14} color={activeFilterCount > 0 ? '#FFF' : '#555'} style={{ marginRight: 6 }} />
                  <Text style={[disc.filterChipText, activeFilterCount > 0 && { color: '#FFF' }]}>{t('discovery.filters')}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[disc.filterChip, (filterDateStart || filterDateEnd) ? disc.filterChipActive : null]} onPress={() => setShowDatePanel(true)} activeOpacity={0.8}>
                  <IconSymbol name="calendar" size={14} color={(filterDateStart || filterDateEnd) ? '#FFF' : '#555'} style={{ marginRight: 6 }} />
                  <Text style={[disc.filterChipText, (filterDateStart || filterDateEnd) && { color: '#FFF' }]}>{t('discovery.dateRange')}</Text>
                </TouchableOpacity>
              </View>

              {/* Available tournaments — grouped by week */}
              <Text style={disc.sectionLabel}>{t('discovery.available')}</Text>

              {filtered.length === 0 ? (
                <Text style={disc.emptyText}>{t('discovery.noTournaments')}</Text>
              ) : (() => {
                const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
                function fmtWeekHeader(iso: string) {
                  const [y, m, d] = iso.split('-').map(Number);
                  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
                }
                const weekMap: Record<string, any[]> = {};
                for (const trn of filtered) {
                  const monday = trn.startDate ? getWeekMonday(trn.startDate) : '';
                  const key = monday || trn.startDate || 'No date';
                  if (!weekMap[key]) weekMap[key] = [];
                  weekMap[key].push(trn);
                }
                const weeks = Object.keys(weekMap).sort();
                return weeks.map(week => (
                  <View key={week}>
                    <Text style={disc.weekHeader}>{fmtWeekHeader(week)}</Text>
                    {weekMap[week].map((trn: any) => {
                      const days = daysUntil(trn.signUpDeadline);
                      const urgentColor = days !== null && days <= 7 ? '#E24B4A' : days !== null && days <= 14 ? '#E8A030' : null;
                      return (
                        <TouchableOpacity key={trn.id} style={disc.trnRow} onPress={() => trn._fromSupabase ? handleAddFromITF(trn) : handleAddFromDiscovery(trn)} activeOpacity={0.75}>
                          <View style={{ marginRight: 10 }}>
                            {trn.surface ? <CourtIcon surface={trn.surface} size="sm" /> : null}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={disc.trnName} numberOfLines={1}>
                              {trn.country ? countryFlag(trn.country) + ' ' : ''}{challengerDisplayName(trn)}
                            </Text>
                            <Text style={disc.trnMeta} numberOfLines={1}>
                              {[trn.city, fmtDateRange(trn.startDate, trn.endDate), trn.prizeMoney ? `$${Number(trn.prizeMoney).toLocaleString()}` : null].filter(Boolean).join(' · ')}
                            </Text>
                          </View>
                          {trn.category && !trn.category.toLowerCase().includes('challenger') ? <View style={disc.catPill}><Text style={disc.catPillText}>{trn.category}</Text></View> : null}
                          {urgentColor && days !== null ? (
                            <View style={[disc.deadlinePill, { backgroundColor: urgentColor + '22', marginLeft: 6 }]}>
                              <Text style={[disc.deadlinePillText, { color: urgentColor }]}>{days}d</Text>
                            </View>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ));
              })()}

              <View style={disc.divider} />

              <TouchableOpacity style={disc.card} activeOpacity={0.8} onPress={() => { onClose(); onOpenAddManual(); }}>
                <IconSymbol name="plus.circle" size={28} color="#5B5BD6" style={{ marginRight: 14 }} />
                <View style={{ flex: 1 }}>
                  <Text style={disc.cardTitle}>{t('discovery.addManually')}</Text>
                  <Text style={disc.cardSub}>{t('discovery.addManuallyDesc')}</Text>
                </View>
                <IconSymbol name="chevron.right" size={14} color="#555" />
              </TouchableOpacity>

              <TouchableOpacity style={disc.card} activeOpacity={0.8} onPress={() => setShowRestModal(true)}>
                <IconSymbol name="moon.zzz" size={28} color="#888" style={{ marginRight: 14 }} />
                <View style={{ flex: 1 }}>
                  <Text style={disc.cardTitle}>{t('discovery.restWeek')}</Text>
                  <Text style={disc.cardSub}>{t('discovery.restWeekDesc')}</Text>
                </View>
                <IconSymbol name="chevron.right" size={14} color="#555" />
              </TouchableOpacity>

              <TouchableOpacity style={disc.card} activeOpacity={0.8} onPress={() => setShowTrainingModal(true)}>
                <IconSymbol name="figure.run" size={28} color="#5B5BD6" style={{ marginRight: 14 }} />
                <View style={{ flex: 1 }}>
                  <Text style={disc.cardTitle}>{t('discovery.trainingBlock')}</Text>
                  <Text style={disc.cardSub}>{t('discovery.trainingBlockDesc')}</Text>
                </View>
                <IconSymbol name="chevron.right" size={14} color="#555" />
              </TouchableOpacity>

            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── Filter panel modal ── */}
      <Modal visible={showFilterPanel} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowFilterPanel(false)}>
        <SafeAreaView style={disc.safe}>
          <View style={disc.header}>
            <TouchableOpacity onPress={() => setShowFilterPanel(false)} activeOpacity={0.7} style={disc.closeBtn}>
              <IconSymbol name="xmark" size={18} color="#555" />
            </TouchableOpacity>
            <Text style={disc.headerTitle}>{t('discovery.filterTitle')}</Text>
            <View style={disc.closeBtn} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
            {/* Country */}
            <Text style={disc.filterSectionLabel}>{t('discovery.country')}</Text>
            <View style={[disc.filterInputWrap, { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }]}>
              {pendingCountryLocked ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#5B5BD6', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#FFF', marginRight: 6 }}>{pendingCountry}</Text>
                  <TouchableOpacity onPress={() => { setPendingCountry(''); setPendingCountryLocked(false); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
                    <Text style={{ fontSize: 13, color: '#FFF', fontWeight: '700' }}>×</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TextInput style={[disc.filterInput, { flex: 1 }]} value={pendingCountry} onChangeText={setPendingCountry}
                  placeholder={t('discovery.countrySelect')} placeholderTextColor="#AAA" autoCorrect={false} />
              )}
            </View>
            {!pendingCountryLocked && pendingCountry.trim().length >= 1 && (() => {
              const q = pendingCountry.trim().toLowerCase();
              const matches = itfCountryNames.filter(name => name.toLowerCase().includes(q)).slice(0, 6);
              if (!matches.length) return null;
              return (
                <View style={{ backgroundColor: T.card, borderRadius: 8, borderWidth: 1, borderColor: T.cardBorder, marginTop: 4, marginBottom: 8 }}>
                  {matches.map(name => (
                    <TouchableOpacity key={name} style={{ paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: T.cardBorder }}
                      onPress={() => { setPendingCountry(name); setPendingCountryLocked(true); }} activeOpacity={0.7}>
                      <Text style={{ color: T.textPrimary, fontSize: 14 }}>{countryFlag(name)} {name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              );
            })()}
            <View style={disc.filterDivider} />
            {/* Category */}
            <Text style={disc.filterSectionLabel}>{t('discovery.category')}</Text>
            {['M25','M15','Challenger'].map(c => (
              <CheckRow key={c} label={c} checked={pendingCategories.includes(c)} onToggle={() => toggleArr(pendingCategories, setPendingCategories, c)} />
            ))}
            <View style={disc.filterDivider} />
            {/* Surface */}
            <Text style={disc.filterSectionLabel}>{t('discovery.surface')}</Text>
            {['Clay','Hard','Grass'].map(s => (
              <CheckRow key={s} label={s} checked={pendingSurfaces.includes(s.toLowerCase())} onToggle={() => toggleArr(pendingSurfaces, setPendingSurfaces, s.toLowerCase())} />
            ))}
            <View style={disc.filterDivider} />
            {/* Venue Type */}
            <Text style={disc.filterSectionLabel}>{t('discovery.venueType')}</Text>
            <CheckRow label={t('discovery.indoor')} checked={pendingVenueTypes.includes('indoor')} onToggle={() => toggleArr(pendingVenueTypes, setPendingVenueTypes, 'indoor')} />
            <CheckRow label={t('discovery.outdoor')} checked={pendingVenueTypes.includes('outdoor')} onToggle={() => toggleArr(pendingVenueTypes, setPendingVenueTypes, 'outdoor')} />
          </ScrollView>
          {/* Clear / Apply */}
          <View style={disc.filterActions}>
            <TouchableOpacity style={disc.clearBtn} onPress={clearFilters} activeOpacity={0.8}>
              <Text style={disc.clearBtnText}>{t('discovery.clear')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={disc.applyBtn} onPress={applyFilters} activeOpacity={0.8}>
              <Text style={disc.applyBtnText}>{t('discovery.apply')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* ── Date range modal ── */}
      <Modal visible={showDatePanel} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowDatePanel(false)}>
        <SafeAreaView style={disc.safe}>
          <View style={disc.header}>
            <TouchableOpacity onPress={() => setShowDatePanel(false)} activeOpacity={0.7} style={disc.closeBtn}>
              <IconSymbol name="xmark" size={18} color="#AAA" />
            </TouchableOpacity>
            <Text style={disc.headerTitle}>{t('discovery.dateRange')}</Text>
            <View style={disc.closeBtn} />
          </View>
          {/* Date inputs row */}
          <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: T.cardBorder }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: T.textSecondary, marginBottom: 6 }}>{t('discovery.startDate')}</Text>
              <DatePickerField label="" value={filterDateStart} onChange={v => { setFilterDateStart(v); }} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: T.textSecondary, marginBottom: 6 }}>{t('discovery.endDate')}</Text>
              <DatePickerField label="" value={filterDateEnd} onChange={v => { setFilterDateEnd(v); }} />
            </View>
          </View>
          {/* Inline range calendar */}
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            {(() => {
              const today = new Date(); today.setHours(0,0,0,0);
              const months: { year: number; month: number }[] = [];
              for (let i = 0; i < 6; i++) {
                const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
                months.push({ year: d.getFullYear(), month: d.getMonth() });
              }
              const MONTH_NAMES_CAL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
              const DAY_LABELS = ['Mo','Tu','We','Th','Fr','Sa','Su'];
              const s = filterDateStart ? new Date(filterDateStart + 'T00:00:00') : null;
              const e = filterDateEnd   ? new Date(filterDateEnd   + 'T00:00:00') : null;
              function toISO(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
              function handleDayTap(iso: string) {
                const tapped = new Date(iso + 'T00:00:00');
                if (!filterDateStart || (filterDateStart && filterDateEnd)) { setFilterDateStart(iso); setFilterDateEnd(''); }
                else if (tapped < new Date(filterDateStart + 'T00:00:00')) { setFilterDateStart(iso); setFilterDateEnd(''); }
                else { setFilterDateEnd(iso); }
              }
              return months.map(({ year, month }) => {
                const firstDay = new Date(year, month, 1);
                const lastDay  = new Date(year, month + 1, 0);
                const startDow = (firstDay.getDay() + 6) % 7; // 0=Mon
                const cells: (number | null)[] = Array(startDow).fill(null);
                for (let d = 1; d <= lastDay.getDate(); d++) cells.push(d);
                while (cells.length % 7) cells.push(null);
                return (
                  <View key={`${year}-${month}`} style={{ paddingHorizontal: 20, marginTop: 20 }}>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: T.textPrimary, marginBottom: 12 }}>{MONTH_NAMES_CAL[month]} {year}</Text>
                    <View style={{ flexDirection: 'row', marginBottom: 8 }}>
                      {DAY_LABELS.map(d => <Text key={d} style={{ flex: 1, textAlign: 'center', fontSize: 12, color: T.textTertiary, fontWeight: '600' }}>{d}</Text>)}
                    </View>
                    {Array.from({ length: cells.length / 7 }, (_, ri) => (
                      <View key={ri} style={{ flexDirection: 'row' }}>
                        {cells.slice(ri * 7, ri * 7 + 7).map((day, ci) => {
                          if (!day) return <View key={ci} style={{ flex: 1, height: 44 }} />;
                          const iso = toISO(new Date(year, month, day));
                          const isStart = iso === filterDateStart;
                          const isEnd   = iso === filterDateEnd;
                          const inRange = s && e && new Date(iso+'T00:00:00') > s && new Date(iso+'T00:00:00') < e;
                          const isToday = iso === toISO(today);
                          const bg = (isStart || isEnd) ? '#5B5BD6' : inRange ? '#5B5BD633' : 'transparent';
                          const textCol = (isStart || isEnd) ? T.textPrimary : inRange ? T.hardText : isToday ? T.accent : T.textPrimary;
                          return (
                            <TouchableOpacity key={ci} style={{ flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, borderRadius: 8 }}
                              onPress={() => handleDayTap(iso)} activeOpacity={0.7}>
                              <Text style={{ fontSize: 14, fontWeight: (isStart || isEnd || isToday) ? '700' : '400', color: textCol }}>{day}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                );
              });
            })()}
          </ScrollView>
          <View style={disc.filterActions}>
            <TouchableOpacity style={disc.clearBtn} onPress={() => { setFilterDateStart(''); setFilterDateEnd(''); }} activeOpacity={0.8}>
              <Text style={disc.clearBtnText}>{t('discovery.clear')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={disc.applyBtn} onPress={() => setShowDatePanel(false)} activeOpacity={0.8}>
              <Text style={disc.applyBtnText}>{t('discovery.apply')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* ── Rest week modal ── */}
      <Modal visible={showRestModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowRestModal(false)}>
        <SafeAreaView style={disc.safe}>
          <View style={disc.header}>
            <Text style={disc.headerTitle}>{t('discovery.restTitle')}</Text>
            <TouchableOpacity onPress={() => setShowRestModal(false)} activeOpacity={0.7} style={disc.closeBtn}>
              <IconSymbol name="xmark" size={18} color="#AAA" />
            </TouchableOpacity>
          </View>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24 }}>
              <DatePickerField label={t('discovery.mondayLabel')} value={restMonday} onChange={setRestMonday} />
              <Text style={disc.inputLabel}>{t('discovery.noteOptional')}</Text>
              <TextInput style={disc.textInput} value={restNote} onChangeText={setRestNote}
                placeholder={t('discovery.notePlaceholder')} placeholderTextColor="#666" />
              <TouchableOpacity style={[disc.saveBtn, (!restMonday || savingRest) && { opacity: 0.5 }]}
                onPress={saveRestWeek} disabled={!restMonday || savingRest} activeOpacity={0.8}>
                {savingRest ? <ActivityIndicator color="#fff" /> : <Text style={disc.saveBtnText}>{t('discovery.save')}</Text>}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── Training block modal ── */}
      <Modal visible={showTrainingModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowTrainingModal(false)}>
        <SafeAreaView style={disc.safe}>
          <View style={disc.header}>
            <Text style={disc.headerTitle}>{t('discovery.trainingTitle')}</Text>
            <TouchableOpacity onPress={() => setShowTrainingModal(false)} activeOpacity={0.7} style={disc.closeBtn}>
              <IconSymbol name="xmark" size={18} color="#AAA" />
            </TouchableOpacity>
          </View>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24 }}>
              <DatePickerField label={t('discovery.startDate')} value={trainStart} onChange={setTrainStart} />
              <DatePickerField label={t('discovery.endDate')} value={trainEnd} onChange={setTrainEnd} />
              <Text style={disc.inputLabel}>{t('discovery.blockLabel')}</Text>
              <TextInput style={disc.textInput} value={trainLabel} onChangeText={setTrainLabel}
                placeholder={t('discovery.labelPlaceholder')} placeholderTextColor="#666" />
              <Text style={disc.inputLabel}>{t('discovery.noteOptional')}</Text>
              <TextInput style={disc.textInput} value={trainNote} onChangeText={setTrainNote}
                placeholder={t('discovery.detailsPlaceholder')} placeholderTextColor="#666" />
              <TouchableOpacity style={[disc.saveBtn, (!trainStart || !trainEnd || !trainLabel.trim() || savingTrain) && { opacity: 0.5 }]}
                onPress={saveTrainingBlock} disabled={!trainStart || !trainEnd || !trainLabel.trim() || savingTrain} activeOpacity={0.8}>
                {savingTrain ? <ActivityIndicator color="#fff" /> : <Text style={disc.saveBtnText}>{t('discovery.save')}</Text>}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const disc = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: T.bg },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: T.cardBorder },
  headerTitle:     { fontSize: 14, fontWeight: '800', color: T.textPrimary, letterSpacing: 1.2 },
  closeBtn:        { padding: 4, minWidth: 30 },
  searchWrap:      { flexDirection: 'row', alignItems: 'center', backgroundColor: T.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginHorizontal: 20, marginTop: 16, marginBottom: 12 },
  searchInput:     { flex: 1, fontSize: 15, color: T.textPrimary },
  filterChip:      { flexDirection: 'row', alignItems: 'center', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: T.card, borderWidth: 1, borderColor: T.cardBorder },
  filterChipActive:{ backgroundColor: T.accent, borderColor: T.accent },
  filterChipText:  { fontSize: 14, fontWeight: '600', color: T.textTertiary },
  sectionLabel:    { fontSize: 11, fontWeight: '700', color: T.textTertiary, letterSpacing: 1, marginHorizontal: 20, marginBottom: 10 },
  emptyText:       { fontSize: 13, color: T.textTertiary, textAlign: 'center', marginHorizontal: 24, marginTop: 16, marginBottom: 24, lineHeight: 20, fontStyle: 'italic' },
  trnRow:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: T.card },
  trnName:         { fontSize: 14, fontWeight: '600', color: T.textPrimary, marginBottom: 3 },
  trnMeta:         { fontSize: 12, color: T.textSecondary },
  catPill:         { backgroundColor: T.cardBorder, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 6 },
  catPillText:     { fontSize: 11, fontWeight: '700', color: T.textSecondary },
  deadlinePill:    { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  deadlinePillText:{ fontSize: 11, fontWeight: '700' },
  divider:         { height: 1, backgroundColor: T.cardBorder, marginHorizontal: 20, marginVertical: 24 },
  card:            { flexDirection: 'row', alignItems: 'center', backgroundColor: T.card, borderRadius: 16, padding: 20, marginHorizontal: 20, marginBottom: 12 },
  cardTitle:       { fontSize: 15, fontWeight: '600', color: T.textPrimary, marginBottom: 4 },
  cardSub:         { fontSize: 12, color: T.textSecondary, lineHeight: 16 },
  inputLabel:      { fontSize: 11, fontWeight: '700', color: T.textSecondary, letterSpacing: 0.8, marginBottom: 6, marginTop: 16 },
  textInput:       { backgroundColor: T.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: T.textPrimary, borderWidth: 1, borderColor: T.cardBorder },
  saveBtn:         { backgroundColor: T.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  saveBtnText:     { color: T.textPrimary, fontSize: 16, fontWeight: '700' },
  // Filter panel
  filterSectionLabel: { fontSize: 13, fontWeight: '700', color: T.textSecondary, letterSpacing: 0.8, marginTop: 12, marginBottom: 6, textTransform: 'uppercase' },
  filterInputWrap: { borderWidth: 1, borderColor: T.cardBorder, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 4, backgroundColor: T.card },
  filterInput:     { fontSize: 15, color: T.textPrimary },
  filterDivider:   { height: 1, backgroundColor: T.cardBorder, marginVertical: 14 },
  filterActions:   { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', gap: 12, padding: 20, backgroundColor: T.bg, borderTopWidth: 1, borderTopColor: T.cardBorder },
  clearBtn:        { flex: 1, borderRadius: 24, paddingVertical: 14, alignItems: 'center', backgroundColor: T.cardBorder },
  clearBtnText:    { fontSize: 13, fontWeight: '700', color: T.textSecondary, letterSpacing: 0.5 },
  applyBtn:        { flex: 2, borderRadius: 24, paddingVertical: 14, alignItems: 'center', backgroundColor: T.accent },
  applyBtnText:    { fontSize: 13, fontWeight: '700', color: T.textPrimary, letterSpacing: 0.5 },
  activeChip:      { flexDirection: 'row', alignItems: 'center', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#5B5BD6' },
  activeChipText:  { fontSize: 13, fontWeight: '600', color: '#FFF' },
  weekHeader:      { fontSize: 13, fontWeight: '700', color: T.textPrimary, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TournamentsScreen() {
  const { t } = useLanguage();
  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: t('tournaments.all') },
    { key: 'active', label: t('tournaments.active') },
    { key: 'upcoming', label: t('tournaments.upcoming') },
    { key: 'past', label: t('tournaments.past') },
    { key: 'withdrawn', label: t('tournaments.withdrawn') },
  ];
  const { data, isLoading } = useAppQuery({ tournaments: {} });
  const [activeFilter, setActiveFilter]   = useState<Filter>('all');
  const [showDiscovery, setShowDiscovery]  = useState(false);
  const [showAddForm, setShowAddForm]      = useState(false);
  const [detailId, setDetailId]           = useState<string | null>(null);
  const [expenseDetailId, setExpenseDetailId] = useState<string | null>(null);
  const { isFirstVisit, markVisited } = useFirstVisit('tournaments');
  const swipeHandlers = useTabSwipe();
  const router = useRouter();
  const demoCtx = useDemoData();
  const [selectedTournaments, setSelectedTournaments] = useState<Set<string>>(new Set());
  const tournamentSelectMode = selectedTournaments.size > 0;
  const [removingTournaments, setRemovingTournaments] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [scrapedPast, setScrapedPast] = useState<{ name: string; startDate: string; endDate: string; surface: string | null }[] | null>(DEMO_MODE ? [] : null);
  const [materializingId, setMaterializingId] = useState<string | null>(null);
  // Swipe actions — confirmation targets. Same confirm dialogs as the detail /
  // select-mode flows; the swipe only opens them, never mutates directly.
  const [swipeWithdrawTrn, setSwipeWithdrawTrn] = useState<any | null>(null);
  const [swipeDeleteTrn,   setSwipeDeleteTrn]   = useState<any | null>(null);

  function toggleTournamentSelect(id: string) {
    setSelectedTournaments(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function removeSelectedTournaments() {
    setShowDeleteConfirm(true);
  }

  async function deleteTournamentIds(ids: string[]) {
    setRemovingTournaments(true);
    try {
      const { cancelTournamentNotifications } = await import('@/utils/notifications');
      for (const id of ids) {
        if (DEMO_MODE) {
          demoCtx?.patchTournament(id, { isInMyList: false });
        } else {
          await cancelTournamentNotifications(id);
          await apiDeleteTournament(id);
        }
      }
    } catch (e: any) {
      Alert.alert('Could not delete', e?.message ?? 'Please try again.');
    } finally {
      setRemovingTournaments(false);
    }
  }

  async function executeDeleteSelected() {
    setShowDeleteConfirm(false);
    await deleteTournamentIds([...selectedTournaments]);
    setSelectedTournaments(new Set());
  }

  // Confirmed swipe-to-delete (non-registered tournaments only).
  async function confirmSwipeDelete() {
    const trn = swipeDeleteTrn;
    setSwipeDeleteTrn(null);
    if (!trn) return;
    await deleteTournamentIds([trn.id]);
  }

  // Confirmed swipe-to-withdraw — mirrors TournamentDetail's confirmWithdraw.
  async function confirmSwipeWithdraw() {
    const trn = swipeWithdrawTrn;
    setSwipeWithdrawTrn(null);
    if (!trn) return;
    try {
      if (DEMO_MODE) {
        demoCtx?.patchTournament(trn.id, { isWithdrawn: true });
      } else {
        await apiPatchTournament(trn.id, { isWithdrawn: true });
        const { cancelTournamentNotifications } = await import('@/utils/notifications');
        await cancelTournamentNotifications(trn.id);
      }
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? 'Please try again.');
    }
  }

  const { openTournament } = useLocalSearchParams<{ openTournament?: string }>();
  useEffect(() => {
    if (openTournament) setDetailId(openTournament);
  }, [openTournament]);

  // ── Supabase ITF calendar (upcoming, scraped) ─────────────────────────────
  const [itfTournaments, setItfTournaments] = useState<any[]>([]);
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    supabase
      .from('itf_tournaments')
      .select('itf_id, name, city, country, surface, category, start_date, end_date, prize_money_total')
      .gte('start_date', today)
      .order('start_date', { ascending: true })
      .limit(500)
      .then(({ data: rows }) => {
        if (rows) setItfTournaments(rows.map(r => ({
          id: r.itf_id,
          name: r.name,
          city: r.city,
          country: r.country,
          surface: r.surface,
          category: r.category,
          startDate: r.start_date,
          endDate: r.end_date,
          prizeMoney: r.prize_money_total,
          _fromSupabase: true,
        })));
      });
  }, []);

  const reconciledRef = useRef(new Set<string>());
  // Fill in MISSING deadlines from the formula. Never overwrite a stored
  // deadline that differs from the formula — those are user overrides.
  useEffect(() => {
    const tournaments = data?.tournaments ?? [];
    for (const trn of tournaments) {
      if (!trn.startDate || !trn.category || reconciledRef.current.has(trn.id)) continue;
      reconciledRef.current.add(trn.id);
      const correct = calcDeadlines(trn.startDate, trn.category);
      const updates: any = {};
      if (!trn.signUpDeadline)     updates.signUpDeadline     = correct.signUpDeadline;
      if (!trn.withdrawalDeadline) updates.withdrawalDeadline = correct.withdrawalDeadline;
      if (!trn.freezeDeadline)     updates.freezeDeadline     = correct.freezeDeadline;
      if (Object.keys(updates).length === 0) continue;
      if (DEMO_MODE) {
        demoCtx?.patchTournament(trn.id, updates);
      } else {
        apiPatchTournament(trn.id, updates).catch(() => {});
      }
    }
  }, [data?.tournaments]);

  // ── Scraped match history for Past section ─────────────────────────────────
  useEffect(() => {
    if (DEMO_MODE) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { setScrapedPast([]); return; }
      supabase.from('profiles').select('atp_player_name').eq('id', user.id).single()
        .then(({ data: prof }) => {
          if (!prof?.atp_player_name) { setScrapedPast([]); return; }
          const nameParts = prof.atp_player_name.trim().split(/\s+/).slice(0, 2).join(' ');
          supabase.from('player_profiles').select('match_history')
            .or(playerNameFilter(nameParts))
            .order('last_updated', { ascending: false }).limit(1)
            .then(({ data: rows }) => {
              if (!rows?.[0]?.match_history) { setScrapedPast([]); return; }
              const todayStr = new Date().toISOString().slice(0, 10);
              const seen = new Set<string>();
              const entries: { name: string; startDate: string; endDate: string; surface: string | null }[] = [];
              (rows[0].match_history as any[]).forEach((m: any) => {
                const name = m.tournamentName ?? '';
                const startDate = m.date ?? '';
                if (!name || !startDate || startDate >= todayStr) return;
                const key = `${name.toLowerCase()}|${startDate}`;
                if (seen.has(key)) return;
                seen.add(key);
                const [y, mo, d] = startDate.split('-').map(Number);
                const end = new Date(y, mo - 1, d + 6);
                const endDate = `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;
                entries.push({ name, startDate, endDate, surface: m.surface ?? null });
              });
              setScrapedPast(entries.sort((a, b) => b.startDate.localeCompare(a.startDate)));
            }, () => setScrapedPast([]));
        }, () => setScrapedPast([]));
    }).catch((err) => {
      console.warn('[tournaments] scraped history fetch failed', err);
      setScrapedPast([]);
    });
  }, []);

  const allMyTournaments = (data?.tournaments ?? []).filter(
    (trn: any) => trn.isInMyList !== false
  );
  const nonWithdrawn   = allMyTournaments.filter((trn: any) => !trn.isWithdrawn);
  const withdrawnGroup = allMyTournaments.filter((trn: any) => trn.isWithdrawn);

  const filtered = activeFilter === 'withdrawn' || activeFilter === 'all'
    ? nonWithdrawn
    : nonWithdrawn.filter((trn: any) => getGroup(trn) === activeFilter);

  const activeGroup   = filtered.filter((trn: any) => getGroup(trn) === 'active');
  const upcomingGroup = filtered.filter((trn: any) => getGroup(trn) === 'upcoming');
  // Past includes materialized history records (isInMyList === false) so a
  // tournament viewed from scraped history stays visible instead of vanishing
  // from both the scraped list and the my-list group.
  const materializedPast = (data?.tournaments ?? []).filter(
    (trn: any) => trn.isInMyList === false && !trn.isWithdrawn && getGroup(trn) === 'past'
  );
  const pastGroup     = [
    ...filtered.filter((trn: any) => getGroup(trn) === 'past'),
    ...(activeFilter === 'all' || activeFilter === 'past' ? materializedPast : []),
  ];

  const scrapedPastEntries = useMemo(() => {
    if (!scrapedPast) return null;
    const existingKeys = new Set(
      (data?.tournaments ?? []).map((t: any) => `${(t.name ?? '').toLowerCase()}|${(t.startDate ?? '')}`)
    );
    return scrapedPast.filter(s => !existingKeys.has(`${s.name.toLowerCase()}|${s.startDate}`));
  }, [scrapedPast, data?.tournaments]);

  // Single globally-sorted past list (most recent week first, undated last).
  // Previously "own" tournaments and "scraped-only" tournaments were rendered
  // as two independently-sorted stacks, so a March scraped entry could render
  // below a June registered one — that's what read as "unorganized".
  const pastWeeksMerged = useMemo(() => {
    const noDateLabel = t('tournaments.noDate');
    const ownWeeks = groupByWeek(pastGroup, noDateLabel).map(w => ({
      ...w,
      items: w.items.map((item: any) => ({ kind: 'own' as const, item })),
    }));
    const scrapedTagged = (scrapedPastEntries ?? []).map(e => ({ ...e, id: `scraped|${e.name}|${e.startDate}` }));
    const scrapedWeeks = groupByWeek(scrapedTagged, noDateLabel).map(w => ({
      ...w,
      items: w.items.map((item: any) => ({ kind: 'scraped' as const, item })),
    }));

    const byKey = new Map<string, { weekLabel: string; weekKey: string; items: { kind: 'own' | 'scraped'; item: any }[] }>();
    for (const w of [...ownWeeks, ...scrapedWeeks]) {
      const existing = byKey.get(w.weekKey);
      if (existing) existing.items.push(...w.items);
      else byKey.set(w.weekKey, { weekLabel: w.weekLabel, weekKey: w.weekKey, items: [...w.items] });
    }

    return Array.from(byKey.values())
      .sort((a, b) => {
        if (a.weekKey === 'unknown') return 1;
        if (b.weekKey === 'unknown') return -1;
        return b.weekKey.localeCompare(a.weekKey); // descending — most recent week first
      })
      .map(w => ({
        ...w,
        items: [...w.items].sort((a, b) => (b.item.startDate ?? '').localeCompare(a.item.startDate ?? '')),
      }));
  }, [pastGroup, scrapedPastEntries, t]);

  async function materializeAndOpen(entry: { name: string; startDate: string; endDate: string; surface: string | null }) {
    if (DEMO_MODE) return;
    const key = `${entry.name}|${entry.startDate}`;
    setMaterializingId(key);
    try {
      // Attempt to auto-derive country from itf_tournaments by matching start_date + city keyword.
      // Strip common ITF prefixes/suffixes to isolate the city word, then query by city column.
      let country: string | null = null;
      const cityWord = entry.name
        .replace(/^(M15|M25|M50|M100)\s+/i, '')
        .replace(/\s+(CH|FL|NC|TX|CA|PA|NY|TN|GA|OH|BC|WA)\s*$/i, '')
        .trim();
      if (cityWord) {
        const { data: itfRows } = await supabase
          .from('itf_tournaments')
          .select('country')
          .eq('start_date', entry.startDate)
          .or(`city.ilike.%${cityWord}%,name.ilike.%${cityWord}%`)
          .limit(1);
        if (itfRows?.[0]?.country) {
          country = nameToIso2(itfRows[0].country);
        }
        // itf_tournaments only holds a rolling window of current/upcoming events,
        // so past history events rarely match on start_date. Fall back to a
        // date-less city/name match — the same city recurs across editions.
        if (!country) {
          const { data: anyRows } = await supabase
            .from('itf_tournaments')
            .select('country')
            .or(`city.ilike.%${cityWord}%,name.ilike.%${cityWord}%`)
            .limit(1);
          if (anyRows?.[0]?.country) {
            country = nameToIso2(anyRows[0].country);
          }
        }
      }

      const row = await apiAddTournament({
        name: entry.name,
        startDate: entry.startDate,
        endDate: entry.endDate,
        country,
        city: cityWord || null,
        surface: entry.surface,
        isRegistered: false,
        isWithdrawn: false,
        isInMyList: false,
        prizeMoney: 0,
        singlesPrizeMoney: 0,
        doublesPrizeMoney: 0,
      });
      // Open the results/expenses view — TournamentDetail is the management
      // modal (deadlines/registration) and shows nothing useful for history.
      if (row?.id) setExpenseDetailId(row.id);
    } finally {
      setMaterializingId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} {...swipeHandlers}>

        <View style={styles.topBar}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity onPress={() => router.push('/settings' as any)} activeOpacity={0.75}>
              <AgentIcon size={70} />
            </TouchableOpacity>
            <Text style={styles.topTitle}>{t('tournaments.title')}</Text>
          </View>
          <TouchableOpacity style={styles.addButton} onPress={() => setShowDiscovery(true)} activeOpacity={0.8}>
            <Text style={styles.addIcon}>+</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.filterRow}>
          {filters.map((f) => (
            <TouchableOpacity key={f.key}
              style={[styles.filterChip, activeFilter === f.key ? styles.filterChipActive : styles.filterChipInactive]}
              onPress={() => setActiveFilter(f.key)} activeOpacity={0.7}>
              <Text style={[styles.filterChipText, activeFilter === f.key ? styles.filterChipTextActive : styles.filterChipTextInactive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {tournamentSelectMode && (
          <View style={styles.selectBar}>
            <Text style={styles.selectCount}>{selectedTournaments.size} {t('tournaments.selected')}</Text>
            <TouchableOpacity onPress={() => setSelectedTournaments(new Set())} activeOpacity={0.7}>
              <Text style={styles.selectCancel}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {isLoading && <LoadingLogo style={{ minHeight: 300 }} />}

        {!isLoading && activeFilter !== 'withdrawn' && filtered.length === 0 && (
          <Text style={styles.emptyText}>{t('tournaments.noTournamentsYet')}</Text>
        )}
        {!isLoading && activeFilter === 'withdrawn' && withdrawnGroup.length === 0 && (
          <Text style={styles.emptyText}>{t('tournaments.noWithdrawn')}</Text>
        )}

        {activeFilter !== 'withdrawn' && activeGroup.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>{t('tournaments.active').toUpperCase()}</Text>
            {groupByWeek(activeGroup, t('tournaments.noDate')).map(week => (
              <View key={week.weekKey}>
                <Text style={styles.weekLabel}>{week.weekLabel}</Text>
                {week.items.map((item: any) => {
                  const canWithdraw = item.isRegistered && !item.isWithdrawn;
                  return (
                    <SwipeableRow key={item.id}
                      enabled={!tournamentSelectMode}
                      actionLabel={canWithdraw ? t('tournament.withdraw') : t('common.delete')}
                      actionColor={canWithdraw ? T.amber : T.red}
                      onAction={() => canWithdraw ? setSwipeWithdrawTrn(item) : setSwipeDeleteTrn(item)}>
                      <TournamentCard item={item} t={t}
                        selected={selectedTournaments.has(item.id)} selectMode={tournamentSelectMode}
                        onPress={() => tournamentSelectMode ? toggleTournamentSelect(item.id) : setDetailId(item.id)}
                        onLongPress={() => toggleTournamentSelect(item.id)} />
                    </SwipeableRow>
                  );
                })}
              </View>
            ))}
          </>
        )}
        {activeFilter !== 'withdrawn' && upcomingGroup.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>{t('tournaments.upcoming').toUpperCase()}</Text>
            {groupByWeek(upcomingGroup, t('tournaments.noDate')).map(week => (
              <View key={week.weekKey}>
                <Text style={styles.weekLabel}>{week.weekLabel}</Text>
                {week.items.map((item: any) => {
                  const canWithdraw = item.isRegistered && !item.isWithdrawn;
                  return (
                    <SwipeableRow key={item.id}
                      enabled={!tournamentSelectMode}
                      actionLabel={canWithdraw ? t('tournament.withdraw') : t('common.delete')}
                      actionColor={canWithdraw ? T.amber : T.red}
                      onAction={() => canWithdraw ? setSwipeWithdrawTrn(item) : setSwipeDeleteTrn(item)}>
                      <TournamentCard item={item} t={t}
                        selected={selectedTournaments.has(item.id)} selectMode={tournamentSelectMode}
                        onPress={() => tournamentSelectMode ? toggleTournamentSelect(item.id) : setDetailId(item.id)}
                        onLongPress={() => toggleTournamentSelect(item.id)} />
                    </SwipeableRow>
                  );
                })}
              </View>
            ))}
          </>
        )}
        {activeFilter !== 'withdrawn' && (activeFilter === 'all' || activeFilter === 'past') &&
          pastWeeksMerged.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>{t('tournaments.past').toUpperCase()}</Text>
            {pastWeeksMerged.map(week => (
              <View key={week.weekKey}>
                <Text style={styles.weekLabel}>{week.weekLabel}</Text>
                {week.items.map(({ kind, item }) => kind === 'own' ? (
                  <TournamentCard key={item.id} item={item} t={t}
                    selected={selectedTournaments.has(item.id)} selectMode={tournamentSelectMode}
                    onPress={() => tournamentSelectMode ? toggleTournamentSelect(item.id) : setExpenseDetailId(item.id)}
                    onLongPress={() => toggleTournamentSelect(item.id)} />
                ) : (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.card}
                    activeOpacity={0.8}
                    disabled={materializingId === `${item.name}|${item.startDate}`}
                    onPress={() => materializeAndOpen(item)}
                  >
                    <View style={styles.cardTopRow}>
                      {item.surface && <CourtIcon surface={item.surface} size="sm" />}
                      <Text style={styles.cardTitle} numberOfLines={2}>{item.name}</Text>
                      {materializingId === `${item.name}|${item.startDate}`
                        ? <ActivityIndicator size="small" color={T.accent} />
                        : <View style={styles.scrapedBadge}><Text style={styles.scrapedBadgeText}>{t('tournaments.history')}</Text></View>
                      }
                    </View>
                    <Text style={styles.cardMeta}>{fmtDateRange(item.startDate, item.endDate)}{item.surface ? ` · ${item.surface}` : ''}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </>
        )}
        {activeFilter === 'withdrawn' && withdrawnGroup.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>{t('tournaments.withdrawn').toUpperCase()}</Text>
            {withdrawnGroup.map((item: any) => (
              <TouchableOpacity key={item.id}
                style={[styles.cardWithdrawn, selectedTournaments.has(item.id) && styles.cardSelected]}
                onPress={() => tournamentSelectMode ? toggleTournamentSelect(item.id) : setDetailId(item.id)}
                onLongPress={() => toggleTournamentSelect(item.id)}
                activeOpacity={0.7}>
                <View style={styles.cardTopRow}>
                  {tournamentSelectMode && (
                    <View style={[styles.selectBox, selectedTournaments.has(item.id) && styles.selectBoxOn]}>
                      {selectedTournaments.has(item.id) && <Text style={styles.selectCheck}>✓</Text>}
                    </View>
                  )}
                  <Text style={styles.cardTitleMuted} numberOfLines={1}>
                    {item.country ? countryFlag(item.country) + ' ' : ''}{item.name}
                  </Text>
                  <View style={styles.withdrawnBadge}><Text style={styles.withdrawnBadgeText}>{t('tournaments.withdrawn')}</Text></View>
                </View>
                <Text style={styles.cardMetaMuted}>
                  {fmtDateRange(item.startDate, item.endDate)}{item.surface ? ` · ${item.surface}` : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </>
        )}

      </ScrollView>

      {tournamentSelectMode && (
        <View style={styles.removeBtnBar}>
          <TouchableOpacity
            style={[styles.removeBtn, removingTournaments && { opacity: 0.5 }]}
            onPress={removeSelectedTournaments}
            disabled={removingTournaments}
            activeOpacity={0.8}>
            {removingTournaments
              ? <ActivityIndicator color={T.textPrimary} />
              : <Text style={styles.removeBtnText}>Delete {selectedTournaments.size} tournament{selectedTournaments.size !== 1 ? 's' : ''}</Text>}
          </TouchableOpacity>
        </View>
      )}

      <TournamentDiscoveryModal
        visible={showDiscovery}
        onClose={() => setShowDiscovery(false)}
        allTournaments={data?.tournaments ?? []}
        itfTournaments={itfTournaments}
        onOpenAddManual={() => setShowAddForm(true)}
      />
      {showAddForm && <AddTournamentModal onClose={() => setShowAddForm(false)} />}
      {showDeleteConfirm && (() => {
        const count = selectedTournaments.size;
        return (
          <Modal transparent animationType="fade" onRequestClose={() => setShowDeleteConfirm(false)}>
            <Pressable style={styles.dialogBackdrop} onPress={() => setShowDeleteConfirm(false)}>
              <Pressable style={styles.dialog} onPress={() => {}}>
                <Text style={styles.dialogTitle}>Delete {count} tournament{count !== 1 ? 's' : ''}?</Text>
                <Text style={styles.dialogBody}>This cannot be undone.</Text>
                <View style={styles.dialogActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowDeleteConfirm(false)} activeOpacity={0.7}>
                    <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.withdrawConfirmBtn} onPress={executeDeleteSelected} activeOpacity={0.8}>
                    <Text style={styles.withdrawConfirmText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            </Pressable>
          </Modal>
        );
      })()}
      {swipeWithdrawTrn && (
        <WithdrawDialog
          name={swipeWithdrawTrn.name}
          onConfirm={confirmSwipeWithdraw}
          onCancel={() => setSwipeWithdrawTrn(null)}
          t={t}
        />
      )}
      {swipeDeleteTrn && (
        <Modal transparent animationType="fade" onRequestClose={() => setSwipeDeleteTrn(null)}>
          <Pressable style={styles.dialogBackdrop} onPress={() => setSwipeDeleteTrn(null)}>
            <Pressable style={styles.dialog} onPress={() => {}}>
              <Text style={styles.dialogTitle}>Delete 1 tournament?</Text>
              <Text style={styles.dialogBody}>{swipeDeleteTrn.name} — this cannot be undone.</Text>
              <View style={styles.dialogActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setSwipeDeleteTrn(null)} activeOpacity={0.7}>
                  <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.withdrawConfirmBtn} onPress={confirmSwipeDelete} activeOpacity={0.8}>
                  <Text style={styles.withdrawConfirmText}>{t('common.delete')}</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
      {detailId && <TournamentDetail tournamentId={detailId} onClose={() => setDetailId(null)} />}
      {expenseDetailId && (() => {
        // Look up across ALL tournaments — materialized history records have
        // isInMyList === false and would never resolve from allMyTournaments.
        const trn = (data?.tournaments ?? []).find((x: any) => x.id === expenseDetailId);
        return trn ? (
          <TournamentExpenseDetail
            tournament={trn}
            allTournaments={allMyTournaments}
            onClose={() => setExpenseDetailId(null)}
          />
        ) : null;
      })()}
      <ScreenWalkthrough steps={TOURNAMENTS_WALKTHROUGH} visible={isFirstVisit} onDismiss={markVisited} />
    </SafeAreaView>
  );
}

// ─── List styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 32 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 18, paddingBottom: 20 },
  topTitle: { fontSize: 18, fontWeight: '700', color: T.textPrimary },
  avatarBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: T.card, borderWidth: 1.5, borderColor: T.teal, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 13, fontWeight: '800', color: T.teal },
  addButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: T.teal, alignItems: 'center', justifyContent: 'center' },
  addIcon: { color: T.textPrimary, fontSize: 22, lineHeight: 26, fontWeight: '300' },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  filterChip: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7 },
  filterChipActive: { backgroundColor: T.teal },
  filterChipInactive: { backgroundColor: T.card },
  filterChipText: { fontSize: 13, fontWeight: '600' },
  filterChipTextActive: { color: T.textPrimary },
  filterChipTextInactive: { color: T.textTertiary },
  sectionLabel: { fontSize: 11, fontWeight: '600', color: T.textTertiary, letterSpacing: 0.8, marginBottom: 10, marginTop: 4 },
  weekLabel: { fontSize: 13, fontWeight: '700', color: T.textSecondary, marginBottom: 8, marginTop: 12, paddingLeft: 2 },
  selectBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingHorizontal: 4 },
  selectCount: { fontSize: 14, fontWeight: '600', color: T.teal },
  selectCancel: { fontSize: 14, fontWeight: '600', color: T.textSecondary },
  selectBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: T.textMuted, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  selectBoxOn: { backgroundColor: T.teal, borderColor: T.teal },
  selectCheck: { color: T.textPrimary, fontSize: 13, fontWeight: '700' },
  cardSelected: { borderWidth: 1.5, borderColor: T.teal },
  removeBtnBar: { paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#2A2A3C', backgroundColor: '#0F0F1A' },
  removeBtn: { backgroundColor: T.red, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  removeBtnText: { fontSize: 15, fontWeight: '700', color: T.textPrimary },
  card: { borderRadius: 12, padding: 12, marginBottom: 6, backgroundColor: T.card },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2, gap: 6 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: T.textPrimary, flex: 1, flexShrink: 1 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  cardMeta: { fontSize: 11, color: T.textTertiary },
  registeredBadge: { backgroundColor: T.cardBorder, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, flexShrink: 0 },
  registeredText: { fontSize: 10, fontWeight: '600', color: T.teal },
  notRegisteredBadge: { backgroundColor: T.card, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, flexShrink: 0 },
  notRegisteredText: { fontSize: 10, fontWeight: '600', color: T.textTertiary },
  playedBadge: { backgroundColor: '#0A2010', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, flexShrink: 0 },
  playedText: { fontSize: 10, fontWeight: '600', color: T.green },
  scrapedBadge: { borderWidth: 1, borderColor: 'rgba(91,91,214,0.4)', backgroundColor: 'rgba(91,91,214,0.12)', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, flexShrink: 0 },
  scrapedBadgeText: { fontSize: 10, fontWeight: '600', color: T.accent },
  pillRow: { flexDirection: 'row', gap: 6 },
  pill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  pillRed: { backgroundColor: T.red },
  pillAmber: { backgroundColor: T.amber },
  pillText: { fontSize: 11, color: T.textPrimary, fontWeight: '600' },
  emptyText: { fontSize: 14, color: T.textTertiary, textAlign: 'center', marginTop: 40 },
  cardWithdrawn: {
    borderRadius: 12, padding: 10, marginBottom: 5,
    backgroundColor: '#1E1610', borderWidth: 1, borderColor: '#2A2018',
  },
  cardTitleMuted: { fontSize: 14, fontWeight: '600', color: T.textTertiary, flex: 1, marginRight: 8 },
  cardMetaMuted: { fontSize: 11, color: T.textMuted },
  withdrawnBadge: { backgroundColor: '#280E0E', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  withdrawnBadgeText: { fontSize: 11, fontWeight: '600', color: '#E06858' },
  dialogBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 },
  dialog: { backgroundColor: T.card, borderRadius: 20, padding: 24, width: '100%' },
  dialogTitle: { fontSize: 17, fontWeight: '700', color: T.textPrimary, marginBottom: 10, textAlign: 'center' },
  dialogBody: { fontSize: 14, color: T.textTertiary, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  dialogActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, backgroundColor: T.card, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: T.textSecondary },
  withdrawConfirmBtn: { flex: 1, backgroundColor: T.red, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  withdrawConfirmText: { fontSize: 15, fontWeight: '700', color: T.textPrimary },
});

// ─── Add-tournament form styles ───────────────────────────────────────────────

const form = StyleSheet.create({
  kav: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.65)' },
  sheet: { backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingBottom: 36, paddingTop: 16, maxHeight: '92%' },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: T.cardBorder, alignSelf: 'center', marginBottom: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  backBtn: { marginRight: 12 },
  backBtnText: { fontSize: 14, color: T.teal, fontWeight: '600' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: T.textPrimary },
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.card, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16 },
  searchIcon: { fontSize: 14, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, color: T.textPrimary },
  searchClear: { fontSize: 13, color: T.textTertiary, paddingLeft: 8 },
  resultCard: { backgroundColor: T.card, borderRadius: 12, padding: 14, marginBottom: 8 },
  resultCardInner: { flexDirection: 'row', alignItems: 'center' },
  resultName: { fontSize: 14, fontWeight: '600', color: T.textPrimary, marginBottom: 3 },
  resultMeta: { fontSize: 12, color: T.textTertiary },
  resultAddLabel: { fontSize: 12, color: T.teal, fontWeight: '600', marginTop: 8, textAlign: 'right' },
  categoryBadge: { backgroundColor: T.cardBorder, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 10 },
  categoryBadgeText: { fontSize: 11, fontWeight: '700', color: T.teal },
  noResults: { paddingVertical: 16, alignItems: 'center' },
  noResultsText: { fontSize: 14, color: T.textTertiary },
  manualPrompt: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: T.card, borderRadius: 14, padding: 16, marginTop: 8, marginBottom: 8 },
  manualPromptIcon: { fontSize: 22 },
  manualPromptTitle: { fontSize: 15, fontWeight: '700', color: T.textPrimary, marginBottom: 2 },
  manualPromptSub: { fontSize: 12, color: T.textTertiary, lineHeight: 16 },
  scrollArea: { flexGrow: 0 },
  field: { marginBottom: 18 },
  label: { fontSize: 12, fontWeight: '600', color: T.textTertiary, letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' },
  hint: { fontSize: 11, color: T.textTertiary, marginBottom: 4 },
  input: { backgroundColor: T.card, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: T.textPrimary },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: T.card },
  chipActive: { backgroundColor: T.teal },
  chipText: { fontSize: 13, fontWeight: '600', color: T.textTertiary },
  chipTextActive: { color: T.textPrimary },
  error: { fontSize: 13, color: T.red, marginBottom: 12, textAlign: 'center' },
  deadlineWarning: { backgroundColor: '#201808', borderRadius: 12, padding: 14, marginBottom: 4, borderWidth: 1, borderColor: '#604A10' },
  deadlineWarningTitle: { fontSize: 13, fontWeight: '700', color: '#D4A030', marginBottom: 4 },
  deadlineWarningBody: { fontSize: 12, color: '#C09020', lineHeight: 17 },
  playingBtn: {
    marginTop: 10, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14,
    backgroundColor: '#2A1A04', borderWidth: 1, borderColor: '#C8A020', alignItems: 'center',
  },
  playingBtnActive: { backgroundColor: T.teal, borderColor: T.teal },
  playingBtnText: { fontSize: 14, fontWeight: '700', color: '#D4A030' },
  playingBtnTextActive: { color: T.textPrimary },
  saveBtn: { backgroundColor: T.teal, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: T.textPrimary, fontSize: 16, fontWeight: '700' },
  // Deadline rows in manual form
  deadlineItem: { marginBottom: 14 },
  deadlineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  deadlineItemLabel: { fontSize: 12, color: T.textSecondary, fontWeight: '500' },
  overrideBtn: { fontSize: 12, color: T.teal, fontWeight: '600' },
  deadlinePreviewText: { fontSize: 13, color: T.textSecondary, paddingVertical: 6, paddingHorizontal: 2 },
});

// ─── Detail screen styles ─────────────────────────────────────────────────────

const det = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  navbar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: T.bg,
    borderBottomWidth: 1, borderBottomColor: T.cardBorder,
  },
  backBtn: { paddingRight: 16 },
  backText: { fontSize: 15, fontWeight: '600', color: T.teal },
  // Header band
  headerBand: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 28 },
  headerName: { fontSize: 22, fontWeight: '800', lineHeight: 32, letterSpacing: 0.2, marginBottom: 6 },
  headerMeta: { fontSize: 13, fontWeight: '500', lineHeight: 20 },
  // Body
  body: { paddingHorizontal: 20, paddingTop: 24 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: T.textTertiary, letterSpacing: 0.8, lineHeight: 16, marginBottom: 12, marginTop: 8 },
  // Toggle card (settings-style rows)
  toggleCard: {
    backgroundColor: T.card, borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: T.cardBorder, marginBottom: 8,
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 13,
  },
  toggleDivider: { height: 1, backgroundColor: T.cardBorder, marginHorizontal: 16 },
  toggleLabel: { fontSize: 15, fontWeight: '500', color: T.textPrimary, lineHeight: 22 },
  toggleLabelWithdraw: { color: T.red },
  // Deadlines
  deadlinesCard: { backgroundColor: T.card, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: T.cardBorder, marginBottom: 8 },
  deadlineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, gap: 12 },
  deadlineDivider: { height: 1, backgroundColor: T.cardBorder, marginHorizontal: 16 },
  deadlineName: { fontSize: 14, color: T.textPrimary, fontWeight: '500', flex: 1, lineHeight: 20 },
  deadlineRight: { alignItems: 'flex-end', flexShrink: 0 },
  deadlineDate: { fontSize: 13, color: T.textSecondary, marginBottom: 3, lineHeight: 18 },
  deadlineDays: { fontSize: 12, fontWeight: '600', lineHeight: 16 },
  // Edit mode
  editBtn: { marginLeft: 'auto', paddingLeft: 16, paddingVertical: 4 },
  editBtnText: { fontSize: 20 },
  editChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  editChip: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: T.card },
  editChipActive: { backgroundColor: T.teal },
  editChipText: { fontSize: 13, fontWeight: '600', color: T.textTertiary },
  editChipTextActive: { color: T.textPrimary },
  editInput: {
    backgroundColor: T.card, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: T.textPrimary, borderWidth: 1, borderColor: T.cardBorder, marginBottom: 20,
  },
  editDateRow: { flexDirection: 'row', marginBottom: 20 },
  editDateLabel: { fontSize: 11, fontWeight: '600', color: T.textTertiary, marginBottom: 6, letterSpacing: 0.4 },
  editError: { fontSize: 13, color: T.red, textAlign: 'center', marginBottom: 12 },
  editActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  editCancelBtn: { flex: 1, backgroundColor: T.card, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  editCancelText: { fontSize: 15, fontWeight: '600', color: T.textSecondary },
  editSaveBtn: { flex: 2, backgroundColor: T.teal, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  editSaveText: { fontSize: 15, fontWeight: '700', color: T.textPrimary },
  // Deadline override rows in edit mode
  editDeadlineItem: { marginBottom: 16 },
  editDeadlineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  overrideBtn: { fontSize: 12, color: T.teal, fontWeight: '600' },
  deadlinePreviewText: { fontSize: 13, color: T.textSecondary, paddingVertical: 6, paddingHorizontal: 2 },
  playingPillWrap: { paddingVertical: 12, paddingHorizontal: 16 },
  playingPill: { backgroundColor: T.cardBorder, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, alignSelf: 'flex-start' },
  playingPillText: { fontSize: 13, fontWeight: '700', color: T.teal },
  prizeCard: { backgroundColor: T.bg, borderRadius: 16, borderWidth: 1, borderColor: T.cardBorder, overflow: 'hidden' },
  prizeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  prizeLabel: { fontSize: 14, color: T.textSecondary },
  prizeAmount: { fontSize: 15, fontWeight: '600', color: T.textPrimary },
  tripEstimateCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: T.bg, borderRadius: 16, borderWidth: 1, borderColor: T.cardBorder,
    padding: 14,
  },
  tripEstimateAmount: { fontSize: 15, fontWeight: '700', color: T.amber },
  tripEstimateRange: { fontSize: 13, fontWeight: '500', color: T.textSecondary },
  tripEstimateMeta: { fontSize: 12, color: T.textTertiary, marginTop: 4, lineHeight: 16 },
  aiBreakdownBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginLeft: 8 },
  aiBreakdownBtnText: { fontSize: 12, fontWeight: '700', color: T.accent },
  aiBreakdownChevron: { fontSize: 16, fontWeight: '700', color: T.accent, marginLeft: 2 },
  // AI breakdown bottom sheet
  aiSheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  aiSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: T.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '85%', paddingBottom: 30,
  },
  aiSheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#3A3A5C', alignSelf: 'center', marginTop: 10, marginBottom: 14 },
  aiSheetScroll: { paddingHorizontal: 20 },
  aiSheetHeaderRow: { marginBottom: 14 },
  aiSheetTitle: { fontSize: 17, fontWeight: '700', color: T.textPrimary, marginBottom: 8 },
  aiBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  aiTierChip: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  aiTierChipText: { fontSize: 11, fontWeight: '700' },
  aiConfidencePill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: T.cardBorder },
  aiConfidencePillText: { fontSize: 11, fontWeight: '600', color: T.textSecondary },
  aiSampleText: { fontSize: 12, color: T.textTertiary },
  aiLoadingWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 12 },
  aiLoadingText: { fontSize: 13, color: T.textSecondary },
  aiErrorWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, paddingHorizontal: 12 },
  aiErrorText: { fontSize: 14, color: T.textSecondary, textAlign: 'center', lineHeight: 20 },
  aiCategoryRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.cardBorder },
  aiCategoryIcon: { fontSize: 18, marginRight: 12, marginTop: 1 },
  aiCategoryLabel: { fontSize: 14, fontWeight: '600', color: T.textPrimary },
  aiCategoryBasis: { fontSize: 12, color: T.textTertiary, marginTop: 2, lineHeight: 16 },
  aiCategoryAmount: { fontSize: 14, fontWeight: '700', color: T.textPrimary, marginLeft: 12 },
  aiTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  aiTotalLabel: { fontSize: 15, fontWeight: '700', color: T.textPrimary },
  aiTotalAmount: { fontSize: 18, fontWeight: '800', color: T.accent },
  aiComparisonText: { fontSize: 13, color: T.textSecondary, lineHeight: 19, marginBottom: 12 },
  aiCaveatsWrap: { marginBottom: 8 },
  aiCaveatRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  aiCaveatDot: { fontSize: 8, color: T.amber, marginRight: 8, marginTop: 5 },
  aiCaveatText: { flex: 1, fontSize: 12, color: T.textTertiary, lineHeight: 17 },
  aiFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: T.cardBorder },
  aiRefreshBtn: { paddingVertical: 4, paddingRight: 8 },
  aiRefreshBtnText: { fontSize: 13, fontWeight: '700', color: T.teal },
  aiDisclaimerText: { fontSize: 11, color: T.textTertiary, flex: 1, textAlign: 'right', marginLeft: 12 },
});

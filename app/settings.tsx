import React, { useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Platform,
  Modal,
  Switch,
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
} from 'react-native';
import Constants from 'expo-constants';
import { Text } from '@/components/ui/text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAppAlert } from '@/components/ui/app-alert';
import { useProfile, useUpdateProfile, type Profile, type ReminderConfig, type ReminderTime, type OnsiteReminderTime, DEFAULT_REMINDER_CONFIG, DEFAULT_ONSITE_REMINDERS } from '@/hooks/useProfile';
import { useAuth } from '@/hooks/useAuth';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { useAppQuery } from '@/hooks/useAppQuery';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMyShares, useInviteShare, useRevokeShare } from '@/hooks/useSharedAccess';
import { exportTournamentsCsv, exportExpensesCsv, exportAllCsv } from '@/utils/export-csv';
import { exportSeasonStatementPdf, exportTaxReportPdf } from '@/utils/export-pdf';
import {
  pickAndParseFile,
  detectHeaderRow,
  insertExpenses,
  smartParse,
  checkDuplicates,
  type MappedExpense,
  type ImportResult,
} from '@/utils/import-expenses';
import { parseNotes, type ParsedExpense } from '@/utils/parse-notes';
import { expenseDupeKey } from '@/utils/categories';
import { DEMO_MODE } from '@/config/demo';
import { T } from '@/constants/theme';
import { PRIVACY_POLICY_URL } from '@/constants/links';
import { useLanguage, setLanguage } from '@/hooks/useLanguage';
import type { Lang } from '@/lib/i18n';

const ROLES = ['Player', 'Coach', 'Other'];
const SURFACES = [
  { key: 'clay', label: 'Clay', color: T.clayText, bg: '#FAEEDA' },
  { key: 'hard', label: 'Hard', color: T.hardText, bg: '#E6F1FB' },
  { key: 'grass', label: 'Grass', color: T.grassText, bg: '#EAF3DE' },
];
const COACH_OPTIONS = ['Yes', 'No', 'Sometimes'];
const YES_NO = ['Yes', 'No'];
const COUNTRIES = [
  'AR','AU','BR','CL','CO','DE','EC','ES','FR','GB','IT','MX','PE','PT','US','UY',
];
const FLAG: Record<string, string> = {
  AR:'🇦🇷',AU:'🇦🇺',BR:'🇧🇷',CL:'🇨🇱',CO:'🇨🇴',DE:'🇩🇪',EC:'🇪🇨',ES:'🇪🇸',
  FR:'🇫🇷',GB:'🇬🇧',IT:'🇮🇹',MX:'🇲🇽',PE:'🇵🇪',PT:'🇵🇹',US:'🇺🇸',UY:'🇺🇾',
};
const DEFAULT_SLOT_TIMES: ReminderTime[] = ['7d', '2d', '2h'];
const DEFAULT_ONSITE_SLOT_TIMES: OnsiteReminderTime[] = ['5h', '2h', '30m'];

type EditField =
  | null
  | 'full_name'
  | 'nationality'
  | 'home_city'
  | 'date_of_birth'
  | 'ranking'
  | 'role'
  | 'primary_surface'
  | 'annual_budget'
  | 'travel_with_coach'
  | 'travel_with_stringing'
  | 'language';

const LANGUAGES = [
  { key: 'en', label: 'English', flag: '🇺🇸' },
  { key: 'es', label: 'Español', flag: '🇪🇸' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { show: showAlert } = useAppAlert();
  const { data: profile, isLoading } = useProfile();
  const { t, lang } = useLanguage();
  const updateProfile = useUpdateProfile();
  const { user, signOut, updateEmail, updatePassword } = useAuth();
  const { data: appData } = useAppQuery({ tournaments: {}, expenses: {} });
  const queryClient = useQueryClient();
  const { data: shares } = useMyShares();
  const inviteShare = useInviteShare();
  const revokeShare = useRevokeShare();
  const { data: scraperLastRun } = useQuery({
    // Demo mode has no Supabase session — don't fire a live query there.
    enabled: !DEMO_MODE,
    queryKey: ['scraperLastRun'],
    queryFn: async () => {
      const { supabase: sb } = await import('@/lib/supabase');
      const { data, error } = await sb
        .from('scraper_runs')
        .select('finished_at, status')
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { finished_at: string | null; status: string } | null;
    },
    // Graceful degradation — if this fails, the UI just shows '—'.
    retry: false,
  });
  const [openSection, setOpenSection] = useState<string | null>(null);
  function toggleSection(key: string) { setOpenSection(v => v === key ? null : key); }

  const [editField, setEditField] = useState<EditField>(null);
  const [editValue, setEditValue] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showChangeEmail, setShowChangeEmail] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accountLoading, setAccountLoading] = useState(false);
  const [importStep, setImportStep] = useState<'idle' | 'loading' | 'preview' | 'importing'>('idle');
  const [importData, setImportData] = useState<ImportResult | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [showPasteNotes, setShowPasteNotes] = useState(false);
  const [notesText, setNotesText] = useState('');
  const [parsedNotes, setParsedNotes] = useState<ParsedExpense[]>([]);
  const [pasteImporting, setPasteImporting] = useState(false);
  const [ipinInput, setIpinInput] = useState((profile as Profile | null)?.ipin_number ?? '');

  async function handleImport() {
    try {
      setImportStep('loading');
      const file = await pickAndParseFile();
      if (!file) { setImportStep('idle'); return; }

      setImportFileName(file.fileName);
      const { headers, dataRows } = detectHeaderRow(file.rows);
      const result = smartParse(headers, dataRows);

      if (result.mapped.length === 0) {
        showAlert(
          'Could not import file',
          `No expenses could be read from this file.\n\nColumns found: ${headers.join(', ')}\n\n${result.unmapped} rows skipped.\n\nSupported formats: row-per-expense (date/amount/category), monthly summary (Category + Jan–Dec columns), quarterly summary (Q1–Q4), bank statement (date/debit/credit), or simple list (amount + description).`,
        );
        setImportStep('idle');
        return;
      }

      const isDuplicate = await checkDuplicates(result.mapped);
      setImportData({ ...result, likelyDuplicate: isDuplicate });
      setImportStep('preview');
    } catch (err: any) {
      showAlert(t('settings.importError'), err?.message ?? 'Could not process file.');
      setImportStep('idle');
    }
  }

  async function confirmImport() {
    if (!importData) return;
    try {
      setImportStep('importing');
      const tournaments = appData?.tournaments ?? [];
      const tMap: Record<string, string> = {};
      for (const tourney of tournaments) {
        tMap[tourney.name?.toLowerCase()] = tourney.id;
      }
      // Normalized-category keys: two genuine same-day, same-amount expenses in
      // different categories aren't dropped, and re-importing our own export
      // (labels like "Meals" vs stored "food") self-dedupes.
      const existingKeys = new Set<string>(
        (appData?.expenses ?? []).map((e: any) => expenseDupeKey(e.date, e.amount, e.category ?? '')),
      );
      const count = await insertExpenses(importData.mapped, tMap, { tournaments, existingKeys });
      const skipped = importData.mapped.length - count;
      await queryClient.invalidateQueries({ queryKey: ['expenses'] });
      await queryClient.invalidateQueries({ queryKey: ['tournaments'] });
      const unreadable = importData.unmapped > 0
        ? ` ${importData.unmapped} row${importData.unmapped !== 1 ? 's' : ''} could not be read (missing/invalid amount).`
        : '';
      showAlert(
        t('settings.importComplete'),
        `${count} expenses imported successfully.${skipped > 0 ? ` ${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped.` : ''}${unreadable}`,
      );
      setImportStep('idle');
      setImportData(null);
    } catch (err: any) {
      showAlert(t('settings.importError'), err?.message ?? 'Could not save expenses.');
      setImportStep('preview');
    }
  }

  async function generateTaxReport(year: number) {
    const yearExpenses = (appData?.expenses ?? []).filter(
      (e: any) => String(e.date ?? '').slice(0, 4) === String(year) && !e.isReimbursed,
    );
    const yearTournaments = (appData?.tournaments ?? []).filter(
      (tourney: any) =>
        String(tourney.startDate ?? '').slice(0, 4) === String(year) &&
        tourney.isRegistered &&
        !tourney.isWithdrawn &&
        (((tourney.singlesPrizeMoney ?? 0) + (tourney.doublesPrizeMoney ?? 0)) || (tourney.prizeMoney ?? 0)) > 0,
    );
    if (yearExpenses.length === 0 && yearTournaments.length === 0) {
      showAlert(t('settings.taxReport'), t('settings.taxReportEmpty'));
      return;
    }
    setExporting(true);
    try {
      await exportTaxReportPdf(
        year,
        appData?.tournaments ?? [],
        appData?.expenses ?? [],
        profile?.full_name ?? undefined,
        lang,
      );
    } catch (e: any) {
      showAlert('Export failed', e?.message ?? t('settings.exportSeasonStatementFailed'));
    } finally {
      setExporting(false);
    }
  }

  function chooseTaxReportYear() {
    const currentYear = new Date().getFullYear();
    showAlert(t('settings.taxReport'), t('settings.taxReportChooseYear'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: String(currentYear - 1), onPress: () => generateTaxReport(currentYear - 1) },
      { text: String(currentYear), onPress: () => generateTaxReport(currentYear) },
    ]);
  }

  function reportProblem() {
    const version = Constants.expoConfig?.version ?? 'unknown';
    const subject = encodeURIComponent('Tourly beta feedback');
    const body = encodeURIComponent(`\n\n—\nApp version: ${version}\nPlatform: ${Platform.OS} ${Platform.Version}`);
    Linking.openURL(`mailto:diegoedjarry@gmail.com?subject=${subject}&body=${body}`)
      .catch(() => showAlert(t('settings.reportProblem'), 'diegoedjarry@gmail.com'));
  }

  function openEdit(field: EditField, currentValue: string) {
    setEditField(field);
    setEditValue(currentValue);
  }

  async function saveField(field: string, value: any) {
    await updateProfile.mutateAsync({ [field]: value });
  }

  async function saveAndClose(field: string, value: any) {
    await saveField(field, value);
    setEditField(null);
  }

  async function handleSignOut() {
    if (Platform.OS === 'web') {
      if (!window.confirm(t('settings.signOutConfirm'))) return;
      setSigningOut(true);
      try { await signOut(); } catch {}
      return;
    }
    showAlert(t('settings.signOut'), t('settings.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.signOut'),
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          try {
            await signOut();
          } catch {}
        },
      },
    ]);
  }

  async function handleDeleteAccount() {
    showAlert(
      'Delete Account',
      'This will permanently delete your account and all your data — tournaments, expenses, and insights. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete My Account',
          style: 'destructive',
          onPress: () => {
            showAlert(
              'Are you sure?',
              'Type DELETE to confirm. All your data will be gone forever.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Yes, Delete Everything',
                  style: 'destructive',
                  onPress: async () => {
                    setDeletingAccount(true);
                    try {
                      const { supabase: sb } = await import('@/lib/supabase');
                      const { error } = await sb.rpc('delete_user_account');
                      if (error) throw error;
                      await signOut();
                    } catch (err: any) {
                      setDeletingAccount(false);
                      showAlert('Error', err?.message ?? 'Could not delete account. Please contact support.');
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }

  async function toggleNotif(field: string, value: boolean) {
    await saveField(field, value);
  }


  const p = profile as Profile | null;
  const notifyEnabled = p?.notify_enabled ?? true;
  const reminderConfig: ReminderConfig = p?.notify_reminder_config ?? DEFAULT_REMINDER_CONFIG;
  const onsiteEnabled = p?.notify_onsite_enabled ?? true;
  const onsiteReminders: (OnsiteReminderTime | null)[] = p?.notify_onsite_reminders ?? DEFAULT_ONSITE_REMINDERS;
  function updateReminderConfig(cfg: ReminderConfig) {
    saveField('notify_reminder_config', cfg);
  }

  if (isLoading) {
    return (
      <SafeAreaView style={s.safe}>
        <ActivityIndicator color={T.teal} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={s.backBtn}>
          <Text style={s.backText}>{t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t('settings.title')}</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ── PROFILE ── */}
        <AccordionHeader label={t('settings.profile')} open={openSection === 'profile'} onPress={() => toggleSection('profile')} />
        {openSection === 'profile' && <View style={s.card}>
          <SettingsRow
            label={t('settings.profilePhoto')}
            value=""
            onPress={() => showAlert(t('common.comingSoon'), t('settings.photoComingSoon'))}
            trailing={<View style={s.avatarCircle}><Text style={s.avatarEmoji}>📷</Text></View>}
          />
          <Sep />
          <SettingsRow
            label={t('settings.fullName')}
            value={p?.full_name ?? ''}
            onPress={() => openEdit('full_name', p?.full_name ?? '')}
          />
          <Sep />
          <SettingsRow
            label={t('settings.nationality')}
            value={p?.nationality ? `${FLAG[p.nationality] ?? '🌍'} ${p.nationality}` : ''}
            onPress={() => openEdit('nationality', p?.nationality ?? '')}
          />
          <Sep />
          <SettingsRow
            label={t('settings.homeCity')}
            value={p?.home_city ?? ''}
            onPress={() => openEdit('home_city', p?.home_city ?? '')}
          />
          <Sep />
          <SettingsRow
            label={t('settings.dateOfBirth')}
            value={p?.date_of_birth ? formatDate(p.date_of_birth) : ''}
            onPress={() => openEdit('date_of_birth', p?.date_of_birth ?? '')}
          />
          <Sep />
          <SettingsRow
            label={t('settings.ranking')}
            value={p?.ranking ? `#${p.ranking}` : ''}
            onPress={() => openEdit('ranking', p?.ranking?.toString() ?? '')}
          />
          <Sep />
          <SettingsRow
            label={t('settings.role')}
            value={p?.role ?? ''}
            onPress={() => openEdit('role', p?.role ?? 'Player')}
          />
          <Sep />
          <SettingsRow
            label={t('settings.primarySurface')}
            value={p?.primary_surface ? capitalize(p.primary_surface) : ''}
            onPress={() => openEdit('primary_surface', p?.primary_surface ?? '')}
          />
          <Sep />
          <SettingsRow
            label={t('settings.annualBudget')}
            value={p?.annual_budget ? `$${p.annual_budget.toLocaleString()}` : ''}
            onPress={() => openEdit('annual_budget', p?.annual_budget?.toString() ?? '')}
          />
          <Sep />
          <SettingsRow
            label={t('settings.travelWithCoach')}
            value={p?.travel_with_coach ?? ''}
            onPress={() => openEdit('travel_with_coach', p?.travel_with_coach ?? '')}
          />
          <Sep />
          <SettingsRow
            label={t('settings.travelWithStringing')}
            value={p?.travel_with_stringing ?? ''}
            onPress={() => openEdit('travel_with_stringing', p?.travel_with_stringing ?? '')}
          />
        </View>}

        {/* ── IPIN ITF ── */}
        <AccordionHeader label={t('settings.ipinSection')} open={openSection === 'ipin'} onPress={() => toggleSection('ipin')} />
        {openSection === 'ipin' && <View style={s.card}>
          <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
            <Text style={s.rowLabel}>{t('settings.ipinLabel')}</Text>
            <Text style={{ fontSize: 12, color: T.textSecondary, marginTop: 4, marginBottom: 12, lineHeight: 17 }}>
              {t('settings.ipinSubtitle')}
            </Text>
            <TextInput
              style={[s.modalInput, { marginBottom: 10 }]}
              keyboardType="default"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t('settings.ipinPlaceholder')}
              placeholderTextColor={T.textSecondary}
              value={ipinInput}
              onChangeText={setIpinInput}
            />
            <TouchableOpacity
              style={[s.modalSave, { marginBottom: 10 }]}
              activeOpacity={0.8}
              onPress={() => saveField('ipin_number', ipinInput.trim() || null)}>
              <Text style={s.modalSaveText}>{t('settings.ipinSave')}</Text>
            </TouchableOpacity>
            {!!p?.ipin_number && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
                <Text style={{ fontSize: 16, color: '#2D9E6B' }}>✓</Text>
                <Text style={{ fontSize: 13, color: '#2D9E6B', fontWeight: '600', flex: 1 }}>
                  {t('settings.ipinConnected')}
                </Text>
              </View>
            )}
          </View>
        </View>}
        {openSection === 'ipin' && <View style={{ backgroundColor: T.card, borderRadius: 10, padding: 12, marginTop: 4 }}>
          <Text style={{ fontSize: 12, color: T.textTertiary, lineHeight: 17 }}>
            {t('settings.ipinInfoCard')}
          </Text>
        </View>}

        {/* ── NOTIFICATIONS ── */}
        <AccordionHeader label={t('settings.notifications')} open={openSection === 'notif'} onPress={() => toggleSection('notif')} />
        {openSection === 'notif' && <View style={s.card}>
          <View style={s.row}>
            <Text style={s.rowLabel}>{t('settings.pushNotifications')}</Text>
            <Switch
              value={notifyEnabled}
              onValueChange={v => toggleNotif('notify_enabled', v)}
              trackColor={{ false: T.cardBorder, true: T.teal }}
              thumbColor={T.textPrimary}
            />
          </View>

          {notifyEnabled && (
            <>
              <Sep />
              <ReminderSection
                title={t('settings.singlesEntry')}
                times={reminderConfig.singles}
                onChange={times => updateReminderConfig({ ...reminderConfig, singles: times })}
              />
              <Sep />
              <ReminderSection
                title={t('settings.withdrawalDeadline')}
                times={reminderConfig.withdrawal}
                onChange={times => updateReminderConfig({ ...reminderConfig, withdrawal: times })}
              />
              <Sep />
              <ReminderSection
                title={t('settings.freezeDoublesDeadline')}
                times={reminderConfig.freeze}
                onChange={times => updateReminderConfig({ ...reminderConfig, freeze: times })}
              />
              <Sep />
              <OnsiteReminderSection
                enabled={onsiteEnabled}
                onToggle={v => saveField('notify_onsite_enabled', v)}
                times={onsiteReminders}
                onChange={times => saveField('notify_onsite_reminders', times)}
              />
            </>
          )}
        </View>}

        {/* ── PRIVACY & DATA ── */}
        <AccordionHeader label={t('settings.exportData')} open={openSection === 'export'} onPress={() => toggleSection('export')} />
        {openSection === 'export' && <View style={s.card}>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>{t('settings.shareAnonymizedCostData')}</Text>
              <Text style={{ fontSize: 12, color: T.textSecondary, marginTop: 4, lineHeight: 17 }}>
                {t('settings.shareAnonymizedCostDataDesc')}
              </Text>
            </View>
            <Switch
              value={p?.share_expense_data ?? false}
              onValueChange={v => toggleNotif('share_expense_data', v)}
              trackColor={{ false: T.cardBorder, true: T.teal }}
              thumbColor={T.textPrimary}
              style={{ marginLeft: 12 }}
            />
          </View>
          <Sep />
          <TouchableOpacity
            style={s.row}
            activeOpacity={0.6}
            disabled={exporting}
            onPress={async () => {
              setExporting(true);
              try { await exportAllCsv(appData?.tournaments ?? [], appData?.expenses ?? []); } catch (e: any) { showAlert('Export failed', e?.message ?? 'Could not export data.'); } finally { setExporting(false); }
            }}>
            <Text style={s.rowLabel}>{t('settings.exportAll')}</Text>
            <View style={s.rowRight}>
              {exporting ? <ActivityIndicator size="small" color={T.teal} /> : <Text style={s.rowArrow}>›</Text>}
            </View>
          </TouchableOpacity>
          <Sep />
          <TouchableOpacity
            style={s.row}
            activeOpacity={0.6}
            onPress={async () => {
              try { await exportTournamentsCsv(appData?.tournaments ?? []); } catch (e: any) { showAlert('Export failed', e?.message ?? 'Could not export tournaments.'); }
            }}>
            <Text style={s.rowLabel}>{t('settings.exportTournaments')}</Text>
            <View style={s.rowRight}><Text style={s.rowArrow}>›</Text></View>
          </TouchableOpacity>
          <Sep />
          <TouchableOpacity
            style={s.row}
            activeOpacity={0.6}
            onPress={async () => {
              try { await exportExpensesCsv(appData?.expenses ?? [], appData?.tournaments ?? []); } catch (e: any) { showAlert('Export failed', e?.message ?? 'Could not export expenses.'); }
            }}>
            <Text style={s.rowLabel}>{t('settings.exportExpenses')}</Text>
            <View style={s.rowRight}><Text style={s.rowArrow}>›</Text></View>
          </TouchableOpacity>
          <Sep />
          <TouchableOpacity
            style={s.row}
            activeOpacity={0.6}
            disabled={exporting}
            onPress={async () => {
              setExporting(true);
              try {
                await exportSeasonStatementPdf(
                  new Date().getFullYear(),
                  appData?.tournaments ?? [],
                  appData?.expenses ?? [],
                  profile?.full_name ?? undefined,
                  lang,
                );
              } catch (e: any) {
                showAlert('Export failed', e?.message ?? t('settings.exportSeasonStatementFailed'));
              } finally {
                setExporting(false);
              }
            }}>
            <Text style={s.rowLabel}>{t('settings.exportSeasonStatement')}</Text>
            <View style={s.rowRight}>
              {exporting ? <ActivityIndicator size="small" color={T.teal} /> : <Text style={s.rowArrow}>›</Text>}
            </View>
          </TouchableOpacity>
          <Sep />
          <TouchableOpacity
            style={s.row}
            activeOpacity={0.6}
            disabled={exporting}
            onPress={chooseTaxReportYear}>
            <Text style={s.rowLabel}>{t('settings.taxReport')}</Text>
            <View style={s.rowRight}>
              {exporting ? <ActivityIndicator size="small" color={T.teal} /> : <Text style={s.rowArrow}>›</Text>}
            </View>
          </TouchableOpacity>
        </View>}

        {/* ── IMPORT DATA ── */}
        <AccordionHeader label={t('settings.importData')} open={openSection === 'import'} onPress={() => toggleSection('import')} />
        {openSection === 'import' && <View style={s.card}>
          <TouchableOpacity
            style={s.row}
            activeOpacity={0.6}
            disabled={importStep !== 'idle'}
            onPress={handleImport}>
            <Text style={[s.rowLabel, { color: T.teal }]}>
              {importStep === 'loading' ? t('settings.readingFile') : t('settings.importExpensesFile')}
            </Text>
            <View style={s.rowRight}>
              {importStep === 'loading' ? (
                <ActivityIndicator size="small" color={T.teal} />
              ) : (
                <Text style={s.rowArrow}>›</Text>
              )}
            </View>
          </TouchableOpacity>
          <Sep />
          <TouchableOpacity
            style={s.row}
            activeOpacity={0.6}
            onPress={() => { setNotesText(''); setParsedNotes([]); setShowPasteNotes(true); }}>
            <Text style={[s.rowLabel, { color: T.teal }]}>{t('settings.pasteNotes')}</Text>
            <View style={s.rowRight}><Text style={s.rowArrow}>›</Text></View>
          </TouchableOpacity>
          <Sep />
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <Text style={{ fontSize: 13, color: T.textSecondary, lineHeight: 18 }}>
              {t('settings.importHint')}
            </Text>
          </View>
        </View>}

        {/* ── SUPPORT ── */}
        <AccordionHeader label={t('settings.support')} open={openSection === 'support'} onPress={() => toggleSection('support')} />
        {openSection === 'support' && <View style={s.card}>
          <TouchableOpacity style={s.row} activeOpacity={0.6} onPress={reportProblem}>
            <Text style={[s.rowLabel, { color: T.teal }]}>{t('settings.reportProblem')}</Text>
            <View style={s.rowRight}><Text style={s.rowArrow}>›</Text></View>
          </TouchableOpacity>
          <Sep />
          <TouchableOpacity
            style={s.row}
            activeOpacity={0.6}
            onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.privacyPolicy')}
          >
            <Text style={[s.rowLabel, { color: T.teal }]}>{t('settings.privacyPolicy')}</Text>
            <View style={s.rowRight}><Text style={s.rowArrow}>›</Text></View>
          </TouchableOpacity>
        </View>}

        {/* ── SHARED ACCESS ── */}
        {!DEMO_MODE && (
          <>
            <AccordionHeader label={t('settings.sharedAccess')} open={openSection === 'shared'} onPress={() => toggleSection('shared')} />
            {openSection === 'shared' && <View style={s.card}>
              <TouchableOpacity style={s.row} activeOpacity={0.6} onPress={() => setShowInvite(true)}>
                <Text style={[s.rowLabel, { color: T.teal }]}>{t('settings.inviteCoachAgent')}</Text>
                <View style={s.rowRight}><Text style={s.rowArrow}>›</Text></View>
              </TouchableOpacity>
              {(shares ?? []).map((share, i) => (
                <React.Fragment key={share.id}>
                  <Sep />
                  <View style={s.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowLabel}>{share.shared_with_email}</Text>
                      <Text style={{ fontSize: 12, color: share.status === 'accepted' ? T.green : T.clayText, marginTop: 2 }}>
                        {share.status === 'accepted' ? t('settings.active') : t('settings.pending')}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => {
                        showAlert(t('settings.removeAccess'), t('settings.removeAccessConfirm'), [
                          { text: t('common.cancel'), style: 'cancel' },
                          { text: t('settings.remove'), style: 'destructive', onPress: () => revokeShare.mutate(share.id) },
                        ]);
                      }}
                      activeOpacity={0.7}>
                      <Text style={{ fontSize: 14, color: T.red, fontWeight: '600' }}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </React.Fragment>
              ))}
            </View>}
          </>
        )}

        {/* ── DATA & SCRAPER ── */}
        <AccordionHeader label={t('settings.dataScraper')} open={openSection === 'scraper'} onPress={() => toggleSection('scraper')} />
        {openSection === 'scraper' && <View style={s.card}>
          <View style={s.row}>
            <Text style={s.rowLabel}>{t('settings.scraperStatus')}</Text>
            <View style={s.rowRight}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: T.teal, marginRight: 4 }} />
              <Text style={[s.rowValue, { color: T.teal }]}>{t('settings.scraperAuto')}</Text>
            </View>
          </View>
          <Sep />
          <View style={s.row}>
            <Text style={s.rowLabel}>{t('settings.lastScraperRun')}</Text>
            <View style={s.rowRight}>
              {scraperLastRun?.finished_at && (
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    marginRight: 6,
                    backgroundColor: scraperLastRun.status === 'error' ? T.red : T.green,
                  }}
                />
              )}
              <Text style={s.rowValue}>
                {scraperLastRun?.finished_at ? formatRelative(scraperLastRun.finished_at, lang) : '—'}
              </Text>
            </View>
          </View>
          <Sep />
          <View style={s.row}>
            <Text style={s.rowLabel}>{t('settings.autoImported')}</Text>
            <View style={s.rowRight}>
              <Text style={s.rowValue}>{t('settings.autoImportedCount')}</Text>
            </View>
          </View>
          <Sep />
          <View style={s.row}>
            <Text style={s.rowLabel}>{t('settings.notifyNewTournaments')}</Text>
            <View style={s.rowRight}>
              <Switch
                value={p?.notify_new_tournaments ?? false}
                disabled={DEMO_MODE}
                onValueChange={v => { if (!DEMO_MODE) toggleNotif('notify_new_tournaments', v); }}
                trackColor={{ false: T.cardBorder, true: T.teal }}
                thumbColor={T.textPrimary}
              />
            </View>
          </View>
          <Sep />
          <View style={s.row}>
            <Text style={s.rowLabel}>{t('settings.preferredRegions')}</Text>
            <View style={s.rowRight}>
              <Text style={s.rowValue}>{t('settings.southAmerica')}</Text>
              <Text style={s.rowArrow}>›</Text>
            </View>
          </View>
        </View>}

        {/* ── LANGUAGE ── */}
        <AccordionHeader label={t('settings.language')} open={openSection === 'lang'} onPress={() => toggleSection('lang')} />
        {openSection === 'lang' && <View style={s.card}>
          <SettingsRow
            label={t('settings.appLanguage')}
            value=""
            onPress={() => openEdit('language', p?.language ?? 'en')}
            trailing={
              <>
                <Text style={s.rowValue} numberOfLines={1}>
                  {LANGUAGES.find(l => l.key === (p?.language ?? 'en'))?.flag ?? '🇺🇸'}{' '}
                  {LANGUAGES.find(l => l.key === (p?.language ?? 'en'))?.label ?? 'English'}
                </Text>
                <Text style={s.rowArrow}>›</Text>
              </>
            }
          />
        </View>}

        {/* ── ACCOUNT ── */}
        <AccordionHeader label={t('settings.account')} open={openSection === 'account'} onPress={() => toggleSection('account')} />
        {openSection === 'account' && <View style={s.card}>
          {DEMO_MODE ? (
            <View style={s.row}>
              <Text style={s.rowLabel}>{t('settings.demoMode')}</Text>
              <View style={s.rowRight}>
                <Text style={s.rowValue}>{t('settings.noAccountNeeded')}</Text>
              </View>
            </View>
          ) : (
            <>
              <View style={s.row}>
                <Text style={s.rowLabel}>{t('common.email')}</Text>
                <View style={s.rowRight}>
                  <Text style={s.rowValue} numberOfLines={1}>{user?.email ?? t('common.notSet')}</Text>
                </View>
              </View>
              <Sep />
              <TouchableOpacity style={s.row} activeOpacity={0.6} onPress={() => { setNewEmail(user?.email ?? ''); setShowChangeEmail(true); }}>
                <Text style={s.rowLabel}>{t('settings.changeEmail')}</Text>
                <View style={s.rowRight}><Text style={s.rowArrow}>›</Text></View>
              </TouchableOpacity>
              <Sep />
              <TouchableOpacity style={s.row} activeOpacity={0.6} onPress={() => { setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setShowChangePassword(true); }}>
                <Text style={s.rowLabel}>{t('settings.changePassword')}</Text>
                <View style={s.rowRight}><Text style={s.rowArrow}>›</Text></View>
              </TouchableOpacity>
              <Sep />
              <TouchableOpacity style={s.row} activeOpacity={0.6} onPress={handleSignOut} disabled={signingOut}>
                {signingOut ? (
                  <ActivityIndicator color={T.red} size="small" />
                ) : (
                  <Text style={[s.rowLabel, { color: T.red }]}>{t('settings.signOut')}</Text>
                )}
              </TouchableOpacity>
              <Sep />
              <TouchableOpacity style={s.row} activeOpacity={0.6} onPress={handleDeleteAccount} disabled={deletingAccount}>
                {deletingAccount ? (
                  <ActivityIndicator color={T.red} size="small" />
                ) : (
                  <Text style={[s.rowLabel, { color: T.red, opacity: 0.7 }]}>{t('settings.deleteAccount')}</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>}

        <Text style={s.versionFooter}>{t('settings.versionLabel')}{Constants.expoConfig?.version ?? '—'}</Text>
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── EDIT MODALS ── */}
      <EditTextModal
        visible={editField === 'full_name'}
        title={t('settings.fullName')}
        value={editValue}
        onChange={setEditValue}
        onSave={() => {
          if (!editValue.trim()) {
            showAlert('Error', 'Name cannot be empty.');
            return;
          }
          saveAndClose('full_name', editValue.trim());
        }}
        onClose={() => setEditField(null)}
        autoCapitalize="words"
      />
      <EditTextModal
        visible={editField === 'home_city'}
        title={t('settings.homeCity')}
        value={editValue}
        onChange={setEditValue}
        onSave={() => saveAndClose('home_city', editValue.trim() || null)}
        onClose={() => setEditField(null)}
        autoCapitalize="words"
      />
      <EditTextModal
        visible={editField === 'ranking'}
        title={t('settings.ranking')}
        value={editValue}
        onChange={setEditValue}
        onSave={() => {
          if (!editValue.trim()) { saveAndClose('ranking', null); return; }
          const cleaned = editValue.replace(/[.,]/g, ''); // strip thousands separators
          const parsed = parseInt(cleaned, 10);
          if (!Number.isFinite(parsed) || parsed < 0) {
            showAlert('Error', 'Enter a valid ranking (a positive whole number).');
            return;
          }
          saveAndClose('ranking', parsed);
        }}
        onClose={() => setEditField(null)}
        keyboardType="number-pad"
        placeholder="ex. 450"
      />
      <EditTextModal
        visible={editField === 'annual_budget'}
        title={t('settings.annualBudget')}
        value={editValue}
        onChange={setEditValue}
        onSave={() => {
          if (!editValue.trim()) { saveAndClose('annual_budget', null); return; }
          const cleaned = editValue.replace(/[.,]/g, ''); // strip thousands separators
          const parsed = parseInt(cleaned, 10);
          if (!Number.isFinite(parsed) || parsed < 0) {
            showAlert('Error', 'Enter a valid budget (a positive whole number).');
            return;
          }
          saveAndClose('annual_budget', parsed);
        }}
        onClose={() => setEditField(null)}
        keyboardType="number-pad"
        placeholder="ex. 25000"
      />

      {/* Nationality picker */}
      <PillPickerModal
        visible={editField === 'nationality'}
        title={t('settings.nationality')}
        options={COUNTRIES}
        renderLabel={c => `${FLAG[c] ?? '🌍'} ${c}`}
        selected={editValue}
        onSelect={v => { saveAndClose('nationality', v || null); }}
        onClose={() => setEditField(null)}
        allowDeselect
      />

      {/* Role picker */}
      <PillPickerModal
        visible={editField === 'role'}
        title={t('settings.role')}
        options={ROLES}
        selected={editValue}
        onSelect={v => saveAndClose('role', v)}
        onClose={() => setEditField(null)}
      />

      {/* Surface picker */}
      <PillPickerModal
        visible={editField === 'primary_surface'}
        title={t('settings.primarySurface')}
        options={SURFACES.map(sf => sf.key)}
        renderLabel={k => capitalize(k)}
        selected={editValue}
        onSelect={v => saveAndClose('primary_surface', v || null)}
        onClose={() => setEditField(null)}
        allowDeselect
      />

      {/* Travel with coach */}
      <PillPickerModal
        visible={editField === 'travel_with_coach'}
        title={t('settings.travelWithCoach')}
        options={COACH_OPTIONS}
        selected={editValue}
        onSelect={v => saveAndClose('travel_with_coach', v || null)}
        onClose={() => setEditField(null)}
        allowDeselect
      />

      {/* Travel with stringing machine */}
      <PillPickerModal
        visible={editField === 'travel_with_stringing'}
        title={t('settings.travelWithStringing')}
        options={YES_NO}
        selected={editValue}
        onSelect={v => saveAndClose('travel_with_stringing', v || null)}
        onClose={() => setEditField(null)}
        allowDeselect
      />

      {/* Language picker */}
      <PillPickerModal
        visible={editField === 'language'}
        title={t('settings.appLanguage')}
        options={LANGUAGES.map(l => l.key)}
        renderLabel={k => `${LANGUAGES.find(l => l.key === k)?.flag ?? ''} ${LANGUAGES.find(l => l.key === k)?.label ?? k}`}
        selected={editValue}
        onSelect={async v => {
          const lang = (v || 'en') as Lang;
          await setLanguage(lang);
          try {
            await updateProfile.mutateAsync({ language: lang } as any);
          } catch {}
          setEditField(null);
        }}
        onClose={() => setEditField(null)}
      />

      {/* Date of birth */}
      {editField === 'date_of_birth' && (
        <Modal transparent animationType="slide" visible onRequestClose={() => setEditField(null)}>
          <View style={s.modalOverlay}>
            <View style={s.modalCard}>
              <Text style={s.modalTitle}>{t('settings.dateOfBirth')}</Text>
              <DatePickerField value={editValue} onChange={v => { saveAndClose('date_of_birth', v || null); }} placeholder="Select date" lang={lang} />
              <TouchableOpacity style={s.modalCancel} onPress={() => setEditField(null)}>
                <Text style={s.modalCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Invite share modal */}
      {showInvite && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setShowInvite(false)}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <View style={s.modalOverlay}>
            <View style={s.modalCard}>
              <Text style={s.modalTitle}>Invite Coach / Agent</Text>
              <Text style={{ fontSize: 14, color: T.textSecondary, textAlign: 'center', marginBottom: 16 }}>
                They&apos;ll get read-only access to your tournaments and expenses.
              </Text>
              <TextInput
                style={s.modalInput}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                placeholder="Email address"
                placeholderTextColor={T.textSecondary}
                autoCapitalize="none"
                keyboardType="email-address"
                autoFocus
              />
              <View style={s.modalBtnRow}>
                <TouchableOpacity style={s.modalCancel} onPress={() => { setShowInvite(false); setInviteEmail(''); }}>
                  <Text style={s.modalCancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.modalSave, inviteShare.isPending && { opacity: 0.5 }]}
                  disabled={inviteShare.isPending || !inviteEmail.includes('@')}
                  onPress={async () => {
                    await inviteShare.mutateAsync(inviteEmail);
                    setShowInvite(false);
                    setInviteEmail('');
                    showAlert('Invite sent', `${inviteEmail} can now accept your invite.`);
                  }}>
                  {inviteShare.isPending ? (
                    <ActivityIndicator color={T.textPrimary} size="small" />
                  ) : (
                    <Text style={s.modalSaveText}>Send Invite</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {/* Change email modal */}
      {showChangeEmail && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setShowChangeEmail(false)}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <View style={s.modalOverlay}>
            <View style={s.modalCard}>
              <Text style={s.modalTitle}>Change Email</Text>
              <Text style={s.accountHint}>A confirmation link will be sent to your new email address.</Text>
              <TextInput
                style={s.modalInput}
                value={newEmail}
                onChangeText={setNewEmail}
                placeholder="New email address"
                placeholderTextColor={T.textSecondary}
                autoCapitalize="none"
                keyboardType="email-address"
                autoFocus
              />
              <View style={s.modalBtnRow}>
                <TouchableOpacity style={s.modalCancel} onPress={() => setShowChangeEmail(false)}>
                  <Text style={s.modalCancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.modalSave, accountLoading && { opacity: 0.5 }]}
                  disabled={accountLoading || !newEmail.includes('@')}
                  onPress={async () => {
                    setAccountLoading(true);
                    try {
                      await updateEmail(newEmail.trim());
                      setShowChangeEmail(false);
                      showAlert('Check your inbox', 'We sent a confirmation link to your new email. Click it to finalize the change.');
                    } catch (err: any) {
                      showAlert('Error', err?.message ?? 'Could not update email.');
                    } finally {
                      setAccountLoading(false);
                    }
                  }}>
                  {accountLoading ? (
                    <ActivityIndicator color={T.textPrimary} size="small" />
                  ) : (
                    <Text style={s.modalSaveText}>Update</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {/* Import preview modal */}
      {(importStep === 'preview' || importStep === 'importing') && importData && (
        <Modal transparent animationType="slide" visible onRequestClose={() => { setImportStep('idle'); setImportData(null); }}>
          <View style={s.modalOverlay}>
            <View style={[s.modalCard, { maxHeight: '80%' }]}>
              <Text style={s.modalTitle}>Import Preview</Text>
              <Text style={{ fontSize: 13, color: T.textSecondary, textAlign: 'center', marginBottom: 4 }}>
                {importFileName}
              </Text>
              <Text style={{ fontSize: 15, color: T.textPrimary, textAlign: 'center', fontWeight: '600', marginBottom: 4 }}>
                {importData.mapped.length} expenses found
              </Text>
              <Text style={{ fontSize: 12, color: T.textSecondary, textAlign: 'center', marginBottom: 4 }}>
                {t('expense.usdNote')}
              </Text>
              {importData.unmapped > 0 && (
                <Text style={{ fontSize: 13, color: T.clayText, textAlign: 'center', marginBottom: 8 }}>
                  {importData.unmapped} rows skipped (missing amount, negative/credit, or no date)
                </Text>
              )}
              {importData.likelyDuplicate && (
                <View style={{ backgroundColor: 'rgba(184,137,42,0.15)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                  <Text style={{ fontSize: 13, color: '#B8892A', textAlign: 'center', fontWeight: '600' }}>
                    ⚠ This file looks like it may have already been imported.
                  </Text>
                  <Text style={{ fontSize: 12, color: '#B8892A', textAlign: 'center', marginTop: 2 }}>
                    Importing again will create duplicate expenses.
                  </Text>
                </View>
              )}
              <ScrollView style={{ maxHeight: 300, marginBottom: 16 }} showsVerticalScrollIndicator>
                {importData.mapped.slice(0, 20).map((e, i) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: T.cardBorder }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, color: T.textPrimary, fontWeight: '500' }}>{e.category}</Text>
                      <Text style={{ fontSize: 12, color: T.textSecondary }}>{e.date}{e.note ? ` — ${e.note}` : ''}</Text>
                      {e.tournament_name && <Text style={{ fontSize: 11, color: T.teal }}>{e.tournament_name}</Text>}
                    </View>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: T.textPrimary }}>
                      {e.currency && e.currency !== 'USD' ? `${e.amount} ${e.currency}` : `$${e.amount.toFixed(2)}`}
                    </Text>
                  </View>
                ))}
                {importData.mapped.length > 20 && (
                  <Text style={{ fontSize: 13, color: T.textSecondary, textAlign: 'center', paddingTop: 8 }}>
                    +{importData.mapped.length - 20} more...
                  </Text>
                )}
              </ScrollView>
              <View style={s.modalBtnRow}>
                <TouchableOpacity style={s.modalCancel} onPress={() => { setImportStep('idle'); setImportData(null); }}>
                  <Text style={s.modalCancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.modalSave, importStep === 'importing' && { opacity: 0.5 }]}
                  disabled={importStep === 'importing'}
                  onPress={confirmImport}>
                  {importStep === 'importing' ? (
                    <ActivityIndicator color={T.textPrimary} size="small" />
                  ) : (
                    <Text style={s.modalSaveText}>Import All</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Paste notes modal */}
      {showPasteNotes && (
        <Modal transparent animationType="slide" visible onRequestClose={() => setShowPasteNotes(false)}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <View style={s.modalOverlay}>
            <View style={[s.modalCard, { maxHeight: '85%' }]}>
              <Text style={s.modalTitle}>{parsedNotes.length > 0 ? 'Preview' : 'Paste Your Notes'}</Text>

              {parsedNotes.length === 0 ? (
                <>
                  <Text style={{ fontSize: 13, color: T.textSecondary, textAlign: 'center', marginBottom: 12 }}>
                    Paste any text with expenses — the app will find amounts, dates, and categories automatically.
                  </Text>
                  <TextInput
                    style={[s.modalInput, { height: 180, textAlignVertical: 'top' }]}
                    value={notesText}
                    onChangeText={setNotesText}
                    placeholder={"Flight to Buenos Aires $350\nHotel 3 nights $450\nMeals $120"}
                    placeholderTextColor={T.textSecondary}
                    multiline
                    autoFocus
                  />
                  <View style={s.modalBtnRow}>
                    <TouchableOpacity style={s.modalCancel} onPress={() => setShowPasteNotes(false)}>
                      <Text style={s.modalCancelText}>{t('common.cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.modalSave, !notesText.trim() && { opacity: 0.5 }]}
                      disabled={!notesText.trim()}
                      onPress={() => {
                        const results = parseNotes(notesText);
                        if (results.length === 0) {
                          showAlert('No expenses found', 'Could not find any amounts in your text. Make sure each expense has a dollar amount (ex. "$350" or "350 USD").');
                          return;
                        }
                        setParsedNotes(results);
                      }}>
                      <Text style={s.modalSaveText}>Parse</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <Text style={{ fontSize: 15, color: T.textPrimary, textAlign: 'center', fontWeight: '600', marginBottom: 8 }}>
                    {parsedNotes.length} expenses found
                  </Text>
                  <ScrollView style={{ maxHeight: 300, marginBottom: 16 }} showsVerticalScrollIndicator>
                    {parsedNotes.map((e, i) => (
                      <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: T.cardBorder }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, color: T.textPrimary, fontWeight: '500' }}>{e.category}</Text>
                          <Text style={{ fontSize: 12, color: T.textSecondary }}>{e.date ?? 'No date'} — {e.description}</Text>
                        </View>
                        <Text style={{ fontSize: 15, fontWeight: '600', color: T.textPrimary }}>
                          {e.currency && e.currency !== 'USD' ? `${e.amount} ${e.currency}` : `$${e.amount.toFixed(2)}`}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                  <View style={s.modalBtnRow}>
                    <TouchableOpacity style={s.modalCancel} onPress={() => setParsedNotes([])} disabled={pasteImporting}>
                      <Text style={s.modalCancelText}>{t('common.back')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.modalSave, pasteImporting && { opacity: 0.5 }]}
                      disabled={pasteImporting}
                      onPress={async () => {
                        if (pasteImporting) return; // guard against double-tap re-firing the import
                        setPasteImporting(true);
                        try {
                          const mapped = parsedNotes.map(e => ({
                            category: e.category,
                            amount: e.amount,
                            currency: e.currency,
                            date: e.date ?? new Date().toISOString().split('T')[0],
                            note: e.description || null,
                            tournament_name: null,
                          }));
                          const tournaments = appData?.tournaments ?? [];
                          const tMap: Record<string, string> = {};
                          for (const tourney of tournaments) { tMap[tourney.name?.toLowerCase()] = tourney.id; }
                          // Must be expenseDupeKey format — insertExpenses compares
                          // against it; a mismatched key format disables dedupe.
                          const existingKeys = new Set<string>(
                            (appData?.expenses ?? []).map((e: any) => expenseDupeKey(e.date, e.amount, e.category ?? '')),
                          );
                          const count = await insertExpenses(mapped, tMap, { tournaments, existingKeys });
                          const skipped = mapped.length - count;
                          await queryClient.invalidateQueries({ queryKey: ['expenses'] });
                          setShowPasteNotes(false);
                          setParsedNotes([]);
                          setNotesText('');
                          showAlert(
                            t('settings.importComplete'),
                            `${count} expenses imported.${skipped > 0 ? ` ${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped.` : ''}`,
                          );
                        } catch (err: any) {
                          showAlert('Error', err?.message ?? 'Could not save expenses.');
                        } finally {
                          setPasteImporting(false);
                        }
                      }}>
                      {pasteImporting ? (
                        <ActivityIndicator color={T.bg} size="small" />
                      ) : (
                        <Text style={s.modalSaveText}>Import All</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {/* Change password modal */}
      {showChangePassword && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setShowChangePassword(false)}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <View style={s.modalOverlay}>
            <View style={s.modalCard}>
              <Text style={s.modalTitle}>Change Password</Text>
              <TextInput
                style={s.modalInput}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="New password"
                placeholderTextColor={T.textSecondary}
                secureTextEntry
              />
              <TextInput
                style={s.modalInput}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Confirm new password"
                placeholderTextColor={T.textSecondary}
                secureTextEntry
              />
              <View style={s.modalBtnRow}>
                <TouchableOpacity style={s.modalCancel} onPress={() => setShowChangePassword(false)}>
                  <Text style={s.modalCancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.modalSave, accountLoading && { opacity: 0.5 }]}
                  disabled={accountLoading || newPassword.length < 6}
                  onPress={async () => {
                    if (newPassword !== confirmPassword) {
                      showAlert('Mismatch', 'Passwords do not match.');
                      return;
                    }
                    setAccountLoading(true);
                    try {
                      await updatePassword(newPassword);
                      setShowChangePassword(false);
                      showAlert('Done', 'Your password has been updated.');
                    } catch (err: any) {
                      showAlert('Error', err?.message ?? 'Could not update password.');
                    } finally {
                      setAccountLoading(false);
                    }
                  }}>
                  {accountLoading ? (
                    <ActivityIndicator color={T.textPrimary} size="small" />
                  ) : (
                    <Text style={s.modalSaveText}>Update</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
          </KeyboardAvoidingView>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function AccordionHeader({ label, open, onPress }: { label: string; open: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.accordionHeader} onPress={onPress} activeOpacity={0.7}>
      <Text style={s.accordionLabel}>{label}</Text>
      <Text style={s.accordionArrow}>{open ? '∨' : '›'}</Text>
    </TouchableOpacity>
  );
}

function SettingsRow({ label, value, onPress, trailing }: {
  label: string;
  value: string;
  onPress: () => void;
  trailing?: React.ReactNode;
}) {
  const { t: tr } = useLanguage();
  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={0.6}>
      <Text style={s.rowLabel}>{label}</Text>
      <View style={s.rowRight}>
        {trailing ?? (
          <>
            <Text style={s.rowValue} numberOfLines={1}>{value || tr('common.notSet')}</Text>
            <Text style={s.rowArrow}>›</Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

function Sep() {
  return <View style={s.sep} />;
}

function ReminderSection({ title, times, onChange }: {
  title: string;
  times: (ReminderTime | null)[];
  onChange: (t: (ReminderTime | null)[]) => void;
}) {
  const { t: tr } = useLanguage();
  const TIME_OPTIONS: { value: ReminderTime; label: string }[] = [
    { value: '7d', label: tr('settings.timeBefore.7d') },
    { value: '5d', label: tr('settings.timeBefore.5d') },
    { value: '3d', label: tr('settings.timeBefore.3d') },
    { value: '2d', label: tr('settings.timeBefore.2d') },
    { value: '1d', label: tr('settings.timeBefore.1d') },
    { value: '12h', label: tr('settings.timeBefore.12h') },
    { value: '6h', label: tr('settings.timeBefore.6h') },
    { value: '2h', label: tr('settings.timeBefore.2h') },
    { value: '30m', label: tr('settings.timeBefore.30m') },
  ];
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const slots = times.length >= 3 ? times : [...times, ...Array(3 - times.length).fill(null)].slice(0, 3);

  function toggle(idx: number) {
    const next = [...slots] as (ReminderTime | null)[];
    next[idx] = next[idx] !== null ? null : DEFAULT_SLOT_TIMES[idx];
    onChange(next);
  }

  function pickTime(idx: number, val: ReminderTime) {
    const next = [...slots] as (ReminderTime | null)[];
    next[idx] = val;
    onChange(next);
    setEditingSlot(null);
  }

  function timeLabel(value: string): string {
    return TIME_OPTIONS.find(o => o.value === value)?.label ?? value;
  }

  return (
    <View style={rs.section}>
      <Text style={rs.title}>{title.toUpperCase()}</Text>
      {slots.map((time, idx) => (
        <React.Fragment key={idx}>
          <View style={rs.row}>
            <TouchableOpacity onPress={() => toggle(idx)} style={rs.checkbox} activeOpacity={0.7}>
              <View style={[rs.box, time !== null && rs.boxChecked]}>
                {time !== null && <Text style={rs.check}>✓</Text>}
              </View>
            </TouchableOpacity>
            <Text style={rs.label}>Reminder {idx + 1}</Text>
            {time !== null && (
              <>
                <Text style={rs.timeText}> — {timeLabel(time)}</Text>
                <TouchableOpacity
                  onPress={() => setEditingSlot(editingSlot === idx ? null : idx)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={rs.editBtn}>{editingSlot === idx ? tr('common.done') : tr('common.edit')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
          {editingSlot === idx && time !== null && (
            <View style={rs.dropdown}>
              {TIME_OPTIONS.map(opt => (
                <TouchableOpacity key={opt.value} style={rs.option}
                  onPress={() => pickTime(idx, opt.value)} activeOpacity={0.7}>
                  <Text style={[rs.optionDot, time === opt.value && rs.optionDotActive]}>
                    {time === opt.value ? '●' : '○'}
                  </Text>
                  <Text style={[rs.optionText, time === opt.value && rs.optionTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </React.Fragment>
      ))}
    </View>
  );
}

function OnsiteReminderSection({ enabled, onToggle, times, onChange }: {
  enabled: boolean;
  onToggle: (v: boolean) => void;
  times: (OnsiteReminderTime | null)[];
  onChange: (t: (OnsiteReminderTime | null)[]) => void;
}) {
  const { t: tr } = useLanguage();
  const translatedOnsiteOptions: { value: OnsiteReminderTime; label: string }[] = [
    { value: '6h', label: tr('settings.timeBefore.6h') },
    { value: '5h', label: tr('settings.timeBefore.5h') },
    { value: '4h', label: tr('settings.timeBefore.4h') },
    { value: '3h', label: tr('settings.timeBefore.3h') },
    { value: '2h', label: tr('settings.timeBefore.2h') },
    { value: '1h', label: tr('settings.timeBefore.1h') },
    { value: '45m', label: tr('settings.timeBefore.45m') },
    { value: '30m', label: tr('settings.timeBefore.30m') },
    { value: '15m', label: tr('settings.timeBefore.15m') },
  ];
  function onsiteTimeLabelLocal(value: string): string {
    return translatedOnsiteOptions.find(o => o.value === value)?.label ?? value;
  }
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const slots = times.length >= 3 ? times : [...times, ...Array(3 - times.length).fill(null)].slice(0, 3);

  function toggle(idx: number) {
    const next = [...slots] as (OnsiteReminderTime | null)[];
    next[idx] = next[idx] !== null ? null : DEFAULT_ONSITE_SLOT_TIMES[idx];
    onChange(next);
  }

  function pickTime(idx: number, val: OnsiteReminderTime) {
    const next = [...slots] as (OnsiteReminderTime | null)[];
    next[idx] = val;
    onChange(next);
    setEditingSlot(null);
  }

  return (
    <View style={rs.section}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Text style={rs.title}>ON-SITE SIGN-INS</Text>
        <Switch
          value={enabled}
          onValueChange={onToggle}
          trackColor={{ false: T.cardBorder, true: T.teal }}
          thumbColor={T.textPrimary}
        />
      </View>
      {enabled && slots.map((time, idx) => (
        <React.Fragment key={idx}>
          <View style={rs.row}>
            <TouchableOpacity onPress={() => toggle(idx)} style={rs.checkbox} activeOpacity={0.7}>
              <View style={[rs.box, time !== null && rs.boxChecked]}>
                {time !== null && <Text style={rs.check}>✓</Text>}
              </View>
            </TouchableOpacity>
            <Text style={rs.label}>Reminder {idx + 1}</Text>
            {time !== null && (
              <>
                <Text style={rs.timeText}> — {onsiteTimeLabelLocal(time)}</Text>
                <TouchableOpacity
                  onPress={() => setEditingSlot(editingSlot === idx ? null : idx)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={rs.editBtn}>{editingSlot === idx ? tr('common.done') : tr('common.edit')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
          {editingSlot === idx && time !== null && (
            <View style={rs.dropdown}>
              {translatedOnsiteOptions.map(opt => (
                <TouchableOpacity key={opt.value} style={rs.option}
                  onPress={() => pickTime(idx, opt.value)} activeOpacity={0.7}>
                  <Text style={[rs.optionDot, time === opt.value && rs.optionDotActive]}>
                    {time === opt.value ? '●' : '○'}
                  </Text>
                  <Text style={[rs.optionText, time === opt.value && rs.optionTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </React.Fragment>
      ))}
    </View>
  );
}

const rs = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 11, fontWeight: '700', color: T.textTertiary, letterSpacing: 1, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  checkbox: { marginRight: 10 },
  box: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: T.cardBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  boxChecked: { borderColor: T.teal, backgroundColor: T.teal },
  check: { fontSize: 13, color: T.bg, fontWeight: '700', marginTop: -1 },
  label: { fontSize: 14, color: T.textPrimary, fontWeight: '500' },
  timeText: { fontSize: 14, color: T.textSecondary, flex: 1 },
  editBtn: { fontSize: 13, color: T.teal, fontWeight: '600', marginLeft: 8 },
  dropdown: {
    marginLeft: 32, marginBottom: 8, paddingVertical: 8,
    paddingHorizontal: 12, borderRadius: 12,
    backgroundColor: T.cardElevated, borderWidth: 1, borderColor: T.cardBorder,
  },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  optionDot: { fontSize: 14, color: T.textTertiary, width: 22 },
  optionDotActive: { color: T.teal },
  optionText: { fontSize: 14, color: T.textSecondary },
  optionTextActive: { color: T.textPrimary, fontWeight: '600' },
});

function EditTextModal({ visible, title, value, onChange, onSave, onClose, autoCapitalize, keyboardType, placeholder }: {
  visible: boolean;
  title: string;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
  autoCapitalize?: 'none' | 'words' | 'sentences';
  keyboardType?: 'default' | 'number-pad';
  placeholder?: string;
}) {
  const { t: tr } = useLanguage();
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <View style={s.modalOverlay}>
        <View style={s.modalCard}>
          <Text style={s.modalTitle}>{title}</Text>
          <TextInput
            style={s.modalInput}
            value={value}
            onChangeText={onChange}
            autoCapitalize={autoCapitalize}
            keyboardType={keyboardType}
            placeholder={placeholder}
            placeholderTextColor={T.textSecondary}
            autoFocus
          />
          <View style={s.modalBtnRow}>
            <TouchableOpacity style={s.modalCancel} onPress={onClose}>
              <Text style={s.modalCancelText}>{tr('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.modalSave} onPress={onSave}>
              <Text style={s.modalSaveText}>{tr('common.save')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PillPickerModal({ visible, title, options, selected, onSelect, onClose, renderLabel, allowDeselect }: {
  visible: boolean;
  title: string;
  options: string[];
  selected: string;
  onSelect: (v: string) => void;
  onClose: () => void;
  renderLabel?: (v: string) => string;
  allowDeselect?: boolean;
}) {
  const { t: tr } = useLanguage();
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={s.modalOverlay}>
        <View style={s.modalCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <View style={{ width: 32 }} />
            <Text style={[s.modalTitle, { marginBottom: 0 }]}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} activeOpacity={0.6}>
              <Text style={{ fontSize: 20, color: T.textTertiary, fontWeight: '300' }}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={s.pillGrid}>
            {options.map(opt => {
              const active = selected === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  style={[s.pickerPill, active && s.pickerPillActive]}
                  onPress={() => onSelect(active && allowDeselect ? '' : opt)}
                  activeOpacity={0.7}>
                  <Text style={[s.pickerPillText, active && s.pickerPillTextActive]}>
                    {renderLabel ? renderLabel(opt) : opt}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity style={s.modalCancel} onPress={onClose}>
            <Text style={s.modalCancelText}>{tr('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Short relative timestamp for the scraper's last run — "just now", "3h ago", "2d ago",
// falling back to a short date once it's more than a week old.
function formatRelative(iso: string, lang: Lang): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  if (minutes < 1) return lang === 'es' ? 'ahora mismo' : 'just now';
  if (minutes < 60) return lang === 'es' ? `hace ${minutes} min` : `${minutes}m ago`;
  if (hours < 24) return lang === 'es' ? `hace ${hours} h` : `${hours}h ago`;
  if (days < 7) return lang === 'es' ? `hace ${days} d` : `${days}d ago`;
  return new Date(then).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short' });
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: T.bg,
  },
  backBtn: { width: 70 },
  backText: { fontSize: 16, color: T.teal, fontWeight: '600' },
  versionFooter: { textAlign: 'center', fontSize: 12, color: T.textMuted, marginTop: 24 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: T.textPrimary },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 20 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: T.textTertiary,
    letterSpacing: 1.2,
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 4,
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
    marginTop: 8,
  },
  accordionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: T.textPrimary,
    letterSpacing: 0.2,
  },
  accordionArrow: {
    fontSize: 20,
    color: T.textTertiary,
    fontWeight: '300',
  },
  card: {
    backgroundColor: T.card,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
  },
  rowLabel: { fontSize: 16, color: T.textPrimary, fontWeight: '500', flex: 1 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, maxWidth: '65%' },
  rowValue: { fontSize: 15, color: T.textSecondary, textAlign: 'right', flexShrink: 1 },
  rowArrow: { fontSize: 20, color: T.textTertiary, fontWeight: '300' },
  sep: { height: 1, backgroundColor: T.cardBorder, marginLeft: 16 },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: T.cardElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: { fontSize: 16 },

  // Notifications (styles moved to rs StyleSheet inside ReminderSection)

  // Sign Out
  accountHint: { fontSize: 13, color: T.textSecondary, textAlign: 'center', marginBottom: 14, lineHeight: 18 },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: T.card,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: T.textPrimary, marginBottom: 16, textAlign: 'center' },
  modalInput: {
    backgroundColor: T.cardElevated,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 16,
    color: T.textPrimary,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  modalBtnRow: { flexDirection: 'row', gap: 10 },
  modalCancel: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: T.cardElevated,
  },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: T.textSecondary },
  modalSave: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: T.teal,
  },
  modalSaveText: { fontSize: 15, fontWeight: '700', color: T.bg },

  // Pill picker
  pillGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16, justifyContent: 'center' },
  pickerPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 50,
    backgroundColor: T.cardElevated,
  },
  pickerPillActive: { backgroundColor: T.teal },
  pickerPillText: { fontSize: 14, fontWeight: '600', color: T.textSecondary },
  pickerPillTextActive: { color: T.bg },
});

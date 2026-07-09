import React from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from '@/components/ui/text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/hooks/useAuth';
import { useAppQuery } from '@/hooks/useAppQuery';
import { DEMO_MODE } from '@/config/demo';
import { useLanguage } from '@/hooks/useLanguage';
import { T } from '@/constants/theme';
import { getInitials } from '@/utils/name';

const FLAG: Record<string, string> = {
  AR:'🇦🇷',AU:'🇦🇺',BR:'🇧🇷',CL:'🇨🇱',CO:'🇨🇴',DE:'🇩🇪',EC:'🇪🇨',ES:'🇪🇸',
  FR:'🇫🇷',GB:'🇬🇧',IT:'🇮🇹',MX:'🇲🇽',PE:'🇵🇪',PT:'🇵🇹',US:'🇺🇸',UY:'🇺🇾',
};

function fmt(n: number): string {
  return `$${Math.abs(n).toLocaleString('en-US')}`;
}

export default function ProfileScreen() {
  const router = useRouter();
  const { t } = useLanguage();
  const { data: profile } = useProfile();
  const { user } = useAuth();
  const { data: appData } = useAppQuery({ tournaments: {}, expenses: {} });

  const p = profile;
  const name = p?.full_name || (DEMO_MODE ? t('profile.demoPlayer') : user?.email?.split('@')[0] || t('profile.player'));
  const initials = getInitials(p?.full_name || (DEMO_MODE ? t('profile.demoPlayer') : null));

  const tournaments = appData?.tournaments ?? [];
  const expenses = appData?.expenses ?? [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const totalTournaments = tournaments.filter((t: any) => {
    if (t.isWithdrawn) return false;
    if (!t.startDate) return false;
    const [y, m, d] = t.startDate.split('-').map(Number);
    return new Date(y, m - 1, d) <= today;
  }).length;
  const totalSpent = expenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
  const totalPrize = tournaments.reduce((s: number, t: any) => {
    const singles = t.singlesPrizeMoney ?? 0;
    const doubles = t.doublesPrizeMoney ?? 0;
    return s + singles + doubles;
  }, 0);

  const infoRows = [
    { label: t('profile.nationality'), value: p?.nationality ? `${FLAG[p.nationality] ?? '🌍'} ${p.nationality}` : null },
    { label: t('profile.homeBase'), value: p?.home_city },
    { label: t('profile.ranking'), value: p?.ranking ? `#${p.ranking}` : null },
    { label: t('profile.role'), value: p?.role },
    { label: t('profile.primarySurface'), value: p?.primary_surface ? p.primary_surface.charAt(0).toUpperCase() + p.primary_surface.slice(1) : null },
    { label: t('profile.annualBudget'), value: p?.annual_budget ? `$${p.annual_budget.toLocaleString()}` : null },
    { label: t('profile.coach'), value: p?.travel_with_coach },
  ].filter(r => r.value);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={s.backBtn}>
          <Text style={s.backText}>{t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t('profile.title')}</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Avatar */}
        <View style={s.avatarSection}>
          <View style={s.avatarRing}>
            <View style={s.avatarCircle}>
              <Text style={s.avatarText}>{initials}</Text>
            </View>
          </View>
          <Text style={s.name}>{name}</Text>
          {p?.nationality && (
            <Text style={s.subtitle}>
              {FLAG[p.nationality] ?? '🌍'} {p.home_city ? `${p.home_city}, ` : ''}{p.nationality}
            </Text>
          )}
          {p?.ranking && (
            <View style={s.rankBadge}>
              <Text style={s.rankText}>{t('profile.ranked')} #{p.ranking}</Text>
            </View>
          )}
        </View>

        {/* Season stats */}
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statValue}>{totalTournaments}</Text>
            <Text style={s.statLabel}>{t('profile.tournaments')}</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statValue}>{fmt(totalPrize)}</Text>
            <Text style={s.statLabel}>{t('profile.prizeMoney')}</Text>
          </View>
          <View style={s.statCard}>
            <Text style={[s.statValue, totalPrize - totalSpent >= 0 ? s.statPos : s.statNeg]}>
              {totalPrize - totalSpent >= 0 ? '+' : '-'}{fmt(Math.abs(totalPrize - totalSpent))}
            </Text>
            <Text style={s.statLabel}>{t('profile.netPL')}</Text>
          </View>
        </View>

        {/* Info card */}
        {infoRows.length > 0 && (
          <View style={s.infoCard}>
            {infoRows.map((row, i) => (
              <View key={row.label} style={[s.infoRow, i < infoRows.length - 1 && s.infoRowBorder]}>
                <Text style={s.infoLabel}>{row.label}</Text>
                <Text style={s.infoValue}>{row.value}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Account */}
        <View style={s.infoCard}>
          <View style={[s.infoRow, s.infoRowBorder]}>
            <Text style={s.infoLabel}>{t('common.email')}</Text>
            <Text style={s.infoValue} numberOfLines={1}>
              {DEMO_MODE ? 'demo@tourly.app' : user?.email ?? t('common.notSet')}
            </Text>
          </View>
          <TouchableOpacity style={s.infoRow} onPress={() => router.push('/settings' as any)} activeOpacity={0.7}>
            <Text style={[s.infoLabel, { color: T.teal }]}>{t('profile.editSettings')}</Text>
            <Text style={s.infoArrow}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  backBtn: { width: 60 },
  backText: { fontSize: 15, color: T.teal, fontWeight: '600' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: T.textPrimary },
  scrollContent: { paddingHorizontal: 20 },

  avatarSection: { alignItems: 'center', paddingTop: 10, paddingBottom: 28 },
  avatarRing: { width: 96, height: 96, borderRadius: 48, borderWidth: 2.5, borderColor: T.teal, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  avatarCircle: { width: 84, height: 84, borderRadius: 42, backgroundColor: T.card, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 30, fontWeight: '800', color: T.teal },
  name: { fontSize: 24, fontWeight: '800', color: T.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 14, color: T.textSecondary, marginBottom: 10 },
  rankBadge: { backgroundColor: T.tealMuted, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 14, marginTop: 4 },
  rankText: { fontSize: 13, fontWeight: '700', color: T.teal },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  statCard: { flex: 1, backgroundColor: T.card, borderRadius: 14, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: T.cardBorder },
  statValue: { fontSize: 16, fontWeight: '800', color: T.textPrimary, marginBottom: 4 },
  statLabel: { fontSize: 11, fontWeight: '500', color: T.textTertiary },
  statPos: { color: T.green },
  statNeg: { color: T.red },

  infoCard: { backgroundColor: T.card, borderRadius: 14, borderWidth: 1, borderColor: T.cardBorder, marginBottom: 16, overflow: 'hidden' },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: T.cardBorder },
  infoLabel: { fontSize: 14, color: T.textSecondary, fontWeight: '500' },
  infoValue: { fontSize: 14, color: T.textPrimary, fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
  infoArrow: { fontSize: 20, color: T.teal, fontWeight: '300' },
});

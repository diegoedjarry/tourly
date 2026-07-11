import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Alert,
  Platform,
  ScrollView,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useUpdateProfile } from '@/hooks/useProfile';
import { TourlyLogo } from '@/components/ui/tourly-logo';
import { useLanguage } from '@/hooks/useLanguage';

const ROLES = ['Player', 'Coach', 'Other'];
const SURFACES = [
  { key: 'clay', label: 'Clay', color: '#E8964A', bg: '#FAEEDA' },
  { key: 'hard', label: 'Hard', color: '#5AABEE', bg: '#E6F1FB' },
  { key: 'grass', label: 'Grass', color: '#68B83A', bg: '#EAF3DE' },
];

export default function OnboardingProfileScreen() {
  const router = useRouter();
  const updateProfile = useUpdateProfile();
  const { t } = useLanguage();
  const ROLE_LABELS: Record<string, string> = {
    Player: t('onboarding.profileScreen.rolePlayer'),
    Coach: t('onboarding.profileScreen.roleCoach'),
    Other: t('onboarding.profileScreen.roleOther'),
  };
  const SURFACE_LABELS: Record<string, string> = {
    clay: t('onboarding.profileScreen.surfaceClay'),
    hard: t('onboarding.profileScreen.surfaceHard'),
    grass: t('onboarding.profileScreen.surfaceGrass'),
  };

  async function handleSkip() {
    // Mark onboarding complete so we never land here again on re-login
    try {
      await updateProfile.mutateAsync({ onboarding_complete: true } as any);
    } catch {
      // Do NOT navigate on failure — if onboarding_complete never lands, the
      // AuthGate keeps bouncing the user back here on every relaunch.
      Alert.alert(t('common.couldNotSaveProfile'), t('common.tryAgain'));
      return;
    }
    router.replace('/(tabs)');
  }

  const [name, setName] = useState('');
  const [role, setRole] = useState('Player');
  const [city, setCity] = useState('');
  const [budget, setBudget] = useState('');
  const [surface, setSurface] = useState('');

  async function handleContinue() {
    if (!name.trim()) return;
    try {
      await updateProfile.mutateAsync({
        full_name: name.trim(),
        role,
        home_city: city.trim() || null,
        annual_budget: budget ? parseInt(budget, 10) : null,
        primary_surface: surface || null,
        onboarding_complete: true,
      } as any);
      router.replace('/(tabs)');
    } catch {
      Alert.alert(t('common.couldNotSaveProfile'), t('common.tryAgain'));
    }
  }

  const canContinue = name.trim().length > 0;

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <View style={s.logo}><TourlyLogo width={180} height={48} /></View>

          <TouchableOpacity style={s.skipBtn} onPress={handleSkip} activeOpacity={0.7}>
            <Text style={s.skipText}>{t('onboarding.profileScreen.skip')} →</Text>
          </TouchableOpacity>

          <View style={s.card}>
            <Text style={s.title}>{t('onboarding.profileScreen.title')}</Text>
            <Text style={s.subtitle}>{t('onboarding.profileScreen.subtitle')}</Text>

            {/* Full name */}
            <Text style={s.label}>{t('onboarding.profileScreen.fullName')}</Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder={t('onboarding.profileScreen.fullNamePlaceholder')}
              placeholderTextColor="#A0A0B8"
              autoCapitalize="words"
            />

            {/* Role */}
            <Text style={s.label}>{t('onboarding.profileScreen.role')}</Text>
            <View style={s.pillRow}>
              {ROLES.map(r => (
                <TouchableOpacity
                  key={r}
                  style={[s.pill, role === r && s.pillActive]}
                  onPress={() => setRole(r)}
                  activeOpacity={0.7}>
                  <Text style={[s.pillText, role === r && s.pillTextActive]}>{ROLE_LABELS[r]}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Home base city */}
            <Text style={s.label}>{t('onboarding.profileScreen.homeCity')}</Text>
            <TextInput
              style={s.input}
              value={city}
              onChangeText={setCity}
              placeholder={t('onboarding.profileScreen.homeCityPlaceholder')}
              placeholderTextColor="#A0A0B8"
              autoCapitalize="words"
            />

            {/* Annual budget */}
            <Text style={s.label}>{t('onboarding.profileScreen.annualBudget')}</Text>
            <TextInput
              style={s.input}
              value={budget}
              onChangeText={setBudget}
              placeholder={t('onboarding.profileScreen.budgetPlaceholder')}
              placeholderTextColor="#A0A0B8"
              keyboardType="number-pad"
            />

            {/* Primary surface */}
            <Text style={s.label}>{t('onboarding.profileScreen.primarySurface')}</Text>
            <View style={s.pillRow}>
              {SURFACES.map(sf => (
                <TouchableOpacity
                  key={sf.key}
                  style={[
                    s.pill,
                    surface === sf.key && { backgroundColor: sf.bg, borderWidth: 2, borderColor: sf.color },
                  ]}
                  onPress={() => setSurface(surface === sf.key ? '' : sf.key)}
                  activeOpacity={0.7}>
                  <Text style={[s.pillText, surface === sf.key && { color: sf.color }]}>{SURFACE_LABELS[sf.key]}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[s.btn, (!canContinue || updateProfile.isPending) && s.btnDisabled]}
              onPress={handleContinue}
              activeOpacity={0.85}
              disabled={!canContinue || updateProfile.isPending}>
              {updateProfile.isPending ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={s.btnText}>{t('onboarding.profileScreen.continue')} →</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F0F0F8' },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  logo: { alignSelf: 'center', marginBottom: 28 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingVertical: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 5,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#2D2B55', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#8888A8', marginBottom: 22, lineHeight: 20 },
  label: { fontSize: 11, fontWeight: '600', color: '#8888A8', letterSpacing: 0.6, marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: '#F4F4FA',
    borderRadius: 50,
    paddingHorizontal: 20,
    paddingVertical: Platform.OS === 'ios' ? 15 : 13,
    fontSize: 15,
    color: '#2D2B55',
  },
  pillRow: { flexDirection: 'row', gap: 8 },
  pill: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 50,
    backgroundColor: '#F4F4FA',
  },
  pillActive: { backgroundColor: '#00D4AA' },
  pillText: { fontSize: 14, fontWeight: '600', color: '#8888A8' },
  pillTextActive: { color: '#FFFFFF' },
  btn: {
    backgroundColor: '#00D4AA',
    borderRadius: 50,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  skipBtn: { alignSelf: 'center', marginBottom: 12, paddingVertical: 8, paddingHorizontal: 16 },
  skipText: { fontSize: 14, color: '#8888A8', fontWeight: '500' },
});

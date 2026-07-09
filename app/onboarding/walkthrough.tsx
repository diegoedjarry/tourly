import React, { useRef, useState } from 'react';
import {
  View, ScrollView, TouchableOpacity, StyleSheet, Dimensions,
  TextInput, Platform, KeyboardAvoidingView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useUpdateProfile } from '@/hooks/useProfile';
import { Text } from '@/components/ui/text';
import { TourlyLogo } from '@/components/ui/tourly-logo';
import { supabase } from '@/lib/supabase'; // used for sign-out in handleBackToLogin
import { triggerScraperOnce } from '@/hooks/useScraperTrigger';
import { T } from '@/constants/theme';
import { useLanguage } from '@/hooks/useLanguage';

// Set by ProfileSetupScreen so finishOnboarding can fire the scraper
let _pendingPlayerName = '';

const { width: W } = Dimensions.get('window');
const ACCENT = T.accent;
const BG = T.bg;
const CARD = T.card;
const MINT = T.teal;

// ─── Progress dots ───────────────────────────────────────────────────────────

function Dots({ total, current }: { total: number; current: number }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 24 }}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={{
          width: i === current ? 20 : 8, height: 8, borderRadius: 4,
          backgroundColor: i === current ? ACCENT : T.cardBorder,
        }} />
      ))}
    </View>
  );
}

// ─── Screen 1: Welcome ────────────────────────────────────────────────────────

function WelcomeScreen({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { t } = useLanguage();
  return (
    <SafeAreaView style={[s.safe, { backgroundColor: T.cardElevated }]}>
      <View style={s.centered}>
        <TourlyLogo width={240} height={64} />
        <View style={{ marginTop: 40, alignItems: 'center', gap: 8 }}>
          <Text style={s.tagline1}>{t('onboarding.tagline1')}</Text>
          <Text style={s.tagline2}>{t('onboarding.tagline2')}</Text>
        </View>
      </View>
      <View style={s.welcomeBottom}>
        <TouchableOpacity style={s.primaryBtn} onPress={onNext} activeOpacity={0.85}>
          <Text style={s.primaryBtnText}>{t('onboarding.getStarted')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onBack} activeOpacity={0.7} style={{ alignItems: 'center', marginTop: 16 }}>
          <Text style={s.linkText}>← {t('onboarding.backToLogin')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Screen 2: The Problem ────────────────────────────────────────────────────

function ProblemScreen({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { t } = useLanguage();
  return (
    <SafeAreaView style={s.safe}>
      <TouchableOpacity onPress={onBack} style={s.backBtn} activeOpacity={0.7}>
        <Text style={s.backText}>‹ {t('onboarding.back')}</Text>
      </TouchableOpacity>
      <View style={[s.centered, { paddingHorizontal: 32 }]}>
        <Text style={s.bigStat}>$30,000+</Text>
        <Text style={s.problemMain}>
          {t('onboarding.problemMain')}
        </Text>
        <Text style={s.problemSub}>
          {t('onboarding.problemSub')}
        </Text>
      </View>
      <View style={s.bottomRow}>
        <Dots total={5} current={0} />
        <TouchableOpacity style={s.nextBtn} onPress={onNext} activeOpacity={0.85}>
          <Text style={s.nextBtnText}>{t('onboarding.next')} →</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Screens 3–6: Feature slides (horizontal swipe) ──────────────────────────

function getFeatureSlides(t: (key: any) => string) {
  return [
    {
      icon: '🔔',
      title: t('onboarding.feature1Title'),
      desc: t('onboarding.feature1Desc'),
      mockup: [
        { label: t('onboarding.feature1EntryDeadline'), pill: t('onboarding.feature1Today'), pillColor: '#E24B4A' },
        { label: t('onboarding.feature1WithdrawalDeadline'), pill: t('onboarding.feature1ThreeDays'), pillColor: '#F59E0B' },
        { label: t('onboarding.feature1FreezeDeadline'), pill: t('onboarding.feature1FourteenDays'), pillColor: '#555' },
      ],
    },
    {
      icon: '💸',
      title: t('onboarding.feature2Title'),
      desc: t('onboarding.feature2Desc'),
      mockup: [
        { label: t('onboarding.feature2Flights'), pct: 41 },
        { label: t('onboarding.feature2Hotel'), pct: 28 },
        { label: t('onboarding.feature2Meals'), pct: 18 },
        { label: t('onboarding.feature2Coach'), pct: 13 },
      ],
    },
    {
      icon: '✦',
      title: t('onboarding.feature3Title'),
      desc: t('onboarding.feature3Desc'),
      mockup: null,
      insightText: t('onboarding.feature3Insight'),
    },
    {
      icon: '🗺️',
      title: t('onboarding.feature4Title'),
      desc: t('onboarding.feature4Desc'),
      mockup: null,
    },
  ];
}

function FeatureMockupAlerts({ items }: { items: { label: string; pill: string; pillColor: string }[] }) {
  return (
    <View style={mock.alertBox}>
      {items.map((item, i) => (
        <View key={i} style={mock.alertRow}>
          <Text style={mock.alertLabel}>{item.label}</Text>
          <View style={[mock.alertPill, { backgroundColor: item.pillColor }]}>
            <Text style={mock.alertPillText}>{item.pill}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function FeatureMockupExpenses({ items }: { items: { label: string; pct: number }[] }) {
  return (
    <View style={mock.alertBox}>
      {items.map((item, i) => (
        <View key={i} style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={mock.alertLabel}>{item.label}</Text>
            <Text style={[mock.alertLabel, { color: ACCENT }]}>{item.pct}%</Text>
          </View>
          <View style={{ height: 6, backgroundColor: '#2A2A4A', borderRadius: 3, overflow: 'hidden' }}>
            <View style={{ height: '100%', width: `${item.pct}%`, backgroundColor: ACCENT, borderRadius: 3 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function FeatureMockupInsight({ text }: { text: string }) {
  return (
    <View style={[mock.alertBox, { borderLeftWidth: 3, borderLeftColor: ACCENT }]}>
      <Text style={{ fontSize: 10, color: T.textTertiary, letterSpacing: 0.8, marginBottom: 8 }}>FINANCIAL COACH</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Text style={{ color: ACCENT, fontSize: 14 }}>✦</Text>
        <Text style={{ fontSize: 13, color: T.textPrimary, lineHeight: 19, flex: 1 }}>{text}</Text>
      </View>
    </View>
  );
}

function FeatureMockupMap() {
  return (
    <View style={[mock.alertBox, { alignItems: 'center', justifyContent: 'center', height: 120 }]}>
      <Text style={{ fontSize: 11, color: T.textTertiary, marginBottom: 12 }}>· · · · · · · · · · · · · · · · · ·</Text>
      {['🌟 Buenos Aires', '🌟 Bogotá', '🌟 Lima'].map((city, i) => (
        <Text key={i} style={{ fontSize: 13, color: T.textPrimary, marginBottom: 4 }}>{city}</Text>
      ))}
    </View>
  );
}

function FeaturesCarousel({ startIndex, onNext, onBack }: { startIndex: number; onNext: () => void; onBack: () => void }) {
  const { t } = useLanguage();
  const scrollRef = useRef<ScrollView>(null);
  const [idx, setIdx] = useState(startIndex);
  const featureSlides = getFeatureSlides(t);

  function handleScroll(e: any) {
    const newIdx = Math.round(e.nativeEvent.contentOffset.x / W);
    setIdx(newIdx);
  }

  function handleNext() {
    if (idx < featureSlides.length - 1) {
      scrollRef.current?.scrollTo({ x: (idx + 1) * W, animated: true });
      setIdx(idx + 1);
    } else {
      onNext();
    }
  }

  function handleBack() {
    if (idx > 0) {
      scrollRef.current?.scrollTo({ x: (idx - 1) * W, animated: true });
      setIdx(idx - 1);
    } else {
      onBack();
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <TouchableOpacity onPress={handleBack} style={s.backBtn} activeOpacity={0.7}>
        <Text style={s.backText}>‹ {t('onboarding.back')}</Text>
      </TouchableOpacity>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
      >
        {featureSlides.map((slide, i) => (
          <View key={i} style={{ width: W, paddingHorizontal: 24 }}>
            {/* Mockup area */}
            <View style={{ height: 200, justifyContent: 'center', marginTop: 8 }}>
              {i === 0 && slide.mockup && <FeatureMockupAlerts items={slide.mockup as any} />}
              {i === 1 && slide.mockup && <FeatureMockupExpenses items={slide.mockup as any} />}
              {i === 2 && slide.insightText && <FeatureMockupInsight text={slide.insightText} />}
              {i === 3 && <FeatureMockupMap />}
            </View>

            <Text style={{ fontSize: 24, marginBottom: 8 }}>{slide.icon}</Text>
            <Text style={s.featureTitle}>{slide.title}</Text>
            <Text style={s.featureDesc}>{slide.desc}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={s.bottomRow}>
        <Dots total={5} current={idx + 1} />
        <TouchableOpacity style={s.nextBtn} onPress={handleNext} activeOpacity={0.85}>
          <Text style={s.nextBtnText}>{idx === featureSlides.length - 1 ? t('onboarding.continue') : t('onboarding.next')} →</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Screen 7: Profile Setup ─────────────────────────────────────────────────

const SURFACES = ['Clay', 'Hard', 'Grass'];
const COACH_OPTS = ['Always', 'Sometimes', 'Never'];
const STRINGING_OPTS = ['Yes', 'No'];
const ROLES = ['Player', 'Coach', 'Other'];

function ProfileSetupScreen({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { t } = useLanguage();
  const updateProfile = useUpdateProfile();

  const SURFACE_LABELS: Record<string, string> = {
    Clay: t('onboarding.profile.surfaceClay'),
    Hard: t('onboarding.profile.surfaceHard'),
    Grass: t('onboarding.profile.surfaceGrass'),
  };
  const COACH_LABELS: Record<string, string> = {
    Always: t('onboarding.profile.coachAlways'),
    Sometimes: t('onboarding.profile.coachSometimes'),
    Never: t('onboarding.profile.coachNever'),
  };
  const STRINGING_LABELS: Record<string, string> = {
    Yes: t('onboarding.profile.yes'),
    No: t('onboarding.profile.no'),
  };
  const ROLE_LABELS: Record<string, string> = {
    Player: t('onboarding.profile.rolePlayer'),
    Coach: t('onboarding.profile.roleCoach'),
    Other: t('onboarding.profile.roleOther'),
  };

  const [role, setRole] = useState('Player');
  const [surface, setSurface] = useState('');
  const [city, setCity] = useState('');
  const [budget, setBudget] = useState('');
  const [coachTravel, setCoachTravel] = useState('');
  const [stringing, setStringing] = useState('');
  const [playerName, setPlayerName] = useState('');

  async function handleContinue() {
    const payload: any = { onboarding_complete: false };
    const resolvedName = playerName.trim();
    if (resolvedName) { payload.full_name = resolvedName; payload.atp_player_name = resolvedName; _pendingPlayerName = resolvedName; }
    if (role) payload.role = role;
    if (surface) payload.primary_surface = surface.toLowerCase();
    if (city.trim()) payload.home_city = city.trim();
    if (budget) payload.annual_budget = parseInt(budget, 10);
    if (coachTravel) payload.travel_with_coach = coachTravel;
    if (stringing) payload.travel_with_stringing = stringing;
    try { await updateProfile.mutateAsync(payload); } catch {}
    onNext();
  }

  function PillGroup({ options, value, onChange, labels }: { options: string[]; value: string; onChange: (v: string) => void; labels?: Record<string, string> }) {
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
        {options.map(opt => (
          <TouchableOpacity
            key={opt}
            onPress={() => onChange(opt)}
            style={[s.pill, value === opt && s.pillActive]}
            activeOpacity={0.8}
          >
            <Text style={[s.pillText, value === opt && s.pillTextActive]}>{labels ? labels[opt] : opt}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <TouchableOpacity onPress={onBack} style={s.backBtn} activeOpacity={0.7}>
        <Text style={s.backText}>‹ {t('onboarding.back')}</Text>
      </TouchableOpacity>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={s.profileCard}>
            <Text style={s.profileTitle}>{t('onboarding.profile.title')}</Text>
            <Text style={s.profileSub}>{t('onboarding.profile.subtitle')}</Text>

            <Text style={s.fieldLabel}>{t('onboarding.profile.role')}</Text>
            <PillGroup options={ROLES} value={role} onChange={setRole} labels={ROLE_LABELS} />

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>{t('onboarding.profile.primarySurface')}</Text>
            <PillGroup options={SURFACES} value={surface} onChange={setSurface} labels={SURFACE_LABELS} />

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>{t('onboarding.profile.homeCity')}</Text>
            <TextInput style={s.input} value={city} onChangeText={setCity} placeholder={t('onboarding.profile.homeCityPlaceholder')} placeholderTextColor="#555" />

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>{t('onboarding.profile.annualBudget')}</Text>
            <TextInput style={s.input} value={budget} onChangeText={setBudget} keyboardType="numeric" placeholder={t('onboarding.profile.budgetPlaceholder')} placeholderTextColor="#555" />

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>{t('onboarding.profile.travelWithCoach')}</Text>
            <PillGroup options={COACH_OPTS} value={coachTravel} onChange={setCoachTravel} labels={COACH_LABELS} />

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>{t('onboarding.profile.travelWithStringing')}</Text>
            <PillGroup options={STRINGING_OPTS} value={stringing} onChange={setStringing} labels={STRINGING_LABELS} />

            <Text style={s.fieldLabel}>{t('onboarding.profile.fullName')} *</Text>
            <Text style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
              {t('onboarding.profile.fullNameHint')}
            </Text>
            <View style={{ position: 'relative' }}>
              <TextInput
                style={s.input}
                value={playerName}
                onChangeText={setPlayerName}
                placeholder={t('onboarding.profile.fullNamePlaceholder')}
                placeholderTextColor="#555"
                autoCorrect={false}
                autoCapitalize="words"
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={{ paddingHorizontal: 24, paddingBottom: 20 }}>
        <TouchableOpacity
          style={[s.primaryBtn, (!playerName.trim() || updateProfile.isPending) && { opacity: 0.5 }]}
          onPress={handleContinue}
          disabled={!playerName.trim() || updateProfile.isPending}
          activeOpacity={0.85}
        >
          <Text style={s.primaryBtnText}>{t('onboarding.continue')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Screen 8: Notifications ─────────────────────────────────────────────────

function NotificationsScreen({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  async function handleEnable() {
    try {
      const { requestPermissionsAndGetToken } = await import('@/utils/notifications');
      await requestPermissionsAndGetToken();
    } catch {}
    onNext();
  }

  return (
    <SafeAreaView style={s.safe}>
      <TouchableOpacity onPress={onBack} style={s.backBtn} activeOpacity={0.7}>
        <Text style={s.backText}>‹ Back</Text>
      </TouchableOpacity>
      <View style={[s.centered, { paddingHorizontal: 32 }]}>
        <Text style={{ fontSize: 64, marginBottom: 24 }}>🔔</Text>
        <Text style={s.featureTitle}>Stay Ahead of Every Deadline</Text>
        <Text style={s.featureDesc}>
          Tourly sends deadline reminders before entry and withdrawal windows close. Missing a withdrawal deadline costs you a fine and ranking points — these notifications are your safety net.
        </Text>
      </View>
      <View style={{ paddingHorizontal: 24, paddingBottom: 32, gap: 12 }}>
        <TouchableOpacity style={s.primaryBtn} onPress={handleEnable} activeOpacity={0.85}>
          <Text style={s.primaryBtnText}>Turn On Notifications</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onNext} activeOpacity={0.7} style={{ alignItems: 'center' }}>
          <Text style={s.linkText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Screen 9: Ready ─────────────────────────────────────────────────────────

function ReadyScreen({ onAddTournament, onExplore }: { onAddTournament: () => void; onExplore: () => void }) {
  return (
    <SafeAreaView style={s.safe}>
      <View style={[s.centered, { paddingHorizontal: 32 }]}>
        <Text style={{ fontSize: 72, color: MINT, fontWeight: '800', marginBottom: 16 }}>✓</Text>
        <Text style={s.featureTitle}>You&apos;re All Set</Text>
        <Text style={s.featureDesc}>
          Add your first tournament to get started. Tourly will calculate all deadlines automatically.
        </Text>
      </View>
      <View style={{ paddingHorizontal: 24, paddingBottom: 32, gap: 12 }}>
        <TouchableOpacity style={s.primaryBtn} onPress={onAddTournament} activeOpacity={0.85}>
          <Text style={s.primaryBtnText}>Add My First Tournament →</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onExplore} activeOpacity={0.7} style={{ alignItems: 'center' }}>
          <Text style={s.linkText}>Explore the app first</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function WalkthroughScreen() {
  const router = useRouter();
  const updateProfile = useUpdateProfile();
  const [step, setStep] = useState(0);
  const { t } = useLanguage();

  async function finishOnboarding(): Promise<boolean> {
    try {
      await updateProfile.mutateAsync({ onboarding_complete: true });
    } catch {
      Alert.alert(t('common.couldNotSaveProfile'), t('common.tryAgain'));
      return false;
    }
    // Fire scraper once — non-blocking, does not delay navigation
    if (_pendingPlayerName) triggerScraperOnce(_pendingPlayerName);
    return true;
  }

  async function handleBackToLogin() {
    try { await supabase.auth.signOut(); } catch {}
    // AuthGate in _layout.tsx will redirect to /auth once session clears
  }

  const steps: React.ReactNode[] = [
    <WelcomeScreen
      key="welcome"
      onNext={() => setStep(1)}
      onBack={handleBackToLogin}
    />,
    <ProblemScreen
      key="problem"
      onNext={() => setStep(2)}
      onBack={() => setStep(0)}
    />,
    <FeaturesCarousel
      key="features"
      startIndex={0}
      onNext={() => setStep(3)}
      onBack={() => setStep(1)}
    />,
    <ProfileSetupScreen
      key="profile"
      onNext={() => setStep(4)}
      onBack={() => setStep(2)}
    />,
    <NotificationsScreen
      key="notifications"
      onNext={() => setStep(5)}
      onBack={() => setStep(3)}
    />,
    <ReadyScreen
      key="ready"
      onAddTournament={async () => {
        if (await finishOnboarding()) router.replace('/(tabs)/tournaments');
      }}
      onExplore={async () => {
        if (await finishOnboarding()) router.replace('/(tabs)');
      }}
    />,
  ];

  return <View style={{ flex: 1, backgroundColor: BG }}>{steps[step]}</View>;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backBtn: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  backText: { fontSize: 16, color: T.textTertiary, fontWeight: '500' },

  tagline1: { fontSize: 16, color: T.textPrimary, fontStyle: 'italic', textAlign: 'center' },
  tagline2: { fontSize: 20, color: T.textPrimary, fontWeight: '700', textAlign: 'center' },

  welcomeBottom: { paddingHorizontal: 24, paddingBottom: 40 },

  primaryBtn: {
    backgroundColor: ACCENT, borderRadius: 14,
    paddingVertical: 17, alignItems: 'center',
  },
  primaryBtnText: { color: T.textPrimary, fontSize: 17, fontWeight: '700' },
  linkText: { fontSize: 14, color: T.textTertiary, textAlign: 'center' },

  bigStat: {
    fontSize: 56, fontWeight: '800', color: T.textPrimary,
    textAlign: 'center', marginBottom: 20,
  },
  problemMain: {
    fontSize: 16, color: T.textPrimary, textAlign: 'center',
    lineHeight: 24, marginBottom: 16,
  },
  problemSub: {
    fontSize: 14, color: T.textTertiary, textAlign: 'center', lineHeight: 22,
  },

  bottomRow: { paddingHorizontal: 24, paddingBottom: 32, alignItems: 'flex-end' },
  nextBtn: {
    backgroundColor: ACCENT, borderRadius: 50,
    paddingVertical: 12, paddingHorizontal: 28, marginTop: 16,
  },
  nextBtnText: { color: T.textPrimary, fontSize: 15, fontWeight: '700' },

  featureTitle: { fontSize: 22, fontWeight: '700', color: T.textPrimary, marginBottom: 12 },
  featureDesc: { fontSize: 14, color: T.textTertiary, lineHeight: 22 },

  profileCard: {
    backgroundColor: CARD, borderRadius: 20,
    padding: 24, marginBottom: 8,
  },
  profileTitle: { fontSize: 22, fontWeight: '700', color: T.textPrimary, marginBottom: 6 },
  profileSub: { fontSize: 14, color: T.textTertiary, marginBottom: 20 },
  fieldLabel: { fontSize: 12, color: T.textTertiary, fontWeight: '600', letterSpacing: 0.4, marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: T.bg, borderWidth: 1, borderColor: T.cardBorder,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: T.textPrimary,
  },
  pill: {
    borderWidth: 1, borderColor: T.cardBorder, borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 16,
  },
  pillActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  pillText: { fontSize: 14, color: T.textTertiary, fontWeight: '500' },
  pillTextActive: { color: T.textPrimary, fontWeight: '700' },
});

const mock = StyleSheet.create({
  alertBox: {
    backgroundColor: CARD, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: T.cardBorder,
  },
  alertRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12,
  },
  alertLabel: { fontSize: 13, color: T.textPrimary },
  alertPill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  alertPillText: { fontSize: 11, color: T.textPrimary, fontWeight: '700' },
});

import React, { useRef, useState } from 'react';
import {
  View, ScrollView, TouchableOpacity, StyleSheet, Dimensions,
  TextInput, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useUpdateProfile } from '@/hooks/useProfile';
import { Text } from '@/components/ui/text';
import { TourlyLogo } from '@/components/ui/tourly-logo';
import { supabase } from '@/lib/supabase'; // used for sign-out in handleBackToLogin
import { triggerScraperOnce } from '@/hooks/useScraperTrigger';

// Set by ProfileSetupScreen so finishOnboarding can fire the scraper
let _pendingPlayerName = '';

const { width: W } = Dimensions.get('window');
const ACCENT = '#5B5BD6';
const BG = '#0F0F1A';
const CARD = '#1A1A2E';
const MINT = '#00E5A0';

// ─── Progress dots ───────────────────────────────────────────────────────────

function Dots({ total, current }: { total: number; current: number }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 24 }}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={{
          width: i === current ? 20 : 8, height: 8, borderRadius: 4,
          backgroundColor: i === current ? ACCENT : '#2A2A4A',
        }} />
      ))}
    </View>
  );
}

// ─── Screen 1: Welcome ────────────────────────────────────────────────────────

function WelcomeScreen({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <SafeAreaView style={[s.safe, { backgroundColor: '#2D2B55' }]}>
      <View style={s.centered}>
        <TourlyLogo width={240} height={64} />
        <View style={{ marginTop: 40, alignItems: 'center', gap: 8 }}>
          <Text style={s.tagline1}>"Every city, every court, every dollar."</Text>
          <Text style={s.tagline2}>Take control of your tour.</Text>
        </View>
      </View>
      <View style={s.welcomeBottom}>
        <TouchableOpacity style={s.primaryBtn} onPress={onNext} activeOpacity={0.85}>
          <Text style={s.primaryBtnText}>Get Started</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onBack} activeOpacity={0.7} style={{ alignItems: 'center', marginTop: 16 }}>
          <Text style={s.linkText}>← Back to login</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Screen 2: The Problem ────────────────────────────────────────────────────

function ProblemScreen({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <SafeAreaView style={s.safe}>
      <TouchableOpacity onPress={onBack} style={s.backBtn} activeOpacity={0.7}>
        <Text style={s.backText}>‹ Back</Text>
      </TouchableOpacity>
      <View style={[s.centered, { paddingHorizontal: 32 }]}>
        <Text style={s.bigStat}>$30,000+</Text>
        <Text style={s.problemMain}>
          The average professional tennis player loses approximately this much or more every year competing at world level.
        </Text>
        <Text style={s.problemSub}>
          Tourly exists to help you understand every dollar — and make smarter decisions on tour.
        </Text>
      </View>
      <View style={s.bottomRow}>
        <Dots total={5} current={0} />
        <TouchableOpacity style={s.nextBtn} onPress={onNext} activeOpacity={0.85}>
          <Text style={s.nextBtnText}>Next →</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Screens 3–6: Feature slides (horizontal swipe) ──────────────────────────

const FEATURE_SLIDES = [
  {
    icon: '🔔',
    title: 'Never Miss a Deadline',
    desc: 'Tourly automatically calculates every ITF and ATP Challenger entry, withdrawal, and freeze deadline the moment you add a tournament. Get notified before it\'s too late.',
    mockup: [
      { label: 'Entry deadline', pill: 'TODAY', pillColor: '#E24B4A' },
      { label: 'Withdrawal deadline', pill: '3 days', pillColor: '#F59E0B' },
      { label: 'Freeze deadline', pill: '14 days', pillColor: '#555' },
    ],
  },
  {
    icon: '💸',
    title: 'Track Every Dollar',
    desc: 'Log flights, hotels, meals, coach travel and more. See exactly where your money goes and which tournaments give you the best financial return.',
    mockup: [
      { label: 'Flights', pct: 41 },
      { label: 'Hotel', pct: 28 },
      { label: 'Meals', pct: 18 },
      { label: 'Coach', pct: 13 },
    ],
  },
  {
    icon: '✦',
    title: 'Your Financial Coach',
    desc: 'Tourly analyzes your data and surfaces insights automatically — cost per ranking point, coach impact, surface efficiency, and 57 more personalized insights.',
    mockup: null,
    insightText: 'Your clay tournaments cost 40% more than hard court but earn 3× more prize money.',
  },
  {
    icon: '🗺️',
    title: 'Plan Your Season',
    desc: 'See your entire season on one calendar. The world map shows your tournaments as glowing dots — identifying nearby events you can combine into one trip to save on flights.',
    mockup: null,
  },
];

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
      <Text style={{ fontSize: 10, color: '#666', letterSpacing: 0.8, marginBottom: 8 }}>FINANCIAL COACH</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Text style={{ color: ACCENT, fontSize: 14 }}>✦</Text>
        <Text style={{ fontSize: 13, color: '#FAFAFA', lineHeight: 19, flex: 1 }}>{text}</Text>
      </View>
    </View>
  );
}

function FeatureMockupMap() {
  return (
    <View style={[mock.alertBox, { alignItems: 'center', justifyContent: 'center', height: 120 }]}>
      <Text style={{ fontSize: 11, color: '#555', marginBottom: 12 }}>· · · · · · · · · · · · · · · · · ·</Text>
      {['🌟 Buenos Aires', '🌟 Bogotá', '🌟 Lima'].map((city, i) => (
        <Text key={i} style={{ fontSize: 13, color: '#FAFAFA', marginBottom: 4 }}>{city}</Text>
      ))}
    </View>
  );
}

function FeaturesCarousel({ startIndex, onNext, onBack }: { startIndex: number; onNext: () => void; onBack: () => void }) {
  const scrollRef = useRef<ScrollView>(null);
  const [idx, setIdx] = useState(startIndex);

  function handleScroll(e: any) {
    const newIdx = Math.round(e.nativeEvent.contentOffset.x / W);
    setIdx(newIdx);
  }

  function handleNext() {
    if (idx < FEATURE_SLIDES.length - 1) {
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

  const slide = FEATURE_SLIDES[idx];

  return (
    <SafeAreaView style={s.safe}>
      <TouchableOpacity onPress={handleBack} style={s.backBtn} activeOpacity={0.7}>
        <Text style={s.backText}>‹ Back</Text>
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
        {FEATURE_SLIDES.map((slide, i) => (
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
          <Text style={s.nextBtnText}>{idx === FEATURE_SLIDES.length - 1 ? 'Continue →' : 'Next →'}</Text>
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
  const updateProfile = useUpdateProfile();
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

  function PillGroup({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
        {options.map(opt => (
          <TouchableOpacity
            key={opt}
            onPress={() => onChange(opt)}
            style={[s.pill, value === opt && s.pillActive]}
            activeOpacity={0.8}
          >
            <Text style={[s.pillText, value === opt && s.pillTextActive]}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <TouchableOpacity onPress={onBack} style={s.backBtn} activeOpacity={0.7}>
        <Text style={s.backText}>‹ Back</Text>
      </TouchableOpacity>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={s.profileCard}>
            <Text style={s.profileTitle}>Set Up Your Profile</Text>
            <Text style={s.profileSub}>Help Tourly personalize your experience</Text>

            <Text style={s.fieldLabel}>Role</Text>
            <PillGroup options={ROLES} value={role} onChange={setRole} />

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>Primary surface</Text>
            <PillGroup options={SURFACES} value={surface} onChange={setSurface} />

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>Home base city</Text>
            <TextInput style={s.input} value={city} onChangeText={setCity} placeholder="e.g. Buenos Aires" placeholderTextColor="#555" />

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>Annual tournament budget (USD)</Text>
            <TextInput style={s.input} value={budget} onChangeText={setBudget} keyboardType="numeric" placeholder="e.g. 25000" placeholderTextColor="#555" />

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>Travel with coach</Text>
            <PillGroup options={COACH_OPTS} value={coachTravel} onChange={setCoachTravel} />

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>Travel with stringing machine</Text>
            <PillGroup options={STRINGING_OPTS} value={stringing} onChange={setStringing} />

            <Text style={s.fieldLabel}>Your full name *</Text>
            <Text style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
              Enter your name exactly as it appears on atptour.com — Tourly will link your match history automatically.
            </Text>
            <View style={{ position: 'relative' }}>
              <TextInput
                style={s.input}
                value={playerName}
                onChangeText={setPlayerName}
                placeholder="e.g. Nicolas Jarry"
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
          <Text style={s.primaryBtnText}>Continue</Text>
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
        <Text style={s.featureTitle}>You're All Set</Text>
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

  async function finishOnboarding() {
    try { await updateProfile.mutateAsync({ onboarding_complete: true }); } catch {}
    // Fire scraper once — non-blocking, does not delay navigation
    if (_pendingPlayerName) triggerScraperOnce(_pendingPlayerName);
  }

  async function handleBackToLogin() {
    try { await supabase.auth.signOut(); } catch {}
    // AuthGate in _layout.tsx will redirect to /auth once session clears
  }

  const steps: React.ReactNode[] = [
    <WelcomeScreen
      onNext={() => setStep(1)}
      onBack={handleBackToLogin}
    />,
    <ProblemScreen
      onNext={() => setStep(2)}
      onBack={() => setStep(0)}
    />,
    <FeaturesCarousel
      startIndex={0}
      onNext={() => setStep(3)}
      onBack={() => setStep(1)}
    />,
    <ProfileSetupScreen
      onNext={() => setStep(4)}
      onBack={() => setStep(2)}
    />,
    <NotificationsScreen
      onNext={() => setStep(5)}
      onBack={() => setStep(3)}
    />,
    <ReadyScreen
      onAddTournament={async () => {
        await finishOnboarding();
        router.replace('/(tabs)/tournaments');
      }}
      onExplore={async () => {
        await finishOnboarding();
        router.replace('/(tabs)');
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
  backText: { fontSize: 16, color: '#888', fontWeight: '500' },

  tagline1: { fontSize: 16, color: '#FAFAFA', fontStyle: 'italic', textAlign: 'center' },
  tagline2: { fontSize: 20, color: '#FAFAFA', fontWeight: '700', textAlign: 'center' },

  welcomeBottom: { paddingHorizontal: 24, paddingBottom: 40 },

  primaryBtn: {
    backgroundColor: ACCENT, borderRadius: 14,
    paddingVertical: 17, alignItems: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  linkText: { fontSize: 14, color: '#888', textAlign: 'center' },

  bigStat: {
    fontSize: 56, fontWeight: '800', color: '#FAFAFA',
    textAlign: 'center', marginBottom: 20,
  },
  problemMain: {
    fontSize: 16, color: '#FAFAFA', textAlign: 'center',
    lineHeight: 24, marginBottom: 16,
  },
  problemSub: {
    fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 22,
  },

  bottomRow: { paddingHorizontal: 24, paddingBottom: 32, alignItems: 'flex-end' },
  nextBtn: {
    backgroundColor: ACCENT, borderRadius: 50,
    paddingVertical: 12, paddingHorizontal: 28, marginTop: 16,
  },
  nextBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },

  featureTitle: { fontSize: 22, fontWeight: '700', color: '#FAFAFA', marginBottom: 12 },
  featureDesc: { fontSize: 14, color: '#888', lineHeight: 22 },

  profileCard: {
    backgroundColor: CARD, borderRadius: 20,
    padding: 24, marginBottom: 8,
  },
  profileTitle: { fontSize: 22, fontWeight: '700', color: '#FAFAFA', marginBottom: 6 },
  profileSub: { fontSize: 14, color: '#888', marginBottom: 20 },
  fieldLabel: { fontSize: 12, color: '#888', fontWeight: '600', letterSpacing: 0.4, marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: '#0F0F1A', borderWidth: 1, borderColor: '#2A2A4A',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#FAFAFA',
  },
  pill: {
    borderWidth: 1, borderColor: '#2A2A4A', borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 16,
  },
  pillActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  pillText: { fontSize: 14, color: '#888', fontWeight: '500' },
  pillTextActive: { color: '#FFF', fontWeight: '700' },
});

const mock = StyleSheet.create({
  alertBox: {
    backgroundColor: CARD, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#2A2A4A',
  },
  alertRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12,
  },
  alertLabel: { fontSize: 13, color: '#FAFAFA' },
  alertPill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  alertPillText: { fontSize: 11, color: '#FFF', fontWeight: '700' },
});

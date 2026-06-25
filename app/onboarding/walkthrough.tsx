import React, { useRef, useState } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  ListRenderItemInfo,
} from 'react-native';
import { Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useUpdateProfile } from '@/hooks/useProfile';
import { Text } from '@/components/ui/text';
import { useLanguage } from '@/hooks/useLanguage';

const AGENT_LOGO_DARK = require('@/assets/images/agent-logo-dark.png');

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Slide {
  key: string;
  icon: string;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    key: 'deadlines',
    icon: '🔔',
    title: 'Never miss a deadline',
    body: 'Tourly auto-calculates every ITF & ATP Tour deadline and sends you alerts before sign-up, withdrawal, and freeze dates close — color-coded by urgency.',
  },
  {
    key: 'expenses',
    icon: '💸',
    title: 'Track every dollar',
    body: 'Log flights, hotels, meals, and coaching per tournament. See your prize money vs. expenses and know exactly where your money goes.',
  },
  {
    key: 'insights',
    icon: '🤖',
    title: 'Your AI financial coach',
    body: 'Get personalized insights about your spending patterns, tournament ROI, and season trends — powered by AI that understands life on tour.',
  },
];

export default function WalkthroughScreen() {
  const router = useRouter();
  const { t } = useLanguage();
  const updateProfile = useUpdateProfile();
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList<Slide>>(null);
  const dotWidths = useRef(SLIDES.map((_, i) => new Animated.Value(i === 0 ? 20 : 8))).current;

  function animateDots(newIndex: number) {
    SLIDES.forEach((_, i) => {
      Animated.spring(dotWidths[i], {
        toValue: i === newIndex ? 20 : 8,
        useNativeDriver: false,
        speed: 20,
        bounciness: 0,
      }).start();
    });
  }

  function handleScroll(e: any) {
    const newIndex = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (newIndex !== activeIndex) {
      setActiveIndex(newIndex);
      animateDots(newIndex);
    }
  }

  function handleNext() {
    const nextIndex = activeIndex + 1;
    flatListRef.current?.scrollToIndex({ index: nextIndex, animated: true });
    setActiveIndex(nextIndex);
    animateDots(nextIndex);
  }

  async function handleGetStarted() {
    try {
      await updateProfile.mutateAsync({ onboarding_complete: true });
      router.replace('/(tabs)');
    } catch {
      router.replace('/(tabs)');
    }
  }

  const isLast = activeIndex === SLIDES.length - 1;

  function renderSlide({ item }: ListRenderItemInfo<Slide>) {
    return (
      <View style={s.slide}>
        <Image source={AGENT_LOGO_DARK} style={s.slideLogo} resizeMode="contain" />
        <Text style={s.slideTitle}>{item.title}</Text>
        <Text style={s.slideBody}>{item.body}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <FlatList
        ref={flatListRef}
        data={SLIDES}
        keyExtractor={(item) => item.key}
        renderItem={renderSlide}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={16}
        style={s.list}
        bounces={false}
      />

      <View style={s.dotsRow}>
        {SLIDES.map((slide, i) => (
          <Animated.View
            key={slide.key}
            style={[
              s.dot,
              { width: dotWidths[i] },
              i === activeIndex ? s.dotActive : s.dotInactive,
            ]}
          />
        ))}
      </View>

      <View style={[s.bottomRow, isLast && s.bottomRowCentered]}>
        {!isLast && (
          <TouchableOpacity onPress={handleGetStarted} activeOpacity={0.7} disabled={updateProfile.isPending}>
            <Text style={s.skipText}>{t('walkthrough.skip')}</Text>
          </TouchableOpacity>
        )}

        {!isLast ? (
          <TouchableOpacity style={s.nextBtn} onPress={handleNext} activeOpacity={0.85}>
            <Text style={s.nextBtnText}>{t('walkthrough.nextArrow')}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[s.getStartedBtn, updateProfile.isPending && s.btnDisabled]}
            onPress={handleGetStarted}
            activeOpacity={0.85}
            disabled={updateProfile.isPending}>
            <Text style={s.nextBtnText}>{t('walkthrough.getStarted')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAFAFA' },
  list: { flex: 1 },
  slide: {
    width: SCREEN_WIDTH,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 40,
  },
  slideLogo: {
    width: 120,
    height: 120,
  },
  slideTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#2D2B55',
    textAlign: 'center',
    marginTop: 24,
  },
  slideBody: {
    fontSize: 16,
    color: '#999999',
    lineHeight: 24,
    textAlign: 'center',
    marginHorizontal: 32,
    marginTop: 12,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 20,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  dotActive: { backgroundColor: '#00D4AA' },
  dotInactive: { backgroundColor: '#DDDDDD' },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingBottom: 28,
  },
  bottomRowCentered: {
    justifyContent: 'center',
  },
  skipText: {
    fontSize: 15,
    color: '#AAAAAA',
    fontWeight: '400',
  },
  nextBtn: {
    backgroundColor: '#00D4AA',
    borderRadius: 50,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  getStartedBtn: {
    backgroundColor: '#00D4AA',
    borderRadius: 14,
    paddingVertical: 17,
    paddingHorizontal: 48,
  },
  btnDisabled: { opacity: 0.5 },
  nextBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

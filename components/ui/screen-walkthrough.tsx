import React, { useState } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { useLanguage } from '@/hooks/useLanguage';

export interface WalkthroughStep {
  icon: string;
  title: string;
  body: string;
}

interface Props {
  steps: WalkthroughStep[];
  visible: boolean;
  onDismiss: () => void;
}

export function ScreenWalkthrough({ steps, visible, onDismiss }: Props) {
  const [index, setIndex] = useState(0);
  const { width } = useWindowDimensions();
  const { t } = useLanguage();
  const step = steps[index];
  const isLast = index === steps.length - 1;

  if (!visible || !step) return null;

  function handleNext() {
    if (isLast) {
      onDismiss();
      setIndex(0);
    } else {
      setIndex(i => i + 1);
    }
  }

  function handleSkip() {
    onDismiss();
    setIndex(0);
  }

  return (
    <Modal transparent animationType="fade" visible={visible} statusBarTranslucent>
      <View style={s.overlay}>
        <View style={[s.card, { maxWidth: width - 48 }]}>
          <Text style={s.icon}>{step.icon}</Text>
          <Text style={s.title}>{step.title}</Text>
          <Text style={s.body}>{step.body}</Text>

          <View style={s.dotsRow}>
            {steps.map((_, i) => (
              <View key={i} style={[s.dot, i === index && s.dotActive]} />
            ))}
          </View>

          <View style={s.btnRow}>
            {!isLast && (
              <TouchableOpacity onPress={handleSkip} activeOpacity={0.7}>
                <Text style={s.skipText}>{t('walkthrough.skip')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.nextBtn} onPress={handleNext} activeOpacity={0.85}>
              <Text style={s.nextText}>{isLast ? t('walkthrough.gotIt') : t('walkthrough.next')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#1A1A2E',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#5B5BD6',
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
    width: '100%',
  },
  icon: { fontSize: 40, marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '700', color: '#FAFAFA', textAlign: 'center', marginBottom: 8 },
  body: { fontSize: 14, color: '#999', lineHeight: 21, textAlign: 'center', marginBottom: 20 },
  dotsRow: { flexDirection: 'row', gap: 6, marginBottom: 20 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2A2A4A' },
  dotActive: { backgroundColor: '#5B5BD6', width: 20 },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    width: '100%',
  },
  skipText: { fontSize: 14, color: '#666', fontWeight: '500' },
  nextBtn: {
    backgroundColor: '#5B5BD6',
    borderRadius: 50,
    paddingVertical: 11,
    paddingHorizontal: 28,
  },
  nextText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});

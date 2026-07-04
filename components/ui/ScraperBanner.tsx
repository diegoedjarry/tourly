import React, { useEffect, useRef } from 'react';
import { View, TouchableOpacity, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/text';
import { T } from '@/constants/theme';
import { useScraperStatus } from '@/hooks/useScraperTrigger';

export function ScraperBanner() {
  const status = useScraperStatus();
  const router = useRouter();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (status === 'loading') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      pulse.stopAnimation();
      pulse.setValue(1);
    }
  }, [status]);

  if (status === 'idle') return null;

  const isComplete = status === 'complete';
  const isFailed   = status === 'failed';
  const accentColor = isComplete ? T.green : isFailed ? T.red : T.accent;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={isComplete ? () => router.push('/my-performance' as any) : undefined}
      style={{
        // pointerEvents belongs in style (the component prop is deprecated in RN ≥0.71)
        pointerEvents: isComplete ? 'auto' : 'none',
        position: 'absolute', bottom: 88, left: 16, right: 16,
        backgroundColor: T.card, borderRadius: 12, padding: 14,
        borderWidth: 1, borderColor: accentColor,
        flexDirection: 'row', alignItems: 'center', gap: 10,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35, shadowRadius: 10, elevation: 10,
      }}>
      {status === 'loading' && (
        <Animated.View style={{ opacity: pulse, width: 9, height: 9, borderRadius: 5, backgroundColor: T.accent }} />
      )}
      {isComplete && <Text style={{ fontSize: 15 }}>✓</Text>}
      {isFailed   && <Text style={{ fontSize: 15 }}>⚠</Text>}
      <Text style={{ fontSize: 13, fontWeight: '600', color: T.textPrimary, flex: 1, lineHeight: 18 }}>
        {isComplete
          ? 'Your ATP profile is ready! Check My Performance.'
          : isFailed
          ? 'ATP sync is taking longer than expected. Check My Performance later.'
          : 'Loading your ATP profile… this takes a few minutes.'}
      </Text>
      {isComplete && <Text style={{ fontSize: 20, color: T.green, fontWeight: '300' }}>›</Text>}
    </TouchableOpacity>
  );
}

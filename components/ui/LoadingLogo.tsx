import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { TourlyLogo } from './tourly-logo';

// Shows nothing for the first 300ms (avoids flicker on fast loads).
// After 300ms, fades in with a pulsing logo on the app's dark background.
export function LoadingLogo({ style }: { style?: object }) {
  const containerOpacity = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const showTimer = setTimeout(() => {
      Animated.timing(containerOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }, 300);

    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.0, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.6, duration: 900, useNativeDriver: true }),
      ])
    );
    pulseAnim.start();

    return () => {
      clearTimeout(showTimer);
      pulseAnim.stop();
    };
  }, []);

  return (
    <Animated.View style={[styles.container, style, { opacity: containerOpacity }]}>
      <Animated.View style={{ opacity: pulse }}>
        <TourlyLogo width={180} height={47} color="#FFFFFF" />
      </Animated.View>
    </Animated.View>
  );
}

// Wrapper that shows LoadingLogo while loading, then fades in children over 200ms.
export function LoadingFade({
  isLoading,
  children,
  style,
}: {
  isLoading: boolean;
  children: React.ReactNode;
  style?: object;
}) {
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const hasLoaded = useRef(false);

  useEffect(() => {
    if (!isLoading && !hasLoaded.current) {
      hasLoaded.current = true;
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [isLoading]);

  if (isLoading) return <LoadingLogo style={style} />;

  return (
    <Animated.View style={[{ flex: 1, opacity: contentOpacity }, style]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import { useRef, useMemo } from 'react';
import { PanResponder } from 'react-native';
import { usePathname, useRouter } from 'expo-router';

const TAB_ORDER = ['/(tabs)/alerts', '/(tabs)/tournaments', '/(tabs)', '/(tabs)/expenses', '/(tabs)/calendar'];

export function useTabSwipe() {
  const pathname = usePathname();
  const router = useRouter();
  const swipedRef = useRef(false);

  const panHandlers = useMemo(() => {
    const pr = PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 20 && Math.abs(gs.dy) < Math.abs(gs.dx) * 0.7,
      onPanResponderMove: (_, gs) => {
        if (swipedRef.current) return;
        if (Math.abs(gs.dx) > 50) {
          swipedRef.current = true;
          const idx = TAB_ORDER.findIndex(t =>
            pathname === '/' ? t === '/(tabs)' : t.endsWith(pathname),
          );
          if (idx < 0) return;
          const next = idx + (gs.dx < 0 ? 1 : -1);
          if (next >= 0 && next < TAB_ORDER.length) {
            router.navigate(TAB_ORDER[next] as any);
          }
        }
      },
      onPanResponderRelease: () => { swipedRef.current = false; },
      onPanResponderTerminate: () => { swipedRef.current = false; },
    });
    return pr.panHandlers;
  }, [pathname, router]);

  return panHandlers;
}

import React, { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { T } from '@/constants/theme';
import { DEMO_MODE } from '@/config/demo';
import { useLanguage } from '@/hooks/useLanguage';
import { getFailedQueueLength, retryFailedQueue } from '@/lib/offline-queue';

const POLL_INTERVAL_MS = 30000;

// Surfaces the offline-queue dead-letter store: mutations that failed to
// sync MAX_ATTEMPTS times and were parked out of the live retry queue.
// Without this, a user's edits can silently never reach the server.
export function SyncIssuesBanner() {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const [count, setCount] = useState(0);
  const [retrying, setRetrying] = useState(false);

  const refresh = useCallback(() => {
    getFailedQueueLength().then(setCount).catch(() => {});
  }, []);

  useEffect(() => {
    if (DEMO_MODE) return;
    refresh();
    const sub = AppState.addEventListener('change', next => { if (next === 'active') refresh(); });
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => { sub.remove(); clearInterval(interval); };
  }, [refresh]);

  if (DEMO_MODE || count === 0) return null;

  async function handleRetry() {
    setRetrying(true);
    try {
      await retryFailedQueue();
    } catch {
      // retryFailedQueue swallows its own errors internally; this is just a
      // belt-and-suspenders guard so a thrown error can't strand the button
      // in a disabled state.
    } finally {
      const remaining = await getFailedQueueLength().catch(() => count);
      setCount(remaining);
      setRetrying(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 10 }]}>
      <Text style={styles.text} numberOfLines={2}>
        {t('sync.failedCount').replace('{n}', String(count))}
      </Text>
      <TouchableOpacity
        style={[styles.btn, retrying && styles.btnDisabled]}
        onPress={handleRetry}
        disabled={retrying}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={t('sync.retry')}
      >
        <Text style={styles.btnText}>{t('sync.retry')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#3A1A1A',
    borderBottomWidth: 1,
    borderBottomColor: '#E24B4A',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#E24B4A',
    lineHeight: 18,
  },
  btn: {
    backgroundColor: '#E24B4A',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    fontSize: 13,
    fontWeight: '700',
    color: T.textPrimary,
  },
});

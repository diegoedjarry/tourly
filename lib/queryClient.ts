import { QueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = 'react-query-cache';

export async function clearPersistedCache() {
  queryClient.clear();
  await AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 60 * 24,
      retry: 2,
    },
  },
});

// Keys whose persisted data should never be restored on startup — they must
// always be fetched fresh (e.g. auth-sensitive data that could reflect a
// previous user's session).
const SKIP_RESTORE_KEYS = new Set(['profile']);

export function persistCacheToMmkv() {
  // Restore persisted cache on startup
  AsyncStorage.getItem(CACHE_KEY).then((raw) => {
    if (!raw) return;
    try {
      const entries = JSON.parse(raw);
      entries.forEach((entry: any) => {
        // Skip keys that must always be fetched fresh. Compare against the
        // first element of the query key (the "root" key), not the full
        // serialized string, so this is robust to keyed variants like
        // ['profile', userId].
        const rootKey = Array.isArray(entry.queryKey) ? entry.queryKey[0] : entry.queryKey;
        if (SKIP_RESTORE_KEYS.has(rootKey)) return;
        if (entry.state?.data) {
          queryClient.setQueryData(entry.queryKey, entry.state.data);
        }
      });
    } catch {}
  });

  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  queryClient.getQueryCache().subscribe(() => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try {
        const entries = queryClient.getQueryCache().getAll().map(q => ({
          queryKey: q.queryKey,
          queryHash: q.queryHash,
          state: q.state,
        }));
        AsyncStorage.setItem(CACHE_KEY, JSON.stringify(entries)).catch(() => {});
      } catch {}
    }, 2000);
  });
}

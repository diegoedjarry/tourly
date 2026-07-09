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

// Persisting the full q.state per entry (fetch metadata, errors, etc.) made the
// stored blob grow with every query variant ever seen. Persist only the data
// payload per query, and refuse to write past a hard size cap — a cold start
// without cache is strictly better than multi-MB AsyncStorage reads/writes on
// every mutation for a full season of data.
const MAX_PERSIST_BYTES = 2_000_000;

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
        // New format stores `data` directly; old format nested it in `state`.
        const data = entry.data ?? entry.state?.data;
        if (data) {
          queryClient.setQueryData(entry.queryKey, data);
        }
      });
    } catch {}
  });

  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  queryClient.getQueryCache().subscribe(() => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try {
        const entries = queryClient.getQueryCache().getAll()
          .filter(q => q.state.data !== undefined)
          .map(q => ({
            queryKey: q.queryKey,
            data: q.state.data,
          }));
        const serialized = JSON.stringify(entries);
        if (serialized.length > MAX_PERSIST_BYTES) return;
        AsyncStorage.setItem(CACHE_KEY, serialized).catch(() => {});
      } catch {}
    }, 2000);
  });
}

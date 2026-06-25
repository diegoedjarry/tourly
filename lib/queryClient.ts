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

export function persistCacheToMmkv() {
  if (typeof window === 'undefined') return;
  // Restore persisted cache on startup
  AsyncStorage.getItem(CACHE_KEY).then((raw) => {
    if (!raw) return;
    try {
      const entries = JSON.parse(raw);
      entries.forEach((entry: any) => {
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

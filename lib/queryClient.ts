import { QueryClient } from '@tanstack/react-query';
import { MMKV } from 'react-native-mmkv';

export const mmkv = new MMKV({ id: 'tourly-query-cache' });

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,      // 5 min — don't refetch if data is fresh
      gcTime: 1000 * 60 * 60 * 24,   // 24 hr — keep in memory
      retry: 2,
    },
  },
});

// Persist cache to MMKV so it survives app restarts
export function persistCacheToMmkv() {
  const CACHE_KEY = 'react-query-cache';
  // Save on cache change
  queryClient.getQueryCache().subscribe(() => {
    try {
      mmkv.set(CACHE_KEY, JSON.stringify(queryClient.getQueryCache().getAll().map(q => ({
        queryKey: q.queryKey,
        queryHash: q.queryHash,
        state: q.state,
      }))));
    } catch {}
  });
  // Restore on startup
  try {
    const cached = mmkv.getString(CACHE_KEY);
    if (cached) {
      const entries = JSON.parse(cached);
      entries.forEach((entry: any) => {
        if (entry.state?.data) {
          queryClient.setQueryData(entry.queryKey, entry.state.data);
        }
      });
    }
  } catch {}
}

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DEMO_MODE } from '@/config/demo';

/**
 * Shared pull-to-refresh handler for tab/detail screens.
 *
 * In demo mode there is no backend to refetch from, so this resolves
 * immediately (a brief spinner) instead of doing nothing silently.
 */
export function usePullToRefresh() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (DEMO_MODE) {
        await new Promise(resolve => setTimeout(resolve, 300));
      } else {
        await queryClient.invalidateQueries();
      }
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  return { refreshing, onRefresh };
}

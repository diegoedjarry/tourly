import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { DEMO_MODE } from '@/config/demo';
import { getDeletedTournamentIds } from '@/lib/deleted-tournaments';
import type { Tournament } from '@/lib/database.types';

const QUERY_KEY = ['tournaments'];

export function useTournaments() {
  return useQuery({
    queryKey: QUERY_KEY,
    enabled: !DEMO_MODE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tournaments')
        .select('*')
        .order('start_date', { ascending: true });
      if (error) throw error;
      // Filter out tournaments an offline delete has tombstoned but not yet
      // flushed to the server — otherwise a refetch landing before the queued
      // delete runs resurrects the row on screen.
      const deletedIds = await getDeletedTournamentIds();
      return (data as Tournament[]).filter(t => !deletedIds.has(t.id));
    },
  });
}

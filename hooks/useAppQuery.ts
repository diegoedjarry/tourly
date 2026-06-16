import { db } from '@/db';
import { DEMO_MODE } from '@/config/demo';
import { useDemoData } from './useDemoData';

export function useAppQuery(_query: Parameters<typeof db.useQuery>[0]) {
  const result = db.useQuery(_query);
  const demoCtx = useDemoData();
  if (DEMO_MODE && demoCtx) {
    return { data: demoCtx.demoData as any, isLoading: false, error: null };
  }
  return result;
}

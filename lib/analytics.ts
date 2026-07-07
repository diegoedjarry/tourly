// First-party usage analytics — batched inserts into the `analytics_events`
// table (insert-only RLS; nobody can read events through the API). No external
// SDK: events stay in Tourly's own database and can be queried from the
// Supabase SQL editor, e.g.
//   select screen, count(*) from analytics_events
//   where event = 'screen_view' and created_at > now() - interval '30 days'
//   group by screen order by count desc;
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '@/lib/supabase';
import { DEMO_MODE } from '@/config/demo';

interface QueuedEvent {
  event: string;
  screen: string | null;
  props: Record<string, unknown> | null;
  created_at: string;
}

const FLUSH_INTERVAL_MS = 30_000;
const MAX_QUEUE = 20;

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let appStateHooked = false;

async function flush(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    const { data: { user } } = await supabase.auth.getUser();
    // RLS requires user_id = auth.uid(); signed-out events are dropped.
    if (!user) return;
    const rows = batch.map(e => ({
      user_id: user.id,
      event: e.event,
      screen: e.screen,
      props: e.props,
      app_version: Constants.expoConfig?.version ?? null,
      platform: Platform.OS,
      created_at: e.created_at,
    }));
    await supabase.from('analytics_events').insert(rows);
  } catch {
    // Analytics must never surface an error to the user; the batch is dropped.
  }
}

function ensureScheduler(): void {
  if (!timer) {
    timer = setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);
  }
  if (!appStateHooked) {
    appStateHooked = true;
    AppState.addEventListener('change', state => {
      if (state === 'background' || state === 'inactive') void flush();
    });
  }
}

function enqueue(e: QueuedEvent): void {
  if (DEMO_MODE) return;
  queue.push(e);
  ensureScheduler();
  if (queue.length >= MAX_QUEUE) void flush();
}

/** Record a discrete action, e.g. track('expense_added', { category }). */
export function track(event: string, props?: Record<string, unknown>): void {
  enqueue({ event, screen: null, props: props ?? null, created_at: new Date().toISOString() });
}

/** Record a screen view — wired to the router in the root layout. */
export function trackScreen(screen: string): void {
  enqueue({ event: 'screen_view', screen, props: null, created_at: new Date().toISOString() });
}

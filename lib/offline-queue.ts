import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { queryClient } from './queryClient';
import { supabase } from './supabase';

const QUEUE_KEY = '@tourly_offline_queue';
const FAILED_QUEUE_KEY = '@tourly_offline_queue_failed';
const MAX_ATTEMPTS = 5;
const MUTATION_TIMEOUT_MS = 15000;

interface QueuedMutation {
  id: string;
  table: string;
  action: 'insert' | 'update' | 'delete';
  data?: Record<string, any>;
  matchId?: string;
  userId: string;
  createdAt: number;
  attempts?: number;
}

let processing = false;

// Serializes all queue-mutating operations (enqueue + processQueue) through a
// single in-process promise chain so concurrent calls never interleave reads/writes.
let chain: Promise<any> = Promise.resolve();
function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = chain.then(fn, fn); // run after prior op regardless of its outcome
  chain = result.catch(() => {}); // don't let one failure break the chain
  return result;
}

function toSnake(obj: Record<string, any>): Record<string, any> {
  const convert = (s: string) => s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [convert(k), v]));
}

function withTimeout<T>(p: PromiseLike<T>, ms = MUTATION_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

async function getQueue(): Promise<QueuedMutation[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function saveQueue(queue: QueuedMutation[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

async function getFailedQueue(): Promise<QueuedMutation[]> {
  const raw = await AsyncStorage.getItem(FAILED_QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

// Dead-letter queue is diagnostic only — cap it so it can't grow unbounded
// across months of flaky-network sessions. Oldest entries are dropped first.
const MAX_FAILED_QUEUE = 50;

async function saveFailedQueue(queue: QueuedMutation[]) {
  const capped = queue.length > MAX_FAILED_QUEUE ? queue.slice(-MAX_FAILED_QUEUE) : queue;
  await AsyncStorage.setItem(FAILED_QUEUE_KEY, JSON.stringify(capped));
}

export async function enqueue(mutation: Omit<QueuedMutation, 'id' | 'createdAt'>) {
  return withQueueLock(async () => {
    const queue = await getQueue();
    // Preserve any id already present on the payload (e.g. a client-generated
    // id set by the optimistic-update path) so inserts stay idempotent across
    // replays. Only generate a new one if the mutation doesn't already have one.
    const existingId = (mutation as Partial<QueuedMutation>).id;
    queue.push({
      ...mutation,
      id: existingId || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      createdAt: Date.now(),
      attempts: 0,
    });
    await saveQueue(queue);
  });
}

type MutationResult = 'success' | 'retry' | 'fatal';

async function executeMutation(m: QueuedMutation): Promise<MutationResult> {
  try {
    const { data: { user } } = await withTimeout(supabase.auth.getUser());
    if (!user) return 'fatal';
    if (user.id !== m.userId) return 'fatal';

    if (m.action === 'insert' && m.data) {
      // Client-generated id (set at enqueue time) makes replays idempotent:
      // if a prior attempt's response was lost after the server committed,
      // the upsert on id simply no-ops instead of creating a duplicate row.
      const payload = { id: m.id, ...toSnake(m.data), user_id: m.userId };
      const { error } = await withTimeout(
        supabase.from(m.table).upsert(payload, { onConflict: 'id' })
      );
      if (error) throw error;
    } else if (m.action === 'update' && m.matchId && m.data) {
      const { error } = await withTimeout(
        supabase.from(m.table).update(toSnake(m.data)).eq('id', m.matchId)
      );
      if (error) throw error;
    } else if (m.action === 'delete' && m.matchId) {
      const { error } = await withTimeout(
        supabase.from(m.table).delete().eq('id', m.matchId)
      );
      if (error) throw error;
    }
    return 'success';
  } catch {
    return 'retry';
  }
}

export async function processQueue() {
  if (processing) return;
  processing = true;

  try {
    const net = await NetInfo.fetch();
    if (!net.isConnected) return;

    await withQueueLock(async () => {
      const queue = await getQueue();
      if (queue.length === 0) return;

      const succeededIds = new Set<string>();
      const failedOutright = new Map<string, QueuedMutation>(); // fatal (e.g. auth) -> dead-letter immediately
      const attemptIncrements = new Map<string, number>(); // id -> new attempts count for retry items that hit the cap

      for (const m of queue) {
        const result = await executeMutation(m);
        if (result === 'success') {
          succeededIds.add(m.id);
        } else if (result === 'fatal') {
          // Auth mismatch / no session is permanent-until-relogin — no point retrying.
          failedOutright.set(m.id, { ...m, attempts: (m.attempts ?? 0) + 1 });
        } else {
          const attempts = (m.attempts ?? 0) + 1;
          attemptIncrements.set(m.id, attempts);
        }
      }

      // Re-read the queue fresh right before the final save so mutations
      // enqueued by other parts of the app while this loop was running
      // (network round-trips above) are not silently dropped.
      const latest = await getQueue();
      const remaining: QueuedMutation[] = [];
      const newlyDeadLettered: QueuedMutation[] = [];

      for (const m of latest) {
        if (succeededIds.has(m.id)) continue;

        if (failedOutright.has(m.id)) {
          newlyDeadLettered.push(failedOutright.get(m.id)!);
          continue;
        }

        if (attemptIncrements.has(m.id)) {
          const attempts = attemptIncrements.get(m.id)!;
          if (attempts >= MAX_ATTEMPTS) {
            newlyDeadLettered.push({ ...m, attempts });
            continue;
          }
          remaining.push({ ...m, attempts });
          continue;
        }

        // Untouched this pass (e.g. enqueued after the snapshot was taken).
        remaining.push(m);
      }

      await saveQueue(remaining);

      if (newlyDeadLettered.length > 0) {
        const failedQueue = await getFailedQueue();
        await saveFailedQueue([...failedQueue, ...newlyDeadLettered]);
      }

      if (succeededIds.size > 0) {
        queryClient.invalidateQueries({ queryKey: ['tournaments'] });
        queryClient.invalidateQueries({ queryKey: ['expenses'] });
      }
    });
  } finally {
    processing = false;
  }
}

export async function getQueueLength(): Promise<number> {
  const queue = await getQueue();
  return queue.length;
}

export async function getFailedQueueLength(): Promise<number> {
  const failedQueue = await getFailedQueue();
  return failedQueue.length;
}

export async function clearQueue(): Promise<void> {
  await withQueueLock(async () => {
    await AsyncStorage.removeItem(QUEUE_KEY);
    await AsyncStorage.removeItem(FAILED_QUEUE_KEY);
  });
}

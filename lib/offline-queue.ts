import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { queryClient } from './queryClient';
import { supabase } from './supabase';

const QUEUE_KEY = '@tourly_offline_queue';

interface QueuedMutation {
  id: string;
  table: string;
  action: 'insert' | 'update' | 'delete';
  data?: Record<string, any>;
  matchId?: string;
  userId: string;
  createdAt: number;
}

let processing = false;

function toSnake(obj: Record<string, any>): Record<string, any> {
  const convert = (s: string) => s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [convert(k), v]));
}

async function getQueue(): Promise<QueuedMutation[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function saveQueue(queue: QueuedMutation[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueue(mutation: Omit<QueuedMutation, 'id' | 'createdAt'>) {
  const queue = await getQueue();
  queue.push({
    ...mutation,
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  });
  await saveQueue(queue);
}

async function executeMutation(m: QueuedMutation): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    if (user.id !== m.userId) return false;

    if (m.action === 'insert' && m.data) {
      const payload = { ...toSnake(m.data), user_id: m.userId };
      const { error } = await supabase.from(m.table).insert(payload);
      if (error) throw error;
    } else if (m.action === 'update' && m.matchId && m.data) {
      const { error } = await supabase.from(m.table).update(toSnake(m.data)).eq('id', m.matchId);
      if (error) throw error;
    } else if (m.action === 'delete' && m.matchId) {
      const { error } = await supabase.from(m.table).delete().eq('id', m.matchId);
      if (error) throw error;
    }
    return true;
  } catch {
    return false;
  }
}

export async function processQueue() {
  if (processing) return;
  processing = true;

  try {
    const net = await NetInfo.fetch();
    if (!net.isConnected) return;

    const queue = await getQueue();
    if (queue.length === 0) return;

    const remaining: QueuedMutation[] = [];
    for (const m of queue) {
      const ok = await executeMutation(m);
      if (!ok) remaining.push(m);
    }

    await saveQueue(remaining);

    if (remaining.length < queue.length) {
      queryClient.invalidateQueries({ queryKey: ['tournaments'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    }
  } finally {
    processing = false;
  }
}

export async function getQueueLength(): Promise<number> {
  const queue = await getQueue();
  return queue.length;
}

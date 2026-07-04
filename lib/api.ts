import { Alert } from 'react-native';
import { supabase } from './supabase';
import { queryClient } from './queryClient';
import NetInfo from '@react-native-community/netinfo';
import { enqueue } from './offline-queue';
import { t as i18nT } from './i18n';
import { getCurrentLang } from '@/hooks/useLanguage';

// Tell the user their write was queued, not sent. Debounced so multi-row
// saves (e.g. paste imports) show at most one notice per burst.
let lastQueuedNotice = 0;
function notifyQueued() {
  const now = Date.now();
  if (now - lastQueuedNotice < 4000) return;
  lastQueuedNotice = now;
  try {
    Alert.alert(i18nT('common.savedOffline', getCurrentLang()));
  } catch {
    // Non-fatal — the write is safely queued either way.
  }
}

function toSnake(obj: Record<string, any>): Record<string, any> {
  const convert = (s: string) => s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [convert(k), v]));
}

async function isOffline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return !state.isConnected;
  } catch {
    return true;
  }
}

export async function apiPatchTournament(id: string, updates: Record<string, any>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  if (await isOffline()) {
    await enqueue({ table: 'tournaments', action: 'update', data: updates, matchId: id, userId: user.id });
    notifyQueued();
    return;
  }
  const { error } = await supabase.from('tournaments').update(toSnake(updates)).eq('id', id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ['tournaments'] });
}

export async function apiAddTournament(data: Record<string, any>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  if (await isOffline()) {
    await enqueue({ table: 'tournaments', action: 'insert', data, userId: user.id });
    notifyQueued();
    return data;
  }
  const { data: row, error } = await supabase
    .from('tournaments')
    .insert({ ...toSnake(data), user_id: user.id })
    .select()
    .single();
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ['tournaments'] });
  return row;
}

export async function apiAddExpense(data: Record<string, any>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  if (await isOffline()) {
    await enqueue({ table: 'expenses', action: 'insert', data, userId: user.id });
    notifyQueued();
    return data;
  }
  const { data: row, error } = await supabase
    .from('expenses')
    .insert({ ...toSnake(data), user_id: user.id })
    .select()
    .single();
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ['expenses'] });
  return row;
}

export async function apiUpdateExpense(id: string, updates: Record<string, any>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  if (await isOffline()) {
    await enqueue({ table: 'expenses', action: 'update', data: updates, matchId: id, userId: user.id });
    notifyQueued();
    return;
  }
  const { error } = await supabase.from('expenses').update(toSnake(updates)).eq('id', id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ['expenses'] });
}

export async function apiDeleteExpense(id: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  if (await isOffline()) {
    await enqueue({ table: 'expenses', action: 'delete', matchId: id, userId: user.id });
    notifyQueued();
    return;
  }
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ['expenses'] });
}

export async function apiDeleteTournament(id: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  if (await isOffline()) {
    await enqueue({ table: 'tournaments', action: 'delete', matchId: id, userId: user.id });
    notifyQueued();
    return;
  }
  const { error } = await supabase.from('tournaments').delete().eq('id', id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ['tournaments'] });
}

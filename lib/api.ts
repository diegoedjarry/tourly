import { Alert } from 'react-native';
import { supabase } from './supabase';
import { queryClient } from './queryClient';
import NetInfo from '@react-native-community/netinfo';
import { enqueue } from './offline-queue';
import { t as i18nT } from './i18n';
import { getCurrentLang } from '@/hooks/useLanguage';
import { recordDeletedTournament } from './deleted-tournaments';

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

// ── Optimistic cache primitives ──────────────────────────────────────────────
// Every mutation applies its change to the react-query cache BEFORE the network
// round-trip, so the UI updates instantly (native-feel, no frozen spinners).
// On server error the snapshot is restored and the error rethrown for the
// caller's alert. Offline writes keep their optimistic row — the queue flush
// invalidates and reconciles on reconnect.
type Row = Record<string, any>;

function optimisticInsert(key: string[], row: Row): () => void {
  const previous = queryClient.getQueryData<Row[]>(key);
  queryClient.setQueryData<Row[]>(key, (old) => [row, ...(old ?? [])]);
  return () => queryClient.setQueryData(key, previous);
}

function optimisticMerge(key: string[], id: string, patch: Row): () => void {
  const previous = queryClient.getQueryData<Row[]>(key);
  queryClient.setQueryData<Row[]>(key, (old) =>
    (old ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return () => queryClient.setQueryData(key, previous);
}

function optimisticRemove(key: string[], id: string): () => void {
  const previous = queryClient.getQueryData<Row[]>(key);
  queryClient.setQueryData<Row[]>(key, (old) => (old ?? []).filter((r) => r.id !== id));
  return () => queryClient.setQueryData(key, previous);
}

function replaceRow(key: string[], tempId: string, serverRow: Row) {
  queryClient.setQueryData<Row[]>(key, (old) =>
    (old ?? []).map((r) => (r.id === tempId ? serverRow : r)));
}

const tempId = () => `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export async function apiPatchTournament(id: string, updates: Record<string, any>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const rollback = optimisticMerge(['tournaments'], id, toSnake(updates));
  if (await isOffline()) {
    await enqueue({ table: 'tournaments', action: 'update', data: updates, matchId: id, userId: user.id });
    notifyQueued();
    return;
  }
  const { error } = await supabase.from('tournaments').update(toSnake(updates)).eq('id', id);
  if (error) { rollback(); throw error; }
  queryClient.invalidateQueries({ queryKey: ['tournaments'] });
}

// Optimistically-locked patch for BACKGROUND writes (deadline reconciliation).
// Only applies when the row's updated_at still equals the value we read — the
// tournaments_updated_at trigger bumps it on every update, so any concurrent
// user edit makes this a silent no-op instead of clobbering their change.
// Skips entirely when offline: queueing a stale guarded write is pointless.
export async function apiPatchTournamentIfUnchanged(
  id: string,
  updates: Record<string, any>,
  lastKnownUpdatedAt: string | null,
) {
  if (await isOffline()) return;
  let query = supabase.from('tournaments').update(toSnake(updates)).eq('id', id);
  // Rows predating the updated_at column may carry null — fall back to the
  // unguarded behavior for those (same semantics as before this guard existed).
  if (lastKnownUpdatedAt) query = query.eq('updated_at', lastKnownUpdatedAt);
  const { error } = await query;
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ['tournaments'] });
}

export async function apiAddTournament(data: Record<string, any>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const optimistic = { ...toSnake(data), id: tempId(), user_id: user.id, created_at: new Date().toISOString() };
  const rollback = optimisticInsert(['tournaments'], optimistic);
  if (await isOffline()) {
    await enqueue({ table: 'tournaments', action: 'insert', data, userId: user.id });
    notifyQueued();
    return optimistic;
  }
  const { data: row, error } = await supabase
    .from('tournaments')
    .insert({ ...toSnake(data), user_id: user.id })
    .select()
    .single();
  if (error) { rollback(); throw error; }
  replaceRow(['tournaments'], optimistic.id, row);
  queryClient.invalidateQueries({ queryKey: ['tournaments'] });
  return row;
}

export async function apiAddExpense(data: Record<string, any>) {
  if (!Number.isFinite(data.amount) || data.amount <= 0) {
    throw new Error('Invalid expense amount.');
  }
  if (data.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    throw new Error('Invalid expense date.');
  }
  if (!data.category || typeof data.category !== 'string' || !data.category.trim()) {
    throw new Error('Expense category is required.');
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const optimistic = { ...toSnake(data), id: tempId(), user_id: user.id, created_at: new Date().toISOString() };
  const rollback = optimisticInsert(['expenses'], optimistic);
  if (await isOffline()) {
    await enqueue({ table: 'expenses', action: 'insert', data, userId: user.id });
    notifyQueued();
    return optimistic;
  }
  const { data: row, error } = await supabase
    .from('expenses')
    .insert({ ...toSnake(data), user_id: user.id })
    .select()
    .single();
  if (error) { rollback(); throw error; }
  replaceRow(['expenses'], optimistic.id, row);
  queryClient.invalidateQueries({ queryKey: ['expenses'] });
  return row;
}

export async function apiUpdateExpense(id: string, updates: Record<string, any>) {
  if ('amount' in updates && (!Number.isFinite(updates.amount) || updates.amount <= 0)) {
    throw new Error('Invalid expense amount.');
  }
  if ('date' in updates && updates.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(updates.date)) {
    throw new Error('Invalid expense date.');
  }
  if ('category' in updates && (!updates.category || typeof updates.category !== 'string' || !updates.category.trim())) {
    throw new Error('Expense category is required.');
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const rollback = optimisticMerge(['expenses'], id, toSnake(updates));
  if (await isOffline()) {
    await enqueue({ table: 'expenses', action: 'update', data: updates, matchId: id, userId: user.id });
    notifyQueued();
    return;
  }
  const { error } = await supabase.from('expenses').update(toSnake(updates)).eq('id', id);
  if (error) { rollback(); throw error; }
  queryClient.invalidateQueries({ queryKey: ['expenses'] });
}

export async function apiDeleteExpense(id: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const rollback = optimisticRemove(['expenses'], id);
  if (await isOffline()) {
    await enqueue({ table: 'expenses', action: 'delete', matchId: id, userId: user.id });
    notifyQueued();
    return;
  }
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) { rollback(); throw error; }
  queryClient.invalidateQueries({ queryKey: ['expenses'] });
}

export async function apiDeleteTournament(id: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  // Tombstone first — a delete that later fails server-side just means the row
  // reappears in data and the tombstone expires in 30 days; do not roll it back.
  await recordDeletedTournament(id);
  const rollback = optimisticRemove(['tournaments'], id);
  if (await isOffline()) {
    await enqueue({ table: 'tournaments', action: 'delete', matchId: id, userId: user.id });
    notifyQueued();
    return;
  }
  const { error } = await supabase.from('tournaments').delete().eq('id', id);
  if (error) { rollback(); throw error; }
  queryClient.invalidateQueries({ queryKey: ['tournaments'] });
}

export async function apiAddIncome(data: Record<string, any>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const optimistic = { ...toSnake(data), id: tempId(), user_id: user.id, created_at: new Date().toISOString() };
  const rollback = optimisticInsert(['income'], optimistic);
  if (await isOffline()) {
    await enqueue({ table: 'income', action: 'insert', data, userId: user.id });
    notifyQueued();
    return optimistic;
  }
  const { data: row, error } = await supabase
    .from('income')
    .insert({ ...toSnake(data), user_id: user.id })
    .select()
    .single();
  if (error) { rollback(); throw error; }
  replaceRow(['income'], optimistic.id, row);
  queryClient.invalidateQueries({ queryKey: ['income'] });
  return row;
}

export async function apiUpdateIncome(id: string, updates: Record<string, any>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const rollback = optimisticMerge(['income'], id, toSnake(updates));
  if (await isOffline()) {
    await enqueue({ table: 'income', action: 'update', data: updates, matchId: id, userId: user.id });
    notifyQueued();
    return;
  }
  const { error } = await supabase.from('income').update(toSnake(updates)).eq('id', id);
  if (error) { rollback(); throw error; }
  queryClient.invalidateQueries({ queryKey: ['income'] });
}

export async function apiDeleteIncome(id: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const rollback = optimisticRemove(['income'], id);
  if (await isOffline()) {
    await enqueue({ table: 'income', action: 'delete', matchId: id, userId: user.id });
    notifyQueued();
    return;
  }
  const { error } = await supabase.from('income').delete().eq('id', id);
  if (error) { rollback(); throw error; }
  queryClient.invalidateQueries({ queryKey: ['income'] });
}

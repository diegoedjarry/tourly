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
    // Only an explicit false counts as offline — `isConnected` can be `null`
    // (unknown) briefly after cold start, especially on iOS, and treating
    // that as offline silently queues the write with a confusing notice.
    return state.isConnected === false;
  } catch {
    return true;
  }
}

// ── Optimistic cache primitives ──────────────────────────────────────────────
// Every mutation applies its change to the react-query cache BEFORE the network
// round-trip, so the UI updates instantly (native-feel, no frozen spinners).
// On server error the rollback below is applied and the error rethrown for the
// caller's alert. Offline writes keep their optimistic row — the queue flush
// invalidates and reconciles on reconnect.
//
// Rollbacks are mutation-scoped (not whole-array snapshots): if two mutations
// overlap and the earlier one fails after the later one applied, undoing the
// earlier one must not resurrect state the later one already changed.
type Row = Record<string, any>;

function optimisticInsert(key: string[], row: Row): () => void {
  queryClient.setQueryData<Row[]>(key, (old) => [row, ...(old ?? [])]);
  // Rollback removes exactly the row we inserted, by id — untouched by any
  // other insert/merge/remove that happened on this key in the meantime.
  return () => queryClient.setQueryData<Row[]>(key, (old) =>
    (old ?? []).filter((r) => r.id !== row.id));
}

function optimisticMerge(key: string[], id: string, patch: Row): () => void {
  const current = queryClient.getQueryData<Row[]>(key);
  const target = current?.find((r) => r.id === id);
  // Capture prior values for only the keys we're about to patch, so rollback
  // restores just those fields on this row and leaves everything else (other
  // rows, other concurrently-patched keys on this row) alone.
  const priorValues: Row = {};
  if (target) {
    for (const k of Object.keys(patch)) priorValues[k] = target[k];
  }
  queryClient.setQueryData<Row[]>(key, (old) =>
    (old ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return () => queryClient.setQueryData<Row[]>(key, (old) =>
    (old ?? []).map((r) => (r.id === id ? { ...r, ...priorValues } : r)));
}

function optimisticRemove(key: string[], id: string): () => void {
  const current = queryClient.getQueryData<Row[]>(key);
  const removed = current?.find((r) => r.id === id);
  queryClient.setQueryData<Row[]>(key, (old) => (old ?? []).filter((r) => r.id !== id));
  // Rollback re-inserts the captured row, but only if nothing else already
  // re-added a row with that id in the meantime.
  return () => {
    if (!removed) return;
    queryClient.setQueryData<Row[]>(key, (old) => {
      if ((old ?? []).some((r) => r.id === id)) return old ?? [];
      return [removed, ...(old ?? [])];
    });
  };
}

// With a client-supplied uuid (see newRowId below), the optimistic row and the
// server-returned row share the same id — replacing is a no-op in the common
// case, but this stays in place as a safety net for callers/paths that mutate
// the row server-side (e.g. defaults applied by a trigger) so the cache still
// reconciles to the authoritative row shape.
function replaceRow(key: string[], id: string, serverRow: Row) {
  queryClient.setQueryData<Row[]>(key, (old) =>
    (old ?? []).map((r) => (r.id === id ? serverRow : r)));
}

// Client-generated uuid v4 for new rows. Postgres `id uuid` columns reject the
// old `optimistic-<timestamp>` placeholder ids, so every insert (online or
// offline) now gets a real uuid up front — used as the optimistic cache row
// id, the queued mutation id, AND the online insert payload id. That keeps
// both paths symmetric and offline replays idempotent via upsert-on-id.
//
// Hermes has no crypto.randomUUID — react-native-get-random-values (imported
// first thing in app/_layout.tsx) polyfills only getRandomValues, so on
// device the RFC-4122 v4 uuid is built from random bytes here. Browsers take
// the native randomUUID fast path.
function newRowId(): string {
  const c = (globalThis as any).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const h = Array.from(b, (x: number) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

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
  const id = newRowId();
  const optimistic = { ...toSnake(data), id, user_id: user.id, created_at: new Date().toISOString() };
  const rollback = optimisticInsert(['tournaments'], optimistic);
  if (await isOffline()) {
    await enqueue({ id, table: 'tournaments', action: 'insert', data, userId: user.id });
    notifyQueued();
    return optimistic;
  }
  const { data: row, error } = await supabase
    .from('tournaments')
    .insert({ ...toSnake(data), id, user_id: user.id })
    .select()
    .single();
  if (error) { rollback(); throw error; }
  replaceRow(['tournaments'], id, row);
  queryClient.invalidateQueries({ queryKey: ['tournaments'] });
  return row;
}

export async function apiAddExpense(data: Record<string, any>) {
  // Negative amounts are valid — they represent refunds/credits (see the
  // import flow in utils/import-expenses.ts, which stores negative amounts
  // directly). Only zero and non-finite values are rejected.
  if (!Number.isFinite(data.amount) || data.amount === 0) {
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
  const id = newRowId();
  const optimistic = { ...toSnake(data), id, user_id: user.id, created_at: new Date().toISOString() };
  const rollback = optimisticInsert(['expenses'], optimistic);
  if (await isOffline()) {
    await enqueue({ id, table: 'expenses', action: 'insert', data, userId: user.id });
    notifyQueued();
    return optimistic;
  }
  const { data: row, error } = await supabase
    .from('expenses')
    .insert({ ...toSnake(data), id, user_id: user.id })
    .select()
    .single();
  if (error) { rollback(); throw error; }
  replaceRow(['expenses'], id, row);
  queryClient.invalidateQueries({ queryKey: ['expenses'] });
  return row;
}

export async function apiUpdateExpense(id: string, updates: Record<string, any>) {
  // Negative amounts are valid — imported refund rows carry a negative amount
  // and must remain editable. Only zero and non-finite values are rejected
  // (kept consistent with apiAddExpense above).
  if ('amount' in updates && (!Number.isFinite(updates.amount) || updates.amount === 0)) {
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
  const id = newRowId();
  const optimistic = { ...toSnake(data), id, user_id: user.id, created_at: new Date().toISOString() };
  const rollback = optimisticInsert(['income'], optimistic);
  if (await isOffline()) {
    await enqueue({ id, table: 'income', action: 'insert', data, userId: user.id });
    notifyQueued();
    return optimistic;
  }
  const { data: row, error } = await supabase
    .from('income')
    .insert({ ...toSnake(data), id, user_id: user.id })
    .select()
    .single();
  if (error) { rollback(); throw error; }
  replaceRow(['income'], id, row);
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

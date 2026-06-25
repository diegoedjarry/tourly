import { supabase } from './supabase';
import { queryClient } from './queryClient';
import NetInfo from '@react-native-community/netinfo';
import { enqueue } from './offline-queue';

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
    return;
  }
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ['expenses'] });
}

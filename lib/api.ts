import { supabase } from './supabase';
import { queryClient } from './queryClient';

function toSnake(obj: Record<string, any>): Record<string, any> {
  const convert = (s: string) => s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [convert(k), v]));
}

export async function apiPatchTournament(id: string, updates: Record<string, any>) {
  const { error } = await supabase.from('tournaments').update(toSnake(updates)).eq('id', id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ['tournaments'] });
}

export async function apiAddTournament(data: Record<string, any>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
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
  const { error } = await supabase.from('expenses').update(toSnake(updates)).eq('id', id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ['expenses'] });
}

export async function apiDeleteExpense(id: string) {
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ['expenses'] });
}

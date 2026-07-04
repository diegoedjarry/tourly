import { useMemo } from 'react';
import { DEMO_MODE } from '@/config/demo';
import { useDemoData } from './useDemoData';
import { useTournaments } from './useTournaments';
import { useExpenses } from './useExpenses';
import type { Tournament, Expense } from '@/lib/database.types';

function mapTournament(t: Tournament) {
  return {
    id: t.id,
    name: t.name,
    country: t.country,
    city: t.city,
    surface: t.surface,
    category: t.category,
    startDate: t.start_date,
    endDate: t.end_date,
    signUpDeadline: t.sign_up_deadline,
    withdrawalDeadline: t.withdrawal_deadline,
    freezeDeadline: t.freeze_deadline,
    isRegistered: t.is_registered,
    isWithdrawn: t.is_withdrawn,
    isInMyList: t.is_in_my_list,
    prizeMoney: t.prize_money,
    singlesPrizeMoney: t.singles_prize_money,
    doublesPrizeMoney: t.doubles_prize_money,
    status: t.status,
    createdAt: t.created_at,
  };
}

function mapExpense(e: Expense) {
  return {
    id: e.id,
    tournamentId: e.tournament_id,
    category: e.category,
    amount: e.amount,
    // Original transaction currency (ISO 4217) as charged — never converted.
    currency: (e as any).currency ?? 'USD',
    merchant: (e as any).merchant ?? null,
    date: e.date,
    note: e.note,
    isCoachExpense: e.is_coach_expense ?? false,
    createdAt: e.created_at,
  };
}

export function useAppQuery(_query: any) {
  const demoCtx = useDemoData();
  const { data: tournaments, isLoading: tLoading, isFetching: tFetching } = useTournaments();
  const { data: expenses, isLoading: eLoading, isFetching: eFetching } = useExpenses();

  const mappedTournaments = useMemo(
    () => (tournaments ?? []).map(mapTournament),
    [tournaments],
  );
  const mappedExpenses = useMemo(
    () => (expenses ?? []).map(mapExpense),
    [expenses],
  );

  if (DEMO_MODE && demoCtx) {
    return { data: demoCtx.demoData as any, isLoading: false, isFetching: false, error: null };
  }

  return {
    data: {
      tournaments: mappedTournaments,
      expenses: mappedExpenses,
    },
    isLoading: tLoading || eLoading,
    isFetching: tFetching || eFetching,
    error: null,
  };
}

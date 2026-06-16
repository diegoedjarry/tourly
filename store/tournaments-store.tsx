import React, { createContext, useContext, useState } from 'react';

export type Surface = 'clay' | 'hard' | 'grass';
export type TournamentGroup = 'active' | 'upcoming' | 'past';

export interface DeadlinePill {
  type: 'withdrawal-today' | 'withdrawal-safe' | 'signup-soon' | 'all-good';
  label: string;
  daysLeft?: number;
}

export interface Tournament {
  id: string;
  flag: string;
  name: string;
  dates: string;
  exactWithdrawalDate?: string;
  exactSignupDate?: string;
  surface: Surface;
  registered: boolean;
  pill: DeadlinePill;
  group: TournamentGroup;
}

const INITIAL: Tournament[] = [
  {
    id: '1',
    flag: '🇧🇷',
    name: 'M25 Cuiabá',
    dates: '09–15 Jun 2026',
    exactWithdrawalDate: 'Jun 12, 2026',
    surface: 'clay',
    registered: true,
    pill: { type: 'withdrawal-today', label: 'withdrawal today' },
    group: 'active',
  },
  {
    id: '2',
    flag: '🇦🇷',
    name: 'M25 Buenos Aires',
    dates: '16–22 Jun 2026',
    exactWithdrawalDate: 'Jun 20, 2026',
    surface: 'clay',
    registered: true,
    pill: { type: 'all-good', label: '✓ all good' },
    group: 'upcoming',
  },
  {
    id: '3',
    flag: '🇺🇸',
    name: 'M15 Lakewood',
    dates: '23–29 Jun 2026',
    exactSignupDate: 'Jun 19, 2026',
    surface: 'hard',
    registered: false,
    pill: { type: 'signup-soon', label: 'sign up 7d', daysLeft: 7 },
    group: 'upcoming',
  },
  {
    id: '4',
    flag: '🇪🇸',
    name: 'M25 Madrid',
    dates: '30 Jun–06 Jul 2026',
    exactSignupDate: 'Jun 24, 2026',
    surface: 'clay',
    registered: false,
    pill: { type: 'signup-soon', label: 'sign up 12d', daysLeft: 12 },
    group: 'upcoming',
  },
  {
    id: '5',
    flag: '🇦🇺',
    name: 'M25 Melbourne',
    dates: '07–13 Jul 2026',
    exactWithdrawalDate: 'Jul 3, 2026',
    surface: 'hard',
    registered: true,
    pill: { type: 'all-good', label: '✓ all good' },
    group: 'upcoming',
  },
];

interface TournamentsContextValue {
  tournaments: Tournament[];
  withdraw: (id: string) => void;
}

const TournamentsContext = createContext<TournamentsContextValue | null>(null);

export function TournamentsProvider({ children }: { children: React.ReactNode }) {
  const [tournaments, setTournaments] = useState<Tournament[]>(INITIAL);

  function withdraw(id: string) {
    setTournaments((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <TournamentsContext.Provider value={{ tournaments, withdraw }}>
      {children}
    </TournamentsContext.Provider>
  );
}

export function useTournaments() {
  const ctx = useContext(TournamentsContext);
  if (!ctx) throw new Error('useTournaments must be used inside TournamentsProvider');
  return ctx;
}

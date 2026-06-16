import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEMO_DATA } from '@/config/demo';

const STORAGE_KEY = 'tourly-demo-data';

type DemoData = typeof DEMO_DATA;

interface DemoCtx {
  demoData: DemoData;
  patchTournament: (id: string, updates: Record<string, any>) => void;
  addTournament: (t: any) => void;
  addExpense: (e: any) => void;
}

const DemoContext = createContext<DemoCtx | null>(null);

export function DemoDataProvider({ children }: { children: React.ReactNode }) {
  const [demoData, setDemoData] = useState<DemoData>(DEMO_DATA);

  // Load persisted data on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try { setDemoData(JSON.parse(raw)); } catch {}
      }
    });
  }, []);

  // Save directly inside each mutation so writes are never dropped by effect timing
  function save(next: DemoData) {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }

  function patchTournament(tournamentId: string, updates: Record<string, any>) {
    setDemoData(prev => {
      const next = {
        ...prev,
        tournaments: (prev.tournaments as any[]).map((t: any) =>
          t.id === tournamentId ? { ...t, ...updates } : t
        ),
      };
      save(next);
      return next;
    });
  }

  function addTournament(tournament: any) {
    setDemoData(prev => {
      const next = {
        ...prev,
        tournaments: [...(prev.tournaments as any[]), tournament],
      };
      save(next);
      return next;
    });
  }

  function addExpense(expense: any) {
    setDemoData(prev => {
      const next = {
        ...prev,
        expenses: [...(prev.expenses as any[]), expense],
      };
      save(next);
      return next;
    });
  }

  return (
    <DemoContext.Provider value={{ demoData, patchTournament, addTournament, addExpense }}>
      {children}
    </DemoContext.Provider>
  );
}

export function useDemoData() {
  return useContext(DemoContext);
}

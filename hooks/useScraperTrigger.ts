import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

const FLAG_KEY  = 'scraper_triggered_once_v1';
const POLL_MS   = 15_000;
const TIMEOUT_MS = 10 * 60 * 1000;

export type ScraperStatus = 'idle' | 'loading' | 'complete' | 'failed';

// Module-level pub/sub so banner stays in sync across any mounted component
type Listener = (s: ScraperStatus) => void;
const listeners = new Set<Listener>();
let _status: ScraperStatus = 'idle';

export function setScraperStatus(s: ScraperStatus) {
  _status = s;
  listeners.forEach(fn => fn(s));
}

export function useScraperStatus(): ScraperStatus {
  const [status, setStatus] = useState<ScraperStatus>(_status);
  useEffect(() => {
    listeners.add(setStatus);
    return () => { listeners.delete(setStatus); };
  }, []);
  return status;
}

export async function triggerScraperOnce(playerName: string): Promise<void> {
  const name = playerName.trim();
  if (!name) return;

  // Only ever runs once per install
  const already = await AsyncStorage.getItem(FLAG_KEY);
  if (already) return;
  await AsyncStorage.setItem(FLAG_KEY, '1');

  setScraperStatus('loading');

  // Dispatch via the trigger-player-scrape edge function. The GitHub token
  // lives server-side only — never bundle a PAT into the client via
  // EXPO_PUBLIC_* (those are compiled into the shipped JS bundle).
  try {
    await supabase.functions.invoke('trigger-player-scrape', {
      body: { record: { atp_player_name: name } },
    });
  } catch {
    // Network failure — still poll; the profile-update DB webhook may have
    // dispatched the same scrape anyway.
  }

  // Poll Supabase every 15 s for up to 10 minutes
  const start = Date.now();
  const firstName = name.split(' ')[0];
  const interval = setInterval(async () => {
    if (Date.now() - start > TIMEOUT_MS) {
      clearInterval(interval);
      setScraperStatus('failed');
      setTimeout(() => setScraperStatus('idle'), 8_000);
      return;
    }
    try {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('player_profiles')
        .select('player_name')
        .ilike('player_name', `%${firstName}%`)
        .gte('last_updated', since)
        .limit(1)
        .maybeSingle();
      if (data) {
        clearInterval(interval);
        setScraperStatus('complete');
        setTimeout(() => setScraperStatus('idle'), 10_000);
      }
      // data === null, error === null → row not there yet, keep polling
    } catch {
      // Unexpected failure (e.g. network) — keep polling
    }
  }, POLL_MS);
}

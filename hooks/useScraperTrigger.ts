import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

const GH_PAT   = process.env.EXPO_PUBLIC_GH_PAT    ?? '';
const GH_REPO  = process.env.EXPO_PUBLIC_GITHUB_REPO ?? '';
const WORKFLOW  = 'weekly-scraper.yml';
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

  // Dispatch workflow_dispatch to GitHub Actions
  if (GH_PAT && GH_REPO) {
    try {
      await fetch(
        `https://api.github.com/repos/${GH_REPO}/actions/workflows/${WORKFLOW}/dispatches`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${GH_PAT}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ref: 'main', inputs: { player_name: name } }),
        },
      );
    } catch {
      // Network failure — still poll; workflow may have been dispatched
    }
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
        .single();
      if (data) {
        clearInterval(interval);
        setScraperStatus('complete');
        setTimeout(() => setScraperStatus('idle'), 10_000);
      }
    } catch {
      // Row not there yet — keep polling
    }
  }, POLL_MS);
}

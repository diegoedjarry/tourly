import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useProfile } from './useProfile';
import { t as translate, type Lang, type StringKey } from '@/lib/i18n';

const LANG_KEY = 'app_language';

type Listener = (lang: Lang | undefined) => void;
const listeners = new Set<Listener>();
// undefined = no language has ever been explicitly set on this device (fresh
// install, nothing in AsyncStorage yet) — callers should fall back to the
// profile's language in that case. Once set (restored from AsyncStorage or
// via setLanguage()), the local value always wins over the profile.
let currentLang: Lang | undefined = undefined;

// Seed currentLang from AsyncStorage immediately at module load so that
// the home screen (first to mount) never flashes English before the profile loads.
AsyncStorage.getItem(LANG_KEY).then(saved => {
  if (saved === 'es' || saved === 'en') {
    currentLang = saved as Lang;
    listeners.forEach(fn => fn(currentLang));
  }
}).catch(() => {});

// Current UI language for non-React modules (e.g. lib/api offline notices).
// Tracks the persisted app language; the per-profile override lives in useLanguage().
export function getCurrentLang(): Lang {
  return currentLang ?? 'en';
}

export async function setLanguage(lang: Lang) {
  currentLang = lang;
  await AsyncStorage.setItem(LANG_KEY, lang).catch(() => {});
  listeners.forEach(fn => fn(lang));
}

export function useLanguage() {
  const { data: profile } = useProfile();
  const [localLang, setLocalLang] = useState<Lang | undefined>(currentLang);

  useEffect(() => {
    const handler: Listener = (lang) => setLocalLang(lang);
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  const profileLang = (profile?.language as Lang) || undefined;
  // The locally-set language (restored from AsyncStorage, or just set via the
  // language picker) always wins over the profile: otherwise switching
  // language only took effect once the profile write landed on the server —
  // and never took effect at all while offline, since setLanguage() persists
  // locally immediately but the profile mutation can be queued/delayed.
  // Profile language is only a fallback, for a fresh install/device that has
  // never had a local language set.
  // When profile is explicitly null (logged-out / auth screen), always use 'en'
  // so the login page never shows a language stored from a previous session.
  const lang: Lang = profile === null ? 'en' : (localLang ?? profileLang ?? 'en');

  const t = useCallback((key: StringKey): string => {
    return translate(key, lang);
  }, [lang]);

  return { lang, t, setLanguage };
}

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useProfile } from './useProfile';
import { t as translate, type Lang, type StringKey } from '@/lib/i18n';

const LANG_KEY = 'app_language';

type Listener = (lang: Lang) => void;
const listeners = new Set<Listener>();
let currentLang: Lang = 'en';

// Seed currentLang from AsyncStorage immediately at module load so that
// the home screen (first to mount) never flashes English before the profile loads.
AsyncStorage.getItem(LANG_KEY).then(saved => {
  if (saved === 'es' || saved === 'en') {
    currentLang = saved as Lang;
    listeners.forEach(fn => fn(currentLang));
  }
}).catch(() => {});

export async function setLanguage(lang: Lang) {
  currentLang = lang;
  await AsyncStorage.setItem(LANG_KEY, lang).catch(() => {});
  listeners.forEach(fn => fn(lang));
}

export function useLanguage() {
  const { data: profile } = useProfile();
  const [localLang, setLocalLang] = useState<Lang>(currentLang);

  useEffect(() => {
    const handler: Listener = (lang) => setLocalLang(lang);
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  const profileLang = (profile?.language as Lang) || undefined;
  // Profile language is the source of truth once loaded.
  // localLang covers the window before profile loads and reflects
  // setLanguage() calls made from Settings before the profile write resolves.
  const lang: Lang = profileLang ?? localLang;

  const t = useCallback((key: StringKey): string => {
    return translate(key, lang);
  }, [lang]);

  return { lang, t, setLanguage };
}

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useProfile } from './useProfile';
import { t as translate, type Lang, type StringKey } from '@/lib/i18n';

const LANG_KEY = 'app_language';

type Listener = (lang: Lang) => void;
const listeners = new Set<Listener>();
let currentLang: Lang = 'en';

// Do NOT restore language from AsyncStorage on startup.
// Language is driven by profile.language (set explicitly in Settings).
// Defaulting to 'en' here ensures auth/onboarding screens are always English.

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
  // Default to English always. Only use a non-English language if the user
  // has explicitly set it on their profile via Settings.
  const lang: Lang = profileLang ?? 'en';

  const t = useCallback((key: StringKey): string => {
    return translate(key, lang);
  }, [lang]);

  return { lang, t, setLanguage };
}

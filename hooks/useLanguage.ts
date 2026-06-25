import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useProfile } from './useProfile';
import { t as translate, type Lang, type StringKey } from '@/lib/i18n';

const LANG_KEY = 'app_language';

type Listener = (lang: Lang) => void;
const listeners = new Set<Listener>();
let currentLang: Lang = 'en';

AsyncStorage.getItem(LANG_KEY).then(v => {
  if (v === 'en' || v === 'es') {
    currentLang = v;
    listeners.forEach(fn => fn(v));
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
  const lang: Lang = profileLang ?? localLang;

  const t = useCallback((key: StringKey): string => {
    return translate(key, lang);
  }, [lang]);

  return { lang, t, setLanguage };
}

import { useState, useEffect, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import type { User, Session } from '@supabase/supabase-js';
import { clearPersistedCache, queryClient } from '@/lib/queryClient';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const prevUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        prevUserIdRef.current = session.user.id;
        setUser(session.user);
        setSession(session);
      }
      setLoading(false);
    }).catch(() => setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const newUserId = session?.user?.id ?? null;
      if (event === 'SIGNED_OUT' || (prevUserIdRef.current && newUserId && newUserId !== prevUserIdRef.current)) {
        await clearPersistedCache();
      }
      // When a new session is established, invalidate all queries so they
      // refetch with the authenticated Supabase client.
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        queryClient.invalidateQueries();
      }
      prevUserIdRef.current = newUserId;
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signInWithEmail(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signUpWithEmail(email: string, password: string) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    // Supabase creates a session on signup even before email confirmation.
    // Sign out immediately so the user doesn't see an empty/stale app.
    if (data.session) {
      await supabase.auth.signOut({ scope: 'local' });
    }
  }

  async function signOut() {
    setUser(null);
    setSession(null);
    await clearPersistedCache();
    try {
      await supabase.auth.signOut();
    } catch {}
  }

  async function signInWithOAuth(provider: 'google' | 'apple') {
    if (Platform.OS === 'web') {
      // On web, let Supabase handle the full redirect flow natively.
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
      return;
    }

    // Native: use expo-web-browser to handle the OAuth flow in-app.
    const WebBrowser = await import('expo-web-browser');
    const { createURL } = await import('expo-linking');
    WebBrowser.maybeCompleteAuthSession();
    const redirectTo = createURL('');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (data.url) {
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success' && result.url) {
        const url = result.url;
        let accessToken: string | null = null;
        let refreshToken: string | null = null;
        if (url.includes('#')) {
          const fragment = url.split('#')[1];
          const fragParams = new URLSearchParams(fragment);
          accessToken = fragParams.get('access_token');
          refreshToken = fragParams.get('refresh_token');
        }
        if (!accessToken && url.includes('?')) {
          const query = url.split('?')[1]?.split('#')[0] ?? '';
          const qParams = new URLSearchParams(query);
          accessToken = qParams.get('access_token');
          refreshToken = qParams.get('refresh_token');
        }
        if (accessToken) {
          await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken ?? '' });
        } else {
          throw new Error('Could not complete sign in. Please try again.');
        }
      }
    }
  }

  async function updateEmail(newEmail: string) {
    const { error } = await supabase.auth.updateUser({ email: newEmail });
    if (error) throw error;
  }

  async function updatePassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  return { user, session, loading, signInWithEmail, signUpWithEmail, signInWithOAuth, signOut, updateEmail, updatePassword };
}

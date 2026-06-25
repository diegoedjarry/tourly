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
      // When a new user session is established, reset the profile query so the
      // AuthGate guard blocks on isLoading until the real fetch completes.
      // Do NOT do this on TOKEN_REFRESHED — that fires every hour and causes
      // unnecessary loading flashes and guard re-evaluations.
      if (event === 'SIGNED_IN') {
        // resetQueries puts the query into { status:'pending', data:undefined }
        // so the guard's (profileLoading || profileFetching) check blocks until
        // the fresh fetch resolves.
        queryClient.resetQueries({ queryKey: ['profile'] });
        // Invalidate everything else so it refetches with the new session, but
        // NOT profile (already reset above — invalidating it again can cause a
        // double-fetch race where a stale null settles before the real data).
        queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'profile' });
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

  async function signUpWithEmail(email: string, password: string): Promise<'session' | 'confirm'> {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    // If Supabase returns a session, email confirmation is disabled — user is
    // already signed in. Return 'session' so the caller can navigate directly.
    // If no session, email confirmation is required — return 'confirm'.
    return data.session ? 'session' : 'confirm';
  }

  async function signOut() {
    // Sign out from Supabase first, then clear local state. If we clear state
    // first and sign-out fails, the UI shows the user as logged out but the
    // Supabase session is still valid — leading to a broken state.
    try {
      await supabase.auth.signOut();
    } catch {}
    // onAuthStateChange will fire SIGNED_OUT and update user/session state,
    // but we also clear proactively here for an instant UI response.
    setUser(null);
    setSession(null);
    await clearPersistedCache();
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

import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { setRecoveryInProgress } from '@/lib/password-recovery';

function parseRecoveryUrl(url: string) {
  const [beforeHash, fragment = ''] = url.split('#');
  const query = beforeHash.includes('?') ? beforeHash.split('?')[1] : '';
  const qParams = new URLSearchParams(query);
  const fParams = new URLSearchParams(fragment);
  return {
    // Only treat the link as a recovery link when it targets the
    // reset-password path or Supabase tagged it type=recovery — OAuth
    // callbacks also carry fragment tokens and must not land here.
    isRecovery: url.includes('reset-password') || qParams.get('type') === 'recovery' || fParams.get('type') === 'recovery',
    code: qParams.get('code') ?? fParams.get('code'),
    accessToken: fParams.get('access_token') ?? qParams.get('access_token'),
    refreshToken: fParams.get('refresh_token') ?? qParams.get('refresh_token'),
  };
}

async function handleRecoveryUrl(url: string | null, navigate: (path: string) => void) {
  if (!url) return;
  const { isRecovery, code, accessToken, refreshToken } = parseRecoveryUrl(url);
  if (!isRecovery) return;
  // Flag first so the AuthGate never redirects on the SIGNED_IN transition
  // the session-establishing calls below trigger.
  setRecoveryInProgress(true);
  try {
    if (accessToken) {
      // Implicit flow (this project's default): tokens arrive in the fragment.
      await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken ?? '' });
    } else if (code) {
      // PKCE flow: exchange the one-time code for a session.
      await supabase.auth.exchangeCodeForSession(code);
    }
  } catch {
    // Expired/invalid link: still land on the reset screen — updatePassword
    // will fail with a session-missing error mapped to actionable copy there.
  }
  navigate('/reset-password');
}

// Called once from the root layout. Handles password-recovery deep links on
// both cold start (getInitialURL) and while running (url event), plus the
// PASSWORD_RECOVERY auth event as a defensive fallback.
export function usePasswordRecovery() {
  const router = useRouter();

  useEffect(() => {
    const navigate = (path: string) => router.replace(path as never);

    Linking.getInitialURL()
      .then(url => handleRecoveryUrl(url, navigate))
      .catch(() => {});

    const urlSub = Linking.addEventListener('url', ({ url }) => {
      handleRecoveryUrl(url, navigate);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryInProgress(true);
        navigate('/reset-password');
      }
    });

    return () => {
      urlSub.remove();
      subscription.unsubscribe();
    };
  }, [router]);
}

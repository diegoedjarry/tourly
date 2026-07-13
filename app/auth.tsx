import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/hooks/useAuth';
import { useAppAlert } from '@/components/ui/app-alert';
import { TourlyLogo } from '@/components/ui/tourly-logo';
import { useLanguage } from '@/hooks/useLanguage';
import { T } from '@/constants/theme';
import type { StringKey } from '@/lib/i18n';

const RESEND_COOLDOWN_SECONDS = 30;

// Maps common raw Supabase auth error strings to actionable, localized copy.
// Unknown errors fall back to the raw message so nothing is silently swallowed.
export function mapAuthError(message: string | undefined, t: (key: StringKey) => string): string {
  if (!message) return t('auth.somethingWrong');
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) return t('auth.invalidCredentials');
  if (lower.includes('already registered')) return t('auth.userAlreadyRegistered');
  if (lower.includes('password should be at least')) return t('auth.passwordTooShort');
  if (lower.includes('email not confirmed')) return t('auth.emailNotConfirmed');
  if (lower.includes('rate limit') || lower.includes('too many requests')) return t('auth.rateLimited');
  if (lower.includes('auth session missing') || lower.includes('invalid or has expired')) return t('auth.recoveryLinkExpired');
  return message;
}

export default function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const passwordRef = useRef<TextInput>(null);

  const { signInWithEmail, signUpWithEmail, signInWithOAuth, resendConfirmationEmail, resetPasswordForEmail } = useAuth();
  const { show: showAlert } = useAppAlert();
  const { t } = useLanguage();

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

  async function handleSubmit() {
    if (!email.trim() || !password.trim()) {
      showAlert(t('auth.missingFields'), t('auth.fillFields'));
      return;
    }
    setLoading(true);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email.trim(), password);
        // navigation handled by auth state change in _layout.tsx
      } else {
        const result = await signUpWithEmail(email.trim(), password);
        if (result === 'confirm') {
          // Email confirmation required — Supabase sent a verification email.
          // Show a persistent inline notice (with a resend option) instead of
          // a one-shot alert, so the flow is recoverable if the email is lost.
          setPendingEmail(email.trim());
          setResendCooldown(0);
        }
        // If result === 'session', the user is now signed in and _layout.tsx
        // will navigate automatically — no alert needed.
      }
    } catch (err: any) {
      showAlert(t('auth.error'), mapAuthError(err?.message, t));
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!pendingEmail || resendCooldown > 0 || resending) return;
    setResending(true);
    try {
      await resendConfirmationEmail(pendingEmail);
      showAlert(t('auth.resendSuccessTitle'), t('auth.resendSuccessBody'));
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err: any) {
      showAlert(t('auth.resendFailedTitle'), mapAuthError(err?.message, t));
    } finally {
      setResending(false);
    }
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      showAlert(t('auth.forgotPasswordNeedsEmail'), t('auth.forgotPasswordNeedsEmailBody'));
      return;
    }
    setResetLoading(true);
    try {
      await resetPasswordForEmail(email.trim());
      showAlert(t('auth.resetLinkSentTitle'), t('auth.resetLinkSentBody'));
    } catch (err: any) {
      showAlert(t('auth.error'), mapAuthError(err?.message, t));
    } finally {
      setResetLoading(false);
    }
  }

  function toggleMode() {
    setMode(m => (m === 'signin' ? 'signup' : 'signin'));
    setPendingEmail(null);
    setResendCooldown(0);
  }

  async function handleOAuth(provider: 'google' | 'apple') {
    setOauthLoading(provider);
    try {
      await signInWithOAuth(provider);
    } catch (err: any) {
      const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
      const fallback = t('auth.oauthFailed').replace('{provider}', providerLabel);
      showAlert(t('auth.error'), err?.message ? mapAuthError(err.message, t) : fallback);
    } finally {
      setOauthLoading(null);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <View style={s.logo}><TourlyLogo width={200} height={52} /></View>

          <View style={s.card}>
            <Text style={s.title}>{mode === 'signin' ? t('auth.welcomeBack') : t('auth.createAccount')}</Text>
            <Text style={s.subtitle}>
              {mode === 'signin' ? t('auth.signInAccess') : t('auth.startManaging')}
            </Text>

            <TextInput
              style={s.input}
              placeholder={t('common.email')}
              placeholderTextColor={T.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            <View style={s.passwordRow}>
              <TextInput
                ref={passwordRef}
                style={s.passwordInput}
                placeholder={t('common.password')}
                placeholderTextColor={T.textMuted}
                secureTextEntry={!showPassword}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                textContentType={mode === 'signup' ? 'newPassword' : 'password'}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={s.eyeBtn} activeOpacity={0.7}>
                <Text style={s.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            </View>

            {mode === 'signin' && (
              <TouchableOpacity
                onPress={handleForgotPassword}
                disabled={resetLoading}
                style={s.forgotBtn}
                activeOpacity={0.7}
              >
                <Text style={s.forgotText}>{t('auth.forgotPassword')}</Text>
              </TouchableOpacity>
            )}

            {pendingEmail && (
              <View style={s.pendingBox}>
                <Text style={s.pendingTitle}>{t('auth.pendingConfirmationTitle')}</Text>
                <Text style={s.pendingBody}>
                  {t('auth.pendingConfirmationBody').replace('{email}', pendingEmail)}
                </Text>
                <TouchableOpacity
                  style={[s.resendBtn, (resendCooldown > 0 || resending) && s.resendBtnDisabled]}
                  onPress={handleResend}
                  disabled={resendCooldown > 0 || resending}
                  activeOpacity={0.8}
                >
                  {resending ? (
                    <ActivityIndicator color={T.accent} size="small" />
                  ) : (
                    <Text style={s.resendBtnText}>
                      {resendCooldown > 0
                        ? t('auth.resendEmailWait').replace('{s}', String(resendCooldown))
                        : t('auth.resendEmail')}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity style={s.btn} onPress={handleSubmit} disabled={loading} activeOpacity={0.8}>
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={s.btnText}>{mode === 'signin' ? t('auth.signIn') : t('auth.createAccount')}</Text>
              )}
            </TouchableOpacity>

            <View style={s.dividerRow}>
              <View style={s.dividerLine} />
              <Text style={s.dividerText}>{t('common.or')}</Text>
              <View style={s.dividerLine} />
            </View>

            <TouchableOpacity style={s.oauthBtn} onPress={() => handleOAuth('google')} disabled={!!oauthLoading} activeOpacity={0.8}>
              {oauthLoading === 'google' ? (
                <ActivityIndicator color="#FAFAFA" size="small" />
              ) : (
                <>
                  <Text style={s.oauthIcon}>G</Text>
                  <Text style={s.oauthText}>{t('auth.continueGoogle')}</Text>
                </>
              )}
            </TouchableOpacity>

            {Platform.OS === 'ios' && (
              <TouchableOpacity
                style={[s.oauthBtn, s.appleBtn]}
                onPress={() => handleOAuth('apple')}
                disabled={!!oauthLoading}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={t('auth.signInApple')}
              >
                {oauthLoading === 'apple' ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Text style={s.appleIcon}>{''}</Text>
                    <Text style={[s.oauthText, s.appleText]}>{t('auth.signInApple')}</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity style={s.switchRow} onPress={toggleMode}>
              <Text style={s.switchText}>
                {mode === 'signin' ? t('auth.noAccount') : t('auth.haveAccount')}
                <Text style={s.switchLink}>{mode === 'signin' ? t('auth.signUp') : t('auth.signIn')}</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  logo: { alignSelf: 'center', marginBottom: 32 },
  card: {
    backgroundColor: T.card,
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingVertical: 32,
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  title: { fontSize: 24, fontWeight: '700', color: T.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 14, color: T.textSecondary, marginBottom: 24 },
  input: {
    backgroundColor: T.cardElevated,
    borderRadius: 50,
    paddingHorizontal: 20,
    paddingVertical: Platform.OS === 'ios' ? 16 : 14,
    fontSize: 15,
    color: T.textPrimary,
    marginBottom: 12,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.cardElevated,
    borderRadius: 50,
    marginBottom: 12,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: Platform.OS === 'ios' ? 16 : 14,
    fontSize: 15,
    color: T.textPrimary,
  },
  eyeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  eyeIcon: { fontSize: 18 },
  forgotBtn: { alignSelf: 'flex-end', marginBottom: 12 },
  forgotText: { fontSize: 13, color: T.textSecondary, fontWeight: '600' },
  pendingBox: {
    backgroundColor: T.cardElevated,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  pendingTitle: { fontSize: 14, fontWeight: '700', color: T.textPrimary, marginBottom: 4 },
  pendingBody: { fontSize: 13, color: T.textSecondary, lineHeight: 19, marginBottom: 12 },
  resendBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: T.accent,
  },
  resendBtnDisabled: { borderColor: T.cardBorder, opacity: 0.6 },
  resendBtnText: { fontSize: 13, fontWeight: '700', color: T.accent },
  btn: {
    backgroundColor: T.accent,
    borderRadius: 50,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  btnText: { color: T.textPrimary, fontSize: 16, fontWeight: '700' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: T.cardBorder },
  dividerText: { marginHorizontal: 14, fontSize: 13, color: T.textSecondary, fontWeight: '500' },
  oauthBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.cardElevated,
    borderRadius: 50,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: T.cardBorder,
    marginBottom: 10,
    gap: 10,
  },
  appleBtn: { backgroundColor: '#000000', borderColor: '#000000' },
  oauthIcon: { fontSize: 18, fontWeight: '700', color: '#4285F4' },
  appleIcon: { color: T.textPrimary, fontSize: 20 },
  oauthText: { fontSize: 15, fontWeight: '600', color: T.textPrimary },
  appleText: { color: T.textPrimary },
  switchRow: { alignItems: 'center', marginTop: 20 },
  switchText: { fontSize: 14, color: T.textSecondary },
  switchLink: { color: T.accent, fontWeight: '700' },
});

import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Switch,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/hooks/useAuth';
import { useAppAlert } from '@/components/ui/app-alert';
import { TourlyLogo } from '@/components/ui/tourly-logo';
import { useLanguage } from '@/hooks/useLanguage';
import { T } from '@/constants/theme';

export default function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [stayLoggedIn, setStayLoggedIn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);

  const { signInWithEmail, signUpWithEmail, signInWithOAuth } = useAuth();
  const { show: showAlert } = useAppAlert();
  const { t } = useLanguage();

  async function handleSubmit() {
    if (!email.trim() || !password.trim()) {
      showAlert('Missing fields', 'Please enter your email and password.');
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
          // Email confirmation required — Supabase sent a verification email
          showAlert(t('auth.checkEmail'), t('auth.confirmationSent'));
        }
        // If result === 'session', the user is now signed in and _layout.tsx
        // will navigate automatically — no alert needed.
      }
    } catch (err: any) {
      showAlert('Error', err?.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuth(provider: 'google' | 'apple') {
    setOauthLoading(provider);
    try {
      await signInWithOAuth(provider);
    } catch (err: any) {
      showAlert('Error', err?.message ?? `${provider} sign in failed.`);
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
              placeholder="Email"
              placeholderTextColor={T.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="next"
              value={email}
              onChangeText={setEmail}
            />
            <View style={s.passwordRow}>
              <TextInput
                style={s.passwordInput}
                placeholder="Password"
                placeholderTextColor={T.textMuted}
                secureTextEntry={!showPassword}
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
              <View style={s.stayRow}>
                <Switch
                  value={stayLoggedIn}
                  onValueChange={setStayLoggedIn}
                  trackColor={{ false: T.cardElevated, true: T.accent }}
                  thumbColor={T.textPrimary}
                  style={{ transform: [{ scale: 0.8 }] }}
                />
                <Text style={s.stayText}>{t('auth.stayLoggedIn')}</Text>
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
              <Text style={s.dividerText}>or</Text>
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

            {/* Sign in with Apple hidden until the Apple provider is configured in
                Supabase — required before App Store release (guideline 4.8). */}

            <TouchableOpacity style={s.switchRow} onPress={() => setMode(m => (m === 'signin' ? 'signup' : 'signin'))}>
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
  stayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  stayText: { fontSize: 14, color: T.textSecondary, fontWeight: '500' },
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

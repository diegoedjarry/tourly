import React, { useEffect, useState } from 'react';
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
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useAppAlert } from '@/components/ui/app-alert';
import { TourlyLogo } from '@/components/ui/tourly-logo';
import { useLanguage } from '@/hooks/useLanguage';
import { T } from '@/constants/theme';
import { setRecoveryInProgress } from '@/lib/password-recovery';
import { mapAuthError } from './auth';

export default function ResetPasswordScreen() {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  const { updatePassword } = useAuth();
  const { show: showAlert } = useAppAlert();
  const { t } = useLanguage();
  const router = useRouter();

  // Clear the recovery flag whenever this screen goes away (back gesture,
  // successful save navigation) so the AuthGate resumes normal redirects.
  useEffect(() => () => setRecoveryInProgress(false), []);

  async function handleSave() {
    if (!password.trim()) {
      showAlert(t('auth.missingFields'), t('auth.resetPasswordEmpty'));
      return;
    }
    setSaving(true);
    try {
      await updatePassword(password);
      setRecoveryInProgress(false);
      showAlert(t('auth.resetPasswordSuccessTitle'), t('auth.resetPasswordSuccessBody'), [
        { text: t('common.ok'), onPress: () => router.replace('/(tabs)') },
      ]);
    } catch (err: any) {
      showAlert(t('auth.error'), mapAuthError(err?.message, t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <View style={s.logo}><TourlyLogo width={200} height={52} /></View>

          <View style={s.card}>
            <Text style={s.title}>{t('auth.resetPasswordTitle')}</Text>
            <Text style={s.subtitle}>{t('auth.resetPasswordSubtitle')}</Text>

            <View style={s.passwordRow}>
              <TextInput
                style={s.passwordInput}
                placeholder={t('auth.newPasswordPlaceholder')}
                placeholderTextColor={T.textMuted}
                secureTextEntry={!showPassword}
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="done"
                onSubmitEditing={handleSave}
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={s.eyeBtn} activeOpacity={0.7}>
                <Text style={s.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={s.btn} onPress={handleSave} disabled={saving} activeOpacity={0.8}>
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={s.btnText}>{t('auth.resetPasswordSave')}</Text>
              )}
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
  btn: {
    backgroundColor: T.accent,
    borderRadius: 50,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  btnText: { color: T.textPrimary, fontSize: 16, fontWeight: '700' },
});

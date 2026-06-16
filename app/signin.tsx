import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { db } from '@/db';

export default function SignInScreen() {
  const router = useRouter();
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function handleSend() {
    if (!email.trim()) { setError('Please enter your email.'); return; }
    setError('');
    setLoading(true);
    try {
      await db.auth.sendMagicCode({ email: email.trim() });
      router.push({ pathname: '/verify', params: { email: email.trim(), mode: 'signin' } });
    } catch (e: any) {
      setError(e?.message ?? 'Failed to send code. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
            <Text style={s.backText}>← back</Text>
          </TouchableOpacity>
        </View>

        <View style={s.body}>
          <Text style={s.title}>Sign in</Text>
          <Text style={s.subtitle}>We'll send a code to your email.</Text>

          <Text style={s.label}>EMAIL</Text>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#BBBBBB"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="go"
            onSubmitEditing={handleSend}
          />

          {error ? <Text style={s.error}>{error}</Text> : null}

          <TouchableOpacity style={[s.btn, loading && { opacity: 0.7 }]}
            onPress={handleSend} activeOpacity={0.85} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#FFF" />
              : <Text style={s.btnText}>Send code →</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push('/signup')} activeOpacity={0.7}
            style={s.signupRow}>
            <Text style={s.signupText}>Don't have an account? </Text>
            <Text style={[s.signupText, s.signupLink]}>Create one</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAFAFA' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#EBEBF0',
  },
  backBtn: { paddingRight: 16 },
  backText: { fontSize: 15, fontWeight: '600', color: '#5B5BD6' },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 40 },
  title: { fontSize: 26, fontWeight: '800', color: '#2D2B55', marginBottom: 6 },
  subtitle: { fontSize: 15, color: '#AAAAAA', marginBottom: 32 },
  label: { fontSize: 11, fontWeight: '700', color: '#AAAAAA', letterSpacing: 0.6, marginBottom: 8 },
  input: {
    backgroundColor: '#F0F0F8', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: '#2D2B55', marginBottom: 20,
  },
  error: { fontSize: 13, color: '#E24B4A', textAlign: 'center', marginBottom: 12 },
  btn: {
    backgroundColor: '#5B5BD6', borderRadius: 14,
    paddingVertical: 17, alignItems: 'center', marginBottom: 24,
  },
  btnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  signupRow: { flexDirection: 'row', justifyContent: 'center' },
  signupText: { color: '#AAAAAA', fontSize: 13 },
  signupLink: { color: '#5B5BD6', fontWeight: '600' },
});

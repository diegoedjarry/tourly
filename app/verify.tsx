import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { id } from '@instantdb/react-native';
import { db } from '@/db';

export default function VerifyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    email: string; mode: string;
    name?: string; nationality?: string; ranking?: string;
    dob?: string; homeBase?: string; role?: string;
  }>();

  const [code,    setCode]    = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [resent,  setResent]  = useState(false);
  const inputRef = useRef<TextInput>(null);

  async function handleVerify() {
    const trimmed = code.trim();
    if (trimmed.length < 6) { setError('Enter the 6-digit code from your email.'); return; }
    setError('');
    setLoading(true);
    try {
      const result = await db.auth.signInWithMagicCode({ email: params.email, code: trimmed });

      // On sign-up: save user profile linked to the auth user
      if (params.mode === 'signup' && result?.user?.id) {
        const userId = result.user.id;
        await db.transact(
          db.tx.users[userId].update({
            name: params.name ?? '',
            nationality: params.nationality ?? '',
            ranking: params.ranking ? parseInt(params.ranking, 10) : 0,
            dateOfBirth: params.dob ?? '',
            homeBase: params.homeBase ?? '',
            role: params.role ?? 'Player',
          })
        );
      }

      // Navigate to home — _layout will detect auth and route correctly
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e?.message ?? 'Invalid or expired code. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResent(false);
    try {
      await db.auth.sendMagicCode({ email: params.email });
      setResent(true);
    } catch {
      setError('Failed to resend. Try again.');
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
          <Text style={s.emoji}>📬</Text>
          <Text style={s.title}>Check your email</Text>
          <Text style={s.subtitle}>
            We sent a 6-digit code to{'\n'}
            <Text style={s.emailHighlight}>{params.email}</Text>
          </Text>

          <Text style={s.label}>CODE</Text>
          <TextInput
            ref={inputRef}
            style={s.codeInput}
            value={code}
            onChangeText={(v) => { setCode(v.replace(/[^0-9]/g, '').slice(0, 6)); setError(''); }}
            placeholder="000000"
            placeholderTextColor="#CCCCCC"
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            returnKeyType="go"
            onSubmitEditing={handleVerify}
          />

          {error ? <Text style={s.error}>{error}</Text> : null}
          {resent ? <Text style={s.resentMsg}>Code resent! Check your inbox.</Text> : null}

          <TouchableOpacity style={[s.btn, (loading || code.length < 6) && { opacity: 0.6 }]}
            onPress={handleVerify} activeOpacity={0.85} disabled={loading || code.length < 6}>
            {loading
              ? <ActivityIndicator color="#FFF" />
              : <Text style={s.btnText}>Verify →</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={handleResend} activeOpacity={0.7} style={s.resendRow}>
            <Text style={s.resendText}>Didn't get it? </Text>
            <Text style={[s.resendText, s.resendLink]}>Resend code</Text>
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
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 40, alignItems: 'center' },
  emoji: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800', color: '#2D2B55', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#AAAAAA', textAlign: 'center', lineHeight: 22, marginBottom: 36 },
  emailHighlight: { color: '#5B5BD6', fontWeight: '600' },
  label: { fontSize: 11, fontWeight: '700', color: '#AAAAAA', letterSpacing: 0.6, marginBottom: 10, alignSelf: 'flex-start' },
  codeInput: {
    backgroundColor: '#F0F0F8', borderRadius: 14,
    paddingHorizontal: 24, paddingVertical: 18,
    fontSize: 32, fontWeight: '700', color: '#2D2B55',
    textAlign: 'center', letterSpacing: 10,
    width: '100%', marginBottom: 20,
  },
  error: { fontSize: 13, color: '#E24B4A', textAlign: 'center', marginBottom: 12 },
  resentMsg: { fontSize: 13, color: '#2D9E6B', textAlign: 'center', marginBottom: 12 },
  btn: {
    backgroundColor: '#5B5BD6', borderRadius: 14,
    paddingVertical: 17, alignItems: 'center',
    width: '100%', marginBottom: 20,
  },
  btnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  resendRow: { flexDirection: 'row', justifyContent: 'center' },
  resendText: { color: '#AAAAAA', fontSize: 13 },
  resendLink: { color: '#5B5BD6', fontWeight: '600' },
});

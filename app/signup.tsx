import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { db } from '@/db';
import { DatePickerField } from '@/components/ui/date-picker-field';

type Role = 'Player' | 'Coach' | 'Other';

const ROLES: Role[] = ['Player', 'Coach', 'Other'];

const FLAG: Record<string, string> = {
  AR: '🇦🇷', AU: '🇦🇺', BR: '🇧🇷', CL: '🇨🇱', DE: '🇩🇪', ES: '🇪🇸',
  FR: '🇫🇷', GB: '🇬🇧', IT: '🇮🇹', MX: '🇲🇽', PT: '🇵🇹', US: '🇺🇸',
};

export default function SignUpScreen() {
  const router = useRouter();

  const [role,        setRole]        = useState<Role>('Player');
  const [name,        setName]        = useState('');
  const [nationality, setNationality] = useState('');
  const [ranking,     setRanking]     = useState('');
  const [dob,         setDob]         = useState('');
  const [homeBase,    setHomeBase]    = useState('');
  const [email,       setEmail]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');

  function flagFor(text: string) {
    const upper = text.trim().toUpperCase();
    return FLAG[upper] ? FLAG[upper] + ' ' : '';
  }

  async function handleNext() {
    if (!name.trim())  { setError('Full name is required.'); return; }
    if (!email.trim()) { setError('Email is required.'); return; }
    setError('');
    setLoading(true);
    try {
      await db.auth.sendMagicCode({ email: email.trim() });
      router.push({
        pathname: '/verify',
        params: {
          email: email.trim(),
          mode: 'signup',
          name: name.trim(),
          nationality: nationality.trim(),
          ranking: ranking.trim(),
          dob,
          homeBase: homeBase.trim(),
          role,
        },
      });
    } catch (e: any) {
      setError(e?.message ?? 'Failed to send code. Check the email and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
            <Text style={s.backText}>← back</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <Text style={s.title}>Create account</Text>
          <Text style={s.subtitle}>Let's get you set up.</Text>

          {/* Role selector */}
          <View style={s.roleRow}>
            {ROLES.map((r) => (
              <TouchableOpacity key={r} style={[s.rolePill, role === r && s.rolePillActive]}
                onPress={() => setRole(r)} activeOpacity={0.7}>
                <Text style={[s.rolePillText, role === r && s.rolePillTextActive]}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Full name */}
          <Text style={s.label}>FULL NAME</Text>
          <TextInput style={s.input} value={name} onChangeText={setName}
            placeholder="e.g. Diego Schwartzman" placeholderTextColor="#BBBBBB"
            autoCapitalize="words" autoCorrect={false} />

          {/* Nationality */}
          <Text style={s.label}>NATIONALITY</Text>
          <TextInput style={s.input}
            value={nationality ? flagFor(nationality) + nationality.toUpperCase() : ''}
            onChangeText={(v) => {
              // strip flag prefix to keep raw code
              const stripped = v.replace(/[^A-Za-z]/g, '');
              setNationality(stripped.slice(0, 2));
            }}
            placeholder="Country code — AR, BR, US…"
            placeholderTextColor="#BBBBBB"
            autoCapitalize="characters" maxLength={4} />

          {/* ATP Ranking — Players only */}
          {role === 'Player' && (
            <>
              <Text style={s.label}>ATP / WTA RANKING</Text>
              <TextInput style={s.input} value={ranking} onChangeText={setRanking}
                placeholder="e.g. 145" placeholderTextColor="#BBBBBB"
                keyboardType="number-pad" />
            </>
          )}

          {/* Date of birth */}
          <Text style={s.label}>DATE OF BIRTH</Text>
          <View style={s.dateWrap}>
            <DatePickerField value={dob} onChange={setDob} placeholder="YYYY-MM-DD" />
          </View>

          {/* Home base */}
          <Text style={s.label}>HOME BASE CITY</Text>
          <TextInput style={s.input} value={homeBase} onChangeText={setHomeBase}
            placeholder="e.g. Buenos Aires" placeholderTextColor="#BBBBBB"
            autoCapitalize="words" />

          {/* Email */}
          <Text style={s.label}>EMAIL</Text>
          <TextInput style={s.input} value={email} onChangeText={setEmail}
            placeholder="you@example.com" placeholderTextColor="#BBBBBB"
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />

          <Text style={s.hint}>
            We'll send a 6-digit code to verify your email. No password needed.
          </Text>

          {error ? <Text style={s.error}>{error}</Text> : null}

          <TouchableOpacity style={[s.submitBtn, loading && { opacity: 0.7 }]}
            onPress={handleNext} activeOpacity={0.85} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#FFF" />
              : <Text style={s.submitText}>Get started →</Text>}
          </TouchableOpacity>

          <View style={{ height: 32 }} />
        </ScrollView>
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
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: '800', color: '#2D2B55', marginBottom: 6 },
  subtitle: { fontSize: 15, color: '#AAAAAA', marginBottom: 28 },

  roleRow: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  rolePill: {
    borderRadius: 20, paddingHorizontal: 20, paddingVertical: 9,
    backgroundColor: '#F0F0F8',
  },
  rolePillActive: { backgroundColor: '#5B5BD6' },
  rolePillText: { fontSize: 14, fontWeight: '600', color: '#999999' },
  rolePillTextActive: { color: '#FFFFFF' },

  label: {
    fontSize: 11, fontWeight: '700', color: '#AAAAAA',
    letterSpacing: 0.6, marginBottom: 8, marginTop: 4,
  },
  input: {
    backgroundColor: '#F0F0F8', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: '#2D2B55', marginBottom: 18,
  },
  dateWrap: { marginBottom: 18 },
  hint: { fontSize: 12, color: '#BBBBBB', lineHeight: 18, marginBottom: 20, textAlign: 'center' },
  error: { fontSize: 13, color: '#E24B4A', textAlign: 'center', marginBottom: 12 },
  submitBtn: {
    backgroundColor: '#5B5BD6', borderRadius: 14,
    paddingVertical: 17, alignItems: 'center',
  },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});

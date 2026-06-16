import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Platform, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { db } from '@/db';

type Role = 'Player' | 'Coach' | 'Other';

export default function CompleteProfileScreen() {
  const router = useRouter();
  const { user } = db.useAuth();
  const { data, isLoading: profileLoading } = db.useQuery(
    user ? { users: {} } : null
  );

  const [role, setRole] = useState<Role>('Player');
  const [name, setName] = useState('');
  const [nationality, setNationality] = useState('');
  const [ranking, setRanking] = useState('');
  const [dob, setDob] = useState('');
  const [homeBase, setHomeBase] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // If user already has a profile, skip to tabs
  useEffect(() => {
    if (profileLoading || !data || !user) return;
    const existing = (data.users ?? []).find((u: any) => u.id === user.id);
    if (existing?.name) {
      router.replace('/(tabs)');
    }
  }, [data, profileLoading, user]);

  async function handleSave() {
    if (!name.trim()) { setError('Please enter your full name.'); return; }
    if (!user) return;
    setSaving(true);
    setError('');
    try {
      await db.transact(
        db.tx.users[user.id].update({
          name: name.trim(),
          role,
          nationality: nationality.trim(),
          ranking: role === 'Player' ? ranking.trim() : '',
          dob: dob.trim(),
          homeBase: homeBase.trim(),
        })
      );
      router.replace('/(tabs)');
    } catch (e) {
      console.error('Error saving profile:', e);
      setError('Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!user || profileLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#5B5BD6" size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAFAFA" />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>

        <Text style={s.title}>One last step</Text>
        <Text style={s.subtitle}>Tell us a bit about yourself.</Text>

        {/* Role picker */}
        <Text style={s.label}>I am a</Text>
        <View style={s.roleRow}>
          {(['Player', 'Coach', 'Other'] as Role[]).map((r) => (
            <TouchableOpacity
              key={r}
              style={[s.roleBtn, role === r && s.roleBtnActive]}
              onPress={() => setRole(r)}
              activeOpacity={0.7}>
              <Text style={[s.roleBtnText, role === r && s.roleBtnTextActive]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Full name */}
        <Text style={s.label}>Full name</Text>
        <TextInput
          style={s.input}
          value={name}
          onChangeText={setName}
          placeholder="Your full name"
          placeholderTextColor="#BBBBBB"
          autoCapitalize="words"
          returnKeyType="next"
        />

        {/* Nationality */}
        <Text style={s.label}>Nationality</Text>
        <TextInput
          style={s.input}
          value={nationality}
          onChangeText={setNationality}
          placeholder="e.g. Chilean"
          placeholderTextColor="#BBBBBB"
          autoCapitalize="words"
          returnKeyType="next"
        />

        {/* ATP/WTA ranking — only for players */}
        {role === 'Player' && (
          <>
            <Text style={s.label}>ATP / WTA Ranking</Text>
            <TextInput
              style={s.input}
              value={ranking}
              onChangeText={setRanking}
              placeholder="e.g. 450"
              placeholderTextColor="#BBBBBB"
              keyboardType="number-pad"
              returnKeyType="next"
            />
          </>
        )}

        {/* Date of birth */}
        <Text style={s.label}>Date of birth</Text>
        <TextInput
          style={s.input}
          value={dob}
          onChangeText={setDob}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#BBBBBB"
          keyboardType="numbers-and-punctuation"
          returnKeyType="next"
        />

        {/* Home base */}
        <Text style={s.label}>Home base city</Text>
        <TextInput
          style={s.input}
          value={homeBase}
          onChangeText={setHomeBase}
          placeholder="e.g. Santiago"
          placeholderTextColor="#BBBBBB"
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={handleSave}
        />

        {!!error && <Text style={s.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[s.saveBtn, saving && s.saveBtnDisabled]}
          onPress={handleSave}
          activeOpacity={0.85}
          disabled={saving}>
          {saving
            ? <ActivityIndicator color="#FFFFFF" size="small" />
            : <Text style={s.saveBtnText}>Let's go →</Text>
          }
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAFAFA' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FAFAFA' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 24, paddingTop: 40, paddingBottom: 48 },

  title: { fontSize: 28, fontWeight: '800', color: '#2D2B55', marginBottom: 6 },
  subtitle: { fontSize: 15, color: '#888888', marginBottom: 32 },

  label: { fontSize: 13, fontWeight: '600', color: '#555555', marginBottom: 8, marginTop: 20 },

  roleRow: { flexDirection: 'row', gap: 10 },
  roleBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#DDDDDD',
    alignItems: 'center', backgroundColor: '#FFFFFF',
  },
  roleBtnActive: { borderColor: '#5B5BD6', backgroundColor: '#EEEEFF' },
  roleBtnText: { fontSize: 14, fontWeight: '600', color: '#AAAAAA' },
  roleBtnTextActive: { color: '#5B5BD6' },

  input: {
    backgroundColor: '#FFFFFF', borderRadius: 12,
    borderWidth: 1.5, borderColor: '#EBEBEB',
    paddingHorizontal: 16, paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 15, color: '#2D2B55',
  },

  errorText: { color: '#E24B4A', fontSize: 13, marginTop: 12, textAlign: 'center' },

  saveBtn: {
    backgroundColor: '#5B5BD6', borderRadius: 14,
    paddingVertical: 17, alignItems: 'center', marginTop: 32,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});

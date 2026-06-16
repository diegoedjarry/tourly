import React, { useState } from 'react';
import {
  View, Text, Image, StyleSheet, TouchableOpacity,
  StatusBar, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { db } from '@/db';

export default function WelcomeScreen() {
  const router = useRouter();
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleGoogleAuth() {
    setGoogleLoading(true);
    try {
      const redirectURL = Linking.createURL('auth-callback');
      const authUrl = db.auth.createAuthorizationURL({
        clientName: 'google',
        redirectURL,
      });
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectURL);
      if (result.type === 'success' && result.url) {
        const parsed = new URL(result.url);
        const code = parsed.searchParams.get('code');
        if (code) {
          await db.auth.exchangeCodeForToken({ code });
          router.replace('/complete-profile');
        }
      }
    } catch (e) {
      console.error('Google auth error:', e);
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#2D2B55" />

      {/* Logo + tagline */}
      <View style={s.hero}>
        <Image
          source={require('@/assets/images/tourly-logo.png')}
          style={s.logo}
          resizeMode="contain"
        />
        <Text style={s.tagline1}>Every city, every court, every dollar.</Text>
        <Text style={s.tagline2}>Take control of your tour.</Text>
      </View>

      {/* Auth options */}
      <View style={s.authBox}>
        <TouchableOpacity style={s.createBtn} activeOpacity={0.85}
          onPress={() => router.push('/signup')}>
          <Text style={s.createBtnText}>Create account</Text>
        </TouchableOpacity>

        <View style={s.dividerRow}>
          <View style={s.dividerLine} />
          <Text style={s.dividerText}>or continue with</Text>
          <View style={s.dividerLine} />
        </View>

        <View style={s.socialRow}>
          <TouchableOpacity style={s.socialBtn} activeOpacity={0.75}
            onPress={() => router.push('/signin')}>
            <Text style={s.socialBtnText}>🍎  Apple</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.socialBtn, googleLoading && s.socialBtnDisabled]}
            activeOpacity={0.75} onPress={handleGoogleAuth} disabled={googleLoading}>
            {googleLoading
              ? <ActivityIndicator color="#FFFFFF" size="small" />
              : <Text style={s.socialBtnText}>🌐  Google</Text>
            }
          </TouchableOpacity>
        </View>

        <TouchableOpacity activeOpacity={0.7} onPress={() => router.push('/signin')}
          style={s.signinRow}>
          <Text style={s.signinText}>Already have an account? </Text>
          <Text style={[s.signinText, s.signinLink]}>Sign in</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#2D2B55' },

  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logo: { width: 220, height: 70, marginBottom: 32 },
  tagline1: {
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    fontSize: 15,
    fontStyle: 'italic',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
    opacity: 0.85,
  },
  tagline2: {
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    fontSize: 19,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },

  authBox: {
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === 'android' ? 28 : 16,
  },
  createBtn: {
    backgroundColor: '#5B5BD6',
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    marginBottom: 20,
  },
  createBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.15)' },
  dividerText: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginHorizontal: 12 },

  socialRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  socialBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  socialBtnDisabled: { opacity: 0.6 },
  socialBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },

  signinRow: { flexDirection: 'row', justifyContent: 'center' },
  signinText: { color: 'rgba(255,255,255,0.45)', fontSize: 13 },
  signinLink: { color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
});

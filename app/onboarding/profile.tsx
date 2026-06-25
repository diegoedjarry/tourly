import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Alert,
  Platform,
  ScrollView,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useUpdateProfile } from '@/hooks/useProfile';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { TourlyLogo } from '@/components/ui/tourly-logo';

const ROLES = ['Player', 'Coach', 'Other'];
const SURFACES = [
  { key: 'clay', label: 'Clay', color: '#E8964A', bg: '#FAEEDA' },
  { key: 'hard', label: 'Hard', color: '#5AABEE', bg: '#E6F1FB' },
  { key: 'grass', label: 'Grass', color: '#68B83A', bg: '#EAF3DE' },
];

const ALL_COUNTRIES: { code: string; name: string; flag: string }[] = [
  { code: 'AF', name: 'Afghanistan', flag: '🇦🇫' },
  { code: 'AL', name: 'Albania', flag: '🇦🇱' },
  { code: 'DZ', name: 'Algeria', flag: '🇩🇿' },
  { code: 'AD', name: 'Andorra', flag: '🇦🇩' },
  { code: 'AO', name: 'Angola', flag: '🇦🇴' },
  { code: 'AG', name: 'Antigua and Barbuda', flag: '🇦🇬' },
  { code: 'AR', name: 'Argentina', flag: '🇦🇷' },
  { code: 'AM', name: 'Armenia', flag: '🇦🇲' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'AT', name: 'Austria', flag: '🇦🇹' },
  { code: 'AZ', name: 'Azerbaijan', flag: '🇦🇿' },
  { code: 'BS', name: 'Bahamas', flag: '🇧🇸' },
  { code: 'BH', name: 'Bahrain', flag: '🇧🇭' },
  { code: 'BD', name: 'Bangladesh', flag: '🇧🇩' },
  { code: 'BB', name: 'Barbados', flag: '🇧🇧' },
  { code: 'BY', name: 'Belarus', flag: '🇧🇾' },
  { code: 'BE', name: 'Belgium', flag: '🇧🇪' },
  { code: 'BZ', name: 'Belize', flag: '🇧🇿' },
  { code: 'BJ', name: 'Benin', flag: '🇧🇯' },
  { code: 'BT', name: 'Bhutan', flag: '🇧🇹' },
  { code: 'BO', name: 'Bolivia', flag: '🇧🇴' },
  { code: 'BA', name: 'Bosnia and Herzegovina', flag: '🇧🇦' },
  { code: 'BW', name: 'Botswana', flag: '🇧🇼' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  { code: 'BN', name: 'Brunei', flag: '🇧🇳' },
  { code: 'BG', name: 'Bulgaria', flag: '🇧🇬' },
  { code: 'BF', name: 'Burkina Faso', flag: '🇧🇫' },
  { code: 'BI', name: 'Burundi', flag: '🇧🇮' },
  { code: 'KH', name: 'Cambodia', flag: '🇰🇭' },
  { code: 'CM', name: 'Cameroon', flag: '🇨🇲' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'CV', name: 'Cape Verde', flag: '🇨🇻' },
  { code: 'CF', name: 'Central African Republic', flag: '🇨🇫' },
  { code: 'TD', name: 'Chad', flag: '🇹🇩' },
  { code: 'CL', name: 'Chile', flag: '🇨🇱' },
  { code: 'CN', name: 'China', flag: '🇨🇳' },
  { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
  { code: 'KM', name: 'Comoros', flag: '🇰🇲' },
  { code: 'CG', name: 'Congo', flag: '🇨🇬' },
  { code: 'CR', name: 'Costa Rica', flag: '🇨🇷' },
  { code: 'HR', name: 'Croatia', flag: '🇭🇷' },
  { code: 'CU', name: 'Cuba', flag: '🇨🇺' },
  { code: 'CY', name: 'Cyprus', flag: '🇨🇾' },
  { code: 'CZ', name: 'Czech Republic', flag: '🇨🇿' },
  { code: 'DK', name: 'Denmark', flag: '🇩🇰' },
  { code: 'DJ', name: 'Djibouti', flag: '🇩🇯' },
  { code: 'DM', name: 'Dominica', flag: '🇩🇲' },
  { code: 'DO', name: 'Dominican Republic', flag: '🇩🇴' },
  { code: 'EC', name: 'Ecuador', flag: '🇪🇨' },
  { code: 'EG', name: 'Egypt', flag: '🇪🇬' },
  { code: 'SV', name: 'El Salvador', flag: '🇸🇻' },
  { code: 'GQ', name: 'Equatorial Guinea', flag: '🇬🇶' },
  { code: 'ER', name: 'Eritrea', flag: '🇪🇷' },
  { code: 'EE', name: 'Estonia', flag: '🇪🇪' },
  { code: 'SZ', name: 'Eswatini', flag: '🇸🇿' },
  { code: 'ET', name: 'Ethiopia', flag: '🇪🇹' },
  { code: 'FJ', name: 'Fiji', flag: '🇫🇯' },
  { code: 'FI', name: 'Finland', flag: '🇫🇮' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'GA', name: 'Gabon', flag: '🇬🇦' },
  { code: 'GM', name: 'Gambia', flag: '🇬🇲' },
  { code: 'GE', name: 'Georgia', flag: '🇬🇪' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'GH', name: 'Ghana', flag: '🇬🇭' },
  { code: 'GR', name: 'Greece', flag: '🇬🇷' },
  { code: 'GD', name: 'Grenada', flag: '🇬🇩' },
  { code: 'GT', name: 'Guatemala', flag: '🇬🇹' },
  { code: 'GN', name: 'Guinea', flag: '🇬🇳' },
  { code: 'GW', name: 'Guinea-Bissau', flag: '🇬🇼' },
  { code: 'GY', name: 'Guyana', flag: '🇬🇾' },
  { code: 'HT', name: 'Haiti', flag: '🇭🇹' },
  { code: 'HN', name: 'Honduras', flag: '🇭🇳' },
  { code: 'HU', name: 'Hungary', flag: '🇭🇺' },
  { code: 'IS', name: 'Iceland', flag: '🇮🇸' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩' },
  { code: 'IR', name: 'Iran', flag: '🇮🇷' },
  { code: 'IQ', name: 'Iraq', flag: '🇮🇶' },
  { code: 'IE', name: 'Ireland', flag: '🇮🇪' },
  { code: 'IL', name: 'Israel', flag: '🇮🇱' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹' },
  { code: 'CI', name: 'Ivory Coast', flag: '🇨🇮' },
  { code: 'JM', name: 'Jamaica', flag: '🇯🇲' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'JO', name: 'Jordan', flag: '🇯🇴' },
  { code: 'KZ', name: 'Kazakhstan', flag: '🇰🇿' },
  { code: 'KE', name: 'Kenya', flag: '🇰🇪' },
  { code: 'KI', name: 'Kiribati', flag: '🇰🇮' },
  { code: 'KW', name: 'Kuwait', flag: '🇰🇼' },
  { code: 'KG', name: 'Kyrgyzstan', flag: '🇰🇬' },
  { code: 'LA', name: 'Laos', flag: '🇱🇦' },
  { code: 'LV', name: 'Latvia', flag: '🇱🇻' },
  { code: 'LB', name: 'Lebanon', flag: '🇱🇧' },
  { code: 'LS', name: 'Lesotho', flag: '🇱🇸' },
  { code: 'LR', name: 'Liberia', flag: '🇱🇷' },
  { code: 'LY', name: 'Libya', flag: '🇱🇾' },
  { code: 'LI', name: 'Liechtenstein', flag: '🇱🇮' },
  { code: 'LT', name: 'Lithuania', flag: '🇱🇹' },
  { code: 'LU', name: 'Luxembourg', flag: '🇱🇺' },
  { code: 'MG', name: 'Madagascar', flag: '🇲🇬' },
  { code: 'MW', name: 'Malawi', flag: '🇲🇼' },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾' },
  { code: 'MV', name: 'Maldives', flag: '🇲🇻' },
  { code: 'ML', name: 'Mali', flag: '🇲🇱' },
  { code: 'MT', name: 'Malta', flag: '🇲🇹' },
  { code: 'MH', name: 'Marshall Islands', flag: '🇲🇭' },
  { code: 'MR', name: 'Mauritania', flag: '🇲🇷' },
  { code: 'MU', name: 'Mauritius', flag: '🇲🇺' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
  { code: 'FM', name: 'Micronesia', flag: '🇫🇲' },
  { code: 'MD', name: 'Moldova', flag: '🇲🇩' },
  { code: 'MC', name: 'Monaco', flag: '🇲🇨' },
  { code: 'MN', name: 'Mongolia', flag: '🇲🇳' },
  { code: 'ME', name: 'Montenegro', flag: '🇲🇪' },
  { code: 'MA', name: 'Morocco', flag: '🇲🇦' },
  { code: 'MZ', name: 'Mozambique', flag: '🇲🇿' },
  { code: 'MM', name: 'Myanmar', flag: '🇲🇲' },
  { code: 'NA', name: 'Namibia', flag: '🇳🇦' },
  { code: 'NR', name: 'Nauru', flag: '🇳🇷' },
  { code: 'NP', name: 'Nepal', flag: '🇳🇵' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿' },
  { code: 'NI', name: 'Nicaragua', flag: '🇳🇮' },
  { code: 'NE', name: 'Niger', flag: '🇳🇪' },
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬' },
  { code: 'KP', name: 'North Korea', flag: '🇰🇵' },
  { code: 'MK', name: 'North Macedonia', flag: '🇲🇰' },
  { code: 'NO', name: 'Norway', flag: '🇳🇴' },
  { code: 'OM', name: 'Oman', flag: '🇴🇲' },
  { code: 'PK', name: 'Pakistan', flag: '🇵🇰' },
  { code: 'PW', name: 'Palau', flag: '🇵🇼' },
  { code: 'PS', name: 'Palestine', flag: '🇵🇸' },
  { code: 'PA', name: 'Panama', flag: '🇵🇦' },
  { code: 'PG', name: 'Papua New Guinea', flag: '🇵🇬' },
  { code: 'PY', name: 'Paraguay', flag: '🇵🇾' },
  { code: 'PE', name: 'Peru', flag: '🇵🇪' },
  { code: 'PH', name: 'Philippines', flag: '🇵🇭' },
  { code: 'PL', name: 'Poland', flag: '🇵🇱' },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹' },
  { code: 'QA', name: 'Qatar', flag: '🇶🇦' },
  { code: 'RO', name: 'Romania', flag: '🇷🇴' },
  { code: 'RU', name: 'Russia', flag: '🇷🇺' },
  { code: 'RW', name: 'Rwanda', flag: '🇷🇼' },
  { code: 'KN', name: 'Saint Kitts and Nevis', flag: '🇰🇳' },
  { code: 'LC', name: 'Saint Lucia', flag: '🇱🇨' },
  { code: 'VC', name: 'Saint Vincent', flag: '🇻🇨' },
  { code: 'WS', name: 'Samoa', flag: '🇼🇸' },
  { code: 'SM', name: 'San Marino', flag: '🇸🇲' },
  { code: 'ST', name: 'Sao Tome and Principe', flag: '🇸🇹' },
  { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
  { code: 'SN', name: 'Senegal', flag: '🇸🇳' },
  { code: 'RS', name: 'Serbia', flag: '🇷🇸' },
  { code: 'SC', name: 'Seychelles', flag: '🇸🇨' },
  { code: 'SL', name: 'Sierra Leone', flag: '🇸🇱' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'SK', name: 'Slovakia', flag: '🇸🇰' },
  { code: 'SI', name: 'Slovenia', flag: '🇸🇮' },
  { code: 'SB', name: 'Solomon Islands', flag: '🇸🇧' },
  { code: 'SO', name: 'Somalia', flag: '🇸🇴' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
  { code: 'SS', name: 'South Sudan', flag: '🇸🇸' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸' },
  { code: 'LK', name: 'Sri Lanka', flag: '🇱🇰' },
  { code: 'SD', name: 'Sudan', flag: '🇸🇩' },
  { code: 'SR', name: 'Suriname', flag: '🇸🇷' },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭' },
  { code: 'SY', name: 'Syria', flag: '🇸🇾' },
  { code: 'TW', name: 'Taiwan', flag: '🇹🇼' },
  { code: 'TJ', name: 'Tajikistan', flag: '🇹🇯' },
  { code: 'TZ', name: 'Tanzania', flag: '🇹🇿' },
  { code: 'TH', name: 'Thailand', flag: '🇹🇭' },
  { code: 'TL', name: 'Timor-Leste', flag: '🇹🇱' },
  { code: 'TG', name: 'Togo', flag: '🇹🇬' },
  { code: 'TO', name: 'Tonga', flag: '🇹🇴' },
  { code: 'TT', name: 'Trinidad and Tobago', flag: '🇹🇹' },
  { code: 'TN', name: 'Tunisia', flag: '🇹🇳' },
  { code: 'TR', name: 'Turkey', flag: '🇹🇷' },
  { code: 'TM', name: 'Turkmenistan', flag: '🇹🇲' },
  { code: 'TV', name: 'Tuvalu', flag: '🇹🇻' },
  { code: 'UG', name: 'Uganda', flag: '🇺🇬' },
  { code: 'UA', name: 'Ukraine', flag: '🇺🇦' },
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'UY', name: 'Uruguay', flag: '🇺🇾' },
  { code: 'UZ', name: 'Uzbekistan', flag: '🇺🇿' },
  { code: 'VU', name: 'Vanuatu', flag: '🇻🇺' },
  { code: 'VA', name: 'Vatican City', flag: '🇻🇦' },
  { code: 'VE', name: 'Venezuela', flag: '🇻🇪' },
  { code: 'VN', name: 'Vietnam', flag: '🇻🇳' },
  { code: 'YE', name: 'Yemen', flag: '🇾🇪' },
  { code: 'ZM', name: 'Zambia', flag: '🇿🇲' },
  { code: 'ZW', name: 'Zimbabwe', flag: '🇿🇼' },
];

export default function OnboardingProfileScreen() {
  const router = useRouter();
  const updateProfile = useUpdateProfile();

  async function handleSkip() {
    // Mark onboarding complete so we never land here again on re-login
    try {
      await updateProfile.mutateAsync({ onboarding_complete: true } as any);
    } catch {}
    router.replace('/(tabs)');
  }

  const [name, setName] = useState('');
  const [role, setRole] = useState('Player');
  const [nationality, setNationality] = useState('');
  const [natSearch, setNatSearch] = useState('');
  const [natFocused, setNatFocused] = useState(false);
  const [ranking, setRanking] = useState('');
  const [dob, setDob] = useState('');
  const [city, setCity] = useState('');
  const [budget, setBudget] = useState('');
  const [surface, setSurface] = useState('');

  const selectedCountry = ALL_COUNTRIES.find(c => c.code === nationality);
  const filteredCountries = natSearch.trim()
    ? ALL_COUNTRIES.filter(c =>
        c.name.toLowerCase().includes(natSearch.toLowerCase()) ||
        c.code.toLowerCase().includes(natSearch.toLowerCase()))
    : ALL_COUNTRIES;

  async function handleContinue() {
    if (!name.trim()) return;
    try {
      await updateProfile.mutateAsync({
        full_name: name.trim(),
        role,
        nationality: nationality || null,
        ranking: role === 'Player' && ranking ? parseInt(ranking, 10) : null,
        date_of_birth: dob || null,
        home_city: city.trim() || null,
        annual_budget: budget ? parseInt(budget, 10) : null,
        primary_surface: surface || null,
        onboarding_complete: true,
      } as any);
      router.replace('/onboarding/walkthrough');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save profile. Please try again.');
    }
  }

  const canContinue = name.trim().length > 0;

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <View style={s.logo}><TourlyLogo width={180} height={48} /></View>

          <TouchableOpacity style={s.skipBtn} onPress={handleSkip} activeOpacity={0.7}>
            <Text style={s.skipText}>Already set up? Skip →</Text>
          </TouchableOpacity>

          <View style={s.card}>
            <Text style={s.title}>Tourly Walkthrough</Text>
            <Text style={s.subtitle}>Tell us about yourself so we can personalize your experience.</Text>

            {/* Full name */}
            <Text style={s.label}>FULL NAME</Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder="Your full name"
              placeholderTextColor="#A0A0B8"
              autoCapitalize="words"
            />

            {/* Role */}
            <Text style={s.label}>ROLE</Text>
            <View style={s.pillRow}>
              {ROLES.map(r => (
                <TouchableOpacity
                  key={r}
                  style={[s.pill, role === r && s.pillActive]}
                  onPress={() => setRole(r)}
                  activeOpacity={0.7}>
                  <Text style={[s.pillText, role === r && s.pillTextActive]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Nationality */}
            <Text style={s.label}>NATIONALITY</Text>
            {selectedCountry && !natFocused ? (
              <TouchableOpacity
                style={s.selectedCountryRow}
                onPress={() => { setNatSearch(''); setNatFocused(true); setNationality(''); }}
                activeOpacity={0.7}>
                <Text style={s.selectedCountryText}>{selectedCountry.flag}  {selectedCountry.name}</Text>
                <Text style={s.clearX}>✕</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TextInput
                  style={s.input}
                  value={natSearch}
                  onChangeText={(v) => { setNatSearch(v); setNatFocused(true); }}
                  onFocus={() => setNatFocused(true)}
                  placeholder="Search country..."
                  placeholderTextColor="#A0A0B8"
                  autoCapitalize="none"
                />
                {natFocused && filteredCountries.length > 0 && (
                  <View style={s.suggestionsBox}>
                    <ScrollView style={s.suggestionsList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                      {filteredCountries.slice(0, 8).map(c => (
                        <TouchableOpacity
                          key={c.code}
                          style={s.suggestionItem}
                          onPress={() => { setNationality(c.code); setNatSearch(''); setNatFocused(false); }}
                          activeOpacity={0.7}>
                          <Text style={s.suggestionFlag}>{c.flag}</Text>
                          <Text style={s.suggestionName}>{c.name}</Text>
                          <Text style={s.suggestionCode}>{c.code}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </>
            )}

            {/* ATP/WTA Ranking — only for Player */}
            {role === 'Player' && (
              <>
                <Text style={s.label}>ATP / WTA RANKING</Text>
                <TextInput
                  style={s.input}
                  value={ranking}
                  onChangeText={setRanking}
                  placeholder="ex. 450"
                  placeholderTextColor="#A0A0B8"
                  keyboardType="number-pad"
                />
              </>
            )}

            {/* Date of birth */}
            <Text style={s.label}>DATE OF BIRTH</Text>
            <DatePickerField value={dob} onChange={setDob} placeholder="Select date" />

            {/* Home base city */}
            <Text style={s.label}>HOME BASE CITY</Text>
            <TextInput
              style={s.input}
              value={city}
              onChangeText={setCity}
              placeholder="ex. Santiago"
              placeholderTextColor="#A0A0B8"
              autoCapitalize="words"
            />

            {/* Annual budget */}
            <Text style={s.label}>ANNUAL TOURNAMENT BUDGET (USD)</Text>
            <TextInput
              style={s.input}
              value={budget}
              onChangeText={setBudget}
              placeholder="ex. 25000"
              placeholderTextColor="#A0A0B8"
              keyboardType="number-pad"
            />

            {/* Primary surface */}
            <Text style={s.label}>PRIMARY SURFACE</Text>
            <View style={s.pillRow}>
              {SURFACES.map(sf => (
                <TouchableOpacity
                  key={sf.key}
                  style={[
                    s.pill,
                    surface === sf.key && { backgroundColor: sf.bg, borderWidth: 2, borderColor: sf.color },
                  ]}
                  onPress={() => setSurface(surface === sf.key ? '' : sf.key)}
                  activeOpacity={0.7}>
                  <Text style={[s.pillText, surface === sf.key && { color: sf.color }]}>{sf.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[s.btn, (!canContinue || updateProfile.isPending) && s.btnDisabled]}
              onPress={handleContinue}
              activeOpacity={0.85}
              disabled={!canContinue || updateProfile.isPending}>
              {updateProfile.isPending ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={s.btnText}>Continue →</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F0F0F8' },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  logo: { alignSelf: 'center', marginBottom: 28 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingVertical: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 5,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#2D2B55', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#8888A8', marginBottom: 22, lineHeight: 20 },
  label: { fontSize: 11, fontWeight: '600', color: '#8888A8', letterSpacing: 0.6, marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: '#F4F4FA',
    borderRadius: 50,
    paddingHorizontal: 20,
    paddingVertical: Platform.OS === 'ios' ? 15 : 13,
    fontSize: 15,
    color: '#2D2B55',
  },
  pillRow: { flexDirection: 'row', gap: 8 },
  pill: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 50,
    backgroundColor: '#F4F4FA',
  },
  pillActive: { backgroundColor: '#00D4AA' },
  pillText: { fontSize: 14, fontWeight: '600', color: '#8888A8' },
  pillTextActive: { color: '#FFFFFF' },
  selectedCountryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E8FFF8',
    borderRadius: 50,
    paddingHorizontal: 20,
    paddingVertical: Platform.OS === 'ios' ? 15 : 13,
    borderWidth: 2,
    borderColor: '#00D4AA',
  },
  selectedCountryText: { fontSize: 15, color: '#2D2B55', fontWeight: '600' },
  clearX: { fontSize: 16, color: '#AAAAAA', fontWeight: '600' },
  suggestionsBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    overflow: 'hidden',
  },
  suggestionsList: { maxHeight: 240 },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  suggestionFlag: { fontSize: 20 },
  suggestionName: { flex: 1, fontSize: 15, color: '#2D2B55' },
  suggestionCode: { fontSize: 12, fontWeight: '600', color: '#8888A8' },
  btn: {
    backgroundColor: '#00D4AA',
    borderRadius: 50,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  skipBtn: { alignSelf: 'center', marginBottom: 12, paddingVertical: 8, paddingHorizontal: 16 },
  skipText: { fontSize: 14, color: '#8888A8', fontWeight: '500' },
});

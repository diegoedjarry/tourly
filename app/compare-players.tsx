import React, { useState, useMemo } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/text';
import { useAppQuery } from '@/hooks/useAppQuery';

const DEMO_OPPONENT = {
  name: 'R. Nadal',
  ranking: 672,
  winRate: '84%',
  clayWR: '91%',
  hardWR: '78%',
  grassWR: '74%',
  bestCategory: 'Challenger',
};

export default function ComparePlayersScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const { data } = useAppQuery({});
  const tournaments = data?.tournaments ?? [];

  const bestCategory = useMemo(() => {
    if (!tournaments.length) return '—';
    const counts: Record<string, number> = {};
    tournaments.forEach((t: any) => {
      const cat = t.category ?? 'Unknown';
      counts[cat] = (counts[cat] ?? 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] ?? '—';
  }, [tournaments]);

  const STATS = [
    { label: 'Ranking',      you: '—',         note: 'Set in profile',      opp: String(DEMO_OPPONENT.ranking) },
    { label: 'Win Rate',     you: '—',         note: 'Log results to unlock', opp: DEMO_OPPONENT.winRate },
    { label: 'Clay W/R',     you: '—',         note: 'Log results to unlock', opp: DEMO_OPPONENT.clayWR },
    { label: 'Hard W/R',     you: '—',         note: 'Log results to unlock', opp: DEMO_OPPONENT.hardWR },
    { label: 'Grass W/R',    you: '—',         note: 'Log results to unlock', opp: DEMO_OPPONENT.grassWR },
    { label: 'Best Category', you: bestCategory, note: null,                   opp: DEMO_OPPONENT.bestCategory },
  ];

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0F0F1A" />

      {/* Header */}
      <View style={s.header}>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Compare Players</Text>
        </View>
        <TouchableOpacity style={s.closeBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="close" size={22} color="#FAFAFA" />
        </TouchableOpacity>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Search bar */}
        <View style={s.searchWrap}>
          <Ionicons name="search" size={18} color="#A0A0C8" style={s.searchIcon} />
          <TextInput
            style={s.searchInput}
            placeholder="Search player by name..."
            placeholderTextColor="#6060A0"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="words"
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} activeOpacity={0.7}>
              <Ionicons name="close-circle" size={18} color="#6060A0" />
            </TouchableOpacity>
          )}
        </View>

        {/* Search results / empty state */}
        {query.length === 0 ? (
          <Text style={s.searchHint}>Type a player's name to search</Text>
        ) : (
          <View style={s.comingSoonBox}>
            <Text style={s.comingSoonTitle}>ITF player search coming soon</Text>
            <Text style={s.comingSoonSub}>Player database integration in progress</Text>
          </View>
        )}

        {/* Comparison preview */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>PREVIEW — DEMO DATA</Text>

          {/* Column headers */}
          <View style={[s.statRow, s.statHeader]}>
            <Text style={[s.statCell, s.statLabel]}>{' '}</Text>
            <View style={[s.statCell, s.youCol]}>
              <Text style={s.colHeaderYou}>You</Text>
            </View>
            <View style={[s.statCell, s.oppCol]}>
              <Text style={s.colHeaderOpp}>{DEMO_OPPONENT.name}</Text>
              <View style={s.previewBadge}>
                <Text style={s.previewBadgeText}>Preview</Text>
              </View>
            </View>
          </View>

          {STATS.map((row, idx) => (
            <View key={row.label} style={[s.statRow, idx % 2 === 0 ? s.rowEven : s.rowOdd]}>
              <Text style={[s.statCell, s.statLabel]}>{row.label}</Text>
              <View style={[s.statCell, s.youCol]}>
                <Text style={s.statValue}>{row.you}</Text>
                {row.note && row.you === '—' && (
                  <Text style={s.statNote}>{row.note}</Text>
                )}
              </View>
              <View style={[s.statCell, s.oppCol]}>
                <Text style={s.statValue}>{row.opp}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0F0F1A' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },

  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A4A',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#FAFAFA' },
  closeBtn: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1A1A2E',
    alignItems: 'center',
    justifyContent: 'center',
  },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#252540',
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    color: '#FAFAFA',
    fontSize: 15,
    paddingVertical: 14,
  },

  searchHint: { fontSize: 13, color: '#A0A0C8', textAlign: 'center', marginTop: 12, marginBottom: 16 },

  comingSoonBox: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A2A4A',
  },
  comingSoonTitle: { fontSize: 15, fontWeight: '600', color: '#FAFAFA', marginBottom: 4 },
  comingSoonSub: { fontSize: 13, color: '#A0A0C8' },

  section: { marginHorizontal: 16, marginTop: 20 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#A0A0C8',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },

  statRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 6 },
  statHeader: { marginBottom: 2 },
  rowEven: { backgroundColor: '#1A1A2E' },
  rowOdd: { backgroundColor: '#151525' },

  statCell: { flex: 1, paddingVertical: 10, paddingHorizontal: 10 },
  statLabel: { fontSize: 13, color: '#A0A0C8', fontWeight: '500' },
  youCol: {
    backgroundColor: 'rgba(91,91,214,0.10)',
    borderRadius: 4,
  },
  oppCol: { backgroundColor: '#1A1A2E', borderRadius: 4 },

  colHeaderYou: { fontSize: 13, fontWeight: '700', color: '#5B5BD6', textAlign: 'center' },
  colHeaderOpp: { fontSize: 13, fontWeight: '700', color: '#FAFAFA', textAlign: 'center' },

  previewBadge: {
    backgroundColor: '#2A2A4A',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'center',
    marginTop: 2,
  },
  previewBadgeText: { fontSize: 9, fontWeight: '700', color: '#A0A0C8', textTransform: 'uppercase', letterSpacing: 0.5 },

  statValue: { fontSize: 15, fontWeight: '600', color: '#FAFAFA', textAlign: 'center' },
  statNote: { fontSize: 9, color: '#6060A0', textAlign: 'center', marginTop: 2 },
});

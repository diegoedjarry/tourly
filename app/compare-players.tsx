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
  surfaceWR: { clay: '91%', hard: '78%', grass: '74%' },
  bestCategory: 'Challenger',
  // Scraper fields — placeholder until integration is live
  dob: 'Jun 3, 1986',
  height: '1.85 m',
  previousResults: 'Coming soon',
};

type ViewMode = 'player' | 'compare';
type Surface = 'clay' | 'hard' | 'grass';

const SURFACE_COLORS: Record<Surface, string> = {
  clay: '#D4915A',
  hard: '#5A8CD4',
  grass: '#5ABE6E',
};

export default function ComparePlayersScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('player');
  const [surfaceExpanded, setSurfaceExpanded] = useState(false);
  const [selectedSurface, setSelectedSurface] = useState<Surface | null>(null);

  const { data } = useAppQuery({});
  const tournaments = data?.tournaments ?? [];

  const bestCategory = useMemo(() => {
    if (!tournaments.length) return '—';
    const counts: Record<string, number> = {};
    tournaments.forEach((t: any) => {
      const cat = t.category ?? 'Unknown';
      counts[cat] = (counts[cat] ?? 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
  }, [tournaments]);

  const showCompare = viewMode === 'compare';

  // Surface win rate display value for the main row
  const surfaceRowOpp = selectedSurface
    ? DEMO_OPPONENT.surfaceWR[selectedSurface]
    : 'Tap to expand';

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

        {query.length === 0 ? (
          <Text style={s.searchHint}>Type a player's name to search</Text>
        ) : (
          <View style={s.comingSoonBox}>
            <Text style={s.comingSoonTitle}>ITF player search coming soon</Text>
            <Text style={s.comingSoonSub}>Player database integration in progress</Text>
          </View>
        )}

        {/* View mode toggle */}
        <View style={s.modeToggle}>
          <TouchableOpacity
            style={[s.modeBtn, viewMode === 'player' && s.modeBtnActive]}
            onPress={() => setViewMode('player')}
            activeOpacity={0.7}
          >
            <Text style={[s.modeBtnText, viewMode === 'player' && s.modeBtnTextActive]}>
              Player Stats
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.modeBtn, viewMode === 'compare' && s.modeBtnActive]}
            onPress={() => setViewMode('compare')}
            activeOpacity={0.7}
          >
            <Text style={[s.modeBtnText, viewMode === 'compare' && s.modeBtnTextActive]}>
              Compare to Me
            </Text>
          </TouchableOpacity>
        </View>

        {/* Stats table */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>PREVIEW — DEMO DATA</Text>

          {/* Column headers */}
          <View style={[s.statRow, s.statHeader]}>
            <View style={s.statLabelCell} />
            {showCompare && (
              <View style={[s.statDataCell, s.youCol]}>
                <Text style={s.colHeaderYou}>You</Text>
              </View>
            )}
            <View style={[s.statDataCell, s.oppCol]}>
              <Text style={s.colHeaderOpp}>{DEMO_OPPONENT.name}</Text>
              <View style={s.previewBadge}>
                <Text style={s.previewBadgeText}>Preview</Text>
              </View>
            </View>
          </View>

          {/* Ranking */}
          <StatRow label="Ranking" opp={String(DEMO_OPPONENT.ranking)} you="—" youNote="Set in profile" showYou={showCompare} even />

          {/* Win Rate */}
          <StatRow label="Win Rate" opp={DEMO_OPPONENT.winRate} you="—" youNote="Log results" showYou={showCompare} />

          {/* Surface Win Rate — expandable */}
          <TouchableOpacity
            style={[s.statRow, s.rowEven]}
            onPress={() => setSurfaceExpanded(v => !v)}
            activeOpacity={0.8}
          >
            <View style={s.statLabelCell}>
              <Text style={s.statLabel}>Surface W/R</Text>
            </View>
            {showCompare && (
              <View style={[s.statDataCell, s.youCol]}>
                <Text style={s.statValue}>{selectedSurface ? '—' : '—'}</Text>
              </View>
            )}
            <View style={[s.statDataCell, s.oppCol, { flexDirection: 'row', justifyContent: 'center', gap: 4 }]}>
              <Text style={s.statValue}>
                {selectedSurface ? DEMO_OPPONENT.surfaceWR[selectedSurface] : '—'}
              </Text>
              <Ionicons name={surfaceExpanded ? 'chevron-up' : 'chevron-down'} size={14} color="#A0A0C8" />
            </View>
          </TouchableOpacity>

          {/* Surface pills */}
          {surfaceExpanded && (
            <View style={s.surfacePillRow}>
              {(['clay', 'hard', 'grass'] as Surface[]).map(sf => (
                <TouchableOpacity
                  key={sf}
                  style={[
                    s.surfacePill,
                    { borderColor: SURFACE_COLORS[sf] },
                    selectedSurface === sf && { backgroundColor: SURFACE_COLORS[sf] },
                  ]}
                  onPress={() => setSelectedSurface(v => v === sf ? null : sf)}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    s.surfacePillText,
                    { color: selectedSurface === sf ? '#FFF' : SURFACE_COLORS[sf] },
                  ]}>
                    {sf.charAt(0).toUpperCase() + sf.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Best Category */}
          <StatRow label="Best Category" opp={DEMO_OPPONENT.bestCategory} you={bestCategory} showYou={showCompare} even />

          {/* ── Coming soon once scraper is live ── */}
          <View style={s.futureHeader}>
            <Text style={s.futureSep}>Coming soon — ITF data</Text>
          </View>
          <StatRow label="Date of Birth" opp={DEMO_OPPONENT.dob} you="—" youNote="From profile" showYou={showCompare} even />
          <StatRow label="Height" opp={DEMO_OPPONENT.height} you="—" youNote="From profile" showYou={showCompare} />
          <StatRow label="Prev. Results" opp="—" you="—" youNote="Scraper pending" showYou={showCompare} even />
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function StatRow({
  label, opp, you, youNote, showYou, even,
}: {
  label: string; opp: string; you: string; youNote?: string; showYou: boolean; even?: boolean;
}) {
  return (
    <View style={[s.statRow, even ? s.rowEven : s.rowOdd]}>
      <View style={s.statLabelCell}>
        <Text style={s.statLabel}>{label}</Text>
      </View>
      {showYou && (
        <View style={[s.statDataCell, s.youCol]}>
          <Text style={s.statValue}>{you}</Text>
          {youNote && you === '—' && <Text style={s.statNote}>{youNote}</Text>}
        </View>
      )}
      <View style={[s.statDataCell, s.oppCol]}>
        <Text style={s.statValue}>{opp}</Text>
      </View>
    </View>
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
  searchInput: { flex: 1, color: '#FAFAFA', fontSize: 15, paddingVertical: 14 },
  searchHint: { fontSize: 13, color: '#A0A0C8', textAlign: 'center', marginTop: 12, marginBottom: 4 },

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

  modeToggle: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#1A1A2E',
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: '#2A2A4A',
  },
  modeBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  modeBtnActive: { backgroundColor: '#5B5BD6' },
  modeBtnText: { fontSize: 13, fontWeight: '600', color: '#A0A0C8' },
  modeBtnTextActive: { color: '#FAFAFA' },

  section: { marginHorizontal: 16, marginTop: 16 },
  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: '#A0A0C8',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10,
  },

  statRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 6 },
  statHeader: { marginBottom: 2 },
  rowEven: { backgroundColor: '#1A1A2E' },
  rowOdd: { backgroundColor: '#151525' },

  statLabelCell: { width: 108, paddingVertical: 11, paddingLeft: 12, paddingRight: 6 },
  statDataCell: { flex: 1, paddingVertical: 11, paddingHorizontal: 8, alignItems: 'center' },
  statLabel: { fontSize: 12, color: '#A0A0C8', fontWeight: '500' },
  youCol: { backgroundColor: 'rgba(91,91,214,0.10)' },
  oppCol: {},

  colHeaderYou: { fontSize: 13, fontWeight: '700', color: '#5B5BD6', textAlign: 'center' },
  colHeaderOpp: { fontSize: 13, fontWeight: '700', color: '#FAFAFA', textAlign: 'center' },
  previewBadge: {
    backgroundColor: '#2A2A4A', borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'center', marginTop: 2,
  },
  previewBadgeText: { fontSize: 9, fontWeight: '700', color: '#A0A0C8', textTransform: 'uppercase', letterSpacing: 0.5 },

  statValue: { fontSize: 14, fontWeight: '600', color: '#FAFAFA', textAlign: 'center' },
  statNote: { fontSize: 9, color: '#6060A0', textAlign: 'center', marginTop: 2 },

  surfacePillRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#0F0F1A',
    justifyContent: 'center',
  },
  surfacePill: {
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  surfacePillText: { fontSize: 13, fontWeight: '700' },

  futureHeader: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: '#2A2A4A',
    marginTop: 4,
  },
  futureSep: { fontSize: 10, color: '#6060A0', textTransform: 'uppercase', letterSpacing: 0.8 },
});

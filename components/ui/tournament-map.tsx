import React, { useRef, useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  Animated,
  PanResponder,
  Pressable,
  TouchableOpacity,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { CITY_COORDS, COUNTRY_CENTERS } from './map-data';

// ─── Helpers ────────────────────────────────────────────────────────────────

function lookupCoords(city?: string, country?: string): [number, number] | null {
  if (city) {
    const key = city.trim();
    if (CITY_COORDS[key]) return CITY_COORDS[key];
    const lower = key.toLowerCase();
    for (const [k, v] of Object.entries(CITY_COORDS)) {
      if (k.toLowerCase() === lower) return v;
    }
  }
  if (country) {
    const code = country.toUpperCase();
    if (COUNTRY_CENTERS[code]) return COUNTRY_CENTERS[code];
  }
  return null;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function daysBetweenDates(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.abs(
    new Date(ay, am - 1, ad).getTime() - new Date(by, bm - 1, bd).getTime(),
  ) / 86400000;
}

function parseLocalDate(str: string | undefined): Date | null {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtDateRange(start: string, end?: string): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [sy, sm, sd] = start.split('-').map(Number);
  if (!end) return `${sd} ${MONTHS[sm - 1]} ${sy}`;
  const [ey, em, ed] = end.split('-').map(Number);
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS[sm - 1]} ${sy}`;
  return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]} ${ey}`;
}

// ─── Dark map style ─────────────────────────────────────────────────────────

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1A1A2E' }] },
  { elementType: 'labels', stylers: [{ visibility: 'off' }] },
  // Country borders
  {
    featureType: 'administrative.country',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#3D3D6B' }, { visibility: 'on' }, { weight: 1 }],
  },
  // Country name labels — visible when zoomed in
  {
    featureType: 'administrative.country',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#8888AA' }, { visibility: 'on' }],
  },
  {
    featureType: 'administrative.country',
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#0F0F1A' }, { visibility: 'on' }, { weight: 2 }],
  },
  {
    featureType: 'administrative.province',
    elementType: 'geometry.stroke',
    stylers: [{ visibility: 'off' }],
  },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0F0F1A' }] },
  { featureType: 'road', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface TournamentMapProps {
  tournaments: any[];
  onOpenTournament?: (id: string) => void;
  /** Legacy alias kept for backward-compat */
  onSelectTournament?: (id: string) => void;
  onAddTournament?: () => void;
  onClose?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TournamentMap({
  tournaments,
  onOpenTournament,
  onSelectTournament,
  onAddTournament,
  onClose,
}: TournamentMapProps) {
  const mapRef = useRef<MapView>(null);
  const [selectedGroup, setSelectedGroup] = useState<any[] | null>(null);
  const slideAnim = useRef(new Animated.Value(300)).current;

  // Resolve open-tournament callback (support both prop names)
  const handleOpen = useCallback(
    (id: string) => {
      onOpenTournament?.(id);
      onSelectTournament?.(id);
      setSelectedGroup(null);
      slideAnim.setValue(300);
    },
    [onOpenTournament, onSelectTournament, slideAnim],
  );

  // Build list of tournaments that have valid coordinates
  const mapped = useMemo(() => {
    return tournaments
      .map((t) => {
        const coords = lookupCoords(t.city, t.country);
        if (!coords) return null;
        const [lon, lat] = coords;
        return { t, lat, lon };
      })
      .filter(Boolean) as { t: any; lat: number; lon: number }[];
  }, [tournaments]);

  // Group tournaments by coordinate so stacked ones share one marker
  const groups = useMemo(() => {
    const map = new Map<string, { lat: number; lon: number; items: any[] }>();
    for (const { t, lat, lon } of mapped) {
      const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
      if (!map.has(key)) map.set(key, { lat, lon, items: [] });
      map.get(key)!.items.push(t);
    }
    return Array.from(map.values());
  }, [mapped]);

  const allCoords = useMemo(
    () => groups.map(({ lat, lon }) => ({ latitude: lat, longitude: lon })),
    [groups],
  );

  // Initial region
  const initialRegion =
    allCoords.length === 0
      ? { latitude: 20, longitude: 0, latitudeDelta: 100, longitudeDelta: 160 }
      : undefined;

  // Fit map on ready
  const handleMapReady = useCallback(() => {
    if (allCoords.length > 0) {
      mapRef.current?.fitToCoordinates(allCoords, {
        edgePadding: { top: 60, right: 40, bottom: 60, left: 40 },
        animated: false,
      });
    }
  }, [allCoords]);

  // Re-fit when tournament list changes
  const prevLen = useRef(groups.length);
  useEffect(() => {
    if (groups.length !== prevLen.current) {
      prevLen.current = groups.length;
      if (allCoords.length > 0) {
        mapRef.current?.fitToCoordinates(allCoords, {
          edgePadding: { top: 60, right: 40, bottom: 60, left: 40 },
          animated: true,
        });
      }
    }
  }, [groups.length, allCoords]);

  // Show bottom sheet for a group of tournaments at the same location
  const openSheet = useCallback(
    (items: any[]) => {
      setSelectedGroup(items);
      slideAnim.setValue(300);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    },
    [slideAnim],
  );

  const closeSheet = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: 300,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setSelectedGroup(null);
      slideAnim.setValue(300);
    });
  }, [slideAnim]);

  // PanResponder to dismiss sheet on downward swipe
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 10,
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 50) {
          Animated.timing(slideAnim, {
            toValue: 300,
            duration: 250,
            useNativeDriver: true,
          }).start(() => {
            setSelectedGroup(null);
            slideAnim.setValue(300);
          });
        } else {
          Animated.spring(slideAnim, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;


  // Deadline pill logic
  const DeadlinePill = useCallback(({ t }: { t: any }) => {
    const deadlines: { label: string; date: Date | null }[] = [
      { label: 'Entry closes', date: parseLocalDate(t.signUpDeadline) },
      { label: 'Withdrawal', date: parseLocalDate(t.withdrawalDeadline) },
      { label: 'Freeze', date: parseLocalDate(t.freezeDeadline) },
    ];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let best: { label: string; days: number } | null = null;
    for (const { label, date } of deadlines) {
      if (!date) continue;
      const days = Math.ceil((date.getTime() - today.getTime()) / 86400000);
      if (days < 0) continue;
      if (!best || days < best.days) best = { label, days };
    }

    if (!best) return null;
    const { label, days } = best;
    let bg: string, color: string;
    if (days <= 7) { bg = 'rgba(226,75,74,0.18)'; color = '#E24B4A'; }
    else if (days <= 14) { bg = 'rgba(245,158,11,0.18)'; color = '#F59E0B'; }
    else { bg = 'rgba(45,158,107,0.18)'; color = '#2D9E6B'; }

    return (
      <View style={[styles.pill, { backgroundColor: bg }]}>
        <Text style={[styles.pillText, { color }]}>
          {label} in {days}d
        </Text>
      </View>
    );
  }, []);

  const hasNoLocations = allCoords.length === 0;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        mapType="standard"
        customMapStyle={DARK_MAP_STYLE}
        initialRegion={initialRegion}
        onMapReady={handleMapReady}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
        toolbarEnabled={false}
      >
        {groups.map(({ lat, lon, items }) => {
          const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
          const first = items[0];
          const dotColor = first.surface === 'clay' ? '#D4915A' : first.surface === 'grass' ? '#5ABE6E' : '#5A8CD4';
          const count = items.length;
          return (
            <Marker
              key={key}
              coordinate={{ latitude: lat, longitude: lon }}
              onPress={() => openSheet(items)}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={styles.dotOuter}>
                <View style={[styles.dotInner, { backgroundColor: dotColor }]} />
                {count > 1 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{count}</Text>
                  </View>
                )}
              </View>
            </Marker>
          );
        })}
      </MapView>

      {/* Empty state overlay */}
      {hasNoLocations && (
        <View style={styles.emptyOverlay}>
          <Text style={styles.emptyTitle}>No tournaments added yet</Text>
          <Text style={styles.emptySubtitle}>Add tournaments to see them on your map</Text>
          {onAddTournament && (
            <TouchableOpacity style={styles.addBtn} onPress={onAddTournament} activeOpacity={0.8}>
              <Text style={styles.addBtnText}>+</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Reset / fit-all button */}
      {!hasNoLocations && (
        <TouchableOpacity
          style={styles.resetBtn}
          onPress={() =>
            mapRef.current?.fitToCoordinates(allCoords, {
              edgePadding: { top: 60, right: 40, bottom: 60, left: 40 },
              animated: true,
            })
          }
          activeOpacity={0.8}
        >
          <Text style={styles.resetIcon}>⊕</Text>
        </TouchableOpacity>
      )}

      {/* Close button (if onClose provided — e.g. used inside a Modal) */}
      {onClose && (
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
      )}

      {/* Backdrop dismiss overlay */}
      {selectedGroup && (
        <Pressable style={styles.sheetBackdrop} onPress={closeSheet} />
      )}

      {/* Bottom sheet */}
      {selectedGroup && (
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}
          {...panResponder.panHandlers}
        >
          <View style={styles.handle} />
          {selectedGroup.length > 1 && (
            <Text style={styles.sheetGroupLabel}>
              {selectedGroup.length} tournaments · {selectedGroup[0].city ?? selectedGroup[0].country}
            </Text>
          )}
          {selectedGroup.map((t, i) => (
            <View key={t.id} style={[styles.sheetItem, i > 0 && styles.sheetItemBorder]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetName}>{t.name}</Text>
                <Text style={styles.sheetDates}>
                  {fmtDateRange(t.startDate, t.endDate)}
                </Text>
                {(t.category || t.country) && (
                  <Text style={styles.sheetMeta}>
                    {[t.category, t.country].filter(Boolean).join('  ·  ')}
                  </Text>
                )}
                <DeadlinePill t={t} />
              </View>
              <TouchableOpacity
                style={styles.viewBtnSmall}
                activeOpacity={0.85}
                onPress={() => handleOpen(t.id)}
              >
                <Text style={styles.viewBtnText}>View</Text>
              </TouchableOpacity>
            </View>
          ))}
        </Animated.View>
      )}
    </View>
  );
}

export default TournamentMap;

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F1A',
  },
  map: {
    flex: 1,
  },
  // Dots
  dotOuter: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(91,91,214,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#5B5BD6',
  },
  // Reset button
  resetBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A2E',
    borderWidth: 1,
    borderColor: '#2A2A4A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetIcon: {
    fontSize: 20,
    color: '#FAFAFA',
    lineHeight: 22,
  },
  // Close button
  closeBtn: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A2E',
    borderWidth: 1,
    borderColor: '#2A2A4A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 16,
    color: '#FAFAFA',
    fontWeight: '500',
  },
  // Empty state
  emptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,15,26,0.7)',
  },
  emptyTitle: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubtitle: {
    color: '#A0A0C8',
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  addBtn: {
    marginTop: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#5B5BD6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: {
    fontSize: 28,
    color: '#FAFAFA',
    lineHeight: 32,
  },
  // Sheet backdrop
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  // Cluster badge
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#E24B4A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FAFAFA',
  },
  // Bottom sheet
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1A1A2E',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
    maxHeight: '70%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#3A3A5A',
    borderRadius: 2,
    marginBottom: 12,
    alignSelf: 'center',
  },
  sheetGroupLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#A0A0C8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  sheetItemBorder: {
    borderTopWidth: 1,
    borderTopColor: '#2A2A4A',
  },
  sheetName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  sheetDates: {
    fontSize: 12,
    color: '#A0A0C8',
    marginTop: 2,
  },
  sheetMeta: {
    fontSize: 12,
    color: '#A0A0C8',
    marginTop: 1,
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 6,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  viewBtnSmall: {
    backgroundColor: '#5B5BD6',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    alignSelf: 'center',
  },
  viewBtnText: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '700',
  },
});

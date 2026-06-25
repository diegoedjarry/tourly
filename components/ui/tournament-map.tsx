import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { View, StyleSheet, Dimensions, TouchableOpacity, Modal, Pressable, StatusBar, ScrollView } from 'react-native';
import { Text } from '@/components/ui/text';
import Svg, { Path, Circle, G, Defs, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { CITY_COORDS, COUNTRY_CENTERS, WORLD_PATHS, BORDER_PATHS, geoToSvg } from './map-data';
import { T } from '@/constants/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const MAP_W = SCREEN_W;
const MAP_H = SCREEN_H;
const SVG_W = 1000;
const SVG_H = 500;

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

function daysBetweenDates(d1: string, d2: string): number {
  const [y1, m1, day1] = d1.split('-').map(Number);
  const [y2, m2, day2] = d2.split('-').map(Number);
  const a = new Date(y1, m1 - 1, day1);
  const b = new Date(y2, m2 - 1, day2);
  return Math.abs(a.getTime() - b.getTime()) / 86400000;
}

function curvedPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx = (x1 + x2) / 2 - dy * 0.15;
  const cy = (y1 + y2) / 2 + dx * 0.15;
  return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
}

function parseLocalDate(str: string | undefined): Date | null {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtDateRange(start: string, end?: string): string {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [sy, sm, sd] = start.split('-').map(Number);
  if (!end) return `${sd} ${MONTHS[sm - 1]} ${sy}`;
  const [ey, em, ed] = end.split('-').map(Number);
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS[sm - 1]} ${sy}`;
  return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]} ${ey}`;
}

interface Dot {
  svgX: number;
  svgY: number;
  lon: number;
  lat: number;
  tournaments: any[];
}

interface TournamentMapProps {
  tournaments: any[];
  onOpenTournament: (id: string) => void;
  onClose: () => void;
}

export function TournamentMap({ tournaments, onOpenTournament, onClose }: TournamentMapProps) {
  const insets = useSafeAreaInsets();
  const [selectedDot, setSelectedDot] = useState<Dot | null>(null);

  const dots: Dot[] = useMemo(() => {
    const groups: Record<string, Dot> = {};
    tournaments.forEach(t => {
      const coords = lookupCoords(t.city, t.country);
      if (!coords) return;
      const [lon, lat] = coords;
      const key = `${lon.toFixed(1)},${lat.toFixed(1)}`;
      if (!groups[key]) {
        const [svgX, svgY] = geoToSvg(lon, lat);
        groups[key] = { svgX, svgY, lon, lat, tournaments: [] };
      }
      groups[key].tournaments.push(t);
    });
    return Object.values(groups);
  }, [tournaments]);

  const connections = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const a = dots[i], b = dots[j];
        if (haversineKm(a.lat, a.lon, b.lat, b.lon) > 2000) continue;
        let close = false;
        for (const ta of a.tournaments) {
          for (const tb of b.tournaments) {
            if (daysBetweenDates(ta.startDate, tb.startDate) <= 14) { close = true; break; }
          }
          if (close) break;
        }
        if (!close) continue;
        lines.push({ x1: a.svgX, y1: a.svgY, x2: b.svgX, y2: b.svgY, key: `${i}-${j}` });
      }
    }
    return lines;
  }, [dots]);

  const computeFit = useCallback(() => {
    if (dots.length === 0) return { s: 1, tx: 0, ty: 0 };
    if (dots.length === 1) {
      const s = 3;
      const cx = dots[0].svgX / SVG_W * MAP_W;
      const cy = dots[0].svgY / SVG_H * MAP_H;
      return { s, tx: (MAP_W / 2 - cx) * s, ty: (MAP_H / 2 - cy) * s };
    }
    const xs = dots.map(d => d.svgX);
    const ys = dots.map(d => d.svgY);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 60;
    const sx = SVG_W / (maxX - minX + 2 * pad);
    const sy = SVG_H / (maxY - minY + 2 * pad);
    const s = Math.min(sx, sy, 4);
    const cxV = ((minX + maxX) / 2) / SVG_W * MAP_W;
    const cyV = ((minY + maxY) / 2) / SVG_H * MAP_H;
    return { s, tx: (MAP_W / 2 - cxV) * s, ty: (MAP_H / 2 - cyV) * s };
  }, [dots]);

  const init = computeFit();

  const scale = useSharedValue(init.s);
  const savedScale = useSharedValue(init.s);
  const translateX = useSharedValue(init.tx);
  const savedTX = useSharedValue(init.tx);
  const translateY = useSharedValue(init.ty);
  const savedTY = useSharedValue(init.ty);

  const dotsRef = useRef(dots);
  dotsRef.current = dots;

  const prevLen = useRef(dots.length);
  useEffect(() => {
    if (dots.length !== prevLen.current) {
      prevLen.current = dots.length;
      const f = computeFit();
      scale.value = withTiming(f.s, { duration: 400 });
      savedScale.value = f.s;
      translateX.value = withTiming(f.tx, { duration: 400 });
      savedTX.value = f.tx;
      translateY.value = withTiming(f.ty, { duration: 400 });
      savedTY.value = f.ty;
    }
  }, [dots.length]);

  const fitAll = useCallback(() => {
    const f = computeFit();
    scale.value = withTiming(f.s, { duration: 400 });
    savedScale.value = f.s;
    translateX.value = withTiming(f.tx, { duration: 400 });
    savedTX.value = f.tx;
    translateY.value = withTiming(f.ty, { duration: 400 });
    savedTY.value = f.ty;
  }, [computeFit]);

  const handleTap = useCallback((tapX: number, tapY: number) => {
    const s = scale.value;
    const tx = translateX.value;
    const ty = translateY.value;
    const vx = (tapX - tx - MAP_W / 2) / s + MAP_W / 2;
    const vy = (tapY - ty - MAP_H / 2) / s + MAP_H / 2;
    const svgX = vx / MAP_W * SVG_W;
    const svgY = vy / MAP_H * SVG_H;
    const threshold = 40 / s;
    let closest: Dot | null = null;
    let best = Infinity;
    for (const dot of dotsRef.current) {
      const d = Math.hypot(dot.svgX - svgX, dot.svgY - svgY);
      if (d < threshold && d < best) { closest = dot; best = d; }
    }
    if (closest) setSelectedDot(closest);
  }, []);

  const pinch = Gesture.Pinch()
    .onStart(() => { savedScale.value = scale.value; })
    .onUpdate(e => { scale.value = Math.min(Math.max(savedScale.value * e.scale, 0.8), 6); })
    .onEnd(() => { savedScale.value = scale.value; });

  const pan = Gesture.Pan()
    .minDistance(10)
    .minPointers(1)
    .onStart(() => { savedTX.value = translateX.value; savedTY.value = translateY.value; })
    .onUpdate(e => {
      translateX.value = savedTX.value + e.translationX;
      translateY.value = savedTY.value + e.translationY;
    })
    .onEnd(() => { savedTX.value = translateX.value; savedTY.value = translateY.value; });

  const tap = Gesture.Tap()
    .maxDuration(300)
    .onEnd(e => { runOnJS(handleTap)(e.x, e.y); });

  const composed = Gesture.Simultaneous(pinch, Gesture.Exclusive(pan, tap));

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={ms.fullScreen}>
        <GestureDetector gesture={composed}>
          <Animated.View style={[{ width: MAP_W, height: MAP_H }, animStyle]}>
            <Svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} width={MAP_W} height={MAP_H}>
              {/* Continent fills */}
              {WORLD_PATHS.map((d, i) => (
                <Path key={`land-${i}`} d={d} fill="#6B7B99" stroke="#4A5875" strokeWidth={0.6} />
              ))}

              {/* Country border lines */}
              {BORDER_PATHS.map((d, i) => (
                <Path key={`bdr-${i}`} d={d} fill="none" stroke="#4A5875" strokeWidth={0.5} strokeOpacity={1} />
              ))}

              {/* Connection arcs */}
              {connections.map(c => (
                <Path key={c.key} d={curvedPath(c.x1, c.y1, c.x2, c.y2)}
                  stroke={T.teal} strokeOpacity={0.4} strokeWidth={1.5}
                  strokeDasharray="6,4" fill="none" />
              ))}

              <Defs>
                <RadialGradient id="dot-glow" cx="50%" cy="50%" r="50%">
                  <Stop offset="0%" stopColor={T.teal} stopOpacity={0.85} />
                  <Stop offset="35%" stopColor={T.teal} stopOpacity={0.3} />
                  <Stop offset="100%" stopColor={T.teal} stopOpacity={0} />
                </RadialGradient>
              </Defs>

              {dots.map((dot, i) => (
                <G key={i}>
                  <Circle cx={dot.svgX} cy={dot.svgY} r={12} fill="url(#dot-glow)" />
                  <Circle cx={dot.svgX} cy={dot.svgY} r={4} fill={T.teal} />
                  <Circle cx={dot.svgX} cy={dot.svgY} r={2} fill="white" />
                  {dot.tournaments.length > 1 && (
                    <G>
                      <Circle cx={dot.svgX + 8} cy={dot.svgY - 8} r={7} fill={T.accent} />
                      <SvgText x={dot.svgX + 8} y={dot.svgY - 4.5} fontSize={9}
                        fontWeight="bold" fill="white" textAnchor="middle">
                        {dot.tournaments.length}
                      </SvgText>
                    </G>
                  )}
                </G>
              ))}
            </Svg>
          </Animated.View>
        </GestureDetector>

        {/* Top bar */}
        <View style={[ms.topBar, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={ms.closeBtn}>
            <Text style={ms.closeBtnText}>✕</Text>
          </TouchableOpacity>
          <Text style={ms.topTitle}>Tournament Map</Text>
          <TouchableOpacity onPress={fitAll} activeOpacity={0.7} style={ms.fitBtn}>
            <Text style={ms.fitIcon}>⊙</Text>
          </TouchableOpacity>
        </View>

        {/* Dot count badge */}
        {dots.length > 0 && (
          <View style={[ms.badge, { bottom: insets.bottom + 16 }]}>
            <Text style={ms.badgeText}>
              {tournaments.filter(t => lookupCoords(t.city, t.country)).length} tournament{tournaments.length !== 1 ? 's' : ''} · {dots.length} location{dots.length !== 1 ? 's' : ''}
            </Text>
          </View>
        )}

        {/* Tournament detail sheet */}
        {selectedDot && (
          <Modal transparent animationType="slide" onRequestClose={() => setSelectedDot(null)}>
            <Pressable style={ms.backdrop} onPress={() => setSelectedDot(null)}>
              <Pressable style={ms.sheet} onPress={() => {}}>
                <View style={ms.handle} />
                <View style={ms.sheetHeader}>
                  <Text style={ms.sheetCity}>
                    {selectedDot.tournaments[0]?.city || 'Unknown'}
                  </Text>
                  <Text style={ms.sheetCountry}>
                    {selectedDot.tournaments[0]?.country || ''}
                    {selectedDot.tournaments.length > 1 ? ` · ${selectedDot.tournaments.length} tournaments` : ''}
                  </Text>
                </View>
                <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                  {selectedDot.tournaments.map(t => {
                    const SURFACE_STRIPE: Record<string, string> = { clay: T.claySurface, hard: T.hardSurface, grass: T.grassSurface };
                    const stripe = SURFACE_STRIPE[t.surface?.toLowerCase()] ?? T.cardBorder;
                    return (
                      <TouchableOpacity key={t.id}
                        style={[ms.card, { borderLeftWidth: 3, borderLeftColor: stripe }]}
                        activeOpacity={0.8}
                        onPress={() => { setSelectedDot(null); onOpenTournament(t.id); }}>
                        <View style={ms.cardBody}>
                          <Text style={ms.cardName}>{t.name}</Text>
                          <Text style={ms.cardSub}>{fmtDateRange(t.startDate, t.endDate)}{t.category ? `  ·  ${t.category}` : ''}</Text>
                          {t.surface && <Text style={[ms.cardSurface, { color: stripe }]}>{t.surface}</Text>}
                        </View>
                        <DeadlinePill deadline={t.signUpDeadline} />
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </Pressable>
            </Pressable>
          </Modal>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

function DeadlinePill({ deadline }: { deadline?: string }) {
  const d = parseLocalDate(deadline);
  if (!d) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const days = Math.ceil((d.getTime() - now.getTime()) / 86400000);

  let color: string, bg: string, label: string;
  if (days < 0) {
    color = T.red; bg = 'rgba(239,68,68,0.15)'; label = 'Past';
  } else if (days <= 2) {
    color = T.red; bg = 'rgba(239,68,68,0.15)'; label = `${days}d`;
  } else if (days <= 7) {
    color = T.amber; bg = 'rgba(240,168,48,0.15)'; label = `${days}d`;
  } else {
    color = T.green; bg = 'rgba(68,207,108,0.15)'; label = `${days}d`;
  }

  return (
    <View style={{ backgroundColor: bg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
      <Text style={{ color, fontSize: 11, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

const ms = StyleSheet.create({
  fullScreen: {
    flex: 1,
    backgroundColor: T.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: T.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  closeBtnText: { fontSize: 16, color: T.textPrimary, fontWeight: '500' },
  topTitle: { fontSize: 16, fontWeight: '700', color: T.textPrimary },
  fitBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: T.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  fitIcon: { fontSize: 16, color: T.textPrimary, fontWeight: '600' },
  badge: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: T.card,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  badgeText: { fontSize: 13, color: T.textSecondary, fontWeight: '500' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: T.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 48,
  },
  handle: {
    width: 32, height: 4, borderRadius: 2,
    backgroundColor: T.cardBorder, alignSelf: 'center', marginBottom: 20,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: T.bg,
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
  },
  sheetHeader: {
    marginBottom: 16,
  },
  sheetCity: {
    fontSize: 20, fontWeight: '800', color: T.textPrimary, marginBottom: 2,
  },
  sheetCountry: {
    fontSize: 13, fontWeight: '500', color: T.textSecondary,
  },
  cardBody: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '600', color: T.textPrimary, marginBottom: 3 },
  cardSub: { fontSize: 12, color: T.textSecondary },
  cardSurface: { fontSize: 11, fontWeight: '600', marginTop: 2, textTransform: 'capitalize' },
});

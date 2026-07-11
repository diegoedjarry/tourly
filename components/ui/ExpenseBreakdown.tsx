import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Pressable, GestureResponderEvent } from 'react-native';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '@/components/ui/text';
import { T } from '@/constants/theme';

// Compact currency formatter — mirrors the "$1.2k" style used across the app
// (see app/insights.tsx fmt()). Local copy: this file is pure/props-driven
// and must not import screen-level helpers.
function fmt(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return `${sign}$${abs.toLocaleString('en-US')}`;
}

function safeNum(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

export interface ExpenseBreakdownSlice {
  label: string;
  value: number;
  color: string;
}

export interface ExpenseBreakdownProps {
  /** Category totals for the donut + ranked list, sorted descending by the caller. */
  slices: ExpenseBreakdownSlice[];
  title?: string;
  onSelectCategory?: (label: string, color: string) => void;
  emptyLabel?: string;
}

// Hand-rolled SVG donut (Path arcs, not a third-party pie chart component) —
// gives full, predictable control over slice colors and label placement
// instead of depending on a library's native-rendering quirks.
const OUTER_R = 88;
const INNER_R = 54;
const CHIP_BASE_OFFSET = 18;
const CHIP_MARGIN = 72;
const CANVAS = (OUTER_R + CHIP_MARGIN) * 2;
const CENTER = CANVAS / 2;

// Point on a circle of radius r at `turns` (0..1, 0 = 12 o'clock, clockwise).
function polar(r: number, turns: number) {
  const a = turns * Math.PI * 2;
  return { x: CENTER + r * Math.sin(a), y: CENTER - r * Math.cos(a) };
}

function ExpenseBreakdownInner({ slices, title, onSelectCategory, emptyLabel }: ExpenseBreakdownProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + Math.max(0, safeNum(x.value)), 0);

  if (total <= 0) {
    return (
      <View style={styles.card}>
        {title && <Text style={styles.cardTitle}>{title}</Text>}
        <Text style={styles.emptyText}>{emptyLabel ?? 'No expenses yet'}</Text>
      </View>
    );
  }

  const selected = selectedIndex != null ? slices[selectedIndex] : undefined;

  function handleSelect(index: number) {
    setSelectedIndex(prev => (prev === index ? null : index));
    onSelectCategory?.(slices[index].label, slices[index].color);
  }

  // Cumulative angle range (in turns, 0..1) per slice — the single source of
  // truth for both the drawn arcs and the tap hit-testing below, so they can
  // never disagree with each other.
  let cursor = 0;
  const arcs = slices.map((s, i) => {
    const frac = Math.max(0, safeNum(s.value)) / total;
    const start = cursor;
    const end = cursor + frac;
    cursor = end;
    return { ...s, start, end, mid: (start + end) / 2, index: i };
  });

  // Chip placement: slices are already in descending-value (= ascending mid
  // angle, since arcs are built in order) order, so a run of small adjacent
  // slices is exactly a run of close `mid` values. Below MIN_CHIP_PCT the
  // slice is too thin for a floating label to ever have real breathing room
  // (its exact amount is still in the ranked list below, in the same color),
  // so we simply don't compete for space with a chip for it. For the ones
  // that do get a chip, if two neighbors would still sit closer than MIN_GAP
  // turns apart, step the next one out to a farther radius ring (with a
  // short leader tick back to the arc) so every visible chip gets its own
  // clear space instead of overlapping.
  const MIN_CHIP_PCT = 5;
  const MIN_GAP = 0.09;
  const LEVEL_STEP = 18;
  const MAX_LEVEL = 2;
  let prevMid: number | null = null;
  let level = 0;
  const chips = arcs
    .map(a => ({ ...a, pct: Math.round((a.end - a.start) * 100) }))
    .filter(a => a.pct >= MIN_CHIP_PCT)
    .map(a => {
      if (prevMid != null && (a.mid - prevMid) < MIN_GAP) {
        level = Math.min(level + 1, MAX_LEVEL);
      } else {
        level = 0;
      }
      prevMid = a.mid;
      return { ...a, radius: OUTER_R + CHIP_BASE_OFFSET + level * LEVEL_STEP, level };
    });

  function handlePressDonut(e: GestureResponderEvent) {
    const { locationX, locationY } = e.nativeEvent;
    const dx = locationX - CENTER;
    const dy = locationY - CENTER;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r > OUTER_R + 6 || r < INNER_R - 6) return;
    let turns = Math.atan2(dx, -dy) / (Math.PI * 2);
    if (turns < 0) turns += 1;
    const hit = arcs.find(a => turns >= a.start && turns < a.end);
    if (hit) handleSelect(hit.index);
  }

  return (
    <View style={styles.card}>
      {title && <Text style={styles.cardTitle}>{title}</Text>}

      <Pressable onPress={handlePressDonut} style={styles.donutWrap}>
        <Svg width={CANVAS} height={CANVAS}>
          {arcs.length === 1 ? (
            <Circle cx={CENTER} cy={CENTER} r={(OUTER_R + INNER_R) / 2} stroke={arcs[0].color} strokeWidth={OUTER_R - INNER_R} fill="none" />
          ) : arcs.map(a => {
            const large = a.end - a.start > 0.5 ? 1 : 0;
            const os = polar(OUTER_R, a.start), oe = polar(OUTER_R, a.end);
            const ie = polar(INNER_R, a.end), is = polar(INNER_R, a.start);
            const d = `M ${os.x} ${os.y} A ${OUTER_R} ${OUTER_R} 0 ${large} 1 ${oe.x} ${oe.y} L ${ie.x} ${ie.y} A ${INNER_R} ${INNER_R} 0 ${large} 0 ${is.x} ${is.y} Z`;
            const isDimmed = selectedIndex != null && selectedIndex !== a.index;
            return <Path key={a.label} d={d} fill={a.color} opacity={isDimmed ? 0.35 : 1} />;
          })}
          {/* Leader ticks — only for chips stepped out to a farther ring, so it stays clear which slice each one belongs to. */}
          {chips.filter(c => c.level > 0).map(c => {
            const from = polar(OUTER_R + 2, c.mid);
            const to = polar(c.radius - 12, c.mid);
            return <Line key={`tick-${c.label}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={T.textMuted} strokeWidth={1} />;
          })}
        </Svg>

        {/* Percentage chips floating just outside the ring — stepped out to a farther radius when neighbors are too close to fit cleanly. */}
        {chips.map(c => {
          const p = polar(c.radius, c.mid);
          return (
            <View key={c.label} style={[styles.donutChip, { left: p.x - 22, top: p.y - 11 }]} pointerEvents="none">
              <Text style={styles.donutChipText} numberOfLines={1}>{c.pct}%</Text>
            </View>
          );
        })}

        <View style={styles.donutCenterWrap} pointerEvents="none">
          <Text style={styles.donutCenterLabel} numberOfLines={1}>{fmt(selected ? selected.value : total)}</Text>
          {selected && <Text style={styles.donutCenterSub} numberOfLines={1}>{selected.label}</Text>}
        </View>
      </Pressable>

      <View style={styles.rankWrap}>
        {slices.map((s, i) => {
          const pct = total > 0 ? Math.max(0, Math.min(100, (safeNum(s.value) / total) * 100)) : 0;
          const isSel = selectedIndex === i;
          return (
            <TouchableOpacity key={s.label} style={styles.rankRow} activeOpacity={0.7} onPress={() => handleSelect(i)}>
              <View style={styles.rankHeaderRow}>
                <View style={[styles.legendSquare, { backgroundColor: s.color }]} />
                <Text style={[styles.rankLabel, isSel && styles.rankLabelActive]} numberOfLines={1}>{s.label}</Text>
                <Text style={styles.rankValue}>{fmt(s.value)}</Text>
              </View>
              <View style={styles.rankTrack}>
                <LinearGradient
                  colors={[s.color, `${s.color}CC`]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={[styles.rankFill, { width: `${Math.max(pct, 2)}%` as any }]}
                />
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export const ExpenseBreakdown = React.memo(ExpenseBreakdownInner);

const styles = StyleSheet.create({
  card: { backgroundColor: T.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: T.cardBorder },
  cardTitle: { fontSize: 11, fontWeight: '600', color: T.textTertiary, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 14 },
  emptyText: { fontSize: 13, color: T.textTertiary, textAlign: 'center', paddingVertical: 12 },

  donutWrap: { width: CANVAS, height: CANVAS, alignSelf: 'center' },
  donutChip: {
    position: 'absolute', width: 44, alignItems: 'center', justifyContent: 'center',
    backgroundColor: T.cardElevated, borderRadius: 8, paddingHorizontal: 3, paddingVertical: 3,
    borderWidth: 1, borderColor: T.cardBorder,
  },
  donutChipText: { fontSize: 10.5, fontWeight: '700', color: T.textPrimary, textAlign: 'center' },
  donutCenterWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  donutCenterLabel: { fontSize: 17, fontWeight: '800', color: T.textPrimary },
  donutCenterSub: { fontSize: 11, fontWeight: '600', color: T.textTertiary, marginTop: 2 },

  legendSquare: { width: 9, height: 9, borderRadius: 2.5, flexShrink: 0 },

  rankWrap: { marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: T.cardBorder },
  rankRow: { marginBottom: 12 },
  rankHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  rankLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: T.textPrimary },
  rankLabelActive: { color: T.accent },
  rankValue: { fontSize: 13, fontWeight: '700', color: T.textPrimary },
  rankTrack: { height: 8, borderRadius: 999, backgroundColor: T.cardBorder, overflow: 'hidden' },
  rankFill: { height: '100%', borderRadius: 999 },
});

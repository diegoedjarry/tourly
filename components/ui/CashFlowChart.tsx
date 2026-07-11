import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import Svg, { Path, Rect, Line as SvgLine, Circle, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
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

// Trend-line accent — distinct from T.accent (used for the bars) so the two
// series read as separate signals; not promoted to constants/theme.ts since
// no other screen needs a pink yet.
const NET_LINE_COLOR = '#E85DA0';

const H = 220;
const PAD = { t: 16, b: 24, l: 34, r: 12 };
const LEGEND_H = 26;
const KPI_H = 44;
const BUBBLE_W = 64;

export interface CashFlowChartMonth {
  label: string;
  spend: number;
  inflow: number;
}

export interface CashFlowChartProps {
  months: CashFlowChartMonth[];
  netSeries: number[];
  labels: { spend: string; inflow: string; net: string; seeMore?: string };
  onBarPress?: (index: number) => void;
  emptyLabel?: string;
  /** Index of the current month — its label renders emphasized so "now" is findable at a glance. */
  highlightIndex?: number;
  /** Period totals for the header KPI row — pre-aggregated by the caller (already USD/share-normalized). */
  incomeTotal?: number;
  spendTotal?: number;
}

// Smooth cardinal-spline path through a set of points — softens the net line
// into the gentle curve style used across the reference dashboard, instead of
// sharp straight-line segments between months.
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function CashFlowChartInner({ months, netSeries, labels, onBarPress, emptyLabel, highlightIndex, incomeTotal, spendTotal }: CashFlowChartProps) {
  const { width } = useWindowDimensions();
  const W = width - 40;
  const chartW = Math.max(0, W - PAD.l - PAD.r);
  const chartH = Math.max(0, H - PAD.t - PAD.b);
  const baseY = H - PAD.b;

  const n = months.length;
  const allZero = n === 0 || months.every(m => safeNum(m.spend) === 0 && safeNum(m.inflow) === 0);

  // Tap a bar or long-press-and-drag along the net line to move the value
  // bubble — activeIndex is what the user is currently exploring, separate
  // from highlightIndex ("today"), which always stays bold on its own label.
  const [activeIndex, setActiveIndex] = useState<number | null>(highlightIndex ?? null);
  useEffect(() => {
    setActiveIndex(highlightIndex ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months]);

  // Bars now encode a single series (spend) growing up from the baseline —
  // no more diverging red/green-from-center bars competing with the net line
  // on the same axis.
  const maxSpend = React.useMemo(() => {
    if (n === 0) return 1;
    let m = 0;
    for (const mo of months) m = Math.max(m, safeNum(mo.spend));
    return m > 0 ? m : 1;
  }, [months, n]);

  const maxNetAbs = React.useMemo(() => {
    let m = 0;
    for (const v of netSeries) m = Math.max(m, Math.abs(safeNum(v)));
    return m > 0 ? m : 1;
  }, [netSeries]);

  const barCap = maxSpend * 1.15;
  const netCap = maxNetAbs * 1.2;

  const slotW = n > 0 ? chartW / n : 0;
  const barW = Math.max(0, Math.min(26, slotW * 0.46));

  const centerX = (i: number) => PAD.l + slotW * i + slotW / 2;
  const barHeight = (v: number) => Math.max(2, (safeNum(v) / barCap) * chartH);

  // Net line rendered on its own vertical scale (independent of the bars),
  // pinned so its own zero sits mid-chart — it only needs to read as a trend,
  // not share the bars' literal scale.
  const netZeroY = PAD.t + chartH * 0.62;
  const netHalf = chartH * 0.5;

  const netPts = React.useMemo(() => {
    return netSeries.map((v, i) => {
      const x = centerX(i);
      const val = safeNum(v);
      const y = netZeroY - (val / netCap) * netHalf;
      return { x, y: Math.max(PAD.t + 4, Math.min(baseY - 4, y)), v: val };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netSeries, netCap, netHalf, netZeroY, n, chartW]);

  const netPath = React.useMemo(() => smoothPath(netPts), [netPts]);

  const yGrid = React.useMemo(() => {
    const fracs = [1, 0.5, 0];
    return fracs.map(f => ({ y: baseY - f * chartH, value: f * barCap }));
  }, [baseY, chartH, barCap]);

  // ── Gesture: tap a bar to select it, or long-press then drag to scrub ──
  const lastScrubIndex = useRef<number | null>(null);

  function handleTap(idx: number) {
    setActiveIndex(idx);
  }

  function handleScrubStart() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }

  function handleScrubMove(idx: number) {
    if (lastScrubIndex.current !== idx) {
      lastScrubIndex.current = idx;
      setActiveIndex(idx);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }

  function handleScrubEnd() {
    lastScrubIndex.current = null;
  }

  const tapGesture = Gesture.Tap()
    .maxDuration(250)
    .onEnd((e, success) => {
      'worklet';
      if (!success) return;
      const raw = (e.x - PAD.l) / slotW;
      const idx = Math.max(0, Math.min(n - 1, Math.floor(raw)));
      runOnJS(handleTap)(idx);
    });

  const panGesture = Gesture.Pan()
    .activateAfterLongPress(220)
    .onStart(() => {
      'worklet';
      runOnJS(handleScrubStart)();
    })
    .onUpdate((e) => {
      'worklet';
      const raw = (e.x - PAD.l) / slotW;
      const idx = Math.max(0, Math.min(n - 1, Math.floor(raw)));
      runOnJS(handleScrubMove)(idx);
    })
    .onEnd(() => {
      'worklet';
      runOnJS(handleScrubEnd)();
    });

  const composedGesture = Gesture.Race(panGesture, tapGesture);

  if (allZero) {
    return (
      <View style={styles.wrap}>
        <View style={[styles.emptyBox, { height: H }]}>
          <Text style={styles.emptyText}>{emptyLabel ?? 'No cash flow data yet'}</Text>
        </View>
      </View>
    );
  }

  const active = netPts[activeIndex ?? -1];
  const activeMonth = activeIndex != null ? months[activeIndex] : undefined;
  const canSeeMore = !!onBarPress && activeIndex != null;
  const bubbleH = canSeeMore ? 48 : 30;

  return (
    <View style={styles.wrap}>
      {(incomeTotal != null || spendTotal != null) && (
        <View style={[styles.kpiRow, { height: KPI_H }]}>
          {incomeTotal != null && (
            <View style={styles.kpiItem}>
              <Text style={styles.kpiLabel}>{labels.inflow}</Text>
              <Text style={[styles.kpiValue, { color: T.green }]}>{fmt(incomeTotal)}</Text>
            </View>
          )}
          {spendTotal != null && (
            <View style={[styles.kpiItem, { alignItems: 'flex-end' }]}>
              <Text style={styles.kpiLabel}>{labels.spend}</Text>
              <Text style={[styles.kpiValue, { color: T.red }]}>{fmt(spendTotal)}</Text>
            </View>
          )}
        </View>
      )}

      <GestureDetector gesture={composedGesture}>
        <View style={{ height: H }}>
          <Svg width={W} height={H}>
            <Defs>
              <LinearGradient id="cfSpendBar" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={T.accent} stopOpacity={0.95} />
                <Stop offset="1" stopColor={T.accent} stopOpacity={0.45} />
              </LinearGradient>
              <LinearGradient id="cfSpendBarHi" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={T.teal} stopOpacity={1} />
                <Stop offset="1" stopColor={T.accent} stopOpacity={0.6} />
              </LinearGradient>
            </Defs>

            {yGrid.map((g, i) => (
              <SvgLine key={i} x1={PAD.l} y1={g.y} x2={W - PAD.r} y2={g.y} stroke={T.cardBorder} strokeWidth={1} strokeDasharray="4 4" />
            ))}
            <SvgLine x1={PAD.l} y1={baseY} x2={W - PAD.r} y2={baseY} stroke={T.textMuted} strokeWidth={1} />

            {activeIndex != null && (
              <SvgLine x1={centerX(activeIndex)} y1={PAD.t} x2={centerX(activeIndex)} y2={baseY}
                stroke={T.textMuted} strokeWidth={1} strokeDasharray="2 3" />
            )}

            {months.map((m, i) => {
              const spend = safeNum(m.spend);
              const x = centerX(i) - barW / 2;
              const h = barHeight(spend);
              const isActive = i === activeIndex;
              return (
                <Rect
                  key={i}
                  x={x} y={baseY - h}
                  width={barW} height={h}
                  rx={barW / 2.4}
                  fill={isActive ? 'url(#cfSpendBarHi)' : 'url(#cfSpendBar)'}
                />
              );
            })}

            {netPath !== '' && (
              <Path d={netPath} fill="none" stroke={NET_LINE_COLOR} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            )}
            {netPts.map((p, i) => (
              <Circle key={i} cx={p.x} cy={p.y} r={i === activeIndex ? 4 : 2.5}
                fill={NET_LINE_COLOR} opacity={i === activeIndex ? 1 : 0.7} />
            ))}

            {/* Value bubble — tap a bar, or long-press and drag along the
                chart to scrub through months; each moves this bubble. */}
            {active && activeMonth && (() => {
              const bx = Math.min(Math.max(active.x - BUBBLE_W / 2, PAD.l), W - PAD.r - BUBBLE_W);
              const by = Math.max(PAD.t, active.y - bubbleH - 14);
              return (
                <React.Fragment>
                  <Rect x={bx} y={by} width={BUBBLE_W} height={bubbleH} rx={10} fill={T.card} stroke={T.cardBorder} strokeWidth={1} />
                  <SvgText x={bx + BUBBLE_W / 2} y={by + 18} fontSize={12} fontWeight="800" fill={T.textPrimary} textAnchor="middle">
                    {fmt(activeMonth.spend)}
                  </SvgText>
                  {canSeeMore && (
                    <React.Fragment>
                      <SvgLine x1={bx + 6} y1={by + 27} x2={bx + BUBBLE_W - 6} y2={by + 27} stroke={T.cardBorder} strokeWidth={1} />
                      <SvgText x={bx + BUBBLE_W / 2} y={by + 41} fontSize={10} fontWeight="700" fill={T.accent} textAnchor="middle">
                        {labels.seeMore ?? 'See more ›'}
                      </SvgText>
                    </React.Fragment>
                  )}
                </React.Fragment>
              );
            })()}

            {months.map((m, i) => (
              <SvgText
                key={i}
                x={centerX(i)}
                y={H - 6}
                fontSize={10}
                fontWeight={i === highlightIndex ? 'bold' : 'normal'}
                fill={i === highlightIndex ? T.textPrimary : T.textTertiary}
                textAnchor="middle"
              >
                {m.label}
              </SvgText>
            ))}
          </Svg>

          {/* Transparent pressable over the "See more" footer of the bubble —
              SVG text isn't reliably pressable across platforms, so the tap
              target is a plain overlay positioned to match it. */}
          {canSeeMore && active && (
            <TouchableOpacity
              activeOpacity={0.6}
              onPress={() => onBarPress!(activeIndex!)}
              style={{
                position: 'absolute',
                left: Math.min(Math.max(active.x - BUBBLE_W / 2, PAD.l), W - PAD.r - BUBBLE_W),
                top: Math.max(PAD.t, active.y - bubbleH - 14) + 27,
                width: BUBBLE_W,
                height: bubbleH - 27,
              }}
            />
          )}
        </View>
      </GestureDetector>

      <View style={[styles.legendRow, { height: LEGEND_H }]}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDash, { backgroundColor: T.accent }]} />
          <Text style={styles.legendText}>{labels.spend}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDash, { backgroundColor: NET_LINE_COLOR }]} />
          <Text style={styles.legendText}>{labels.net}</Text>
        </View>
      </View>
    </View>
  );
}

export const CashFlowChart = React.memo(CashFlowChartInner);

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  emptyBox: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 13, color: T.textTertiary },
  kpiRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  kpiItem: { gap: 2 },
  kpiLabel: { fontSize: 11, fontWeight: '600', color: T.textTertiary, letterSpacing: 0.3, textTransform: 'uppercase' },
  kpiValue: { fontSize: 20, fontWeight: '800' },
  legendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDash: { width: 12, height: 3, borderRadius: 1.5 },
  legendText: { fontSize: 11, color: T.textSecondary, fontWeight: '600' },
});

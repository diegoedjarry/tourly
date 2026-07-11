import React, { useMemo, useRef, useState } from 'react';
import { View, useWindowDimensions, GestureResponderEvent, PanResponderGestureState , PanResponder } from 'react-native';
import { Text } from '@/components/ui/text';
import Svg, { Path, Circle, Line, Text as SvgText } from 'react-native-svg';
import { T } from '@/constants/theme';

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Dates are stored as "YYYY-MM-DD" strings — parse to local midnight, never
// `new Date("YYYY-MM-DD")` (that gives UTC midnight and off-by-one in
// negative-offset timezones).
function parseLocalDate(val: string | undefined): Date | null {
  if (!val || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return null;
  const [y, m, d] = val.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtShortDate(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  if (!d) return dateStr.slice(0, 10);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

export function RankingChart({ points }: { points: { date: string; ranking: number; label?: string }[] }) {
  const { width } = useWindowDimensions();
  const [tooltip, setTooltip] = useState<{ idx: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const W = width - 40;
  const H = 160;
  const PAD_L = 38; const PAD_R = 12; const PAD_T = 16; const PAD_B = 28;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  // Mutable refs so the PanResponder callbacks (created once) always see the
  // latest layout/data without needing to be recreated every render.
  const scrubIdxRef = useRef<number | null>(null);
  const layoutRef = useRef({ chartW, sortedLen: points.length });

  // Map a touch x (relative to the wrapping View, same origin as the Svg) to
  // the nearest data index.
  const xToIndex = (x: number) => {
    const { chartW: cw, sortedLen } = layoutRef.current;
    if (sortedLen < 2) return 0;
    const ratio = (x - PAD_L) / cw;
    const idx = Math.round(ratio * (sortedLen - 1));
    return Math.max(0, Math.min(sortedLen - 1, idx));
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Deliberately do NOT claim the responder on press-in
        // (onStartShouldSetPanResponder stays false-ish/unused): this chart
        // typically lives inside a ScrollView, and claiming immediately on
        // touch-down would swallow every vertical scroll gesture that happens
        // to start over the chart. Instead we wait for the first move and
        // only capture once the drag is clearly more horizontal than
        // vertical, so a vertical swipe keeps scrolling the page normally
        // while a horizontal drag starts the scrub.
        onMoveShouldSetPanResponderCapture: (_evt: GestureResponderEvent, gesture: PanResponderGestureState) =>
          Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > 4,
        onMoveShouldSetPanResponder: (_evt: GestureResponderEvent, gesture: PanResponderGestureState) =>
          Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > 4,
        onPanResponderGrant: (evt: GestureResponderEvent) => {
          const x = evt.nativeEvent.locationX;
          const idx = xToIndex(x);
          scrubIdxRef.current = idx;
          setScrubbing(true);
          setTooltip({ idx });
        },
        onPanResponderMove: (evt: GestureResponderEvent) => {
          const x = evt.nativeEvent.locationX;
          const idx = xToIndex(x);
          if (scrubIdxRef.current !== idx) {
            scrubIdxRef.current = idx;
            setTooltip({ idx });
          }
        },
        onPanResponderRelease: () => {
          scrubIdxRef.current = null;
          setScrubbing(false);
          setTooltip(null);
        },
        onPanResponderTerminate: () => {
          scrubIdxRef.current = null;
          setScrubbing(false);
          setTooltip(null);
        },
      }),
    []
  );

  // All hooks are above this guard — an early return before a hook changes
  // hook order between renders and crashes React (rules-of-hooks).
  if (points.length < 2) return null;

  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const minRank = Math.min(...sorted.map(p => p.ranking));
  const maxRank = Math.max(...sorted.map(p => p.ranking));
  const rankSpan = maxRank - minRank || 1;
  const careerHigh = minRank;

  // Invert Y: lower rank number = top of chart
  const toX = (i: number) => PAD_L + (i / (sorted.length - 1)) * chartW;
  const toY = (r: number) => PAD_T + ((r - minRank) / rankSpan) * chartH;

  layoutRef.current = { chartW, sortedLen: sorted.length };

  // Catmull-Rom smooth path
  const pts = sorted.map((p, i) => ({ x: toX(i), y: toY(p.ranking) }));
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  // Y axis reference lines (5 values, evenly spaced)
  const yRefs = [0, 0.25, 0.5, 0.75, 1].map(f => minRank + Math.round(f * rankSpan));

  // X axis labels — one per unique month only
  const seenMonths = new Set<string>();
  const xLabels: { i: number; month: string }[] = [];
  sorted.forEach((p, i) => {
    const month = MONTHS_SHORT[parseInt(p.date.slice(5, 7)) - 1];
    if (!seenMonths.has(month)) { seenMonths.add(month); xLabels.push({ i, month }); }
  });

  // Change-point dots: only render a dot where ranking differs from the previous point
  const changePtIndices = new Set<number>(
    sorted.map((p, i) => i).filter(i => i === 0 || sorted[i].ranking !== sorted[i - 1].ranking)
  );

  const careerHighY = toY(careerHigh);
  const activePoint = tooltip !== null ? sorted[tooltip.idx] : null;

  return (
    <View style={{ marginTop: 8, marginBottom: 4 }}>
      <Text style={{ fontSize: 10, color: T.textTertiary, marginBottom: 2, marginLeft: PAD_L }}>
        Career high this period: #{careerHigh}
      </Text>
      <View style={{ position: 'relative' }} {...panResponder.panHandlers}>
        <Svg width={W} height={H}>
          {yRefs.map((r, i) => (
            <React.Fragment key={i}>
              <Path d={`M ${PAD_L} ${toY(r)} L ${W - PAD_R} ${toY(r)}`}
                stroke="#2A2A4A" strokeWidth={1} />
              <SvgText x={PAD_L - 4} y={toY(r) + 4} fontSize={9} fill={T.textTertiary}
                textAnchor="end">#{r}</SvgText>
            </React.Fragment>
          ))}
          <Path d={`M ${PAD_L} ${careerHighY} L ${W - PAD_R} ${careerHighY}`}
            stroke={T.accent + '60'} strokeWidth={1} strokeDasharray="4 3" />
          <Path d={d} fill="none" stroke={T.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          {scrubbing && tooltip !== null && (
            <Line x1={toX(tooltip.idx)} y1={PAD_T} x2={toX(tooltip.idx)} y2={PAD_T + chartH}
              stroke={T.textSecondary} strokeWidth={1} strokeOpacity={0.35} strokeDasharray="3 3" />
          )}
          {pts.map((p, i) => {
            if (!changePtIndices.has(i)) return null;
            return (
              <Circle key={i} cx={p.x} cy={p.y} r={tooltip?.idx === i ? 6 : 4}
                fill={tooltip?.idx === i ? T.accent : T.bg} stroke={T.accent} strokeWidth={2}
                onPress={() => setTooltip(prev => prev?.idx === i ? null : { idx: i })}
              />
            );
          })}
          {scrubbing && tooltip !== null && !changePtIndices.has(tooltip.idx) && (
            <Circle cx={toX(tooltip.idx)} cy={toY(sorted[tooltip.idx].ranking)} r={6}
              fill={T.accent} stroke={T.bg} strokeWidth={2} />
          )}
          {xLabels.map(({ i, month }) => (
            <SvgText key={i} x={toX(i)} y={H - 4} fontSize={9} fill={T.textTertiary} textAnchor="middle">
              {month}
            </SvgText>
          ))}
        </Svg>
        {activePoint && tooltip !== null && (() => {
          const tx = toX(tooltip.idx);
          const ty = toY(activePoint.ranking);
          const tooltipWidth = 88;
          const left = Math.min(Math.max(tx - tooltipWidth / 2, PAD_L), W - PAD_R - tooltipWidth);
          return (
            <View pointerEvents="none" style={{ position: 'absolute', left, top: Math.max(PAD_T, ty - 44),
              backgroundColor: T.card, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5,
              borderWidth: 1, borderColor: T.cardBorder, minWidth: tooltipWidth }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: T.textPrimary, textAlign: 'center' }}>
                #{activePoint.ranking}
              </Text>
              <Text style={{ fontSize: 10, color: T.textSecondary, textAlign: 'center' }}>
                {fmtShortDate(activePoint.date)}
              </Text>
              {activePoint.label && (
                <Text style={{ fontSize: 9, color: T.textTertiary, textAlign: 'center' }} numberOfLines={1}>
                  {activePoint.label}
                </Text>
              )}
            </View>
          );
        })()}
      </View>
    </View>
  );
}

import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import Svg, { Path, Rect, Line as SvgLine, Circle, Text as SvgText } from 'react-native-svg';
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

const H = 220;
const PAD = { t: 16, b: 24, l: 34, r: 12 };
const LEGEND_H = 26;

export interface CashFlowChartMonth {
  label: string;
  spend: number;
  inflow: number;
}

export interface CashFlowChartProps {
  months: CashFlowChartMonth[];
  netSeries: number[];
  labels: { spend: string; inflow: string; net: string };
  onBarPress?: (index: number) => void;
  emptyLabel?: string;
  /** Index of the current month — its label renders emphasized so "now" is findable at a glance. */
  highlightIndex?: number;
}

function CashFlowChartInner({ months, netSeries, labels, onBarPress, emptyLabel, highlightIndex }: CashFlowChartProps) {
  const { width } = useWindowDimensions();
  const W = width - 40;
  const chartW = Math.max(0, W - PAD.l - PAD.r);
  const chartH = Math.max(0, H - PAD.t - PAD.b);
  const zeroY = PAD.t + chartH / 2;

  const n = months.length;

  const allZero = n === 0 || months.every(m => safeNum(m.spend) === 0 && safeNum(m.inflow) === 0);

  const maxAbs = useMemo(() => {
    if (n === 0) return 1;
    let m = 0;
    for (const mo of months) {
      m = Math.max(m, Math.abs(safeNum(mo.spend)), Math.abs(safeNum(mo.inflow)));
    }
    for (const v of netSeries) m = Math.max(m, Math.abs(safeNum(v)));
    return m > 0 ? m : 1;
  }, [months, netSeries, n]);

  const cap = maxAbs * 1.2;
  const half = chartH / 2;

  const slotW = n > 0 ? chartW / n : 0;
  const barW = Math.max(0, Math.min(22, slotW * 0.42));

  const centerX = (i: number) => PAD.l + slotW * i + slotW / 2;
  const barHeight = (v: number) => Math.max(0, (Math.abs(safeNum(v)) / cap) * half);

  // Cumulative-net line — own scale pinned to the same zero baseline as the bars.
  const netPts = useMemo(() => {
    return netSeries.map((v, i) => {
      const x = centerX(i);
      const val = safeNum(v);
      const y = zeroY - (val / cap) * half;
      return { x, y, v: val };
    });
  }, [netSeries, cap, half, zeroY, n, chartW]);

  const netPath = useMemo(() => {
    if (netPts.length < 2) return '';
    let d = `M ${netPts[0].x.toFixed(1)} ${netPts[0].y.toFixed(1)}`;
    for (let i = 1; i < netPts.length; i++) {
      d += ` L ${netPts[i].x.toFixed(1)} ${netPts[i].y.toFixed(1)}`;
    }
    return d;
  }, [netPts]);

  const yGrid = useMemo(() => {
    const fracs = [0.5, 0, -0.5];
    return fracs.map(f => ({
      y: zeroY - f * half,
      value: f * cap,
    }));
  }, [zeroY, half, cap]);

  if (allZero) {
    return (
      <View style={styles.wrap}>
        <View style={[styles.emptyBox, { height: H }]}>
          <Text style={styles.emptyText}>{emptyLabel ?? 'No cash flow data yet'}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={{ height: H }}>
        <Svg width={W} height={H}>
          {yGrid.map((g, i) => (
            <React.Fragment key={i}>
              <SvgLine x1={PAD.l} y1={g.y} x2={W - PAD.r} y2={g.y} stroke={T.cardBorder} strokeWidth={1} strokeDasharray="4 4" />
              <SvgText x={PAD.l - 6} y={g.y + 3} fontSize={9} fill={T.textTertiary} textAnchor="end">
                {fmt(g.value)}
              </SvgText>
            </React.Fragment>
          ))}

          {/* Zero baseline, slightly stronger than the grid */}
          <SvgLine x1={PAD.l} y1={zeroY} x2={W - PAD.r} y2={zeroY} stroke={T.textMuted} strokeWidth={1} />

          {months.map((m, i) => {
            const spend = safeNum(m.spend);
            const inflow = safeNum(m.inflow);
            const x = centerX(i) - barW / 2;
            const spendH = barHeight(spend);
            const inflowH = barHeight(inflow);
            return (
              <React.Fragment key={i}>
                <Rect
                  x={x} y={zeroY - inflowH}
                  width={barW} height={inflowH}
                  rx={3} fill={T.green}
                  onPress={onBarPress ? () => onBarPress(i) : undefined}
                />
                <Rect
                  x={x} y={zeroY}
                  width={barW} height={spendH}
                  rx={3} fill={T.red}
                  onPress={onBarPress ? () => onBarPress(i) : undefined}
                />
              </React.Fragment>
            );
          })}

          {netPath !== '' && (
            <Path d={netPath} fill="none" stroke={T.accent} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          )}
          {netPts.length > 0 && (() => {
            const last = netPts[netPts.length - 1];
            // Value callout at the end of the net line — the one number the
            // chart exists to answer ("where am I net, right now?").
            const nearRightEdge = last.x > W - PAD.r - 48;
            return (
              <>
                <Circle cx={last.x} cy={last.y} r={4} fill={T.accent} />
                <SvgText
                  x={nearRightEdge ? last.x - 7 : last.x + 7}
                  y={Math.min(H - PAD.b - 4, Math.max(PAD.t + 9, last.y - 8))}
                  fontSize={11}
                  fontWeight="bold"
                  fill={T.accent}
                  textAnchor={nearRightEdge ? 'end' : 'start'}
                >
                  {fmt(last.v)}
                </SvgText>
              </>
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

        {/* Transparent pressable overlays per bar slot, for a larger hit target than the SVG rects. */}
        {onBarPress && (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {months.map((_, i) => (
              <TouchableOpacity
                key={i}
                activeOpacity={0.6}
                onPress={() => onBarPress(i)}
                style={{
                  position: 'absolute',
                  left: PAD.l + slotW * i,
                  top: 0,
                  width: slotW,
                  height: H - PAD.b,
                }}
              />
            ))}
          </View>
        )}
      </View>

      <View style={[styles.legendRow, { height: LEGEND_H }]}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDash, { backgroundColor: T.green }]} />
          <Text style={styles.legendText}>{labels.inflow}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDash, { backgroundColor: T.red }]} />
          <Text style={styles.legendText}>{labels.spend}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDash, { backgroundColor: T.accent }]} />
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
  legendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDash: { width: 12, height: 3, borderRadius: 1.5 },
  legendText: { fontSize: 11, color: T.textSecondary, fontWeight: '600' },
});

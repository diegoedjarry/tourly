import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import Svg, { Path, Line as SvgLine, Circle } from 'react-native-svg';
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

export interface RunwaySeriesPoint {
  x: number; // 0-1 fraction of year elapsed
  actual: number; // cumulative spend or net-spend
}

export interface RunwayCardLabels {
  remaining: string;
  gross: string;
  net: string;
  projected: string;
  onPace: string;
  overBudget: string;
}

export interface RunwayCardProps {
  budget: number;
  spent: number;
  inflow: number;
  netMode: boolean;
  onToggleNetMode: () => void;
  projectedEndDate: string | null;
  seasonEndLabel: string;
  series: RunwaySeriesPoint[];
  labels: RunwayCardLabels;
  onPress?: () => void;
}

const CHART_H = 90;
const CHART_PAD = { t: 8, b: 8, l: 4, r: 4 };

function RunwayCardInner({
  budget,
  spent,
  inflow,
  netMode,
  onToggleNetMode,
  projectedEndDate,
  seasonEndLabel,
  series,
  labels,
  onPress,
}: RunwayCardProps) {
  const { width } = useWindowDimensions();
  const W = width - 40 - 32; // card horizontal padding (16 * 2) already subtracted from screen width
  const chartW = Math.max(0, W - CHART_PAD.l - CHART_PAD.r);
  const chartH = Math.max(0, CHART_H - CHART_PAD.t - CHART_PAD.b);

  const budgetSafe = safeNum(budget);
  const spentSafe = safeNum(spent);
  const inflowSafe = safeNum(inflow);

  const effectiveSpend = netMode ? spentSafe - inflowSafe : spentSafe;
  const remaining = budgetSafe - effectiveSpend;

  const pctLeft = budgetSafe > 0 ? remaining / budgetSafe : 0;

  const statusColor = useMemo(() => {
    if (remaining < 0) return T.red;
    if (pctLeft > 0.2) return T.green;
    if (pctLeft >= 0.05) return T.amber;
    return T.red;
  }, [remaining, pctLeft]);

  const bigNumberText = `${remaining < 0 ? '−' : ''}${fmt(Math.abs(remaining))}`;

  // Max value across the ideal line and actual series, for a shared Y scale.
  const maxVal = useMemo(() => {
    let m = budgetSafe;
    for (const p of series) m = Math.max(m, Math.abs(safeNum(p.actual)));
    return m > 0 ? m : 1;
  }, [series, budgetSafe]);

  const toX = (fx: number) => CHART_PAD.l + Math.max(0, Math.min(1, safeNum(fx))) * chartW;
  const toY = (v: number) => CHART_PAD.t + chartH - (Math.max(0, safeNum(v)) / maxVal) * chartH;

  const idealPath = `M ${toX(0).toFixed(1)} ${toY(0).toFixed(1)} L ${toX(1).toFixed(1)} ${toY(budgetSafe).toFixed(1)}`;

  const sortedSeries = useMemo(
    () => [...series].sort((a, b) => safeNum(a.x) - safeNum(b.x)),
    [series]
  );

  const actualPath = useMemo(() => {
    if (sortedSeries.length === 0) return '';
    let d = `M ${toX(sortedSeries[0].x).toFixed(1)} ${toY(sortedSeries[0].actual).toFixed(1)}`;
    for (let i = 1; i < sortedSeries.length; i++) {
      d += ` L ${toX(sortedSeries[i].x).toFixed(1)} ${toY(sortedSeries[i].actual).toFixed(1)}`;
    }
    return d;
  }, [sortedSeries, chartW, chartH, maxVal]);

  const latestX = sortedSeries.length > 0 ? toX(sortedSeries[sortedSeries.length - 1].x) : null;
  const latestPoint = sortedSeries.length > 0 ? sortedSeries[sortedSeries.length - 1] : null;

  // Projection color: before season end reads positive (green), after reads warning (amber/red)
  const projectionColor = useMemo(() => {
    if (!projectedEndDate) return T.textSecondary;
    const projected = Date.parse(projectedEndDate);
    const seasonEnd = Date.parse(seasonEndLabel);
    if (Number.isNaN(projected) || Number.isNaN(seasonEnd)) return T.textSecondary;
    return projected <= seasonEnd ? T.green : T.amber;
  }, [projectedEndDate, seasonEndLabel]);

  const CardInner = (
    <>
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>{labels.remaining}</Text>
        <View style={styles.pillGroup}>
          <TouchableOpacity
            style={[styles.pill, !netMode && styles.pillActive]}
            activeOpacity={0.7}
            onPress={() => { if (netMode) onToggleNetMode(); }}
          >
            <Text style={[styles.pillText, !netMode && styles.pillTextActive]}>{labels.gross}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pill, netMode && styles.pillActive]}
            activeOpacity={0.7}
            onPress={() => { if (!netMode) onToggleNetMode(); }}
          >
            <Text style={[styles.pillText, netMode && styles.pillTextActive]}>{labels.net}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={[styles.bigNumber, { color: statusColor }]}>{bigNumberText}</Text>

      <View style={{ height: CHART_H, marginTop: 8 }}>
        <Svg width={W} height={CHART_H}>
          <Path d={idealPath} stroke={T.textMuted} strokeWidth={1.5} strokeDasharray="4 4" fill="none" />
          {actualPath !== '' && (
            <Path d={actualPath} stroke={statusColor} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          )}
          {latestX !== null && (
            <SvgLine x1={latestX} y1={CHART_PAD.t} x2={latestX} y2={CHART_H - CHART_PAD.b} stroke={T.textMuted} strokeWidth={1} strokeDasharray="2 3" />
          )}
          {latestPoint !== null && (
            <Circle cx={toX(latestPoint.x)} cy={toY(latestPoint.actual)} r={4} fill={statusColor} />
          )}
        </Svg>
      </View>

      <View style={styles.footer}>
        {projectedEndDate ? (
          <Text style={[styles.footerText, { color: projectionColor }]}>
            {labels.projected} {projectedEndDate}
          </Text>
        ) : (
          <Text style={styles.footerTextMuted}>{remaining < 0 ? labels.overBudget : labels.onPace}</Text>
        )}
      </View>
    </>
  );

  return onPress ? (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={onPress}>
      {CardInner}
    </TouchableOpacity>
  ) : (
    <View style={styles.card}>{CardInner}</View>
  );
}

export const RunwayCard = React.memo(RunwayCardInner);

const styles = StyleSheet.create({
  card: {
    backgroundColor: T.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  headerLabel: { fontSize: 12, fontWeight: '600', color: T.textSecondary, letterSpacing: 0.3, textTransform: 'uppercase' },
  pillGroup: { flexDirection: 'row', backgroundColor: T.cardElevated, borderRadius: 20, padding: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 18 },
  pillActive: { backgroundColor: T.accent },
  pillText: { fontSize: 11, fontWeight: '600', color: T.textTertiary },
  pillTextActive: { color: T.textPrimary },
  bigNumber: { fontSize: 30, fontWeight: '700' },
  footer: { marginTop: 6 },
  footerText: { fontSize: 12, fontWeight: '600' },
  footerTextMuted: { fontSize: 12, fontWeight: '600', color: T.textTertiary },
});

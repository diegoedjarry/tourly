import React, { useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Text } from '@/components/ui/text';
import Svg, { Path, Circle, Text as SvgText } from 'react-native-svg';
import { T } from '@/constants/theme';

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function RankingChart({ points }: { points: { date: string; ranking: number; label?: string }[] }) {
  const { width } = useWindowDimensions();
  const [tooltip, setTooltip] = useState<{ idx: number } | null>(null);
  const W = width - 40;
  const H = 160;
  const PAD_L = 38; const PAD_R = 12; const PAD_T = 16; const PAD_B = 28;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  if (points.length < 2) return null;

  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const minRank = Math.min(...sorted.map(p => p.ranking));
  const maxRank = Math.max(...sorted.map(p => p.ranking));
  const rankSpan = maxRank - minRank || 1;
  const careerHigh = minRank;

  // Invert Y: lower rank number = top of chart
  const toX = (i: number) => PAD_L + (i / (sorted.length - 1)) * chartW;
  const toY = (r: number) => PAD_T + ((r - minRank) / rankSpan) * chartH;

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
  const xLabels: Array<{ i: number; month: string }> = [];
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
      <View style={{ position: 'relative' }}>
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
          {pts.map((p, i) => {
            if (!changePtIndices.has(i)) return null;
            return (
              <Circle key={i} cx={p.x} cy={p.y} r={tooltip?.idx === i ? 6 : 4}
                fill={tooltip?.idx === i ? T.accent : T.bg} stroke={T.accent} strokeWidth={2}
                onPress={() => setTooltip(prev => prev?.idx === i ? null : { idx: i })}
              />
            );
          })}
          {xLabels.map(({ i, month }) => (
            <SvgText key={i} x={toX(i)} y={H - 4} fontSize={9} fill={T.textTertiary} textAnchor="middle">
              {month}
            </SvgText>
          ))}
        </Svg>
        {activePoint && tooltip !== null && (() => {
          const tx = toX(tooltip.idx);
          const ty = toY(activePoint.ranking);
          const left = Math.min(Math.max(tx - 44, PAD_L), W - PAD_R - 88);
          return (
            <View style={{ position: 'absolute', left, top: Math.max(PAD_T, ty - 44),
              backgroundColor: '#1A1A3A', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5,
              borderWidth: 1, borderColor: T.accent + '60', minWidth: 88 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: T.accent, textAlign: 'center' }}>
                #{activePoint.ranking}
              </Text>
              <Text style={{ fontSize: 10, color: T.textSecondary, textAlign: 'center' }}>
                {activePoint.date.slice(0, 10)}
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

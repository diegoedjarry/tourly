import React, { useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
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

export interface CostLadderSegment {
  label: string;
  value: number;
  color: string;
}

export interface CostLadderRow {
  id: string;
  name: string;
  flag?: string;
  total: number;
  segments: CostLadderSegment[];
}

export interface CostLadderProps {
  rows: CostLadderRow[];
  maxRows?: number;
  onRowPress?: (id: string) => void;
  seeAllLabel?: string;
  onSeeAll?: () => void;
}

const BAR_H = 14;

function CostLadderInner({ rows, maxRows = 5, onRowPress, seeAllLabel, onSeeAll }: CostLadderProps) {
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => safeNum(b.total) - safeNum(a.total)),
    [rows]
  );

  // Legend: every segment color used across the rows, biggest spend first,
  // so the stacked colors are decodable without tapping into a tournament.
  const legend = useMemo(() => {
    const acc = new Map<string, { color: string; total: number }>();
    for (const r of rows) {
      for (const s of r.segments) {
        const v = Math.max(0, safeNum(s.value));
        const cur = acc.get(s.label);
        if (cur) cur.total += v;
        else acc.set(s.label, { color: s.color, total: v });
      }
    }
    return [...acc.entries()]
      .map(([label, v]) => ({ label, ...v }))
      .filter(l => l.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [rows]);

  if (sorted.length === 0) return null;

  const maxTotal = Math.max(1, ...sorted.map(r => Math.abs(safeNum(r.total))));
  const visible = expanded ? sorted : sorted.slice(0, Math.max(0, maxRows));
  const hiddenCount = sorted.length - visible.length;

  const handleSeeAll = () => {
    if (onSeeAll) { onSeeAll(); return; }
    setExpanded(true);
  };

  return (
    <View style={styles.wrap}>
      {visible.map(row => {
        const total = safeNum(row.total);
        const fullWidthPct = Math.max(0, Math.min(100, (Math.abs(total) / maxTotal) * 100));
        const segTotal = row.segments.reduce((s, seg) => s + Math.max(0, safeNum(seg.value)), 0);

        const RowContent = (
          <>
            <View style={styles.headerRow}>
              <Text style={styles.name} numberOfLines={1}>
                {row.flag ? `${row.flag} ` : ''}{row.name}
              </Text>
              <Text style={styles.total}>{fmt(total)}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.trackFill, { width: `${fullWidthPct}%` }]}>
                {row.segments.map((seg, i) => {
                  const segVal = Math.max(0, safeNum(seg.value));
                  const segPct = segTotal > 0 ? (segVal / segTotal) * 100 : 0;
                  if (segPct <= 0) return null;
                  return (
                    <View
                      key={i}
                      style={{
                        width: `${segPct}%`,
                        height: '100%',
                        backgroundColor: seg.color,
                      }}
                    />
                  );
                })}
              </View>
            </View>
          </>
        );

        return onRowPress ? (
          <TouchableOpacity key={row.id} style={styles.row} activeOpacity={0.7} onPress={() => onRowPress(row.id)}>
            {RowContent}
          </TouchableOpacity>
        ) : (
          <View key={row.id} style={styles.row}>
            {RowContent}
          </View>
        );
      })}

      {!expanded && hiddenCount > 0 && (
        <TouchableOpacity style={styles.seeAll} activeOpacity={0.7} onPress={handleSeeAll}>
          <Text style={styles.seeAllText}>{seeAllLabel ?? `See all (${sorted.length})`}</Text>
        </TouchableOpacity>
      )}

      {legend.length > 0 && (
        <View style={styles.legendWrap}>
          {legend.map(item => (
            <View key={item.label} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: item.color }]} />
              <Text style={styles.legendLabel}>{item.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export const CostLadder = React.memo(CostLadderInner);

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  row: { marginBottom: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  name: { flex: 1, fontSize: 13, fontWeight: '600', color: T.textPrimary, marginRight: 8 },
  total: { fontSize: 13, fontWeight: '700', color: T.textPrimary },
  track: {
    height: BAR_H,
    borderRadius: BAR_H / 2,
    backgroundColor: T.cardBorder,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  trackFill: {
    height: '100%',
    borderRadius: BAR_H / 2,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  seeAll: { alignItems: 'center', paddingTop: 4, paddingBottom: 2 },
  seeAllText: { fontSize: 12, fontWeight: '600', color: T.accent },
  legendWrap: {
    flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 6,
    marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: T.cardBorder,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 10, fontWeight: '600', color: T.textTertiary },
});

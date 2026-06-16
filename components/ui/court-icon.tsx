import React from 'react';
import { View } from 'react-native';

// ITF-style court icon: two trapezoids (wider at bottom, narrower at top)
// stacked with a 2px white gap representing the net.
//
// Built with the React Native border trick:
//   width (content) = top edge, borderLeft/Right = slant amount,
//   borderBottom = height. RN includes borders in box-model layout.
//
// md  →  bottom 20px, top 12px, each half 8px tall, 2px gap → 20×18px total
// sm  →  bottom 15px, top  9px, each half 6px tall, 2px gap → 15×14px total

const SURFACE_COLOR: Record<string, string> = {
  clay:  '#C4692A',
  hard:  '#3B5BA5',
  grass: '#3A7D3A',
};

export function CourtIcon({
  surface,
  size = 'md',
}: {
  surface?: string;
  size?: 'md' | 'sm';
}) {
  const color = SURFACE_COLOR[(surface ?? '').toLowerCase()] ?? '#888888';

  if (size === 'sm') {
    const trap = {
      width: 9, height: 0, backgroundColor: 'transparent',
      borderBottomWidth: 6, borderBottomColor: color,
      borderLeftWidth: 3, borderLeftColor: 'transparent',
      borderRightWidth: 3, borderRightColor: 'transparent',
    } as const;
    return (
      <View style={{ gap: 2 }}>
        <View style={trap} />
        <View style={trap} />
      </View>
    );
  }

  const trap = {
    width: 12, height: 0, backgroundColor: 'transparent',
    borderBottomWidth: 8, borderBottomColor: color,
    borderLeftWidth: 4, borderLeftColor: 'transparent',
    borderRightWidth: 4, borderRightColor: 'transparent',
  } as const;
  return (
    <View style={{ gap: 2 }}>
      <View style={trap} />
      <View style={trap} />
    </View>
  );
}

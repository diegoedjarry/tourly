import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Animated, useWindowDimensions } from 'react-native';
import { Text } from '@/components/ui/text';
import { T } from '@/constants/theme';

interface FloatingInsightProps {
  content: string;
  label?: string;
}

export function FloatingInsight({ content, label }: FloatingInsightProps) {
  const [expanded, setExpanded] = useState(false);
  const { width } = useWindowDimensions();

  if (!content) return null;

  return (
    <View style={s.container} pointerEvents="box-none">
      <TouchableOpacity
        style={[s.pill, expanded && s.pillExpanded]}
        activeOpacity={0.9}
        onPress={() => setExpanded(!expanded)}
      >
        <View style={s.row}>
          <View style={s.iconCircle}>
            <Text style={s.icon}>🎾</Text>
          </View>
          <Text style={s.preview} numberOfLines={expanded ? 10 : 1}>
            {content}
          </Text>
          <Text style={s.chevron}>{expanded ? '⌄' : '⌃'}</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  pill: {
    backgroundColor: T.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: T.cardBorder,
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  pillExpanded: {
    borderRadius: 18,
    paddingVertical: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: T.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 16 },
  preview: {
    flex: 1,
    fontSize: 13,
    color: T.textSecondary,
    lineHeight: 19,
  },
  chevron: {
    fontSize: 16,
    color: T.textTertiary,
    fontWeight: '600',
  },
});

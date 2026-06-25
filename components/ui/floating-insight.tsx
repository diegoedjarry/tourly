import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from '@/components/ui/text';
import { T } from '@/constants/theme';

interface FloatingInsightProps {
  content: string;
  label?: string;
  generatedAt?: string;
  locked?: boolean;
  onPress?: () => void;
}

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const [, m, day] = iso.split('T')[0].split('-');
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${+day} ${MONTHS[+m - 1]}`;
}

export function FloatingInsight({ content, label, generatedAt, locked, onPress }: FloatingInsightProps) {
  if (locked) {
    return (
      <View style={s.card}>
        <View style={s.topRow}>
          <Text style={s.labelText}>FINANCIAL COACH</Text>
        </View>
        <View style={s.body}>
          <Text style={[s.sparkle, { color: T.textTertiary }]}>🔒</Text>
          <Text style={[s.content, { color: T.textSecondary }]}>
            Add 2+ tournaments and 5+ expenses to unlock personalized AI coaching insights.
          </Text>
        </View>
      </View>
    );
  }

  if (!content) return null;

  const dateStr = generatedAt ? relativeDate(generatedAt) : 'Today';

  return (
    <TouchableOpacity style={s.card} activeOpacity={0.85} onPress={onPress}>
      <View style={s.topRow}>
        <Text style={s.labelText}>{label ?? 'FINANCIAL COACH'}</Text>
        <Text style={s.dateText}>{dateStr}</Text>
      </View>
      <View style={s.body}>
        <Text style={s.sparkle}>✦</Text>
        <Text style={s.content} numberOfLines={3}>{content}</Text>
        <Text style={s.chevron}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: {
    position: 'absolute',
    bottom: 8,
    left: 16,
    right: 16,
    backgroundColor: '#1A1A2E',
    borderLeftWidth: 3,
    borderLeftColor: T.accent,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  labelText: {
    fontSize: 10,
    fontWeight: '700',
    color: T.textSecondary,
    letterSpacing: 0.8,
  },
  dateText: {
    fontSize: 10,
    color: T.textSecondary,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  sparkle: {
    fontSize: 14,
    color: T.accent,
    marginTop: 1,
  },
  content: {
    flex: 1,
    fontSize: 14,
    color: '#FAFAFA',
    lineHeight: 21,
  },
  chevron: {
    fontSize: 20,
    color: T.textTertiary,
    marginTop: -1,
  },
});

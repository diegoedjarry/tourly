import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '@/components/ui/text';
import Svg, { Circle } from 'react-native-svg';

interface MetricRingProps {
  size: number;
  strokeWidth: number;
  progress: number; // 0–1
  color: string;
  label: string;
  value: string;
}

export function MetricRing({ size, strokeWidth, progress, color, label, value }: MetricRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedProgress = Math.min(Math.max(progress, 0), 1);
  const strokeDashoffset = circumference * (1 - clampedProgress);

  return (
    <View style={[s.wrap, { width: size }]}>
      <Svg width={size} height={size} style={s.svg}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={s.center}>
        <Text style={s.value}>{value}</Text>
      </View>
      <Text style={[s.label, { color }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center' },
  svg: { transform: [{ rotateY: '0deg' }] },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginTop: 6, textTransform: 'uppercase' },
});

import React from 'react';
import Svg, { Circle, Path, G, Line } from 'react-native-svg';
import { T } from '@/constants/theme';

interface TourlyLogoProps {
  width?: number;
  height?: number;
  color?: string;
}

export function TourlyLogo({ width = 200, height = 52, color = T.textPrimary }: TourlyLogoProps) {
  const vw = 380;
  const vh = 90;
  const sw = 2.8;
  const top = 20;
  const bot = 72;
  const mid = (top + bot) / 2;

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${vw} ${vh}`}>
      {/* T */}
      <Line x1={18} y1={top} x2={56} y2={top} stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <Line x1={37} y1={top} x2={37} y2={bot} stroke={color} strokeWidth={sw} strokeLinecap="round" />

      {/* O — circle with person inside */}
      <G>
        <Circle cx={92} cy={mid} r={24} fill="none" stroke={color} strokeWidth={sw} />
        <Circle cx={92} cy={mid - 9} r={6} fill={color} />
        <Path d={`M 79.5,${mid + 16} Q 79.5,${mid + 3} 92,${mid + 3} Q 104.5,${mid + 3} 104.5,${mid + 16}`}
          fill={color} />
        <Path d={`M 89,${mid + 8} L 92,${mid + 15} L 95,${mid + 8}`}
          fill="none" stroke={T.bg} strokeWidth={1.4} strokeLinejoin="round" />
      </G>

      {/* U */}
      <Path d={`M 128,${top} L 128,${bot - 16} Q 128,${bot} 148,${bot} Q 168,${bot} 168,${bot - 16} L 168,${top}`}
        fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />

      {/* R */}
      <G>
        <Line x1={184} y1={top} x2={184} y2={bot} stroke={color} strokeWidth={sw} strokeLinecap="round" />
        <Path d={`M 184,${top} L 206,${top} Q 220,${top} 220,${top + 15} Q 220,${top + 30} 206,${top + 30} L 184,${top + 30}`}
          fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        <Line x1={200} y1={top + 30} x2={222} y2={bot} stroke={color} strokeWidth={sw} strokeLinecap="round" />
      </G>

      {/* L */}
      <Path d={`M 238,${top} L 238,${bot} L 268,${bot}`}
        fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />

      {/* Y */}
      <G>
        <Line x1={282} y1={top} x2={302} y2={mid} stroke={color} strokeWidth={sw} strokeLinecap="round" />
        <Line x1={322} y1={top} x2={302} y2={mid} stroke={color} strokeWidth={sw} strokeLinecap="round" />
        <Line x1={302} y1={mid} x2={302} y2={bot} stroke={color} strokeWidth={sw} strokeLinecap="round" />
      </G>
    </Svg>
  );
}

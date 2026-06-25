import { Platform } from 'react-native';

// Antigravity design system for Tourly
// 8px grid · 60-30-10 color · aggressive typography hierarchy
export const T = {
  // 60% — Background and canvas
  bg: '#0F0F1A',

  // 30% — Cards, containers
  card: '#1A1A2E',
  cardElevated: '#22222E',
  cardBorder: '#2A2A3C',

  // Text hierarchy
  textPrimary: '#FFFFFF',
  textSecondary: '#8888AA',
  textTertiary: '#666688',
  textMuted: '#3E3E52',

  // 10% — Accent (Electric Indigo)
  accent: '#5B5BD6',
  accentMuted: 'rgba(91, 91, 214, 0.15)',

  // Semantic colors
  green: '#44CF6C',
  red: '#EF4444',
  amber: '#F0A830',

  // Surface accents (stripe/icon only, never full card bg)
  claySurface: '#C4692A',
  clayText: '#E8964A',
  hardSurface: '#2B5BAE',
  hardText: '#5AABEE',
  grassSurface: '#2D6A2D',
  grassText: '#68B83A',

  // Teal (secondary action)
  teal: '#00D4AA',
  tealMuted: 'rgba(0, 212, 170, 0.15)',
} as const;

// Surface stripe color for left-border accents
export const SURFACE_STRIPE: Record<string, string> = {
  clay: T.claySurface,
  hard: T.hardSurface,
  grass: T.grassSurface,
};

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', serif: 'ui-serif', rounded: 'ui-rounded', mono: 'ui-monospace' },
  default: { sans: 'normal', serif: 'serif', rounded: 'normal', mono: 'monospace' },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});

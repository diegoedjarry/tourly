import { Platform } from 'react-native';

// Tourly trust palette — deep-navy institutional base, court-green action
// accents, premium amber urgency. 8px grid · 60-30-10 · dark-surface system.
//
// Key contract is unchanged (bg/card/accent/green/amber/teal/…): every screen
// that imports T rebrands through this file alone. Do not add per-screen hexes
// for anything that has a semantic token here.
export const T = {
  // 60% — Canvas. Deep authoritative navy (trust / stability anchor).
  bg: '#0A1128',

  // 30% — Cards and containers. Navy-family surfaces, one step lighter each.
  card: '#111C38',
  cardElevated: '#182647',
  cardBorder: '#22305A',

  // Text hierarchy — crisp off-white down to structural muted.
  textPrimary: '#F8F9FA',
  textSecondary: '#8B96B8',
  textTertiary: '#5E6A8C',
  textMuted: '#39456B',

  // 10% — Brand accent. Refined steel indigo (matches app icon family).
  accent: '#5E6AD2',
  accentMuted: 'rgba(94, 106, 210, 0.16)',

  // Semantic colors
  // green: financial-positive metrics and success states ONLY.
  green: '#00B876',
  red: '#EF4444',
  // amber: deadline urgency — important without panic (premium ochre).
  amber: '#D97706',

  // Surface accents (stripe/icon only, never full card bg)
  claySurface: '#C4692A',
  clayText: '#E8964A',
  hardSurface: '#2B5BAE',
  hardText: '#5AABEE',
  grassSurface: '#2D6A2D',
  grassText: '#68B83A',

  // Action color (CTAs, confirm buttons) — court green per trust palette.
  // Kept under the legacy `teal` key so every existing CTA converts here.
  teal: '#00A86B',
  tealMuted: 'rgba(0, 168, 107, 0.15)',
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

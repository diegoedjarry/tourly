/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { T } from '@/constants/theme';

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName?: keyof typeof T | 'background' | 'text'
) {
  const colorFromProps = props.light;

  if (colorFromProps) {
    return colorFromProps;
  }

  // Map legacy theme color names to T
  if (colorName === 'background') return T.bg;
  if (colorName === 'text') return T.textPrimary;

  return colorName ? T[colorName as keyof typeof T] : T.textPrimary;
}

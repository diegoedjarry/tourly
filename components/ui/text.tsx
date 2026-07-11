import { Text as RNText, TextProps, StyleSheet } from 'react-native';

const WEIGHT_MAP: Record<string, string> = {
  '300': 'Montserrat_300Light',
  '400': 'Montserrat_400Regular',
  '500': 'Montserrat_500Medium',
  '600': 'Montserrat_600SemiBold',
  '700': 'Montserrat_700Bold',
  '800': 'Montserrat_800ExtraBold',
  bold: 'Montserrat_700Bold',
  normal: 'Montserrat_400Regular',
};

export function Text({ style, maxFontSizeMultiplier = 1.3, ...props }: TextProps) {
  const flat = StyleSheet.flatten(style) ?? {};
  const fontFamily = WEIGHT_MAP[String(flat.fontWeight ?? '400')] ?? 'Montserrat_400Regular';
  return <RNText style={[style, { fontFamily }]} maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />;
}

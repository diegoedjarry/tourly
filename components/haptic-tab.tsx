import { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import { Platform } from 'react-native';

export function HapticTab(props: BottomTabBarButtonProps) {
  return (
    <PlatformPressable
      {...props}
      onPressIn={(ev) => {
        if (Platform.OS === 'ios') {
          import('expo-haptics').then(Haptics => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          });
        }
        props.onPressIn?.(ev);
      }}
    />
  );
}

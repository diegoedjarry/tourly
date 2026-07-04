// Swipe-to-act list row with haptic feedback.
//
// Wraps any list row in a right-swipe action (delete/archive/withdraw). Uses
// RNGH's ReanimatedSwipeable — requires GestureHandlerRootView at the app root.
// A medium haptic fires when the action zone opens; the action itself closes
// the row first so the list collapse animates from a settled state.

import React, { useRef } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import ReanimatedSwipeable, { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Text } from '@/components/ui/text';
import { T } from '@/constants/theme';

interface Props {
  children: React.ReactNode;
  /** Label on the revealed action, e.g. "Delete" (pass a translated string). */
  actionLabel: string;
  /** Defaults to danger red. Pass T.amber for archive/withdraw semantics. */
  actionColor?: string;
  onAction: () => void;
  /** Disable swiping (e.g. while in select mode). */
  enabled?: boolean;
}

const ACTION_WIDTH = 88;

function RightAction({
  drag,
  label,
  color,
  onPress,
}: {
  drag: SharedValue<number>;
  label: string;
  color: string;
  onPress: () => void;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: drag.value + ACTION_WIDTH }],
  }));
  return (
    <Reanimated.View style={[styles.actionContainer, style]}>
      <TouchableOpacity
        style={[styles.actionButton, { backgroundColor: color }]}
        onPress={onPress}
        activeOpacity={0.85}
      >
        <Text style={styles.actionText}>{label}</Text>
      </TouchableOpacity>
    </Reanimated.View>
  );
}

export function SwipeableRow({ children, actionLabel, actionColor = T.red, onAction, enabled = true }: Props) {
  const ref = useRef<SwipeableMethods>(null);

  const handleAction = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    ref.current?.close();
    onAction();
  };

  return (
    <ReanimatedSwipeable
      ref={ref}
      enabled={enabled}
      friction={2}
      rightThreshold={ACTION_WIDTH / 2}
      overshootRight={false}
      onSwipeableWillOpen={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
      renderRightActions={(_, drag) => (
        <RightAction drag={drag} label={actionLabel} color={actionColor} onPress={handleAction} />
      )}
    >
      <View>{children}</View>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  actionContainer: { width: ACTION_WIDTH, flexDirection: 'row' },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    marginLeft: 8,
    marginBottom: 10, // matches typical card marginBottom in lists
  },
  actionText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});

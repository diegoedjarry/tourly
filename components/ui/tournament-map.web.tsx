// Web stub for TournamentMap. react-native-maps is native-only — importing it
// on web is a Metro bundling error, which made `expo start --web` fail for the
// whole app. Metro's platform resolution picks this file on web and the real
// tournament-map.tsx on iOS/Android. Web isn't a shipping target; this just
// keeps the rest of the app bundlable there for dev/demo smoke tests.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface TournamentMapProps {
  tournaments: any[];
  onOpenTournament?: (id: string) => void;
  /** Legacy alias kept for backward-compat */
  onSelectTournament?: (id: string) => void;
  onAddTournament?: () => void;
  onClose?: () => void;
}

export function TournamentMap(_props: TournamentMapProps) {
  return (
    <View style={s.placeholder}>
      <Text style={s.text}>Map view is available in the mobile app.</Text>
    </View>
  );
}

export default TournamentMap;

const s = StyleSheet.create({
  placeholder: {
    flex: 1,
    minHeight: 220,
    borderRadius: 16,
    backgroundColor: '#EEF0F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 13,
    color: '#8A8AB0',
  },
});

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = '@tourly_visited_';

export function useFirstVisit(screenKey: string) {
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(PREFIX + screenKey).then(val => {
      setIsFirstVisit(val !== 'true');
      setChecked(true);
    }).catch(() => {
      setChecked(true);
    });
  }, [screenKey]);

  const markVisited = useCallback(() => {
    setIsFirstVisit(false);
    AsyncStorage.setItem(PREFIX + screenKey, 'true');
  }, [screenKey]);

  return { isFirstVisit: checked && isFirstVisit, markVisited };
}

import { useEffect, useState, useRef } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { processQueue, getQueueLength } from '@/lib/offline-queue';

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const wasOffline = useRef(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const online = !!state.isConnected;
      setIsOnline(online);

      if (online && wasOffline.current) {
        processQueue().then(() => {
          getQueueLength().then(setPendingCount);
        });
      }
      wasOffline.current = !online;
    });

    getQueueLength().then(setPendingCount);

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isOnline) {
      processQueue().then(() => {
        getQueueLength().then(setPendingCount);
      });
    }
  }, [isOnline]);

  return { isOnline, pendingCount };
}

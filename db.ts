import 'react-native-get-random-values';
import { init, i } from '@instantdb/react-native';
import { StoreInterface } from '@instantdb/core';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Persistent store backed by AsyncStorage so sessions survive app restarts.
// Values are JSON-serialised on write and parsed on read (AsyncStorage is string-only).
class AsyncStorageStore extends StoreInterface {
  async getItem(key: string) {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  }

  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
  }

  async multiSet(pairs: Array<[string, any]>) {
    await AsyncStorage.multiSet(pairs.map(([k, v]) => [k, JSON.stringify(v)]));
  }

  async getAllKeys() {
    return ((await AsyncStorage.getAllKeys()) ?? []) as string[];
  }
}

const APP_ID = process.env.EXPO_PUBLIC_INSTANTDB_APP_ID ?? 'f819fcd1-f0da-4658-ac5c-a190539808f6';

const schema = i.schema({
  entities: {
    tournaments: i.entity({
      name: i.string(),
      country: i.string(),
      city: i.string(),
      surface: i.string(),
      startDate: i.string(),
      endDate: i.string(),
      signUpDeadline: i.string(),
      withdrawalDeadline: i.string(),
      freezeDeadline: i.string(),
      category: i.string(),
      status: i.string(),
      isRegistered: i.boolean(),
      isWithdrawn: i.boolean(),
      isInMyList: i.boolean(),
      prizeMoney: i.number(),
      singlesPrizeMoney: i.number(),
      doublesPrizeMoney: i.number(),
    }),
    expenses: i.entity({
      tournamentId: i.string(),
      category: i.string(),
      amount: i.number(),
      note: i.string(),
      date: i.string(),
      isCoachExpense: i.boolean(),
    }),
    monthlyExpenses: i.entity({
      month: i.number(),
      year: i.number(),
      category: i.string(),
      amount: i.number(),
      note: i.string(),
    }),
    devices: i.entity({
      pushToken: i.string(),
      platform: i.string(),
      updatedAt: i.number(),
    }),
    users: i.entity({
      name: i.string(),
      nationality: i.string(),
      ranking: i.number(),
      dateOfBirth: i.string(),
      homeBase: i.string(),
      role: i.string(),
    }),
  },
});

export type AppSchema = typeof schema;
export const db = init({ appId: APP_ID, schema, Store: AsyncStorageStore });

// Sign-out cleanup: best-effort clear of the shared device's push token so a
// stale token tied to User A doesn't keep receiving pushes routed for User A
// after User B signs in on the same device. Never throws — this must not be
// able to block sign-out.
export async function clearDevicePushToken(): Promise<void> {
  try {
    await db.transact(
      db.tx.devices['singleton-device'].update({
        pushToken: null as unknown as string,
        updatedAt: Date.now(),
      }),
    );
  } catch {
    // Best-effort — InstantDB write failures must never block sign-out.
  }
}

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  recordDeletedTournament,
  getDeletedTournamentIds,
} from '@/lib/deleted-tournaments';

const STORAGE_KEY = '@tourly_deleted_tournaments';
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('recordDeletedTournament / getDeletedTournamentIds', () => {
  it('records an id and returns it from getDeletedTournamentIds', async () => {
    await recordDeletedTournament('t1');

    const ids = await getDeletedTournamentIds();
    expect(ids).toEqual(new Set(['t1']));
  });
});

describe('getDeletedTournamentIds — 30 day pruning', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('prunes an entry recorded more than 30 days ago', async () => {
    await recordDeletedTournament('old');

    jest.setSystemTime(30 * DAY_MS + 1000);

    const ids = await getDeletedTournamentIds();
    expect(ids.has('old')).toBe(false);
  });

  it('keeps an entry recorded within the 30 day window', async () => {
    await recordDeletedTournament('recent');

    jest.setSystemTime(29 * DAY_MS);

    const ids = await getDeletedTournamentIds();
    expect(ids.has('recent')).toBe(true);
  });
});

describe('recordDeletedTournament — concurrent writes', () => {
  it('persists every id from concurrent calls, none lost to a read-modify-write race', async () => {
    // The official AsyncStorage jest mock resolves synchronously (same
    // microtask), which would never reproduce a read-modify-write race even
    // without the module's internal `chain` serialization. Force real
    // interleaving by making getItem/setItem resolve on separate microtask
    // ticks, so this test actually exercises the serialization guard.
    const store = new Map<string, string>();
    const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => {
      await tick();
      return store.has(key) ? store.get(key)! : null;
    });
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
      await tick();
      store.set(key, value);
    });

    const ids = Array.from({ length: 10 }, (_, i) => `concurrent-${i}`);
    await Promise.all(ids.map((id) => recordDeletedTournament(id)));

    const raw = store.get(STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    expect(Object.keys(map).sort()).toEqual([...ids].sort());
  });
});

describe('recordDeletedTournament / getDeletedTournamentIds — storage failures', () => {
  it('recordDeletedTournament swallows getItem/setItem rejections instead of throwing', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('boom'));

    await expect(recordDeletedTournament('t1')).resolves.toBeUndefined();
  });

  it('getDeletedTournamentIds returns an empty Set when storage reads fail', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('boom'));

    await expect(getDeletedTournamentIds()).resolves.toEqual(new Set());
  });
});

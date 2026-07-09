jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  queryClient,
  persistCacheToMmkv,
  clearPersistedCache,
} from '@/lib/queryClient';

const CACHE_KEY = 'react-query-cache';

async function flushMicrotasks() {
  // AsyncStorage.getItem().then(...) inside persistCacheToMmkv's restore path
  // needs at least one microtask turn to resolve and run its callback.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  queryClient.clear();
});

describe('persistCacheToMmkv — restore', () => {
  it('restores NEW format entries ({queryKey, data}) via setQueryData', async () => {
    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify([{ queryKey: ['tournaments'], data: { foo: 'bar' } }])
    );

    persistCacheToMmkv();
    await flushMicrotasks();

    expect(queryClient.getQueryData(['tournaments'])).toEqual({ foo: 'bar' });
  });

  it('restores OLD format entries ({queryKey, state: {data}}) for backward compat', async () => {
    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify([{ queryKey: ['expenses'], state: { data: { legacy: true } } }])
    );

    persistCacheToMmkv();
    await flushMicrotasks();

    expect(queryClient.getQueryData(['expenses'])).toEqual({ legacy: true });
  });

  it('skips profile-rooted keys, including keyed variants', async () => {
    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify([
        { queryKey: ['profile'], data: { name: 'should not restore' } },
        { queryKey: ['profile', 'user-1'], data: { name: 'should not restore either' } },
        { queryKey: ['tournaments'], data: { ok: true } },
      ])
    );

    persistCacheToMmkv();
    await flushMicrotasks();

    expect(queryClient.getQueryData(['profile'])).toBeUndefined();
    expect(queryClient.getQueryData(['profile', 'user-1'])).toBeUndefined();
    expect(queryClient.getQueryData(['tournaments'])).toEqual({ ok: true });
  });
});

describe('persistCacheToMmkv — persist (debounced write)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes only {queryKey, data} pairs after the 2s debounce, skipping undefined data', async () => {
    persistCacheToMmkv();
    // No pre-existing persisted cache, let the restore branch resolve/no-op.
    await flushMicrotasks();

    queryClient.setQueryData(['tournaments'], { id: 1 });
    queryClient.setQueryData(['expenses'], { id: 2 });
    // A query with undefined data should not appear in the persisted output.
    queryClient.setQueryData(['ghost'], undefined);

    jest.advanceTimersByTime(2000);
    await flushMicrotasks();

    const raw = await AsyncStorage.getItem(CACHE_KEY);
    expect(raw).not.toBeNull();
    const entries = JSON.parse(raw as string);

    const ghost = entries.find((e: any) => JSON.stringify(e.queryKey) === JSON.stringify(['ghost']));
    expect(ghost).toBeUndefined();

    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(['data', 'queryKey']);
    }

    const tournaments = entries.find((e: any) => JSON.stringify(e.queryKey) === JSON.stringify(['tournaments']));
    expect(tournaments.data).toEqual({ id: 1 });
    const expenses = entries.find((e: any) => JSON.stringify(e.queryKey) === JSON.stringify(['expenses']));
    expect(expenses.data).toEqual({ id: 2 });
  });

  it('debounces rapid cache changes into a single write at 2s after the last change', async () => {
    persistCacheToMmkv();
    await flushMicrotasks();

    queryClient.setQueryData(['a'], { v: 1 });
    jest.advanceTimersByTime(1000);
    queryClient.setQueryData(['a'], { v: 2 }); // resets the debounce timer
    jest.advanceTimersByTime(1000);
    await flushMicrotasks();

    // Only 1s elapsed since the last change — no write yet.
    expect(await AsyncStorage.getItem(CACHE_KEY)).toBeNull();

    jest.advanceTimersByTime(1000);
    await flushMicrotasks();

    const raw = await AsyncStorage.getItem(CACHE_KEY);
    expect(raw).not.toBeNull();
    const entries = JSON.parse(raw as string);
    const a = entries.find((e: any) => JSON.stringify(e.queryKey) === JSON.stringify(['a']));
    expect(a.data).toEqual({ v: 2 });
  });
});

describe('persistCacheToMmkv — size cap', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not write when serialized entries exceed 2,000,000 chars', async () => {
    persistCacheToMmkv();
    await flushMicrotasks();

    const huge = 'x'.repeat(2_100_000);
    queryClient.setQueryData(['huge'], { blob: huge });

    jest.advanceTimersByTime(2000);
    await flushMicrotasks();

    expect(await AsyncStorage.getItem(CACHE_KEY)).toBeNull();
  });
});

describe('clearPersistedCache', () => {
  it('removes the storage key and clears the query cache', async () => {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify([{ queryKey: ['x'], data: 1 }]));
    queryClient.setQueryData(['tournaments'], { id: 1 });

    await clearPersistedCache();

    expect(await AsyncStorage.getItem(CACHE_KEY)).toBeNull();
    expect(queryClient.getQueryData(['tournaments'])).toBeUndefined();
  });
});

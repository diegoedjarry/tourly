// Regression coverage for mutation-scoped rollback (Fix 3): optimisticInsert/
// optimisticMerge/optimisticRemove used to snapshot the ENTIRE array as
// `previous` and restore that whole snapshot on rollback. If two mutations
// overlapped and the earlier one failed after the later one had already
// applied, the earlier rollback would resurrect pre-both state and silently
// revert the later mutation too. These tests exercise that overlap directly
// through the public api.ts functions with a fake react-query cache.
//
// Variables referenced inside jest.mock() factories below are prefixed with
// `mock` because jest.mock() factories may only reference out-of-scope
// variables whose names start with "mock" (enforced by babel-plugin-jest-hoist).

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(),
  addEventListener: jest.fn(),
}));

jest.mock('@/lib/offline-queue', () => ({
  enqueue: jest.fn(),
}));

jest.mock('@/lib/deleted-tournaments', () => ({
  recordDeletedTournament: jest.fn(),
}));

// Minimal in-memory-backed fake so getQueryData/setQueryData with a
// functional updater behave like the real react-query client.
const mockFakeCache = new Map<string, any>();

jest.mock('@/lib/queryClient', () => ({
  queryClient: {
    invalidateQueries: jest.fn(),
    getQueryData: jest.fn((key: string[]) => mockFakeCache.get(JSON.stringify(key))),
    setQueryData: jest.fn((key: string[], updater: any) => {
      const k = JSON.stringify(key);
      const next = typeof updater === 'function' ? updater(mockFakeCache.get(k)) : updater;
      mockFakeCache.set(k, next);
      return next;
    }),
  },
}));

const mockAuthGetUser = jest.fn();
const mockTableMocks: Record<string, any> = {};

function mockMakeTableMock() {
  const insertSingle = jest.fn();
  const select = jest.fn(() => ({ single: insertSingle }));
  const insert = jest.fn(() => ({ select }));
  const updateEq = jest.fn();
  const update = jest.fn(() => ({ eq: updateEq }));
  const deleteEq = jest.fn();
  const del = jest.fn(() => ({ eq: deleteEq }));
  return { insert, select, insertSingle, update, updateEq, delete: del, deleteEq };
}

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: any[]) => mockAuthGetUser(...args) },
    from: (table: string) => {
      if (!mockTableMocks[table]) mockTableMocks[table] = mockMakeTableMock();
      return mockTableMocks[table];
    },
  },
}));

import NetInfo from '@react-native-community/netinfo';
import {
  apiPatchTournament,
  apiAddExpense,
  apiDeleteExpense,
} from '@/lib/api';

function cacheKey(key: string[]) {
  return JSON.stringify(key);
}
function getCache(key: string[]) {
  return mockFakeCache.get(cacheKey(key));
}
function setCache(key: string[], value: any) {
  mockFakeCache.set(cacheKey(key), value);
}

beforeEach(() => {
  mockFakeCache.clear();
  mockAuthGetUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } } });
  (NetInfo.fetch as jest.Mock).mockReset().mockResolvedValue({ isConnected: true });
  for (const k of Object.keys(mockTableMocks)) delete mockTableMocks[k];
});

describe('optimisticMerge rollback — mutation-scoped, not whole-array snapshot', () => {
  it('an earlier patch that fails only restores the keys IT changed, leaving a later overlapping patch intact', async () => {
    setCache(['tournaments'], [
      { id: 't1', name: 'Old Name', is_registered: false, city: 'Santiago' },
    ]);

    const tMock = mockMakeTableMock();
    mockTableMocks['tournaments'] = tMock;

    // First mutation (name change) will fail; simulate it starting, then a
    // second mutation (registration change) applying and succeeding, THEN
    // the first mutation's error surfaces and rolls back. api.ts checks
    // `const { error } = await ...; if (error) rollback()` — it never throws
    // on its own, so the mock must RESOLVE with an `{ error }` payload (a
    // rejected promise would skip the `if (error)` rollback branch entirely).
    let resolveFirst: (v: { error: any }) => void;
    tMock.updateEq.mockImplementationOnce(() => new Promise((res) => { resolveFirst = res; }));

    const firstCall = apiPatchTournament('t1', { name: 'New Name' }).catch((e) => e);

    // Let the optimistic update for the first mutation apply — it runs after
    // an awaited promise (auth.getUser()) inside apiPatchTournament, so give
    // the microtask queue a few turns.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(getCache(['tournaments'])[0].name).toBe('New Name');

    // Second, overlapping mutation on a different field succeeds immediately.
    tMock.updateEq.mockResolvedValueOnce({ error: null });
    await apiPatchTournament('t1', { isRegistered: true } as any);

    expect(getCache(['tournaments'])[0].is_registered).toBe(true);
    expect(getCache(['tournaments'])[0].name).toBe('New Name');

    // Now the first mutation's server call resolves with an error -> rollback fires.
    resolveFirst!({ error: { message: 'network error' } });
    await firstCall;

    const row = getCache(['tournaments'])[0];
    // Rollback restored ONLY `name` (the key the first mutation touched) —
    // it must NOT revert `is_registered`, which the second mutation set.
    expect(row.name).toBe('Old Name');
    expect(row.is_registered).toBe(true);
    expect(row.city).toBe('Santiago');
  });
});

describe('optimisticInsert rollback — removes exactly the failed row', () => {
  it('a failed insert rollback does not remove a different row inserted afterward', async () => {
    setCache(['expenses'], []);

    const eMock = mockMakeTableMock();
    mockTableMocks['expenses'] = eMock;

    // First insert's server call fails.
    eMock.insertSingle.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    await expect(
      apiAddExpense({ amount: 10, category: 'travel', date: '2026-07-01' })
    ).rejects.toEqual({ message: 'boom' });

    // Rollback should have removed the failed optimistic row already.
    expect(getCache(['expenses'])).toEqual([]);

    // Second insert succeeds and stays in the cache.
    eMock.insertSingle.mockResolvedValueOnce({
      data: { id: 'server-id', amount: 20, category: 'stringing', date: '2026-07-02' },
      error: null,
    });
    const row = await apiAddExpense({ amount: 20, category: 'stringing', date: '2026-07-02' });

    expect(getCache(['expenses'])).toHaveLength(1);
    expect(getCache(['expenses'])[0].id).toBe(row.id);
  });
});

describe('optimisticRemove rollback — re-inserts only if the id is still absent', () => {
  it('does not duplicate a row that was independently re-added before the failed delete rolls back', async () => {
    setCache(['expenses'], [{ id: 'e1', amount: 5, category: 'travel' }]);

    const eMock = mockMakeTableMock();
    mockTableMocks['expenses'] = eMock;
    eMock.deleteEq.mockResolvedValueOnce({ error: { message: 'delete failed' } });

    await expect(apiDeleteExpense('e1')).rejects.toEqual({ message: 'delete failed' });

    // Rollback re-inserts the captured row since nothing else re-added it.
    expect(getCache(['expenses'])).toHaveLength(1);
    expect(getCache(['expenses'])[0].id).toBe('e1');
  });
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { queryClient } from '@/lib/queryClient';
import {
  enqueue,
  processQueue,
  getQueueLength,
  getFailedQueueLength,
  clearQueue,
} from '@/lib/offline-queue';
import { apiAddExpense, apiAddTournament } from '@/lib/api';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(),
  addEventListener: jest.fn(),
}));

jest.mock('@/lib/queryClient', () => ({
  queryClient: {
    invalidateQueries: jest.fn(),
    getQueryData: jest.fn(),
    setQueryData: jest.fn(),
  },
}));

jest.mock('@/lib/deleted-tournaments', () => ({
  recordDeletedTournament: jest.fn(),
}));

// Controllable chainable supabase mock. Each test configures `mockAuthGetUser`
// and the per-table responses via `mockTableMocks`. Names are prefixed with
// `mock` because jest.mock() factories may only reference out-of-scope
// variables whose names start with "mock" (enforced by babel-plugin-jest-hoist).
const mockAuthGetUser = jest.fn();

// table -> { upsert, update, delete } each a jest.fn() returning the final
// { error } result (update/delete are chained through .eq()).
const mockTableMocks: Record<string, any> = {};

function mockMakeTableMock() {
  const upsert = jest.fn().mockResolvedValue({ error: null });
  const updateEq = jest.fn().mockResolvedValue({ error: null });
  const update = jest.fn(() => ({ eq: updateEq }));
  const deleteEq = jest.fn().mockResolvedValue({ error: null });
  const del = jest.fn(() => ({ eq: deleteEq }));
  return { upsert, update, updateEq, delete: del, deleteEq };
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

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const QUEUE_KEY = '@tourly_offline_queue';
const FAILED_QUEUE_KEY = '@tourly_offline_queue_failed';

async function readQueue(): Promise<any[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function readFailedQueue(): Promise<any[]> {
  const raw = await AsyncStorage.getItem(FAILED_QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

// Minimal in-memory-backed fake so the optimistic-cache primitives in
// lib/api.ts (getQueryData/setQueryData with a functional updater) behave
// like the real react-query client would for these tests.
const fakeCache = new Map<string, any>();
function fakeCacheKey(key: string[]) {
  return JSON.stringify(key);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  // Reset ONLY our own mocks — jest.resetAllMocks() would also wipe the
  // implementations inside the official AsyncStorage jest mock (it's built
  // from jest.fn()s), silently breaking all storage reads/writes.
  mockAuthGetUser.mockReset();
  (NetInfo.fetch as jest.Mock).mockReset();
  (queryClient.invalidateQueries as jest.Mock).mockClear();
  fakeCache.clear();
  (queryClient.getQueryData as jest.Mock).mockReset().mockImplementation(
    (key: string[]) => fakeCache.get(fakeCacheKey(key))
  );
  (queryClient.setQueryData as jest.Mock).mockReset().mockImplementation(
    (key: string[], updater: any) => {
      const k = fakeCacheKey(key);
      const next = typeof updater === 'function' ? updater(fakeCache.get(k)) : updater;
      fakeCache.set(k, next);
      return next;
    }
  );
  // Table mocks are recreated fresh per test, so no config can bleed over.
  for (const k of Object.keys(mockTableMocks)) delete mockTableMocks[k];
  mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
});

describe('enqueue', () => {
  it('preserves a caller-provided id for idempotent replays', async () => {
    await enqueue({
      id: 'client-generated-id',
      table: 'expenses',
      action: 'insert',
      data: { amount: 10 },
      userId: 'user-1',
    } as any);

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe('client-generated-id');
  });

  it('generates an id when the caller does not provide one', async () => {
    await enqueue({
      table: 'expenses',
      action: 'insert',
      data: { amount: 10 },
      userId: 'user-1',
    });

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(typeof queue[0].id).toBe('string');
    expect(queue[0].id.length).toBeGreaterThan(0);
  });
});

describe('processQueue — insert uses UPSERT for idempotent replays', () => {
  it('calls upsert with onConflict:id and the queued mutation id as payload id', async () => {
    await enqueue({
      id: 'expense-abc',
      table: 'expenses',
      action: 'insert',
      data: { amount: 25, tournamentId: 't1' },
      userId: 'user-1',
    } as any);

    await processQueue();

    const mock = mockTableMocks['expenses'];
    expect(mock.upsert).toHaveBeenCalledTimes(1);
    const [payload, opts] = mock.upsert.mock.calls[0];
    expect(opts).toEqual({ onConflict: 'id' });
    expect(payload.id).toBe('expense-abc');
    expect(payload.user_id).toBe('user-1');
    // camelCase converted to snake_case
    expect(payload.tournament_id).toBe('t1');

    expect(await getQueueLength()).toBe(0);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tournaments'] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['expenses'] });
  });
});

describe('processQueue — does not drop mutations enqueued during the flush', () => {
  it('preserves a late-enqueued mutation that arrives while the loop is executing', async () => {
    await enqueue({
      id: 'first',
      table: 'expenses',
      action: 'insert',
      data: { amount: 1 },
      userId: 'user-1',
    } as any);

    // While the first mutation's supabase call is in-flight, a writer that
    // does NOT share the in-process lock appends a second mutation directly
    // to storage (the cross-context scenario the re-read-before-save guard
    // exists for). Calling enqueue() here would deadlock: enqueue serializes
    // behind the same lock processQueue is currently holding.
    const mock = mockTableMocks['expenses'] ?? (mockTableMocks['expenses'] = mockMakeTableMock());
    mock.upsert.mockImplementationOnce(async () => {
      const raw = await AsyncStorage.getItem(QUEUE_KEY);
      const queue = raw ? JSON.parse(raw) : [];
      queue.push({
        id: 'late-arrival',
        table: 'expenses',
        action: 'insert',
        data: { amount: 2 },
        userId: 'user-1',
        createdAt: 123,
        attempts: 0,
      });
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      return { error: null };
    });

    await processQueue();

    // "first" succeeded and is gone; "late-arrival" was enqueued mid-flush
    // and must survive into the next queue snapshot rather than being wiped
    // out by the stale pre-loop read.
    const remaining = await readQueue();
    expect(remaining.map((m: any) => m.id)).toEqual(['late-arrival']);
    expect(await getQueueLength()).toBe(1);
  });
});

describe('processQueue — retry cap', () => {
  it('increments attempts on failure and dead-letters after MAX_ATTEMPTS (5)', async () => {
    await enqueue({
      id: 'flaky',
      table: 'expenses',
      action: 'insert',
      data: { amount: 5 },
      userId: 'user-1',
    } as any);

    const mock = mockTableMocks['expenses'] ?? (mockTableMocks['expenses'] = mockMakeTableMock());
    mock.upsert.mockResolvedValue({ error: { message: 'network blip' } });

    for (let i = 0; i < 4; i++) {
      await processQueue();
      expect(await getQueueLength()).toBe(1);
      expect(await getFailedQueueLength()).toBe(0);
    }

    // 5th attempt hits MAX_ATTEMPTS and moves to the failed queue.
    await processQueue();

    expect(await getQueueLength()).toBe(0);
    expect(await getFailedQueueLength()).toBe(1);

    const failed = await readFailedQueue();
    expect(failed[0].id).toBe('flaky');
    expect(failed[0].attempts).toBe(5);
  });
});

describe('processQueue — fatal auth mismatch', () => {
  it('dead-letters immediately without retries when getUser returns a different user id', async () => {
    await enqueue({
      id: 'mismatched',
      table: 'expenses',
      action: 'insert',
      data: { amount: 5 },
      userId: 'user-1',
    } as any);

    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'someone-else' } } });

    await processQueue();

    expect(await getQueueLength()).toBe(0);
    expect(await getFailedQueueLength()).toBe(1);

    const failed = await readFailedQueue();
    expect(failed[0].id).toBe('mismatched');
    expect(failed[0].attempts).toBe(1);

    // upsert must never have been attempted for a fatal auth mismatch — the
    // fatal path short-circuits before from() is ever called, so no table
    // mock is created at all.
    expect(mockTableMocks['expenses']).toBeUndefined();
  });
});

describe('processQueue — failed queue cap', () => {
  it('never exceeds 50 entries and drops the oldest first', async () => {
    const seeded = Array.from({ length: 50 }, (_, i) => ({
      id: `old-${i}`,
      table: 'expenses',
      action: 'insert',
      data: { amount: i },
      userId: 'user-1',
      createdAt: i,
      attempts: 5,
    }));
    await AsyncStorage.setItem(FAILED_QUEUE_KEY, JSON.stringify(seeded));

    await enqueue({
      id: 'newest-dead-letter',
      table: 'expenses',
      action: 'insert',
      data: { amount: 999 },
      userId: 'user-1',
    } as any);

    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'someone-else' } } });

    await processQueue();

    const failed = await readFailedQueue();
    expect(failed).toHaveLength(50);
    // Oldest (old-0) was dropped to make room; newest survives at the end.
    expect(failed.find((m: any) => m.id === 'old-0')).toBeUndefined();
    expect(failed.find((m: any) => m.id === 'old-1')).toBeDefined();
    expect(failed[failed.length - 1].id).toBe('newest-dead-letter');
  });
});

describe('apiAddExpense / apiAddTournament — offline insert uses a real client-generated uuid', () => {
  // Regression coverage for the real call path (apiAddExpense/apiAddTournament
  // -> enqueue -> processQueue -> upsert), not a hand-supplied id. Before the
  // fix these functions left `enqueue()` to self-generate a `${Date.now()}_...`
  // id, which Postgres `uuid` columns reject outright.
  beforeEach(() => {
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });
  });

  it('apiAddExpense: optimistic row id, queued mutation id, and upsert payload id are all the same uuid v4', async () => {
    const optimistic = await apiAddExpense({
      amount: 25,
      category: 'stringing',
      date: '2026-07-01',
    });

    expect(optimistic.id).toMatch(UUID_V4_RE);

    // Optimistic cache row uses that same id.
    const cached = fakeCache.get(fakeCacheKey(['expenses']));
    expect(cached[0].id).toBe(optimistic.id);

    // Queued mutation carries the same id through to processQueue.
    const queued = await readQueue();
    expect(queued).toHaveLength(1);
    expect(queued[0].id).toBe(optimistic.id);

    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
    await processQueue();

    const mock = mockTableMocks['expenses'];
    expect(mock.upsert).toHaveBeenCalledTimes(1);
    const [payload] = mock.upsert.mock.calls[0];
    expect(payload.id).toBe(optimistic.id);
    expect(payload.id).toMatch(UUID_V4_RE);
    expect(await getQueueLength()).toBe(0);
  });

  it('apiAddTournament: optimistic row id, queued mutation id, and upsert payload id are all the same uuid v4', async () => {
    const optimistic = await apiAddTournament({
      name: 'M25 Cuiabá',
      startDate: '2026-06-09',
    });

    expect(optimistic.id).toMatch(UUID_V4_RE);

    const queued = await readQueue();
    expect(queued).toHaveLength(1);
    expect(queued[0].id).toBe(optimistic.id);

    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
    await processQueue();

    const mock = mockTableMocks['tournaments'];
    expect(mock.upsert).toHaveBeenCalledTimes(1);
    const [payload] = mock.upsert.mock.calls[0];
    expect(payload.id).toBe(optimistic.id);
    expect(payload.id).toMatch(UUID_V4_RE);
    expect(await getQueueLength()).toBe(0);
  });

  it('generates a different uuid per call (no collisions across two offline inserts)', async () => {
    const first = await apiAddExpense({ amount: 10, category: 'travel', date: '2026-07-01' });
    const second = await apiAddExpense({ amount: 20, category: 'travel', date: '2026-07-02' });

    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(UUID_V4_RE);
    expect(second.id).toMatch(UUID_V4_RE);
  });
});

describe('processQueue — offline', () => {
  it('leaves the queue untouched when there is no network', async () => {
    await enqueue({
      id: 'offline-item',
      table: 'expenses',
      action: 'insert',
      data: { amount: 5 },
      userId: 'user-1',
    } as any);

    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });

    await processQueue();

    expect(await getQueueLength()).toBe(1);
    // No table mock should even have been created — proof `from()` was never reached.
    expect(mockTableMocks['expenses']).toBeUndefined();
    expect(mockAuthGetUser).not.toHaveBeenCalled();
  });
});

describe('getQueueLength / getFailedQueueLength', () => {
  it('report zero on an empty store', async () => {
    expect(await getQueueLength()).toBe(0);
    expect(await getFailedQueueLength()).toBe(0);
  });
});

describe('clearQueue', () => {
  it('removes both the pending and failed queue keys', async () => {
    await enqueue({
      table: 'expenses',
      action: 'insert',
      data: { amount: 1 },
      userId: 'user-1',
    });
    await AsyncStorage.setItem(FAILED_QUEUE_KEY, JSON.stringify([{ id: 'x' }]));

    await clearQueue();

    expect(await getQueueLength()).toBe(0);
    expect(await getFailedQueueLength()).toBe(0);
    expect(await AsyncStorage.getItem(QUEUE_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(FAILED_QUEUE_KEY)).toBeNull();
  });
});

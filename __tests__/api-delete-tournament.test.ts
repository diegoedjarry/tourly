jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(),
  addEventListener: jest.fn(),
}));

jest.mock('@/lib/queryClient', () => ({
  queryClient: { invalidateQueries: jest.fn(), getQueryData: jest.fn(), setQueryData: jest.fn() },
}));

jest.mock('@/lib/deleted-tournaments', () => ({
  recordDeletedTournament: jest.fn(),
}));

// Controllable chainable supabase mock, mirroring __tests__/offline-queue.test.ts.
// Names are prefixed with `mock` because jest.mock() factories may only
// reference out-of-scope variables whose names start with "mock" (enforced by
// babel-plugin-jest-hoist).
const mockAuthGetUser = jest.fn();
const mockDeleteEq = jest.fn();
const mockDelete = jest.fn(() => ({ eq: mockDeleteEq }));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: any[]) => mockAuthGetUser(...args) },
    from: (_table: string) => ({ delete: mockDelete }),
  },
}));

import { queryClient } from '@/lib/queryClient';
import { recordDeletedTournament } from '@/lib/deleted-tournaments';
import { apiDeleteTournament } from '@/lib/api';
import NetInfo from '@react-native-community/netinfo';

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
  mockDeleteEq.mockResolvedValue({ error: null });
  (queryClient.getQueryData as jest.Mock).mockReturnValue(undefined);
});

describe('apiDeleteTournament — tombstone is written unconditionally', () => {
  it('calls recordDeletedTournament before attempting the server delete, and keeps the tombstone even when the server delete fails', async () => {
    const order: string[] = [];
    (recordDeletedTournament as jest.Mock).mockImplementation(async () => {
      order.push('record');
    });
    mockDeleteEq.mockImplementation(async () => {
      order.push('server-delete');
      return { error: { message: 'server exploded' } };
    });

    await expect(apiDeleteTournament('t1')).rejects.toEqual({ message: 'server exploded' });

    // Tombstone was recorded, and it happened strictly before the server call.
    expect(recordDeletedTournament).toHaveBeenCalledWith('t1');
    expect(order).toEqual(['record', 'server-delete']);

    // The tombstone write is not rolled back just because the server delete failed.
    expect(recordDeletedTournament).toHaveBeenCalledTimes(1);
  });
});

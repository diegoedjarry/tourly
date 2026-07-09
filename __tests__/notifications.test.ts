jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

jest.mock('expo-device', () => ({
  isDevice: true,
}));

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { eas: { projectId: 'test-project' } } },
  easConfig: { projectId: 'test-project' },
}));

const mockScheduleNotificationAsync = jest.fn();
const mockCancelAllScheduledNotificationsAsync = jest.fn();
const mockGetAllScheduledNotificationsAsync = jest.fn();
const mockCancelScheduledNotificationAsync = jest.fn();

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  scheduleNotificationAsync: (...args: any[]) => mockScheduleNotificationAsync(...args),
  cancelAllScheduledNotificationsAsync: (...args: any[]) => mockCancelAllScheduledNotificationsAsync(...args),
  getAllScheduledNotificationsAsync: (...args: any[]) => mockGetAllScheduledNotificationsAsync(...args),
  cancelScheduledNotificationAsync: (...args: any[]) => mockCancelScheduledNotificationAsync(...args),
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

const mockGetDeletedTournamentIds = jest.fn();
jest.mock('@/lib/deleted-tournaments', () => ({
  getDeletedTournamentIds: (...args: any[]) => mockGetDeletedTournamentIds(...args),
  recordDeletedTournament: jest.fn(),
}));

// utils/notifications.ts only imports hooks/useProfile.ts for its exported
// types (ReminderConfig, ReminderTime, etc.), but that module also imports
// @/lib/supabase for runtime use elsewhere, which throws at module-load time
// if EXPO_PUBLIC_SUPABASE_URL/ANON_KEY env vars are unset in the test env.
// Stub it out so the import chain doesn't blow up before any test runs.
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: jest.fn() }, from: jest.fn() },
}));

import {
  rescheduleAllNotifications,
  cancelTournamentNotifications,
  cancelOrphanedNotifications,
} from '@/utils/notifications';

// Minimal tournament fixture. signUpDeadline is a plain future date string;
// buildSpecs() only schedules reminders whose trigger is still in the future
// relative to `now`, so tests control "now" via fake system time.
function makeTournament(id: string, signUpDeadline: string, overrides: Record<string, any> = {}) {
  return {
    id,
    city: `City-${id}`,
    category: 'ITF W15',
    isWithdrawn: false,
    isInMyList: true,
    isRegistered: false,
    signUpDeadline,
    ...overrides,
  };
}

const NO_REMINDERS_PREFS = {
  notify_enabled: true,
  notify_singles: true,
  notify_withdrawal: false,
  notify_freeze: false,
  notify_onsite_enabled: false,
  notify_reminder_config: { singles: ['2d' as const], withdrawal: [], freeze: [] },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCancelAllScheduledNotificationsAsync.mockResolvedValue(undefined);
  mockScheduleNotificationAsync.mockResolvedValue(undefined);
  mockGetAllScheduledNotificationsAsync.mockResolvedValue([]);
  mockCancelScheduledNotificationAsync.mockResolvedValue(undefined);
  mockGetDeletedTournamentIds.mockResolvedValue(new Set());
});

describe('rescheduleAllNotifications — tombstoned tournaments are excluded', () => {
  it('schedules the non-tombstoned tournament and never schedules the tombstoned one', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    mockGetDeletedTournamentIds.mockResolvedValue(new Set(['deleted-1']));

    const tournaments = [
      makeTournament('deleted-1', '2026-01-10'),
      makeTournament('kept-1', '2026-01-10'),
    ];

    await rescheduleAllNotifications(tournaments, NO_REMINDERS_PREFS as any);

    jest.useRealTimers();

    expect(mockScheduleNotificationAsync).toHaveBeenCalled();
    const scheduledTournamentIds = mockScheduleNotificationAsync.mock.calls.map(
      ([arg]: any[]) => arg.content.data.tournamentId
    );
    expect(scheduledTournamentIds).toContain('kept-1');
    expect(scheduledTournamentIds).not.toContain('deleted-1');
  });
});

describe('rescheduleAllNotifications — iOS 64 notification cap', () => {
  it('schedules exactly the 64 soonest-firing notifications out of more than 64 eligible specs', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    // 70 tournaments with strictly increasing signUpDeadlines, all far enough
    // in the future that every generated trigger is still ahead of "now".
    // Each tournament with notify_singles on and no user-configured reminder
    // times still gets the 3 automatic same-day countdown specs (6h/2h/30m
    // before the deadline instant) — that's the only spec source here, and
    // it produces a strict, per-tournament-grouped ordering by trigger time
    // (all of t0's specs precede all of t1's, etc.), which is exactly what
    // "soonest N" selection needs to preserve across the 70*3 = 210 total.
    const tournaments = Array.from({ length: 70 }, (_, i) => {
      const day = 10 + i; // 2026-01-10, 2026-01-11, ...
      return makeTournament(`t${i}`, `2026-01-${String(day).padStart(2, '0')}`);
    });

    const prefs = {
      ...NO_REMINDERS_PREFS,
      notify_reminder_config: { singles: [], withdrawal: [], freeze: [] },
    };

    await rescheduleAllNotifications(tournaments, prefs as any);

    jest.useRealTimers();

    // 64 is not a multiple of 3, so the cutoff lands mid-tournament: the
    // first 21 tournaments (63 specs) are fully included, plus the single
    // soonest-firing spec of the 22nd tournament (t21's earliest of its 3).
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(64);

    const scheduledIds = mockScheduleNotificationAsync.mock.calls.map(
      ([arg]: any[]) => arg.content.data.tournamentId as string
    );
    for (let i = 0; i < 21; i++) {
      expect(scheduledIds.filter((id) => id === `t${i}`)).toHaveLength(3);
    }
    expect(scheduledIds.filter((id) => id === 't21')).toHaveLength(1);
    for (let i = 22; i < 70; i++) {
      expect(scheduledIds).not.toContain(`t${i}`);
    }

    // Triggers passed to scheduleNotificationAsync must be in ascending order.
    const triggerTimes = mockScheduleNotificationAsync.mock.calls.map(
      ([arg]: any[]) => new Date(arg.trigger.date).getTime()
    );
    const sorted = [...triggerTimes].sort((a, b) => a - b);
    expect(triggerTimes).toEqual(sorted);
  });
});

describe('cancelOrphanedNotifications', () => {
  it('cancels a tombstoned id even when present in validTournamentIds, spares a valid id, and spares an entry with no tournamentId', async () => {
    mockGetDeletedTournamentIds.mockResolvedValue(new Set(['tombstoned-1']));
    mockGetAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'notif-tombstoned', content: { data: { tournamentId: 'tombstoned-1' } } },
      { identifier: 'notif-valid', content: { data: { tournamentId: 'valid-1' } } },
      { identifier: 'notif-no-id', content: { data: {} } },
    ]);

    await cancelOrphanedNotifications(new Set(['tombstoned-1', 'valid-1']));

    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('notif-tombstoned');
    expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalledWith('notif-valid');
    expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalledWith('notif-no-id');
  });
});

describe('cancelTournamentNotifications — serialized against an in-flight reschedule', () => {
  it('runs its cancellations strictly after a concurrently-started rescheduleAllNotifications completes', async () => {
    const callOrder: string[] = [];

    // Block the in-flight reschedule's scheduling call until we explicitly
    // release it, so we can start cancelTournamentNotifications while
    // rescheduleAllNotifications is still mid-flight.
    let releaseSchedule: () => void;
    const scheduleGate = new Promise<void>((resolve) => { releaseSchedule = resolve; });

    mockScheduleNotificationAsync.mockImplementation(async () => {
      callOrder.push('schedule');
      await scheduleGate;
    });
    mockGetAllScheduledNotificationsAsync.mockImplementation(async () => {
      callOrder.push('getAll-for-cancel');
      return [{ identifier: 'notif-1', content: { data: { tournamentId: 'tourney-1' } } }];
    });
    mockCancelScheduledNotificationAsync.mockImplementation(async (id: string) => {
      callOrder.push(`cancel:${id}`);
    });

    const tournaments = [makeTournament('tourney-1', '2099-01-10')];

    const reschedulePromise = rescheduleAllNotifications(tournaments, NO_REMINDERS_PREFS as any);
    // Give rescheduleAllNotifications a chance to reach the blocked schedule call.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const cancelPromise = cancelTournamentNotifications('tourney-1');

    // Release the blocked schedule call so rescheduleAllNotifications can finish.
    releaseSchedule!();

    await Promise.all([reschedulePromise, cancelPromise]);

    const firstCancelIndex = callOrder.findIndex((c) => c.startsWith('cancel:'));
    const lastScheduleIndex = callOrder.lastIndexOf('schedule');
    const getAllForCancelIndex = callOrder.indexOf('getAll-for-cancel');

    // Everything from the reschedule (including its last schedule call) must
    // have happened before cancelTournamentNotifications reads the scheduled
    // list or issues its cancel — proving the shared queue serializes them
    // rather than letting them interleave.
    expect(lastScheduleIndex).toBeLessThan(getAllForCancelIndex);
    expect(getAllForCancelIndex).toBeLessThan(firstCancelIndex);
  });
});

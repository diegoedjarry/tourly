import AsyncStorage from '@react-native-async-storage/async-storage';

// Tombstones for deletes that may not have reached the server yet (offline queue).
// A refetch landing before the queued delete flushes returns the "deleted" row —
// callers filter it out here so notifications/UI don't resurrect it.
const STORAGE_KEY = '@tourly_deleted_tournaments';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function prune(map: Record<string, number>): Record<string, number> {
  const cutoff = Date.now() - MAX_AGE_MS;
  const out: Record<string, number> = {};
  for (const [id, deletedAt] of Object.entries(map)) {
    if (deletedAt >= cutoff) out[id] = deletedAt;
  }
  return out;
}

// Serialize reads/writes: concurrent multi-delete loops read-modify-write the
// same AsyncStorage key, and unserialized calls can lose entries to a race.
let chain: Promise<void> = Promise.resolve();

export async function recordDeletedTournament(id: string): Promise<void> {
  chain = chain.catch(() => {}).then(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const map = prune(raw ? JSON.parse(raw) : {});
      map[id] = Date.now();
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
      // Best-effort — a failed tombstone write must never break the delete itself.
    }
  });
  return chain;
}

export async function getDeletedTournamentIds(): Promise<Set<string>> {
  chain = chain.catch(() => {}).then(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const pruned = prune(JSON.parse(raw));
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
    } catch {
      // Ignore — read below falls back to an empty set on error.
    }
  });
  await chain;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return new Set(Object.keys(raw ? prune(JSON.parse(raw)) : {}));
  } catch {
    return new Set();
  }
}

// Sign-out cleanup: wipe tombstones so they can't leak into the next user's
// session on a shared device. Serialized through the same chain as
// recordDeletedTournament/getDeletedTournamentIds to avoid racing an
// in-flight read-modify-write.
export function clearDeletedTournaments(): Promise<void> {
  chain = chain.catch(() => {}).then(async () => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      // Best-effort — a failed clear must never block sign-out.
    }
  });
  return chain;
}

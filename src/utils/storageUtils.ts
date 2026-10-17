import { get, set, del } from 'idb-keyval';

export { get, set, del };

export function getStorageKey(email?: string | null): string {
  const norm = (email || 'guest').toLowerCase().trim();
  return `health_app_data_${norm}`;
}

export function getSnapshotKey(email?: string | null): string {
  const norm = (email || 'guest').toLowerCase().trim();
  return `health_app_snapshots_${norm}`;
}

export async function safeIdbSet(key: string, value: any): Promise<void> {
  try {
    await set(key, value);
  } catch (err) {
    console.warn(`[storageUtils] safeIdbSet error for key "${key}":`, err);
    try {
      pruneLocalStorageToFreeSpace();
      localStorage.setItem(key, JSON.stringify(value));
    } catch (localErr) {
      console.error(`[storageUtils] Fallback localStorage write failed for "${key}":`, localErr);
    }
  }
}

export function pruneLocalStorageToFreeSpace(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('temp_') || k.startsWith('cache_') || k.includes('_debug_preview_'))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {
    console.warn('[storageUtils] Failed during localStorage prune:', e);
  }
}

export async function safeSaveToLocalStorage(key: string, data: any): Promise<void> {
  try {
    // Count durability (ALWAYS_COUNT_FALLBACK): a bundle save without a
    // total must never wipe a previously persisted good total — every
    // remount re-reads this value, and losing it pins history to a few
    // pages until a lucky pull.
    const merged = await preserveBundleFoodTotalStored(key, data);
    // Save to IndexedDB first
    await set(key, merged);
    // Also mirror to localStorage if space permits
    try {
      localStorage.setItem(key, JSON.stringify(merged));
    } catch (e: any) {
      if (e?.name === 'QuotaExceededError') {
        pruneLocalStorageToFreeSpace();
        try {
          localStorage.setItem(key, JSON.stringify(merged));
        } catch {
          // Keep in IDB only
        }
      }
    }
  } catch (err) {
    console.error(`[storageUtils] Error saving data for key "${key}":`, err);
  }
}

/**
 * Carry over a previously stored meal total when the incoming bundle does
 * not bring one. Only applies to app-data bundles (foodLogs array present);
 * a bundle that already carries a positive total always wins, and a missing
 * stored total changes nothing. Pure (IDB read happens in the caller).
 */
export function preserveBundleFoodTotal(incoming: any, stored: any): any {
  if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.foodLogs)) return incoming;
  const incomingTotal = incoming.totalFoodsCount;
  if (typeof incomingTotal === 'number' && incomingTotal > 0) return incoming;
  const storedTotal = stored && typeof stored === 'object' ? stored.totalFoodsCount : undefined;
  if (typeof storedTotal === 'number' && storedTotal > 0) {
    return { ...incoming, totalFoodsCount: storedTotal };
  }
  return incoming;
}

async function preserveBundleFoodTotalStored(key: string, data: any): Promise<any> {
  if (!data || typeof data !== 'object' || !Array.isArray(data.foodLogs)) return data;
  if (typeof data.totalFoodsCount === 'number' && data.totalFoodsCount > 0) return data;
  try {
    const stored = await get(key);
    return preserveBundleFoodTotal(data, stored);
  } catch {
    return data;
  }
}

/**
 * Highest known meal total across live state and the stored bundle.
 * The live value wins ties-or-better; a stored good value heals a missing
 * live one. Returns undefined when neither side knows a positive total.
 * Used to persist the max so remounts never regress (ALWAYS_COUNT_FALLBACK).
 */
export function healedBundleTotal(liveTotal: unknown, storedTotal: unknown): number | undefined {
  const live = typeof liveTotal === 'number' && liveTotal > 0 ? Math.floor(liveTotal) : 0;
  const stored = typeof storedTotal === 'number' && storedTotal > 0 ? Math.floor(storedTotal) : 0;
  const best = Math.max(live, stored);
  return best > 0 ? best : undefined;
}

export async function getAggregatedAppData(email?: string | null): Promise<any> {
  const key = getStorageKey(email);
  try {
    // Try IndexedDB first
    const idbData = await get(key);
    if (idbData && typeof idbData === 'object') {
      return idbData;
    }
    // Fall back to localStorage
    const localRaw = localStorage.getItem(key);
    if (localRaw) {
      const parsed = JSON.parse(localRaw);
      // Backfill to IDB
      set(key, parsed).catch(() => {});
      return parsed;
    }
  } catch (err) {
    console.warn(`[storageUtils] Error reading app data for "${email}":`, err);
    try {
      const localRaw = localStorage.getItem(key);
      if (localRaw) return JSON.parse(localRaw);
    } catch {}
  }
  return null;
}

export async function clearCachedAppData(email?: string | null): Promise<void> {
  const key = getStorageKey(email);
  try {
    await del(key);
  } catch {}
  try {
    localStorage.removeItem(key);
  } catch {}
}

export const CHAT_MEMORY_PREFIXES = [
  'chat_memory_',
  'chatStorage_',
  'payloadStorage_',
  'last_sent_payload_',
  'active_session_id_',
  'jobstore_',
  'chat_messages_',
];

export function clearChatMemoryKeys(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && CHAT_MEMORY_PREFIXES.some(prefix => k.startsWith(prefix))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {
    console.warn('[storageUtils] Failed to clear chat memory keys:', e);
  }
}

export interface LocalSnapshot {
  id: string;
  label: string;
  timestamp: string;
  data: any;
}

export async function loadLocalSnapshots(email?: string | null): Promise<LocalSnapshot[]> {
  const key = getSnapshotKey(email);
  try {
    const idbSnaps = await get(key);
    if (Array.isArray(idbSnaps)) return idbSnaps;
    const localRaw = localStorage.getItem(key);
    if (localRaw) {
      const parsed = JSON.parse(localRaw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('[storageUtils] loadLocalSnapshots error:', err);
  }
  return [];
}

export async function saveLocalSnapshot(label: string, email: string | undefined | null, data: any): Promise<void> {
  const key = getSnapshotKey(email);
  const snapshots = await loadLocalSnapshots(email);
  const newSnap: LocalSnapshot = {
    id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    label,
    timestamp: new Date().toISOString(),
    data
  };
  // Keep last 15 snapshots
  const updated = [newSnap, ...snapshots].slice(0, 15);
  try {
    await set(key, updated);
  } catch {}
  try {
    localStorage.setItem(key, JSON.stringify(updated));
  } catch {}
}

export async function deleteLocalSnapshot(email: string | undefined | null, snapshotId: string): Promise<void> {
  const key = getSnapshotKey(email);
  const snapshots = await loadLocalSnapshots(email);
  const filtered = snapshots.filter(s => s.id !== snapshotId);
  try {
    await set(key, filtered);
  } catch {}
  try {
    localStorage.setItem(key, JSON.stringify(filtered));
  } catch {}
}

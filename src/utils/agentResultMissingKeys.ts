// Missing-keys localStorage helpers (moved verbatim out of AgentResultTable grid).
// Key format and swallow-quota-errors semantics preserved exactly.

const missingKeysStorageKey = (batchIdx: unknown): string | null => {
  if (batchIdx !== undefined && batchIdx !== null) {
    return `batch_${batchIdx}_missing_keys_to_move`;
  }
  return null;
};

export function readMissingKeys(batchIdx: unknown): string[] {
  try {
    const key = missingKeysStorageKey(batchIdx);
    if (key) {
      const saved = localStorage.getItem(key);
      if (saved) return JSON.parse(saved);
    }
  } catch (e) {}
  return [];
}

export function hasSavedMissingKeys(batchIdx: unknown): boolean {
  try {
    const key = missingKeysStorageKey(batchIdx);
    if (key) {
      // Preserve the exact `if (!saved)` truthiness the grid effect relied on.
      return !!localStorage.getItem(key);
    }
  } catch (e) {}
  return false;
}

export function writeMissingKeys(batchIdx: unknown, keys: string[]): void {
  try {
    const key = missingKeysStorageKey(batchIdx);
    if (key) {
      localStorage.setItem(key, JSON.stringify(keys));
    }
  } catch (e) {}
}

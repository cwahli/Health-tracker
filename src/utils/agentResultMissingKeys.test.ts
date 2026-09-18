import { describe, it, expect, beforeEach } from 'vitest';

import {
  readMissingKeys,
  hasSavedMissingKeys,
  writeMissingKeys,
} from './agentResultMissingKeys';

// Same convention as creditManager.test.ts: localStorage isn't a global here.
if (typeof (globalThis as any).localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('missing-keys storage (batch_<idx>_missing_keys_to_move)', () => {
  it('round-trips keys for a batchIdx', () => {
    writeMissingKeys(3, ['hdl', 'ldl']);
    expect(readMissingKeys(3)).toEqual(['hdl', 'ldl']);
    expect(hasSavedMissingKeys(3)).toBe(true);
  });

  it('returns [] / false when nothing saved', () => {
    expect(readMissingKeys(7)).toEqual([]);
    expect(hasSavedMissingKeys(7)).toBe(false);
  });

  it('ignores undefined/null batchIdx without throwing', () => {
    expect(() => writeMissingKeys(undefined, ['x'])).not.toThrow();
    expect(readMissingKeys(null)).toEqual([]);
    expect(hasSavedMissingKeys(undefined)).toBe(false);
  });

  it('swallows quota errors like the grid did', () => {
    const orig = localStorage.setItem;
    (localStorage as any).setItem = () => {
      throw new Error('quota');
    };
    try {
      expect(() => writeMissingKeys(1, ['x'])).not.toThrow();
    } finally {
      (localStorage as any).setItem = orig;
    }
  });

  it('returns [] on corrupt JSON but still reports saved', () => {
    localStorage.setItem('batch_9_missing_keys_to_move', 'not-json{{{');
    expect(readMissingKeys(9)).toEqual([]);
    expect(hasSavedMissingKeys(9)).toBe(true);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  STORES,
  appendRow,
  retrieve,
  healthCheck,
  noteFalseFire,
  falseFireCounts,
} from '../scripts/lib/memory-stores.mjs';

let home;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'memstores-'));
});

function seedUserMemory() {
  const memDir = path.join(home, '.hermes', 'memories');
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(memDir, 'USER.md'), 'Cwah Li. Short replies.');
  fs.writeFileSync(path.join(memDir, 'MEMORY.md'), 'Live site is https://health-tracking.duckdns.org.');
}

describe('appendRow', () => {
  it('stores a row per store with id and timestamp', () => {
    for (const store of STORES) {
      const row = appendRow(store, { ticket: 'T-1', text: `note for ${store}` }, { home });
      expect(row.id).toMatch(/^m/);
      expect(row.createdAt).toBeTruthy();
    }
  });

  it('rejects unknown stores and empty or over-cap text', () => {
    expect(() => appendRow('nope', { text: 'x' }, { home })).toThrow(/unknown memory store/);
    expect(() => appendRow('facts', { text: '  ' }, { home })).toThrow(/empty text/);
    expect(() => appendRow('facts', { text: 'x'.repeat(501) }, { home })).toThrow(/exceeds 500/);
  });
});

describe('retrieve', () => {
  it('gates every turn except build/investigate/decide', () => {
    appendRow('facts', { ticket: 'BUG-9', text: 'omega rounding lives in formatValue' }, { home });
    for (const turn of ['chat', 'status', '', 'BUILD']) {
      const r = retrieve('BUG-9 omega', { turn, home });
      expect(r.gated).toBe(true);
      expect(r.rows).toEqual([]);
    }
    for (const turn of ['build', 'investigate', 'decide']) {
      const r = retrieve('BUG-9 omega', { turn, home });
      expect(r.gated).toBe(false);
      expect(r.rows.length).toBe(1);
    }
  });

  it('ranks lexical overlap and drops zero-score rows', () => {
    appendRow('decisions', { ticket: 'BUG-1', text: 'retry once on depleted model then stop' }, { home });
    appendRow('dead-ends', { ticket: 'BUG-2', text: 'cline long think with no diff is failure' }, { home });
    const r = retrieve('BUG-1 depleted model retry', { turn: 'decide', home });
    expect(r.rows[0].store).toBe('decisions');
    expect(r.rows.length).toBe(2);
  });

  it('respects the row limit', () => {
    for (let i = 0; i < 4; i++) {
      appendRow('facts', { ticket: `T-${i}`, text: 'shared omega token' }, { home });
    }
    const r = retrieve('shared omega token', { turn: 'build', limit: 2, home });
    expect(r.rows.length).toBe(2);
  });
});

describe('false fires', () => {
  it('counts misses per store and total', () => {
    expect(falseFireCounts({ home }).total).toBe(0);
    noteFalseFire('decisions', { home });
    noteFalseFire('decisions', { count: 2, home });
    noteFalseFire('facts', { home });
    const c = falseFireCounts({ home });
    expect(c.total).toBe(4);
    expect(c.byStore).toEqual({ decisions: 3, facts: 1 });
  });
});

describe('healthCheck', () => {
  it('passes a seeded home and receipts the gaps', () => {
    const empty = healthCheck({ home });
    expect(empty.ok).toBe(false);
    expect(empty.receipts.some((r) => r.kind === 'missing')).toBe(true);

    seedUserMemory();
    for (const store of STORES) {
      appendRow(store, { text: 'seed' }, { home });
    }
    const ok = healthCheck({ home });
    expect(ok).toEqual({ ok: true, receipts: [] });
  });

  it('receipts over-cap USER.md', () => {
    seedUserMemory();
    fs.writeFileSync(path.join(home, '.hermes', 'memories', 'USER.md'), 'x'.repeat(1376));
    const res = healthCheck({ home });
    expect(res.ok).toBe(false);
    expect(res.receipts.some((r) => r.kind === 'over-cap')).toBe(true);
  });
});

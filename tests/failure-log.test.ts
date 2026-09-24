import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildFailure,
  recordFailure,
  loadFailures,
  groupFailures,
  failureLogPath,
} from '../scripts/lib/failure-log.mjs';

let log;
const OLD_ENV = process.env.BOT_FAILURE_LOG;

beforeEach(() => {
  log = path.join(os.tmpdir(), `faillog_${Date.now()}_${Math.random().toString(36).slice(2)}.jsonl`);
  process.env.BOT_FAILURE_LOG = log;
});

describe('buildFailure', () => {
  it('caps kind and hint at 160 chars with sane defaults', () => {
    const row = buildFailure({ lane: 'opencode', kind: 'x'.repeat(200), hint: 'y'.repeat(200) });
    expect(row.kind.length).toBe(160);
    expect(row.hint.length).toBe(160);
    expect(row.at).toBeTruthy();
    expect(buildFailure().kind).toBe('unknown');
  });
});

describe('recordFailure / loadFailures roundtrip', () => {
  it('appends one JSON row per line', () => {
    expect(recordFailure({ lane: 'opencode', kind: 'funds', hint: 'depleted' })).toBe(true);
    expect(recordFailure({ lane: 'cline', kind: 'stall', hint: 'no diff' })).toBe(true);
    const rows = loadFailures();
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ lane: 'opencode', kind: 'funds' });
  });

  it('skips corrupt lines without dying', () => {
    fs.writeFileSync(log, 'not json\n');
    recordFailure({ kind: 'funds' });
    expect(loadFailures().length).toBe(1);
  });

  it('returns empty on a missing log and false when disabled', () => {
    expect(loadFailures('/nonexistent/path.jsonl')).toEqual([]);
    process.env.BOT_FAILURE_LOG = '0';
    expect(failureLogPath()).toBeNull();
    expect(recordFailure({ kind: 'x' })).toBe(false);
    process.env.BOT_FAILURE_LOG = OLD_ENV;
  });
});

describe('groupFailures', () => {
  it('groups by kind with counts, lanes, and first/last', () => {
    recordFailure({ lane: 'opencode', kind: 'funds', hint: 'first', at: '2026-09-24T10:00:00.000Z' });
    recordFailure({ lane: 'grok', kind: 'funds', hint: 'second', at: '2026-09-24T11:00:00.000Z' });
    recordFailure({ lane: 'cline', kind: 'stall', hint: 'stuck', at: '2026-09-24T12:00:00.000Z' });
    const groups = groupFailures(loadFailures());
    expect(groups.length).toBe(2);
    expect(groups[0]).toMatchObject({
      kind: 'funds', count: 2, first: '2026-09-24T10:00:00.000Z', last: '2026-09-24T11:00:00.000Z',
    });
    expect(groups[0].lanes).toEqual({ opencode: 1, grok: 1 });
  });

  it('flags repeats at threshold 2', () => {
    recordFailure({ kind: 'funds', at: '2026-09-24T10:00:00.000Z' });
    recordFailure({ kind: 'funds', at: '2026-09-24T11:00:00.000Z' });
    recordFailure({ kind: 'once', at: '2026-09-24T12:00:00.000Z' });
    const groups = groupFailures(loadFailures());
    const learn = groups.filter((g) => g.count >= 2);
    const watch = groups.filter((g) => g.count < 2);
    expect(learn.map((g) => g.kind)).toEqual(['funds']);
    expect(watch.map((g) => g.kind)).toEqual(['once']);
  });
});

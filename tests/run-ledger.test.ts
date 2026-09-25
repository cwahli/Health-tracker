import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildOutcome,
  signatureOf,
  loadLedger,
  countSignature,
  checkDuplicate,
  recordOutcome,
} from '../scripts/lib/run-ledger.mjs';

let ledger;
let failures;
let errorLog;

beforeEach(() => {
  ledger = path.join(os.tmpdir(), `runledger_${Date.now()}_${Math.random().toString(36).slice(2)}.jsonl`);
  failures = path.join(os.tmpdir(), `runledger_fail_${Date.now()}_${Math.random().toString(36).slice(2)}.jsonl`);
  errorLog = path.join(os.tmpdir(), `runledger_errors_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  process.env.RUN_LEDGER = ledger;
  process.env.BOT_FAILURE_LOG = failures;
  process.env.BOT_ERROR_LOG = errorLog;
});

const base = {
  ticket: 'BUG-15',
  surface: 'orchestrator',
  provider: 'opencode',
  model: 'opencode/deepseek-v4.1-flash',
  defectClass: 'STALE_TURN|jobPreview|2026-W39',
};

function failureRows() {
  try {
    return fs.readFileSync(failures, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

describe('buildOutcome / signatureOf', () => {
  it('defaults tokens and wall-clock to null and stamps time', () => {
    const row = buildOutcome({ ...base, outcome: 'committed' });
    expect(row.tokens).toBeNull();
    expect(row.wallClockMs).toBeNull();
    expect(row.at).toBeTruthy();
  });

  it('keeps numeric tokens and wall-clock when provided', () => {
    const row = buildOutcome({ ...base, outcome: 'committed', tokens: 1200, wallClockMs: 61000 });
    expect(row.tokens).toBe(1200);
    expect(row.wallClockMs).toBe(61000);
  });

  it('signature is stable and covers every identity field', () => {
    expect(signatureOf(base)).toBe(signatureOf({ ...base }));
    for (const field of ['ticket', 'surface', 'provider', 'model', 'defectClass']) {
      expect(signatureOf({ ...base, [field]: 'other' })).not.toBe(signatureOf(base));
    }
  });

  it('signature ignores outcome, tokens, and wall-clock', () => {
    expect(signatureOf({ ...base, outcome: 'escalated', tokens: 5, wallClockMs: 9 }))
      .toBe(signatureOf({ ...base, outcome: 'committed' }));
  });
});

describe('recordOutcome / checkDuplicate', () => {
  it('first row has priorCount 0; repeat is duplicate', () => {
    const r1 = recordOutcome({ ...base, outcome: 'committed' });
    expect(r1.written).toBe(true);
    expect(r1.priorCount).toBe(0);

    const gate = checkDuplicate(base);
    expect(gate.duplicate).toBe(true);
    expect(gate.priorCount).toBe(1);
    expect(gate.signature).toBe(r1.signature);
  });

  it('different ticket is not a duplicate', () => {
    recordOutcome({ ...base, outcome: 'committed' });
    expect(checkDuplicate({ ...base, ticket: 'BUG-16' }).duplicate).toBe(false);
  });

  it('corrupt lines are skipped, valid rows still count', () => {
    fs.writeFileSync(ledger, 'not json\n');
    recordOutcome({ ...base, outcome: 'committed' });
    expect(loadLedger().length).toBe(1);
    expect(countSignature(signatureOf(base))).toBe(1);
  });

  it('failure outcomes feed bot-failures.jsonl; success does not', () => {
    recordOutcome({ ...base, outcome: 'committed' });
    expect(failureRows()).toEqual([]);
    recordOutcome({ ...base, outcome: 'escalated' });
    const rows = failureRows();
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe('dispatch:escalated');
    expect(rows[0].hint).toContain('BUG-15');
  });

  it('failure outcomes open error-log records; later success auto-closes', async () => {
    const { listErrors } = await import('../scripts/lib/error-log.mjs');
    recordOutcome({ ...base, outcome: 'escalated' });
    let open = listErrors({ status: 'open' });
    expect(open.length).toBe(1);
    expect(open[0].kind).toBe('dispatch:escalated');
    recordOutcome({ ...base, outcome: 'escalated' });
    open = listErrors({ status: 'open' });
    expect(open.length).toBe(1);
    expect(open[0].count).toBe(2);
    recordOutcome({ ...base, outcome: 'committed' });
    open = listErrors({ status: 'open' });
    expect(open).toEqual([]);
    const closed = listErrors({ status: 'closed' });
    expect(closed.length).toBe(1);
    expect(closed[0].closedBy).toBe('auto:clean-run');
  });

  it('disabled ledger never writes and never throws', () => {
    process.env.RUN_LEDGER = '0';
    const res = recordOutcome({ ...base, outcome: 'committed' });
    expect(res.written).toBe(false);
    expect(checkDuplicate(base).priorCount).toBe(0);
  });
});

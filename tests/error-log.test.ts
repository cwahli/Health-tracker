import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  errorId,
  classifyErrorKind,
  evaluateRecovery,
  recordError,
  recordRecoveryAttempt,
  closeError,
  noteHealthy,
  listErrors,
  getErrors,
} from '../scripts/lib/error-log.mjs';

const OLD_ENV = process.env.BOT_ERROR_LOG;
let log: string;

beforeEach(() => {
  log = path.join(os.tmpdir(), `errorlog_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  process.env.BOT_ERROR_LOG = log;
});

afterEach(() => {
  if (OLD_ENV === undefined) delete process.env.BOT_ERROR_LOG;
  else process.env.BOT_ERROR_LOG = OLD_ENV;
  try { fs.unlinkSync(log); } catch {}
});

describe('errorId / classifyErrorKind', () => {
  it('is stable and covers kind+lane+bot', () => {
    expect(errorId({ kind: 'quota', lane: 'cline', bot: 'vm' })).toBe(
      errorId({ kind: 'quota', lane: 'cline', bot: 'vm' }));
    expect(errorId({ kind: 'quota', lane: 'cline', bot: 'vm' })).not.toBe(
      errorId({ kind: 'timeout', lane: 'cline', bot: 'vm' }));
    expect(errorId({ kind: 'quota', lane: 'cline', bot: 'vm' })).toMatch(/^[0-9a-f]{12}$/);
  });

  it('classifies the real Cline daily-cap envelope as quota', () => {
    expect(classifyErrorKind('{"error":{"code":"INFERENCE_CAP_ERROR","message":"Error 429: Daily free limit reached on model meta/muse-spark-1.3-contributor. Try again in 22h 46m"}}')).toBe('quota');
    expect(classifyErrorKind('Rate limit exceeded, retry later')).toBe('quota');
    expect(classifyErrorKind('timed out after 120000ms')).toBe('timeout');
    expect(classifyErrorKind('aborted')).toBe('aborted');
    expect(classifyErrorKind('Unauthorized: invalid api key')).toBe('auth');
    expect(classifyErrorKind('spawn cline ENOENT')).toBe('missing-tool');
    expect(classifyErrorKind('provider returned 503')).toBe('provider-5xx');
    expect(classifyErrorKind('Telegram 409 Conflict: another poller is active')).toBe('poller-conflict');
    expect(classifyErrorKind('')).toBe('unknown');
    expect(classifyErrorKind('weird new failure')).toBe('run-failed');
  });
});

describe('record lifecycle', () => {
  it('opens, bumps count, and keeps history', () => {
    const first = recordError({ lane: 'cline', bot: 'vm', raw: 'Error 429 quota' });
    expect(first?.status).toBe('open');
    expect(first?.count).toBe(1);
    expect(first?.kind).toBe('quota');
    const second = recordError({ lane: 'cline', bot: 'vm', raw: 'Error 429 quota again' });
    expect(second?.id).toBe(first?.id);
    expect(second?.status).toBe('open');
    expect(second?.count).toBe(2);
  });

  it('recovery attempt parks in recovering, ok closes with auto rule', () => {
    const rec = recordError({ lane: 'cline', bot: 'vm', raw: '429' });
    const pending = recordRecoveryAttempt(rec?.id, { rule: 'failover-to-next-lane', ok: false });
    expect(pending?.status).toBe('recovering');
    const done = recordRecoveryAttempt(rec?.id, { rule: 'failover-to-next-lane', ok: true });
    expect(done?.status).toBe('closed');
    expect(done?.closedBy).toBe('auto:failover-to-next-lane');
  });

  it('manual close and unknown ids', () => {
    const rec = recordError({ lane: 'opencode', bot: 'vm', raw: 'boom' });
    expect(closeError(rec?.id, { by: 'operator' })?.closedBy).toBe('operator');
    expect(closeError('deadbeefcafe')).toBeNull();
    expect(recordRecoveryAttempt('deadbeefcafe', { ok: true })).toBeNull();
  });

  it('noteHealthy closes the lane, kind-scoped when given', () => {
    recordError({ lane: 'cline', bot: 'vm', raw: '429' });
    recordError({ lane: 'cline', bot: 'vm', raw: 'timed out after 9ms' });
    recordError({ lane: 'opencode', bot: 'vm', raw: '429' });
    const closedQuota = noteHealthy({ lane: 'cline', bot: 'vm', kind: 'quota' });
    expect(closedQuota.length).toBe(1);
    expect(listErrors({ status: 'open' }).length).toBe(2);
    const closedRest = noteHealthy({ lane: 'cline', bot: 'vm' });
    expect(closedRest.length).toBe(1);
    expect(closedRest[0].closedBy).toBe('auto:clean-run');
    expect(listErrors({ status: 'open' }).length).toBe(1);
  });

  it('persists across reads and never throws when disabled', () => {
    recordError({ lane: 'cline', bot: 'vm', raw: '429' });
    expect(Object.keys(getErrors()).length).toBe(1);
    process.env.BOT_ERROR_LOG = '0';
    expect(recordError({ lane: 'x', raw: 'y' })).toBeNull();
    expect(noteHealthy({ lane: 'x' })).toEqual([]);
    expect(listErrors()).toEqual([]);
  });
});

describe('evaluateRecovery', () => {
  it('auto rules for quota/5xx/poller, manual for the rest', () => {
    expect(evaluateRecovery({ kind: 'quota' })).toMatchObject({ action: 'failover-to-next-lane', auto: true });
    expect(evaluateRecovery({ kind: 'provider-5xx' }).auto).toBe(true);
    expect(evaluateRecovery({ kind: 'poller-conflict' }).auto).toBe(true);
    expect(evaluateRecovery({ kind: 'timeout' })).toMatchObject({ action: 'retry-with-smaller-ask', auto: false });
    expect(evaluateRecovery({ kind: 'auth' }).auto).toBe(false);
    expect(evaluateRecovery({ kind: 'whatever' }).auto).toBe(false);
  });
});

describe('errorlog.mjs CLI', () => {
  const cli = (args: string[]) =>
    execFileSync(process.execPath, ['scripts/errorlog.mjs', ...args], {
      encoding: 'utf8',
      env: { ...process.env, BOT_ERROR_LOG: log },
    });

  it('list → check(1) → close → check(0) → report', () => {
    const rec = recordError({ lane: 'cline', bot: 'vm', raw: 'Error 429 quota' });
    expect(cli(['list'])).toContain(rec?.id);
    expect(() => cli(['check'])).toThrow();
    expect(cli(['close', `--id=${rec?.id}`])).toContain('closed');
    expect(cli(['check'])).toContain('clean');
    const report = cli(['report']);
    expect(report).toContain('# Bot error log');
    expect(report).toContain(rec?.id);
    expect(report).toContain('manual');
  });
});

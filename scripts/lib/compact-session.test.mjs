import { describe, it, expect } from 'vitest';

import {
  compactSession,
  countContextEntries,
  formatCompactEmpty,
  formatCompactFailure,
  formatCompactReceipt,
  latestCompaction,
  summarizeCompactionTokens,
} from './compact-session.mjs';
import { buildApiArgs, cleanApiError } from './opencode-api.mjs';

const SID = 'ses_efb841f26ffeb0o2KzifgdB0uB';

/** Shapes copied off a live session, not invented. */
const CONTEXT_BEFORE = [
  { type: 'user', id: 'msg_1' },
  { type: 'assistant', id: 'msg_2', tokens: { input: 15385, output: 1, reasoning: 18, cache: { read: 1914, write: 0 } } },
  { type: 'user', id: 'msg_3' },
  { type: 'assistant', id: 'msg_4' },
  { type: 'user', id: 'msg_5' },
  { type: 'idle', id: 'msg_6' },
];

const CONTEXT_AFTER = [
  {
    type: 'compaction',
    id: 'msg_7',
    status: 'completed',
    reason: 'manual',
    summary: '## Objective\n- ship the thing\n\n## Next Move\n1. run the gate',
    tokens: { input: 561, output: 122, reasoning: 22, cache: { read: 6208, write: 0 } },
  },
  { type: 'idle', id: 'msg_8' },
];

describe('countContextEntries', () => {
  it('does not count idle turn markers as messages', () => {
    expect(countContextEntries(CONTEXT_BEFORE)).toBe(5);
    expect(countContextEntries(CONTEXT_AFTER)).toBe(1);
  });

  it('survives junk from the API', () => {
    expect(countContextEntries(null)).toBe(0);
    expect(countContextEntries([null, undefined])).toBe(0);
  });
});

describe('summarizeCompactionTokens', () => {
  it('separates the transcript that was read from the summary that was written', () => {
    // The bug this pins: /compact reported nothing, so a user could not tell
    // whether the context shrank. cache.read is what got folded up; the rest is
    // the cost of writing the summary.
    expect(summarizeCompactionTokens(CONTEXT_AFTER[0].tokens)).toEqual({ read: 6208, spent: 705 });
  });

  it('treats a missing token block as zero rather than NaN', () => {
    expect(summarizeCompactionTokens(undefined)).toEqual({ read: 0, spent: 0 });
  });
});

describe('latestCompaction', () => {
  it('prefers the entry the compact call started, else the newest', () => {
    const entries = [{ type: 'compaction', id: 'old' }, { type: 'compaction', id: 'msg_7' }];
    expect(latestCompaction(entries, 'msg_7').id).toBe('msg_7');
    // No id to match on (the POST failed to return one): fall back to the newest
    // rather than reporting an older compaction as this one's result.
    expect(latestCompaction(entries).id).toBe('msg_7');
    // A stale id must not pin the receipt to the previous run.
    expect(latestCompaction(entries, 'msg_unknown').id).toBe('msg_7');
  });

  it('returns null when the session has never been compacted', () => {
    expect(latestCompaction(CONTEXT_BEFORE)).toBeNull();
  });
});

describe('compactSession', () => {
  const harness = (script) => {
    const calls = [];
    let step = 0;
    const api = async (operationId) => {
      calls.push(operationId);
      return script[step++];
    };
    return { api, calls };
  };

  it('compacts in place and reports the real before/after', async () => {
    const { api, calls } = harness([
      CONTEXT_BEFORE,
      { id: 'msg_7', type: 'compaction' },
      // Still summarising: a *different* message id, so the poll cannot mistake
      // the finished entry for this run's.
      [{ type: 'compaction', id: 'msg_running', status: 'running', summary: '' }],
      CONTEXT_AFTER,
      CONTEXT_AFTER,
    ]);

    const outcome = await compactSession({ sessionId: SID, api, sleepImpl: async () => {} });

    expect(outcome).toMatchObject({
      ok: true,
      sessionId: SID,
      messagesBefore: 5,
      messagesAfter: 1,
      read: 6208,
      spent: 705,
    });
    expect(outcome.summary).toContain('## Objective');
    // The session id is never deleted or rebound: the chat stays on it.
    expect(calls).toEqual([
      'session.context',
      'session.compact',
      'session.context',
      'session.context',
      'session.context',
    ]);
  });

  it('does not spend a model call on a session with nothing in it', async () => {
    const { api, calls } = harness([[{ type: 'idle' }]]);
    expect(await compactSession({ sessionId: SID, api })).toEqual({ ok: false, reason: 'empty' });
    expect(calls).toEqual(['session.context']);
  });

  it('surfaces the tool\'s own failure reason instead of a generic one', async () => {
    const { api } = harness([
      CONTEXT_BEFORE,
      { id: 'msg_7', type: 'compaction' },
      [{ type: 'compaction', id: 'msg_7', status: 'failed', error: { type: 'ProviderError', message: 'rate limited' } }],
    ]);

    expect(await compactSession({ sessionId: SID, api, sleepImpl: async () => {} })).toEqual({
      ok: false,
      reason: 'rate limited',
    });
  });

  it('gives up rather than hanging the chat forever', async () => {
    const { api } = harness([
      CONTEXT_BEFORE,
      { id: 'msg_7', type: 'compaction' },
      [{ type: 'compaction', id: 'msg_7', status: 'running' }],
    ]);
    let clock = 0;
    const outcome = await compactSession({
      sessionId: SID,
      api,
      sleepImpl: async () => { clock += 1_000; },
      now: () => clock,
      timeoutMs: 5_000,
    });
    expect(outcome).toEqual({ ok: false, reason: 'timeout' });
  });

  it('needs a session id', async () => {
    expect(await compactSession({ sessionId: '', api: async () => { throw new Error('called'); } })).toEqual({
      ok: false,
      reason: 'no session',
    });
  });
});

describe('formatCompactReceipt', () => {
  it('says what happened, what it cost, and what the chat is still on', () => {
    const text = formatCompactReceipt({
      sessionId: SID,
      messagesBefore: 5,
      messagesAfter: 1,
      read: 6208,
      spent: 705,
      summary: '## Objective\n- ship the thing',
    });

    expect(text).toContain('Compacted · 5 messages → 1 · read 6.2k tokens · spent 705 to summarise');
    expect(text).toContain(`Session ${SID.slice(0, 12)}… unchanged — this chat stays on it.`);
    expect(text).toContain('ship the thing');
  });

  it('pluralises a single message and omits numbers the API did not give', () => {
    const text = formatCompactReceipt({ sessionId: SID, messagesBefore: 1, summary: 's' });
    expect(text).toContain('1 message → 1');
    expect(text).not.toContain('read ');
    expect(text).not.toContain('spent ');
  });

  it('fits one Telegram message and says where the rest lives', () => {
    const text = formatCompactReceipt({
      sessionId: SID,
      messagesBefore: 500,
      messagesAfter: 1,
      read: 250_000,
      spent: 4_000,
      summary: 'x'.repeat(9_000),
      maxSummaryChars: 200,
    });
    expect(text.length).toBeLessThan(4_096);
    expect(text).toContain('summary cut');
  });

  it('does not claim a summary the tool never wrote', () => {
    const text = formatCompactReceipt({ sessionId: SID, messagesBefore: 3, messagesAfter: 1, summary: '' });
    expect(text).toContain('wrote no summary');
  });
});

describe('formatCompactFailure', () => {
  it('leads with the reason and reassures that nothing was lost', () => {
    const text = formatCompactFailure({ sessionId: SID, reason: 'rate limited' });
    expect(text.split('\n')[0]).toBe('Compact failed · rate limited');
    expect(text).toContain('nothing was compacted and nothing was lost');
  });
});

describe('formatCompactEmpty', () => {
  it('names the chat, not an internal id', () => {
    expect(formatCompactEmpty()).toContain('no session with messages yet');
  });
});

describe('opencode api arg building', () => {
  it('passes path parameters with --param, not in the body', () => {
    expect(buildApiArgs('session.compact', { params: { sessionID: SID }, data: {} })).toEqual([
      'api',
      'session.compact',
      '--param',
      `sessionID=${SID}`,
      '--data',
      '{}',
    ]);
  });

  it('omits empty parameters so the CLI is not handed "undefined"', () => {
    expect(buildApiArgs('session.context', { params: { sessionID: '', id: null, x: undefined } })).toEqual([
      'api',
      'session.context',
    ]);
  });
});

describe('cleanApiError', () => {
  it('strips the CLI log preamble and stack frames', () => {
    const stderr = [
      'timestamp=2026-10-04T01:14:49.416Z level=INFO run=c3e4f502 message="cli starting"',
      'timestamp=2026-10-04T01:14:49.450Z level=ERROR run=c3e4f502 message="cli process failed"',
      'UnknownError: Missing path parameter: sessionID',
      '    at <anonymous> (/root/chunk-eevkpa7s.js:24:5598)',
      '  {',
    ].join('\n');
    expect(cleanApiError(stderr)).toBe('UnknownError: Missing path parameter: sessionID');
  });

  it('falls back to empty rather than printing noise', () => {
    expect(cleanApiError('')).toBe('');
    expect(cleanApiError('timestamp=1 level=INFO message="x"')).toBe('');
  });
});
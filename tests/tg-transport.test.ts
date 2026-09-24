import { describe, it, expect } from 'vitest';
import { Throttle } from '../scripts/lib/tg-throttle.mjs';
import { TelegramApi, TelegramError } from '../scripts/lib/tg-api.mjs';

const tickSleep = async () => {};
const fakeHeaders = (entries = {}) => ({ get: (k) => entries[k] ?? null });

describe('Throttle.noteHeaders', () => {
  it('ignores missing and healthy headers', () => {
    const t = new Throttle({ minIntervalMs: 0, now: () => 0, sleep: tickSleep });
    expect(t.noteHeaders(null)).toBe(0);
    expect(t.noteHeaders({ get: () => null })).toBe(0);
    expect(t.noteHeaders(fakeHeaders({ 'x-ratelimit-remaining': '120' }))).toBe(0);
    expect(t.pausedUntil).toBe(0);
  });

  it('pauses on remaining:0 with retry-after, capped and floored', () => {
    const t = new Throttle({ minIntervalMs: 0, now: () => 0, sleep: tickSleep });
    expect(t.noteHeaders(fakeHeaders({ 'x-ratelimit-remaining': '0', 'retry-after': '9' }))).toBe(9000);
    expect(t.noteHeaders(fakeHeaders({ 'x-ratelimit-remaining': '0' }))).toBe(9000); // keeps longer pause
    const t2 = new Throttle({ minIntervalMs: 0, now: () => 0, sleep: tickSleep });
    expect(t2.noteHeaders(fakeHeaders({ 'x-ratelimit-remaining': '0', 'retry-after': '9999' }))).toBe(60000);
  });

  it('delays submit while paused', async () => {
    let now = 0;
    const slept = [];
    const t = new Throttle({ minIntervalMs: 0, now: () => now, sleep: async (ms) => { slept.push(ms); now += ms; } });
    t.pause(5);
    await t.submit(async () => 'ok');
    expect(slept).toEqual([5000]);
  });
});

describe('TelegramApi onHeaders', () => {
  const okFetch = (headers = fakeHeaders()) => async () => ({
    headers,
    async json() { return { ok: true, result: { id: 1 } }; },
  });

  it('requires a token and stores it verbatim', () => {
    expect(() => new TelegramApi('', { fetchImpl: okFetch() })).toThrow(/token is required/);
    expect(new TelegramApi('abc', { fetchImpl: okFetch() }).token).toBe('abc');
  });

  it('forwards response headers to the hook', async () => {
    const seen = [];
    const api = new TelegramApi('abc', { fetchImpl: okFetch(fakeHeaders({ a: 'b' })), onHeaders: (h) => seen.push(h) });
    await api.getMe();
    expect(seen.length).toBe(1);
  });

  it('survives a throwing hook', async () => {
    const api = new TelegramApi('abc', {
      fetchImpl: okFetch(),
      onHeaders: () => { throw new Error('boom'); },
    });
    expect(await api.getMe()).toEqual({ id: 1 });
  });

  it('surfaces 409/429 flags for the poller', async () => {
    const errFetch = (code) => async () => ({
      headers: fakeHeaders(),
      async json() { return { ok: false, error_code: code, description: 'x', parameters: { retry_after: 4 } }; },
    });
    const e429 = await new TelegramApi('abc', { fetchImpl: errFetch(429) }).getMe().catch((e) => e);
    expect(e429).toBeInstanceOf(TelegramError);
    expect(e429.isRateLimit).toBe(true);
    expect(e429.retryAfter).toBe(4);
    const e409 = await new TelegramApi('abc', { fetchImpl: errFetch(409) }).getMe().catch((e) => e);
    expect(e409.isConflict).toBe(true);
  });
});

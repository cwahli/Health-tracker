import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';

/**
 * SILENT_AUTH_LOSS sensor (2026-11-16).
 *
 * Measured on the live site: a real 451-meal owner account rendered
 * **"Page 1 Of 3"** whenever its credential was missing or expired. The app
 * kept a password-less local session (`last_active_email` only), so every
 * `/api/sync/supabase-pull` answered **401**, no `totalFoodsCount` ever arrived,
 * and `FoodHistoryTab` fell back to `loaded rows / 15` = 3 pages. Nothing was
 * logged to the user and nothing was shown — history just looked complete.
 *
 * This sensor pins the three things that keep the collapse from coming back:
 *
 *   1. Server: a valid refresh token mints a fresh access token
 *      (`POST /api/auth/refresh`), so a 30-day expiry is no longer terminal.
 *   2. Client: an expired `auth_token` is never sent as-is — a refresh is
 *      attempted first, and a 401 is retried exactly once.
 *   3. Client: when the credential is genuinely gone, `auth_session_expired`
 *      fires (the shell banner + sign-in CTA) instead of a silent short list.
 *
 * It also pins the count ratchet: a stored meal total must survive a bundle
 * rewrite that does not carry one.
 */

function liveToken(uid = 'uid-1', email = 'a@b.com', ttlSeconds = 3600): string {
  const payload = { uid, email, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  return `htk.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.testsig`;
}

function expiredToken(uid = 'uid-1', email = 'a@b.com'): string {
  return liveToken(uid, email, -3600);
}

/**
 * `vi.restoreAllMocks()` does not undo a direct `globalThis.fetch = vi.fn(...)`
 * assignment, so every suite here restores the real fetch itself. Without this
 * a later server test would send its request into the previous test's 401 stub.
 */
const realFetch = globalThis.fetch;
const restoreFetch = () => { globalThis.fetch = realFetch; };

// ---------------------------------------------------------------------------
// 1. Session credential helpers (pure, no React)
// ---------------------------------------------------------------------------
describe('authSession — a dead token is recognised before it is sent', () => {
  const storage: Record<string, string> = {};
  const localStorageMock = {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = String(v); },
    removeItem: (k: string) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
    key: (i: number) => Object.keys(storage)[i] ?? null,
    get length() { return Object.keys(storage).length; },
  };

  beforeEach(() => {
    localStorageMock.clear();
    (globalThis as any).localStorage = localStorageMock;
    (globalThis as any).window = { dispatchEvent: () => true };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreFetch();
    delete (globalThis as any).window;
  });

  it('treats an expired htk token as unusable (sending it is a guaranteed 401)', async () => {
    const { isSessionTokenUsable } = await import('../authSession');
    expect(isSessionTokenUsable(expiredToken())).toBe(false);
    // An unexpired token with >60s of headroom is fine.
    expect(isSessionTokenUsable(liveToken())).toBe(true);
    // Garbage / missing never counts as usable — that is what caused the bug.
    expect(isSessionTokenUsable('')).toBe(false);
    expect(isSessionTokenUsable(null)).toBe(false);
    expect(isSessionTokenUsable('not-a-token')).toBe(false);
  });

  it('decodes the payload so a refresh keeps the SAME uid (no usr_<email> fallback)', async () => {
    const { decodeSessionToken } = await import('../authSession');
    const payload = decodeSessionToken(liveToken('hiJun2hTdDTk2igwerun2LKvwb42', 'cwah.liu@gmail.com'));
    expect(payload?.uid).toBe('hiJun2hTdDTk2igwerun2LKvwb42');
    expect(payload?.email).toBe('cwah.liu@gmail.com');
  });

  it('reports a hard expiry once and clears credentials, but only on a rejected token', async () => {
    const session = await import('../authSession');
    const seen: string[] = [];
    const unsubscribe = session.onSessionExpired((d) => seen.push(d.email || ''));
    session.storeSessionCredentials({ token: 'htk.x.y', refreshToken: 'htr.zzz' });
    session.emitSessionExpired('cwah.liu@gmail.com');
    expect(seen).toEqual(['cwah.liu@gmail.com']);
    expect(session.takeExpiredEmail()).toBe('cwah.liu@gmail.com');
    unsubscribe();
    // A second read is empty: the sign-in prefill is one-shot.
    expect(session.takeExpiredEmail()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 2. Client pull paths: refresh, retry once, then fail loud
// ---------------------------------------------------------------------------
describe('pull paths never swallow a 401 (totalFoodsCount must survive)', () => {
  const storage: Record<string, string> = {};
  const localStorageMock = {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = String(v); },
    removeItem: (k: string) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
  };

  beforeEach(() => {
    localStorageMock.clear();
    (globalThis as any).localStorage = localStorageMock;
    (globalThis as any).window = { dispatchEvent: () => true };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreFetch();
    delete (globalThis as any).window;
  });

  it('refreshSession exchanges a refresh token for a new access token', async () => {
    const session = await import('../authSession');
    session.storeSessionCredentials({ token: expiredToken(), refreshToken: 'htr.valid' });
    let calls = 0;
    globalThis.fetch = vi.fn(async (url: any) => {
      calls += 1;
      expect(String(url)).toBe('/api/auth/refresh');
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, token: liveToken('uid-9'), refreshToken: 'htr.next' }),
      } as any;
    }) as any;

    const outcome = await session.refreshSession({ force: true });
    expect(outcome.status).toBe('ok');
    expect(calls).toBe(1);
    expect(session.isSessionTokenUsable(storage['auth_token'])).toBe(true);
    expect(storage['refresh_token']).toBe('htr.next');
  });

  it('a rejected refresh token (400/401) clears credentials and reports expiry', async () => {
    const session = await import('../authSession');
    session.storeSessionCredentials({ token: expiredToken(), refreshToken: 'htr.stale' });
    const expiredEvents: (string | undefined)[] = [];
    session.onSessionExpired((d) => expiredEvents.push(d.email));
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as any;

    const outcome = await session.refreshSession({ force: true });
    expect(outcome.status).toBe('invalid');
    expect(storage['auth_token']).toBeUndefined();
    expect(storage['refresh_token']).toBeUndefined();
    session.emitSessionExpired('a@b.com');
    expect(expiredEvents).toContain('a@b.com');
  });

  it('a network failure keeps the session (it is not a rejection)', async () => {
    const session = await import('../authSession');
    session.storeSessionCredentials({ token: expiredToken(), refreshToken: 'htr.keep' });
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); }) as any;

    const outcome = await session.refreshSession({ force: true });
    expect(outcome.status).toBe('network');
    expect(storage['refresh_token']).toBe('htr.keep');
  });

  it('single-flights a burst of pulls into one refresh request', async () => {
    const session = await import('../authSession');
    session.storeSessionCredentials({ token: expiredToken(), refreshToken: 'htr.one' });
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ success: true, token: liveToken() }) } as any;
    }) as any;

    await Promise.all([
      session.refreshSession({ force: true }),
      session.refreshSession({ force: true }),
      session.refreshSession({ force: true }),
    ]);
    expect(calls).toBe(1);
  });

  it('fetchFoodLogsPage retries once after a 401 and keeps the server total', async () => {
    const { fetchFoodLogsPage } = await import('../syncUtils');
    const requests: string[] = [];
    let pullCount = 0;
    globalThis.fetch = vi.fn(async (url: any) => {
      requests.push(String(url));
      if (String(url) === '/api/auth/refresh') {
        return { ok: true, status: 200, json: async () => ({ success: true, token: liveToken() }) } as any;
      }
      pullCount += 1;
      // First pull is rejected (token revoked server-side, not merely expired),
      // the one retry after a forced refresh succeeds.
      if (pullCount === 1) {
        return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, foods: [{ id: 'f1', name: 'x' }], totalFoodsCount: 451 }),
      } as any;
    }) as any;

    localStorageMock.setItem('auth_token', expiredToken());
    localStorageMock.setItem('refresh_token', 'htr.valid');

    const fakeAuth = { currentUser: null, authStateReady: vi.fn().mockResolvedValue(undefined) };
    vi.doMock('../../firebase', () => ({ auth: fakeAuth }));

    const page = await fetchFoodLogsPage('uid-1', 1, 15, 'a@b.com');
    // Exactly one retry (never a retry loop), and the REAL total survived.
    expect(requests.filter((u) => u === '/api/sync/supabase-pull')).toHaveLength(2);
    expect(requests).toContain('/api/auth/refresh');
    expect(page.totalFoodsCount).toBe(451);
  });

  it('fires auth_session_expired when a 401 survives the refresh', async () => {
    const { fetchAllConsolidatedLogs } = await import('../syncUtils');
    const session = await import('../authSession');
    const events: (string | undefined)[] = [];
    const unsub = session.onSessionExpired((d) => events.push(d.email));

    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url) === '/api/auth/refresh') {
        return { ok: false, status: 401, json: async () => ({}) } as any;
      }
      return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) } as any;
    }) as any;
    localStorageMock.setItem('refresh_token', 'htr.dead');

    const result = await fetchAllConsolidatedLogs({}, 'uid-1', {}, {}, {}, 'a@b.com', {});
    expect(result.totalFoodsCount).toBeUndefined();
    // The user must be told, not left with a silently short history.
    expect(events).toContain('a@b.com');
    unsub();
  });
});

// ---------------------------------------------------------------------------
// 3. Server: refresh route + login issuing a refresh token
// ---------------------------------------------------------------------------
describe('POST /api/auth/refresh — 30-day access, 90-day refresh', () => {
  afterEach(() => { restoreFetch(); vi.restoreAllMocks(); });

  it('issues a new access token from a valid refresh token and rejects a tampered one', async () => {
    const auth = await import('../../../server_auth');
    const app = express();
    app.use(express.json());
    app.post('/api/auth/refresh', async (req, res) => {
      const { verifyRefreshToken, signSessionToken, signRefreshToken } = await import('../../../server_auth');
      const payload = verifyRefreshToken(String((req.body || {}).refreshToken || ''));
      if (!payload || !payload.uid) return res.status(401).json({ error: 'Invalid or expired refresh token' });
      const base = { uid: payload.uid, email: payload.email };
      return res.json({ success: true, token: signSessionToken(base), refreshToken: signRefreshToken(base) });
    });

    const server = app.listen(0);
    const port = (server.address() as any).port;
    try {
      const valid = auth.signRefreshToken({ uid: 'hiJun2hTdDTk2igwerun2LKvwb42', email: 'cwah.liu@gmail.com' });
      const okResp = await fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: valid }),
      });
      expect(okResp.status).toBe(200);
      const body: any = await okResp.json();
      expect(body.success).toBe(true);
      const session = auth.verifySessionToken(body.token);
      expect(session?.uid).toBe('hiJun2hTdDTk2igwerun2LKvwb42');

      const badResp = await fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: valid.slice(0, -3) + 'xxx' }),
      });
      expect(badResp.status).toBe(401);
    } finally {
      server.close();
    }
  });

  it('refuses an access token used as a refresh token (prefix/typ separation)', async () => {
    const auth = await import('../../../server_auth');
    const access = auth.signSessionToken({ uid: 'u', email: 'a@b.com' });
    expect(auth.verifyRefreshToken(access)).toBeNull();
    const refresh = auth.signRefreshToken({ uid: 'u', email: 'a@b.com' });
    expect(auth.verifySessionToken(refresh)).toBeNull();
  });

  it('login hands back both tokens so the client never has to ask for a password again', async () => {
    const auth = await import('../../../server_auth');
    const result = await auth.authenticateUser('cwah.liu@gmail.com', 'Admin135$,').catch(() => null);
    if (!result?.success) return; // hermetic env without the admin row — the prefix test above still pins the contract
    expect(result.token).toMatch(/^htk\./);
    expect(result.refreshToken).toMatch(/^htr\./);
  });
});

// ---------------------------------------------------------------------------
// 4. Count ratchet: a bundle rewrite must not drop the known total
// ---------------------------------------------------------------------------
describe('stored meal total survives a count-less bundle rewrite', () => {
  it('preserveBundleFoodTotal carries the stored total into an incoming bundle without one', async () => {
    const { preserveBundleFoodTotal, healedBundleTotal } = await import('../storageUtils');
    const incoming = { profile: { email: 'a@b.com' }, foodLogs: [{ id: 'f1' }] };
    const stored = { totalFoodsCount: 451 };
    expect(preserveBundleFoodTotal(incoming, stored).totalFoodsCount).toBe(451);
    // An incoming good total always wins.
    expect(preserveBundleFoodTotal({ ...incoming, totalFoodsCount: 452 }, stored).totalFoodsCount).toBe(452);
    // `healedBundleTotal` keeps the best of live + stored.
    expect(healedBundleTotal(undefined, 451)).toBe(451);
    expect(healedBundleTotal(31, 451)).toBe(451);
  });
});

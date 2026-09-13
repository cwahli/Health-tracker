/**
 * Regression tests for syncUtils.ts
 *
 * Key coverage:
 *  - pushLogsToServer: correct endpoint, auth header forwarded, error handling
 *  - upsertProfileToSupabase: delegates to pushLogsToServer, no-op on missing uid
 *  - mergeByRecency / mergeDeleteMaps: must-not-regress merge laws
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  pushLogsToServer,
  upsertProfileToSupabase,
  mergeByRecency,
  mergeDeleteMaps,
} from './syncUtils';

// ---------------------------------------------------------------------------
// pushLogsToServer
// ---------------------------------------------------------------------------
describe('pushLogsToServer', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

  it('returns error immediately when uid is missing', async () => {
    const result = await pushLogsToServer({ uid: '' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/uid required/i);
  });

  it('POSTs to /api/sync/supabase-push with correct body', async () => {
    const captured: { url: string; body: any; headers: Record<string, string> }[] = [];
    globalThis.fetch = vi.fn(async (url: string, opts: any) => {
      captured.push({ url: String(url), body: JSON.parse(opts?.body || '{}'), headers: opts?.headers || {} });
      return { ok: true, json: async () => ({ success: true, foodCount: 1, bioCount: 0 }) } as any;
    });

    const result = await pushLogsToServer({
      uid: 'user-123',
      email: 'test@example.com',
      foods: [{ id: 'food-1', name: 'Apple', date: '2026-09-13', updated_at: Date.now() } as any],
      idToken: 'tok-abc',
    });

    expect(result.success).toBe(true);
    expect(result.foodCount).toBe(1);
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe('/api/sync/supabase-push');
    expect(captured[0].body.uid).toBe('user-123');
    expect(captured[0].body.foods).toHaveLength(1);
    expect(captured[0].headers['Authorization']).toBe('Bearer tok-abc');
  });

  it('omits Authorization header when idToken is absent', async () => {
    const captured: any[] = [];
    globalThis.fetch = vi.fn(async (_url: string, opts: any) => {
      captured.push(opts?.headers || {});
      return { ok: true, json: async () => ({ success: true }) } as any;
    });
    await pushLogsToServer({ uid: 'u1' });
    expect(captured[0]['Authorization']).toBeUndefined();
  });

  it('returns success:false and does not throw on HTTP error', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 500, text: async () => 'server error',
    })) as any;
    const result = await pushLogsToServer({ uid: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/500/);
  });

  it('returns success:false and does not throw on network failure', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('Network down'); }) as any;
    const result = await pushLogsToServer({ uid: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/network down/i);
  });
});

// ---------------------------------------------------------------------------
// upsertProfileToSupabase — delegates to pushLogsToServer
// ---------------------------------------------------------------------------
describe('upsertProfileToSupabase', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

  it('is a no-op and does not throw when uid is missing', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any;
    await expect(upsertProfileToSupabase({} as any)).resolves.toBeUndefined();
  });

  it('calls /api/sync/supabase-push with the profile when uid provided', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ success: true }) } as any;
    }) as any;
    upsertProfileToSupabase({ email: 'a@b.com' } as any, 'uid-xyz');
    await new Promise(r => setTimeout(r, 20));
    expect(calls).toContain('/api/sync/supabase-push');
  });
});

// ---------------------------------------------------------------------------
// mergeByRecency — existing merge law guard
// ---------------------------------------------------------------------------
describe('mergeByRecency', () => {
  it('prefers the newer item by updated_at', () => {
    const older = { id: '1', name: 'Old', updated_at: 1000 };
    const newer = { id: '1', name: 'New', updated_at: 2000 };
    const result = mergeByRecency([older], [newer]);
    expect(result).toHaveLength(1);
    expect((result[0] as any).name).toBe('New');
  });

  it('unions local-only and server-only items', () => {
    const local = [{ id: 'L1', updated_at: 1000 }];
    const server = [{ id: 'S1', updated_at: 1000 }];
    const result = mergeByRecency(local, server);
    expect(result.map(r => r.id).sort()).toEqual(['L1', 'S1']);
  });

  it('local-only items survive server absence (no implicit delete)', () => {
    const local = [{ id: 'local-only', updated_at: 500 }];
    const result = mergeByRecency(local, []);
    expect(result.map(r => r.id)).toContain('local-only');
  });
});

// ---------------------------------------------------------------------------
// mergeDeleteMaps — tombstone union law
// ---------------------------------------------------------------------------
describe('mergeDeleteMaps', () => {
  it('takes the higher timestamp for the same id', () => {
    const a = { 'food-1': 1000, 'food-2': 2000 };
    const b = { 'food-1': 1500, 'food-3': 500 };
    const merged = mergeDeleteMaps(a, b);
    expect(merged['food-1']).toBe(1500);
    expect(merged['food-2']).toBe(2000);
    expect(merged['food-3']).toBe(500);
  });

  it('never drops tombstones from either side', () => {
    const a = { 'x': 100 };
    const b = { 'y': 200 };
    const merged = mergeDeleteMaps(a, b);
    expect(Object.keys(merged).sort()).toEqual(['x', 'y']);
  });
});

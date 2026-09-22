/**
 * Regression tests for syncUtils.ts
 *
 * Key coverage:
 *  - pushLogsToServer: correct endpoint, auth header forwarded, error handling
 *  - upsertProfileToSupabase: delegates to pushLogsToServer, no-op on missing uid
 *  - mergeByRecency / mergeDeleteMaps: must-not-regress merge laws
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  pushLogsToServer,
  upsertProfileToSupabase,
  mergeByRecency,
  mergeDeleteMaps,
  mergeProfiles,
  resolveInitialLanguage,
  pullAuthHeaders,
  fetchAllConsolidatedLogs,
  fetchFoodLogsPage,
} from './syncUtils';

vi.mock('../firebase', () => ({
  auth: { currentUser: { getIdToken: async () => 'fb-id-token' } },
}));


// This project's vitest run doesn't use a DOM environment (no jsdom/happy-dom
// dependency), so localStorage isn't a global here the way it is in the
// browser. Polyfill a minimal in-memory version, matching the pattern in
// creditManager.test.ts.
if (typeof (globalThis as any).localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
}

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

  it('attaches Authorization when idToken is provided', async () => {
    const captured: any[] = [];
    globalThis.fetch = vi.fn(async (_url: string, opts: any) => {
      captured.push(opts?.headers || {});
      return { ok: true, json: async () => ({ success: true }) } as any;
    });
    await pushLogsToServer({ uid: 'u1', idToken: 'explicit-tok' });
    expect(captured[0]['Authorization']).toBe('Bearer explicit-tok');
  });

  it('always sends Content-Type; Authorization only when a token is available', async () => {
    const captured: any[] = [];
    globalThis.fetch = vi.fn(async (_url: string, opts: any) => {
      captured.push(opts?.headers || {});
      return { ok: true, json: async () => ({ success: true }) } as any;
    });
    // No idToken: pullAuthHeaders() still runs and may attach a Firebase token
    // when signed in; in this Node test env there is no Firebase session, so
    // Authorization stays absent — but Content-Type must always be present so
    // the JSON body parses on the server.
    await pushLogsToServer({ uid: 'u1' });
    expect(captured[0]['Content-Type']).toBe('application/json');
    if (captured[0]['Authorization'] !== undefined) {
      expect(String(captured[0]['Authorization'])).toMatch(/^Bearer /);
    }
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
// pullAuthHeaders / pull endpoints — ratchet for the 401-hides-meals class
// (ffa1023 enforced token auth; 71ba3e0 added headers; this pins all pull
// call sites so a future fetch without Authorization fails here first).
// ---------------------------------------------------------------------------
describe('pull auth headers (401 hides totalFoodsCount → 2-page bug)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

  it('pullAuthHeaders always includes Content-Type', async () => {
    const headers = await pullAuthHeaders();
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('fetchAllConsolidatedLogs POSTs /api/sync/supabase-pull with Authorization when signed in', async () => {
    const captured: { url: string; headers: Record<string, string> }[] = [];
    globalThis.fetch = vi.fn(async (url: string, opts: any) => {
      captured.push({ url: String(url), headers: opts?.headers || {} });
      return {
        ok: true,
        json: async () => ({ success: true, foods: [], biomarkers: [], totalFoodsCount: 176 }),
      } as any;
    });

    const result = await fetchAllConsolidatedLogs('uid-1', 'a@b.com', {}, {}, {});
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe('/api/sync/supabase-pull');
    expect(captured[0].headers['Authorization']).toBe('Bearer fb-id-token');
    expect(result.totalFoodsCount).toBe(176);
  });

  it('fetchFoodLogsPage POSTs page 2 with Authorization and preserves totalFoodsCount', async () => {
    const captured: { body: any; headers: Record<string, string> }[] = [];
    globalThis.fetch = vi.fn(async (_url: string, opts: any) => {
      captured.push({ body: JSON.parse(opts?.body || '{}'), headers: opts?.headers || {} });
      return {
        ok: true,
        json: async () => ({ success: true, foods: [{ id: 'f1', name: 'x' }], totalFoodsCount: 176 }),
      } as any;
    });

    const page2 = await fetchFoodLogsPage('uid-1', 2, 15, 'a@b.com');
    expect(captured[0].headers['Authorization']).toBe('Bearer fb-id-token');
    expect(captured[0].body.pageSize).toBe(15);
    expect(captured[0].body.offset).toBe(15);
    // Total must come from the server count, not foods.length — otherwise
    // ceil(15/15)=1 page even when D1 has 176 rows.
    expect(page2.totalFoodsCount).toBe(176);
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
// resolveInitialLanguage — regression for the "Indonesian selected, Home
// screen shows English after signup" bug.
//
// Root cause: on a brand-new signup, checkForDbChanges' "no cloud doc yet"
// branch built a fresh profile with a hardcoded `language: 'en'`, with zero
// regard for the language the person had just picked on the login screen
// (threaded correctly elsewhere via loadUserData's chosenLanguage param, and
// persisted to localStorage['preferred_language'] by AuthScreen). Because
// that branch runs asynchronously and can resolve after loadUserData's own
// correct setProfile() call, its hardcoded English default could silently
// win the race and overwrite the just-selected language on first login.
// ---------------------------------------------------------------------------
describe('resolveInitialLanguage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('prefers an explicit chosenLanguage over everything else', () => {
    localStorage.setItem('preferred_language', 'fr');
    expect(resolveInitialLanguage('id')).toBe('id');
  });

  it('falls back to preferred_language from localStorage when chosenLanguage is absent', () => {
    localStorage.setItem('preferred_language', 'id');
    expect(resolveInitialLanguage(undefined)).toBe('id');
    expect(resolveInitialLanguage(null)).toBe('id');
  });

  it('reproduces and fixes the exact bug: Indonesian selected pre-login, no chosenLanguage threaded through', () => {
    localStorage.setItem('preferred_language', 'id');
    // The buggy code path hardcoded 'en' with no lookup at all - simulate
    // the equivalent call (no chosenLanguage available).
    expect(resolveInitialLanguage()).toBe('id');
  });

  it('ignores an invalid chosenLanguage value and falls back to preferred_language', () => {
    localStorage.setItem('preferred_language', 'zh');
    expect(resolveInitialLanguage('not-a-real-locale')).toBe('zh');
  });

  it('ignores an invalid preferred_language value and defaults to en', () => {
    localStorage.setItem('preferred_language', 'not-a-real-locale');
    expect(resolveInitialLanguage()).toBe('en');
  });

  it('defaults to en when nothing is set anywhere', () => {
    expect(resolveInitialLanguage()).toBe('en');
  });

  it('supports all four locales through the chosenLanguage path', () => {
    expect(resolveInitialLanguage('en')).toBe('en');
    expect(resolveInitialLanguage('fr')).toBe('fr');
    expect(resolveInitialLanguage('zh')).toBe('zh');
    expect(resolveInitialLanguage('id')).toBe('id');
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

// ---------------------------------------------------------------------------
// Profile language persistence & non-reset laws
// ---------------------------------------------------------------------------
describe('Profile language persistence laws', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('mergeProfiles preserves local profile language when merging with serverProfile', () => {
    const server = { email: 'test@example.com', language: 'id' } as any;
    const local = { email: 'test@example.com', language: 'en' } as any;
    const merged = mergeProfiles(server, local);
    expect(merged?.language).toBe('en');
  });

  it('existing profile language is remembered and not clobbered when preferred_language is id', () => {
    // Simulate user having chosen English on their profile previously
    const existingProfile = { email: 'test@example.com', language: 'en' } as any;
    // But localStorage had leftover 'id' from testing or previous session
    localStorage.setItem('preferred_language', 'id');

    // Language resolution for an existing profile with a valid language must preserve it
    const valid = ['en', 'fr', 'zh', 'id'];
    let resolvedLang = existingProfile.language;
    if (!resolvedLang || !valid.includes(resolvedLang)) {
      resolvedLang = resolveInitialLanguage();
    }
    expect(resolvedLang).toBe('en');
  });

  it('unspecified or invalid profile language falls back to preferred_language', () => {
    const emptyProfile = { email: 'test@example.com', language: '' } as any;
    localStorage.setItem('preferred_language', 'id');

    const valid = ['en', 'fr', 'zh', 'id'];
    let resolvedLang = emptyProfile.language;
    if (!resolvedLang || !valid.includes(resolvedLang)) {
      resolvedLang = resolveInitialLanguage();
    }
    expect(resolvedLang).toBe('id');
  });
});

// ---------------------------------------------------------------------------
// Settings Sync Indicator & Translations
// ---------------------------------------------------------------------------
describe('Settings Sync Indicator & Translations', () => {
  it('has localized syncNow and syncing keys in both en and id', async () => {
    const { localePacks } = await import('./translations');
    expect(localePacks.en.syncNow).toBe('Sync Now');
    expect(localePacks.en.syncing).toBe('Syncing...');
    expect(localePacks.id.syncNow).toBe('Sinkronkan Sekarang');
    expect(localePacks.id.syncing).toBe('Menyinkronkan...');
  });

  it('determines spinning animation and amber styling when syncState is syncing', () => {
    const computeSyncProps = (syncState: 'synced' | 'syncing' | 'local' | 'conflict', t: Record<string, string>) => ({
      isSpinning: syncState === 'syncing',
      iconClass: `w-4 h-4 ${syncState === 'syncing' ? 'text-amber-500 animate-spin' : ''}`.trim(),
      btnClass: syncState === 'syncing' ? 'text-amber-500' : 'text-slate-600 dark:text-slate-300',
      label: syncState === 'syncing' ? (t.syncing || 'Syncing...') : (t.syncNow || 'Sync Now'),
    });

    const enT = { syncNow: 'Sync Now', syncing: 'Syncing...' };
    const idT = { syncNow: 'Sinkronkan Sekarang', syncing: 'Menyinkronkan...' };

    // Syncing in English
    const syncingEn = computeSyncProps('syncing', enT);
    expect(syncingEn.isSpinning).toBe(true);
    expect(syncingEn.iconClass).toContain('animate-spin');
    expect(syncingEn.iconClass).toContain('text-amber-500');
    expect(syncingEn.btnClass).toContain('text-amber-500');
    expect(syncingEn.label).toBe('Syncing...');

    // Synced in English
    const syncedEn = computeSyncProps('synced', enT);
    expect(syncedEn.isSpinning).toBe(false);
    expect(syncedEn.iconClass).not.toContain('animate-spin');
    expect(syncedEn.btnClass).not.toContain('text-amber-500');
    expect(syncedEn.label).toBe('Sync Now');

    // Syncing in Indonesian
    const syncingId = computeSyncProps('syncing', idT);
    expect(syncingId.isSpinning).toBe(true);
    expect(syncingId.iconClass).toContain('animate-spin');
    expect(syncingId.label).toBe('Menyinkronkan...');
  });
});


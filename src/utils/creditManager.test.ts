import { describe, it, expect, beforeEach } from 'vitest';
import { getAvailableCredits, DEFAULT_DAILY_QUOTA, DEFAULT_AGENT_COSTS } from './creditManager';
import { UserProfile } from '../types';

const ADMIN_SETTINGS_KEY = 'health_app_admin_settings';

// This project's vitest run doesn't use a DOM environment (no jsdom/happy-dom
// dependency), so localStorage isn't a global here the way it is in the
// browser. Polyfill a minimal in-memory version rather than pulling in a new
// dependency just for this one test file.
if (typeof (globalThis as any).localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
}

describe('getAvailableCredits - quota fallback', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('gives an Admin the DEFAULT_DAILY_QUOTA.Admin amount when no admin settings have ever been saved on this device', () => {
    const profile: UserProfile = { email: 'cwah.liu@gmail.com' };
    const credits = getAvailableCredits(profile);
    expect(credits.userType).toBe('Admin');
    expect(credits.total).toBe(DEFAULT_DAILY_QUOTA.Admin);
    expect(Number.isNaN(credits.total)).toBe(false);
  });

  it('falls back to DEFAULT_DAILY_QUOTA.Admin even if a device has an explicit null/blank quotaAdmin saved (regression: this used to resolve to 0 credits)', () => {
    localStorage.setItem(
      ADMIN_SETTINGS_KEY,
      JSON.stringify({ flashLiteCost: 1, standardCost: 20, quotaDemo: 20, quotaStandard: 100, quotaAdmin: null })
    );
    const profile: UserProfile = { email: 'cwah.liu@gmail.com' };
    const credits = getAvailableCredits(profile);
    expect(credits.total).toBe(DEFAULT_DAILY_QUOTA.Admin);
    expect(credits.total).toBeGreaterThan(0);
  });

  it('uses a properly configured quotaAdmin value when one has been saved', () => {
    localStorage.setItem(
      ADMIN_SETTINGS_KEY,
      JSON.stringify({ flashLiteCost: 1, standardCost: 20, quotaDemo: 20, quotaStandard: 100, quotaAdmin: 750 })
    );
    const profile: UserProfile = { email: 'cwah.liu@gmail.com' };
    const credits = getAvailableCredits(profile);
    expect(credits.total).toBe(750);
  });

  it('gives Standard and Demo users their respective DEFAULT_DAILY_QUOTA amounts when unconfigured', () => {
    const standard = getAvailableCredits({ email: 'someone@example.com' });
    expect(standard.userType).toBe('Standard');
    expect(standard.total).toBe(DEFAULT_DAILY_QUOTA.Standard);

    const demo = getAvailableCredits({ email: 'demo@healthcockpit.com' });
    expect(demo.userType).toBe('Demo');
    expect(demo.total).toBe(DEFAULT_DAILY_QUOTA.Demo);
  });
});

describe('DEFAULT_AGENT_COSTS / DEFAULT_DAILY_QUOTA sanity', () => {
  it('are non-zero, so a missing settings value can never make every request free or every quota 0', () => {
    expect(DEFAULT_AGENT_COSTS['gemini-3.5-flash-lite']).toBeGreaterThan(0);
    expect(DEFAULT_AGENT_COSTS['default']).toBeGreaterThan(0);
    expect(DEFAULT_DAILY_QUOTA.Admin).toBeGreaterThan(0);
    expect(DEFAULT_DAILY_QUOTA.Standard).toBeGreaterThan(0);
    expect(DEFAULT_DAILY_QUOTA.Demo).toBeGreaterThan(0);
  });
});

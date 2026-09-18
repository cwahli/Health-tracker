import { describe, it, expect } from 'vitest';
import {
  isDeepEqual,
  pushPendingObservation,
  sanitizeProfile,
  maybeRecalibrateDemographicOverlays,
} from './appProfileUtils';

/**
 * Q-11.1 — behaviour lock for the helpers moved out of `src/App.tsx`.
 * These assert the *existing* behaviour (including the quirks) so a later
 * milestone cannot quietly change it while refactoring around it.
 */

describe('sanitizeProfile', () => {
  it('returns null for an empty profile that is not the admin account', () => {
    expect(sanitizeProfile(null, 'someone@example.com')).toBeNull();
    expect(sanitizeProfile(undefined, 'someone@example.com')).toBeNull();
  });

  it('returns the admin default for an empty profile on the admin account', () => {
    const profile = sanitizeProfile(null, 'cwah.liu@gmail.com');
    expect(profile).toMatchObject({
      email: 'cwah.liu@gmail.com',
      nickname: 'C. Liu',
      userType: 'Admin',
      age: 28,
      weight: 70,
      height: 175,
    });
    expect(profile.email).toBe('cwah.liu@gmail.com');
  });

  it('normalises an admin-ish incoming profile and fills missing demographics', () => {
    const profile = sanitizeProfile(
      { email: 'CHIWAH.LIU@example.com', nickname: 'John Doe', ethnicity: 'Unknown' },
      'chiwah.liu@example.com',
    );
    expect(profile.email).toBe('cwah.liu@gmail.com');
    expect(profile.nickname).toBe('C. Liu');
    expect(profile.ethnicity).toBe('Chinese');
    expect(profile.gender).toBe('Male');
    expect(profile.userType).toBe('Admin');
  });

  it('passes any other profile through untouched (same reference)', () => {
    const incoming = { email: 'jane@example.com', nickname: 'Jane', age: 41 };
    expect(sanitizeProfile(incoming, 'jane@example.com')).toBe(incoming);
  });

  it('is idempotent for the admin default', () => {
    const once = sanitizeProfile(null, 'cwah.liu@gmail.com');
    expect(sanitizeProfile(once, 'cwah.liu@gmail.com')).toMatchObject({
      email: once.email,
      nickname: once.nickname,
      userType: once.userType,
    });
  });
});

describe('isDeepEqual', () => {
  it('compares nested structures by value', () => {
    expect(isDeepEqual({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2] } })).toBe(true);
    expect(isDeepEqual({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [2, 1] } })).toBe(false);
    expect(isDeepEqual('same', 'same')).toBe(true);
    expect(isDeepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('ignores keys whose values are null or undefined', () => {
    expect(isDeepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(isDeepEqual({ a: 1 }, { a: 1, b: null })).toBe(true);
  });

  it('does not treat a missing key as equal to a set one', () => {
    expect(isDeepEqual({ a: 1 }, { b: 1 })).toBe(false);
  });

  it('treats non-object mismatches as unequal', () => {
    expect(isDeepEqual(null, {})).toBe(false);
    expect(isDeepEqual({}, null)).toBe(false);
    expect(isDeepEqual(1, { a: 1 })).toBe(false);
  });
});

describe('pushPendingObservation', () => {
  const item = { printedName: 'Unknown Marker', date: '2026-09-01', rawValue: '12.4' };

  it('appends a normalised observation without mutating the input array', () => {
    const existing: any[] = [];
    const next = pushPendingObservation(existing, item);
    expect(existing).toHaveLength(0);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      printedName: 'Unknown Marker',
      date: '2026-09-01',
      rawValue: '12.4',
      rawUnit: '',
      sourceJobId: '',
    });
    expect(next[0].id).toMatch(/^pending_/);
  });

  it('deduplicates on printedName + date + rawValue, case-insensitively on the name', () => {
    const first = pushPendingObservation(undefined, item);
    const second = pushPendingObservation(first, { ...item, printedName: 'unknown marker' });
    expect(second).toHaveLength(1);
  });

  it('keeps observations that differ by date or value', () => {
    const first = pushPendingObservation(undefined, item);
    expect(pushPendingObservation(first, { ...item, date: '2026-09-02' })).toHaveLength(2);
    expect(pushPendingObservation(first, { ...item, rawValue: '13' })).toHaveLength(2);
  });

  it('tolerates a missing existing list', () => {
    expect(pushPendingObservation(undefined, item)).toHaveLength(1);
  });
});

describe('maybeRecalibrateDemographicOverlays', () => {
  it('is a no-op when demographics are absent', () => {
    const next = { email: 'jane@example.com' };
    expect(maybeRecalibrateDemographicOverlays({}, next)).toBe(next);
  });

  it('is a no-op when the demographic fingerprint did not move', () => {
    const prev = { age: 41, gender: 'Female', ethnicity: 'Unknown' };
    const next = { age: 41, gender: 'Female', ethnicity: 'Unknown', customBiomarkers: {} };
    expect(maybeRecalibrateDemographicOverlays(prev, next)).toBe(next);
  });

  it('returns a profile object when the fingerprint moved', () => {
    const prev = { age: 41, gender: 'Female', ethnicity: 'Unknown' };
    const next = { age: 41, gender: 'Female', ethnicity: 'Unknown', customBiomarkers: {} };
    const moved = { ...next, ethnicity: 'Chinese' };
    const out = maybeRecalibrateDemographicOverlays(prev, moved);
    expect(out).toBeTruthy();
    expect(out.age).toBe(moved.age);
  });

  it('handles a missing previous profile', () => {
    const next = { age: 30, gender: 'Male', ethnicity: 'Chinese' };
    expect(maybeRecalibrateDemographicOverlays(null, next)).toBe(next);
  });
});

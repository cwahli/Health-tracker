/**
 * Fixture gate for V-30.2 packer — pure helpers, no HTTP.
 * a) BUG-8449 7-item report → 1 card + split list (never bundled)
 * b) vague report → needs_repro signal
 * c) duplicate fingerprint → same key (merge entrypoint)
 */
import { describe, it, expect } from 'vitest';
import {
  packCheck,
  splitMultiItemReport,
  isVagueReport,
  fingerprint,
  isoWeekKey,
  looksBundled,
} from '../../scripts/lib/bug-pack.mjs';

describe('packCheck', () => {
  it('accepts a complete single-defect payload and derives fingerprint', () => {
    const r = packCheck({
      component: 'Weekly targets',
      observed: 'Omega-3 shows 7.700000000000001g',
      expected: '7.7g',
      criteria: 'Weekly targets pill shows 7.7g after load',
      class: 'UI',
      surface: 'home',
    });
    expect(r.ok).toBe(true);
    expect(r.value.fingerprint).toMatch(/^UI\|omega_3_shows_7_700000000000001g\|\d{4}-W\d{2}$/);
    expect(r.value.idem_key).toBe(r.value.fingerprint);
  });

  it('fails when criteria missing', () => {
    const r = packCheck({
      component: 'Nav',
      observed: 'tab 2 says Health',
      expected: 'Trends',
      criteria: '',
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toMatch(/criteria/);
  });

  it('fails when payload enumerates multiple issues (single-defect rule)', () => {
    const r = packCheck({
      component: 'Home',
      observed: '1. nav label wrong\n2. omega-3 float\n3. banner visible',
      expected: '1. Trends\n2. 7.7g\n3. absent',
      criteria: 'all fixed',
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toMatch(/split/);
  });
});

describe('splitMultiItemReport — BUG-8449 fixture', () => {
  const report = {
    title: 'Home dashboard discrepancies vs reference design',
    items: [
      { issue: 'Bottom nav tab 2 label/icon', observed: 'Health (pulse icon)', expected: 'Trends (line graph)' },
      { issue: 'Bottom nav tab 5 label/icon', observed: 'Trends (upward line)', expected: 'Progress (trending arrow)' },
      {
        issue: 'Omega-3 weekly target display',
        observed: '7.700000000000001g (floating-point artifact)',
        expected: '7.7g (clean)',
        component: 'Weekly targets',
        class: 'UI',
        surface: 'home',
      },
      { issue: 'Telemetry Errors banner', observed: 'Visible at top of page', expected: 'Absent' },
      { issue: 'Ready (5) status pill', observed: 'Missing from header', expected: 'Green pill with checkmark' },
      { issue: 'Extra sections present', observed: 'Health status / Clinical Action / Daily Benefits', expected: 'Absent' },
      { issue: "What's up today button", observed: 'Present under Daily Recommendation', expected: 'Absent' },
    ],
  };

  it('packs exactly one card (omega-3) and splits the other 6', () => {
    const r = splitMultiItemReport(report);
    expect(r.ok).toBe(true);
    expect(r.split).toHaveLength(6);
    expect(r.card.observed).toMatch(/7\.700000000000001/);
    expect(r.card.component).toBe('Weekly targets');
    // The packed card itself must pass packCheck (not re-bundled).
    const re = packCheck(r.card);
    expect(re.ok).toBe(true);
    // The original 7-item blob is recognized as bundled.
    expect(looksBundled(report.items.map((i) => i.issue).join('\n'), '')).toBe(true);
  });

  it('never returns a card whose observed lists multiple numbered defects', () => {
    const r = splitMultiItemReport(report);
    const numbered = /\n\s*\d+[.)]\s+/.test(r.card.observed);
    expect(numbered).toBe(false);
  });

  it('single-item report packs with no split list', () => {
    const r = splitMultiItemReport([
      { issue: 'Logout button dead', observed: 'Logout does nothing', expected: 'Session ends' },
    ]);
    expect(r.ok).toBe(true);
    expect(r.split).toHaveLength(0);
    expect(r.card.observed).toMatch(/Logout/);
  });
});

describe('vague report → needs_repro signal', () => {
  it('flags one-liner empty vibes as vague', () => {
    expect(isVagueReport('it looks wrong')).toBe(true);
    expect(isVagueReport('')).toBe(true);
  });

  it('accepts a concrete observable report as not vague', () => {
    const concrete =
      'On /home, the omega-3 weekly target pill renders 7.700000000000001g while the reference screenshot shows 7.7g.';
    expect(isVagueReport(concrete)).toBe(false);
  });
});

describe('duplicate → same fingerprint', () => {
  it('same class + key + iso week yields identical fingerprint (merge key)', () => {
    const at = '2026-09-22T12:00:00Z';
    const a = fingerprint('UI', 'omega-3 weekly target shows 7.700000000000001g', at);
    const b = fingerprint('UI', 'Omega-3 weekly target shows 7.700000000000001g', at);
    expect(a).toBe(b);
    expect(a.split('|')[2]).toBe(isoWeekKey(at));
  });

  it('different week keys do not collide', () => {
    const a = fingerprint('UI', 'omega-3', '2026-09-22T12:00:00Z');
    const b = fingerprint('UI', 'omega-3', '2026-10-06T12:00:00Z');
    expect(a).not.toBe(b);
  });
});

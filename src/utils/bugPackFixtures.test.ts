/**
 * Fixture gate for V-30.2 packer — pure helpers, no HTTP.
 * a) BUG-8449 7-item report → 1 card + split list (never bundled)
 * b) vague report → needs_repro signal
 * c) duplicate fingerprint → same key (merge entrypoint)
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  packCheck,
  splitMultiItemReport,
  isVagueReport,
  fingerprint,
  isoWeekKey,
  looksBundled,
  packForDispatch,
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

describe('packForDispatch (BOT-20)', () => {
  const root = path.resolve(__dirname, '../..');
  const dispatchScript = path.join(root, 'scripts/run-coding-dispatch.sh');

  it('accepts four fields (page, observed, expected, screenshot)', () => {
    const res = packForDispatch({
      page: 'Weekly targets',
      observed: 'Omega-3 shows 7.700000000000001g',
      expected: '7.7g',
      screenshot: '/tmp/screenshot.png',
      class: 'UI',
      surface: 'home',
    });
    expect(res.ok).toBe(true);
    expect(res.card.component).toBe('Weekly targets');
    expect(res.card.observed).toBe('Omega-3 shows 7.700000000000001g');
    expect(res.card.expected).toBe('7.7g');
    expect(res.card.criteria).toBe('named check proves this single discrepancy fixed');
    expect(res.card.fingerprint).toMatch(/^UI\|omega_3_shows_7_700000000000001g\|\d{4}-W\d{2}$/);
    expect(res.screenshot).toBe('/tmp/screenshot.png');
    expect(res.split).toHaveLength(0);
  });

  it('accepts versioned work_item with defect', () => {
    const res = packForDispatch({
      workItem: {
        public_n: 14,
        bug: 'floating point artifact',
        class: 'UI',
        surface: 'home',
        defect: {
          component: 'Weekly targets',
          observed: 'Omega-3 shows 7.700000000000001g',
          expected: '7.7g',
          criteria: 'renders 7.7g',
        },
      },
    });
    expect(res.ok).toBe(true);
    expect(res.card.component).toBe('Weekly targets');
    expect(res.card.expected).toBe('7.7g');
    expect(res.card.criteria).toBe('renders 7.7g');
    expect(res.split).toHaveLength(0);
  });

  it('splits multi-item report into 1 card + split list', () => {
    const res = packForDispatch({
      workItem: {
        title: 'Home discrepancies',
        items: [
          { issue: 'Bottom nav tab 2 label/icon', observed: 'Health (pulse icon)', expected: 'Trends (line graph)' },
          {
            issue: 'Omega-3 weekly target display',
            observed: '7.700000000000001g (floating-point artifact)',
            expected: '7.7g (clean)',
            component: 'Weekly targets',
          },
          { issue: 'Telemetry Errors banner', observed: 'Visible at top of page', expected: 'Absent' },
        ],
      },
    });
    expect(res.ok).toBe(true);
    expect(res.card.component).toBe('Weekly targets');
    expect(res.card.observed).toMatch(/7\.700000000000001/);
    expect(res.split).toHaveLength(2);
    expect(res.split[0].issue).toMatch(/Bottom nav tab 2/);
  });

  it('rejects vague reports without required defect fields', () => {
    const res = packForDispatch({ task: 'Fix X' });
    expect(res.ok).toBe(false);
    expect(res.issues).toContain('component required');
    expect(res.issues).toContain('observed required');
    expect(res.issues).toContain('expected required');
  });

  it('run-coding-dispatch.sh rejects vague tasks with non-zero exit', () => {
    try {
      execFileSync('bash', [dispatchScript, '--task=Fix X', '--bug-id=BUG-TEST'], {
        cwd: root,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      expect.fail('should have failed with exit code 1');
    } catch (e: any) {
      expect(e.status).toBe(1);
      expect(e.stderr || e.stdout).toMatch(/inbound defect report failed packCheck/);
    }
  });

  it('run-coding-dispatch.sh accepts four fields and prints plan', () => {
    const out = execFileSync(
      'bash',
      [
        dispatchScript,
        '--page=Weekly targets',
        '--observed=Omega-3 shows 7.700000000000001g',
        '--expected=7.7g',
        '--bug-id=BUG-8449',
        '--print-plan',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: 'pipe',
      }
    );
    expect(out).toMatch(/defect_component=Weekly targets/);
    expect(out).toMatch(/defect_fingerprint=OTHER\|omega_3_shows_7_700000000000001g/);
    expect(out).toMatch(/split_count=0/);
  });

  it('run-coding-dispatch.sh splits multi-item work_item on dispatch', () => {
    const workItemJson = JSON.stringify({
      title: 'Discrepancies',
      items: [
        { issue: 'nav tab', observed: 'Health', expected: 'Trends' },
        { issue: 'Omega-3', observed: '7.700000000000001g', expected: '7.7g', component: 'Weekly targets' },
      ],
    });
    const out = execFileSync(
      'bash',
      [
        dispatchScript,
        `--work-item=${workItemJson}`,
        '--bug-id=BUG-8449',
        '--print-plan',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: 'pipe',
      }
    );
    expect(out).toMatch(/defect_component=Weekly targets/);
    expect(out).toMatch(/split_count=1/);
  });
});


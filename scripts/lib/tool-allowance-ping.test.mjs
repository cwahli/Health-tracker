import { describe, it, expect } from 'vitest';

import {
  classifyPingResult,
  statusToVerdict,
  parseRetryHintMs,
  pickPingTargets,
  laneRouteForTool,
  buildPingSummary,
  PING_PROMPT,
  PING_VERDICTS,
} from './tool-allowance-ping.mjs';

const NOW = 1_750_000_000_000; // fixed clock for deterministic assertions

describe('PING_PROMPT', () => {
  it('is a minimal, single-token-response prompt', () => {
    expect(PING_PROMPT).toBe('Reply with exactly: ok');
  });

  it('exposes exactly the three verdicts', () => {
    expect(PING_VERDICTS).toEqual(['alive', 'depleted', 'inconclusive']);
  });
});

describe('classifyPingResult', () => {
  it('classifies text without quota errors as alive', () => {
    const r = classifyPingResult({ finalText: 'ok', lastError: '', code: 0 });
    expect(r.verdict).toBe('alive');
    expect(r.retryHint).toBe('');
  });

  it('classifies quota errors as depleted even with text (vendor proof wins)', () => {
    const r = classifyPingResult({ finalText: 'ok', lastError: 'rate limit exceeded' });
    expect(r.verdict).toBe('depleted');
  });

  it('classifies every known free-lane quota wording as depleted', () => {
    const wordings = [
      'insufficient account funds',
      'out of credits',
      'free_tier_limit reached',
      'HTTP 429: too many requests',
      'quota exhausted',
      'payment required (402)',
    ];
    for (const w of wordings) {
      expect(classifyPingResult({ lastError: w }).verdict).toBe('depleted');
    }
  });

  it('never depletes without proof: empty errors are inconclusive', () => {
    const r = classifyPingResult({ finalText: '', lastError: '', code: 1 });
    expect(r.verdict).toBe('inconclusive');
  });

  it('treats timeout/abort as inconclusive, never depleted (no auto-retry)', () => {
    const r = classifyPingResult({ finalText: '', lastError: 'timed out after 90000ms' });
    expect(r.verdict).toBe('inconclusive');
    expect(r.reason).toMatch(/never auto-retried/);
  });

  it('extracts the vendor retry hint alongside the depleted verdict', () => {
    const r = classifyPingResult({
      lastError: 'rate limit exceeded. try again in 3h 20m',
    });
    expect(r.verdict).toBe('depleted');
    expect(r.retryHint).toMatch(/Retry in ~3h 20m/);
  });

  it('prefers the filtered (small=true-cleaned) error over raw lastError', () => {
    const r = classifyPingResult({
      finalText: '',
      lastError: 'unrelated noise',
      filteredError: 'insufficient account funds',
    });
    expect(r.verdict).toBe('depleted');
    expect(r.reason).toContain('insufficient account funds');
  });
});

describe('statusToVerdict', () => {
  it('maps dispatch report-result statuses onto ping verdicts', () => {
    expect(statusToVerdict('success')).toBe('alive');
    expect(statusToVerdict('rate_limited')).toBe('depleted');
    expect(statusToVerdict('low_allowance')).toBe('depleted');
    expect(statusToVerdict('depleted')).toBe('depleted');
    expect(statusToVerdict('failed')).toBe('inconclusive');
    expect(statusToVerdict(null)).toBe('inconclusive');
  });
});

describe('parseRetryHintMs', () => {
  it('converts "Retry in ~3h 20m." to an absolute epoch', () => {
    const ms = parseRetryHintMs('Retry in ~3h 20m.', NOW);
    expect(ms).toBe(NOW + (3 * 3600 + 20 * 60) * 1000);
  });

  it('handles minutes-only and hours-only hints', () => {
    expect(parseRetryHintMs('Retry in ~45m.', NOW)).toBe(NOW + 45 * 60 * 1000);
    expect(parseRetryHintMs('Retry in ~2h.', NOW)).toBe(NOW + 2 * 3600 * 1000);
  });

  it('returns null when no usable time is present', () => {
    expect(parseRetryHintMs('', NOW)).toBeNull();
    expect(parseRetryHintMs('no numbers here', NOW)).toBeNull();
  });
});

describe('pickPingTargets', () => {
  const baseTool = { name: 'X', status: 'available', priority: 5 };
  const state = (tools) => ({ tools });

  it('selects healthy tools sorted by priority', () => {
    const targets = pickPingTargets(
      state({
        b: { ...baseTool, priority: 2 },
        a: { ...baseTool, priority: 1 },
        c: { ...baseTool, priority: 3 },
      }),
      { now: NOW }
    );
    expect(targets.map((t) => t.tool)).toEqual(['a', 'b', 'c']);
  });

  it('skips depleted, unavailable, not-installed and cooled-down tools', () => {
    const targets = pickPingTargets(
      state({
        dep: { ...baseTool, status: 'depleted' },
        geo: { ...baseTool, status: 'unavailable' },
        miss: { ...baseTool, status: 'not_installed' },
        cool: { ...baseTool, cooldown_until: new Date(NOW + 60_000).toISOString() },
        ok: { ...baseTool },
      }),
      { now: NOW }
    );
    expect(targets.map((t) => t.tool)).toEqual(['ok']);
  });

  it('restores a tool whose cooldown has already expired', () => {
    const targets = pickPingTargets(
      state({
        cool: { ...baseTool, cooldown_until: new Date(NOW - 60_000).toISOString() },
      }),
      { now: NOW }
    );
    expect(targets.map((t) => t.tool)).toEqual(['cool']);
  });

  it('filters to one tool when asked', () => {
    const targets = pickPingTargets(
      state({ a: { ...baseTool }, b: { ...baseTool } }),
      { tool: 'b', now: NOW }
    );
    expect(targets.map((t) => t.tool)).toEqual(['b']);
  });

  it('returns empty for a stateless input', () => {
    expect(pickPingTargets(null, { now: NOW })).toEqual([]);
  });
});

describe('laneRouteForTool', () => {
  it('maps an opencode default model to its lane route', () => {
    expect(laneRouteForTool({ defaultModel: 'nemotron-3.5-lightning-free' })).toEqual({
      provider: 'opencode',
      model: 'nemotron-3.5-lightning-free',
    });
  });

  it('returns null for tools without an opencode lane', () => {
    expect(laneRouteForTool({ defaultModel: 'grok-build' })).toBeNull();
    expect(laneRouteForTool({ defaultModel: 'gemini-flash' })).toBeNull();
    expect(laneRouteForTool({ defaultModel: '' })).toBeNull();
    expect(laneRouteForTool(null)).toBeNull();
  });
});

describe('buildPingSummary', () => {
  it('summarises counts and rows with reset stamps only for depleted', () => {
    const summary = buildPingSummary(
      [
        { tool: 'opencode', verdict: 'alive', reason: 'first text received, no quota error' },
        { tool: 'cline', verdict: 'depleted', reason: 'rate limit', retryHint: 'Retry in ~1h.' },
        { tool: 'grok', verdict: 'inconclusive', reason: 'no text and no quota proof' },
      ],
      { now: NOW }
    );
    expect(summary.counts).toEqual({ alive: 1, depleted: 1, inconclusive: 1 });
    const cline = summary.rows.find((r) => r.tool === 'cline');
    expect(cline.resetAt).toBe(new Date(NOW + 3600 * 1000).toISOString());
    expect(summary.rows.find((r) => r.tool === 'opencode').resetAt).toBeUndefined();
    expect(summary.rows.find((r) => r.tool === 'grok').resetAt).toBeUndefined();
  });

  it('falls back to the default TTL when the hint has no time', () => {
    const summary = buildPingSummary(
      [{ tool: 'opencode', verdict: 'depleted', reason: 'quota', retryHint: '' }],
      { now: NOW }
    );
    expect(summary.rows[0].resetAt).toBe(new Date(NOW + 6 * 3600 * 1000).toISOString());
  });

  it('handles an empty result set', () => {
    const summary = buildPingSummary([], { now: NOW });
    expect(summary.counts).toEqual({ alive: 0, depleted: 0, inconclusive: 0 });
    expect(summary.rows).toEqual([]);
  });
});

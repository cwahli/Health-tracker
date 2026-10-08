import { describe, it, expect } from 'vitest';

import {
  formatTokenCount,
  ctxLimitFor,
  formatUsageSuffix,
  formatWorkingHeadline,
} from './tg-progress.mjs';

describe('formatUsageSuffix', () => {
  it('shows tokens, the window and the share when the limit is known', () => {
    const { suffix, pct } = formatUsageSuffix({ used: 31900, ctxLimit: 200000 });
    expect(suffix).toBe(' - 31.9K/200.0K (16%)');
    expect(pct).toBeCloseTo(15.95, 6);
  });

  it('keeps the bare count, and no percent, when the limit is unknown', () => {
    expect(formatUsageSuffix({ used: 539 })).toEqual({ suffix: ' - 539', pct: null });
  });

  it('takes a live pct without inventing a window', () => {
    expect(formatUsageSuffix({ used: 150000, pct: 62.4 })).toEqual({ suffix: ' - 150.0K (62%)', pct: 62.4 });
  });

  it('emits nothing — not a zero — when no token count is known', () => {
    expect(formatUsageSuffix({})).toEqual({ suffix: '', pct: null });
    expect(formatUsageSuffix({ used: null, ctxLimit: 200000, pct: 40 })).toEqual({ suffix: '', pct: null });
  });
});

describe('formatTokenCount', () => {
  it('compacts thousands and millions like the router', () => {
    expect(formatTokenCount(210000)).toBe('210.0K');
    expect(formatTokenCount(1500000)).toBe('1.5M');
    expect(formatTokenCount(42)).toBe('42');
  });
});

describe('formatWorkingHeadline', () => {
  it('matches the Grok router line shape', () => {
    expect(
      formatWorkingHeadline({
        providerLabel: 'Cline',
        modelLabel: 'muse spark 1.3 contributor free',
        thinking: 'high',
        elapsedSec: 50,
      }),
    ).toBe('⏳ Cline muse spark 1.3 contributor free (high) working… 50s');
  });

  it('appends usage and percent when the limit is known', () => {
    const line = formatWorkingHeadline({
      providerLabel: 'Cline',
      modelLabel: 'glm-4.7-free',
      elapsedSec: 50,
      used: 39321,
      ctxLimit: ctxLimitFor('opencode/glm-4.7-free'),
    });
    expect(line).toContain('- 39.3K/131.1K (30%)');
  });

  it('honours a live pct override (router session status)', () => {
    const line = formatWorkingHeadline({
      providerLabel: 'OpenCode',
      modelLabel: 'muse spark',
      elapsedSec: 184,
      used: 150000,
      pct: 62.4,
    });
    expect(line).toBe('⏳ OpenCode muse spark working… 184s - 150.0K (62%)\n💡 Context warming up — /compact when you want a fresh window');
  });

  it('renders the same usage block the settled bubble does (one builder)', () => {
    const { suffix } = formatUsageSuffix({ used: 39321, ctxLimit: ctxLimitFor('glm-4.7-free') });
    expect(
      formatWorkingHeadline({
        providerLabel: 'Cline',
        modelLabel: 'glm-4.7-free',
        elapsedSec: 50,
        used: 39321,
        ctxLimit: ctxLimitFor('glm-4.7-free'),
      }),
    ).toContain(suffix);
  });

  it('warns as context fills', () => {
    expect(formatWorkingHeadline({ used: 80000, ctxLimit: 100000 })).toContain('⚠️');
    expect(formatWorkingHeadline({ used: 65000, ctxLimit: 100000 })).toContain('💡');
    expect(formatWorkingHeadline({ used: 10000, ctxLimit: 100000 })).not.toContain('⚠️');
  });
});

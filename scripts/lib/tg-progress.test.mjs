import { describe, it, expect } from 'vitest';

import {
  formatTokenCount,
  ctxLimitFor,
  formatWorkingHeadline,
} from './tg-progress.mjs';

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

  it('warns as context fills', () => {
    expect(formatWorkingHeadline({ used: 80000, ctxLimit: 100000 })).toContain('⚠️');
    expect(formatWorkingHeadline({ used: 65000, ctxLimit: 100000 })).toContain('💡');
    expect(formatWorkingHeadline({ used: 10000, ctxLimit: 100000 })).not.toContain('⚠️');
  });
});

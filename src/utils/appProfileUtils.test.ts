import { describe, it, expect } from 'vitest';
import { getDynamicStyles } from '../components/AppDynamicStyles';

describe('q-9 Node1 AppDynamicStyles parity (verbatim extract)', () => {
  it('returns empty string for falsy profile', () => {
    expect(getDynamicStyles(null)).toBe('');
    expect(getDynamicStyles(undefined)).toBe('');
  });

  it('emits font + color + design-token CSS for a themed profile', () => {
    const css = getDynamicStyles({
      themePalette: { button: '#123456', background: '#ffffff' },
      fontSize: 'normal',
      fontFamily: 'Inter',
      fontMono: 'JetBrains Mono',
    });
    expect(css).toContain('--font-sans');
    expect(css).toContain('#123456');
    expect(css).toContain('--spacing-factor');
  });

  it('scales every dynamic font size proportionally with fontScale', () => {
    const base = getDynamicStyles({ fontSize: 'normal', fontFamily: 'Inter', fontMono: 'JetBrains Mono' });
    expect(base).toContain('font-size: 17.6px');
    expect(base).toContain('--font-scale: 1.1');
    const big = getDynamicStyles({ fontSize: 'normal', fontFamily: 'Inter', fontMono: 'JetBrains Mono', fontScale: 1.2 });
    expect(big).toContain('font-size: 19.2px');
    expect(big).toContain('--font-scale: 1.2');
    expect(big).toContain('--font-size-body: 21.6px');
    const small = getDynamicStyles({ fontSize: 'normal', fontFamily: 'Inter', fontMono: 'JetBrains Mono', fontScale: 0.85 });
    expect(small).toContain('font-size: 13.6px');
  });

  it('clamps invalid fontScale values to the 1.1 default', () => {
    for (const bad of [undefined, null, NaN, 'huge']) {
      const css = getDynamicStyles({ fontSize: 'normal', fontFamily: 'Inter', fontMono: 'JetBrains Mono', fontScale: bad as any });
      expect(css).toContain('--font-scale: 1.1');
    }
    const low = getDynamicStyles({ fontSize: 'normal', fontFamily: 'Inter', fontMono: 'JetBrains Mono', fontScale: 0.2 });
    expect(low).toContain('--font-scale: 0.8');
    const high = getDynamicStyles({ fontSize: 'normal', fontFamily: 'Inter', fontMono: 'JetBrains Mono', fontScale: 5 });
    expect(high).toContain('--font-scale: 1.3');
  });
});

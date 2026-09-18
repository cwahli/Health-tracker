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
});

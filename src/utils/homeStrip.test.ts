import { describe, expect, it } from 'vitest';
import { homeStrip } from './homeStrip';

describe('home strip', () => {
  it('shows a confirmed hemorrhoid event and a confirmed sleep note, and hides a staged page', () => {
    const strip = homeStrip({
      facts: [
        { label: 'hemorrhoid diary', confirmed: true },
        { label: 'poor sleep', confirmed: true },
        { label: 'HDL', confirmed: false, value: 50 },
      ],
    });
    expect(strip.lines).toEqual(['hemorrhoid diary', 'poor sleep']);
    expect(strip.mealPayload.facts).toEqual(['hemorrhoid diary', 'poor sleep']);
    expect(strip.mealPayload.stagedLabNumbers).toEqual([]);
    expect(JSON.stringify(strip.mealPayload)).not.toContain('50');
  });
});

import { describe, it, expect } from 'vitest';
import { humanizeJobFailure } from './jobFailure';

describe('humanizeJobFailure', () => {
  it('explains a 90s stall as Vision Scout / quota hang', () => {
    const s = humanizeJobFailure('Stream stalled: No response from analysis engine within 90s.');
    expect(s).toMatch(/Vision Scout/i);
    expect(s).toMatch(/3\.1 Flash Lite/i);
    expect(s).not.toMatch(/Stream stalled: No response from analysis engine/);
  });

  it('explains 429 as model quota', () => {
    const s = humanizeJobFailure('429 RESOURCE_EXHAUSTED gemini-3.5-flash-lite');
    expect(s).toMatch(/quota/i);
    expect(s).toMatch(/3\.1 Flash Lite/i);
  });

  it('never leaks Vision Scout Corrupted to the caller', () => {
    const s = humanizeJobFailure('[Vision Scout Corrupted] Sanity check failed: Item field packageLabelText length (4000) exceeds 150');
    expect(s).not.toMatch(/Vision Scout Corrupted/);
    expect(s).toMatch(/Analysis failed/i);
    const nested = humanizeJobFailure("Vision Scout Failed: Couldn't reliably read this image (Details: [Vision Scout Corrupted] foo)");
    expect(nested).not.toMatch(/Vision Scout Corrupted/);
  });

  it('F1: never renders raw API JSON / key-validity text / status codes', () => {
    const qaLeak = `Vision Scout Failed: Couldn't reliably read this image, please try again or re-upload. (Details: {"error": {"code":400,"message":"API key not valid. Please pass a valid API key."}})`;
    const s = humanizeJobFailure(qaLeak);
    expect(s).not.toMatch(/Details:/);
    expect(s).not.toMatch(/API key/);
    expect(s).not.toMatch(/\{/);
    expect(s).not.toMatch(/400/);
    expect(s).not.toMatch(/image/i);
    expect(humanizeJobFailure('Request failed (400). Please try again.\nDetails: {"error":{}}')).toBe('Analysis failed. Please try again.');
    expect(humanizeJobFailure("Vision Scout Failed: Couldn't analyze this meal. Please try again.")).toBe("Couldn't analyze this meal. Please try again.");
  });
});

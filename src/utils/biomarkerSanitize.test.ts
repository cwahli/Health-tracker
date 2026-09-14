import { describe, it, expect } from 'vitest';
import { isExcludedDeviceMetric } from './biomarkers';

describe('biomarkerSanitize', () => {
  it('does not flag everyday step counts as improbable', () => {
    expect(isExcludedDeviceMetric('step_count')).toBe(true);
  });
});

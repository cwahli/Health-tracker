import { describe, it, expect } from 'vitest';
import { evaluateResolverConfidence, buildVisionCropReQuery } from '../reflection';

describe('Bi-directional Agent Reflection Loop', () => {
  it('triggers crop re-query for low match confidence (< 60%)', () => {
    const gap = {
      query: 'mystery soup with dark sauce and floating dumplings',
      candidates: [{ id: 'fdc-999', name: 'clear vegetable broth' }],
      confidenceScore: 0.3
    };

    const evalResult = evaluateResolverConfidence(gap);
    expect(evalResult.needsCropReQuery).toBe(true);
    expect(evalResult.confidenceScore).toBe(0.3);
    expect(evalResult.targetedCropPrompt).toContain('Focus crop re-query on "mystery soup with dark sauce and floating dumplings"');
  });

  it('passes high confidence matches without requiring re-query', () => {
    const gap = {
      query: 'grilled chicken breast',
      candidates: [{ id: 'fdc-100', name: 'chicken breast grilled cooked' }],
      confidenceScore: 0.95,
      chosenFdcId: 'fdc-100'
    };

    const evalResult = evaluateResolverConfidence(gap);
    expect(evalResult.needsCropReQuery).toBe(false);
    expect(evalResult.confidenceScore).toBe(0.95);
  });

  it('builds a structured vision crop re-query payload', () => {
    const cropReq = buildVisionCropReQuery('fried fish cake', 2);
    expect(cropReq.query).toBe('fried fish cake');
    expect(cropReq.action).toBe('crop_requery');
    expect(cropReq.scoutIndex).toBe(2);
    expect(cropReq.prompt).toContain('Focus crop re-query on "fried fish cake"');
  });
});

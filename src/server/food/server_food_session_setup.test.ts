import { describe, it, expect } from 'vitest';
import { collectImagePayloads, decideWeightRefine } from './server_food_session_setup';

describe('F-8.10 shard 13 — image payload collection', () => {
  it('collects and dedupes image payloads', () => {
    expect(collectImagePayloads('a', ['a', 'b', null])).toEqual(['a', 'b']);
    expect(collectImagePayloads(null, null)).toEqual([]);
    expect(collectImagePayloads('a', 'not-array')).toEqual(['a']);
  });
});

describe('F-8.10 shard 13 — weight-refine triad', () => {
  it('stays on the full pipeline for plain log requests', () => {
    const out = decideWeightRefine({ body: {}, message: 'log lunch', imagePayloads: [{}], activeMeal: null });
    expect(out.priorScoutForRefine).toEqual([]);
    expect(out.refineDecision.skip).toBe(false);
    expect(out.isPureWeightModification).toBe(false);
  });

  it('flags pure absolute-grams refine on an imageless active meal', () => {
    const out = decideWeightRefine({
      body: {},
      message: 'make it 150g',
      imagePayloads: [],
      activeMeal: { itemsBreakdown: [{ name: 'oats' }] },
    });
    expect(out.weightRefineIntent.isRefine).toBe(true);
    expect(out.isPureWeightModification).toBe(true);
  });

  it('refuses pure-modification when the message carries edit verbs', () => {
    const out = decideWeightRefine({
      body: {},
      message: 'remove the oats and make it 150g',
      imagePayloads: [],
      activeMeal: { itemsBreakdown: [{ name: 'oats' }] },
    });
    expect(out.isPureWeightModification).toBe(false);
  });
});

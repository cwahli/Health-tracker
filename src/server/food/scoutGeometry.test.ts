import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  LABEL_STOPWORDS,
  tokenizeScoutName,
  canMergeScoutLabelIntoFood,
  validateOrFallback,
  mergeScoutItems,
  isUsableBoundingBox,
  isDummyFullFrameBox,
  sliceParentBoxByWeights,
  boxForUnrolledFood,
  clusterSpatialCompositeDishes,
} from './scoutGeometry';
// Contract: root re-exports keep every historical importer green (L2).
// checkScoutSanity + userSafeScoutFailureMessage stay in server_vision_scout.ts
// beside parseAndHealVisionScout (Hypothesis 2); assert them via the root.
import * as scout from '../../../server_vision_scout';

describe('q-9 Node3 scoutGeometry parity (verbatim extract, hypothesis 2)', () => {
  it('re-exports preserve the server_vision_scout contract', () => {
    for (const k of [
      'canMergeScoutLabelIntoFood',
      'mergeScoutItems',
      'isUsableBoundingBox',
      'isDummyFullFrameBox',
      'sliceParentBoxByWeights',
      'boxForUnrolledFood',
      'clusterSpatialCompositeDishes',
    ]) {
      expect((scout as any)[k], k).toBe(({
        canMergeScoutLabelIntoFood,
        mergeScoutItems,
        isUsableBoundingBox,
        isDummyFullFrameBox,
        sliceParentBoxByWeights,
        boxForUnrolledFood,
        clusterSpatialCompositeDishes,
      } as any)[k]);
    }
  });

  it('sanity + safe-message stay on the root beside parseAndHeal', () => {
    expect(typeof (scout as any).checkScoutSanity).toBe('function');
    expect(typeof (scout as any).userSafeScoutFailureMessage).toBe('function');
    expect((scout as any).checkScoutSanity({ items: [{ originalName: 'rice' }] }, () => {}).valid).toBe(true);
    expect((scout as any).userSafeScoutFailureMessage('[Vision Scout Corrupted] x')).toBe('Analysis failed');
  });

  it('tokenize + label-merge keep ham-type guard', () => {
    expect(LABEL_STOPWORDS.has('nutrition')).toBe(true);
    expect(tokenizeScoutName('Serrano Ham 100g')).toContain('serrano');
    const d = canMergeScoutLabelIntoFood(
      { originalName: 'Serrano Ham' },
      { originalName: 'Cooked Reformed Ham' },
    );
    expect(d.ok).toBe(false);
  });

  it('geometry helpers slice parent boxes', () => {
    expect(isUsableBoundingBox([0, 0, 1000, 1000])).toBe(true);
    expect(isUsableBoundingBox(null)).toBe(false);
    expect(isDummyFullFrameBox([0, 0, 1000, 1000])).toBe(true);
    const slice = sliceParentBoxByWeights([0, 0, 1000, 1000], [1, 1], 1);
    expect(slice[0]).toBe(500);
    expect(boxForUnrolledFood([10, 10, 100, 100], [0, 0, 1000, 1000], [1], 0)).toEqual([10, 10, 100, 100]);
  });

  it('merge + cluster + validate keep semantics', () => {
    expect(mergeScoutItems([{ a: 1 }], [])).toEqual([{ a: 1 }]);
    expect(clusterSpatialCompositeDishes([], () => {})).toEqual([]);
    const schema = z.object({ items: z.array(z.object({ a: z.string().optional() })).optional() });
    const out = validateOrFallback(schema, { items: [{ a: 'x' }] }, 'raw', 't', { items: [] }, () => {});
    expect(out).toEqual({ items: [{ a: 'x' }] });
  });
});

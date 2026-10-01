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
    // card-19 guard: a single dish returns early, so the box work must not start
    // inventing components on ordinary one-dish meals.
    const solo = { originalName: 'Green Grapes', boundingBox2D: [390, 110, 875, 880] };
    expect(clusterSpatialCompositeDishes([solo], () => {})[0]).toBe(solo);
    const schema = z.object({ items: z.array(z.object({ a: z.string().optional() })).optional() });
    const out = validateOrFallback(schema, { items: [{ a: 'x' }] }, 'raw', 't', { items: [] }, () => {});
    expect(out).toEqual({ items: [{ a: 'x' }] });
  });

  it('does not merge separate whole fruits or produce across containers into composite dishes', () => {
    const items = [
      {
        originalName: 'Green Grapes',
        keyword: 'green grapes',
        estimatedWeightGrams: 80,
        sourceImageIndex: 0,
        boundingBox2D: [390, 110, 860, 880],
      },
      {
        originalName: 'Plum',
        keyword: 'plum',
        estimatedWeightGrams: 100,
        sourceImageIndex: 0,
        boundingBox2D: [631, 658, 920, 882],
      },
    ];
    const clustered = clusterSpatialCompositeDishes(items, () => {});
    expect(clustered).toHaveLength(2);
    expect(clustered[0].originalName).toBe('Green Grapes');
    expect(clustered[1].originalName).toBe('Plum');
  });

  // card-19: clustering unions boxes onto the composite (correct) but never
  // copied each component's own box, destroying it. Boxes: job_1790784359089_kvt6r0c0g.
  type Box = [number, number, number, number];
  const OATS: Box = [250, 100, 955, 990], GRAPES: Box = [390, 110, 875, 880];
  const d = (name: string, box: Box, g: number) => ({
    originalName: name, keyword: name, name, estimatedWeightGrams: g, weightGrams: g,
    boundingBox2D: box, sourceImageIndex: 0, calories: g, nutrients: { calories: g, protein: 2, totalFat: 1, saturatedFat: 0.2, carbohydrates: 10, sodium: 50 },
  });
  const comps = (o: any[]) => o[0].compositeSiblings ?? o[0].components;
  it('keeps each clustered component\'s own boundingBox2D (card-19)', () => {
    const out = clusterSpatialCompositeDishes([d('Sainsbury Oat and Fruit', OATS, 220), d('Green Grapes', GRAPES, 100)], () => {});
    expect(out).toHaveLength(1);
    expect(out[0].hasComponents).toBe(true);
    expect(comps(out)).toHaveLength(2);  // one composite, two components
    const by = new Map<string, any>(comps(out).map((c: any) => [String(c.name), c])); // both undefined before the fix
    expect(by.get('Sainsbury Oat and Fruit')?.boundingBox2D).toEqual(OATS);
    expect(by.get('Green Grapes')?.boundingBox2D).toEqual(GRAPES);
    expect(by.get('Green Grapes')?.sourceImageIndex).toBe(0);
    expect(out[0].boundingBox2D).toEqual(OATS); // composite stays the union
  });

  it("a parent's own box reaches its sub-components (the other push site)", () => {
    // Each `c` has no box, so the parent's is the only honest annotation.
    const parent: any = d('Sainsbury Oat and Fruit', OATS, 220);
    parent.components = [
      { name: 'Oats', weightGrams: 140, volumePercentage: 64, searchQuery: 'oats' },
      { name: 'Dried fruit', weightGrams: 80, volumePercentage: 36, searchQuery: 'dried fruit' },
    ];
    const out = clusterSpatialCompositeDishes([parent, d('Green Grapes', GRAPES, 100)], () => {});
    expect(out).toHaveLength(1);
    for (const n of ['Oats', 'Dried fruit', 'Green Grapes']) {
      expect(comps(out).find((c: any) => String(c.name) === n)?.boundingBox2D)
        .toEqual(n === 'Green Grapes' ? GRAPES : OATS); // the fallback must not overwrite
    }
  });
});

import { describe, it, expect } from 'vitest';
import {
  parentIdOfTag,
  stampChildLineage,
  findMasterMeal,
  findChildMeals,
  propagateMasterUpdate,
  propagateDownstream,
  applyReviewMealId,
  resolveInboxSaveId,
} from './savedMealLineage';

const savedTag = (dbId: string, name = 'Mr. Oat Quick Cook Oatmeal'): any => ({
  dbId,
  name,
  source: 'previous_meal',
  weightGrams: 130,
  originalLog: { id: dbId, name },
});
const freshTag = (name = 'Banana'): any => ({ name, source: 'catalog_tag', weightGrams: 120 });

describe('parentIdOfTag', () => {
  it('returns the saved meal id for previous_meal tags only', () => {
    expect(parentIdOfTag(savedTag('m1'))).toBe('m1');
    expect(parentIdOfTag(freshTag())).toBeUndefined();
    expect(parentIdOfTag({ source: 'previous_meal', name: 'X' } as any)).toBeUndefined();
    expect(parentIdOfTag(null)).toBeUndefined();
  });
});

describe('stampChildLineage', () => {
  it('stamps a single saved-meal tray as a child with per-item parents', () => {
    const items = [{ name: 'Mr. Oat Quick Cook Oatmeal', calories: 208 }];
    const { sourceMealId, items: out } = stampChildLineage([savedTag('m1')], items);
    expect(sourceMealId).toBe('m1');
    expect(out[0].parentMealId).toBe('m1');
    expect(out[0].calories).toBe(208);
  });

  it('leaves mixed trays parentless but attributes each saved item', () => {
    const items = [{ name: 'Oat' }, { name: 'Banana' }];
    const { sourceMealId, items: out } = stampChildLineage([savedTag('m1'), freshTag()], items);
    expect(sourceMealId).toBeUndefined();
    expect(out[0].parentMealId).toBe('m1');
    expect(out[1].parentMealId).toBeUndefined();
  });

  it('supports children of two different masters in one tray', () => {
    const items = [{ name: 'Oat' }, { name: 'Rice' }];
    const { sourceMealId, items: out } = stampChildLineage([savedTag('m1'), savedTag('m2', 'Rice')], items);
    expect(sourceMealId).toBeUndefined();
    expect(out.map((i) => i.parentMealId)).toEqual(['m1', 'm2']);
  });

  it('leaves fresh trays untouched', () => {
    const items = [{ name: 'Banana' }];
    const { sourceMealId, items: out } = stampChildLineage([freshTag()], items);
    expect(sourceMealId).toBeUndefined();
    expect(out[0].parentMealId).toBeUndefined();
  });
});

describe('findMasterMeal / findChildMeals', () => {
  const a: any = { id: 'a', name: 'Master' };
  const b: any = { id: 'b', name: 'Child', sourceMealId: 'a' };
  const c: any = { id: 'c', name: 'Grandchild', sourceMealId: 'b' };
  const logs = [a, b, c];

  it('walks chains to the root master', () => {
    expect(findMasterMeal(c, logs).id).toBe('a');
    expect(findMasterMeal(b, logs).id).toBe('a');
    expect(findMasterMeal(a, logs).id).toBe('a');
  });

  it('stops at missing ancestors and cycles', () => {
    expect(findMasterMeal({ id: 'x', sourceMealId: 'gone' }, logs).id).toBe('x');
    const cyc1: any = { id: 'c1', sourceMealId: 'c2' };
    const cyc2: any = { id: 'c2', sourceMealId: 'c1' };
    expect(findMasterMeal(cyc1, [cyc1, cyc2]).id).toBe('c1');
  });

  it('lists direct children only', () => {
    expect(findChildMeals('a', logs).map((l) => l.id)).toEqual(['b']);
    expect(findChildMeals('b', logs).map((l) => l.id)).toEqual(['c']);
    expect(findChildMeals('', logs)).toEqual([]);
  });
});

describe('propagateMasterUpdate', () => {
  const master: any = {
    id: 'm1',
    name: 'Mr. Oat Quick Cook Oatmeal (New Recipe)',
    weightGrams: 200,
    nutrients: { calories: 400, protein: 20, carbohydrates: 60 },
    calories: 400,
    imageUrl: '/photos/master.jpg',
    imageUrls: ['/photos/master.jpg'],
    itemsBreakdown: [
      {
        name: 'Mr. Oat',
        weightGrams: 200,
        calories: 400,
        protein: 20,
        imageUrl: '/photos/master-item.jpg',
        dbSource: 'label',
        rawNutritionLabel: { servingSize: '200g' },
      },
    ],
  };
  const child: any = {
    id: 'c1',
    name: 'Mr. Oat Quick Cook Oatmeal',
    sourceMealId: 'm1',
    weightGrams: 100,
    nutrients: { calories: 150, protein: 5, fiber: 9 },
    calories: 150,
    imageUrl: '/photos/old.jpg',
    itemsBreakdown: [{ name: 'Mr. Oat', weightGrams: 100, calories: 150 }],
  };

  it('re-scales nutrients to the child weight and follows name/photos', () => {
    const out = propagateMasterUpdate(master, child);
    expect(out.nutrients.calories).toBe(200);
    expect(out.nutrients.protein).toBe(10);
    expect(out.calories).toBe(200);
    expect(out.name).toBe('Mr. Oat Quick Cook Oatmeal (New Recipe)');
    expect(out.imageUrl).toBe('/photos/master.jpg');
    expect(out.weightGrams).toBe(100);
  });

  it('updates the matched item row including OCR provenance', () => {
    const out = propagateMasterUpdate(master, child);
    const item = out.itemsBreakdown[0];
    expect(item.calories).toBe(200);
    expect(item.imageUrl).toBe('/photos/master-item.jpg');
    expect(item.dbSource).toBe('label');
    expect(item.rawNutritionLabel).toEqual({ servingSize: '200g' });
  });

  it('preserves child-only keys and never mutates inputs', () => {
    const out = propagateMasterUpdate(master, child);
    expect(out.nutrients.fiber).toBe(9);
    expect(child.nutrients.calories).toBe(150);
    expect(child.name).toBe('Mr. Oat Quick Cook Oatmeal');
    expect(out.updated_at).toBeGreaterThan(0);
  });
});

describe('propagateDownstream', () => {
  it('updates children and grandchildren from the edited root', () => {
    const root: any = {
      id: 'm', name: 'Oat v2', weightGrams: 200,
      nutrients: { calories: 400 }, imageUrls: ['/photos/m.jpg'],
      itemsBreakdown: [],
    };
    const kid: any = { id: 'k', name: 'Oat', sourceMealId: 'm', weightGrams: 100, nutrients: { calories: 150 } };
    const grand: any = { id: 'g', name: 'Oat', sourceMealId: 'k', weightGrams: 50, nutrients: { calories: 60 } };
    const out = propagateDownstream(root, [root, kid, grand]);
    expect(out.get('m').name).toBe('Oat v2');
    expect(out.get('k').nutrients.calories).toBe(200);
    expect(out.get('k').name).toBe('Oat v2');
    expect(out.get('g').nutrients.calories).toBe(100);
    expect(out.size).toBe(3);
  });

  it('returns just the root when there are no children', () => {
    const root: any = { id: 'solo', name: 'Solo', weightGrams: 100, nutrients: {} };
    const out = propagateDownstream(root, [root]);
    expect(out.size).toBe(1);
  });
});

describe('applyReviewMealId', () => {
  it('keeps the reviewed log id on a fresh analysis', () => {
    const out = applyReviewMealId({ id: 'food_new_1', name: 'Oat' }, 'food_orig_9');
    expect(out.id).toBe('food_orig_9');
    expect(out.name).toBe('Oat');
  });

  it('is a no-op for blank ids and non-objects', () => {
    const food = { id: 'a' };
    expect(applyReviewMealId(food, '')).toBe(food);
    expect(applyReviewMealId(food, null)).toBe(food);
    expect(applyReviewMealId(null, 'x')).toBeNull();
  });
});

describe('resolveInboxSaveId', () => {
  it('prefers the review link over the pending id', () => {
    expect(resolveInboxSaveId({ inputSnapshot: { reviewMealId: 'food_orig_9' } }, { id: 'food_new_1' })).toBe('food_orig_9');
  });

  it('falls back to the pending id, then undefined', () => {
    expect(resolveInboxSaveId({ inputSnapshot: {} }, { id: 'food_new_1' })).toBe('food_new_1');
    expect(resolveInboxSaveId({}, {})).toBeUndefined();
    expect(resolveInboxSaveId(null, null)).toBeUndefined();
  });
});

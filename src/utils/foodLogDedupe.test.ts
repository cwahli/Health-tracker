import { describe, it, expect } from 'vitest';
import {
  foodLogFingerprint,
  mergeFoodLogsDeduped,
  rehydrateFoodImagesFromDonors,
} from './foodLogDedupe';

const yolk = (overrides: any = {}) => ({
  id: overrides.id || 'a',
  name: 'YOLK Breakfast Bowl',
  date: '2026-08-08',
  weightGrams: 350,
  updated_at: overrides.updated_at ?? 1,
  imageUrl: overrides.imageUrl,
  imageUrls: overrides.imageUrls,
  nutrients: { calories: 450 },
  ...overrides,
});

describe('foodLogFingerprint', () => {
  it('is stable across whitespace/case differences in name', () => {
    const a = foodLogFingerprint(yolk({ name: 'YOLK Breakfast Bowl' }));
    const b = foodLogFingerprint(yolk({ name: '  yolk breakfast bowl  ' }));
    expect(a).toBe(b);
  });

  it('normalizes DD-MM-YYYY and YYYY-MM-DD to same day', () => {
    const a = foodLogFingerprint(yolk({ date: '2026-08-06' }));
    const b = foodLogFingerprint(yolk({ date: '06-08-2026' }));
    expect(a).toBe(b);
  });

  it('collapses ISO datetime to calendar day', () => {
    const a = foodLogFingerprint(yolk({ date: '2026-08-06' }));
    const b = foodLogFingerprint(yolk({ date: '2026-08-06T18:30:00.000Z' }));
    expect(a).toBe(b);
  });
});

describe('mergeFoodLogsDeduped', () => {
  it('collapses two rows with same day/name/kcal but different ids into one', () => {
    const local = [yolk({ id: 'local-1', updated_at: 1 })];
    const cloud = [yolk({ id: 'cloud-2', updated_at: 2 })];
    const result = mergeFoodLogsDeduped(local, cloud);
    expect(result).toHaveLength(1);
  });

  it('keeps both when calories differ (different meal)', () => {
    const local = [yolk({ id: 'local-1' })];
    const cloud = [yolk({ id: 'cloud-2', nutrients: { calories: 900 } })];
    const result = mergeFoodLogsDeduped(local, cloud);
    expect(result).toHaveLength(2);
  });

  it('prefers the side with a real image when collapsing duplicates', () => {
    const local = [yolk({ id: 'local-1', updated_at: 5, imageUrl: undefined })];
    const cloud = [
      yolk({ id: 'cloud-2', updated_at: 1, imageUrl: 'https://cdn.example.com/real.jpg' }),
    ];
    const result = mergeFoodLogsDeduped(local, cloud);
    expect(result).toHaveLength(1);
    expect(result[0].imageUrl).toBe('https://cdn.example.com/real.jpg');
  });

  it('collapses oatmeal-style duplicates and keeps image', () => {
    const a = {
      id: 'id1',
      name: 'Oatmeal with Fruit and Fresh Produce Selection',
      date: '2026-08-06',
      nutrients: { calories: 405 },
      imageUrl: 'https://cdn.example.com/oats.jpg',
      updated_at: 1,
    };
    const b = {
      id: 'id2',
      name: 'Oatmeal with Fruit and Fresh Produce Selection',
      date: '06-08-2026',
      nutrients: { calories: 405 },
      imageUrl: '[image_removed_for_snapshot]',
      updated_at: 2,
    };
    const result = mergeFoodLogsDeduped([a], [b]);
    expect(result).toHaveLength(1);
    expect(result[0].imageUrl).toBe('https://cdn.example.com/oats.jpg');
  });
});

describe('rehydrateFoodImagesFromDonors', () => {
  it('copies image by fingerprint when ids differ', () => {
    const targets = [
      yolk({ id: 'cloud-new', imageUrl: '[image_removed_for_snapshot]', imageUrls: [] }),
    ];
    const donors = [
      yolk({
        id: 'local-old',
        imageUrl: 'https://cdn.example.com/meal.jpg',
      }),
    ];
    const out = rehydrateFoodImagesFromDonors(targets, donors);
    expect(out[0].imageUrl).toBe('https://cdn.example.com/meal.jpg');
  });

  it('does not append a donor photo when the target already has one', () => {
    const targets = [
      yolk({
        id: 'cloud-new',
        imageUrl: 'https://cdn.example.com/mine.jpg',
        imageUrls: ['https://cdn.example.com/mine.jpg'],
      }),
    ];
    const donors = [
      yolk({
        id: 'local-old',
        imageUrl: 'https://cdn.example.com/other.jpg',
        imageUrls: ['https://cdn.example.com/other.jpg'],
      }),
    ];
    const out = rehydrateFoodImagesFromDonors(targets, donors);
    expect(out[0].imageUrls).toEqual(['https://cdn.example.com/mine.jpg']);
    expect(out[0].imageUrls).not.toContain('https://cdn.example.com/other.jpg');
  });
});

describe('soft name merge (YOLK variants)', () => {
  it('collapses Chimi Salad Bowl vs Steak Bowl same day same kcal', () => {
    const a: any = {
      id: 'a1',
      name: 'Yolk Chicken Sandwich and Steak Salad Bowl',
      date: '2026-08-07',
      nutrients: { calories: 1410 },
      updated_at: 1,
    };
    const b: any = {
      id: 'b1',
      name: 'Yolk Chicken Sandwich and Steak Bowl',
      date: '07-08-2026',
      nutrients: { calories: 1410 },
      imageUrl: 'https://cdn.example.com/yolk.jpg',
      updated_at: 2,
    };
    const result = mergeFoodLogsDeduped([a], [b]);
    expect(result).toHaveLength(1);
    expect(result[0].imageUrl).toBe('https://cdn.example.com/yolk.jpg');
  });

  it('pickBetter does not keep r2 + proxy as two slides', () => {
    const a: any = {
      id: 'same',
      name: 'Tofu Beef',
      date: '2026-09-10',
      nutrients: { calories: 400 },
      imageUrl: 'https://pub-xxx.r2.dev/photos/job_tofu.jpg',
      imageUrls: ['https://pub-xxx.r2.dev/photos/job_tofu.jpg'],
      updated_at: 1,
    };
    const b: any = {
      ...a,
      imageUrl: '/photos/job_tofu.jpg',
      imageUrls: ['/photos/job_tofu.jpg'],
      updated_at: 2,
    };
    const result = mergeFoodLogsDeduped([a], [b]);
    expect(result).toHaveLength(1);
    expect(result[0].imageUrls).toHaveLength(1);
    expect(result[0].imageUrls[0]).toBe('/photos/job_tofu.jpg');
  });

  it('collapses identical oatmeal / honi with date format drift', () => {
    const o1: any = {
      id: 'o1',
      name: 'Oatmeal with Fruit and Fresh Produce Selection',
      date: '2026-08-06',
      nutrients: { calories: 405 },
    };
    const o2: any = {
      id: 'o2',
      name: 'Oatmeal with Fruit and Fresh Produce Selection',
      date: '06-08-2026',
      nutrients: { calories: 405 },
      imageUrl: 'https://cdn.example.com/oats.jpg',
    };
    expect(mergeFoodLogsDeduped([o1, o2], [])).toHaveLength(1);

    const h1 = {
      id: 'h1',
      name: 'Honi Poke Salmon Poke Bowl with Sides',
      date: '2026-08-04',
      nutrients: { calories: 1176 },
    };
    const h2 = {
      id: 'h2',
      name: 'Honi Poke Salmon Poke Bowl with Sides',
      date: '04-08-2026',
      nutrients: { calories: 1176 },
    };
    expect(mergeFoodLogsDeduped([h1, h2], [])).toHaveLength(1);
  });
});

/**
 * Saved-meal reuse loses pictures, nutrition values and OCR provenance when the
 * sync list snapshot (which omits items_breakdown by egress design) wins the
 * dedupe. Winner selection is about recency/photos; it must never erase
 * evidence only the sibling holds.
 */
describe('mergeFoodLogsDeduped carries evidence across a collapse', () => {
  const richLocal = (overrides: any = {}) => ({
    id: 'local-1',
    name: 'Mr. Oat Quick Cook Oatmeal',
    date: '2026-08-08',
    weightGrams: 130,
    updated_at: 1,
    imageUrl: '/photos/local-1.jpg',
    imageUrls: ['/photos/local-1.jpg', '/photos/local-1-2.jpg'],
    calories: 150,
    protein: 5,
    nutrients: { calories: 150, protein: 5, carbohydrates: 27 },
    itemsBreakdown: [
      {
        id: 'local-1-i0',
        name: 'Mr. Oat Quick Cook Oatmeal',
        weight: '130g',
        weightGrams: 130,
        calories: 150,
        protein: 5,
        carbohydrates: 27,
        imageUrl: '/photos/local-1-i0.jpg',
        dbSource: 'label',
        rawNutritionLabel: { servingSize: '100g', calories: '150' },
        labelNutrientsPerServing: { calories: 150, protein: 5 },
      },
    ],
    ...overrides,
  });

  // Exactly what the list/pull snapshot returns: no items_breakdown, no item images.
  // Same id: the cloud copy and the local copy are the same food_logs record.
  const trimmedCloud = (overrides: any = {}) => ({
    id: 'local-1',
    name: 'Mr. Oat Quick Cook Oatmeal',
    date: '2026-08-08',
    weightGrams: 130,
    updated_at: 1_720_000_000_000,
    imageUrl: '/photos/cloud-2.jpg',
    imageUrls: ['/photos/cloud-2.jpg'],
    calories: 150,
    nutrients: { calories: 150 },
    ...overrides,
  });

  it('keeps the sibling per-item list (nutrition + OCR evidence) when the cloud row wins', () => {
    const result = mergeFoodLogsDeduped([richLocal()], [trimmedCloud()]);
    expect(result).toHaveLength(1);
    expect(result[0].imageUrl).toBe('/photos/cloud-2.jpg');
    const items = result[0].itemsBreakdown;
    expect(items).toHaveLength(1);
    expect(items[0].calories).toBe(150);
    expect(items[0].dbSource).toBe('label');
    expect(items[0].rawNutritionLabel).toEqual({ servingSize: '100g', calories: '150' });
    expect(items[0].labelNutrientsPerServing).toEqual({ calories: 150, protein: 5 });
    expect(items[0].imageUrl).toBe('/photos/local-1-i0.jpg');
  });

  it('keeps macro values the winner does not carry', () => {
    const result = mergeFoodLogsDeduped([richLocal()], [trimmedCloud()]);
    expect(result[0].nutrients.calories).toBe(150);
    expect(result[0].nutrients.protein).toBe(5);
    expect(result[0].nutrients.carbohydrates).toBe(27);
    expect(result[0].protein).toBe(5);
  });

  it('keeps nutrients when the winning row ships an empty nutrients object', () => {
    const cloud = trimmedCloud({ nutrients: {}, calories: 0 });
    const result = mergeFoodLogsDeduped([richLocal()], [cloud]);
    expect(result[0].nutrients.calories).toBe(150);
    expect(result[0].nutrients.carbohydrates).toBe(27);
  });

  it('carries item evidence onto the winning item when both sides describe the same item', () => {
    const cloud = trimmedCloud({
      itemsBreakdown: [{ id: 'cloud-2-i0', name: 'Mr. Oat Quick Cook Oatmeal', weight: '130g', weightGrams: 130 }],
    });
    const result = mergeFoodLogsDeduped([richLocal()], [cloud]);
    const items = result[0].itemsBreakdown;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('cloud-2-i0');
    expect(items[0].calories).toBe(150);
    expect(items[0].dbSource).toBe('label');
  });

  it('carries evidence across a cross-device duplicate (different ids, same fingerprint)', () => {
    const result = mergeFoodLogsDeduped([richLocal()], [trimmedCloud({ id: 'cloud-2' })]);
    expect(result).toHaveLength(1);
    const items = result[0].itemsBreakdown;
    expect(items).toHaveLength(1);
    expect(items[0].calories).toBe(150);
    expect(items[0].dbSource).toBe('label');
    expect(result[0].protein).toBe(5);
  });

  it('does not invent evidence when neither side has any', () => {
    const bare: any = {
      id: 'bare-1',
      name: 'Mystery Meal',
      date: '2026-08-08',
      updated_at: 10,
      imageUrl: '/photos/bare-1.jpg',
      nutrients: { calories: 300 },
    };
    const other = { ...bare, id: 'bare-2', updated_at: 20, nutrients: { calories: 300 } };
    const result = mergeFoodLogsDeduped([bare], [other]);
    expect(result).toHaveLength(1);
    expect(result[0].itemsBreakdown).toBeUndefined();
    expect(result[0].nutrients.calories).toBe(300);
  });

  it('syncs both item-list spellings when only one side carries them', () => {
    const localOnlySnake: any = {
      id: 'sync-1',
      name: 'Oat Sync Bowl',
      date: '2026-08-08',
      updated_at: 1,
      imageUrl: '/photos/sync-1.jpg',
      nutrients: { calories: 150 },
      items_breakdown: [{ name: 'Oat Sync Bowl', calories: 150, dbSource: 'label' }],
    };
    const cloudBare: any = {
      id: 'sync-1',
      name: 'Oat Sync Bowl',
      date: '2026-08-08',
      updated_at: 1_720_000_000_000,
      imageUrl: '/photos/sync-cloud.jpg',
      nutrients: { calories: 150 },
    };
    const result = mergeFoodLogsDeduped([localOnlySnake], [cloudBare]);
    expect(result).toHaveLength(1);
    expect(result[0].items_breakdown).toHaveLength(1);
    expect(result[0].itemsBreakdown).toBe(result[0].items_breakdown);
  });
});

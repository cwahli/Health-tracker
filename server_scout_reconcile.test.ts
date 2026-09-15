import { describe, it, expect } from 'vitest';
import {
  reconcileDietitianToScout,
  matchBreakdownItemToScout,
  applySoftReceiptAlignment,
  namesReferToSameFood,
} from './server_scout_reconcile.js';

describe('reconcileDietitianToScout', () => {
  const scout = [
    { scoutIndex: 0, originalName: 'Crispy chicken wrap', boundingBox2D: [1, 2, 3, 4] },
    { scoutIndex: 1, originalName: 'Grilled Chicken & Avocado Salad', boundingBox2D: [10, 20, 30, 40] },
    { scoutIndex: 3, originalName: 'Cinnamon roll', boundingBox2D: [50, 60, 70, 80] },
    { scoutIndex: 4, originalName: '2 Butter Croissants', keyword: '2 butter croissants', boundingBox2D: [90, 91, 92, 93] },
  ];

  it('does not re-inject croissants when dietitian reindexed 0,1,2,3', () => {
    const dietitian = [
      { scoutIndex: 0, canonicalDbName: 'Crispy chicken wrap' },
      { scoutIndex: 1, canonicalDbName: 'Grilled Chicken & Avocado Salad' },
      { scoutIndex: 2, canonicalDbName: 'Cinnamon roll' },
      { scoutIndex: 3, canonicalDbName: '2 Butter Croissants' },
    ];
    const { items, reinjected } = reconcileDietitianToScout(dietitian, scout);
    expect(reinjected).toHaveLength(0);
    expect(items).toHaveLength(4);
    const names = items.map((i) => i.canonicalDbName || i.originalName);
    expect(names.filter((n) => /cinnamon/i.test(n))).toHaveLength(1);
    expect(names.filter((n) => /croissant/i.test(n))).toHaveLength(1);
    const croissants = items.find((i) => /croissant/i.test(i.canonicalDbName || i.originalName || ''));
    expect(croissants?.scoutIndex).toBe(4);
    expect(croissants?.boundingBox2D).toEqual([90, 91, 92, 93]);
    const cinnamon = items.find((i) => /cinnamon/i.test(i.canonicalDbName || i.originalName || ''));
    expect(cinnamon?.scoutIndex).toBe(3);
    expect(cinnamon?.boundingBox2D).toEqual([50, 60, 70, 80]);
  });

  it('never matches leftover scout by array position', () => {
    const used = new Set();
    const item = { scoutIndex: 2, canonicalDbName: 'Cinnamon roll' };
    const match = matchBreakdownItemToScout(item, scout, used);
    expect(match?.scoutIndex).toBe(3);
    expect(match?.originalName).toMatch(/cinnamon/i);
  });

  it('reinjects only a truly missing dish, not a renamed index', () => {
    const dietitian = [
      { scoutIndex: 0, canonicalDbName: 'Crispy chicken wrap' },
      { scoutIndex: 1, canonicalDbName: 'Grilled Chicken & Avocado Salad' },
      { scoutIndex: 3, canonicalDbName: 'Cinnamon roll' },
    ];
    const { items, reinjected } = reconcileDietitianToScout(dietitian, scout);
    expect(reinjected).toHaveLength(1);
    expect(reinjected[0].originalName).toMatch(/croissant/i);
    expect(items).toHaveLength(4);
  });
});

describe('applySoftReceiptAlignment', () => {
  it('sets itemCal to rowSum and never applies a 2.000 row scale', () => {
    const r = applySoftReceiptAlignment(1089, 544.6);
    expect(r.itemCalories).toBe(544.6);
    expect(r.scaled).toBe(false);
    expect(r.factor).toBeCloseTo(544.6 / 1089, 3);
  });

  it('leaves aligned items alone', () => {
    const r = applySoftReceiptAlignment(520, 520);
    expect(r.itemCalories).toBe(520);
    expect(r.scaled).toBe(false);
  });
});

describe('namesReferToSameFood', () => {
  it('treats 2 Butter Croissants and Butter Croissants as the same dish', () => {
    expect(namesReferToSameFood('2 Butter Croissants', 'Butter Croissants')).toBe(true);
  });

  it('matches Cereal Bar to raspberry white chocolate cereal bar', () => {
    expect(namesReferToSameFood('Cereal Bar', 'raspberry white chocolate cereal bar')).toBe(true);
  });

  it('correctly rejects Chicken Sandwich vs Steak Sandwich / Steak Chimi', () => {
    expect(namesReferToSameFood('Chicken Sandwich', 'Steak Sandwich')).toBe(false);
    expect(namesReferToSameFood('YOLK Chicken Sandwich', 'YOLK Steak Sandwich')).toBe(false);
    expect(namesReferToSameFood('YOLK Chicken Sandwich', 'Steak Chimi 2.0')).toBe(false);
  });

  it('correctly rejects conflicting protein wraps, burgers and salads', () => {
    expect(namesReferToSameFood('Crispy Chicken Wrap', 'Falafel Wrap')).toBe(false);
    expect(namesReferToSameFood('Beef Burger', 'Vegan Burger')).toBe(false);
    expect(namesReferToSameFood('Salmon Poke Bowl', 'Tuna Poke Bowl')).toBe(false);
    expect(namesReferToSameFood('Steak Salad', 'Chicken Salad')).toBe(false);
  });

  it('matches valid variations of the same food', () => {
    expect(namesReferToSameFood('Chicken Sandwich', 'Grilled Chicken Sandwich')).toBe(true);
    expect(namesReferToSameFood('Butter Croissant', 'Croissant')).toBe(true);
    expect(namesReferToSameFood('Cinnamon Roll', 'Cinnamon Swirl')).toBe(true);
    expect(namesReferToSameFood('Coca-Cola Vanila Zero Sugar', 'Cola, zero calorie, vanilla')).toBe(true);
    expect(namesReferToSameFood('Chicken Egg', 'Hari Hari Fresh Telur Ayam Negeri')).toBe(true);
    expect(namesReferToSameFood('Squid', 'Cumi-cumi')).toBe(true);
    expect(namesReferToSameFood('Enoki Mushrooms', 'Jamur Enoki')).toBe(true);
    expect(namesReferToSameFood('Tofu', 'Tahu Putih')).toBe(true);
  });

  it('does not duplicate items when dietitian emits standard names for foreign/brand packaged goods', () => {    const scoutItems = [
      { scoutIndex: 0, originalName: 'Indomaret Kuaci Rasa Susu', keyword: 'milk flavored sunflower seeds' },
      { scoutIndex: 1, originalName: 'Coca-Cola Vanila Zero Sugar', keyword: 'vanilla zero sugar cola' }
    ];
    const dietitian = [
      { scoutIndex: 0, canonicalDbName: 'Sunflower seed kernels, dry roasted' },
      { scoutIndex: 1, canonicalDbName: 'Cola, zero calorie, vanilla' }
    ];
    const { items, reinjected } = reconcileDietitianToScout(dietitian, scoutItems);
    expect(reinjected).toHaveLength(0);
    expect(items).toHaveLength(2);
    expect(items[0].scoutIndex).toBe(0);
    expect(items[1].scoutIndex).toBe(1);
  });

  it('measures ID/EN alias hit rate over the probe list (F-4: must be 1.0)', () => {
    const probes: Array<[string, string]> = [
      ['Ayam Goreng', 'Fried Chicken'],
      ['Telur Balado', 'Spicy Egg'],
      ['Ikan Bakar', 'Grilled Fish'],
      ['Cumi Goreng', 'Fried Squid'],
      ['Sapi Rendang', 'Beef Rendang'],
      ['Udang Goreng', 'Fried Shrimp'],
      ['Bebek Goreng', 'Fried Duck'],
      ['Tahu Goreng', 'Fried Tofu'],
      ['Jamur Enoki', 'Enoki Mushrooms'],
      ['Cumi-cumi', 'Squid'],
      ['Hari Hari Fresh Telur Ayam Negeri', 'Chicken Egg'],
      // NOTE: 'Sawi Hijau' != 'Choy Sum' is a CORRECT reject (different vegetables;
      // the Mie Ayam live pairing was a silent merge, not an alias). Sawi has no
      // canonical mapping, so it stays out of the hit-rate probe by design.
      ['Tempe Orek', 'Sweet Soy Tempeh'],
      ['Kepiting Saus Padang', 'Crab in Padang Sauce'],
    ];
    const misses = probes.filter(([alias, canonical]) => !namesReferToSameFood(alias, canonical));
    const rate = (probes.length - misses.length) / probes.length;
    expect(`hit rate ${rate} misses: ${misses.map(([a, c]) => `${a}!=${c}`).join('; ')}`).toBe(
      `hit rate 1 misses: `
    );
  });

  it('gates negation and dangerous-single merges (F-4: never silently merge)', () => {
    expect(namesReferToSameFood('Sweetened Condensed Milk', 'Unsweetened Condensed Milk')).toBe(false);
    expect(namesReferToSameFood('Salted Butter', 'Unsalted Butter')).toBe(false);
    expect(namesReferToSameFood('Diet Cola', 'Regular Cola')).toBe(false);
    expect(namesReferToSameFood('Whole Milk', 'Skim Milk')).toBe(false);
    expect(namesReferToSameFood('Peanut Butter', 'Butter')).toBe(false);
  });
});

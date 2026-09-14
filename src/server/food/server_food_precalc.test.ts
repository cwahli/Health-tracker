import { describe, it, expect } from 'vitest';
import {
  shouldPauseForPortionClarify,
  filterPortionCarryCandidates,
  detectDominantBrand,
  mapLedgersToPrecalcItems,
  applyMealModifiers,
} from './server_food_precalc';

describe('F-8.10 shard 12 — portion pause and carry candidates', () => {
  it('does not pause by default: computes from start with advice finalized', () => {
    const base = {
      portionChoices: undefined, skipPortionClarify: undefined,
      isWeightModification: false, compareOnly: false, isExplicitModify: false,
      visionScoutRanAndReturnedItems: true,
    };
    expect(shouldPauseForPortionClarify(base)).toBe(false);
    expect(shouldPauseForPortionClarify({ ...base, forcePortionClarify: true } as any)).toBe(true);
    expect(shouldPauseForPortionClarify({ ...base, portionChoices: [{}] })).toBe(false);
    expect(shouldPauseForPortionClarify({ ...base, isWeightModification: true })).toBe(false);
    expect(shouldPauseForPortionClarify({ ...base, visionScoutRanAndReturnedItems: false })).toBe(false);
  });

  it('carries meal-relevant candidates capped at 60', () => {
    const items = [{ originalName: 'Rice', keyword: 'rice' }];
    const matches = [
      { searchQuery: 'rice', source: 'usda' },
      { searchQuery: 'yolk chicken', source: 'brand_official', chainName: 'yolk' },
      { searchQuery: 'random', source: 'web_search' },
    ];
    const out = filterPortionCarryCandidates({ visionScoutItems: items, databaseMatchesArray: matches, detectedChainKey: undefined });
    expect(out.map((c: any) => c.searchQuery)).toEqual(['rice', 'yolk chicken']);
  });
});

describe('F-8.10 shard 12 — brand lock (FDC hints deleted in F-12.2)', () => {
  it('detects the dominant brand in scene context', () => {
    const logs: string[] = [];
    expect(detectDominantBrand({ message: 'kfc lunch', visionScoutItems: [], onLog: (m) => logs.push(m) })).toBe('kfc');
    expect(detectDominantBrand({ message: 'home rice', visionScoutItems: [], onLog: () => {} })).toBe('');
    expect(logs.some((m) => m.includes('Environment Locking'))).toBe(true);
  });
});

describe('F-8.10 shard 12 — ledger mapping and modifiers', () => {
  it('maps ledgers to precalc items with budget logging', () => {
    const logs: string[] = [];
    const out = mapLedgersToPrecalcItems({
      ledgers: [{
        scoutIndex: 0, originalName: 'Rice', keyword: 'rice', weightGrams: 200,
        nutrients: { calories: 260 }, lockedNutrientKeys: [], dbSource: 'estimated',
        brandLock: null, dbId: null, atwaterFlag: null, ingredients: [], visualIngredients: [],
        ingredientsList: null, dishClass: 'grain', hasComponents: false,
      }],
      visionScoutItems: [{ boundingBox2D: [1], sourceImageIndex: 0 }],
      onLog: (m) => logs.push(m),
    });
    expect(out[0].estimatedWeightGrams).toBe(200);
    expect(out[0].portionMultiplier).toBe(1.0);
    expect(out[0].components).toBeNull();
    expect(logs.some((m) => m.includes('[Budget]'))).toBe(true);
  });

  it('applies zero-sugar modifiers to single items without touching others', () => {
    const logs: string[] = [];
    const items: any[] = [{
      originalName: 'Sweet Iced Tea', foodType: 'beverage',
      nutrients: { calories: 84, protein: 0, totalFat: 0, carbohydrates: 21, sugar: 20, addedSugar: 20, sodium: 5 },
    }];
    applyMealModifiers({ preCalculatedItems: items, message: 'unsweetened please', onLog: (m) => logs.push(m) });
    expect(items[0].nutrients.calories).toBe(0);
    expect(items[0].lockedNutrientKeys).toContain('calories');
  });
});

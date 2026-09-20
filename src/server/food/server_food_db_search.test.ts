import { describe, it, expect } from 'vitest';
import { runDatabaseSearchStage } from './server_food_db_search';

function stubSetup(overrides: Record<string, any> = {}) {
  const logs: string[] = [];
  const deps: Record<string, any> = {
    sendStreamEvent: () => {},
    flushRes: () => {},
    sendLog: () => {},
    addDebugLog: (m: string) => logs.push(m),
    searchOpenFoodFacts: async () => [],
    searchBrandMenuItems: async () => [],
    isKnownDatabaseBrand: async () => false,
    isKnownDatabaseBrandSync: () => false,
    getBrandMenuItemById: async () => null,
    isUsableWebNutritionHit: () => false,
    brandHitFitsQuery: () => true,
    extractUSDANutrientsPer100g: (f: any) => f.nutrients || { calories: 100, protein: 1 },
    extractOFFNutrientsPer100g: (p: any) => p.nutrients || { calories: 100, protein: 1 },
    resolveInternalFood: async () => null,
    resolveDishCache: async () => null,
    rankAndClassifyCandidates: () => ({ resolveClass: 'MISS', bestMatch: null, survivors: [] }),
    writeAliasIfHitUnique: async () => {},
    sanitizeDishTitle: (q: string) => q,
    normalizeFoodKey: (q: string) => String(q || '').toLowerCase().trim(),
    fetchOFFProductByBarcode: async () => null,
    getFallbackCategoryProfile: () => ({ calories: 50, protein: 1 }),
    recordFoodObservation: () => {},
    upsertFoodItemCandidate: async () => {},
    upsertFoodAlias: async () => {},
    callUnifiedLLM: async () => '{}',
    executeFoodResolverCurator: async () => [],
    ...overrides,
  };
  return { logs, deps };
}

function baseInput(overrides: Record<string, any> = {}) {
  return {
    uniqueQueries: ['rice'],
    visionScoutItems: [],
    visionScoutContentType: 'visual',
    detectedChainKey: undefined,
    explicitFoodTags: [],
    engine: 'test-model',
    databaseMatchesArray: [] as any[],
    dbMatchMap: new Map<string, any>(),
    quarantinedIdsSet: new Set<string>(),
    ...overrides,
  };
}

describe('F-8.10 shard 14 — database search stage (stubbed services)', () => {
  // F-12.1: USDA feed deleted — brand hits shape without any USDA call.
  it('shapes brand hits with no USDA search', async () => {
    const { deps } = stubSetup({
      searchBrandMenuItems: async () => [{ id: 'b1', chainName: 'Test Chain', name: 'Rice Bowl', calories: 200, protein: 5 }],
    });
    const input = baseInput({ detectedChainKey: 'test-chain' });
    const text = await runDatabaseSearchStage(input, deps as any);
    expect(text).toContain('[Brand Menu (Official)]');
    expect(text).not.toContain('[USDA]');
    expect(input.databaseMatchesArray.some((m: any) => m.searchQuery === 'rice' && m.chainName === 'Test Chain')).toBe(true);
    expect(input.databaseMatchesArray.some((m: any) => m.source === 'usda')).toBe(false);
    expect(input.databaseMatchesArray.some((m: any) => m.source === 'category_fallback')).toBe(false);
  });

  it('retries loosened queries after zero results', async () => {
    const seen: string[] = [];
    const { deps } = stubSetup({
      searchBrandMenuItems: async (q: string) => {
        seen.push(q);
        return q === 'strawberry' ? [{ id: 'b2', chainName: 'Test Chain', name: 'Strawberry Cup', calories: 50, protein: 1 }] : [];
      },
    });
    const input = baseInput({ uniqueQueries: ['fresh strawberries'] });
    await runDatabaseSearchStage(input, deps as any);
    expect(seen).toEqual(['fresh strawberries', 'strawberry']);
    expect(input.databaseMatchesArray.some((m: any) => m.id === 'b2')).toBe(true);
  });

  it('falls back honestly with BIND-style category entries when everything misses', async () => {
    const { deps, logs } = stubSetup();
    const input = baseInput({ uniqueQueries: ['mystery dish'] });
    const text = await runDatabaseSearchStage(input, deps as any);
    expect(text).toContain('No matches found');
    const fallback = input.databaseMatchesArray.find((m: any) => m.source === 'category_fallback');
    expect(fallback).toBeTruthy();
    expect(fallback.id).toBe('fallback_mystery dish');
    expect(input.dbMatchMap.has('fallback_mystery dish')).toBe(true);
    expect(logs.some((m) => m.includes('category fallback'))).toBe(true);
  });
});

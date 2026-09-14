import { describe, it, expect } from 'vitest';
import {
  loosenQuery,
  cleanQuery,
  detectChainKeyFromText,
  scoutHasCompletePrintedLabel,
  enrichScoutComponentsWithMatches,
  buildPastMealsContext,
  extractFoodSearchQueriesFromText,
} from './server_food_analyze_helpers';

describe('F-8.10 shard 1 — DB-search query normalization', () => {
  it('loosenQuery strips brand adjectives and normalizes plurals', () => {
    expect(loosenQuery('Tesco Bananas')).toBe('banana');
    expect(loosenQuery('grilled salmon')).toBe('salmon');
    expect(loosenQuery('strawberries')).toBe('strawberry');
    expect(loosenQuery('tomatoes')).toBe('tomato');
    expect(loosenQuery('')).toBe('');
  });

  it('cleanQuery strips parentheticals, maps Indonesian staples, and raws bare meats', () => {
    expect(cleanQuery('Chicken Breast (200g)')).toBe('raw chicken breast');
    expect(cleanQuery('nasi goreng')).toBe('cooked rice goreng');
    expect(cleanQuery('kentang')).toBe('potato');
    // Chain-qualified meats keep their preparation context
    expect(cleanQuery('kfc chicken burger')).toBe('kfc chicken burger');
    // Container/prep words are stripped first, then bare meats are rawed
    expect(cleanQuery('grilled salmon')).toBe('raw salmon');
  });

  it('cleanQuery translates new specific Indonesian ingredients correctly', () => {
    expect(cleanQuery('donut malaysia matcha')).toBe('donut');
    expect(cleanQuery('santan')).toBe('coconut milk');
    expect(cleanQuery('tomat dan daun bawang')).toBe('tomato');
  });

  it('detectChainKeyFromText matches static chain patterns and passes plain food through', () => {
    expect(detectChainKeyFromText("Sainsbury's Scottish Oats")).toBe('sainsbury');
    expect(detectChainKeyFromText('Yolk steak bowl')).toBe('yolk');
    expect(detectChainKeyFromText('plain grilled salmon')).toBeUndefined();
    expect(detectChainKeyFromText('')).toBeUndefined();
  });
});

describe('F-8.10 shard 2 — resolver skip gate, component enrichment, past-meals context', () => {
  it('scoutHasCompletePrintedLabel passes calories + panel fields, rejects thin labels', () => {
    expect(scoutHasCompletePrintedLabel({
      rawNutritionLabel: { calories: '100', protein: '1 g', totalFat: '0 g', carbohydrates: '25 g', sodium: '10 mg' },
    })).toBe(true);
    expect(scoutHasCompletePrintedLabel({ rawNutritionLabel: { protein: '1 g' } })).toBe(false);
    expect(scoutHasCompletePrintedLabel({ rawNutritionLabel: null })).toBe(false);
    expect(scoutHasCompletePrintedLabel({})).toBe(false);
    expect(scoutHasCompletePrintedLabel({
      rawNutritionLabel: { calories: '100', protein: '-', totalFat: '--', carbohydrates: '', sodium: null },
    })).toBe(false);
  });

  it('enrichScoutComponentsWithMatches binds matched components and marks the rest honestly', () => {
    const items: any[] = [
      {
        originalName: 'Chicken Rice',
        components: [
          { searchQuery: 'steamed rice' },
          { searchQuery: 'mystery side' },
          { searchQuery: 'yolk chicken', brand: 'yolk' },
        ],
      },
    ];
    const matches = [
      { searchQuery: 'steamed rice', name: 'Rice, white, steamed', source: 'usda' },
      { searchQuery: 'yolk chicken', name: 'Yolk Chicken', source: 'brand_official', chainName: 'yolk' },
    ];
    enrichScoutComponentsWithMatches(items, matches);
    expect(items[0].components[0].dbSource).toBe('usda');
    expect(items[0].components[0].primaryBaseMatchName).toBe('Rice, white, steamed');
    expect(items[0].components[1].dbSource).toBe('estimated');
    expect(items[0].components[2].dbSource).toBe('brand_official');
    expect(items[0].components[2].chainName).toBe('yolk');
  });

  it('enrichScoutComponentsWithMatches demotes brand matches the query never named', () => {
    const items: any[] = [
      { originalName: 'Veggie Bowl', components: [{ searchQuery: 'plain tofu' }] },
    ];
    const matches = [
      { searchQuery: 'plain tofu', name: 'Yolk Tofu Bowl', source: 'brand_official', chainName: 'yolk' },
    ];
    enrichScoutComponentsWithMatches(items, matches);
    expect(items[0].components[0].dbSource).toBe('category_fallback');
    expect(items[0].components[0].chainName).toBeNull();
  });

  it('buildPastMealsContext lists recent meals and stays silent on empty logs', () => {
    const logs: string[] = [];
    const ctx = buildPastMealsContext([
      { name: 'Nasi Lemak', date: '2026-09-03', nutrients: { calories: 600, protein: 20 } },
      { name: 'Tea', date: '2026-09-03', calories: 5, protein: 0 },
      { name: 'Oats', date: '2026-09-02', calories: 300, protein: 10 },
    ], (m) => logs.push(m));
    expect(ctx).toContain("PATIENT'S RECENT LOGGED MEALS HISTORY");
    expect(ctx).toContain('"Nasi Lemak" on 2026-09-03');
    expect(logs.some((m) => m.includes('3 past meal(s)'))).toBe(true);
    expect(buildPastMealsContext([], () => {})).toBe('');
    expect(buildPastMealsContext(null, () => {})).toBe('');
  });
});

describe('F-8.10 shard 21 — text-query extraction', () => {
  it('extracts food phrases and rejects greetings and lab queries', () => {
    expect(extractFoodSearchQueriesFromText('nasi goreng and teh manis')).toEqual(['nasi goreng', 'teh manis']);
    expect(extractFoodSearchQueriesFromText('hello')).toEqual([]);
    expect(extractFoodSearchQueriesFromText('my ldl cholesterol')).toEqual([]);
    expect(extractFoodSearchQueriesFromText('')).toEqual([]);
    expect(extractFoodSearchQueriesFromText(null as any)).toEqual([]);
  });

  it('strips weights, units, and stop words', () => {
    expect(extractFoodSearchQueriesFromText('200g chicken breast')).toEqual(['chicken breast']);
    expect(extractFoodSearchQueriesFromText('i ate rice')).toEqual(['rice']);
  });
});

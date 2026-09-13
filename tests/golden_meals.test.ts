import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { lookupCanonicalBaseFood } from '../server_food_db.js';
import { buildFoodSearchQuerySet } from '../server_query_set.js';
import { parseLabelCalories } from '../server_budget_reconcile.js';
import { parseServingGramsFromLabel } from '../server_portion_clarify.js';
import { detectWeightRefineIntent } from '../server_refine_scale.js';
import { checkCategoryAndStateCompatibility } from '../server_pure_helpers.js';
import { normalizeChainKey } from '../serverBrandMenu.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, 'Golden_meal');

type ResolveLock = { query: string; expectFdcId: string };
type NeverRule = {
  query: string;
  forbiddenIds?: string[];
  forbiddenNames?: string[];
};
type GoldenSpec = {
  id: string;
  title: string;
  mode: string;
  passes: Array<{ id: string; prompt: string; photos: string[]; kind?: string }>;
  expectedItems?: Array<{ key: string; names: string[] }>;
  resolveLocks?: ResolveLock[];
  catalogGaps?: string[];
  neverMatch?: NeverRule[];
  printedLabels?: Array<{
    photo: string;
    servingSizeGrams?: number;
    servingsPerPack?: number;
    perServing?: Record<string, number>;
  }>;
};

function loadManifest() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf-8'));
}

function loadSpec(dir: string): GoldenSpec {
  return JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'expected.json'), 'utf-8'));
}

function isForbidden(rule: NeverRule, candidateId: string, candidateName: string): boolean {
  const id = String(candidateId || '');
  const name = String(candidateName || '').toLowerCase();
  if ((rule.forbiddenIds || []).some((x) => String(x) === id)) return true;
  return (rule.forbiddenNames || []).some((n) => name.includes(n.toLowerCase()));
}

describe('Golden meals — fixture set', () => {
  const manifest = loadManifest();

  it('registers exactly the official goldens', () => {
    expect(manifest.goldens.map((g: { id: string }) => g.id)).toEqual([
      'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9',
    ]);
  });

  it('each golden has Instruction.md, expected.json, and every listed photo', () => {
    for (const g of manifest.goldens) {
      const dir = path.join(ROOT, g.dir);
      expect(fs.existsSync(path.join(dir, 'Instruction.md')), `${g.id} Instruction.md`).toBe(true);
      expect(fs.existsSync(path.join(dir, 'expected.json')), `${g.id} expected.json`).toBe(true);
      const spec = loadSpec(g.dir);
      expect(spec.id).toBe(g.id);
      const photos = (spec.passes || []).flatMap((p) => p.photos || []);
      for (const photo of photos) {
        expect(fs.existsSync(path.join(dir, photo)), `${g.id} missing ${photo}`).toBe(true);
      }
    }
  });
});

describe('Golden meals — Layer B resolve locks & USDA never-match', () => {
  const manifest = loadManifest();
  const specs: GoldenSpec[] = manifest.goldens.map((g: { dir: string }) => loadSpec(g.dir));

  it('dictionary locks resolve to the pinned FDC / canonical id', () => {
    const misses: string[] = [];
    for (const spec of specs) {
      for (const lock of spec.resolveLocks || []) {
        const hit = lookupCanonicalBaseFood(lock.query);
        if (!hit || String(hit.fdcId) !== String(lock.expectFdcId)) {
          misses.push(`${spec.id} "${lock.query}" -> ${hit?.fdcId ?? 'null'} (want ${lock.expectFdcId})`);
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it('documented catalog gaps do not silently resolve today', () => {
    const leaked: string[] = [];
    for (const spec of specs) {
      for (const q of spec.catalogGaps || []) {
        const hit = lookupCanonicalBaseFood(q);
        if (hit) leaked.push(`${spec.id} gap "${q}" unexpectedly hit ${hit.fdcId}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it('never-match table rejects the known USDA / brand false friends', () => {
    const cases: Array<{ rule: NeverRule; id: string; name: string }> = [
      { rule: { query: 'mixed berries', forbiddenIds: ['174113'], forbiddenNames: ['POWERADE'] }, id: '174113', name: 'Beverages, POWERADE, Zero, Mixed Berry' },
      { rule: { query: 'sugar', forbiddenIds: ['2710321'], forbiddenNames: ['Popsicle'] }, id: '2710321', name: 'Popsicle, no sugar added' },
      { rule: { query: 'raisins', forbiddenIds: ['172991'], forbiddenNames: ['Instant Oatmeal'] }, id: '172991', name: 'Cereals, QUAKER, Instant Oatmeal, Raisin and Spice, dry' },
      { rule: { query: 'mixed salad leaves', forbiddenIds: ['170544'], forbiddenNames: ['Taro'] }, id: '170544', name: 'Taro, leaves, cooked, steamed, with salt' },
      { rule: { query: 'almonds', forbiddenNames: ['Dark Choc Almond'] }, id: 'brand_menu_almond', name: 'yolk Dark Choc Almond' },
      { rule: { query: 'granola', forbiddenNames: ['Co-op Blueberry Granola Yogurt Pot'] }, id: 'web_search_granola_0', name: 'Co-op Blueberry Granola Yogurt Pot' },
      { rule: { query: 'falafel', forbiddenNames: ['vegetarian falafel wrap ingredients'] }, id: '172455', name: 'vegetarian falafel wrap ingredients' },
      { rule: { query: 'plain yogurt', forbiddenNames: ['Water, bottled'] }, id: '2710708', name: 'Water, bottled, plain' },
      { rule: { query: 'Taro chips', forbiddenNames: ['Taro, leaves'] }, id: '170544', name: 'Taro, leaves, cooked, steamed, with salt' },
    ];
    for (const c of cases) {
      expect(isForbidden(c.rule, c.id, c.name), `${c.rule.query} vs ${c.name}`).toBe(true);
    }
    expect(isForbidden(cases[0].rule, '167762', 'Strawberries, raw')).toBe(false);
  });

  it('category gate still blocks water for a yogurt query', () => {
    const r = checkCategoryAndStateCompatibility('plain yogurt', 'Water, bottled, plain');
    expect(r.compatible).toBe(false);
  });
});

describe('Golden meals — G1 picnic query hygiene + edit', () => {
  it('searches wrap/salad components, not the parent dish title', () => {
    const queries = buildFoodSearchQuerySet([
      {
        originalName: 'Grilled Chicken & Avocado Salad',
        keyword: 'chicken avocado salad bowl',
        components: [
          { searchQuery: 'grilled chicken breast' },
          { searchQuery: 'avocado' },
          { searchQuery: 'hard boiled egg' },
          { searchQuery: 'mixed salad leaves' },
        ],
      },
      {
        originalName: 'Vegetarian wrap',
        keyword: 'vegetarian wrap',
        components: [
          { searchQuery: 'flour tortilla' },
          { searchQuery: 'falafel' },
          { searchQuery: 'hummus' },
          { searchQuery: 'feta cheese' },
          { searchQuery: 'garlic mayonnaise' },
        ],
      },
    ]);
    expect(queries).toContain('grilled chicken breast');
    expect(queries).toContain('avocado');
    expect(queries).toContain('falafel');
    expect(queries).toContain('garlic mayonnaise');
    expect(queries.some((q) => /chicken avocado salad/i.test(q))).toBe(false);
    expect(queries.some((q) => /^vegetarian wrap$/i.test(q))).toBe(false);
  });

  it('"I ate this croissant" is an item edit, not a half/pack refine', () => {
    const intent = detectWeightRefineIntent('I ate this croissant');
    expect(intent.isRefine).toBe(false);
  });
});

describe('Golden meals — G2 Sainsbury oats brand math', () => {
  const spec = loadSpec('2. Composite dish with branded food');
  const oats = spec.expectedItems!.find((i) => i.key === 'sainsbury_oats') as any;

  it('normalizes Sainsbury to chain_key sainsbury', () => {
    expect(normalizeChainKey("Sainsbury's")).toBe('sainsbury');
    expect(normalizeChainKey('Sainsbury oat')).toBe('sainsbury');
  });

  it('scales official per-100g oats to the user 60g', () => {
    const per100 = oats.lockedPer100g;
    const got = {
      calories: per100.calories * 0.6,
      protein: per100.protein * 0.6,
      totalFat: per100.totalFat * 0.6,
      carbohydrates: per100.carbohydrates * 0.6,
    };
    expect(got.calories).toBeCloseTo(oats.lockedFor60g.calories, 5);
    expect(got.protein).toBeCloseTo(oats.lockedFor60g.protein, 5);
    expect(got.totalFat).toBeCloseTo(oats.lockedFor60g.totalFat, 5);
    expect(got.carbohydrates).toBeCloseTo(oats.lockedFor60g.carbohydrates, 5);
  });

  it('local brand catalog contains the Scottish rolled oats row', () => {
    const rows = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'brand_menu_items_local.json'), 'utf-8')
    );
    const hit = rows.find((r: any) => r.dish_name_key === 'sainsbury_scottish_whole_rolled_oats');
    expect(hit).toBeTruthy();
    expect(hit.nutrients.calories).toBe(362.5);
  });
});

describe('Golden meals — G3 Yolk refine', () => {
  it('half-of-the-potatoes is a refine of potatoes only', () => {
    const intent = detectWeightRefineIntent('I only ate half of the potatoes');
    expect(intent.isRefine).toBe(true);
    if (intent.isRefine) {
      expect(intent.kind).toBe('half');
      expect(intent.targetHint).toMatch(/potato/i);
    }
  });

  it('does not treat the only local Yolk row as a match for the steak bowl', () => {
    const spec = loadSpec('3. Branded dish with incomplete data');
    const rule = spec.neverMatch!.find((r) => r.query === 'Yolk steak bowl')!;
    expect(isForbidden(rule, 'bang_bang_shroom', 'Bang-Bang Shroom (ve)')).toBe(true);
  });
});

describe('Golden meals — G5 printed labels', () => {
  const spec = loadSpec('5. Compare nutrition labels');

  it('parses visible kcal from the labelled packs', () => {
    expect(parseLabelCalories('90 kcal')).toBe(90);
    expect(parseLabelCalories('Total Energy 250 kcal')).toBe(250);
    expect(parseLabelCalories('120 kcal')).toBe(120);
  });

  it('parses serving grams from the Indonesian labels', () => {
    expect(parseServingGramsFromLabel('23g')).toBe(23);
    expect(parseServingGramsFromLabel('Serving Size (75g)')).toBe(75);
    expect(parseServingGramsFromLabel('Serving size (44 g)')).toBe(44);
    expect(parseServingGramsFromLabel('55g')).toBe(55);
  });

  it('pins the three calorie-labelled servings in expected.json', () => {
    const byKey = Object.fromEntries((spec.printedLabels || []).map((l: any) => [l.key, l]));
    expect(byKey.green_bar.perServing.calories).toBe(90);
    expect(byKey.yellow_cake.perServing.calories).toBe(250);
    expect(byKey.blue_bread.perServing.calories).toBe(120);
    expect(byKey.banana_chips_front.perServing).toBeUndefined();
  });
});

describe('Golden meals — G4 / G6 / G7 mode contracts', () => {
  it('G4 first pass is portion_clarify; G6/G7 are compare, not portion', () => {
    const g4 = loadSpec('4. Portion size confirmation');
    const g6 = loadSpec('6. Compare menu items');
    const g7 = loadSpec('7. Compare large set of similar choices');
    expect(g4.passes[0].kind).toBe('portion_clarify');
    expect(g6.mode).toBe('evaluation');
    expect(g7.mode).toBe('evaluation');
    expect(g6.passes[0].kind).toBe('compare_menu');
    expect(g7.passes[0].kind).toBe('compare_shelf');
  });
});

describe('Golden meals — F-3 Multi-component regional dish decomposition', () => {
  it('decomposes a dim sum set into distinct searchable item queries without parent pollution', () => {
    const queries = buildFoodSearchQuerySet([
      {
        originalName: 'Dim Sum Tasting Basket',
        keyword: 'dim sum platter',
        components: [
          { searchQuery: 'har gow shrimp dumpling' },
          { searchQuery: 'siu mai pork dumpling' },
          { searchQuery: 'steamed char siu bao' },
          { searchQuery: 'jasmine tea' },
        ],
      },
    ]);
    expect(queries).toContain('har gow shrimp dumpling');
    expect(queries).toContain('siu mai pork dumpling');
    expect(queries).toContain('steamed char siu bao');
    expect(queries).toContain('jasmine tea');
    expect(queries.some((q) => /dim sum tasting basket/i.test(q))).toBe(false);
  });

  it('decomposes a Japanese bento box into protein, carb, sides, and soup components', () => {
    const queries = buildFoodSearchQuerySet([
      {
        originalName: 'Salmon Teriyaki Bento Box',
        keyword: 'salmon bento',
        components: [
          { searchQuery: 'grilled salmon teriyaki' },
          { searchQuery: 'steamed white rice' },
          { searchQuery: 'edamame beans' },
          { searchQuery: 'miso soup' },
        ],
      },
    ]);
    expect(queries).toContain('grilled salmon teriyaki');
    expect(queries).toContain('steamed white rice');
    expect(queries).toContain('edamame beans');
    expect(queries).toContain('miso soup');
    expect(queries.some((q) => /^salmon bento$/i.test(q))).toBe(false);
  });
});


import { describe, it, expect } from 'vitest';
import {
  applyMealEdits,
  coalesceLegacyCommands,
  mealItemsHaveAtwaterCalories,
  extractSauceName,
} from './server_meal_edit';
import { compositionTileItems } from './src/utils/foodCompositionTiles';

function steakPlate() {
  return [
    {
      scoutIndex: 0,
      name: 'Sizzling Beef and Chicken Steak',
      canonicalDbName: 'Sizzling Beef and Chicken Steak',
      originalName: 'Sizzling Beef and Chicken Steak',
      weightGrams: 580,
      calories: 890,
      protein: 62,
      carbohydrates: 40,
      totalFat: 48,
      nutrients: { calories: 890, protein: 62, carbohydrates: 40, totalFat: 48, saturatedFat: 16, sodium: 1200 },
      sourceImageIndex: 1,
      boundingBox2D: [5, 5, 90, 90],
      dbSource: 'estimated',
      componentsDetailList: [
        { name: 'Beef and Chicken Steak', weightGrams: 250, calories: 520, protein: 48, carbohydrates: 2, totalFat: 36, nutrients: { calories: 520, protein: 48, carbohydrates: 2, totalFat: 36 } },
        { name: 'Black Pepper Sauce', weightGrams: 80, calories: 90, protein: 2, carbohydrates: 6, totalFat: 6, nutrients: { calories: 90, protein: 2, carbohydrates: 6, totalFat: 6 } },
        { name: 'Potato Wedges', weightGrams: 130, calories: 180, protein: 3, carbohydrates: 25, totalFat: 7, nutrients: { calories: 180, protein: 3, carbohydrates: 25, totalFat: 7 } },
        { name: 'Mixed Vegetables', weightGrams: 120, calories: 70, protein: 2, carbohydrates: 10, totalFat: 2, nutrients: { calories: 70, protein: 2, carbohydrates: 10, totalFat: 2 } },
      ],
    },
    {
      scoutIndex: 1,
      name: 'Sempol Ayam',
      canonicalDbName: 'Sempol Ayam',
      weightGrams: 80,
      calories: 180,
      protein: 11,
      carbohydrates: 15,
      totalFat: 8,
      nutrients: { calories: 180, protein: 11, carbohydrates: 15, totalFat: 8, saturatedFat: 2, sodium: 280 },
      sourceImageIndex: 3,
      boundingBox2D: [1, 2, 3, 4],
      dbSource: 'estimated',
    },
  ];
}

describe('applyMealEdits', () => {
  it('Q&A: empty commands leave the meal unchanged', async () => {
    const items = steakPlate();
    const result = await applyMealEdits({ items, commands: [], userMessage: 'is this high protein?' });
    expect(result.qa).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].weightGrams).toBe(580);
  });

  it('replace_identity copies photo + weight and Atwaters the new estimate (tempeh, not this meal’s FDC)', async () => {
    const items = steakPlate();
    const result = await applyMealEdits({
      items,
      userMessage: 'the sempol ayam is tempeh satay',
      commands: [{
        action: 'replace_identity',
        itemName: 'Sempol Ayam',
        newItemName: 'Tempeh Satay',
        estimate: { protein: 19, carbohydrates: 9, totalFat: 11, saturatedFat: 2, sodium: 220, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });
    const row = result.items.find((it) => /tempeh/i.test(it.name));
    expect(row).toBeTruthy();
    expect(row.sourceImageIndex).toBe(3);
    expect(row.boundingBox2D).toEqual([1, 2, 3, 4]);
    expect(row.weightGrams).toBe(80);
    expect(row.calories).toBeGreaterThan(0);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('split keeps unmentioned sides at saved grams and sauce as a component', async () => {
    const items = steakPlate();
    const result = await applyMealEdits({
      items,
      userMessage: 'the beef and chicken is 100g of beef steak and 100g of chicken steak',
      commands: [{
        action: 'split_item',
        itemName: 'Sizzling Beef and Chicken Steak',
        into: [
          { name: 'Beef Steak', grams: 100, estimate: { protein: 27, carbohydrates: 0, totalFat: 8, saturatedFat: 3, sodium: 70, cookingMethod: 'grilled', foodType: 'protein' } },
          { name: 'Chicken Steak', grams: 100, estimate: { protein: 28, carbohydrates: 0, totalFat: 4, saturatedFat: 1, sodium: 65, cookingMethod: 'grilled', foodType: 'protein' } },
        ],
      }],
    });
    const names = result.items.map((it) => it.name);
    expect(names.some((n) => /beef steak/i.test(n))).toBe(true);
    expect(names.some((n) => /chicken steak/i.test(n))).toBe(true);
    const wedges = result.items.find((it) => /wedges/i.test(it.name));
    const veg = result.items.find((it) => /vegetable/i.test(it.name));
    expect(wedges?.weightGrams).toBe(130);
    expect(wedges?.role).toBe('component');
    expect(veg?.weightGrams).toBe(120);
    expect(veg?.role).toBe('component');
    const sauceFood = result.items.find((it) => /sauce/i.test(it.name) && it.role !== 'component');
    expect(sauceFood).toBeFalsy();
    const host = result.items.find((it) => Array.isArray(it.componentsDetailList) && it.componentsDetailList.some((c: any) => /sauce/i.test(c.name)));
    expect(host).toBeTruthy();
    expect(compositionTileItems(result.items).every((it) => it.role !== 'component')).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('coalesce remove+add of a composite into split, ignoring few-shot 80/100/70 side grams', () => {
    const items = steakPlate();
    const coalesced = coalesceLegacyCommands(
      [
        { action: 'remove_item', itemName: 'Sizzling Beef and Chicken Steak' },
        { action: 'add_item', itemName: 'Beef Steak', newWeightGrams: 100, estimate: { protein: 27, carbohydrates: 0, totalFat: 8 } },
        { action: 'add_item', itemName: 'Chicken Steak', newWeightGrams: 100, estimate: { protein: 28, carbohydrates: 0, totalFat: 4 } },
        { action: 'add_item', itemName: 'Black Pepper Sauce', newWeightGrams: 80 },
        { action: 'add_item', itemName: 'Potato Wedges', newWeightGrams: 100 },
        { action: 'add_item', itemName: 'Mixed Vegetables', newWeightGrams: 70 },
      ],
      items,
      'the beef and chicken is 100g of beef steak and 100g of chicken steak'
    );
    expect(coalesced).toHaveLength(1);
    expect(coalesced[0].action).toBe('split_item');
    const intoNames = (coalesced[0].into || []).map((p) => p.name.toLowerCase());
    expect(intoNames.some((n) => n.includes('beef'))).toBe(true);
    expect(intoNames.some((n) => n.includes('chicken'))).toBe(true);
    expect(intoNames.some((n) => n.includes('wedges'))).toBe(false);
    expect(intoNames.some((n) => n.includes('vegetable'))).toBe(false);
  });

  it('add_item with scout-shaped estimate never inherits 0 kcal (seitan, not this meal)', async () => {
    const items = steakPlate();
    const result = await applyMealEdits({
      items,
      userMessage: 'also add 90g seitan',
      commands: [{
        action: 'add_item',
        itemName: 'Seitan',
        newWeightGrams: 90,
        estimate: { protein: 22, carbohydrates: 8, totalFat: 2, saturatedFat: 0.4, sodium: 180, cookingMethod: 'pan_fried', foodType: 'protein' },
      }],
    });
    const seitan = result.items.find((it) => /seitan/i.test(it.name));
    expect(seitan).toBeTruthy();
    expect(seitan.calories).toBeGreaterThan(0);
    expect(seitan.sourceImageIndex).toBeNull();
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('set_count is a piece annotation and does not double already-weighed grams (tempeh, not this meal)', async () => {
    const items = steakPlate();
    items[1].name = 'Tempeh Satay';
    items[1].canonicalDbName = 'Tempeh Satay';
    const result = await applyMealEdits({
      items,
      userMessage: 'that tempeh is 2 pieces',
      commands: [{ action: 'set_count', itemName: 'Tempeh Satay', count: 2 }],
    });
    const row = result.items.find((it) => /tempeh/i.test(it.name));
    expect(row.weightGrams).toBe(80);
    expect(row.count).toBe(2);
  });

  it('replace_identity then set_count keeps the saved portion (fish cake skewer)', async () => {
    const items = steakPlate();
    const result = await applyMealEdits({
      items,
      userMessage: 'the sempol ayam is 2 fish cake skewers',
      commands: [
        {
          action: 'replace_identity',
          itemName: 'Sempol Ayam',
          newItemName: 'Fish Cake Skewer',
          newWeightGrams: 85,
          estimate: { protein: 10, carbohydrates: 15, totalFat: 4, saturatedFat: 1.2, sodium: 280, cookingMethod: 'grilled', foodType: 'protein' },
        },
        { action: 'set_count', itemName: 'Fish Cake Skewer', count: 2 },
      ],
    });
    const row = result.items.find((it) => /fish cake/i.test(it.name));
    expect(row.weightGrams).toBe(85);
    expect(row.count).toBe(2);
    expect(row.calories).toBeGreaterThan(0);
    expect(row.calories).toBeLessThan(200);
  });

  it('split of meat-with-sauce leftover is condiment grams, sides stay components (seitan plate)', async () => {
    expect(extractSauceName('Seitan Cutlet with Chili Gravy')).toBe('Chili Gravy');
    const items = [{
      scoutIndex: 0,
      name: 'Seitan Cutlet Plate',
      canonicalDbName: 'Seitan Cutlet Plate',
      weightGrams: 500,
      calories: 600,
      protein: 40,
      carbohydrates: 50,
      totalFat: 20,
      nutrients: { calories: 600, protein: 40, carbohydrates: 50, totalFat: 20 },
      sourceImageIndex: 2,
      dbSource: 'estimated',
      componentsDetailList: [
        {
          name: 'Seitan Cutlet with Chili Gravy',
          weightGrams: 250,
          calories: 330,
          protein: 42,
          carbohydrates: 8,
          totalFat: 14.5,
          nutrients: { calories: 330, protein: 42, carbohydrates: 8, totalFat: 14.5 },
        },
        { name: 'Sweet Potato Wedges', weightGrams: 130, calories: 167, protein: 3, carbohydrates: 30, totalFat: 3.9, nutrients: { calories: 167, protein: 3, carbohydrates: 30, totalFat: 3.9 } },
        { name: 'Garden Vegetables', weightGrams: 120, calories: 116, protein: 3.5, carbohydrates: 16, totalFat: 4.2, nutrients: { calories: 116, protein: 3.5, carbohydrates: 16, totalFat: 4.2 } },
      ],
    }];
    const result = await applyMealEdits({
      items,
      userMessage: 'the seitan is 100g seitan steak and 100g tempeh steak',
      commands: [{
        action: 'split_item',
        itemName: 'Seitan Cutlet Plate',
        into: [
          { name: 'Seitan Steak', grams: 100, role: 'food', estimate: { protein: 26, carbohydrates: 0, totalFat: 11, cookingMethod: 'pan_fried', foodType: 'protein' } },
          { name: 'Tempeh Steak', grams: 100, role: 'food', estimate: { protein: 31, carbohydrates: 0, totalFat: 3.6, cookingMethod: 'pan_fried', foodType: 'protein' } },
        ],
      }],
    });
    const gravy = result.items.find((it) => /gravy/i.test(it.name));
    expect(gravy).toBeTruthy();
    expect(gravy.role).toBe('component');
    expect(gravy.weightGrams).toBe(50);
    expect(gravy.protein).toBeLessThanOrEqual(2);
    const wedges = result.items.find((it) => /wedges/i.test(it.name));
    const veg = result.items.find((it) => /garden/i.test(it.name));
    expect(wedges?.role).toBe('component');
    expect(wedges?.weightGrams).toBe(130);
    expect(veg?.role).toBe('component');
    expect(veg?.weightGrams).toBe(120);
    const tiles = compositionTileItems(result.items);
    expect(tiles).toHaveLength(2);
    expect(tiles.every((t) => t.role !== 'component')).toBe(true);
    expect(result.weightGrams).toBe(500);
  });

  it('unsweetened twice applies once', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Sweet Iced Tea',
        canonicalDbName: 'Sweet Iced Tea',
        weightGrams: 300,
        foodType: 'beverage',
        calories: 90,
        protein: 0,
        carbohydrates: 22,
        totalFat: 0,
        nutrients: { calories: 90, protein: 0, carbohydrates: 22, totalFat: 0, sugar: 22, addedSugar: 22, sodium: 10 },
        sourceImageIndex: 0,
      },
    ];
    const result = await applyMealEdits({
      items,
      userMessage: 'the tea is unsweetened',
      commands: [
        { action: 'update_modifier', itemName: 'Sweet Iced Tea', modifier: 'unsweetened' },
        { action: 'update_modifier', itemName: 'Sweet Iced Tea', modifier: 'unsweetened', newItemName: 'Unsweetened Iced Tea' },
      ],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].nutrients.addedSugar).toBe(0);
    expect(result.items[0].nutrients.calories).toBe(0);
  });

  it('synthesizes unsweetened modifier from userMessage when commands are empty (e.g. Es Teh Manis)', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Es Teh Manis',
        originalName: 'Sweet Iced Tea',
        canonicalDbName: 'Sweet Iced Tea',
        weightGrams: 350,
        foodType: 'beverage',
        calories: 104,
        protein: 0,
        carbohydrates: 26,
        totalFat: 0,
        nutrients: { calories: 104, protein: 0, carbohydrates: 26, totalFat: 0, sugar: 26, addedSugar: 26, sodium: 5 },
        sourceImageIndex: 0,
      },
    ];
    const result = await applyMealEdits({
      items,
      userMessage: 'the tea is unsweetened',
      commands: [],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].nutrients.addedSugar).toBe(0);
    expect(result.items[0].nutrients.calories).toBe(0);
    expect(result.items[0].name).toMatch(/tawar|unsweetened/i);
    expect(result.changed).toBe(true);
  });

  it('synthesizes unsweetened modifier from Indonesian userMessage "I had es teh tawar"', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Es Teh Manis',
        originalName: 'Es Teh Manis',
        canonicalDbName: 'Sweet Iced Tea',
        weightGrams: 350,
        foodType: 'beverage',
        calories: 104,
        protein: 0,
        carbohydrates: 26,
        totalFat: 0,
        nutrients: { calories: 104, protein: 0, carbohydrates: 26, totalFat: 0, sugar: 26, addedSugar: 26, sodium: 5 },
        sourceImageIndex: 0,
      },
    ];
    const result = await applyMealEdits({
      items,
      userMessage: 'I had es teh tawar',
      commands: [],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].nutrients.addedSugar).toBe(0);
    expect(result.items[0].nutrients.calories).toBe(0);
    expect(result.items[0].name).toBe('Es Teh Tawar');
    expect(result.changed).toBe(true);
  });

  it('remove_component subtracts locked nutrients (uneven share, not weight ratio)', async () => {
    const items = [
      {
        scoutIndex: 1,
        name: 'Jajanan Trio',
        canonicalDbName: 'Jajanan Trio',
        originalName: 'Jajanan Trio',
        weightGrams: 170,
        nutrients: { calories: 367, protein: 7, carbohydrates: 52, totalFat: 14.5, saturatedFat: 4.5, sugar: 14, addedSugar: 10, sodium: 300 },
        sourceImageIndex: 2,
        componentsDetailList: [
          { name: 'Risoles', weightGrams: 60, nutrients: { calories: 190, protein: 4, carbohydrates: 18, totalFat: 10, saturatedFat: 3, sugar: 2, addedSugar: 1, sodium: 250 } },
          { name: 'Jadah Ketan', weightGrams: 50, nutrients: { calories: 65, protein: 1.5, carbohydrates: 14, totalFat: 1.5, saturatedFat: 0.5, sugar: 2, addedSugar: 1, sodium: 20 } },
          { name: 'Apem', weightGrams: 60, nutrients: { calories: 112, protein: 1.5, carbohydrates: 20, totalFat: 3, saturatedFat: 1, sugar: 10, addedSugar: 8, sodium: 30 } },
        ],
      },
    ];
    const result = await applyMealEdits({
      items,
      userMessage: "I didn't eat the pancake",
      commands: [{ action: 'remove_component', itemName: 'Jajanan Trio', componentName: 'Apem' }],
    });
    const row = result.items[0];
    expect(row.componentsDetailList.map((c: any) => c.name)).toEqual(['Risoles', 'Jadah Ketan']);
    expect(row.weightGrams).toBe(110);
    // Exact subtraction: sugar 14 − 10 = 4 (weight-ratio scaling would give ~9)
    expect(row.nutrients.sugar).toBe(4);
    expect(row.nutrients.addedSugar).toBe(2);
    expect(row.nutrients.saturatedFat).toBe(3.5);
    expect(row.nutrients.sodium).toBe(270);
    expect(row.nutrients.protein).toBe(5.5);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
    expect(result.changed).toBe(true);
  });

  it('remove_component keeps locked calories via subtraction instead of Atwater', async () => {
    const items = [
      {
        scoutIndex: 4,
        name: 'Brownies',
        weightGrams: 30,
        lockedNutrientKeys: ['calories'],
        nutrients: { calories: 140, protein: 2, carbohydrates: 22, totalFat: 4, sugar: 12 },
        componentsDetailList: [
          { name: 'Brownie Half A', weightGrams: 15, nutrients: { calories: 70, protein: 1, carbohydrates: 11, totalFat: 2, sugar: 6 } },
          { name: 'Brownie Half B', weightGrams: 15, nutrients: { calories: 70, protein: 1, carbohydrates: 11, totalFat: 2, sugar: 6 } },
        ],
      },
    ];
    const result = await applyMealEdits({
      items,
      commands: [{ action: 'remove_component', itemName: 'Brownies', componentName: 'Half B' }],
    });
    expect(result.items[0].nutrients.calories).toBe(70);
    expect(result.items[0].weightGrams).toBe(15);
  });

  it('remove_component with unknown component or missing name is a no-op', async () => {
    const items = [
      {
        scoutIndex: 1,
        name: 'Jajanan Trio',
        weightGrams: 170,
        nutrients: { calories: 367, sugar: 14 },
        componentsDetailList: [
          { name: 'Risoles', weightGrams: 60, nutrients: { calories: 190, sugar: 2 } },
        ],
      },
    ];
    const miss = await applyMealEdits({
      items,
      commands: [{ action: 'remove_component', itemName: 'Jajanan Trio', componentName: 'Apem' }],
    });
    expect(miss.items[0].nutrients.sugar).toBe(14);
    expect(miss.items[0].weightGrams).toBe(170);
    const nameless = await applyMealEdits({
      items,
      commands: [{ action: 'remove_component', itemName: 'Jajanan Trio' }],
    });
    expect(nameless.items[0].nutrients.sugar).toBe(14);
  });
});

describe('evidence job outer check (frozen example, class tests above)', () => {
  it('T2 commands keep 85g count=2, sauce remainder, nested sides, 1635g', async () => {
    const t1 = [
      { scoutIndex: 0, name: 'Soft Serve Ice Cream Cone', canonicalDbName: 'Soft Serve Ice Cream Cone', weightGrams: 120, calories: 253, protein: 4.5, nutrients: { calories: 253, protein: 4.5, totalFat: 8.3, carbohydrates: 40, sodium: 90 }, sourceImageIndex: 0 },
      { scoutIndex: 1, name: 'Crispy Fried Chicken', canonicalDbName: 'Crispy Fried Chicken', weightGrams: 160, calories: 283, protein: 28, nutrients: { calories: 283, protein: 28, totalFat: 14.5, carbohydrates: 10, sodium: 480 }, sourceImageIndex: 1 },
      { scoutIndex: 2, name: 'Sempol Ayam', canonicalDbName: 'Sempol Ayam', weightGrams: 85, calories: 162, protein: 9.5, nutrients: { calories: 162, protein: 9.5, totalFat: 7.5, carbohydrates: 14, sodium: 310 }, sourceImageIndex: 2 },
      { scoutIndex: 3, name: 'Hemaviton C1000 Orange Drink', canonicalDbName: 'Hemaviton C1000 Orange Drink', weightGrams: 330, calories: 100, protein: 0, nutrients: { calories: 100, protein: 0, totalFat: 0, carbohydrates: 25, sodium: 45 }, sourceImageIndex: 3 },
      {
        scoutIndex: 4,
        name: 'Beef and Chicken Steak with Wedges and Mixed Vegetables',
        canonicalDbName: 'Beef and Chicken Steak with Wedges and Mixed Vegetables',
        weightGrams: 500,
        calories: 608,
        protein: 48.5,
        nutrients: { calories: 608, protein: 48.5, totalFat: 22.6, carbohydrates: 54, sodium: 1070 },
        sourceImageIndex: 4,
        components: [
          { name: 'Beef and Chicken Steak with Black Pepper Sauce', weightGrams: 250, calories: 330.5, protein: 42, nutrients: { calories: 330.5, protein: 42, totalFat: 14.5, carbohydrates: 8 } },
          { name: 'Potato Wedges', weightGrams: 130, calories: 167.1, protein: 3, nutrients: { calories: 167.1, protein: 3, totalFat: 3.9, carbohydrates: 30 } },
          { name: 'Mixed Vegetables with Mayonnaise', weightGrams: 120, calories: 115.8, protein: 3.5, nutrients: { calories: 115.8, protein: 3.5, totalFat: 4.2, carbohydrates: 16 } },
        ],
      },
      { scoutIndex: 5, name: 'Iced Tea', canonicalDbName: 'Iced Tea', weightGrams: 300, calories: 74, protein: 0, foodType: 'beverage', nutrients: { calories: 74, protein: 0, totalFat: 0, carbohydrates: 18.5, sugar: 18, addedSugar: 18, sodium: 10 }, sourceImageIndex: 4 },
      { scoutIndex: 6, name: 'Sosis Bakar / Cumi Bakar Tusuk', canonicalDbName: 'Sosis Bakar / Cumi Bakar Tusuk', weightGrams: 140, calories: 201, protein: 18, nutrients: { calories: 201, protein: 18, totalFat: 9, carbohydrates: 12, sodium: 520 }, sourceImageIndex: 5 },
    ];
    const result = await applyMealEdits({
      items: t1,
      userMessage: 'The sempol ayam is 2 otak otak, the beef and chicken is 100g of beef steak and 100g of chicken steak, the tea is unsweetened and the sos bakar is fried chicken fillet',
      commands: [
        { action: 'replace_identity', itemName: 'Sempol Ayam', newItemName: 'Otak-Otak', newWeightGrams: 85, estimate: { protein: 10, carbohydrates: 15, totalFat: 4, saturatedFat: 1.2, sodium: 280, cookingMethod: 'grilled', foodType: 'protein' } },
        { action: 'set_count', itemName: 'Otak-Otak', count: 2 },
        { action: 'split_item', itemName: 'Beef and Chicken Steak with Wedges and Mixed Vegetables', into: [
          { name: 'Beef Steak', grams: 100, role: 'food', estimate: { protein: 26, carbohydrates: 0, totalFat: 11, saturatedFat: 4.5, sodium: 70, cookingMethod: 'pan_fried', foodType: 'protein' } },
          { name: 'Chicken Steak', grams: 100, role: 'food', estimate: { protein: 31, carbohydrates: 0, totalFat: 3.6, saturatedFat: 1.0, sodium: 75, cookingMethod: 'pan_fried', foodType: 'protein' } },
        ] },
        { action: 'set_modifier', itemName: 'Iced Tea', modifier: 'unsweetened', newItemName: 'Unsweetened Iced Tea' },
        { action: 'replace_identity', itemName: 'Sosis Bakar / Cumi Bakar Tusuk', newItemName: 'Fried Chicken Fillet', newWeightGrams: 140, estimate: { protein: 29.4, carbohydrates: 11.2, totalFat: 19.6, saturatedFat: 5.5, sodium: 520, cookingMethod: 'deep_fried', foodType: 'protein' } },
      ],
    });
    const otak = result.items.find((it) => /otak/i.test(it.name));
    expect(otak.weightGrams).toBe(85);
    expect(otak.count).toBe(2);
    const sauce = result.items.find((it) => /pepper sauce/i.test(it.name));
    expect(sauce?.role).toBe('component');
    expect(sauce?.weightGrams).toBe(50);
    expect(result.items.find((it) => /wedges/i.test(it.name))?.role).toBe('component');
    expect(result.items.find((it) => /vegetable/i.test(it.name))?.role).toBe('component');
    expect(result.weightGrams).toBe(1635);
    const tiles = compositionTileItems(result.items);
    expect(tiles.length).toBeLessThanOrEqual(8);
    expect(tiles.some((t) => /wedges|sauce|vegetable/i.test(t.name || t.originalName || ''))).toBe(false);
  });

  it('set_modifier propagates modified name and nutrients to nested components/componentsDetailList', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Es Teh Manis',
        canonicalDbName: 'Es Teh Manis',
        weightGrams: 350,
        calories: 104,
        protein: 0,
        foodType: 'beverage',
        nutrients: { calories: 104, protein: 0, totalFat: 0, carbohydrates: 26, sugar: 25, addedSugar: 25, sodium: 10 },
        components: [
          {
            name: 'Sweet Iced Tea',
            weightGrams: 350,
            calories: 104,
            nutrients: { calories: 104, protein: 0, totalFat: 0, carbohydrates: 26, sugar: 25, addedSugar: 25, sodium: 10 }
          }
        ],
        componentsDetailList: [
          {
            name: 'Sweet Iced Tea',
            weightGrams: 350,
            calories: 104,
            nutrients: { calories: 104, protein: 0, totalFat: 0, carbohydrates: 26, sugar: 25, addedSugar: 25, sodium: 10 }
          }
        ]
      }
    ];

    const result = await applyMealEdits({
      items,
      commands: [
        { action: 'set_modifier', itemName: 'Es Teh Manis', modifier: 'unsweetened', newItemName: 'Es Teh Tawar' }
      ]
    });

    const tea = result.items[0];
    expect(tea.name).toBe('Es Teh Tawar');
    expect(tea.nutrients.calories).toBe(0);
    expect(tea.nutrients.sugar).toBe(0);

    // Verify propagation to components
    expect(tea.components[0].name).toBe('Unsweetened Iced Tea');
    expect(tea.components[0].nutrients.calories).toBe(0);
    expect(tea.components[0].nutrients.sugar).toBe(0);

    // Verify propagation to componentsDetailList
    expect(tea.componentsDetailList[0].name).toBe('Unsweetened Iced Tea');
    expect(tea.componentsDetailList[0].nutrients.calories).toBe(0);
    expect(tea.componentsDetailList[0].nutrients.sugar).toBe(0);
  });

  it('resets constituent components when replace_identity changes the dish to a distinct new identity', async () => {
    const items = [
      {
        scoutIndex: 2,
        name: 'Takeaway Drink in Plastic Bag',
        canonicalDbName: 'Takeaway Drink in Plastic Bag',
        weightGrams: 300,
        calories: 120,
        protein: 0,
        foodType: 'beverage',
        nutrients: { calories: 120, protein: 0, totalFat: 0, carbohydrates: 30, sugar: 25, addedSugar: 25, sodium: 10 },
        components: [
          { name: 'Sweetened Beverage in Plastic Bag', weightGrams: 300, calories: 120, protein: 0, carbohydrates: 30 }
        ],
        componentsDetailList: [
          { name: 'Sweetened Beverage in Plastic Bag', weightGrams: 300, calories: 120, protein: 0, carbohydrates: 30 }
        ],
      },
    ];

    const result = await applyMealEdits({
      items,
      commands: [
        {
          action: 'replace_identity',
          itemName: 'Takeaway Drink in Plastic Bag',
          newItemName: 'Raw Coconut Juice',
          newWeightGrams: 300,
        }
      ]
    });

    const juice = result.items[0];
    expect(juice.name).toBe('Raw Coconut Juice');
    // Coconut water is ~50-60 kcal for 300g, 0g added sugar
    expect(juice.calories).toBeLessThan(70);
    expect(juice.nutrients.addedSugar).toBe(0);
    // Subcomponents should NOT retain old "Sweetened Beverage in Plastic Bag"
    expect(juice.components[0].name).toBe('Raw Coconut Juice');
    expect(juice.componentsDetailList[0].name).toBe('Raw Coconut Juice');
  });
});

describe('golden', () => {
  function cakalangKangkungPlate() {
    return [
      {
        scoutIndex: 0,
        name: 'Cakalang',
        canonicalDbName: 'Cakalang',
        originalName: 'Cakalang',
        weightGrams: 100,
        calories: 120,
        protein: 25,
        carbohydrates: 0,
        totalFat: 2,
        nutrients: { calories: 120, protein: 25, carbohydrates: 0, totalFat: 2, saturatedFat: 0.5, sodium: 300 },
        sourceImageIndex: 0,
        dbSource: 'estimated',
      },
      {
        scoutIndex: 1,
        name: 'Kangkung',
        canonicalDbName: 'Kangkung',
        originalName: 'Kangkung',
        weightGrams: 150,
        calories: 90,
        protein: 3,
        carbohydrates: 8,
        totalFat: 5,
        nutrients: { calories: 90, protein: 3, carbohydrates: 8, totalFat: 5, saturatedFat: 1, sodium: 200 },
        sourceImageIndex: 1,
        dbSource: 'estimated',
      },
    ];
  }

  it('golden: replace_identity preserves scoutIndex and sourceImageIndex on the replaced row', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: 'Ikan Nila',
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    const fish = result.items.find((it: any) => it.name === 'Ikan Nila');
    const kangkung = result.items.find((it: any) => it.name === 'Kangkung');

    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(fish?.scoutIndex).toBe(0);
    expect(fish?.sourceImageIndex).toBe(0);
    expect(kangkung?.scoutIndex).toBe(1);
    expect(kangkung?.sourceImageIndex).toBe(1);
    expect(result.changed).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: replace_identity may change dbSource to estimated but keeps photo indices', async () => {
    const items = cakalangKangkungPlate().map((it) => ({
      ...it,
      dbSource: it.scoutIndex === 0 ? 'fdc' : it.dbSource,
      boundingBox2D: it.scoutIndex === 0 ? [10, 20, 70, 80] : (it as any).boundingBox2D,
    }));

    const result = await applyMealEdits({
      items,
      userMessage: 'the cakalang is ikan nila',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: 'Ikan Nila',
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.dbSource).toBe('estimated');
    expect(fish?.sourceImageIndex).toBe(0);
    expect(fish?.boundingBox2D).toEqual([10, 20, 70, 80]);
    expect(kangkung?.sourceImageIndex).toBe(1);
  });

  it('golden: replace_item aliases to replace_identity for fish rename', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila',
      commands: [{
        action: 'replace_item',
        itemName: 'Cakalang',
        newItemName: 'Ikan Nila',
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Ikan Nila');
    expect(fish?.keyword).toBe('Ikan Nila');
    expect(fish?.scoutIndex).toBe(0);
    expect(fish?.sourceImageIndex).toBe(0);
    expect(fish?.weightGrams).toBe(100);
    expect(fish?.calories).toBeGreaterThan(0);
    expect(result.items).toHaveLength(2);
    expect(result.changed).toBe(true);
    expect(result.notes.some((n) => /replace_identity "Cakalang"/.test(n))).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: replace_identity keeps boundingBox2D array equality with the prior row', async () => {
    const boundingBox2D = [12, 18, 86, 92];
    const items = [
      {
        scoutIndex: 0,
        name: 'Cakalang',
        canonicalDbName: 'Cakalang',
        originalName: 'Cakalang',
        keyword: 'Cakalang',
        weightGrams: 100,
        calories: 120,
        protein: 25,
        carbohydrates: 0,
        totalFat: 2,
        nutrients: { calories: 120, protein: 25, carbohydrates: 0, totalFat: 2, saturatedFat: 0.5, sodium: 300 },
        sourceImageIndex: 0,
        boundingBox2D,
        dbSource: 'estimated',
      },
    ];

    const result = await applyMealEdits({
      items,
      userMessage: 'the cakalang is ikan nila',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: 'Ikan Nila',
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    expect(fish).toBeTruthy();
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.boundingBox2D).toEqual(boundingBox2D);
    expect(fish?.sourceImageIndex).toBe(0);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('keeps replaced fish identity through a later weight-only edit on another item', async () => {
    const replaced = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: 'Ikan Nila',
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    const afterPortion = await applyMealEdits({
      items: replaced.items,
      userMessage: 'the kangkung is 120g',
      commands: [{ action: 'set_weight', itemName: 'Kangkung', newWeightGrams: 120 }],
    });

    const fish = afterPortion.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = afterPortion.items.find((it: any) => it.scoutIndex === 1);

    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(fish.name).toBe('Ikan Nila');
    expect(fish.canonicalDbName).toBe('Ikan Nila');
    expect(fish.originalName).toBe('Ikan Nila');
    expect(fish.name).not.toMatch(/cakalang/i);
    expect(kangkung.weightGrams).toBe(120);
    expect(afterPortion.weightGrams).toBe(220);
  });

  it('golden: unsweetened tea and Ikan Nila rename persist together on top-level and component identities', async () => {
    const identity = (name: string, extra: any = {}) => ({
      name,
      canonicalDbName: name,
      originalName: name,
      keyword: name,
      ...extra,
    });

    const child = (name: string, grams: number, nutrients: any) => identity(name, {
      weightGrams: grams,
      calories: nutrients.calories ?? 0,
      protein: nutrients.protein ?? 0,
      carbohydrates: nutrients.carbohydrates ?? 0,
      totalFat: nutrients.totalFat ?? 0,
      nutrients,
    });

    const fishNutrients = {
      calories: 120,
      protein: 25,
      carbohydrates: 0,
      totalFat: 2,
      saturatedFat: 0.5,
      sodium: 300,
    };

    const teaNutrients = {
      calories: 104,
      protein: 0,
      carbohydrates: 26,
      totalFat: 0,
      sugar: 26,
      addedSugar: 26,
      sodium: 5,
    };

    const items = [
      identity('Cakalang', {
        scoutIndex: 0,
        weightGrams: 100,
        calories: fishNutrients.calories,
        protein: fishNutrients.protein,
        carbohydrates: fishNutrients.carbohydrates,
        totalFat: fishNutrients.totalFat,
        nutrients: fishNutrients,
        sourceImageIndex: 0,
        components: [child('Cakalang', 100, fishNutrients)],
        componentsDetailList: [child('Cakalang', 100, fishNutrients)],
      }),
      identity('Es Teh Manis', {
        scoutIndex: 1,
        weightGrams: 350,
        foodType: 'beverage',
        calories: teaNutrients.calories,
        protein: teaNutrients.protein,
        carbohydrates: teaNutrients.carbohydrates,
        totalFat: teaNutrients.totalFat,
        nutrients: teaNutrients,
        sourceImageIndex: 1,
        components: [child('Sweet Iced Tea', 350, teaNutrients)],
        componentsDetailList: [child('Sweet Iced Tea', 350, teaNutrients)],
      }),
    ];

    const result = await applyMealEdits({
      items,
      userMessage: 'the cakalang is ikan nila and the tea is tawar',
      commands: [
        { action: 'set_modifier', itemName: 'Es Teh Manis', modifier: 'unsweetened', newItemName: 'Es Teh Tawar' },
        {
          action: 'replace_identity',
          itemName: 'Cakalang',
          newItemName: 'Ikan Nila',
          estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
        },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const tea = result.items.find((it: any) => it.scoutIndex === 1);

    expect(result.items).toHaveLength(2);
    expect(result.changed).toBe(true);

    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Ikan Nila');
    expect(fish?.keyword).toBe('Ikan Nila');

    for (const comp of [fish?.components?.[0], fish?.componentsDetailList?.[0]]) {
      expect(comp?.name).toBe('Ikan Nila');
      expect(comp?.canonicalDbName).toBe('Ikan Nila');
      expect(comp?.originalName).toBe('Ikan Nila');
      expect(comp?.keyword).toBe('Ikan Nila');
    }

    expect(tea?.name).toBe('Es Teh Tawar');
    expect(tea?.canonicalDbName).toBe('Es Teh Tawar');
    expect(tea?.originalName).toBe('Es Teh Tawar');
    expect(tea?.keyword).toBe('Es Teh Tawar');
    expect(tea?.nutrients.addedSugar).toBe(0);
    expect(tea?.nutrients.calories).toBe(0);

    for (const comp of [tea?.components?.[0], tea?.componentsDetailList?.[0]]) {
      expect(comp?.name).toMatch(/tawar|unsweetened/i);
      expect(comp?.canonicalDbName).toBe(comp?.name);
      expect(comp?.originalName).toBe(comp?.name);
      expect(comp?.keyword).toBe(comp?.name);
      expect(comp?.nutrients.addedSugar).toBe(0);
    }

    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('scout diff + applyMealEdits replaces sweet tea with unsweetened tea and updates tilapia sodium without item duplication', async () => {
    const identity = (name: string, extra: Record<string, any> = {}) => ({
      name,
      canonicalDbName: name,
      originalName: name,
      keyword: name,
      ...extra,
    });
    const child = (name: string, grams: number, nutrients: any) => identity(name, {
      weightGrams: grams,
      calories: nutrients.calories ?? 0,
      protein: nutrients.protein ?? 0,
      carbohydrates: nutrients.carbohydrates ?? 0,
      totalFat: nutrients.totalFat ?? 0,
      nutrients,
    });

    const priorItems = [
      identity('Nasi Putih', {
        weightGrams: 150,
        sourceImageIndex: 0,
        calories: 195,
        protein: 4,
        carbohydrates: 43,
        totalFat: 0.5,
        nutrients: { calories: 195, protein: 4, carbohydrates: 43, totalFat: 0.5, sodium: 5 },
      }),
      identity('Cah Kangkung', {
        weightGrams: 120,
        sourceImageIndex: 0,
        calories: 93,
        protein: 3,
        carbohydrates: 5,
        totalFat: 7,
        nutrients: { calories: 93, protein: 3, carbohydrates: 5, totalFat: 7, sodium: 550 },
      }),
      identity('Ikan Bakar', {
        weightGrams: 200,
        sourceImageIndex: 0,
        calories: 240,
        protein: 35,
        carbohydrates: 0,
        totalFat: 10,
        nutrients: { calories: 240, protein: 35, carbohydrates: 0, totalFat: 10, sodium: 550 },
        components: [child('Ikan Bakar', 180, { calories: 235, protein: 35, carbohydrates: 0, totalFat: 10, sodium: 545 })],
      }),
      identity('Es Teh Manis', {
        genericEnglishName: 'sweet iced tea',
        weightGrams: 300,
        sourceImageIndex: 0,
        foodType: 'beverage',
        calories: 90,
        protein: 0,
        carbohydrates: 22,
        totalFat: 0,
        nutrients: { calories: 90, protein: 0, carbohydrates: 22, totalFat: 0, addedSugar: 20, sodium: 10 },
        components: [child('Sweet Iced Tea', 300, { calories: 90, protein: 0, carbohydrates: 22, totalFat: 0, addedSugar: 20, sodium: 10 })],
      }),
      identity('Kue Apem Panggang', {
        weightGrams: 60,
        sourceImageIndex: 1,
        calories: 138,
        protein: 2,
        carbohydrates: 28,
        totalFat: 2,
        nutrients: { calories: 138, protein: 2, carbohydrates: 28, totalFat: 2, addedSugar: 8, sodium: 120 },
      }),
    ];

    const scoutDishes = [
      {
        name: 'Ikan Nila Bakar',
        genericEnglishName: 'grilled tilapia',
        estimatedWeightGrams: 200,
        sourceImageIndex: 0,
        nutrients: { calories: 210, protein: 38, carbohydrates: 2, totalFat: 6, saturatedFat: 1.5, sodium: 300 },
        foods: [
          { foodName: 'Ikan Nila Bakar', weightGrams: 200, nutrients: { calories: 210, protein: 38, carbohydrates: 2, totalFat: 6, saturatedFat: 1.5, sodium: 300 } },
        ],
      },
      {
        name: 'Es Teh Tawar',
        genericEnglishName: 'unsweetened iced tea',
        estimatedWeightGrams: 300,
        sourceImageIndex: 0,
        nutrients: { calories: 2, protein: 0, carbohydrates: 0.5, totalFat: 0, addedSugar: 0, sodium: 5 },
        foods: [
          { foodName: 'Teh Tawar', weightGrams: 300, nutrients: { calories: 2, protein: 0, carbohydrates: 0.5, totalFat: 0, addedSugar: 0, sodium: 5 } },
        ],
      },
    ];

    const result = await applyMealEdits({
      items: priorItems,
      commands: [],
      scoutItems: scoutDishes,
      userMessage: 'The ikan is nilai and tea is unsweatened',
    });

    // Verify no item duplication occurred
    expect(result.items).toHaveLength(5);
    expect(result.weightGrams).toBe(830);

    // Verify fish replacement and updated sodium
    const tilapia = result.items.find((it: any) => it.name.includes('Nila'));
    expect(tilapia).toBeDefined();
    expect(tilapia?.nutrients.sodium).toBe(300);

    // Verify tea replacement and unsweetened sugar
    const tea = result.items.find((it: any) => it.name.includes('Teh'));
    expect(tea).toBeDefined();
    expect(tea?.name).toMatch(/tawar|unsweetened/i);
    expect(tea?.nutrients.addedSugar).toBe(0);

    // Total added sugar should be 8g (from Apem), not 28g
    expect(result.nutrients.addedSugar).toBe(8);
  });

  it('contract: applyMealEdits deterministically honors agent replacesDish and action without item duplicates', async () => {
    const priorItems = [
      { name: 'Nasi Putih', canonicalDbName: 'Nasi Putih', originalName: 'Nasi Putih', keyword: 'nasi putih', weightGrams: 150, nutrients: { calories: 195, carbs: 42, protein: 4, fat: 0.5, saturatedFat: 0.1, addedSugar: 0, sodium: 5, totalFibre: 0.6 } },
      { name: 'Cah Kangkung', canonicalDbName: 'Cah Kangkung', originalName: 'Cah Kangkung', keyword: 'kangkung', weightGrams: 120, nutrients: { calories: 93, carbs: 4, protein: 3, fat: 7, saturatedFat: 1.2, addedSugar: 0, sodium: 550, totalFibre: 2.5 } },
      {
        name: 'Ikan Bakar',
        canonicalDbName: 'Ikan Bakar',
        originalName: 'Ikan Bakar',
        keyword: 'ikan bakar',
        weightGrams: 200,
        nutrients: { calories: 240, carbs: 2, protein: 35, fat: 10, saturatedFat: 2.5, addedSugar: 0, sodium: 550, totalFibre: 0 },
        foods: [{ foodName: 'Ikan Bakar', weightGrams: 180, nutrients: { calories: 230, protein: 35, sodium: 545 } }],
      },
      {
        name: 'Es Teh Manis',
        canonicalDbName: 'Es Teh Manis',
        originalName: 'Es Teh Manis',
        keyword: 'teh manis',
        genericEnglishName: 'sweet iced tea',
        weightGrams: 300,
        nutrients: { calories: 90, carbs: 22, protein: 0, fat: 0, saturatedFat: 0, addedSugar: 20, sodium: 10, totalFibre: 0 },
        foods: [{ foodName: 'Teh Manis', weightGrams: 300, nutrients: { calories: 90, addedSugar: 20, sodium: 10 } }],
      },
      { name: 'Kue Apem Panggang', canonicalDbName: 'Kue Apem Panggang', originalName: 'Kue Apem Panggang', keyword: 'apem', weightGrams: 60, nutrients: { calories: 138, carbs: 26, protein: 2, fat: 3, saturatedFat: 1.5, addedSugar: 8, sodium: 120, totalFibre: 0.8 } },
    ];

    const agentScoutDishes = [
      {
        dishName: 'Ikan Nila Bakar',
        name: 'Ikan Nila Bakar',
        genericEnglishName: 'grilled tilapia',
        action: 'replace',
        replacesDish: 'Ikan Bakar',
        targetDishIndex: 3,
        estimatedWeightGrams: 200,
        sourceImageIndex: 0,
        nutrients: { calories: 210, carbs: 1, protein: 38, fat: 6, saturatedFat: 1.5, addedSugar: 0, sodium: 300, totalFibre: 0 },
        foods: [{ foodName: 'Ikan Nila Bakar', weightGrams: 200, nutrients: { calories: 210, protein: 38, sodium: 300 } }],
      },
      {
        dishName: 'Es Teh Tawar',
        name: 'Es Teh Tawar',
        genericEnglishName: 'unsweetened iced tea',
        action: 'replace',
        replacesDish: 'Es Teh Manis',
        targetDishIndex: 4,
        estimatedWeightGrams: 300,
        sourceImageIndex: 0,
        nutrients: { calories: 2, carbs: 0.5, protein: 0, fat: 0, saturatedFat: 0, addedSugar: 0, sodium: 5, totalFibre: 0 },
        foods: [{ foodName: 'Teh Tawar', weightGrams: 300, nutrients: { calories: 2, addedSugar: 0, sodium: 5 } }],
      },
    ];

    const result = await applyMealEdits({
      items: priorItems,
      commands: [],
      scoutItems: agentScoutDishes,
      userMessage: 'The ikan is nila and the tea is unsweetened',
    });

    expect(result.items).toHaveLength(5);
    expect(result.weightGrams).toBe(830);

    const tea = result.items.find((it: any) => it.name.includes('Teh'));
    expect(tea?.name).toBe('Es Teh Tawar');
    expect(tea?.nutrients.addedSugar).toBe(0);

    const fish = result.items.find((it: any) => it.name.includes('Nila'));
    expect(fish?.name).toBe('Ikan Nila Bakar');
    expect(fish?.nutrients.sodium).toBe(300);

    expect(result.nutrients.addedSugar).toBe(8);
  });

  it('contract: applyMealEdits honors subitem add_component and replace_component with full nutrients and image tracking', async () => {
    const priorFishPlatter = {
      name: 'Ikan Bakar Platter',
      canonicalDbName: 'Ikan Bakar Platter',
      originalName: 'Ikan Bakar Platter',
      keyword: 'ikan bakar platter',
      weightGrams: 250,
      sourceImageIndex: 0,
      nutrients: { calories: 280, carbs: 2, protein: 36, fat: 10, saturatedFat: 2.5, addedSugar: 0, sodium: 405, totalFibre: 1 },
      components: [
        { name: 'Ikan Bakar', foodName: 'Ikan Bakar', weightGrams: 200, nutrients: { calories: 260, carbs: 0, protein: 35, fat: 9, saturatedFat: 2.2, addedSugar: 0, sodium: 400, totalFibre: 0 } },
        { name: 'Lalapan', foodName: 'Lalapan', weightGrams: 50, nutrients: { calories: 20, carbs: 2, protein: 1, fat: 1, saturatedFat: 0.3, addedSugar: 0, sodium: 5, totalFibre: 1 } },
      ],
      componentsDetailList: [
        { name: 'Ikan Bakar', foodName: 'Ikan Bakar', weightGrams: 200, nutrients: { calories: 260, carbs: 0, protein: 35, fat: 9, saturatedFat: 2.2, addedSugar: 0, sodium: 400, totalFibre: 0 } },
        { name: 'Lalapan', foodName: 'Lalapan', weightGrams: 50, nutrients: { calories: 20, carbs: 2, protein: 1, fat: 1, saturatedFat: 0.3, addedSugar: 0, sodium: 5, totalFibre: 1 } },
      ],
      hasComponents: true,
    };

    // Test subitem add_component
    const addResult = await applyMealEdits({
      items: [priorFishPlatter],
      commands: [
        {
          action: 'add_component',
          itemName: 'Ikan Bakar Platter',
          componentName: 'Sambal Terasi',
          newWeightGrams: 30,
          sourceImageIndex: 1,
          estimate: {
            nutrients: { calories: 35, carbs: 3, protein: 1, fat: 2, saturatedFat: 0.4, addedSugar: 1, sodium: 220, totalFibre: 0.5 },
          },
        },
      ],
      userMessage: 'Add sambal terasi to the fish platter',
    });

    expect(addResult.items).toHaveLength(1);
    const updatedDish = addResult.items[0];
    expect(updatedDish.weightGrams).toBe(280);
    expect(updatedDish.components).toHaveLength(3);
    const addedComp = updatedDish.components.find((c: any) => c.name === 'Sambal Terasi');
    expect(addedComp).toBeDefined();
    expect(addedComp.sourceImageIndex).toBe(1);
    expect(updatedDish.nutrients.sodium).toBe(625); // 405 + 220
    expect(updatedDish.nutrients.addedSugar).toBe(1);

    // Test subitem replace_component: replace Lalapan with Kerupuk
    const replaceResult = await applyMealEdits({
      items: [updatedDish],
      commands: [
        {
          action: 'replace_component',
          itemName: 'Ikan Bakar Platter',
          componentName: 'Lalapan',
          newItemName: 'Kerupuk Ikan',
          newWeightGrams: 20,
          sourceImageIndex: 0,
          estimate: {
            nutrients: { calories: 95, carbs: 12, protein: 2, fat: 4, saturatedFat: 0.8, addedSugar: 0, sodium: 110, totalFibre: 0.2 },
          },
        },
      ],
      userMessage: 'Replace lalapan with kerupuk ikan',
    });

    const replacedDish = replaceResult.items[0];
    expect(replacedDish.weightGrams).toBe(250); // 280 - 50 (lalapan) + 20 (kerupuk)
    expect(replacedDish.components.some((c: any) => c.name === 'Lalapan')).toBe(false);
    expect(replacedDish.components.some((c: any) => c.name === 'Kerupuk Ikan')).toBe(true);
  });

  it('contract: applyMealEdits executes remove_item for dish deletion', async () => {
    const items = [
      { name: 'Nasi Putih', weightGrams: 150, nutrients: { calories: 195, carbs: 42, protein: 4, fat: 0.5, saturatedFat: 0.1, addedSugar: 0, sodium: 5, totalFibre: 0.6 } },
      { name: 'Es Teh Manis', weightGrams: 300, nutrients: { calories: 90, carbs: 22, protein: 0, fat: 0, saturatedFat: 0, addedSugar: 20, sodium: 10, totalFibre: 0 } },
    ];

    const result = await applyMealEdits({
      items,
      commands: [{ action: 'remove_item', itemName: 'Es Teh Manis' }],
      userMessage: 'I did not drink the sweet tea, remove it',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Nasi Putih');
    expect(result.nutrients.addedSugar).toBe(0);
    expect(result.weightGrams).toBe(150);
  });

  it('contract: replace_identity with delta foods merges rather than wiping out existing components', async () => {
    const hotpot = {
      name: 'Beef and Vegetable Hotpot',
      canonicalDbName: 'Beef and Vegetable Hotpot',
      originalName: 'Beef and Vegetable Hotpot',
      keyword: 'beef and vegetable hotpot',
      weightGrams: 500,
      nutrients: { calories: 350, protein: 32, totalFat: 14, carbohydrates: 11, sodium: 105 },
      components: [
        { name: 'Beef Slices', foodName: 'Beef Slices', weightGrams: 120, nutrients: { calories: 180, protein: 22, totalFat: 10, carbohydrates: 0, sodium: 60 } },
        { name: 'Tofu', foodName: 'Tofu', weightGrams: 100, nutrients: { calories: 80, protein: 8, totalFat: 3, carbohydrates: 2, sodium: 10 } },
        { name: 'Shirataki Noodles', foodName: 'Shirataki Noodles', weightGrams: 100, nutrients: { calories: 15, protein: 0, totalFat: 0, carbohydrates: 3, sodium: 5 } },
        { name: 'Napa Cabbage and Vegetables', foodName: 'Napa Cabbage and Vegetables', weightGrams: 180, nutrients: { calories: 40, protein: 2, totalFat: 0.5, carbohydrates: 6, sodium: 30 } },
      ],
      componentsDetailList: [
        { name: 'Beef Slices', foodName: 'Beef Slices', weightGrams: 120, nutrients: { calories: 180, protein: 22, totalFat: 10, carbohydrates: 0, sodium: 60 } },
        { name: 'Tofu', foodName: 'Tofu', weightGrams: 100, nutrients: { calories: 80, protein: 8, totalFat: 3, carbohydrates: 2, sodium: 10 } },
        { name: 'Shirataki Noodles', foodName: 'Shirataki Noodles', weightGrams: 100, nutrients: { calories: 15, protein: 0, totalFat: 0, carbohydrates: 3, sodium: 5 } },
        { name: 'Napa Cabbage and Vegetables', foodName: 'Napa Cabbage and Vegetables', weightGrams: 180, nutrients: { calories: 40, protein: 2, totalFat: 0.5, carbohydrates: 6, sodium: 30 } },
      ],
      hasComponents: true,
    };

    const result = await applyMealEdits({
      items: [hotpot],
      commands: [
        {
          action: 'replace_identity',
          itemName: 'Beef and Vegetable Hotpot',
          newItemName: 'Beef and Vegetable Hotpot',
          replacementItemName: 'Beef and Vegetable Hotpot',
          newWeightGrams: 550,
          estimate: {
            foods: [
              {
                foodName: 'Potato',
                weightGrams: 50,
                action: 'add',
                nutrients: { calories: 51, protein: 1, totalFat: 0, carbohydrates: 11.8, sodium: 3 },
              },
            ],
          },
        },
      ],
      userMessage: 'There is also potato in the hotpot',
    });

    expect(result.items).toHaveLength(1);
    const updatedHotpot = result.items[0];
    expect(updatedHotpot.components).toHaveLength(5);
    expect(updatedHotpot.components.some((c: any) => c.name === 'Beef Slices')).toBe(true);
    expect(updatedHotpot.components.some((c: any) => c.name === 'Potato')).toBe(true);
    expect(updatedHotpot.weightGrams).toBe(550);
    expect(updatedHotpot.nutrients.protein).toBeGreaterThan(30);
  });

  it('golden: split_item with empty into[] is ignored and parent remains', async () => {
    const [plate] = steakPlate();
    const result = await applyMealEdits({
      items: [plate],
      userMessage: 'split the sizzling steak plate',
      commands: [{ action: 'split_item', itemName: plate.name, into: [] }],
    });

    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe(plate.name);
    expect(result.items[0].weightGrams).toBe(580);
    expect(result.items[0].componentsDetailList).toHaveLength(4);
    expect(
      result.notes.some((n) =>
        /split_item "Sizzling Beef and Chicken Steak".*ignored.*empty into/i.test(n),
      ),
    ).toBe(true);
  });

  it('remove_item then set_weight on a different item does not resurrect the removed row', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'remove the cakalang and make the kangkung 120g',
      commands: [
        { action: 'remove_item', itemName: 'Cakalang' },
        { action: 'set_weight', itemName: 'Kangkung', newWeightGrams: 120 },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items.some((it: any) => /cakalang/i.test(it.name) || it.scoutIndex === 0)).toBe(false);

    const kangkung = result.items.find((it: any) => /kangkung/i.test(it.name));
    expect(kangkung).toBeTruthy();
    expect(kangkung?.scoutIndex).toBe(1);
    expect(kangkung?.weightGrams).toBe(120);
  });

  it('golden: replace_identity then remove_item by the new identity drops the renamed fish and keeps kangkung', async () => {
    const replaced = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: 'Ikan Nila',
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    expect(replaced.items[0].name).toBe('Ikan Nila');
    expect(replaced.items[0].scoutIndex).toBe(0);

    const removed = await applyMealEdits({
      items: replaced.items,
      userMessage: 'remove the ikan nila',
      commands: [{ action: 'remove_item', itemName: 'Ikan Nila' }],
    });

    expect(removed.changed).toBe(true);
    expect(removed.items).toHaveLength(1);
    expect(removed.items.some((it: any) => /ikan nila|cakalang/i.test(it.name) || it.scoutIndex === 0)).toBe(false);
    expect(removed.items[0].name).toBe('Kangkung');
    expect(removed.items[0].scoutIndex).toBe(1);
    expect(removed.items[0].weightGrams).toBe(150);
  });

  it('golden: replace_identity then remove_item on Kangkung keeps Ikan Nila identity', async () => {
    const replaced = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: 'Ikan Nila',
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    const removed = await applyMealEdits({
      items: replaced.items,
      userMessage: 'remove the kangkung',
      commands: [{ action: 'remove_item', itemName: 'Kangkung' }],
    });

    expect(removed.changed).toBe(true);
    expect(removed.items).toHaveLength(1);
    expect(removed.items.some((it: any) => /kangkung/i.test(it.name) || it.scoutIndex === 1)).toBe(false);

    const fish = removed.items[0];
    expect(fish.scoutIndex).toBe(0);
    expect(fish.name).toBe('Ikan Nila');
    expect(fish.canonicalDbName).toBe('Ikan Nila');
    expect(fish.originalName).toBe('Ikan Nila');
    expect(fish.name).not.toMatch(/cakalang/i);
    expect(fish.weightGrams).toBe(100);
    expect(removed.weightGrams).toBe(100);
    expect(mealItemsHaveAtwaterCalories(removed.items)).toBe(true);
  });

  it('golden: case-insensitive set_weight itemName updates the matching row', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the kangkung 120g',
      commands: [{ action: 'set_weight', itemName: 'kangkung', newWeightGrams: 120 }],
    });

    const kangkung = result.items.find((it: any) => it.name === 'Kangkung');
    expect(kangkung?.weightGrams).toBe(120);
    expect(result.weightGrams).toBe(220);
    expect(result.changed).toBe(true);
  });

  it('golden: set_weight on one item keeps result.weightGrams equal to the sum of item weights', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 160g',
      commands: [{ action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 160 }],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish?.weightGrams).toBe(160);
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(
      result.items.reduce((sum: number, it: any) => sum + (Number(it.weightGrams) || 0), 0),
    );
    expect(result.weightGrams).toBe(310);
    expect(result.changed).toBe(true);
  });

  it('golden: update_weight alias is normalized to set_weight and updates the portion', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the kangkung 120g',
      commands: [{ action: 'update_weight', itemName: 'Kangkung', newWeightGrams: 120 }],
    });

    const kangkung = result.items.find((it: any) => it.name === 'Kangkung');
    expect(kangkung?.weightGrams).toBe(120);
    expect(result.weightGrams).toBe(220);
    expect(result.changed).toBe(true);
    expect(result.notes.some((n) => /set_weight "Kangkung"/.test(n))).toBe(true);
    expect(result.notes.some((n) => /skipped unknown action "update_weight"/.test(n))).toBe(false);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: update_weight alias sets grams', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 130g',
      commands: [{ action: 'update_weight', itemName: 'Cakalang', newWeightGrams: 130 }],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    expect(fish?.weightGrams).toBe(130);
    expect(result.weightGrams).toBe(280);
    expect(result.changed).toBe(true);
  });

  it('golden: update_modifier alias is normalized to set_modifier and unsweetens tea', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Es Teh Manis',
        canonicalDbName: 'Es Teh Manis',
        originalName: 'Es Teh Manis',
        keyword: 'Es Teh Manis',
        weightGrams: 350,
        foodType: 'beverage',
        calories: 104,
        protein: 0,
        carbohydrates: 26,
        totalFat: 0,
        nutrients: { calories: 104, protein: 0, carbohydrates: 26, totalFat: 0, sugar: 26, addedSugar: 26, sodium: 5 },
        sourceImageIndex: 0,
      },
    ];

    const result = await applyMealEdits({
      items,
      userMessage: 'the tea is unsweetened',
      commands: [{ action: 'update_modifier', itemName: 'Es Teh Manis', modifier: 'unsweetened', newItemName: 'Es Teh Tawar' }],
    });

    const tea = result.items[0];
    expect(result.changed).toBe(true);
    expect(tea.name).toBe('Es Teh Tawar');
    expect(tea.canonicalDbName).toBe('Es Teh Tawar');
    expect(tea.originalName).toBe('Es Teh Tawar');
    expect(tea.keyword).toBe('Es Teh Tawar');
    expect(tea.nutrients.addedSugar).toBe(0);
    expect(tea.nutrients.calories).toBe(0);
    expect(result.notes.some((n) => /set_modifier "Es Teh Manis"/.test(n))).toBe(true);
    expect(result.notes.some((n) => /skipped unknown action "update_modifier"/.test(n))).toBe(false);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: update_count alias is normalized to set_count and annotates pieces without changing grams', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is 2 pieces',
      commands: [{ action: 'update_count', itemName: 'Cakalang', count: 2 }],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(fish?.name).toBe('Cakalang');
    expect(fish?.canonicalDbName).toBe('Cakalang');
    expect(fish?.originalName).toBe('Cakalang');
    expect(fish?.weightGrams).toBe(100);
    expect(fish?.count).toBe(2);
    expect(fish?.pieceCount).toBe(2);
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(250);
    expect(result.changed).toBe(true);
    expect(result.notes.some((n) => /set_count "Cakalang"/.test(n))).toBe(true);
    expect(result.notes.some((n) => /skipped unknown action "update_count"/.test(n))).toBe(false);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_weight coerces string newWeightGrams ("150") instead of no-op', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 150g',
      commands: [{ action: 'set_weight', itemName: 'Cakalang', newWeightGrams: '150' as any }],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish?.weightGrams).toBe(150);
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(300);
    expect(result.changed).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: whitespace-trimmed set_weight itemName still matches the row', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the kangkung 120g',
      commands: [{ action: 'set_weight', itemName: '  Kangkung  ', newWeightGrams: 120 }],
    });

    const kangkung = result.items.find((it: any) => it.name === 'Kangkung');
    expect(kangkung?.weightGrams).toBe(120);
    expect(result.weightGrams).toBe(220);
    expect(result.changed).toBe(true);
  });

  it('golden: remove_item with whitespace-trimmed itemName still removes (trim match)', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'remove the cakalang',
      commands: [{ action: 'remove_item', itemName: '  Cakalang  ' }],
    });

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items.some((it: any) => /cakalang/i.test(it.name) || it.scoutIndex === 0)).toBe(false);
    expect(result.items[0].name).toBe('Kangkung');
    expect(result.items[0].scoutIndex).toBe(1);
    expect(result.weightGrams).toBe(150);
  });

  it('golden: two set_weight commands update both portions and total weight', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 180g and the kangkung 100g',
      commands: [
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 180 },
        { action: 'set_weight', itemName: 'Kangkung', newWeightGrams: 100 },
      ],
    });

    const fish = result.items.find((it: any) => /cakalang/i.test(it.name));
    const kangkung = result.items.find((it: any) => /kangkung/i.test(it.name));

    expect(fish?.weightGrams).toBe(180);
    expect(kangkung?.weightGrams).toBe(100);
    expect(result.weightGrams).toBe(280);
    expect(result.weightGrams).toBe(
      result.items.reduce((sum: number, it: any) => sum + (Number(it.weightGrams) || 0), 0)
    );
    expect(result.changed).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: add_item then set_weight updates only the added Tempeh portion', async () => {
    const added = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'also add 100g tempeh',
      commands: [{
        action: 'add_item',
        itemName: 'Tempeh',
        newWeightGrams: 100,
        estimate: {
          protein: 19,
          carbohydrates: 9,
          totalFat: 11,
          saturatedFat: 2,
          sodium: 220,
          cookingMethod: 'grilled',
          foodType: 'protein',
        },
      }],
    });

    const result = await applyMealEdits({
      items: added.items,
      userMessage: 'the tempeh is 90g',
      commands: [{ action: 'set_weight', itemName: 'Tempeh', newWeightGrams: 90 }],
    });

    const tempeh = result.items.find((it: any) => /tempeh/i.test(it.name));
    expect(tempeh).toBeTruthy();
    expect(tempeh?.weightGrams).toBe(90);
    expect(tempeh?.calories).toBeGreaterThan(0);

    expect(result.items).toHaveLength(3);
    expect(result.weightGrams).toBe(340);

    const cakalang = result.items.find((it: any) => /cakalang/i.test(it.name));
    const kangkung = result.items.find((it: any) => /kangkung/i.test(it.name));
    expect(cakalang?.name).toBe('Cakalang');
    expect(cakalang?.canonicalDbName).toBe('Cakalang');
    expect(cakalang?.weightGrams).toBe(100);
    expect(cakalang?.scoutIndex).toBe(0);
    expect(kangkung?.name).toBe('Kangkung');
    expect(kangkung?.canonicalDbName).toBe('Kangkung');
    expect(kangkung?.weightGrams).toBe(150);
    expect(kangkung?.scoutIndex).toBe(1);

    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_modifier unsweetened then replace_identity on fish keeps tea tawar and renames fish', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Cakalang',
        canonicalDbName: 'Cakalang',
        originalName: 'Cakalang',
        keyword: 'Cakalang',
        weightGrams: 100,
        calories: 120,
        protein: 25,
        carbohydrates: 0,
        totalFat: 2,
        nutrients: { calories: 120, protein: 25, carbohydrates: 0, totalFat: 2, saturatedFat: 0.5, sodium: 300 },
        sourceImageIndex: 0,
        dbSource: 'estimated',
      },
      {
        scoutIndex: 1,
        name: 'Es Teh Manis',
        canonicalDbName: 'Es Teh Manis',
        originalName: 'Es Teh Manis',
        keyword: 'Es Teh Manis',
        weightGrams: 350,
        foodType: 'beverage',
        calories: 104,
        protein: 0,
        carbohydrates: 26,
        totalFat: 0,
        nutrients: { calories: 104, protein: 0, carbohydrates: 26, totalFat: 0, sugar: 26, addedSugar: 26, sodium: 5 },
        sourceImageIndex: 1,
      },
    ];

    const result = await applyMealEdits({
      items,
      userMessage: 'the tea is tawar and the cakalang is ikan nila',
      commands: [
        { action: 'set_modifier', itemName: 'Es Teh Manis', modifier: 'unsweetened', newItemName: 'Es Teh Tawar' },
        {
          action: 'replace_identity',
          itemName: 'Cakalang',
          newItemName: 'Ikan Nila',
          estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
        },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const tea = result.items.find((it: any) => it.scoutIndex === 1);

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Ikan Nila');
    expect(fish?.keyword).toBe('Ikan Nila');
    expect(tea?.name).toBe('Es Teh Tawar');
    expect(tea?.canonicalDbName).toBe('Es Teh Tawar');
    expect(tea?.nutrients.addedSugar).toBe(0);
    expect(tea?.nutrients.calories).toBe(0);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: strictly sequential replace_identity then set_modifier keeps fish and tea edits', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Cakalang',
        canonicalDbName: 'Cakalang',
        originalName: 'Cakalang',
        weightGrams: 100,
        calories: 120,
        protein: 25,
        carbohydrates: 0,
        totalFat: 2,
        nutrients: { calories: 120, protein: 25, carbohydrates: 0, totalFat: 2, saturatedFat: 0.5, sodium: 300 },
        sourceImageIndex: 0,
        dbSource: 'estimated',
      },
      {
        scoutIndex: 1,
        name: 'Es Teh Manis',
        canonicalDbName: 'Es Teh Manis',
        originalName: 'Es Teh Manis',
        weightGrams: 350,
        foodType: 'beverage',
        calories: 104,
        protein: 0,
        carbohydrates: 26,
        totalFat: 0,
        nutrients: { calories: 104, protein: 0, carbohydrates: 26, totalFat: 0, sugar: 26, addedSugar: 26, sodium: 5 },
        sourceImageIndex: 1,
      },
    ];

    const afterFish = await applyMealEdits({
      items,
      userMessage: 'the cakalang is ikan nila',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: 'Ikan Nila',
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    const afterTea = await applyMealEdits({
      items: afterFish.items,
      userMessage: 'the tea is tawar',
      commands: [{
        action: 'set_modifier',
        itemName: 'Es Teh Manis',
        modifier: 'unsweetened',
        newItemName: 'Es Teh Tawar',
      }],
    });

    const fish = afterTea.items.find((it: any) => it.scoutIndex === 0);
    const tea = afterTea.items.find((it: any) => it.scoutIndex === 1);

    expect(afterTea.items).toHaveLength(2);
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Ikan Nila');
    expect(tea?.name).toBe('Es Teh Tawar');
    expect(tea?.canonicalDbName).toBe('Es Teh Tawar');
    expect(tea?.nutrients.addedSugar).toBe(0);
    expect(tea?.nutrients.calories).toBe(0);
    expect(afterTea.changed).toBe(true);
  });

  it('golden: replace_identity then set_count on NEW fish name applies count to renamed row', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila and it is 2 pieces',
      commands: [
        {
          action: 'replace_identity',
          itemName: 'Cakalang',
          newItemName: 'Ikan Nila',
          estimate: {
            protein: 20,
            carbohydrates: 0,
            totalFat: 5,
            saturatedFat: 1,
            sodium: 50,
            cookingMethod: 'grilled',
            foodType: 'protein',
          },
        },
        { action: 'set_count', itemName: 'Ikan Nila', count: 2 },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    expect(fish).toBeTruthy();
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Ikan Nila');
    expect(fish?.keyword).toBe('Ikan Nila');
    expect(fish?.weightGrams).toBe(100);
    expect(fish?.count).toBe(2);
    expect(fish?.pieceCount).toBe(2);
    expect(fish?.calories).toBeGreaterThan(0);
    expect(result.items.some((it: any) => /cakalang/i.test(it.name))).toBe(false);
    expect(result.items.find((it: any) => it.scoutIndex === 1)?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(250);
  });

  it('golden: set_count then replace_identity keeps the meal coherent and renames the fish', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is 2 pieces, then the cakalang is ikan nila',
      commands: [
        { action: 'set_count', itemName: 'Cakalang', count: 2 },
        {
          action: 'replace_identity',
          itemName: 'Cakalang',
          newItemName: 'Ikan Nila',
          estimate: {
            protein: 20,
            carbohydrates: 0,
            totalFat: 5,
            saturatedFat: 1,
            sodium: 50,
            cookingMethod: 'grilled',
            foodType: 'protein',
          },
        },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);

    expect(fish).toBeTruthy();
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Ikan Nila');
    expect(fish?.keyword).toBe('Ikan Nila');
    expect(fish?.weightGrams).toBe(100);
    expect(fish?.calories).toBeGreaterThan(0);
    expect(result.items).toHaveLength(2);
    expect(result.items.some((it: any) => /cakalang/i.test(it.name))).toBe(false);
    expect(result.weightGrams).toBe(250);

    // set_count before replace_identity may transfer or clear the piece annotation.
    expect(fish?.count === undefined || fish?.count === null || fish?.count === 2).toBe(true);
    expect(fish?.pieceCount === undefined || fish?.pieceCount === null || fish?.pieceCount === 2).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: split then set_weight updates one child, preserves sibling, and removes parent', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Fish and Veg Plate',
        canonicalDbName: 'Fish and Veg Plate',
        originalName: 'Fish and Veg Plate',
        weightGrams: 300,
        calories: 260,
        protein: 25,
        carbohydrates: 20,
        totalFat: 10,
        nutrients: { calories: 260, protein: 25, carbohydrates: 20, totalFat: 10, saturatedFat: 2, sodium: 400 },
        sourceImageIndex: 0,
        dbSource: 'estimated',
        componentsDetailList: [
          { name: 'Fish Fillet', weightGrams: 120, calories: 150, protein: 25, carbohydrates: 0, totalFat: 5, nutrients: { calories: 150, protein: 25, carbohydrates: 0, totalFat: 5 } },
          { name: 'Mixed Vegetables', weightGrams: 180, calories: 110, protein: 3, carbohydrates: 20, totalFat: 2, nutrients: { calories: 110, protein: 3, carbohydrates: 20, totalFat: 2 } },
        ],
      },
    ];

    const split = await applyMealEdits({
      items,
      userMessage: 'split the plate into fish fillet and mixed vegetables',
      commands: [{
        action: 'split_item',
        itemName: 'Fish and Veg Plate',
        into: [
          { name: 'Fish Fillet', grams: 120, role: 'food', estimate: { protein: 25, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' } },
          { name: 'Mixed Vegetables', grams: 180, role: 'food', estimate: { protein: 3, carbohydrates: 20, totalFat: 2, saturatedFat: 0.5, sodium: 30, cookingMethod: 'stir_fried', foodType: 'vegetable' } },
        ],
      }],
    });

    expect(split.items).toHaveLength(2);
    expect(split.items.map((it: any) => it.name)).toEqual(['Fish Fillet', 'Mixed Vegetables']);
    expect(split.items.some((it: any) => /Fish and Veg Plate/i.test(it.name))).toBe(false);

    const result = await applyMealEdits({
      items: split.items,
      userMessage: 'the fish fillet is 100g',
      commands: [{ action: 'set_weight', itemName: 'Fish Fillet', newWeightGrams: 100 }],
    });

    const fish = result.items.find((it: any) => /fish fillet/i.test(it.name));
    const veg = result.items.find((it: any) => /mixed vegetables/i.test(it.name));

    expect(fish).toBeTruthy();
    expect(veg).toBeTruthy();
    expect(fish?.weightGrams).toBe(100);
    expect(veg?.weightGrams).toBe(180);
    expect(veg?.name).toBe('Mixed Vegetables');
    expect(result.items.some((it: any) => /Fish and Veg Plate/i.test(it.name))).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.weightGrams).toBe(280);
    expect(result.changed).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: split_item then remove_item of one child keeps the remaining sibling identity and weight', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Fish and Veg Plate',
        canonicalDbName: 'Fish and Veg Plate',
        originalName: 'Fish and Veg Plate',
        weightGrams: 300,
        calories: 260,
        protein: 25,
        carbohydrates: 20,
        totalFat: 10,
        nutrients: { calories: 260, protein: 25, carbohydrates: 20, totalFat: 10, saturatedFat: 2, sodium: 400 },
        sourceImageIndex: 0,
        dbSource: 'estimated',
        componentsDetailList: [
          { name: 'Fish Fillet', weightGrams: 120, calories: 150, protein: 25, carbohydrates: 0, totalFat: 5, nutrients: { calories: 150, protein: 25, carbohydrates: 0, totalFat: 5 } },
          { name: 'Mixed Vegetables', weightGrams: 180, calories: 110, protein: 3, carbohydrates: 20, totalFat: 2, nutrients: { calories: 110, protein: 3, carbohydrates: 20, totalFat: 2 } },
        ],
      },
    ];

    const result = await applyMealEdits({
      items,
      userMessage: 'split the plate into fish fillet and mixed vegetables, then remove the fish fillet',
      commands: [
        {
          action: 'split_item',
          itemName: 'Fish and Veg Plate',
          into: [
            { name: 'Fish Fillet', grams: 120, role: 'food', estimate: { protein: 25, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' } },
            { name: 'Mixed Vegetables', grams: 180, role: 'food', estimate: { protein: 3, carbohydrates: 20, totalFat: 2, saturatedFat: 0.5, sodium: 30, cookingMethod: 'stir_fried', foodType: 'vegetable' } },
          ],
        },
        { action: 'remove_item', itemName: 'Fish Fillet' },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items.some((it: any) => /fish fillet/i.test(it.name))).toBe(false);

    const veg = result.items.find((it: any) => /mixed vegetables/i.test(it.name));
    expect(veg).toBeTruthy();
    expect(veg?.name).toBe('Mixed Vegetables');
    expect(veg?.canonicalDbName).toBe('Mixed Vegetables');
    expect(veg?.originalName).toBe('Mixed Vegetables');
    expect(veg?.weightGrams).toBe(180);
    expect(result.weightGrams).toBe(180);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: Q&A empty commands after rename keep Ikan Nila unchanged', async () => {
    const replaced = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: 'Ikan Nila',
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    const result = await applyMealEdits({
      items: replaced.items,
      userMessage: 'is this meal high protein?',
      commands: [],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);

    expect(result.qa).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Ikan Nila');
    expect(fish?.keyword).toBe('Ikan Nila');
    expect(fish?.name).not.toMatch(/cakalang/i);
    expect(result.weightGrams).toBe(250);
  });

  it('golden: add_item then remove_item returns to the prior meal with no leftover row', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'add kerupuk then remove kerupuk',
      commands: [
        {
          action: 'add_item',
          itemName: 'Kerupuk',
          newWeightGrams: 20,
          estimate: { protein: 1, carbohydrates: 14, totalFat: 1, saturatedFat: 0.2, sodium: 120, cookingMethod: 'fried', foodType: 'carbohydrate' },
        },
        { action: 'remove_item', itemName: 'Kerupuk' },
      ],
    });

    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items.some((it: any) => /kerupuk/i.test(it.name) || it.scoutIndex === 2)).toBe(false);
    expect(result.items.some((it: any) => !it.name)).toBe(false);
    expect(result.items.map((it: any) => it.name)).toEqual(['Cakalang', 'Kangkung']);
    expect(result.weightGrams).toBe(250);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: add_item then remove_item by different casing still removes', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'add tempeh then remove Tempeh',
      commands: [
        {
          action: 'add_item',
          itemName: 'tempeh',
          newWeightGrams: 100,
          estimate: { protein: 19, carbohydrates: 9, totalFat: 11, saturatedFat: 2, sodium: 220, cookingMethod: 'grilled', foodType: 'protein' },
        },
        { action: 'remove_item', itemName: 'Tempeh' },
      ],
    });

    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items.some((it: any) => /tempeh/i.test(it.name))).toBe(false);
    expect(result.items.map((it: any) => it.name)).toEqual(['Cakalang', 'Kangkung']);
    expect(result.weightGrams).toBe(250);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: remove_item fish then add_item tempeh in the same turn leaves tempeh present and fish gone (coalesce or sequential)', async () => {
    // "add" wording keeps remove+add sequential; without it, coalesceLegacyCommands
    // folds them into replace_identity. Both routes must land on the same meal shape,
    // so we assert the invariant (tempeh in, fish out) rather than provenance fields.
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'remove the cakalang and add 100g tempeh',
      commands: [
        { action: 'remove_item', itemName: 'Cakalang' },
        {
          action: 'add_item',
          itemName: 'Tempeh',
          newWeightGrams: 100,
          estimate: { protein: 19, carbohydrates: 9, totalFat: 11, saturatedFat: 2, sodium: 220, cookingMethod: 'grilled', foodType: 'protein' },
        },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.items.some((it: any) => /cakalang/i.test(it.name))).toBe(false);

    const tempeh = result.items.filter((it: any) => /tempeh/i.test(it.name));
    expect(tempeh).toHaveLength(1);
    expect(tempeh[0].weightGrams).toBe(100);
    expect(tempeh[0].calories).toBeGreaterThan(0);

    const kangkung = result.items.find((it: any) => /kangkung/i.test(it.name));
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(250);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: add_item twice then set_weight only on the second added item keeps both and prior identities', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'add kerupuk then add sambal and make the sambal 15g',
      commands: [
        {
          action: 'add_item',
          itemName: 'Kerupuk',
          newWeightGrams: 20,
          estimate: { protein: 1, carbohydrates: 14, totalFat: 1, saturatedFat: 0.2, sodium: 120, cookingMethod: 'fried', foodType: 'carbohydrate' },
        },
        {
          action: 'add_item',
          itemName: 'Sambal',
          newWeightGrams: 10,
          estimate: { protein: 1, carbohydrates: 3, totalFat: 2, saturatedFat: 0.3, sodium: 250, cookingMethod: 'unknown', foodType: 'condiment' },
        },
        { action: 'set_weight', itemName: 'Sambal', newWeightGrams: 15 },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(4);

    const kerupuk = result.items.find((it: any) => /kerupuk/i.test(it.name));
    const sambal = result.items.find((it: any) => /sambal/i.test(it.name));
    expect(kerupuk?.weightGrams).toBe(20);
    expect(sambal?.weightGrams).toBe(15);

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const veg = result.items.find((it: any) => it.scoutIndex === 1);
    expect(fish?.name).toBe('Cakalang');
    expect(fish?.canonicalDbName).toBe('Cakalang');
    expect(fish?.weightGrams).toBe(100);
    expect(veg?.name).toBe('Kangkung');
    expect(veg?.canonicalDbName).toBe('Kangkung');
    expect(veg?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(285);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_weight twice on the same item uses the last weight and keeps identity', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 100g then 140g',
      commands: [
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 100 },
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 140 },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(result.changed).toBe(true);
    expect(fish?.name).toBe('Cakalang');
    expect(fish?.canonicalDbName).toBe('Cakalang');
    expect(fish?.originalName).toBe('Cakalang');
    expect(fish?.weightGrams).toBe(140);
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(290);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: two identical set_weight commands in one call scale the item once', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 150g',
      commands: [
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 150 },
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 150 },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish?.weightGrams).toBe(150);
    expect(fish?.nutrients.protein).toBe(37.5);
    expect(fish?.nutrients.totalFat).toBe(3);
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(300);
    expect(result.changed).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: replace_identity Cakalang to Ikan Nila then Ikan Nila to Salmon keeps final Salmon identity', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila, then the ikan nila is salmon',
      commands: [
        {
          action: 'replace_identity',
          itemName: 'Cakalang',
          newItemName: 'Ikan Nila',
          estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
        },
        {
          action: 'replace_identity',
          itemName: 'Ikan Nila',
          newItemName: 'Salmon',
          estimate: { protein: 25, carbohydrates: 0, totalFat: 13, saturatedFat: 3, sodium: 60, cookingMethod: 'grilled', foodType: 'protein' },
        },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    expect(result.items).toHaveLength(2);
    expect(fish?.name).toBe('Salmon');
    expect(fish?.canonicalDbName).toBe('Salmon');
    expect(fish?.originalName).toBe('Salmon');
    expect(JSON.stringify(result.items)).not.toMatch(/cakalang|ikan nila/i);
    expect(result.changed).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_modifier with fuzzy itemName "the tea" falls back to beverage and renames to tawar', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Es Teh Manis',
        canonicalDbName: 'Es Teh Manis',
        originalName: 'Es Teh Manis',
        keyword: 'Es Teh Manis',
        weightGrams: 350,
        foodType: 'beverage',
        calories: 104,
        protein: 0,
        carbohydrates: 26,
        totalFat: 0,
        nutrients: { calories: 104, protein: 0, carbohydrates: 26, totalFat: 0, sugar: 26, addedSugar: 26, sodium: 5 },
        sourceImageIndex: 0,
      },
    ];

    const result = await applyMealEdits({
      items,
      userMessage: 'the tea is unsweetened',
      commands: [{ action: 'set_modifier', itemName: 'the tea', modifier: 'unsweetened' }],
    });

    const tea = result.items[0];
    expect(result.changed).toBe(true);
    expect(tea.name).toBe('Es Teh Tawar');
    expect(tea.canonicalDbName).toBe('Es Teh Tawar');
    expect(tea.originalName).toBe('Es Teh Tawar');
    expect(tea.keyword).toBe('Es Teh Tawar');
    expect(tea.nutrients.addedSugar).toBe(0);
    expect(tea.nutrients.calories).toBe(0);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_modifier unsweetened then set_weight on new tawar name both stick', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Es Teh Manis',
        canonicalDbName: 'Es Teh Manis',
        originalName: 'Es Teh Manis',
        keyword: 'Es Teh Manis',
        weightGrams: 350,
        foodType: 'beverage',
        calories: 104,
        protein: 0,
        carbohydrates: 26,
        totalFat: 0,
        nutrients: { calories: 104, protein: 0, carbohydrates: 26, totalFat: 0, sugar: 26, addedSugar: 26, sodium: 5 },
        sourceImageIndex: 0,
      },
    ];

    const result = await applyMealEdits({
      items,
      userMessage: 'the tea is tawar and it is 250g',
      commands: [
        { action: 'set_modifier', itemName: 'Es Teh Manis', modifier: 'unsweetened', newItemName: 'Es Teh Tawar' },
        { action: 'set_weight', itemName: 'Es Teh Tawar', newWeightGrams: 250 },
      ],
    });

    const tea = result.items[0];
    expect(result.changed).toBe(true);
    expect(tea.name).toBe('Es Teh Tawar');
    expect(tea.canonicalDbName).toBe('Es Teh Tawar');
    expect(tea.originalName).toBe('Es Teh Tawar');
    expect(tea.keyword).toBe('Es Teh Tawar');
    expect(tea.weightGrams).toBe(250);
    expect(tea.nutrients.addedSugar).toBe(0);
    expect(tea.nutrients.calories).toBe(0);
    expect(result.weightGrams).toBe(250);
    expect(result.notes.some((n) => /set_modifier "Es Teh Manis"/.test(n))).toBe(true);
    expect(result.notes.some((n) => /set_weight "Es Teh Tawar"/.test(n))).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_count on Kangkung annotates pieces without multiplying already-weighed grams', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the kangkung is 2 portions',
      commands: [{ action: 'set_count', itemName: 'Kangkung', count: 2 }],
    });

    const kangkung = result.items.find((it: any) => /kangkung/i.test(it.name));
    expect(kangkung).toBeTruthy();
    expect(kangkung?.weightGrams).toBe(150);
    expect(kangkung?.count).toBe(2);
    expect(kangkung?.pieceCount).toBe(2);
    expect(result.weightGrams).toBe(250);
  });

  it('golden: set_count 1 sets pieceCount 1', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is 1 piece',
      commands: [{ action: 'set_count', itemName: 'Cakalang', count: 1 }],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    expect(fish).toBeTruthy();
    expect(fish?.count).toBe(1);
    expect(fish?.pieceCount).toBe(1);
    expect(fish?.weightGrams).toBe(100);
    expect(result.weightGrams).toBe(250);
  });

  it('golden: set_count on fish then empty-commands Q&A leaves count intact', async () => {
    const counted = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is 2 pieces',
      commands: [{ action: 'set_count', itemName: 'Cakalang', count: 2 }],
    });

    const result = await applyMealEdits({
      items: counted.items,
      userMessage: 'is this meal high protein?',
      commands: [],
    });

    const fish = result.items.find((it: any) => /cakalang/i.test(it.name));
    expect(result.qa).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(fish?.count).toBe(2);
    expect(fish?.pieceCount).toBe(2);
    expect(fish?.weightGrams).toBe(100);
    expect(result.weightGrams).toBe(250);
  });

  it('golden: set_count then remove_item on the same dish removes the row without crashing', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is 2 pieces, then remove the cakalang',
      commands: [
        { action: 'set_count', itemName: 'Cakalang', count: 2 },
        { action: 'remove_item', itemName: 'Cakalang' },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items.some((it: any) => /cakalang/i.test(it.name) || it.scoutIndex === 0)).toBe(false);
    expect(result.items[0].name).toBe('Kangkung');
    expect(result.items[0].scoutIndex).toBe(1);
    expect(result.weightGrams).toBe(150);
  });

  it('golden: set_count then set_weight on the same item keeps weight and may retain count', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is 2 pieces and make it 180g',
      commands: [
        { action: 'set_count', itemName: 'Cakalang', count: 2 },
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 180 },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(fish?.weightGrams).toBe(180);
    expect(fish?.count).toBe(2);
    expect(fish?.pieceCount).toBe(2);
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(330);
    expect(result.changed).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_weight then set_count on the same item keeps both grams and count', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 180g and it is 2 pieces',
      commands: [
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 180 },
        { action: 'set_count', itemName: 'Cakalang', count: 2 },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(fish?.weightGrams).toBe(180);
    expect(fish?.count).toBe(2);
    expect(fish?.pieceCount).toBe(2);
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(330);
    expect(result.changed).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: replace_identity then set_weight in the same commands updates the new fish identity', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila and make it 160g',
      commands: [
        {
          action: 'replace_identity',
          itemName: 'Cakalang',
          newItemName: 'Ikan Nila',
          estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
        },
        { action: 'set_weight', itemName: 'Ikan Nila', newWeightGrams: 160 },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Ikan Nila');
    expect(fish?.keyword).toBe('Ikan Nila');
    expect(fish?.weightGrams).toBe(160);
    expect(fish?.calories).toBeGreaterThan(0);
    expect(kangkung?.name).toBe('Kangkung');
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(310);
    expect(JSON.stringify(result.items)).not.toMatch(/cakalang/i);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: replace_identity fish and set_weight kangkung in same commands both apply', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila and make the kangkung 120g',
      commands: [
        {
          action: 'replace_identity',
          itemName: 'Cakalang',
          newItemName: 'Ikan Nila',
          estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
        },
        { action: 'set_weight', itemName: 'Kangkung', newWeightGrams: 120 },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.weightGrams).toBe(100);
    expect(kangkung?.weightGrams).toBe(120);
    expect(result.weightGrams).toBe(220);
    expect(result.changed).toBe(true);
    expect(JSON.stringify(result.items)).not.toMatch(/cakalang/i);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_weight then replace_identity on same fish uses the later replace weight (last-wins)', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 140g, then the cakalang is 160g of ikan nila',
      commands: [
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 140 },
        {
          action: 'replace_identity',
          itemName: 'Cakalang',
          newItemName: 'Ikan Nila',
          newWeightGrams: 160,
          estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
        },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Ikan Nila');
    expect(fish?.keyword).toBe('Ikan Nila');
    // Commands are applied in order: the later replace_identity's explicit grams win.
    expect(fish?.weightGrams).toBe(160);
    expect(fish?.calories).toBeGreaterThan(0);
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(310);
    expect(JSON.stringify(result.items)).not.toMatch(/cakalang/i);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: remove_item all items one by one empties the meal', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'remove the cakalang and then remove the kangkung',
      commands: [
        { action: 'remove_item', itemName: 'Cakalang' },
        { action: 'remove_item', itemName: 'Kangkung' },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(0);
    expect(result.weightGrams).toBe(0);
    expect(result.items.some((it: any) => /cakalang|kangkung/i.test(it.name))).toBe(false);
    expect(result.notes.filter((n) => /^remove_item "/.test(n))).toHaveLength(2);
    expect(result.notes.some((n) => /remove_item "Cakalang"/.test(n))).toBe(true);
    expect(result.notes.some((n) => /remove_item "Kangkung"/.test(n))).toBe(true);
  });

  it('golden: duplicate remove_item for the same dish removes once and notes the second miss', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'remove the cakalang twice',
      commands: [
        { action: 'remove_item', itemName: 'Cakalang' },
        { action: 'remove_item', itemName: 'Cakalang' },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items.some((it: any) => /cakalang/i.test(it.name))).toBe(false);
    expect(result.items[0].name).toBe('Kangkung');
    expect(result.items[0].weightGrams).toBe(150);
    expect(result.weightGrams).toBe(150);
    expect(result.notes.some((n) => /remove_item "Cakalang"/.test(n))).toBe(true);
    expect(result.notes.some((n) => /remove_item: no item "Cakalang"/.test(n))).toBe(true);
  });

  it('golden: set_weight with fractional grams applies consistently without NaN', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 87.5g',
      commands: [{ action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 87.5 }],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(Number.isFinite(fish?.weightGrams)).toBe(true);
    expect(fish?.weightGrams).toBeGreaterThanOrEqual(87);
    expect(fish?.weightGrams).toBeLessThanOrEqual(88);
    expect(Number.isFinite(fish?.calories)).toBe(true);
    expect(fish?.calories).toBeGreaterThan(0);
    expect(Number.isFinite(result.weightGrams)).toBe(true);
    expect(result.weightGrams).toBe(
      Math.round(Number(fish?.weightGrams) + Number(kangkung?.weightGrams)),
    );
    expect(result.changed).toBe(true);
  });

  it('golden: Indonesian weight-only userMessage with empty commands either synthesizes set_weight or is a documented no-op', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'kangkungnya 80 gram',
      commands: [],
    });

    expect(result.items).toHaveLength(2);
    const kangkung = result.items.find((it: any) => /kangkung/i.test(it.name));
    expect(kangkung).toBeTruthy();

    if (result.changed) {
      expect(kangkung?.weightGrams).toBe(80);
      expect(result.weightGrams).toBe(180);
    } else {
      // Existing Indonesian synthesis tests only prove modifier phrases.
      // If weight phrases are unsupported, the meal must remain unchanged.
      expect(result.qa).toBe(true);
      expect(kangkung?.weightGrams).toBe(150);
      expect(result.weightGrams).toBe(250);
    }
  });

  it('golden: replace_identity Cakalang to Ikan Nila with newWeightGrams updates identity and portion in one shot', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is 175g of ikan nila',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: 'Ikan Nila',
        newWeightGrams: 175,
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Ikan Nila');
    expect(fish?.keyword).toBe('Ikan Nila');
    expect(fish?.weightGrams).toBe(175);
    expect(fish?.calories).toBeGreaterThan(0);
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(325);
    expect(result.changed).toBe(true);
    expect(JSON.stringify(result.items)).not.toMatch(/cakalang/i);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: coalesceLegacyCommands remove+add different names on non-composite yields replace_identity or sequential', () => {
    const items = cakalangKangkungPlate();
    const commands = [
      { action: 'remove_item', itemName: 'Cakalang' },
      {
        action: 'add_item',
        itemName: 'Ikan Nila',
        newWeightGrams: 100,
        estimate: {
          protein: 20,
          carbohydrates: 0,
          totalFat: 5,
          saturatedFat: 1,
          sodium: 50,
          cookingMethod: 'grilled',
          foodType: 'protein',
        },
      },
    ];

    const coalesced = coalesceLegacyCommands(commands, items, 'remove the cakalang and add ikan nila');

    expect(coalesced.length).toBeGreaterThanOrEqual(1);

    if (coalesced.length === 1) {
      expect(coalesced[0].action).toBe('replace_identity');
      expect(coalesced[0].itemName).toBe('Cakalang');
      expect(coalesced[0].newItemName).toBe('Ikan Nila');
    } else {
      expect(coalesced.some((c: any) => c.action === 'remove_item' && c.itemName === 'Cakalang')).toBe(true);
      expect(coalesced.some((c: any) => c.action === 'add_item' && c.itemName === 'Ikan Nila')).toBe(true);
    }
  });

  it('golden: remove_item plus add_item coalesces to replace or falls back to sequential semantics', async () => {
    const userMessage = 'the cakalang is ikan nila';
    const commands = [
      { action: 'remove_item', itemName: 'Cakalang' },
      {
        action: 'add_item',
        itemName: 'Ikan Nila',
        estimate: {
          protein: 20,
          carbohydrates: 0,
          totalFat: 5,
          saturatedFat: 1,
          sodium: 50,
          cookingMethod: 'grilled',
          foodType: 'protein',
        },
      },
    ];

    const coalesced = coalesceLegacyCommands(commands, cakalangKangkungPlate(), userMessage);
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage,
      commands,
    });

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.items.some((it: any) => /cakalang/i.test(it.name))).toBe(false);
    expect(result.items.filter((it: any) => /ikan nila/i.test(it.name))).toHaveLength(1);

    const fish = result.items.find((it: any) => /ikan nila/i.test(it.name));
    const kangkung = result.items.find((it: any) => /kangkung/i.test(it.name));

    expect(kangkung?.weightGrams).toBe(150);
    expect(fish?.weightGrams).toBe(100);
    expect(result.weightGrams).toBe(250);

    if (coalesced.length === 1 && coalesced[0].action === 'replace_identity') {
      expect(fish?.scoutIndex).toBe(0);
      expect(fish?.sourceImageIndex).toBe(0);
    } else {
      expect(fish?.scoutIndex).toBeGreaterThan(1);
      expect(fish?.sourceImageIndex).toBeNull();
    }

    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_modifier unsweetened on already tawar tea is idempotent', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Es Teh Tawar',
        canonicalDbName: 'Es Teh Tawar',
        originalName: 'Es Teh Tawar',
        keyword: 'Es Teh Tawar',
        weightGrams: 350,
        foodType: 'beverage',
        calories: 0,
        protein: 0,
        carbohydrates: 0,
        totalFat: 0,
        nutrients: { calories: 0, protein: 0, carbohydrates: 0, totalFat: 0, sugar: 0, addedSugar: 0, sodium: 5 },
        sourceImageIndex: 0,
      },
    ];

    const result = await applyMealEdits({
      items,
      userMessage: 'the tea is unsweetened',
      commands: [
        { action: 'set_modifier', itemName: 'Es Teh Tawar', modifier: 'unsweetened', newItemName: 'Es Teh Tawar' },
        { action: 'set_modifier', itemName: 'Es Teh Tawar', modifier: 'unsweetened', newItemName: 'Es Teh Tawar' },
      ],
    });

    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Es Teh Tawar');
    expect(result.items[0].canonicalDbName).toBe('Es Teh Tawar');
    expect(result.items[0].originalName).toBe('Es Teh Tawar');
    expect(result.items[0].keyword).toBe('Es Teh Tawar');
    expect(result.items[0].nutrients.addedSugar).toBe(0);
    expect(result.items[0].nutrients.calories).toBe(0);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: add_item zero-kcal protein estimate keeps Atwater calories above zero', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'also add 100g tempeh',
      commands: [{
        action: 'add_item',
        itemName: 'Tempeh',
        newWeightGrams: 100,
        estimate: {
          calories: 0,
          protein: 19,
          carbohydrates: 9,
          totalFat: 11,
          saturatedFat: 2,
          sodium: 220,
          cookingMethod: 'grilled',
          foodType: 'protein',
        } as any,
      }],
    });

    const tempeh = result.items.find((it: any) => /tempeh/i.test(it.name));
    expect(tempeh).toBeTruthy();
    expect(tempeh.weightGrams).toBe(100);
    expect(tempeh.calories).toBeGreaterThan(0);
    expect(tempeh.nutrients.calories).toBeGreaterThan(0);
    expect(tempeh.sourceImageIndex).toBeNull();
    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(3);
    expect(result.weightGrams).toBe(350);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: add_item with same name as an existing item creates a second row', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'add another 100g cakalang',
      commands: [{
        action: 'add_item',
        itemName: 'Cakalang',
        newWeightGrams: 100,
        estimate: {
          protein: 25,
          carbohydrates: 0,
          totalFat: 2,
          saturatedFat: 0.5,
          sodium: 300,
          cookingMethod: 'grilled',
          foodType: 'protein',
        },
      }],
    });

    const cakalangs = result.items.filter((it: any) => /cakalang/i.test(it.name));

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(3);
    expect(cakalangs).toHaveLength(2);
    expect(cakalangs[0].scoutIndex).toBe(0);
    expect(cakalangs[1].scoutIndex).toBe(2);
    expect(cakalangs[1].sourceImageIndex).toBeNull();
    expect(cakalangs[1].weightGrams).toBe(100);
    expect(cakalangs[1].calories).toBeGreaterThan(0);
    expect(result.weightGrams).toBe(350);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_weight with zero or negative grams is ignored and keeps non-negative coherent weights', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 0g then -50g',
      commands: [
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 0 },
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: -50 },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(fish?.weightGrams).toBe(100);
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.items.every((it: any) => Number(it.weightGrams) >= 0)).toBe(true);
    expect(result.weightGrams).toBe(250);
    expect(result.weightGrams).toBe(
      result.items.reduce((sum: number, it: any) => sum + (Number(it.weightGrams) || 0), 0)
    );
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: commands with only an unknown action leave the meal unchanged and note skipped unknown', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'do the impossible',
      commands: [{ action: 'do_the_impossible', itemName: 'Cakalang' }],
    });

    expect(result.changed).toBe(false);
    expect(result.qa).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((it: any) => it.name)).toEqual(['Cakalang', 'Kangkung']);
    expect(result.items.map((it: any) => it.weightGrams)).toEqual([100, 150]);
    expect(result.weightGrams).toBe(250);
    expect(result.notes).toContain('skipped unknown action "do_the_impossible"');
  });

  it('golden: set_weight on unknown itemName notes miss and leaves meal unchanged', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the unknown item 120g',
      commands: [{ action: 'set_weight', itemName: 'Unknown Item', newWeightGrams: 120 }],
    });

    expect(result.changed).toBe(false);
    expect(result.qa).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((it: any) => it.name)).toEqual(['Cakalang', 'Kangkung']);
    expect(result.items.map((it: any) => it.weightGrams)).toEqual([100, 150]);
    expect(result.weightGrams).toBe(250);
    expect(result.notes.some((n) => /set_weight: no item "Unknown Item"/i.test(n))).toBe(true);
  });

  it('golden: replace_identity with empty newItemName keeps the prior fish name', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: '',
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    expect(fish).toBeTruthy();
    expect(fish?.name).toBeTruthy();
    expect(fish?.name).not.toBe('');
    expect(fish?.name).toBe('Cakalang');
    expect(fish?.canonicalDbName).toBe('Cakalang');
    expect(fish?.originalName).toBe('Cakalang');
    expect(fish?.keyword).toBe('Cakalang');
  });

  it('golden: set_weight by canonicalDbName synonym works after rename, but old name misses', async () => {
    const replaced = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is ikan nila',
      commands: [{
        action: 'replace_identity',
        itemName: 'Cakalang',
        newItemName: 'Ikan Nila',
        estimate: { protein: 20, carbohydrates: 0, totalFat: 5, saturatedFat: 1, sodium: 50, cookingMethod: 'grilled', foodType: 'protein' },
      }],
    });

    const result = await applyMealEdits({
      items: replaced.items,
      userMessage: 'make the ikan nila 160g; the cakalang name is stale',
      commands: [
        { action: 'set_weight', itemName: 'Ikan Nila', newWeightGrams: 160 },
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 999 },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.weightGrams).toBe(160);
    expect(result.weightGrams).toBe(310);
    expect(result.notes.some((n) => /set_weight: no item "Cakalang"/i.test(n))).toBe(true);
  });

  it('golden: set_weight then set_modifier tea both persist', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Es Teh Manis',
        canonicalDbName: 'Es Teh Manis',
        originalName: 'Es Teh Manis',
        keyword: 'Es Teh Manis',
        weightGrams: 350,
        foodType: 'beverage',
        calories: 104,
        protein: 0,
        carbohydrates: 26,
        totalFat: 0,
        nutrients: { calories: 104, protein: 0, carbohydrates: 26, totalFat: 0, sugar: 26, addedSugar: 26, sodium: 5 },
        sourceImageIndex: 0,
      },
    ];

    const result = await applyMealEdits({
      items,
      userMessage: 'the tea is 250g and tawar',
      commands: [
        { action: 'set_weight', itemName: 'Es Teh Manis', newWeightGrams: 250 },
        { action: 'set_modifier', itemName: 'Es Teh Manis', modifier: 'unsweetened', newItemName: 'Es Teh Tawar' },
      ],
    });

    const tea = result.items[0];
    expect(tea.name).toBe('Es Teh Tawar');
    expect(tea.canonicalDbName).toBe('Es Teh Tawar');
    expect(tea.originalName).toBe('Es Teh Tawar');
    expect(tea.keyword).toBe('Es Teh Tawar');
    expect(tea.weightGrams).toBe(250);
    expect(tea.sourceImageIndex).toBe(0);
    expect(tea.nutrients.addedSugar).toBe(0);
    expect(tea.nutrients.calories).toBe(0);
    expect(result.weightGrams).toBe(250);
    expect(result.notes.some((n) => /set_weight "Es Teh Manis"/.test(n))).toBe(true);
    expect(result.notes.some((n) => /set_modifier "Es Teh Manis"/.test(n))).toBe(true);
    expect(result.changed).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: simultaneous set_weight on fish and set_modifier on tea persist together', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Cakalang',
        canonicalDbName: 'Cakalang',
        originalName: 'Cakalang',
        keyword: 'Cakalang',
        weightGrams: 100,
        calories: 120,
        protein: 25,
        carbohydrates: 0,
        totalFat: 2,
        nutrients: { calories: 120, protein: 25, carbohydrates: 0, totalFat: 2, saturatedFat: 0.5, sodium: 300 },
        sourceImageIndex: 0,
        dbSource: 'estimated',
      },
      {
        scoutIndex: 1,
        name: 'Es Teh Manis',
        canonicalDbName: 'Es Teh Manis',
        originalName: 'Es Teh Manis',
        keyword: 'Es Teh Manis',
        weightGrams: 350,
        foodType: 'beverage',
        calories: 104,
        protein: 0,
        carbohydrates: 26,
        totalFat: 0,
        nutrients: { calories: 104, protein: 0, carbohydrates: 26, totalFat: 0, sugar: 26, addedSugar: 26, sodium: 5 },
        sourceImageIndex: 1,
      },
    ];

    const result = await applyMealEdits({
      items,
      userMessage: 'make the cakalang 160g and the tea is tawar',
      commands: [
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 160 },
        { action: 'set_modifier', itemName: 'Es Teh Manis', modifier: 'unsweetened', newItemName: 'Es Teh Tawar' },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const tea = result.items.find((it: any) => it.scoutIndex === 1);

    expect(result.changed).toBe(true);
    expect(fish?.weightGrams).toBe(160);
    expect(fish?.calories).toBeGreaterThan(0);
    expect(tea?.name).toBe('Es Teh Tawar');
    expect(tea?.canonicalDbName).toBe('Es Teh Tawar');
    expect(tea?.nutrients.addedSugar).toBe(0);
    expect(tea?.nutrients.calories).toBe(0);
    expect(result.weightGrams).toBe(510);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_weight then empty-commands Q&A leaves the new weight intact', async () => {
    const weighted = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 140g',
      commands: [{ action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 140 }],
    });

    const result = await applyMealEdits({
      items: weighted.items,
      userMessage: 'is this meal high protein?',
      commands: [],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    expect(result.qa).toBe(true);
    expect(result.changed).toBe(false);
    expect(fish?.weightGrams).toBe(140);
    expect(result.weightGrams).toBe(290);
  });

  it('golden: set_weight then Q&A preserves the edited portion and total weight', async () => {
    const weighted = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the kangkung 120g',
      commands: [{ action: 'set_weight', itemName: 'Kangkung', newWeightGrams: 120 }],
    });

    const result = await applyMealEdits({
      items: weighted.items,
      userMessage: 'is this meal high protein?',
      commands: [],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(result.qa).toBe(true);
    expect(result.changed).toBe(false);
    expect(fish?.weightGrams).toBe(100);
    expect(kangkung?.weightGrams).toBe(120);
    expect(result.weightGrams).toBe(220);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: remove_item then set_weight on removed name notes miss and does not resurrect', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'remove the cakalang and make the cakalang 120g',
      commands: [
        { action: 'remove_item', itemName: 'Cakalang' },
        { action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 120 },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.qa).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items.some((it: any) => /cakalang/i.test(it.name) || it.scoutIndex === 0)).toBe(false);
    expect(result.items[0].name).toBe('Kangkung');
    expect(result.items[0].weightGrams).toBe(150);
    expect(result.weightGrams).toBe(150);
    expect(result.notes.some((n) => /remove_item "Cakalang"/.test(n))).toBe(true);
    expect(result.notes.some((n) => /set_weight: no item "Cakalang"/i.test(n))).toBe(true);
    expect(result.notes.some((n) => /set_weight "Cakalang"/.test(n))).toBe(false);
  });

  it('golden: remove_item with unknown name leaves the meal unchanged', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'remove the unknown item',
      commands: [{ action: 'remove_item', itemName: 'Unknown Item' }],
    });

    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((it: any) => it.name)).toEqual(['Cakalang', 'Kangkung']);
    expect(result.weightGrams).toBe(250);
  });

  it('golden: set_weight identical to current weight may leave changed false and keeps identity', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'make the cakalang 100g',
      commands: [{ action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 100 }],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(result.qa).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(fish).toBeTruthy();
    expect(kangkung).toBeTruthy();
    expect(fish?.name).toBe('Cakalang');
    expect(fish?.canonicalDbName).toBe('Cakalang');
    expect(fish?.originalName).toBe('Cakalang');
    expect(fish?.weightGrams).toBe(100);
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(250);
    // changed may be false when the weight is unchanged; allow current Atwater recalculation behavior.
    expect([false, true]).toContain(result.changed);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: split_item with explicit into grams conserves parent weight within 1g', async () => {
    const [plate] = steakPlate();
    const parentWeight = Number(plate.weightGrams) || 0;
    const into = [
      {
        name: 'Beef and Chicken Steak',
        grams: 250,
        role: 'food',
        estimate: {
          protein: 48,
          carbohydrates: 2,
          totalFat: 36,
          saturatedFat: 12,
          sodium: 900,
          cookingMethod: 'grilled',
          foodType: 'protein',
        },
      },
      {
        name: 'Potato Wedges',
        grams: 130,
        role: 'food',
        estimate: {
          protein: 3,
          carbohydrates: 25,
          totalFat: 7,
          saturatedFat: 1,
          sodium: 180,
          cookingMethod: 'baked',
          foodType: 'carbohydrate',
        },
      },
      {
        name: 'Mixed Vegetables',
        grams: 120,
        role: 'food',
        estimate: {
          protein: 2,
          carbohydrates: 10,
          totalFat: 2,
          saturatedFat: 0.3,
          sodium: 120,
          cookingMethod: 'steamed',
          foodType: 'vegetable',
        },
      },
      {
        name: 'Black Pepper Topping',
        grams: 80,
        role: 'food',
        estimate: {
          protein: 2,
          carbohydrates: 6,
          totalFat: 6,
          saturatedFat: 1,
          sodium: 300,
          cookingMethod: 'unknown',
          foodType: 'condiment',
        },
      },
    ];

    const intoTotal = into.reduce((sum, part) => sum + Number(part.grams || 0), 0);
    expect(Math.abs(intoTotal - parentWeight)).toBeLessThanOrEqual(1);

    const result = await applyMealEdits({
      items: [plate],
      userMessage: 'split the sizzling steak plate into its component rows',
      commands: [{ action: 'split_item', itemName: plate.name, into }],
    });

    expect(result.items.some((it: any) => it.name === plate.name || it.canonicalDbName === plate.name)).toBe(false);

    const totalWeight = result.items.reduce((sum: number, it: any) => sum + (Number(it.weightGrams) || 0), 0);
    expect(Math.abs(totalWeight - parentWeight)).toBeLessThanOrEqual(1);
    expect(result.weightGrams).toBe(Math.round(totalWeight));
    expect(result.changed).toBe(true);
    expect(result.notes.some((n) => /split_item "Sizzling Beef and Chicken Steak"/.test(n))).toBe(true);
    expect(result.items.every((it: any) => Number.isFinite(Number(it.weightGrams)) && Number(it.weightGrams) >= 0)).toBe(true);
  });

  it('golden: add_item with only newItemName and newWeightGrams inserts a row without estimate', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'add 20g kerupuk',
      commands: [{ action: 'add_item', newItemName: 'Kerupuk', newWeightGrams: 20 }],
    });

    const kerupuk = result.items.find((it: any) => /kerupuk/i.test(it.name));
    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(3);
    expect(kerupuk).toBeTruthy();
    expect(kerupuk?.weightGrams).toBe(20);
    expect(Number.isFinite(Number(kerupuk?.calories))).toBe(true);
    expect(Number(kerupuk?.calories)).toBeGreaterThanOrEqual(0);
    expect(result.weightGrams).toBe(270);
    expect(result.notes.some((n) => /add_item "Kerupuk"/.test(n))).toBe(true);
  });

  it('golden: add_item with newWeightGrams 0 falls back to default grams instead of creating a 0g row', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'add kerupuk',
      commands: [
        {
          action: 'add_item',
          itemName: 'Kerupuk',
          newWeightGrams: 0,
          estimate: {
            protein: 1,
            carbohydrates: 14,
            totalFat: 1,
            saturatedFat: 0.2,
            sodium: 120,
            cookingMethod: 'fried',
            foodType: 'carbohydrate',
          },
        },
      ],
    });

    const kerupuk = result.items.find((it: any) => /kerupuk/i.test(it.name));

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(3);
    expect(kerupuk).toBeTruthy();
    expect(kerupuk?.weightGrams).toBe(100);
    expect(result.items.every((it: any) => Number(it.weightGrams) > 0)).toBe(true);
    expect(Number.isFinite(Number(kerupuk?.calories))).toBe(true);
    expect(Number(kerupuk?.calories)).toBeGreaterThanOrEqual(0);
    expect(result.weightGrams).toBe(350);
    expect(result.notes.some((n) => /add_item "Kerupuk" 100g/.test(n))).toBe(true);
    expect(result.notes.some((n) => /invalid/i.test(n))).toBe(false);
  });

  it('golden: set_count with zero or negative newCount is ignored and keeps identity/weight', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is 0 pieces then -1 pieces',
      commands: [
        { action: 'set_count', itemName: 'Cakalang', count: 0 },
        { action: 'set_count', itemName: 'Cakalang', count: -1 },
      ],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(fish?.name).toBe('Cakalang');
    expect(fish?.canonicalDbName).toBe('Cakalang');
    expect(fish?.originalName).toBe('Cakalang');
    expect(fish?.weightGrams).toBe(100);
    expect(fish?.count).toBeUndefined();
    expect(fish?.pieceCount).toBeUndefined();
    expect(kangkung?.name).toBe('Kangkung');
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(250);
    expect(result.notes.filter((n) => /set_count: invalid count for "Cakalang"/.test(n))).toHaveLength(2);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_count with fractional count documents current accepted-positive behavior', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the cakalang is 2.5 pieces',
      commands: [{ action: 'set_count', itemName: 'Cakalang', count: 2.5 }],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);
    const kangkung = result.items.find((it: any) => it.scoutIndex === 1);

    // Current executor only rejects `newCount <= 0`, so a fractional piece count
    // is accepted as an annotation and does not alter already-weighed grams.
    // If the product contract is whole pieces, reject non-integers here and in
    // applyMealEdits().
    expect(fish).toBeTruthy();
    expect(fish?.name).toBe('Cakalang');
    expect(fish?.canonicalDbName).toBe('Cakalang');
    expect(fish?.originalName).toBe('Cakalang');
    expect(fish?.weightGrams).toBe(100);
    expect(fish?.count).toBe(2.5);
    expect(fish?.pieceCount).toBe(2.5);
    expect(kangkung?.weightGrams).toBe(150);
    expect(result.weightGrams).toBe(250);
    expect(result.notes.some((n) => /set_count "Cakalang".*2\.5/.test(n))).toBe(true);
    expect(result.notes.some((n) => /set_count: invalid count for "Cakalang"/.test(n))).toBe(false);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: add_item beverage then set_modifier unsweetened in same commands both apply (new drink becomes tawar)', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'add es teh manis and make it tawar',
      commands: [
        {
          action: 'add_item',
          itemName: 'Es Teh Manis',
          newWeightGrams: 350,
          estimate: {
            protein: 0,
            carbohydrates: 26,
            totalFat: 0,
            sugar: 26,
            addedSugar: 26,
            sodium: 5,
            foodType: 'beverage',
          },
        },
        {
          action: 'set_modifier',
          itemName: 'Es Teh Manis',
          modifier: 'unsweetened',
          newItemName: 'Es Teh Tawar',
        },
      ],
    });

    const tea = result.items.find((it: any) => /teh|tea/i.test(it.name));
    expect(tea).toBeTruthy();
    expect(tea?.name).toBe('Es Teh Tawar');
    expect(tea?.canonicalDbName).toBe('Es Teh Tawar');
    expect(tea?.originalName).toBe('Es Teh Tawar');
    expect(tea?.keyword).toBe('Es Teh Tawar');
    expect(tea?.weightGrams).toBe(350);
    expect(tea?.nutrients.addedSugar).toBe(0);
    expect(tea?.nutrients.sugar).toBe(0);
    expect(tea?.nutrients.calories).toBe(0);
    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(3);
    expect(result.weightGrams).toBe(600);
    expect(result.notes.some((n) => /add_item "Es Teh Manis"/.test(n))).toBe(true);
    expect(result.notes.some((n) => /set_modifier "Es Teh Manis" → "?Es Teh Tawar"?/.test(n))).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_modifier on itemName "coffee" with no coffee row notes miss and leaves meal unchanged', async () => {
    const result = await applyMealEdits({
      items: cakalangKangkungPlate(),
      userMessage: 'the coffee is unsweetened',
      commands: [{ action: 'set_modifier', itemName: 'coffee', modifier: 'unsweetened' }],
    });

    expect(result.qa).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((it: any) => it.name)).toEqual(['Cakalang', 'Kangkung']);
    expect(result.weightGrams).toBe(250);
    expect(result.notes.some((n) => /set_modifier: no item "coffee"/i.test(n))).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: dual set_modifier different drinks: only matching tea changes when two beverages exist after add', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Es Teh Manis',
        canonicalDbName: 'Es Teh Manis',
        originalName: 'Es Teh Manis',
        keyword: 'Es Teh Manis',
        weightGrams: 350,
        foodType: 'beverage',
        calories: 104,
        protein: 0,
        carbohydrates: 26,
        totalFat: 0,
        nutrients: { calories: 104, protein: 0, carbohydrates: 26, totalFat: 0, sugar: 26, addedSugar: 26, sodium: 5 },
        sourceImageIndex: 0,
      },
    ];

    const result = await applyMealEdits({
      items,
      userMessage: 'add kopi susu and make the teh tawar',
      commands: [
        {
          action: 'add_item',
          itemName: 'Kopi Susu',
          newWeightGrams: 200,
          estimate: {
            protein: 3,
            carbohydrates: 12,
            totalFat: 4,
            saturatedFat: 2,
            sodium: 40,
            sugar: 10,
            addedSugar: 10,
            foodType: 'beverage',
          },
        },
        {
          action: 'set_modifier',
          itemName: 'Es Teh Manis',
          modifier: 'unsweetened',
          newItemName: 'Es Teh Tawar',
        },
      ],
    });

    const tea = result.items.find((it: any) => /teh|tea/i.test(it.name));
    const coffee = result.items.find((it: any) => /kopi|coffee/i.test(it.name));

    expect(tea).toBeTruthy();
    expect(coffee).toBeTruthy();
    expect(tea.name).toBe('Es Teh Tawar');
    expect(tea.canonicalDbName).toBe('Es Teh Tawar');
    expect(tea.originalName).toBe('Es Teh Tawar');
    expect(tea.keyword).toBe('Es Teh Tawar');
    expect(tea.nutrients.addedSugar).toBe(0);
    expect(tea.nutrients.calories).toBe(0);

    expect(coffee.name).toBe('Kopi Susu');
    expect(coffee.canonicalDbName).toBe('Kopi Susu');
    expect(coffee.originalName).toBe('Kopi Susu');
    expect(coffee.keyword).toBe('Kopi Susu');
    expect(coffee.weightGrams).toBe(200);
    expect(coffee.nutrients.calories).toBeGreaterThan(0);

    expect(result.items.filter((it: any) => /tawar|unsweetened/i.test(it.name))).toHaveLength(1);
    expect(result.weightGrams).toBe(550);
    expect(result.changed).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: rename_alias on Sempol Ayam updates identities without changing weight or nutrients', async () => {
    const items = steakPlate();
    const result = await applyMealEdits({
      items,
      userMessage: 'the sempol ayam is otak-otak',
      commands: [
        { action: 'rename_alias', itemName: 'Sempol Ayam', newItemName: 'Otak-Otak' },
      ],
    });

    const row = result.items.find((it: any) => /otak/i.test(it.name));
    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(row).toBeTruthy();
    expect(row.name).toBe('Otak-Otak');
    expect(row.canonicalDbName).toBe('Otak-Otak');
    expect(row.originalName).toBe('Otak-Otak');
    expect(row.weightGrams).toBe(80);
    expect(row.calories).toBe(180);
    expect(row.nutrients).toEqual({
      calories: 180,
      protein: 11,
      carbohydrates: 15,
      totalFat: 8,
      saturatedFat: 2,
      sodium: 280,
    });
    expect(row.sourceImageIndex).toBe(3);
    expect(row.boundingBox2D).toEqual([1, 2, 3, 4]);
    expect(result.items.some((it: any) => /sempol/i.test(it.name))).toBe(false);
    expect(result.weightGrams).toBe(660);
    expect(result.notes.some((n) => /rename_alias → "Otak-Otak"/.test(n))).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: rename_alias then set_count applies count to the renamed row without changing grams', async () => {
    const items = steakPlate();
    const result = await applyMealEdits({
      items,
      userMessage: 'the sempol ayam is otak-otak and it is 2 pieces',
      commands: [
        { action: 'rename_alias', itemName: 'Sempol Ayam', newItemName: 'Otak-Otak' },
        { action: 'set_count', itemName: 'Otak-Otak', count: 2 },
      ],
    });

    const row = result.items.find((it: any) => /otak/i.test(it.name));
    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(row).toBeTruthy();
    expect(row?.name).toBe('Otak-Otak');
    expect(row?.canonicalDbName).toBe('Otak-Otak');
    expect(row?.originalName).toBe('Otak-Otak');
    expect(row?.weightGrams).toBe(80);
    expect(row?.count).toBe(2);
    expect(row?.pieceCount).toBe(2);
    expect(row?.calories).toBe(180);
    expect(result.items.some((it: any) => /sempol/i.test(it.name))).toBe(false);
    expect(result.weightGrams).toBe(660);
    expect(result.notes.some((n) => /set_count "Otak-Otak"/.test(n))).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: set_weight by originalName field updates the renamed row without changing current name', async () => {
    const items = [
      {
        scoutIndex: 0,
        name: 'Ikan Nila',
        canonicalDbName: 'Ikan Nila',
        originalName: 'Cakalang',
        keyword: 'Ikan Nila',
        weightGrams: 100,
        calories: 120,
        protein: 25,
        carbohydrates: 0,
        totalFat: 2,
        nutrients: { calories: 120, protein: 25, carbohydrates: 0, totalFat: 2, saturatedFat: 0.5, sodium: 300 },
        sourceImageIndex: 0,
        dbSource: 'estimated',
      },
    ];

    const result = await applyMealEdits({
      items,
      userMessage: 'make the cakalang 120g',
      commands: [{ action: 'set_weight', itemName: 'Cakalang', newWeightGrams: 120 }],
    });

    const fish = result.items.find((it: any) => it.scoutIndex === 0);

    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(fish?.name).toBe('Ikan Nila');
    expect(fish?.canonicalDbName).toBe('Ikan Nila');
    expect(fish?.originalName).toBe('Cakalang');
    expect(fish?.keyword).toBe('Ikan Nila');
    expect(fish?.weightGrams).toBe(120);
    expect(fish?.nutrients.protein).toBe(30);
    expect(fish?.calories).toBeGreaterThan(0);
    expect(result.weightGrams).toBe(120);
    expect(result.notes.some((n) => /set_weight "Cakalang"/.test(n))).toBe(true);
    expect(mealItemsHaveAtwaterCalories(result.items)).toBe(true);
  });

  it('golden: merge_dishes preserves rawNutritionLabel truth and user portion weight without summing weights', async () => {
    const rawLabel = {
      servingSize: '40g',
      calories: 160,
      protein: 5,
      carbohydrates: 27,
      totalFat: 3,
      saturatedFat: 0.5,
      sodium: 0,
    };
    const items = [
      {
        scoutIndex: 0,
        name: 'Quaker Whole Rolled Oats',
        canonicalDbName: 'Quaker Whole Rolled Oats',
        weightGrams: 100,
        calories: 400,
        nutrients: { calories: 400, protein: 12.5, carbohydrates: 67.5, totalFat: 7.5, saturatedFat: 1.25, sodium: 0 },
        rawNutritionLabel: rawLabel,
        brandLock: 'Quaker',
        dbSource: 'brand_official',
      },
      {
        scoutIndex: 1,
        name: 'Rolled Oats Porridge',
        canonicalDbName: 'Rolled Oats Porridge',
        weightGrams: 250,
        calories: 164,
        nutrients: { calories: 164, protein: 6, carbohydrates: 28, totalFat: 3, saturatedFat: 0.5, sodium: 115 },
        dbSource: 'estimated',
      },
    ];

    const result = await applyMealEdits({
      items,
      userMessage: "I only had 1 dish. It's the same dish",
      commands: [
        {
          action: 'merge_dishes',
          itemName: 'Quaker Whole Rolled Oats',
          targetItemName: 'Rolled Oats Porridge',
          newWeightGrams: 100,
        },
      ],
    });

    expect(result.items).toHaveLength(1);
    const merged = result.items[0];
    // Weight must be 100g, NOT 100 + 250 = 350g
    expect(merged.weightGrams).toBe(100);
    expect(result.weightGrams).toBe(100);
    // Nutrition label truth must be preserved: 100g @ 160 kcal / 40g = 400 kcal
    expect(merged.rawNutritionLabel).toEqual(rawLabel);
    expect(merged.calories).toBe(400);
    expect(result.nutrients.calories).toBe(400);
    expect(merged.dbSource).toBe('brand_official');
  });

  it('golden: remove_item on labeled package when user says "same dish" falls back to merge preserving label truth', async () => {
    const rawLabel = {
      servingSize: '40g',
      calories: 160,
      protein: 5,
      carbohydrates: 27,
      totalFat: 3,
      saturatedFat: 0.5,
      sodium: 0,
    };
    const items = [
      {
        scoutIndex: 0,
        name: 'Quaker Whole Rolled Oats',
        canonicalDbName: 'Quaker Whole Rolled Oats',
        weightGrams: 100,
        calories: 400,
        nutrients: { calories: 400, protein: 12.5, carbohydrates: 67.5, totalFat: 7.5, saturatedFat: 1.25, sodium: 0 },
        rawNutritionLabel: rawLabel,
        brandLock: 'Quaker',
        dbSource: 'brand_official',
      },
      {
        scoutIndex: 1,
        name: 'Rolled Oats Porridge',
        canonicalDbName: 'Rolled Oats Porridge',
        weightGrams: 250,
        calories: 164,
        nutrients: { calories: 164, protein: 6, carbohydrates: 28, totalFat: 3, saturatedFat: 0.5, sodium: 115 },
        dbSource: 'estimated',
      },
    ];

    const result = await applyMealEdits({
      items,
      userMessage: "I only had 1 dish. It's the same dish",
      commands: [
        {
          action: 'remove_item',
          itemName: 'Quaker Whole Rolled Oats',
        },
      ],
    });

    expect(result.items).toHaveLength(1);
    const merged = result.items[0];
    expect(merged.weightGrams).toBe(100);
    expect(result.weightGrams).toBe(100);
    expect(merged.rawNutritionLabel).toEqual(rawLabel);
    expect(merged.calories).toBe(400);
    expect(result.nutrients.calories).toBe(400);
  });

  it('F-13.1 add_item: composer [Mr Oat Rolled Oats] beats short scout/estimate name', async () => {
    const result = await applyMealEdits({
      items: [
        {
          scoutIndex: 0,
          name: 'White Coffee',
          weightGrams: 215,
          calories: 50,
          nutrients: { calories: 50, protein: 2, carbohydrates: 5, totalFat: 2, saturatedFat: 1, sodium: 40 },
        },
        {
          scoutIndex: 1,
          name: 'Big Mac',
          weightGrams: 215,
          calories: 508,
          nutrients: { calories: 508, protein: 26, carbohydrates: 41, totalFat: 26, saturatedFat: 9, sodium: 920 },
        },
        {
          scoutIndex: 2,
          name: 'Coconut Juice',
          weightGrams: 200,
          calories: 40,
          nutrients: { calories: 40, protein: 0, carbohydrates: 9, totalFat: 0, saturatedFat: 0, sodium: 50 },
        },
      ],
      userMessage: '[Mr Oat Rolled Oats] [40g] add oats, drop the coconut',
      commands: [
        { action: 'remove_item', itemName: 'Coconut Juice' },
        {
          action: 'add_item',
          itemName: 'Rolled Oats',
          newItemName: 'Rolled Oats',
          newWeightGrams: 40,
          // Short scout estimate foodName must not clobber the richer bracket tag.
          estimate: {
            foodName: 'Rolled Oats',
            protein: 5,
            carbohydrates: 27,
            totalFat: 2.5,
            saturatedFat: 0.5,
            sodium: 2,
            totalFibre: 4,
          },
        },
      ],
    });
    const names = result.items.map((i: any) => i.name);
    expect(names).toContain('Mr Oat Rolled Oats');
    expect(names.join('|')).not.toMatch(/Coconut/i);
    expect(result.items).toHaveLength(3);
    const oats = result.items.find((i: any) => i.name === 'Mr Oat Rolled Oats');
    expect(oats?.weightGrams).toBe(40);
  });

  it('F-13.1 replace_identity: bracket tag upgrades short replacement name', async () => {
    const result = await applyMealEdits({
      items: [
        {
          scoutIndex: 0,
          name: 'Coconut Juice',
          weightGrams: 200,
          calories: 40,
          nutrients: { calories: 40, protein: 0, carbohydrates: 9, totalFat: 0, saturatedFat: 0, sodium: 50 },
        },
      ],
      userMessage: '[Mr Oat Rolled Oats] [40g] swap coconut for oats',
      commands: [
        {
          action: 'replace_identity',
          itemName: 'Coconut Juice',
          newItemName: 'Rolled Oats',
          newWeightGrams: 40,
          estimate: { foodName: 'Rolled Oats', protein: 5, carbohydrates: 27, totalFat: 2.5 },
        },
      ],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Mr Oat Rolled Oats');
    expect(result.items[0].weightGrams).toBe(40);
  });

});

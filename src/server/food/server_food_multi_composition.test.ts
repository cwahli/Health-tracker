import { describe, it, expect } from 'vitest';
import { injectExplicitFoodTags } from './server_food_scout_source';

describe('MultiItemComposition & Explicit Tag Preservation', () => {
  it('injects both brand and previous meal tags with complete nutrition and image metadata', () => {
    const visionScoutItems: any[] = [];
    const explicitFoodTags = [
      {
        dbId: 'brand_menu_pret_latte',
        name: 'Pret Latte',
        weightGrams: 350,
        source: 'catalog_tag',
        imageUrl: '/photos/brand_pret_latte.jpg',
        nutrients: { calories: 150, protein: 8, carbohydrates: 12, totalFat: 6 }
      },
      {
        dbId: 'food_saved_avocado_toast',
        name: 'Avocado Toast',
        weightGrams: 180,
        source: 'previous_meal',
        imageUrl: '/photos/toast.jpg',
        originalLog: {
          id: 'food_saved_avocado_toast',
          name: 'Avocado Toast',
          calories: 320,
          protein: 9,
          totalFat: 18,
          carbohydrates: 28,
          imageUrl: '/photos/toast.jpg'
        }
      }
    ];

    const logs: string[] = [];
    injectExplicitFoodTags({
      visionScoutItems,
      explicitFoodTags,
      onLog: (m) => logs.push(m)
    });

    expect(visionScoutItems).toHaveLength(2);

    // Brand item verification
    const brandItem = visionScoutItems.find(v => v.dbId === 'brand_menu_pret_latte');
    expect(brandItem).toBeDefined();
    expect(brandItem.keyword).toBe('Pret Latte');
    expect(brandItem.source).toBe('catalog_tag');
    expect(brandItem.dbSource).toBe('internal_catalog');
    expect(brandItem.imageUrl).toBe('/photos/brand_pret_latte.jpg');
    expect(brandItem.nutrients.calories).toBe(150);

    // Previous meal item verification
    const savedItem = visionScoutItems.find(v => v.dbId === 'food_saved_avocado_toast');
    expect(savedItem).toBeDefined();
    expect(savedItem.keyword).toBe('Avocado Toast');
    expect(savedItem.source).toBe('previous_meal');
    expect(savedItem.dbSource).toBe('previous_meal');
    expect(savedItem.imageUrl).toBe('/photos/toast.jpg');

    expect(logs.some(l => l.includes('Injected 2 catalog tags'))).toBe(true);
  });

  it('prevents duplicate injection if a tag is already present in visionScoutItems', () => {
    const visionScoutItems: any[] = [
      {
        scoutIndex: 1,
        keyword: 'Pret Latte',
        dbId: 'brand_menu_pret_latte'
      }
    ];
    const explicitFoodTags = [
      {
        dbId: 'brand_menu_pret_latte',
        name: 'Pret Latte',
        weightGrams: 350
      },
      {
        dbId: 'brand_menu_pret_croissant',
        name: 'Pret Butter Croissant',
        weightGrams: 75
      }
    ];

    injectExplicitFoodTags({
      visionScoutItems,
      explicitFoodTags,
      onLog: () => {}
    });

    expect(visionScoutItems).toHaveLength(2);
    expect(visionScoutItems[1].keyword).toBe('Pret Butter Croissant');
  });
});

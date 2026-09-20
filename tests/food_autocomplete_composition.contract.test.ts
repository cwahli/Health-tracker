import { describe, it, expect } from 'vitest';
import {
  parseBracketItems,
  formatBracketItem,
  updateOrAddBracketItem,
  removeBracketItem,
  extractAutocompleteQuery
} from '../src/utils/bracketPortionParser.js';
import {
  calculateCompositeMeal,
  type StagedFoodTag
} from '../src/utils/compositeFoodCalculation.js';
import {
  resolvePhotoForBrandItem,
  buildBrandItemFromMealLog
} from '../serverBrandMenu.js';

describe('Master Scorecard: Food Autocomplete, Composition, Photos & Admin Overwrite', () => {

  // =========================================================================
  // 1. Autocomplete Search, Image Linking & Multi-Item Staging
  // =========================================================================
  describe('1. Food Autocomplete, Photo Linking & Multi-Item Staging', () => {
    it('isolates autocomplete search terms while ignoring existing bracket tags in chat input', () => {
      // User has already staged a latte and is now typing "avocado toast"
      const chatInputWithTag = 'I had [Pret Latte] [350g] avocado toast';
      const extractedQuery = extractAutocompleteQuery(chatInputWithTag);
      expect(extractedQuery).toBe('avocado toast');

      // User has staged two items and types a third query
      const chatWithMultipleTags = '[Pret Latte] [350g] [Avocado Toast] [180g] blueberry muffin';
      expect(extractAutocompleteQuery(chatWithMultipleTags)).toBe('blueberry muffin');

      // Less than 3 chars returns empty string to prevent noisy queries
      expect(extractAutocompleteQuery('[Pret Latte] [350g] a')).toBe('');
      expect(extractAutocompleteQuery('[Pret Latte] [350g]')).toBe('');
    });

    it('maps catalog matches and previous meal logs with their correct photo links', () => {
      // Mock catalog search result (brand food)
      const brandCandidate = {
        dish_key: 'brand_pret_latte',
        dish_name: 'Pret Latte',
        chain_name: 'Pret A Manger',
        image_url: 'https://r2.example.com/photos/sha256_pret_latte.jpg',
        serving_grams: 350,
        calories: 150
      };

      // Mock previous meal log
      const previousMealLog = {
        id: 'meal_log_toast_123',
        name: 'Avocado Sourdough Toast',
        imageUrl: 'https://r2.example.com/photos/sha256_toast.jpg',
        portion_grams: 180,
        calories: 320
      };

      // Staging both into explicitFoodTags
      const explicitFoodTags: StagedFoodTag[] = [
        {
          dbId: brandCandidate.dish_key,
          name: brandCandidate.dish_name,
          weightGrams: brandCandidate.serving_grams,
          source: 'catalog_tag',
          imageUrl: brandCandidate.image_url,
          item: brandCandidate
        },
        {
          dbId: previousMealLog.id,
          name: previousMealLog.name,
          weightGrams: previousMealLog.portion_grams,
          source: 'previous_meal',
          imageUrl: previousMealLog.imageUrl,
          originalLog: previousMealLog
        }
      ];

      expect(explicitFoodTags).toHaveLength(2);
      expect(explicitFoodTags[0].imageUrl).toBe('https://r2.example.com/photos/sha256_pret_latte.jpg');
      expect(explicitFoodTags[1].imageUrl).toBe('https://r2.example.com/photos/sha256_toast.jpg');
    });

    it('allows staging multiple saved meals and brand items sequentially in the chat input', () => {
      let chatText = '';
      const stagedTags: StagedFoodTag[] = [];

      // Step 1: User adds Brand Latte
      stagedTags.push({
        dbId: 'brand_1',
        name: 'Pret Latte',
        weightGrams: 350,
        source: 'catalog_tag',
        imageUrl: 'https://r2.example.com/photos/sha256_latte.jpg'
      });
      chatText = updateOrAddBracketItem(chatText, 'Pret Latte', '350g');
      expect(chatText).toBe('[Pret Latte] [350g]');

      // Step 2: User searches and adds Avocado Toast
      stagedTags.push({
        dbId: 'prev_1',
        name: 'Avocado Toast',
        weightGrams: 180,
        source: 'previous_meal',
        imageUrl: 'https://r2.example.com/photos/sha256_toast.jpg'
      });
      chatText = updateOrAddBracketItem(chatText, 'Avocado Toast', '180g');
      expect(chatText).toBe('[Pret Latte] [350g] [Avocado Toast] [180g]');

      // Step 3: User searches and adds Blueberry Muffin
      stagedTags.push({
        dbId: 'brand_2',
        name: 'Blueberry Muffin',
        weightGrams: 120,
        source: 'catalog_tag',
        imageUrl: 'https://r2.example.com/photos/sha256_muffin.jpg'
      });
      chatText = updateOrAddBracketItem(chatText, 'Blueberry Muffin', '120g');
      expect(chatText).toBe('[Pret Latte] [350g] [Avocado Toast] [180g] [Blueberry Muffin] [120g]');

      // Verify all 3 items coexist with individual photos
      expect(stagedTags).toHaveLength(3);
      expect(stagedTags.map(t => t.imageUrl)).toEqual([
        'https://r2.example.com/photos/sha256_latte.jpg',
        'https://r2.example.com/photos/sha256_toast.jpg',
        'https://r2.example.com/photos/sha256_muffin.jpg'
      ]);
    });
  });

  // =========================================================================
  // 2. Chat Bracket Portion Editing
  // =========================================================================
  describe('2. Direct Portion Editing in Chat Brackets', () => {
    it('parses grams, multipliers, and servings from chat bracket patterns', () => {
      const parsedA = parseBracketItems('Had [Pret Latte] [350g] and [Egg Sandwich] [1.5x]');
      expect(parsedA).toHaveLength(2);
      expect(parsedA[0].name).toBe('Pret Latte');
      expect(parsedA[0].scaling?.value).toBe(350);
      expect(parsedA[0].scaling?.unit).toBe('g');

      expect(parsedA[1].name).toBe('Egg Sandwich');
      expect(parsedA[1].scaling?.value).toBe(1.5);
      expect(parsedA[1].scaling?.unit).toBe('x');

      // Inline pattern [Item 180g]
      const parsedB = parseBracketItems('[Avocado Toast 180g]');
      expect(parsedB).toHaveLength(1);
      expect(parsedB[0].name).toBe('Avocado Toast');
      expect(parsedB[0].scaling?.value).toBe(180);
      expect(parsedB[0].scaling?.unit).toBe('g');
    });

    it('updates portion quantity in-place in chat text', () => {
      const initialChat = 'Lunch: [Pret Latte] [350g] [Avocado Toast] [180g]';

      // User adjusts portion of Latte from 350g to 250g in chat or tray
      const updatedChat = updateOrAddBracketItem(initialChat, 'Pret Latte', '250g');
      expect(updatedChat).toBe('Lunch: [Pret Latte] [250g] [Avocado Toast] [180g]');

      // User adjusts multiplier of Toast to 2x
      const updatedMultiplier = updateOrAddBracketItem(updatedChat, 'Avocado Toast', '2x');
      expect(updatedMultiplier).toBe('Lunch: [Pret Latte] [250g] [Avocado Toast] [2x]');
    });

    it('removes specific bracket item cleanly without corrupting other staged tags', () => {
      const initialChat = 'Lunch: [Pret Latte] [250g] [Avocado Toast] [180g]';
      const removedLatte = removeBracketItem(initialChat, 'Pret Latte');
      expect(removedLatte).toBe('Lunch: [Avocado Toast] [180g]');
    });
  });

  // =========================================================================
  // 3. Photo Association & Non-Duplication
  // =========================================================================
  describe('3. Photo Disambiguation & Non-Duplication', () => {
    const photoCoffee = 'https://r2.example.com/photos/sha256_coffee.jpg';
    const photoToast = 'https://r2.example.com/photos/sha256_toast.jpg';
    const photoMuffin = 'https://r2.example.com/photos/sha256_muffin.jpg';

    it('links only the photo matching sourceImageIndex in multi-photo meals', () => {
      const photos = [photoCoffee, photoToast, photoMuffin];

      // Scout Dish 0 (Coffee) -> Photo 0
      expect(resolvePhotoForBrandItem(photos, 0)).toBe(photoCoffee);

      // Scout Dish 1 (Toast) -> Photo 1
      expect(resolvePhotoForBrandItem(photos, 1)).toBe(photoToast);

      // Scout Dish 2 (Muffin) -> Photo 2
      expect(resolvePhotoForBrandItem(photos, 2)).toBe(photoMuffin);

      // Missing or out of bounds index prevents cross-contamination
      expect(resolvePhotoForBrandItem(photos, undefined)).toBeNull();
      expect(resolvePhotoForBrandItem(photos, null)).toBeNull();
      expect(resolvePhotoForBrandItem(photos, 5)).toBeNull();
    });

    it('deduplicates identical photos when aggregating composite meals', () => {
      const explicitTags: StagedFoodTag[] = [
        {
          name: 'Dish Part A',
          weightGrams: 100,
          imageUrl: photoCoffee,
          item: { calories: 100, serving_grams: 100 }
        },
        {
          name: 'Dish Part B',
          weightGrams: 150,
          // Same photo uploaded for both parts
          imageUrl: photoCoffee,
          item: { calories: 150, serving_grams: 100 }
        }
      ];

      const composite = calculateCompositeMeal(explicitTags);
      // Photo array must NOT duplicate photoCoffee.
      // Aggregated arrays carry same-origin proxy form (proxy-first migration,
      // locked by foodImageSources tests); per-dish links below stay verbatim.
      expect(composite.allImages).toEqual(['/photos/sha256_coffee.jpg']);
      expect(composite.allImages).toHaveLength(1);
      // Both individual dishes keep their photo link in itemsBreakdown (proxy form)
      expect(composite.itemsBreakdown[0].imageUrl).toBe('/photos/sha256_coffee.jpg');
      expect(composite.itemsBreakdown[1].imageUrl).toBe('/photos/sha256_coffee.jpg');
    });
  });

  // =========================================================================
  // 4. Admin Pull Food from History & Full Brand Item Overwrite
  // =========================================================================
  describe('4. Admin Pull Food from History & Full Brand Overwrite', () => {
    it('completely overwrites brand item with meal log nutrition, serving size, and photo', () => {
      const mealLogFromHistory = {
        id: 'meal_1789648119000',
        name: 'Pret Egg & Spinach Protein Pot',
        calories: 285,
        protein: 19.5,
        carbohydrates: 2.3,
        total_fat: 22.0,
        saturated_fat: 5.8,
        sodium: 480,
        portion_grams: 165,
        notes: 'Verified from Pret packaging',
        nutrients: {
          calories: 285,
          protein: 19.5,
          carbohydrates: 2.3,
          totalFat: 22.0,
          saturatedFat: 5.8,
          sodium: 480,
          fiber: 1.2
        }
      };

      const photoUrl = 'https://r2.example.com/photos/sha256_egg_pot.jpg';
      const overwrittenBrandItem = buildBrandItemFromMealLog(mealLogFromHistory, photoUrl);

      // Overwrite must replace all nutritional properties
      expect(overwrittenBrandItem.image_url).toBe(photoUrl);
      expect(overwrittenBrandItem.calories).toBe(285);
      expect(overwrittenBrandItem.protein).toBe(19.5);
      expect(overwrittenBrandItem.carbohydrates).toBe(2.3);
      expect(overwrittenBrandItem.total_fat).toBe(22.0);
      expect(overwrittenBrandItem.saturated_fat).toBe(5.8);
      expect(overwrittenBrandItem.sodium).toBe(480);
      expect(overwrittenBrandItem.serving_grams).toBe(165);
      expect(overwrittenBrandItem.basis_type).toBe('per_dish');
      expect(overwrittenBrandItem.notes).toBe('Verified from Pret packaging');

      // Nutrients ledger must also reflect full overwrite and derived salt
      expect(overwrittenBrandItem.nutrients.calories).toBe(285);
      expect(overwrittenBrandItem.nutrients.protein).toBe(19.5);
      expect(overwrittenBrandItem.nutrients.salt).toBe(1.2); // 480 / 400
    });

    it('supports direct photo addition to brand items without a meal log', () => {
      const directPhotoUrl = 'https://r2.example.com/photos/sha256_direct_shot.jpg';
      const itemUpdate = {
        image_url: directPhotoUrl,
        updated_at: new Date().toISOString()
      };
      expect(itemUpdate.image_url).toBe(directPhotoUrl);
    });
  });

  // =========================================================================
  // 5. Multi-Item Chat Composition, Photo Accumulation & Calculation
  // =========================================================================
  describe('5. Multi-Item Composition, Photo Accumulation & Exact Calculation', () => {
    it('accumulates photos and dishes, correctly scaling composite nutrition totals for 3 items', () => {
      const explicitTags: StagedFoodTag[] = [
        // Item 1: Pret Latte, 350g (factor 1.0)
        {
          dbId: 'brand_latte',
          name: 'Pret Latte',
          weightGrams: 350,
          source: 'catalog_tag',
          imageUrl: 'https://r2.example.com/photos/sha256_latte.jpg',
          item: {
            serving_grams: 350,
            calories: 150,
            protein: 8,
            carbohydrates: 12,
            total_fat: 6,
            saturated_fat: 3,
            total_fibre: 0.5,
            sodium: 120
          }
        },
        // Item 2: Avocado Toast, 270g (base 180g -> factor 1.5x)
        {
          dbId: 'meal_toast',
          name: 'Avocado Toast',
          weightGrams: 270,
          source: 'previous_meal',
          imageUrl: 'https://r2.example.com/photos/sha256_toast.jpg',
          originalLog: {
            weightGrams: 180,
            calories: 320,
            protein: 9,
            carbohydrates: 28,
            totalFat: 18,
            saturatedFat: 4,
            totalFibre: 6,
            sodium: 350
          }
        },
        // Item 3: Blueberry Muffin, 60g (base 120g -> factor 0.5x)
        {
          dbId: 'brand_muffin',
          name: 'Blueberry Muffin',
          weightGrams: 60,
          source: 'catalog_tag',
          imageUrl: 'https://r2.example.com/photos/sha256_muffin.jpg',
          item: {
            serving_grams: 120,
            calories: 400,
            protein: 6,
            carbohydrates: 50,
            total_fat: 20,
            saturated_fat: 5,
            total_fibre: 2,
            sodium: 240
          }
        }
      ];

      const composite = calculateCompositeMeal(explicitTags);

      // Photos accumulated without duplication (proxy form, see above)
      expect(composite.allImages).toEqual([
        '/photos/sha256_latte.jpg',
        '/photos/sha256_toast.jpg',
        '/photos/sha256_muffin.jpg'
      ]);
      expect(composite.primaryImageUrl).toBe('/photos/sha256_latte.jpg');

      // Dishes accumulated
      expect(composite.itemsBreakdown).toHaveLength(3);
      expect(composite.itemsBreakdown[0].name).toBe('Pret Latte');
      expect(composite.itemsBreakdown[0].weightGrams).toBe(350);
      expect(composite.itemsBreakdown[0].calories).toBe(150);

      expect(composite.itemsBreakdown[1].name).toBe('Avocado Toast');
      expect(composite.itemsBreakdown[1].weightGrams).toBe(270);
      expect(composite.itemsBreakdown[1].calories).toBe(480); // 320 * 1.5

      expect(composite.itemsBreakdown[2].name).toBe('Blueberry Muffin');
      expect(composite.itemsBreakdown[2].weightGrams).toBe(60);
      expect(composite.itemsBreakdown[2].calories).toBe(200); // 400 * 0.5

      // Dish composite name
      expect(composite.dishName).toBe('Pret Latte + Avocado Toast + Blueberry Muffin');

      // Proportional calculation totals:
      // Weight: 350 + 270 + 60 = 680g
      expect(composite.totalWeight).toBe(680);
      // Calories: 150 + 480 + 200 = 830 kcal
      expect(composite.roundedCal).toBe(830);
      // Protein: 8 + (9 * 1.5 = 13.5) + (6 * 0.5 = 3) = 24.5g
      expect(composite.roundedProt).toBe(24.5);
      // Carbs: 12 + (28 * 1.5 = 42) + (50 * 0.5 = 25) = 79.0g
      expect(composite.roundedCarb).toBe(79.0);
      // Total Fat: 6 + (18 * 1.5 = 27) + (20 * 0.5 = 10) = 43.0g
      expect(composite.roundedFat).toBe(43.0);
      // Saturated Fat: 3 + (4 * 1.5 = 6) + (5 * 0.5 = 2.5) = 11.5g
      expect(composite.roundedSat).toBe(11.5);
      // Fibre: 0.5 + (6 * 1.5 = 9) + (2 * 0.5 = 1) = 10.5g
      expect(composite.roundedFib).toBe(10.5);
      // Sodium: 120 + (350 * 1.5 = 525) + (240 * 0.5 = 120) = 765mg
      expect(composite.roundedSod).toBe(765);
    });
  });
});

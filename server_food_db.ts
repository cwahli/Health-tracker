// Food-type classification table for the 20 trace nutrients.
// Keyed by the 14 foodType values the LLM outputs. All values are per 100g.
// This table is STABLE — adding new foods does not require updating it.
export type FoodType =
  | 'red_meat' | 'poultry' | 'fish_fatty' | 'fish_lean' | 'shellfish'
  | 'egg' | 'dairy' | 'leafy_veg' | 'root_veg' | 'legume'
  | 'grain' | 'fruit' | 'processed' | 'beverage' | 'beverage_zero' | 'unknown';
export interface TraceNutrients {
  unsaturatedFat: number; omega3: number;
  magnesium: number; calcium: number; iron: number; zinc: number;
  selenium: number; iodine: number; phosphorus: number;
  vitaminD: number; vitaminB12: number; folate: number;
  vitaminC: number; vitaminE: number; vitaminK: number;
  vitaminA: number; vitaminB6: number; thiamine: number;
  riboflavin: number; niacin: number;
}
export const FOOD_TYPE_TRACE_NUTRIENTS: Record<FoodType, TraceNutrients> = {
  red_meat:   { unsaturatedFat:6.0, omega3:0.10, magnesium:22, calcium:15, iron:2.5, zinc:4.5, selenium:22, iodine:2.5, phosphorus:195, vitaminD:3,   vitaminB12:2.5, folate:8,   vitaminC:0,  vitaminE:0.2, vitaminK:1.5, vitaminA:0,    vitaminB6:0.40, thiamine:0.07, riboflavin:0.17, niacin:5.5 },
  poultry:    { unsaturatedFat:4.5, omega3:0.06, magnesium:28, calcium:12, iron:0.9, zinc:1.8, selenium:18, iodine:8,   phosphorus:210, vitaminD:5,   vitaminB12:0.3, folate:6,   vitaminC:0,  vitaminE:0.3, vitaminK:3.0, vitaminA:40,   vitaminB6:0.60, thiamine:0.06, riboflavin:0.12, niacin:13.0 },
  fish_fatty: { unsaturatedFat:9.0, omega3:2.50, magnesium:27, calcium:10, iron:0.4, zinc:0.5, selenium:32, iodine:15,  phosphorus:245, vitaminD:525, vitaminB12:3.2, folate:5,   vitaminC:0,  vitaminE:1.1, vitaminK:0.5, vitaminA:50,   vitaminB6:0.60, thiamine:0.20, riboflavin:0.15, niacin:8.5 },
  fish_lean:  { unsaturatedFat:1.5, omega3:0.40, magnesium:30, calcium:18, iron:0.5, zinc:0.6, selenium:38, iodine:12,  phosphorus:220, vitaminD:80,  vitaminB12:1.8, folate:7,   vitaminC:0,  vitaminE:0.6, vitaminK:0.1, vitaminA:18,   vitaminB6:0.40, thiamine:0.10, riboflavin:0.10, niacin:7.0 },
  shellfish:  { unsaturatedFat:0.8, omega3:0.60, magnesium:34, calcium:80, iron:3.0, zinc:5.5, selenium:45, iodine:35,  phosphorus:210, vitaminD:10,  vitaminB12:10.0, folate:12, vitaminC:3,  vitaminE:0.9, vitaminK:0.1, vitaminA:50,   vitaminB6:0.10, thiamine:0.09, riboflavin:0.17, niacin:2.5 },
  egg:        { unsaturatedFat:4.5, omega3:0.10, magnesium:12, calcium:50, iron:1.8, zinc:1.3, selenium:31, iodine:50,  phosphorus:198, vitaminD:82,  vitaminB12:1.1, folate:47,  vitaminC:0,  vitaminE:1.0, vitaminK:0.3, vitaminA:140,  vitaminB6:0.17, thiamine:0.04, riboflavin:0.46, niacin:0.1 },
  dairy:      { unsaturatedFat:1.5, omega3:0.05, magnesium:11, calcium:120,iron:0.1, zinc:0.4, selenium:3,  iodine:15,  phosphorus:93,  vitaminD:40,  vitaminB12:0.4, folate:5,   vitaminC:0,  vitaminE:0.1, vitaminK:0.3, vitaminA:50,   vitaminB6:0.04, thiamine:0.04, riboflavin:0.18, niacin:0.1 },
  leafy_veg:  { unsaturatedFat:0.1, omega3:0.05, magnesium:60, calcium:100,iron:2.0, zinc:0.4, selenium:1,  iodine:2,   phosphorus:45,  vitaminD:0,   vitaminB12:0,   folate:150, vitaminC:50, vitaminE:2.0, vitaminK:300, vitaminA:3500, vitaminB6:0.15, thiamine:0.05, riboflavin:0.12, niacin:0.8 },
  root_veg:   { unsaturatedFat:0.05,omega3:0.01, magnesium:20, calcium:30, iron:0.4, zinc:0.2, selenium:0.5,iodine:1,   phosphorus:44,  vitaminD:0,   vitaminB12:0,   folate:20,  vitaminC:15, vitaminE:0.5, vitaminK:10,  vitaminA:500,  vitaminB6:0.20, thiamine:0.07, riboflavin:0.04, niacin:1.0 },
  legume:     { unsaturatedFat:0.4, omega3:0.02, magnesium:45, calcium:50, iron:3.0, zinc:1.2, selenium:4,  iodine:3,   phosphorus:130, vitaminD:0,   vitaminB12:0,   folate:150, vitaminC:2,  vitaminE:0.5, vitaminK:8,   vitaminA:0,    vitaminB6:0.25, thiamine:0.20, riboflavin:0.08, niacin:1.5 },
  grain:      { unsaturatedFat:0.5, omega3:0.02, magnesium:28, calcium:15, iron:0.8, zinc:1.0, selenium:10, iodine:1,   phosphorus:100, vitaminD:0,   vitaminB12:0,   folate:30,  vitaminC:0,  vitaminE:0.4, vitaminK:2,   vitaminA:0,    vitaminB6:0.10, thiamine:0.15, riboflavin:0.03, niacin:2.0 },
  fruit:      { unsaturatedFat:0.1, omega3:0.02, magnesium:10, calcium:10, iron:0.2, zinc:0.1, selenium:0.5,iodine:0.5, phosphorus:18,  vitaminD:0,   vitaminB12:0,   folate:20,  vitaminC:40, vitaminE:0.5, vitaminK:5,   vitaminA:100,  vitaminB6:0.10, thiamine:0.03, riboflavin:0.02, niacin:0.5 },
  processed:  { unsaturatedFat:3.0, omega3:0.02, magnesium:10, calcium:20, iron:0.5, zinc:0.5, selenium:5,  iodine:5,   phosphorus:80,  vitaminD:0,   vitaminB12:0,   folate:10,  vitaminC:0,  vitaminE:0.2, vitaminK:2,   vitaminA:10,   vitaminB6:0.05, thiamine:0.10, riboflavin:0.05, niacin:1.0 },
  beverage:   { unsaturatedFat:0.0, omega3:0.0,  magnesium:2,  calcium:5,  iron:0.05,zinc:0.05,selenium:0.2,iodine:0.2, phosphorus:10,  vitaminD:0,   vitaminB12:0,   folate:1,   vitaminC:1,  vitaminE:0.0, vitaminK:0,   vitaminA:0,    vitaminB6:0.01, thiamine:0.01, riboflavin:0.01, niacin:0.1 },
  beverage_zero: { unsaturatedFat:0.0, omega3:0.0, magnesium:0, calcium:0, iron:0,   zinc:0,   selenium:0,   iodine:0,   phosphorus:0,   vitaminD:0,   vitaminB12:0,   folate:0,   vitaminC:0,  vitaminE:0,   vitaminK:0,   vitaminA:0,    vitaminB6:0,    thiamine:0,    riboflavin:0,    niacin:0 },
  unknown:    { unsaturatedFat:2.0, omega3:0.05, magnesium:20, calcium:30, iron:0.8, zinc:0.8, selenium:5,  iodine:3,   phosphorus:80,  vitaminD:0,   vitaminB12:0.2, folate:20,  vitaminC:5,  vitaminE:0.3, vitaminK:5,   vitaminA:50,   vitaminB6:0.10, thiamine:0.07, riboflavin:0.07, niacin:1.5 },
};
export function getTraceNutrientsForFoodType(foodType: string, weightGrams: number): TraceNutrients {
  const profile = FOOD_TYPE_TRACE_NUTRIENTS[foodType as FoodType] || FOOD_TYPE_TRACE_NUTRIENTS['unknown'];
  const factor = weightGrams / 100;
  const result: any = {};
  for (const k of Object.keys(profile)) {
    result[k] = parseFloat(((profile as any)[k] * factor).toFixed(2));
  }
  return result as TraceNutrients;
}

export interface OilModifier {
  addedFatPer100g: number; // grams of oil absorbed per 100g of food weight
  addedSaturatedFatPer100g: number; // of that absorbed fat, how much is saturated fat (approx 15% for typical veggie/frying oil)
  addedCaloriesPer100g: number; // 9 calories per gram of fat
  addedSodiumPer100g: number; // mg of sodium added per 100g from cooking seasoning / butter / pan glazing
  description: string;
}

export const COOKING_METHOD_OIL_MODIFIERS: Record<string, OilModifier> = {
  deep_fried: { addedFatPer100g: 10.0, addedSaturatedFatPer100g: 1.5, addedCaloriesPer100g: 90.0, addedSodiumPer100g: 250.0, description: "Deep-fried" },
  pan_fried:  { addedFatPer100g: 5.0,  addedSaturatedFatPer100g: 0.75, addedCaloriesPer100g: 45.0, addedSodiumPer100g: 200.0, description: "Pan-fried" },
  stir_fried: { addedFatPer100g: 3.0,  addedSaturatedFatPer100g: 0.45, addedCaloriesPer100g: 27.0, addedSodiumPer100g: 180.0, description: "Stir-fried" },
  glazed:     { addedFatPer100g: 2.0,  addedSaturatedFatPer100g: 0.30, addedCaloriesPer100g: 18.0, addedSodiumPer100g: 350.0, description: "Glazed" },
  braised:    { addedFatPer100g: 2.0,  addedSaturatedFatPer100g: 0.30, addedCaloriesPer100g: 18.0, addedSodiumPer100g: 300.0, description: "Braised" },
  roasted:    { addedFatPer100g: 1.5,  addedSaturatedFatPer100g: 0.22, addedCaloriesPer100g: 13.5, addedSodiumPer100g: 150.0, description: "Roasted" },
  boiled:     { addedFatPer100g: 0.0,  addedSaturatedFatPer100g: 0.0,  addedCaloriesPer100g: 0.0,  addedSodiumPer100g: 50.0,  description: "Boiled" },
  steamed:    { addedFatPer100g: 0.0,  addedSaturatedFatPer100g: 0.0,  addedCaloriesPer100g: 0.0,  addedSodiumPer100g: 30.0,  description: "Steamed" },
  grilled:    { addedFatPer100g: 0.5,  addedSaturatedFatPer100g: 0.07, addedCaloriesPer100g: 4.5,  addedSodiumPer100g: 150.0, description: "Grilled" },
  baked:      { addedFatPer100g: 0.5,  addedSaturatedFatPer100g: 0.07, addedCaloriesPer100g: 4.5,  addedSodiumPer100g: 120.0, description: "Baked" },
  raw:        { addedFatPer100g: 0.0,  addedSaturatedFatPer100g: 0.0,  addedCaloriesPer100g: 0.0,  addedSodiumPer100g: 0.0,   description: "Raw / Uncooked" },
  unknown:    { addedFatPer100g: 0.0,  addedSaturatedFatPer100g: 0.0,  addedCaloriesPer100g: 0.0,  addedSodiumPer100g: 100.0, description: "Standard" }
};

export const BEVERAGE_PATTERN = /\b(beverage|drink|water|juice|beer|wine|soda|cola|tea|coffee|cappuccino|espresso|latte|mocha|macchiato|boba|smoothie|shake|milk|oat\s*milk|oatmilk|almond\s*milk|almondmilk|soy\s*milk|soymilk|coconut\s*milk|dairy|yogurt|fruit|melon|watermelon|apple|orange|banana|berry|berries|grape|citrus|salad|raw|fresh|broth|soup)\b/i;
export const COMPOUND_BOWL_PATTERN = /\b(bowl|bowls|poke|salad|salads|bento|combo|platter|box|curry|stew|compound_meal)\b/i;

export function calculateUniversalAddedNutrients(
  foodMatrix: string,
  cookingMethod: string,
  weightGrams: number,
  visualSheen: number = 0.5,
  visualCoating: number = 0.5,
  diningEnvironment: string = 'casual_restaurant',
  isAlreadyPrepared: boolean = false,
  hasSauceOrDressing: boolean = false
) {
  if (isAlreadyPrepared || COMPOUND_BOWL_PATTERN.test(foodMatrix) || BEVERAGE_PATTERN.test(foodMatrix) || BEVERAGE_PATTERN.test(cookingMethod) || cookingMethod === 'raw' || cookingMethod === 'brewed' || cookingMethod === 'brewed_espresso' || cookingMethod === 'poured') {
    // Prepared/packaged/seasoned products, compound bowls/salads, and beverages/liquids have zero added thermal cooking fat or salt.
    return { addedFat: 0, addedSaturatedFat: 0, addedCalories: 0, addedSodium: 0 };
  }

  const isDietaryIATA = Boolean(diningEnvironment.match(/\b(LFML|LSML|DBML|GFML|AVML)\b/i));
  const envMults: Record<string, { sodium: number; lipid: number }> = {
    home_cooked: { sodium: 0.60, lipid: 0.60 },
    casual_restaurant: { sodium: 1.00, lipid: 1.00 },
    fast_food_chain: { sodium: 1.40, lipid: 1.40 },
    fine_dining: { sodium: 0.90, lipid: 1.30 },
    airline: { sodium: isDietaryIATA ? 1.00 : 1.50, lipid: 1.00 },
    unknown: { sodium: 1.00, lipid: 1.00 }
  };
  const env = envMults[diningEnvironment] || envMults.casual_restaurant;
  const surfaceAreaFactor = weightGrams / 100;

  if (cookingMethod === 'boiled' || cookingMethod === 'steamed' || cookingMethod === 'raw' || cookingMethod === 'unknown') {
    let addedSodium = 0;
    if (cookingMethod === 'boiled' || cookingMethod === 'steamed') {
      const baseNa = hasSauceOrDressing ? 15.0 : 30.0;
      addedSodium = Math.round((surfaceAreaFactor * visualCoating * baseNa) * env.sodium);
    }
    return { addedFat: 0, addedSaturatedFat: 0, addedCalories: 0, addedSodium };
  }

  let kInternal = 0.0;
  if (foodMatrix === 'CELLULAR_STARCH') {
    if (cookingMethod === 'deep_fried') kInternal = 0.10;
    else if (cookingMethod === 'pan_fried') kInternal = 0.03;
  }

  const baseFatPerMethod: Record<string, number> = {
    deep_fried: 10.0,
    pan_fried: 8.0,
    stir_fried: 5.0,
    glazed: 4.0,
    braised: 3.5,
    roasted: 3.0,
    grilled: 2.0,
    baked: 2.0,
  };
  const methodBaseFat = baseFatPerMethod[cookingMethod] || 8.0;

  const addedFat = (weightGrams * kInternal + surfaceAreaFactor * visualSheen * methodBaseFat) * env.lipid;
  const addedSaturatedFat = addedFat * 0.20;
  const addedCalories = addedFat * 9.0;

  // If the dish includes a sauce or dressing (e.g. black pepper sauce, mayonnaise, gravy),
  // the sauce provides the bulk of the sodium. We still add a smaller base amount to account for baseline cooking salt.
  let addedSodium = 0;
  if (cookingMethod !== 'raw' && cookingMethod !== 'unknown') {
    let baseNa = hasSauceOrDressing ? 40.0 : 120.0;
    if (cookingMethod === 'glazed' || cookingMethod === 'braised') {
      baseNa = hasSauceOrDressing ? 120.0 : 250.0;
    }
    addedSodium = Math.round((surfaceAreaFactor * visualCoating * baseNa) * env.sodium);
  }

  return { addedFat, addedSaturatedFat, addedCalories, addedSodium };
}

export function getCookingMethodModifier(methodStr: string | null | undefined): OilModifier {
  if (!methodStr) return COOKING_METHOD_OIL_MODIFIERS.unknown;
  const normalized = methodStr.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  
  // Direct match check
  if (COOKING_METHOD_OIL_MODIFIERS[normalized]) {
    return COOKING_METHOD_OIL_MODIFIERS[normalized];
  }

  // Substring checks
  const lower = methodStr.toLowerCase();
  if (lower.includes("deep") || lower.includes("fried_deep") || lower.includes("deepfried")) {
    return COOKING_METHOD_OIL_MODIFIERS.deep_fried;
  }
  if (lower.includes("pan") && lower.includes("fried")) {
    return COOKING_METHOD_OIL_MODIFIERS.pan_fried;
  }
  if (lower.includes("stir") && lower.includes("fried")) {
    return COOKING_METHOD_OIL_MODIFIERS.stir_fried;
  }
  if (lower.includes("glazed") || lower.includes("glaze")) {
    return COOKING_METHOD_OIL_MODIFIERS.glazed;
  }
  if (lower.includes("braised") || lower.includes("braise")) {
    return COOKING_METHOD_OIL_MODIFIERS.braised;
  }
  if (lower.includes("fry") || lower.includes("fried")) {
    // default fried to pan_fried
    return COOKING_METHOD_OIL_MODIFIERS.pan_fried;
  }
  if (lower.includes("roast") || lower.includes("roasted")) {
    return COOKING_METHOD_OIL_MODIFIERS.roasted;
  }
  if (lower.includes("boil") || lower.includes("boiled") || lower.includes("soup")) {
    return COOKING_METHOD_OIL_MODIFIERS.boiled;
  }
  if (lower.includes("steam") || lower.includes("steamed")) {
    return COOKING_METHOD_OIL_MODIFIERS.steamed;
  }
  if (lower.includes("grill") || lower.includes("grilled") || lower.includes("char")) {
    return COOKING_METHOD_OIL_MODIFIERS.grilled;
  }
  if (lower.includes("bake") || lower.includes("baked")) {
    return COOKING_METHOD_OIL_MODIFIERS.baked;
  }
  if (lower.includes("raw") || lower.includes("fresh") || lower.includes("uncooked") || lower.includes("brew") || lower.includes("pour")) {
    return COOKING_METHOD_OIL_MODIFIERS.raw;
  }

  return COOKING_METHOD_OIL_MODIFIERS.unknown;
}


export const CANONICAL_BASE_FOODS: Record<string, { calories: number; protein: number; totalFat: number; saturatedFat: number; transFat: number; carbohydrates: number; sugar: number; sodium: number; potassium: number; totalFibre: number; vitaminC?: number; vitaminA?: number; calcium?: number; magnesium?: number; iron?: number; zinc?: number; folate?: number; vitaminB6?: number; vitaminD?: number; vitaminE?: number; vitaminK?: number; selenium?: number; phosphorus?: number; vitaminB12?: number; iodine?: number; thiamine?: number; riboflavin?: number; niacin?: number; unsaturatedFat?: number; omega3?: number; foodType: string; [key: string]: any }> = {
  plain_yogurt: { calories: 61, protein: 3.47, totalFat: 3.25, saturatedFat: 2.09, transFat: 0, carbohydrates: 4.66, sugar: 4.66, sodium: 46, potassium: 155, totalFibre: 0, foodType: 'dairy' },
  pain_au_raisin: { calories: 355, protein: 6.2, totalFat: 14.5, saturatedFat: 8.5, transFat: 0.1, carbohydrates: 49.5, sugar: 21.0, sodium: 340, potassium: 160, totalFibre: 2.2, vitaminC: 0.2, vitaminA: 180, calcium: 32, magnesium: 14, iron: 1.8, zinc: 0.6, folate: 70, vitaminB6: 0.04, foodType: 'grain' },
  cinnamon_swirl: { calories: 430, protein: 5.5, totalFat: 19.5, saturatedFat: 11.5, transFat: 0.1, carbohydrates: 55.0, sugar: 24.0, sodium: 320, potassium: 120, totalFibre: 1.8, vitaminC: 0.1, vitaminA: 190, calcium: 35, magnesium: 15, iron: 1.9, zinc: 0.65, folate: 75, vitaminB6: 0.04, foodType: 'grain' },
  pain_au_chocolat: { calories: 414, protein: 7.1, totalFat: 23.5, saturatedFat: 13.8, transFat: 0.1, carbohydrates: 44.0, sugar: 14.5, sodium: 430, potassium: 130, totalFibre: 2.4, vitaminC: 0.2, vitaminA: 195, calcium: 36, magnesium: 18, iron: 2.1, zinc: 0.72, folate: 80, vitaminB6: 0.04, foodType: 'grain' },
  almond_croissant: { calories: 420, protein: 9.0, totalFat: 24.0, saturatedFat: 12.0, transFat: 0.1, carbohydrates: 42.0, sugar: 16.0, sodium: 380, potassium: 190, totalFibre: 3.0, vitaminC: 0.2, vitaminA: 200, calcium: 42, magnesium: 28, iron: 2.2, zinc: 0.8, folate: 85, vitaminB6: 0.05, foodType: 'grain' },
  danish_pastry: { calories: 374, protein: 6.0, totalFat: 20.0, saturatedFat: 9.2, transFat: 0.1, carbohydrates: 43.0, sugar: 18.0, sodium: 320, potassium: 110, totalFibre: 1.5, foodType: 'grain' },
  apple_turnover: { calories: 330, protein: 3.5, totalFat: 17.0, saturatedFat: 8.0, transFat: 0.1, carbohydrates: 42.0, sugar: 16.0, sodium: 280, potassium: 90, totalFibre: 1.6, foodType: 'grain' },
  raisin_bread: { calories: 274, protein: 7.9, totalFat: 4.2, saturatedFat: 0.9, transFat: 0, carbohydrates: 52.4, sugar: 15.6, sodium: 342, potassium: 204, totalFibre: 3.1, foodType: 'grain' },
  raisins: { calories: 299, protein: 3.07, totalFat: 0.46, saturatedFat: 0.05, transFat: 0, carbohydrates: 79.18, sugar: 59.19, sodium: 11, potassium: 749, totalFibre: 3.7, foodType: 'fruit' },
  almonds: { calories: 579, protein: 21.15, totalFat: 49.93, saturatedFat: 3.8, transFat: 0, carbohydrates: 21.55, sugar: 4.35, sodium: 1, potassium: 733, totalFibre: 12.5, foodType: 'nut' },
  croissant: { calories: 406, protein: 8.2, totalFat: 21.0, saturatedFat: 11.66, transFat: 0.16, carbohydrates: 45.8, sugar: 11.26, sodium: 467, potassium: 118, totalFibre: 2.6, vitaminC: 0.2, vitaminA: 206, calcium: 37, magnesium: 16, iron: 2.03, zinc: 0.77, folate: 83, vitaminB6: 0.04, foodType: 'processed' },
  butter: { calories: 717, protein: 0.85, totalFat: 81.1, saturatedFat: 51.4, transFat: 3.3, carbohydrates: 0.06, sugar: 0.06, sodium: 643, potassium: 24, totalFibre: 0, vitaminA: 684, calcium: 24, foodType: 'dairy' },
  unsalted_butter: { calories: 717, protein: 0.85, totalFat: 81.1, saturatedFat: 51.4, transFat: 3.3, carbohydrates: 0.06, sugar: 0.06, sodium: 11, potassium: 24, totalFibre: 0, vitaminA: 684, calcium: 24, foodType: 'dairy' },
  whipped_butter: { calories: 717, protein: 0.85, totalFat: 81.1, saturatedFat: 51.4, transFat: 3.3, carbohydrates: 0.06, sugar: 0.06, sodium: 643, potassium: 24, totalFibre: 0, vitaminA: 684, calcium: 24, foodType: 'dairy' },
  raspberry: { calories: 52, protein: 1.2, totalFat: 0.65, saturatedFat: 0.02, transFat: 0, carbohydrates: 11.9, sugar: 4.42, sodium: 1, potassium: 151, totalFibre: 6.5, vitaminC: 26.2, vitaminA: 2, calcium: 25, magnesium: 22, iron: 0.69, zinc: 0.42, folate: 21, vitaminB6: 0.06, foodType: 'fruit' },
  cobb_salad: { calories: 145, protein: 11.2, totalFat: 10.5, saturatedFat: 3.2, transFat: 0, carbohydrates: 2.8, sugar: 1.6, sodium: 380, potassium: 310, totalFibre: 1.4, vitaminC: 9.5, vitaminA: 210, calcium: 75, magnesium: 24, iron: 1.4, zinc: 0.85, folate: 65, vitaminB6: 0.12, foodType: 'processed' },
  donut_malaysia_matcha: { calories: 426, protein: 5.7, totalFat: 22.9, saturatedFat: 5.8, transFat: 0, carbohydrates: 50.8, sugar: 26.7, sodium: 387, potassium: 115, totalFibre: 1.5, calcium: 87, foodType: 'processed' },
  tomat_dan_daun_bawang: { calories: 18, protein: 0.9, totalFat: 0.2, saturatedFat: 0, transFat: 0, carbohydrates: 3.9, sugar: 2.6, sodium: 5, potassium: 237, totalFibre: 1.2, vitaminC: 13.7, vitaminA: 42, calcium: 10, magnesium: 11, iron: 0.27, foodType: 'leafy_veg' },
  santan: { calories: 230, protein: 2.29, totalFat: 23.8, saturatedFat: 21.1, transFat: 0, carbohydrates: 5.5, sugar: 3.3, sodium: 15, potassium: 263, totalFibre: 2.2, calcium: 16, iron: 1.6, foodType: 'processed' },
  cooked_bacon: { calories: 541, protein: 37.0, totalFat: 42.0, saturatedFat: 14.0, transFat: 0, carbohydrates: 1.4, sugar: 0, sodium: 1717, potassium: 565, totalFibre: 0, foodType: 'processed' },
  mixed_fruit_cup: { calories: 50, protein: 0.6, totalFat: 0.2, saturatedFat: 0.02, transFat: 0, carbohydrates: 12.5, sugar: 9.8, sodium: 3, potassium: 160, totalFibre: 1.8, vitaminC: 25.0, vitaminA: 15, calcium: 12, magnesium: 10, iron: 0.3, zinc: 0.1, folate: 12, vitaminB6: 0.05, foodType: 'fruit' },
  falafel: { calories: 333, protein: 13.3, totalFat: 17.8, saturatedFat: 2.39, transFat: 0, carbohydrates: 31.8, sugar: 4.88, sodium: 294, potassium: 585, totalFibre: 4.9, foodType: 'legume' },
  hummus: { calories: 277, protein: 7.9, totalFat: 21.4, saturatedFat: 2.94, transFat: 0, carbohydrates: 15.6, sugar: 0, sodium: 395, potassium: 251, totalFibre: 6, foodType: 'processed' },
  feta_cheese: { calories: 264, protein: 14.21, totalFat: 21.28, saturatedFat: 14.94, transFat: 0, carbohydrates: 4.09, sugar: 4.09, sodium: 917, potassium: 62, totalFibre: 0, foodType: 'dairy' },
  raw_red_onion: { calories: 40, protein: 1.1, totalFat: 0.1, saturatedFat: 0.04, transFat: 0, carbohydrates: 9.34, sugar: 4.24, sodium: 4, potassium: 146, totalFibre: 1.7, foodType: 'veg' },
  raw_bell_pepper: { calories: 20, protein: 0.86, totalFat: 0.17, saturatedFat: 0.05, transFat: 0, carbohydrates: 4.64, sugar: 2.4, sodium: 3, potassium: 175, totalFibre: 1.7, foodType: 'veg' },
  sweet_bell_pepper: { calories: 31, protein: 0.99, totalFat: 0.30, saturatedFat: 0.03, transFat: 0, carbohydrates: 6.03, sugar: 4.20, sodium: 4, potassium: 211, totalFibre: 2.1, foodType: 'veg' },
  cucumber: { calories: 15, protein: 0.65, totalFat: 0.11, saturatedFat: 0.03, transFat: 0, carbohydrates: 3.63, sugar: 1.67, sodium: 2, potassium: 147, totalFibre: 0.5, vitaminC: 2.8, calcium: 16, foodType: 'leafy_veg' },
  chickpeas: { calories: 164, protein: 8.86, totalFat: 2.59, saturatedFat: 0.27, transFat: 0, carbohydrates: 27.42, sugar: 4.8, sodium: 24, potassium: 291, totalFibre: 7.6, iron: 2.89, calcium: 49, magnesium: 48, foodType: 'legume' },
  fried_ring_doughnut: { calories: 426, protein: 5.7, totalFat: 22.9, saturatedFat: 5.8, transFat: 0, carbohydrates: 50.8, sugar: 26.7, sodium: 387, potassium: 115, totalFibre: 1.5, calcium: 87, foodType: 'processed' },
  pomegranate_seeds_brand: { calories: 83, protein: 1.67, totalFat: 1.17, saturatedFat: 0.15, transFat: 0, carbohydrates: 18.7, sugar: 13.67, sodium: 3, potassium: 236, totalFibre: 4.0, vitaminC: 10.2, calcium: 10, foodType: 'fruit' },
  sainsbury_rolled_oats: { calories: 370, protein: 11.0, totalFat: 6.0, saturatedFat: 1.0, transFat: 0, carbohydrates: 60.0, sugar: 1.0, sodium: 10, potassium: 350, totalFibre: 9.0, foodType: 'grain' },

  tartar_sauce: { calories: 211, protein: 1.0, totalFat: 21.0, saturatedFat: 3.4, transFat: 0, carbohydrates: 4.4, sugar: 1.0, sodium: 730, potassium: 50, totalFibre: 1.0, foodType: 'ultra_processed' },
  wheat_flour: { calories: 364, protein: 10.33, totalFat: 0.98, saturatedFat: 0.15, transFat: 0, carbohydrates: 76.31, sugar: 0.27, sodium: 2, potassium: 107, totalFibre: 2.7, foodType: 'grain' },
  granulated_sugar: { calories: 387, protein: 0, totalFat: 0, saturatedFat: 0, transFat: 0, carbohydrates: 99.98, sugar: 99.9, sodium: 1, potassium: 2, totalFibre: 0, foodType: 'processed' },
  american_cheese: { calories: 330, protein: 18.0, totalFat: 27.0, saturatedFat: 17.0, transFat: 0, carbohydrates: 3.0, sugar: 2.0, sodium: 1500, potassium: 150, totalFibre: 0, calcium: 1045, iron: 0.6, magnesium: 26, phosphorus: 734, zinc: 2.7, selenium: 14.5, vitaminA: 322, vitaminB12: 1.4, folate: 10, vitaminB6: 0.08, vitaminC: 0.1, vitaminD: 0.6, vitaminE: 0.5, vitaminK: 2.5, iodine: 14, thiamine: 0.02, riboflavin: 0.3, niacin: 0.1, unsaturatedFat: 10.0, omega3: 0.2, foodType: 'dairy' },
  processed_cheese: { calories: 330, protein: 18.0, totalFat: 27.0, saturatedFat: 17.0, transFat: 0, carbohydrates: 3.0, sugar: 2.0, sodium: 1500, potassium: 150, totalFibre: 0, calcium: 1045, iron: 0.6, magnesium: 26, phosphorus: 734, zinc: 2.7, selenium: 14.5, vitaminA: 322, vitaminB12: 1.4, folate: 10, vitaminB6: 0.08, vitaminC: 0.1, vitaminD: 0.6, vitaminE: 0.5, vitaminK: 2.5, iodine: 14, thiamine: 0.02, riboflavin: 0.3, niacin: 0.1, unsaturatedFat: 10.0, omega3: 0.2, foodType: 'dairy' },
  mayonnaise: { calories: 680, protein: 1.0, totalFat: 75.0, saturatedFat: 12.0, transFat: 0, carbohydrates: 0.6, sugar: 0.6, sodium: 635, potassium: 20, totalFibre: 0, calcium: 8, iron: 0.2, magnesium: 1, phosphorus: 24, zinc: 0.1, selenium: 1.5, vitaminA: 10, vitaminB12: 0.1, folate: 4, vitaminB6: 0.01, vitaminC: 0.1, vitaminD: 0.1, vitaminE: 3.3, vitaminK: 163, iodine: 2, thiamine: 0.01, riboflavin: 0.01, niacin: 0.1, unsaturatedFat: 63.0, omega3: 5.0, foodType: 'ultra_processed' },
  crispy_onion: { calories: 590, protein: 5, totalFat: 43, saturatedFat: 17, transFat: 0, carbohydrates: 46, sugar: 9, sodium: 750, potassium: 150, totalFibre: 3.5, foodType: 'ultra_processed' },
  ranch_dressing: { calories: 430, protein: 1, totalFat: 46, saturatedFat: 7, transFat: 0, carbohydrates: 6, sugar: 3, sodium: 850, potassium: 75, totalFibre: 0, foodType: 'processed' },
  cheddar_cheese_cubes: { calories: 402, protein: 25, totalFat: 33, saturatedFat: 21, transFat: 0, carbohydrates: 1.3, sugar: 0.5, sodium: 621, potassium: 98, totalFibre: 0, calcium: 721, iron: 0.7, magnesium: 28, phosphorus: 512, zinc: 3.1, selenium: 14, vitaminA: 330, vitaminB12: 1.2, folate: 18, vitaminB6: 0.1, vitaminC: 0, vitaminD: 0.6, vitaminE: 0.3, vitaminK: 2.8, iodine: 15, thiamine: 0.03, riboflavin: 0.4, niacin: 0.1, unsaturatedFat: 12.0, omega3: 0.4, foodType: 'dairy' },
  gherkin: { calories: 14, protein: 0.5, totalFat: 0.2, saturatedFat: 0, transFat: 0, carbohydrates: 2.9, sugar: 1.4, sodium: 1208, potassium: 23, totalFibre: 1, calcium: 0, iron: 0, magnesium: 0, phosphorus: 0, zinc: 0, selenium: 0, vitaminA: 0, vitaminB12: 0, folate: 0, vitaminB6: 0, vitaminC: 0, vitaminD: 0, vitaminE: 0, vitaminK: 0, iodine: 0, thiamine: 0, riboflavin: 0, niacin: 0, unsaturatedFat: 0.2, omega3: 0, foodType: 'processed' },
  ketchup: { calories: 101, protein: 1.0, totalFat: 0.1, saturatedFat: 0, transFat: 0, carbohydrates: 27.4, sugar: 21.8, sodium: 907, potassium: 281, totalFibre: 0.3, calcium: 15, iron: 0.4, magnesium: 15, phosphorus: 30, zinc: 0.2, selenium: 0.5, vitaminA: 20, vitaminB12: 0.1, folate: 5, vitaminB6: 0.1, vitaminC: 4.0, vitaminD: 0.1, vitaminE: 1.4, vitaminK: 2.8, iodine: 0, thiamine: 0.01, riboflavin: 0.05, niacin: 1.4, unsaturatedFat: 0.1, omega3: 0.1, foodType: 'ultra_processed' },

  ice: { calories: 0, protein: 0, totalFat: 0, saturatedFat: 0, transFat: 0, carbohydrates: 0, sugar: 0, sodium: 0, potassium: 0, totalFibre: 0, foodType: 'unknown' },
  water: { calories: 0, protein: 0, totalFat: 0, saturatedFat: 0, transFat: 0, carbohydrates: 0, sugar: 0, sodium: 0, potassium: 0, totalFibre: 0, foodType: 'unknown' },
  coca_cola: { calories: 42, protein: 0, totalFat: 0, saturatedFat: 0, transFat: 0, carbohydrates: 10.6, sugar: 10.6, sodium: 10, potassium: 2, totalFibre: 0, foodType: 'processed' },
  soda_cola: { calories: 42, protein: 0, totalFat: 0, saturatedFat: 0, transFat: 0, carbohydrates: 10.6, sugar: 10.6, sodium: 10, potassium: 2, totalFibre: 0, foodType: 'processed' },
  cherry_tomato: { calories: 18, protein: 0.9, totalFat: 0.2, saturatedFat: 0, transFat: 0, carbohydrates: 3.9, sugar: 2.6, sodium: 5, potassium: 237, totalFibre: 1.2, vitaminC: 13.7, vitaminA: 42, calcium: 10, magnesium: 11, iron: 0.27, foodType: 'leafy_veg' },
  white_rice: { calories: 130, protein: 2.7, totalFat: 0.3, saturatedFat: 0.1, transFat: 0, carbohydrates: 28.2, sugar: 0.1, sodium: 1, potassium: 35, totalFibre: 0.4, calcium: 10, magnesium: 12, iron: 0.2, zinc: 0.49, foodType: 'grain' },
  rice_congee: { calories: 45, protein: 1.3, totalFat: 0.3, saturatedFat: 0.05, transFat: 0, carbohydrates: 9.5, sugar: 0.1, sodium: 5, potassium: 20, totalFibre: 0.2, calcium: 4, magnesium: 5, iron: 0.1, zinc: 0.2, foodType: 'grain' },
  seaweed_salad: { calories: 85, protein: 1.5, totalFat: 6.0, saturatedFat: 1.0, transFat: 0, carbohydrates: 8.5, sugar: 3.0, sodium: 650, potassium: 150, totalFibre: 1.5, calcium: 50, magnesium: 30, iron: 1.0, zinc: 0.3, foodType: 'prepared dish/entree' },
  fruit_jam: { calories: 250, protein: 0.4, totalFat: 0.1, saturatedFat: 0, transFat: 0, carbohydrates: 65.0, sugar: 49.0, sodium: 15, potassium: 75, totalFibre: 1.0, calcium: 15, magnesium: 5, iron: 0.2, zinc: 0.1, foodType: 'ultra_processed' },
  chicken_breast: { calories: 165, protein: 31.0, totalFat: 3.6, saturatedFat: 1.0, transFat: 0, carbohydrates: 0, sugar: 0, sodium: 74, potassium: 256, totalFibre: 0, calcium: 15, magnesium: 29, iron: 1.0, zinc: 1.0, foodType: 'poultry' },
  breaded_chicken_tender: { calories: 268, protein: 15.6, totalFat: 14.5, saturatedFat: 2.6, transFat: 0, carbohydrates: 18.7, sugar: 0.5, sodium: 604, potassium: 220, totalFibre: 1.2, foodType: 'poultry' },
  white_fish: { calories: 90, protein: 19.0, totalFat: 1.2, saturatedFat: 0.3, transFat: 0, carbohydrates: 0, sugar: 0, sodium: 80, potassium: 338, totalFibre: 0, calcium: 16, magnesium: 32, iron: 0.4, foodType: 'fish_lean' },
  watermelon: { calories: 30, protein: 0.6, totalFat: 0.2, saturatedFat: 0, transFat: 0, carbohydrates: 7.6, sugar: 6.2, sodium: 1, potassium: 112, totalFibre: 0.4, vitaminC: 8.1, vitaminA: 28, calcium: 7, magnesium: 10, foodType: 'fruit' },
  honeydew: { calories: 36, protein: 0.5, totalFat: 0.1, saturatedFat: 0, transFat: 0, carbohydrates: 9.1, sugar: 8.1, sodium: 18, potassium: 228, totalFibre: 0.8, vitaminC: 18, vitaminA: 3, calcium: 6, magnesium: 10, foodType: 'fruit' },
  margarine: { calories: 717, protein: 0.2, totalFat: 81.0, saturatedFat: 15.0, transFat: 2.0, carbohydrates: 0.7, sugar: 0, sodium: 700, potassium: 18, totalFibre: 0, foodType: 'processed' },
  bread_roll: { calories: 290, protein: 9.0, totalFat: 3.2, saturatedFat: 0.7, transFat: 0, carbohydrates: 49.0, sugar: 5.0, sodium: 490, potassium: 120, totalFibre: 2.4, foodType: 'grain' },
  sesame_seed: { calories: 573, protein: 17.7, totalFat: 49.7, saturatedFat: 7.0, transFat: 0, carbohydrates: 23.4, sugar: 0.3, sodium: 11, potassium: 468, totalFibre: 11.8, foodType: 'grain' },
  pomegranate_seed: { calories: 83, protein: 1.67, totalFat: 1.17, saturatedFat: 0.12, transFat: 0, carbohydrates: 18.7, sugar: 13.7, sodium: 3, potassium: 236, totalFibre: 4.0, vitaminC: 10.2, foodType: 'fruit' },
  sugar_syrup: { calories: 300, protein: 0, totalFat: 0, saturatedFat: 0, transFat: 0, carbohydrates: 77.0, sugar: 77.0, sodium: 30, potassium: 0, totalFibre: 0, foodType: 'ultra_processed' },
  citrus_juice: { calories: 45, protein: 0.2, totalFat: 0.1, saturatedFat: 0, transFat: 0, carbohydrates: 11.2, sugar: 10.5, sodium: 4, potassium: 200, totalFibre: 0.2, vitaminC: 50, foodType: 'fruit' },
  whole_cow_milk: { calories: 61, protein: 3.2, totalFat: 3.2, saturatedFat: 1.9, transFat: 0, carbohydrates: 4.8, sugar: 4.8, sodium: 43, potassium: 132, totalFibre: 0, calcium: 113, vitaminA: 46, foodType: 'dairy' },
  espresso: { calories: 9, protein: 0.1, totalFat: 0.18, saturatedFat: 0.09, transFat: 0, carbohydrates: 1.7, sugar: 0, sodium: 14, potassium: 115, totalFibre: 0, foodType: 'processed' },
  peppermint_patty: { calories: 384, protein: 2.19, totalFat: 7.17, saturatedFat: 4.34, transFat: 0, carbohydrates: 70, sugar: 50, sodium: 28, potassium: 40, totalFibre: 2, foodType: 'ultra_processed' },
  peppermint_fondant: { calories: 373, protein: 0.1, totalFat: 0.1, saturatedFat: 0.1, transFat: 0, carbohydrates: 93, sugar: 93, sodium: 11, potassium: 5, totalFibre: 0, foodType: 'ultra_processed' },
  grapes: { calories: 69, protein: 0.72, totalFat: 0.16, saturatedFat: 0.05, transFat: 0, carbohydrates: 18.1, sugar: 15.5, sodium: 2, potassium: 191, totalFibre: 0.9, vitaminC: 3.2, vitaminA: 3, calcium: 10, magnesium: 7, iron: 0.36, zinc: 0.07, folate: 2, vitaminB6: 0.09, foodType: 'fruit' },
  banana: { calories: 89, protein: 1.09, totalFat: 0.33, saturatedFat: 0.11, transFat: 0, carbohydrates: 22.8, sugar: 12.2, sodium: 1, potassium: 358, totalFibre: 2.6, vitaminC: 8.7, vitaminA: 3, calcium: 5, magnesium: 27, iron: 0.26, zinc: 0.15, folate: 20, vitaminB6: 0.37, foodType: 'fruit' },
  nectarine: { calories: 44, protein: 1.06, totalFat: 0.32, saturatedFat: 0.03, transFat: 0, carbohydrates: 10.6, sugar: 7.89, sodium: 0, potassium: 201, totalFibre: 1.7, vitaminC: 5.4, vitaminA: 17, calcium: 6, magnesium: 9, iron: 0.28, zinc: 0.17, folate: 5, vitaminB6: 0.02, foodType: 'fruit' },
  tangerine: { calories: 53, protein: 0.81, totalFat: 0.31, saturatedFat: 0.04, transFat: 0, carbohydrates: 13.3, sugar: 10.6, sodium: 2, potassium: 166, totalFibre: 1.8, vitaminC: 26.7, vitaminA: 34, calcium: 37, magnesium: 12, iron: 0.15, zinc: 0.07, folate: 16, vitaminB6: 0.08, foodType: 'fruit' },
  apple: { calories: 52, protein: 0.26, totalFat: 0.17, saturatedFat: 0.03, transFat: 0, carbohydrates: 13.8, sugar: 10.4, sodium: 1, potassium: 107, totalFibre: 2.4, vitaminC: 4.6, vitaminA: 3, calcium: 6, magnesium: 5, iron: 0.12, zinc: 0.04, folate: 3, vitaminB6: 0.04, foodType: 'fruit' },
  orange: { calories: 47, protein: 0.94, totalFat: 0.12, saturatedFat: 0.02, transFat: 0, carbohydrates: 11.8, sugar: 9.35, sodium: 0, potassium: 181, totalFibre: 2.4, vitaminC: 53.2, vitaminA: 11, calcium: 40, magnesium: 10, iron: 0.1, zinc: 0.07, folate: 30, vitaminB6: 0.06, foodType: 'fruit' },
  peach: { calories: 39, protein: 0.91, totalFat: 0.25, saturatedFat: 0.04, transFat: 0, carbohydrates: 9.54, sugar: 8.39, sodium: 0, potassium: 190, totalFibre: 1.5, vitaminC: 6.6, vitaminA: 16, calcium: 6, magnesium: 9, iron: 0.25, zinc: 0.17, folate: 4, vitaminB6: 0.03, foodType: 'fruit' },
  strawberry: { calories: 32, protein: 0.67, totalFat: 0.30, saturatedFat: 0.02, transFat: 0, carbohydrates: 7.68, sugar: 4.89, sodium: 1, potassium: 153, totalFibre: 2.0, vitaminC: 58.8, vitaminA: 1, calcium: 16, magnesium: 13, iron: 0.41, zinc: 0.14, folate: 24, vitaminB6: 0.05, foodType: 'fruit' },
  blueberry: { calories: 57, protein: 0.74, totalFat: 0.33, saturatedFat: 0.03, transFat: 0, carbohydrates: 14.5, sugar: 9.96, sodium: 1, potassium: 77, totalFibre: 2.4, vitaminC: 9.7, vitaminA: 3, calcium: 6, magnesium: 6, iron: 0.28, zinc: 0.16, folate: 6, vitaminB6: 0.05, foodType: 'fruit' },
  pear: { calories: 57, protein: 0.36, totalFat: 0.14, saturatedFat: 0.01, transFat: 0, carbohydrates: 15.2, sugar: 9.8, sodium: 1, potassium: 116, totalFibre: 3.1, vitaminC: 4.3, vitaminA: 1, calcium: 9, magnesium: 7, iron: 0.18, zinc: 0.1, folate: 7, vitaminB6: 0.03, foodType: 'fruit' },
  rolled_oats: { calories: 379, protein: 13.2, totalFat: 6.5, saturatedFat: 1.1, transFat: 0, carbohydrates: 67.7, sugar: 0.99, sodium: 2, potassium: 362, totalFibre: 10.1, calcium: 52, magnesium: 138, iron: 4.25, zinc: 3.64, foodType: "grain" },
  plum: { calories: 46, protein: 0.70, totalFat: 0.28, saturatedFat: 0.02, transFat: 0, carbohydrates: 11.4, sugar: 9.9, sodium: 0, potassium: 157, totalFibre: 1.4, vitaminC: 9.5, vitaminA: 17, calcium: 6, magnesium: 7, iron: 0.17, zinc: 0.1, folate: 5, vitaminB6: 0.03, foodType: 'fruit' },
  kiwi: { calories: 61, protein: 1.14, totalFat: 0.52, saturatedFat: 0.03, transFat: 0, carbohydrates: 14.7, sugar: 9.0, sodium: 3, potassium: 312, totalFibre: 3.0, vitaminC: 92.7, vitaminA: 4, calcium: 34, magnesium: 17, iron: 0.31, zinc: 0.14, folate: 25, vitaminB6: 0.06, foodType: 'fruit' },
  pineapple: { calories: 50, protein: 0.54, totalFat: 0.12, saturatedFat: 0.01, transFat: 0, carbohydrates: 13.1, sugar: 9.85, sodium: 1, potassium: 109, totalFibre: 1.4, vitaminC: 47.8, vitaminA: 3, calcium: 13, magnesium: 12, iron: 0.29, zinc: 0.12, folate: 18, vitaminB6: 0.11, foodType: 'fruit' },
  mango: { calories: 60, protein: 0.82, totalFat: 0.38, saturatedFat: 0.09, transFat: 0, carbohydrates: 15.0, sugar: 13.7, sodium: 1, potassium: 168, totalFibre: 1.6, vitaminC: 36.4, vitaminA: 54, calcium: 11, magnesium: 10, iron: 0.16, zinc: 0.09, folate: 43, vitaminB6: 0.12, foodType: 'fruit' },
  avocado: { calories: 160, protein: 2.0, totalFat: 14.7, saturatedFat: 2.13, transFat: 0, carbohydrates: 8.53, sugar: 0.66, sodium: 7, potassium: 485, totalFibre: 6.7, vitaminC: 10, vitaminA: 7, calcium: 12, magnesium: 29, iron: 0.55, zinc: 0.64, folate: 81, vitaminE: 2.07, vitaminK: 21, foodType: 'fruit' },
  salmon: { calories: 208, protein: 20.4, totalFat: 13.4, saturatedFat: 3.1, transFat: 0, carbohydrates: 0, sugar: 0, sodium: 59, potassium: 363, totalFibre: 0, vitaminD: 525, vitaminB12: 3.2, calcium: 10, magnesium: 27, iron: 0.4, zinc: 0.5, selenium: 36, phosphorus: 250, foodType: 'fish_fatty' },
  grilled_salmon: { calories: 220, protein: 24.6, totalFat: 12.3, saturatedFat: 2.8, transFat: 0, carbohydrates: 0, sugar: 0, sodium: 65, potassium: 384, totalFibre: 0, vitaminD: 525, vitaminB12: 3.2, calcium: 10, magnesium: 27, iron: 0.4, zinc: 0.5, selenium: 36, phosphorus: 250, foodType: 'fish_fatty' },
  macaroni_and_cheese: { calories: 200, protein: 6.8, totalFat: 9.2, saturatedFat: 4.8, transFat: 0, carbohydrates: 22.5, sugar: 2.0, sodium: 410, potassium: 90, totalFibre: 1.2, calcium: 120, iron: 1.1, magnesium: 18, phosphorus: 140, zinc: 0.85, selenium: 14.5, vitaminA: 65, vitaminB12: 0.35, folate: 45, vitaminB6: 0.05, vitaminC: 0.1, vitaminD: 0.1, vitaminE: 0.2, vitaminK: 1.5, iodine: 5, thiamine: 0.1, riboflavin: 0.1, niacin: 1.0, unsaturatedFat: 4.4, omega3: 0.1, foodType: 'processed' },
  cheddar_cheese_sauce: { calories: 210, protein: 7.5, totalFat: 16.0, saturatedFat: 9.5, transFat: 0, carbohydrates: 8.0, sugar: 2.5, sodium: 800, potassium: 110, totalFibre: 0.3, calcium: 180, iron: 0.3, magnesium: 15, phosphorus: 180, zinc: 1.1, vitaminA: 110, vitaminB12: 0.4, folate: 10, vitaminB6: 0.05, vitaminC: 0.1, vitaminD: 0.2, vitaminE: 0.3, vitaminK: 2.0, iodine: 10, thiamine: 0.1, riboflavin: 0.1, niacin: 0.5, unsaturatedFat: 6.5, omega3: 0.2, foodType: 'dairy' },
  macaroni_pasta: { calories: 158, protein: 5.8, totalFat: 0.9, saturatedFat: 0.2, transFat: 0, carbohydrates: 31.0, sugar: 0.6, sodium: 1, potassium: 44, totalFibre: 1.8, calcium: 7, iron: 1.3, magnesium: 18, phosphorus: 58, zinc: 0.51, selenium: 26.4, folate: 49, vitaminA: 1, vitaminB12: 0.01, vitaminB6: 0.05, vitaminC: 0.1, vitaminD: 0.01, vitaminE: 0.1, vitaminK: 0.1, iodine: 1, thiamine: 0.2, riboflavin: 0.1, niacin: 1.2, unsaturatedFat: 0.7, omega3: 0.05, foodType: 'grain' },
  romaine_lettuce: { calories: 17, protein: 1.2, totalFat: 0.3, saturatedFat: 0.04, transFat: 0, carbohydrates: 3.3, sugar: 1.2, sodium: 8, potassium: 247, totalFibre: 2.1, vitaminC: 4.0, vitaminA: 436, calcium: 33, folate: 136, foodType: 'leafy_veg' },
  surimi_crab_stick: { calories: 99, protein: 12.0, totalFat: 0.9, saturatedFat: 0.1, transFat: 0, carbohydrates: 15.0, sugar: 6.2, sodium: 841, potassium: 90, totalFibre: 0, calcium: 13, iron: 0.4, foodType: 'shellfish' },
  quinoa: { calories: 120, protein: 4.4, totalFat: 1.9, saturatedFat: 0.2, transFat: 0, carbohydrates: 21.3, sugar: 0.9, sodium: 7, potassium: 172, totalFibre: 2.8, calcium: 17, iron: 1.5, magnesium: 64, foodType: 'grain' },
  edamame: { calories: 121, protein: 11.9, totalFat: 5.2, saturatedFat: 0.6, transFat: 0, carbohydrates: 8.9, sugar: 2.2, sodium: 6, potassium: 436, totalFibre: 5.2, calcium: 63, iron: 2.3, magnesium: 64, foodType: 'vegetable' },
  cabbage_slaw: { calories: 35, protein: 1.2, totalFat: 0.2, saturatedFat: 0.03, transFat: 0, carbohydrates: 7.5, sugar: 3.8, sodium: 22, potassium: 170, totalFibre: 2.4, vitaminC: 30, calcium: 35, iron: 0.5, foodType: 'vegetable' },
  mcdonalds_mcchicken_sandwich: { calories: 225, protein: 8.67, totalFat: 10.0, saturatedFat: 1.7, transFat: 0, carbohydrates: 25.0, sugar: 2.7, sodium: 324, potassium: 120, totalFibre: 1.2, foodType: 'ultra_processed' },
  hard_boiled_egg: { calories: 155, protein: 12.6, totalFat: 10.6, saturatedFat: 3.3, transFat: 0, carbohydrates: 1.1, sugar: 1.1, sodium: 124, potassium: 126, totalFibre: 0, foodType: 'egg' },
  plain_greek_yogurt: { calories: 97, protein: 9.0, totalFat: 5.0, saturatedFat: 2.3, transFat: 0, carbohydrates: 3.9, sugar: 3.6, sodium: 47, potassium: 141, totalFibre: 0, foodType: 'dairy' },
  granola_cereal: { calories: 471, protein: 10.0, totalFat: 20.0, saturatedFat: 3.5, transFat: 0, carbohydrates: 64.0, sugar: 29.0, sodium: 290, potassium: 336, totalFibre: 5.0, foodType: 'grain' },
  flour_tortilla: { calories: 304, protein: 8.5, totalFat: 7.7, saturatedFat: 1.8, transFat: 0, carbohydrates: 49.7, sugar: 2.3, sodium: 521, potassium: 121, totalFibre: 2.4, foodType: 'grain' },
  mixed_salad_greens: { calories: 20, protein: 1.5, totalFat: 0.2, saturatedFat: 0.04, transFat: 0, carbohydrates: 3.6, sugar: 1.2, sodium: 20, potassium: 250, totalFibre: 2.2, foodType: 'leafy_veg' },
  chocolate_brownie: { calories: 466, protein: 5.5, totalFat: 23.0, saturatedFat: 8.0, transFat: 0, carbohydrates: 62.0, sugar: 40.0, sodium: 300, potassium: 200, totalFibre: 3.5, foodType: 'processed' },
  brownie: { calories: 466, protein: 5.5, totalFat: 23.0, saturatedFat: 8.0, transFat: 0, carbohydrates: 62.0, sugar: 40.0, sodium: 300, potassium: 200, totalFibre: 3.5, foodType: 'processed' },
  fudge_brownie: { calories: 466, protein: 5.5, totalFat: 23.0, saturatedFat: 8.0, transFat: 0, carbohydrates: 62.0, sugar: 40.0, sodium: 300, potassium: 200, totalFibre: 3.5, foodType: 'processed' },
  dark_chocolate: { calories: 546, protein: 4.9, totalFat: 31.0, saturatedFat: 19.0, transFat: 0, carbohydrates: 61.0, sugar: 48.0, sodium: 24, potassium: 559, totalFibre: 7.0, foodType: 'processed' },
  dark_chocolate_chunk: { calories: 546, protein: 4.9, totalFat: 31.0, saturatedFat: 19.0, transFat: 0, carbohydrates: 61.0, sugar: 48.0, sodium: 24, potassium: 559, totalFibre: 7.0, foodType: 'processed' },
  chocolate_chunk: { calories: 546, protein: 4.9, totalFat: 31.0, saturatedFat: 19.0, transFat: 0, carbohydrates: 61.0, sugar: 48.0, sodium: 24, potassium: 559, totalFibre: 7.0, foodType: 'processed' },
  chocolate_chip_cookie: { calories: 488, protein: 5.5, totalFat: 24.0, saturatedFat: 11.0, transFat: 0, carbohydrates: 64.0, sugar: 38.0, sodium: 350, potassium: 180, totalFibre: 2.5, foodType: 'processed' },
  chocolate_cake: { calories: 389, protein: 4.5, totalFat: 18.0, saturatedFat: 5.5, transFat: 0, carbohydrates: 53.0, sugar: 36.0, sodium: 320, potassium: 160, totalFibre: 2.0, foodType: 'processed' },
  sweet_chilli_sauce: { calories: 190, protein: 0.4, totalFat: 0.2, saturatedFat: 0.0, transFat: 0, carbohydrates: 46.9, sugar: 40.0, sodium: 1240, potassium: 50, totalFibre: 0.5, foodType: 'ultra_processed' },
  kalamata_olives: { calories: 115, protein: 0.8, totalFat: 10.7, saturatedFat: 1.4, transFat: 0, carbohydrates: 6.3, sugar: 0, sodium: 735, potassium: 42, totalFibre: 3.2, foodType: 'processed' },
  balsamic_dressing: { calories: 238, protein: 0.1, totalFat: 19.3, saturatedFat: 2.8, transFat: 0, carbohydrates: 17.0, sugar: 14.2, sodium: 610, potassium: 25, totalFibre: 0, foodType: 'ultra_processed' },
  mixed_vegetables: { calories: 65, protein: 2.6, totalFat: 0.2, saturatedFat: 0.05, transFat: 0, carbohydrates: 14.1, sugar: 4.0, sodium: 42, potassium: 230, totalFibre: 4.1, foodType: 'veg' },
  cooked_prawns: { calories: 99, protein: 24.0, totalFat: 0.3, saturatedFat: 0.08, transFat: 0, carbohydrates: 0.2, sugar: 0, sodium: 111, potassium: 220, totalFibre: 0, foodType: 'shellfish' },
  marie_rose_sauce: { calories: 320, protein: 1.0, totalFat: 30.0, saturatedFat: 4.5, transFat: 0, carbohydrates: 10.0, sugar: 8.0, sodium: 700, potassium: 40, totalFibre: 0, foodType: 'ultra_processed' },
  chicken_sandwich: { calories: 230, protein: 12.5, totalFat: 10.2, saturatedFat: 2.1, transFat: 0.1, carbohydrates: 22.0, sugar: 2.5, sodium: 450, potassium: 180, totalFibre: 1.5, foodType: 'poultry' },
  steak_sandwich: { calories: 240, protein: 13.5, totalFat: 12.0, saturatedFat: 4.5, transFat: 0.2, carbohydrates: 19.5, sugar: 2.0, sodium: 480, potassium: 200, totalFibre: 1.2, foodType: 'red_meat' },
  beef_burger: { calories: 250, protein: 13.0, totalFat: 13.5, saturatedFat: 5.0, transFat: 0.5, carbohydrates: 19.0, sugar: 3.0, sodium: 460, potassium: 210, totalFibre: 1.2, foodType: 'red_meat' },
  tuna_sandwich: { calories: 210, protein: 13.0, totalFat: 8.5, saturatedFat: 1.5, transFat: 0, carbohydrates: 20.0, sugar: 2.0, sodium: 420, potassium: 190, totalFibre: 1.5, foodType: 'fish_fatty' },
  egg_sandwich: { calories: 220, protein: 10.5, totalFat: 11.0, saturatedFat: 2.8, transFat: 0, carbohydrates: 20.0, sugar: 2.5, sodium: 430, potassium: 160, totalFibre: 1.5, foodType: 'egg' },
  chicken_wrap: { calories: 215, protein: 12.0, totalFat: 8.5, saturatedFat: 2.0, transFat: 0.1, carbohydrates: 23.0, sugar: 2.0, sodium: 460, potassium: 170, totalFibre: 1.8, foodType: 'poultry' },
  serrano_ham: { calories: 235, protein: 22.0, totalFat: 15.0, saturatedFat: 5.5, transFat: 0, carbohydrates: 1.0, sugar: 0, sodium: 1200, potassium: 300, totalFibre: 0, foodType: 'processed' },
  mixed_berries: { calories: 45, protein: 0.7, totalFat: 0.3, saturatedFat: 0.02, transFat: 0, carbohydrates: 11.0, sugar: 7.0, sodium: 1, potassium: 120, totalFibre: 2.5, foodType: 'fruit' },
  low_fat_yogurt: { calories: 63, protein: 5.25, totalFat: 1.55, saturatedFat: 1.0, transFat: 0, carbohydrates: 7.04, sugar: 7.04, sodium: 70, potassium: 230, totalFibre: 0, foodType: 'dairy' },
  cooked_mushrooms: { calories: 28, protein: 2.2, totalFat: 0.5, saturatedFat: 0.1, transFat: 0, carbohydrates: 4.4, sugar: 2.0, sodium: 4, potassium: 356, totalFibre: 2.2, foodType: 'leafy_veg' },
  mushrooms: { calories: 28, protein: 2.2, totalFat: 0.5, saturatedFat: 0.1, transFat: 0, carbohydrates: 4.4, sugar: 2.0, sodium: 4, potassium: 356, totalFibre: 2.2, foodType: 'leafy_veg' },
  bok_choy: { calories: 13, protein: 1.5, totalFat: 0.2, saturatedFat: 0.03, transFat: 0, carbohydrates: 2.18, sugar: 1.18, sodium: 65, potassium: 252, totalFibre: 1.0, vitaminC: 45, vitaminA: 223, calcium: 105, magnesium: 19, iron: 0.8, foodType: 'leafy_veg' },
  raw_beef_cut: { calories: 217, protein: 26.1, totalFat: 11.8, saturatedFat: 4.6, transFat: 0.5, carbohydrates: 0, sugar: 0, sodium: 55, potassium: 318, totalFibre: 0, iron: 2.6, zinc: 5.8, magnesium: 21, phosphorus: 200, foodType: 'red_meat' },
  sea_salt: { calories: 0, protein: 0, totalFat: 0, saturatedFat: 0, transFat: 0, carbohydrates: 0, sugar: 0, sodium: 38758, potassium: 8, totalFibre: 0, foodType: 'processed' }
};

export function lookupCanonicalBaseFood(name: string): any | null {
  const resolve = (row: any | null | undefined) => {
    if (!row) return null;
    const key = (Object.keys(CANONICAL_BASE_FOODS) as string[]).find((k) => CANONICAL_BASE_FOODS[k] === row) || '';
    return { ...row, id: key };
  };

  const normalized = name.toLowerCase().trim();
  if (normalized.includes('chicken') && (normalized.includes('sandwich') || normalized.includes('sub') || normalized.includes('bap') || normalized.includes('bun') || normalized.includes('bagel') || normalized.includes('toastie'))) return resolve(CANONICAL_BASE_FOODS.chicken_sandwich);
  if ((normalized.includes('steak') || normalized.includes('beef')) && (normalized.includes('sandwich') || normalized.includes('sub') || normalized.includes('bap') || normalized.includes('toastie'))) return resolve(CANONICAL_BASE_FOODS.steak_sandwich);
  if (normalized.includes('tuna') && (normalized.includes('sandwich') || normalized.includes('melt') || normalized.includes('sub') || normalized.includes('wrap'))) return resolve(CANONICAL_BASE_FOODS.tuna_sandwich);
  if (normalized.includes('egg') && (normalized.includes('sandwich') || normalized.includes('mayo sandwich') || normalized.includes('sub') || normalized.includes('bap'))) return resolve(CANONICAL_BASE_FOODS.egg_sandwich);
  if (normalized.includes('chicken') && normalized.includes('wrap')) return resolve(CANONICAL_BASE_FOODS.chicken_wrap);
  if (normalized.includes('burger') || normalized.includes('cheeseburger')) return resolve(CANONICAL_BASE_FOODS.beef_burger);
  if (normalized.includes('sweet chilli') || normalized.includes('sweet chili') || normalized.includes('chilli sauce') || normalized.includes('chili sauce')) return resolve(CANONICAL_BASE_FOODS.sweet_chilli_sauce);
  if (normalized.includes('kalamata') || normalized.includes('olive')) return resolve(CANONICAL_BASE_FOODS.kalamata_olives);
  if (normalized.includes('balsamic')) return resolve(CANONICAL_BASE_FOODS.balsamic_dressing);
  if (normalized.includes('marie rose') || normalized.includes('rose sauce')) return resolve(CANONICAL_BASE_FOODS.marie_rose_sauce);
  if (normalized.includes('serrano') || normalized.includes('cured ham') || normalized.includes('cooked ham') || normalized === 'ham') return resolve(CANONICAL_BASE_FOODS.serrano_ham);
  if (normalized.includes('strawberry') || normalized.includes('strawberries')) return resolve(CANONICAL_BASE_FOODS.strawberry);
  if (normalized.includes('blueberry') || normalized.includes('blueberries')) return resolve(CANONICAL_BASE_FOODS.blueberry);
  if (normalized.includes('raspberry') || normalized.includes('raspberries')) return resolve(CANONICAL_BASE_FOODS.raspberry);
  if (normalized.includes('mixed berries fruit compote')) return resolve(CANONICAL_BASE_FOODS.strawberry);
  if (normalized.includes('mixed berries') || normalized.includes('berry') || normalized.includes('berries')) return resolve(CANONICAL_BASE_FOODS.mixed_berries);
  if (normalized.includes('low fat yogurt') || normalized.includes('low-fat yogurt') || normalized.includes('low fat yoghurt')) return resolve(CANONICAL_BASE_FOODS.low_fat_yogurt);
  if (normalized.includes('sea salt') || normalized === 'salt') return resolve(CANONICAL_BASE_FOODS.sea_salt);
  if (normalized.includes('cooked pasta') || normalized === 'pasta') return resolve(CANONICAL_BASE_FOODS.macaroni_pasta);
  if (normalized.includes('mixed veg') || normalized === 'vegetables') return resolve(CANONICAL_BASE_FOODS.mixed_vegetables);
  if (normalized.includes('prawn') || normalized.includes('prawns') || normalized.includes('shrimp')) return resolve(CANONICAL_BASE_FOODS.cooked_prawns);

  if (normalized.includes('cobb salad') || (normalized.includes('cobb') && normalized.includes('salad'))) return resolve(CANONICAL_BASE_FOODS.cobb_salad);
  if (normalized.includes('bacon')) return resolve(CANONICAL_BASE_FOODS.cooked_bacon);
  if (normalized.includes('crispy onion') || normalized.includes('fried onion')) return resolve(CANONICAL_BASE_FOODS.crispy_onion);
  if (normalized.includes('ranch dressing') || normalized.includes('ranch')) return resolve(CANONICAL_BASE_FOODS.ranch_dressing);
  if (normalized.includes('cheddar cheese cube') || (normalized.includes('cheddar') && normalized.includes('cube'))) return resolve(CANONICAL_BASE_FOODS.cheddar_cheese_cubes);
  if (normalized.includes('gherkin') || normalized.includes('pickle')) return resolve(CANONICAL_BASE_FOODS.gherkin);
  if (normalized.includes('fruit cup') || normalized.includes('fruit salad') || (normalized.includes('mixed') && normalized.includes('fruit'))) return resolve(CANONICAL_BASE_FOODS.mixed_fruit_cup);
  if (normalized.includes('raspberry') || normalized.includes('raspberries')) return resolve(CANONICAL_BASE_FOODS.raspberry);
  if (normalized.includes('plain yogurt') || normalized.includes('plain yoghurt')) return resolve(CANONICAL_BASE_FOODS.plain_yogurt);
  
  if (normalized.includes('sainsbury') && normalized.includes('oat')) return resolve(CANONICAL_BASE_FOODS.sainsbury_rolled_oats);

  if (normalized.includes('pomegranate seed') || normalized.includes('pomegranate seeds')) return resolve(CANONICAL_BASE_FOODS.pomegranate_seeds_brand);

  if (normalized.includes('cucumber')) return resolve(CANONICAL_BASE_FOODS.cucumber);

  if (normalized.includes('chickpea') || normalized.includes('garbanzo')) return resolve(CANONICAL_BASE_FOODS.chickpeas);

  if (normalized.includes('doughnut') || normalized.includes('donut')) return resolve(CANONICAL_BASE_FOODS.fried_ring_doughnut);

  // Specific compound pastries & baked goods (checked before single-ingredient keywords)
  if (normalized.includes('pain au raisin') || normalized.includes('pain aux raisins') || normalized.includes('escargot pastry') || (normalized.includes('raisin') && (normalized.includes('pastry') || normalized.includes('swirl') || normalized.includes('danish') || normalized.includes('roll') || normalized.includes('bun')))) {
    return resolve(CANONICAL_BASE_FOODS.pain_au_raisin);
  }
  if (normalized.includes('pain au chocolat') || normalized.includes('chocolatine') || (normalized.includes('chocolate') && normalized.includes('croissant'))) {
    return resolve(CANONICAL_BASE_FOODS.pain_au_chocolat);
  }
  if (normalized.includes('almond croissant') || (normalized.includes('almond') && (normalized.includes('croissant') || normalized.includes('pastry')))) {
    return resolve(CANONICAL_BASE_FOODS.almond_croissant);
  }
  if (normalized.includes('cinnamon swirl') || normalized.includes('cinnamon roll') || normalized.includes('cinnamon bun') || normalized.includes('cinnamon pastry')) {
    return resolve(CANONICAL_BASE_FOODS.cinnamon_swirl);
  }
  if (normalized.includes('apple turnover') || normalized.includes('chausson aux pommes') || (normalized.includes('apple') && normalized.includes('turnover'))) {
    return resolve(CANONICAL_BASE_FOODS.apple_turnover);
  }
  if (normalized.includes('danish pastry') || (normalized.includes('danish') && !normalized.includes('cheese') && !normalized.includes('ham'))) {
    return resolve(CANONICAL_BASE_FOODS.danish_pastry);
  }
  if (normalized.includes('raisin bread') || normalized.includes('raisin toast') || normalized.includes('raisin bagel')) {
    return resolve(CANONICAL_BASE_FOODS.raisin_bread);
  }

  const isBakedOrCompositeContext = /\b(bread|toast|bagel|muffin|bran|cookie|scone|cereal|pastry|swirl|cake|roll|bun|pie|tart|loaf|croissant|flour|milk|butter)\b/i.test(normalized);

  if (!isBakedOrCompositeContext && normalized.includes('raisin')) {
    return resolve(CANONICAL_BASE_FOODS.raisins);
  }
  
  if (!isBakedOrCompositeContext && normalized.includes('almond')) {
    return resolve(CANONICAL_BASE_FOODS.almonds);
  }
  
  if (normalized.includes('croissant')) return resolve(CANONICAL_BASE_FOODS.croissant);

  if (normalized.includes('unsalted butter') || normalized.includes('unsalted_butter')) return resolve(CANONICAL_BASE_FOODS.unsalted_butter);
  if (normalized.includes('whipped butter') || normalized.includes('whipped_butter')) return resolve(CANONICAL_BASE_FOODS.whipped_butter);
  if (normalized.includes('butter') && !normalized.includes('peanut') && !normalized.includes('almond') && !normalized.includes('apple') && !normalized.includes('cookie') && !normalized.includes('milk') && !normalized.includes('squash') && !normalized.includes('fly')) return resolve(CANONICAL_BASE_FOODS.butter);
  
  if (normalized.includes('falafel')) return resolve(CANONICAL_BASE_FOODS.falafel);
  
  if (normalized.includes('hummus')) return resolve(CANONICAL_BASE_FOODS.hummus);
  
  if (normalized.includes('feta cheese')) return resolve(CANONICAL_BASE_FOODS.feta_cheese);
  
  if (normalized.includes('red onion')) return resolve(CANONICAL_BASE_FOODS.raw_red_onion);
  
  if (normalized === 'raw bell pepper') return resolve(CANONICAL_BASE_FOODS.raw_bell_pepper);
  if (normalized.includes('bell pepper') || normalized.includes('sweet pepper')) return resolve(CANONICAL_BASE_FOODS.sweet_bell_pepper);

  if (!name) return null;
  let clean = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  if (name.includes(',')) {
    const parts = name.toLowerCase().split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      clean = parts.reverse().join('_').replace(/[^a-z0-9]/g, '_');
    }
  }
  const tokens = clean.split('_').filter(Boolean);
  if (clean.includes('egg') || clean.includes('hard_boiled')) {
    if (clean.includes('boiled') || clean.includes('cook') || clean.includes('whole') || clean.includes('hard')) {
      return resolve(CANONICAL_BASE_FOODS.hard_boiled_egg);
    }
  }
  if (clean.includes('greek_yogurt') || clean.includes('plain_greek') || (clean.includes('yogurt') && clean.includes('greek'))) return resolve(CANONICAL_BASE_FOODS.plain_greek_yogurt);
  if (clean.includes('granola')) return resolve(CANONICAL_BASE_FOODS.granola_cereal);
  if (clean.includes('tortilla')) return resolve(CANONICAL_BASE_FOODS.flour_tortilla);
  if (clean.includes('salad_greens') || clean.includes('salad_leaves') || (clean.includes('salad') && clean.includes('mixed'))) return resolve(CANONICAL_BASE_FOODS.mixed_salad_greens);
  if (clean.includes('surimi') || clean.includes('crab_stick') || (clean.includes('crab') && clean.includes('stick')) || clean.includes('imitation_crab')) return resolve(CANONICAL_BASE_FOODS.surimi_crab_stick);
  if (clean.includes('edamame')) return resolve(CANONICAL_BASE_FOODS.edamame);
  if (clean.includes('quinoa')) return resolve(CANONICAL_BASE_FOODS.quinoa);
  if (clean.includes('slaw') || clean.includes('cabbage') || clean.includes('coleslaw')) return resolve(CANONICAL_BASE_FOODS.cabbage_slaw);
  if (clean.includes('mcchicken') || (clean.includes('mcdonald') && clean.includes('chicken'))) return resolve(CANONICAL_BASE_FOODS.mcdonalds_mcchicken_sandwich);
  if (clean.includes('avocado') && !clean.includes('oil')) return resolve(CANONICAL_BASE_FOODS.avocado);
  if (clean.includes('chocolate') || clean.includes('dark_chocolate')) return resolve(CANONICAL_BASE_FOODS.dark_chocolate);
  if (clean.includes('flour') || clean.includes('wheat_flour')) return resolve(CANONICAL_BASE_FOODS.wheat_flour);
  if (clean.includes('sugar') && !clean.includes('syrup')) return resolve(CANONICAL_BASE_FOODS.granulated_sugar);
  if (clean.includes('salmon') && !clean.includes('bap') && !clean.includes('sandwich') && !clean.includes('sushi') && !clean.includes('roll')) {
    if (clean.includes('grill') || clean.includes('cook') || clean.includes('roast') || clean.includes('bake')) {
      return resolve(CANONICAL_BASE_FOODS.grilled_salmon);
    }
    return resolve(CANONICAL_BASE_FOODS.salmon);
  }
  if (clean.includes('cheddar_cheese_sauce') || (clean.includes('cheese') && clean.includes('sauce'))) return resolve(CANONICAL_BASE_FOODS.cheddar_cheese_sauce);
  if (clean.includes('macaroni_and_cheese') || clean.includes('mac_and_cheese') || clean.includes('mac_n_cheese') || clean.includes('macaroni_cheese')) return resolve(CANONICAL_BASE_FOODS.macaroni_and_cheese);
  if (clean.includes('macaroni') || clean.includes('elbow_pasta')) return resolve(CANONICAL_BASE_FOODS.macaroni_pasta);
  if (clean.includes('lettuce') || clean.includes('romaine')) return resolve(CANONICAL_BASE_FOODS.romaine_lettuce);
  if (clean.includes('bok_choy') || clean.includes('pak_choi') || clean.includes('caisim') || clean.includes('choy_sum') || clean.includes('baby_bok_choy')) return resolve(CANONICAL_BASE_FOODS.bok_choy);
  if (clean.includes('empal') || clean.includes('daging') || clean.includes('beef_blade') || clean.includes('beef_chuck') || clean.includes('beef_cut') || clean.includes('beef_brisket')) return resolve(CANONICAL_BASE_FOODS.raw_beef_cut);
  if (clean.includes('tartar') || clean.includes('tartar_sauce') || clean.includes('tartar sauce')) return resolve(CANONICAL_BASE_FOODS.tartar_sauce);
  if (clean.includes('american_cheese') || clean.includes('american cheese') || (clean.includes('cheese') && clean.includes('processed'))) return resolve(CANONICAL_BASE_FOODS.american_cheese);
  if (clean.includes('mayo') || clean.includes('mayonnaise')) return resolve(CANONICAL_BASE_FOODS.mayonnaise);
  if (clean.includes('ketchup')) return resolve(CANONICAL_BASE_FOODS.ketchup);
  if (clean.includes('peppermint_patty') || clean.includes('mint_patty') || clean.includes('peppermint_pattie') || clean.includes('york_peppermint')) return resolve(CANONICAL_BASE_FOODS.peppermint_patty);
  if (clean.includes('peppermint_fondant') || clean.includes('mint_cream') || (clean.includes('peppermint') && (clean.includes('fondant') || clean.includes('filling') || clean.includes('cream')))) return resolve(CANONICAL_BASE_FOODS.peppermint_fondant);
  if (clean.includes('ice_cube') || clean.includes('ice_cubes') || tokens.includes('ice')) return resolve(CANONICAL_BASE_FOODS.ice);
  if (clean.includes('water') || clean.includes('soda_water') || clean.includes('sparkling_water')) return resolve(CANONICAL_BASE_FOODS.water);
  if (clean.includes('coca') || tokens.includes('cola') || tokens.includes('coke')) return resolve(CANONICAL_BASE_FOODS.coca_cola);
  if (clean.includes('cherry_tomato') || (clean.includes('cherry') && clean.includes('tomato'))) return resolve(CANONICAL_BASE_FOODS.cherry_tomato);
  if (clean.includes('breaded_chicken_tender') || clean.includes('chicken_tender') || (clean.includes('breaded') && clean.includes('chicken')) || (clean.includes('chicken') && (clean.includes('crispy') || clean.includes('crumbed') || clean.includes('panko') || clean.includes('battered') || clean.includes('katsu') || clean.includes('schnitzel')) && clean.includes('fried'))) return resolve(CANONICAL_BASE_FOODS.breaded_chicken_tender);
  if (clean.includes('chicken_breast') || (clean.includes('chicken') && clean.includes('breast'))) return resolve(CANONICAL_BASE_FOODS.chicken_breast);
  if (tokens.includes('rice') && (clean.includes('porridge') || clean.includes('congee'))) return resolve(CANONICAL_BASE_FOODS.rice_congee);
  if (tokens.includes('rice')) return resolve(CANONICAL_BASE_FOODS.white_rice);
  if (clean.includes('white_fish') || (tokens.includes('fish') && !tokens.includes('salmon'))) return resolve(CANONICAL_BASE_FOODS.white_fish);
  if (clean.includes('seaweed_salad') || clean.includes('wakame_salad') || clean.includes('wakame') || (clean.includes('seaweed') && (clean.includes('salad') || clean.includes('side')))) return resolve(CANONICAL_BASE_FOODS.seaweed_salad);
  if (clean.includes('watermelon')) return resolve(CANONICAL_BASE_FOODS.watermelon);
  if (clean.includes('honeydew') || clean.includes('melon')) return resolve(CANONICAL_BASE_FOODS.honeydew);
  if (clean.includes('margarine')) return resolve(CANONICAL_BASE_FOODS.margarine);
  if (clean.includes('bread_roll') || clean.includes('dinner_roll')) return resolve(CANONICAL_BASE_FOODS.bread_roll);
  if ((clean.includes('butter') && !clean.includes('peanut_butter') && !clean.includes('almond_butter') && !clean.includes('butter_croissant') && !clean.includes('butter_chicken')) || clean.includes('lurpak')) return resolve(CANONICAL_BASE_FOODS.butter);
  if (clean.includes('pomegranate')) return resolve(CANONICAL_BASE_FOODS.pomegranate_seed);
  if (clean.includes('sesame_seed') || (clean.includes('sesame') && clean.includes('seed'))) return resolve(CANONICAL_BASE_FOODS.sesame_seed);
  if (clean.includes('sugar_syrup') || clean.includes('simple_syrup') || (clean.includes('sugar') && clean.includes('syrup')) || clean.includes('corn_syrup')) return resolve(CANONICAL_BASE_FOODS.sugar_syrup);
  if (clean.includes('citrus_juice') || clean.includes('orange_juice') || (clean.includes('orange') && (clean.includes('juice') || clean.includes('drink'))) || (clean.includes('citrus') && (clean.includes('juice') || clean.includes('drink')))) return resolve(CANONICAL_BASE_FOODS.citrus_juice);
  if (clean.includes('espresso') || clean.includes('brewed_espresso') || clean.includes('cold_brew_espresso')) return resolve(CANONICAL_BASE_FOODS.espresso);
  // F-3 FALSE_FRIEND (PLANT_MILK_AS_DAIRY): oat/soy/almond/coconut milk must never
  // resolve to dairy whole_cow_milk. Return null so the pipeline falls through to an
  // honest fallback instead of confident-wrong dairy numbers. "X with milk" (oats
  // prepared with dairy) is not a plant milk and still resolves below.
  const rawLower = String(name || '').toLowerCase();
  const isPlantMilk = /\b(oat|soy|soya|almond|coconut|cashew|rice|pea|hemp)\s*milks?\b/i.test(rawLower)
    && !/\bwith\b[^.]*\bmilks?\b/i.test(rawLower);
  if (isPlantMilk) return null;
  if (!clean.includes('cheese') && !clean.includes('mozzarella') && !clean.includes('ricotta') && (clean.includes('milk') || clean.includes('whole_cow_milk') || clean.includes('steamed_milk') || clean.includes('cow_milk') || clean.includes('whole_milk'))) return resolve(CANONICAL_BASE_FOODS.whole_cow_milk);
  if (clean.includes('jam') || clean.includes('preserves') || clean.includes('marmalade') || clean.includes('jelly_spread') || (clean.includes('fruit') && clean.includes('spread'))) return resolve(CANONICAL_BASE_FOODS.fruit_jam);
  if (tokens.includes('grapes') || tokens.includes('grape') || clean.includes('red_grapes') || clean.includes('green_grapes')) return resolve(CANONICAL_BASE_FOODS.grapes);
  if (tokens.includes('banana') || tokens.includes('bananas')) return resolve(CANONICAL_BASE_FOODS.banana);
  if (tokens.includes('nectarine') || tokens.includes('nectarines')) return resolve(CANONICAL_BASE_FOODS.nectarine);
  if (tokens.includes('oat') || tokens.includes('oats') || tokens.includes('oatmeal') || clean.includes('porridge')) return resolve(CANONICAL_BASE_FOODS.rolled_oats);
  if (tokens.includes('tangerine') || tokens.includes('tangerines') || tokens.includes('mandarin') || tokens.includes('mandarins') || tokens.includes('clementine') || tokens.includes('clementines')) return resolve(CANONICAL_BASE_FOODS.tangerine);
  if (tokens.includes('apple') || tokens.includes('apples')) return resolve(CANONICAL_BASE_FOODS.apple);
  if (tokens.includes('orange') || tokens.includes('oranges')) return resolve(CANONICAL_BASE_FOODS.orange);
  if (tokens.includes('peach') || tokens.includes('peaches')) return resolve(CANONICAL_BASE_FOODS.peach);
  if (tokens.includes('strawberry') || tokens.includes('strawberries')) return resolve(CANONICAL_BASE_FOODS.strawberry);
  if (tokens.includes('blueberry') || tokens.includes('blueberries')) return resolve(CANONICAL_BASE_FOODS.blueberry);
  if (tokens.includes('pear') || tokens.includes('pears')) return resolve(CANONICAL_BASE_FOODS.pear);
  if (tokens.includes('plum') || tokens.includes('plums')) return resolve(CANONICAL_BASE_FOODS.plum);
  if (tokens.includes('kiwi') || tokens.includes('kiwis')) return resolve(CANONICAL_BASE_FOODS.kiwi);
  if (tokens.includes('pineapple') || tokens.includes('pineapples')) return resolve(CANONICAL_BASE_FOODS.pineapple);
  if (tokens.includes('mango') || tokens.includes('mangoes') || tokens.includes('mangos')) return resolve(CANONICAL_BASE_FOODS.mango);
  if (clean.includes('mushroom') || tokens.includes('mushrooms') || tokens.includes('mushroom')) return resolve(CANONICAL_BASE_FOODS.cooked_mushrooms);
  return null;
}



import { MealBuild, MealFoodItem, NutrientMap } from './types';

export interface ScoutInputProjection {
  text: string;
  imageUrls: string[];
  mode: string;
  diningEnvironment?: string;
}

export interface ResolverItemProjection {
  itemId?: string;
  scoutIndex?: number;
  name?: string;
  originalName?: string;
  weightGrams?: number;
  formTags?: string[];
  diningEnvironment?: string;
  componentsSketch?: string[];
  hasRawLabel: boolean;
}

export interface ResolverInputProjection {
  mealId: string;
  diningEnvironment?: string;
  items: ResolverItemProjection[];
}

export interface CalculatorItemProjection {
  itemId?: string;
  dbId?: string;
  dbSource?: string;
  weightGrams?: number;
  lockedNutrientKeys?: string[];
  rawNutritionLabel?: any;
  componentsDetailList?: any[];
  primaryBase100g?: any;
}

export interface CalculatorInputProjection {
  mealId: string;
  items: CalculatorItemProjection[];
  lockedNutrientKeys: string[];
}

export interface DietItemProjection {
  name: string;
  weightGrams?: number;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  lockedNutrientKeys?: string[];
}

export interface DietInputProjection {
  mealId: string;
  mode: string;
  mealName?: string;
  macroTotals: NutrientMap;
  itemsSummary: DietItemProjection[];
  userProfileSummary?: {
    age?: number;
    gender?: string;
    goals?: string[];
    dietaryRestrictions?: string[];
  };
}

/**
 * Stage Input Mask: Vision Scout
 * May read: text, imageUrls, mode flags
 * Must not receive: diet history, candidate search dumps, raw base64 if URLs exist
 */
export function projectScoutInput(job: any): ScoutInputProjection {
  const text = job?.inputSnapshot?.message || job?.text || job?.result?.text || '';
  const imageUrls = (job?.imageUrls || job?.photo_url ? [job?.photo_url || job?.imageUrls?.[0]] : []).filter(Boolean);
  const mode = job?.mode || 'new_log';
  const diningEnvironment = job?.diningEnvironment || job?.result?.diningEnvironment;

  return {
    text,
    imageUrls,
    mode,
    ...(diningEnvironment ? { diningEnvironment } : {})
  };
}

/**
 * Stage Input Mask: Food Resolver
 * May read per item: labels/keywords, components sketch, diningEnvironment, weights
 * Must not receive: raw image tokens, diet prompts, full search candidate arrays
 */
export function projectResolverInput(meal: MealBuild): ResolverInputProjection {
  const items: ResolverItemProjection[] = (meal.items || [])
    .filter(item => !meal.deletedItemIds?.includes(item.itemId || ''))
    .map(item => ({
      itemId: item.itemId,
      scoutIndex: item.scoutIndex,
      name: item.name || item.originalName,
      originalName: item.originalName,
      weightGrams: item.weightGrams || item.estimatedWeightGrams,
      formTags: item.physicalFormClassification ? [item.physicalFormClassification] : undefined,
      diningEnvironment: item.diningEnvironment || meal.diningEnvironment,
      componentsSketch: item.componentsDetailList?.map(c => c.name),
      hasRawLabel: Boolean(item.rawNutritionLabel)
    }));

  return {
    mealId: meal.id,
    diningEnvironment: meal.diningEnvironment,
    items
  };
}

/**
 * Stage Input Mask: Calculation Engine
 * May read: resolved dbId/sources, weights, locks, label maps, componentsDetailList
 * Must not receive: 0 LLM context (strictly code structures)
 */
export function projectCalculatorInput(meal: MealBuild): CalculatorInputProjection {
  const items: CalculatorItemProjection[] = (meal.items || [])
    .filter(item => !meal.deletedItemIds?.includes(item.itemId || ''))
    .map(item => ({
      itemId: item.itemId,
      dbId: item.dbId,
      dbSource: item.dbSource,
      weightGrams: item.weightGrams || item.estimatedWeightGrams || 100,
      lockedNutrientKeys: item.lockedNutrientKeys || item.itemLockedKeys || [],
      rawNutritionLabel: item.rawNutritionLabel,
      componentsDetailList: item.componentsDetailList,
      primaryBase100g: item.primaryBase100g
    }));

  return {
    mealId: meal.id,
    items,
    lockedNutrientKeys: items.flatMap(i => i.lockedNutrientKeys || [])
  };
}

/**
 * Stage Input Mask: Diet Agent
 * May read: meal name, composition summary, macro/totals + locked preCalc, user profile (light)
 * Must not receive: vector/DB search candidate lists, raw OCR JSON walls, scout scratchpads, base64
 */
export function projectDietInput(meal: MealBuild, profile?: any): DietInputProjection {
  const itemsSummary: DietItemProjection[] = (meal.items || [])
    .filter(item => !meal.deletedItemIds?.includes(item.itemId || ''))
    .map(item => ({
      name: item.name || item.originalName || 'Unspecified food',
      weightGrams: item.weightGrams || item.estimatedWeightGrams,
      calories: item.nutrients?.calories || item.estimatedCalories,
      protein: item.nutrients?.protein,
      carbs: item.nutrients?.carbohydrates,
      fat: item.nutrients?.fat,
      lockedNutrientKeys: item.lockedNutrientKeys
    }));

  const userProfileSummary = profile ? {
    age: profile.age,
    gender: profile.gender,
    goals: profile.goals || profile.healthGoals,
    dietaryRestrictions: profile.dietaryRestrictions || profile.allergies
  } : undefined;

  return {
    mealId: meal.id,
    mode: meal.mode,
    mealName: meal.content?.name || meal.items?.[0]?.name,
    macroTotals: meal.nutrients || {},
    itemsSummary,
    ...(userProfileSummary ? { userProfileSummary } : {})
  };
}

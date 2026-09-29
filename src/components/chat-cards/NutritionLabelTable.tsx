import React from 'react';
import { Camera, Search } from 'lucide-react';
import { nutrientDefinitions } from '../../utils/nutrition';
import { translations } from '../../utils/translations';
import { PositionedTooltip } from '../ui/PositionedTooltip';
import { PortionDropdown } from './PortionDropdown';
import { PackPortionRow } from './PackPortionRow';

function parseLabelCalories(raw: any): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'object') {
    const v = raw.calories ?? raw.energy ?? raw.kcal ?? raw['Energy (kcal)'];
    return parseLabelCalories(v);
  }
  const s = String(raw).replace(/,/g, '').trim();

  const kcalMatch = s.match(/(-?\d+(?:\.\d+)?)\s*kcal/i);
  if (kcalMatch) {
    const n = parseFloat(kcalMatch[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const kjMatch = s.match(/(-?\d+(?:\.\d+)?)\s*kj/i);
  if (kjMatch) {
    const kj = parseFloat(kjMatch[1]);
    if (Number.isFinite(kj) && kj > 0) {
      return Math.round((kj / 4.184) * 10) / 10;
    }
  }

  const m = s.match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseServingSizeGrams(ssVal: string, totalItemWeight: number): number {
  if (!ssVal) return 100;
  const lower = ssVal.toLowerCase().trim();

  // 1. Explicit gram match e.g. "160g", "160 g", "(160g edible portion)", "per 160g"
  const gMatch = lower.match(/(\d+(?:\.\d+)?)\s*g\b/);
  if (gMatch) {
    const val = parseFloat(gMatch[1]);
    if (val > 0) return val;
  }

  // 2. Explicit ml match e.g. "250ml", "250 ml"
  const mlMatch = lower.match(/(\d+(?:\.\d+)?)\s*ml\b/);
  if (mlMatch) {
    const val = parseFloat(mlMatch[1]);
    if (val > 0) return val;
  }

  // 3. Explicit oz match e.g. "1oz", "1 oz"
  const ozMatch = lower.match(/(\d+(?:\.\d+)?)\s*oz\b/);
  if (ozMatch) {
    const val = parseFloat(ozMatch[1]);
    if (val > 0) return val * 28.35;
  }

  // 4. Fraction of pack/container check if no explicit g/ml match
  const isFractionHalf = lower.includes('1/2') || lower.includes('half');
  const isFractionThird = lower.includes('1/3') || lower.includes('third');
  const isFractionQuarter = lower.includes('1/4') || lower.includes('quarter');

  if (totalItemWeight > 0) {
    if (isFractionHalf) return totalItemWeight / 2;
    if (isFractionThird) return totalItemWeight / 3;
    if (isFractionQuarter) return totalItemWeight / 4;
  }

  // 5. Whole pack/wrap/container or explicit count/piece
  if (lower.includes('pack') || lower.includes('wrap') || lower.includes('container') || lower.includes('tub') || lower.includes('bag') || lower.includes('pouch') || lower.includes('piece') || lower.includes('slice') || lower.includes('portion') || lower.includes('serving') || lower.includes('biscuit') || lower.includes('cookie') || lower.includes('bun') || lower.includes('can') || lower.includes('bottle')) {
    return totalItemWeight > 0 ? totalItemWeight : 100;
  }

  // 6. Generic number match e.g. "160" or "serving (30)"
  const numMatch = lower.match(/[\d.]+/);
  if (numMatch) {
    const val = parseFloat(numMatch[0]);
    // If it's a very small number like 1 or 2, it's almost certainly a piece count, not grams
    if (val <= 10 && totalItemWeight > 0) {
      return totalItemWeight; 
    }
    if (val > 0) return val;
  }

  return 100;
}

function isVolumeServing(item: any): boolean {
  const servingStr = String(item?.rawNutritionLabel?.servingSize || item?.nutritionFacts?.servingSize || '').toLowerCase();
  return servingStr.includes('ml') || servingStr.includes('liter') || servingStr.includes('fl oz');
}

function getResolvedItemWeightGrams(item: any): number | null {
  if (!item) return null;
  const directW = Number(item.weightGrams || item.estimatedWeightGrams || item.primaryBaseWeightG);
  if (!isNaN(directW) && directW > 0) {
    return directW;
  }
  // Try computing from serving size * servings per container
  const rawServing = String(item.rawNutritionLabel?.servingSize || item.nutritionFacts?.servingSize || '').trim();
  const rawServingsCount = Number(item.rawNutritionLabel?.servingsPerContainer ?? item.nutritionFacts?.servingsPerContainer);
  if (rawServing && !isNaN(rawServingsCount) && rawServingsCount > 0) {
    const parsedG = parseServingSizeGrams(rawServing, 0);
    if (parsedG > 0 && parsedG !== 100) {
      return Math.round(parsedG * rawServingsCount);
    }
  }
  return null;
}

function normalizeNutritionKeys(obj: any) {
  if (!obj || typeof obj !== 'object') return obj;
  const normalized: any = {};
  
  // Mapping of variation to standard camelCase keys
  const keyMapping: { [key: string]: string } = {
    'calories': 'calories', 'energy': 'calories', 'energi': 'calories', 'energitotal': 'calories', 'energi total': 'calories',
    'totalfat': 'totalFat', 'fat': 'totalFat', 'lemaktotal': 'totalFat', 'lemak total': 'totalFat',
    'saturatedfat': 'saturatedFat', 'lemakjenuh': 'saturatedFat', 'lemak jenuh': 'saturatedFat',
    'saturatedfatenergy': 'saturatedFatEnergy', 'energidarilemakjenuh': 'saturatedFatEnergy',
    'energyfromfat': 'energyFromFat', 'energidarilemak': 'energyFromFat',
    'totalcarbohydrate': 'totalCarbohydrate', 'carbohydrates': 'totalCarbohydrate', 'carbs': 'totalCarbohydrate', 'totalcarbs': 'totalCarbohydrate', 'karbohidrat': 'totalCarbohydrate', 'karbohidrattotal': 'totalCarbohydrate', 'karbohidrat total': 'totalCarbohydrate',
    'sugar': 'sugar', 'gula': 'sugar', 'gulatotal': 'sugar', 'gula total': 'sugar',
    'salt': 'salt', 'garam': 'salt', 'sodium': 'sodium', 'natrium': 'sodium',
    'protein': 'protein',
    'servingsize': 'servingSize', 'takaransaji': 'servingSize', 'takaran saji': 'servingSize',
    'servingspercontainer': 'servingsPerContainer', 'jumlahsajianperkemasan': 'servingsPerContainer', 'sajianperkemasan': 'servingsPerContainer', 'sajian per kemasan': 'servingsPerContainer'
  };

  Object.keys(obj).forEach(k => {
    const cleanKey = k.toLowerCase().replace(/_/g, '').replace(/-/g, '').trim();
    const standardKey = keyMapping[cleanKey] || k;
    normalized[standardKey] = obj[k];
  });

  if (normalized.calories) {
    const parsedC = parseLabelCalories(normalized.calories);
    if (parsedC !== null && parsedC > 0) {
      normalized.calories = `${parsedC} kcal`;
    }
  }
  
  return normalized;
}

function getSourceBadge(item: any) {
  const subComps = (Array.isArray(item.componentsDetailList) && item.componentsDetailList.length > 0)
    ? item.componentsDetailList
    : ((Array.isArray(item.components) && item.components.length > 0)
      ? item.components
      : ((Array.isArray(item.compositeSiblings) && item.compositeSiblings.length > 0)
        ? item.compositeSiblings
        : ((Array.isArray(item.componentsDetail) && item.componentsDetail.length > 0)
          ? item.componentsDetail
          : [])));
  const isGenuineOcr = (item.dbSource === 'label' || (item.source === 'label' && !item.isComponentOfComposite)) && Boolean(item.rawNutritionLabel && !item.dbSource?.includes('fallback') && !item.dbSource?.includes('composite'));
  const SINGLE_STAPLE_RE = /\b(croissant|croissants|baguette|bread|toast|muffin|scone|cookie|cupcake|biscuit|pancake|waffle|pastry|doughnut|donut|bun|roll|brioche)\b/i;
  const isSingleStaple = SINGLE_STAPLE_RE.test(String(item.originalName || item.name || item.canonicalDbName || ''));
  const isComposite = !isSingleStaple && (item.dbSource === 'composite' || item.isComposite) && Array.isArray(subComps) && subComps.length > 1;
  const brandTitle = item.chainName || item.brand || item.brandName;
  const hasDirectBrandRecord = (item.dbSource === 'brand_official' || item.source === 'brand_official' || String(item.dbId || '').includes('brand_menu_') || String(item.fdcId || '').includes('brand_menu_')) && item.dbSource !== 'estimated';
  const isBrand = hasDirectBrandRecord && !isComposite;
  const isOFF = (item.dbSource === 'off' || item.dbSource === 'open_food_facts' || item.dbSource === 'openfoodfacts') && item.dbSource !== 'estimated';
  const isEstimated = item.dbSource === 'estimated' || item.isDishEstimate || item.source === 'visual' || item.isVisualIdentification || String(item.dbId || '').startsWith('fallback_') || item.dbSource === 'category_fallback';
  const isUsda = (item.dbSource === 'usda' || item.dbSource === 'canonical_dict' || item.dbSource === 'web_search') && !isGenuineOcr && !isBrand && !isOFF && !isEstimated && !isComposite;

  if (isGenuineOcr) {
    return {
      text: 'Nutrition Facts (OCR Label)',
      className: 'bg-emerald-100/90 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
    };
  }
  if (isBrand) {
    const rawBrand = brandTitle || (String(item.dbId || '').includes('brand_menu_local_') ? String(item.dbId).split('_')[3] : '') || '';
    const formattedTitle = rawBrand ? (rawBrand.charAt(0).toUpperCase() + rawBrand.slice(1) + ' ') : '';
    return {
      text: `${formattedTitle}Official`,
      className: 'bg-indigo-100/90 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
    };
  }
  if (isOFF) {
    return {
      text: 'Open Food Facts',
      className: 'bg-sky-100/90 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800'
    };
  }
  if (isComposite && Array.isArray(subComps) && subComps.length > 1) {
    const hasBranded = subComps.some((c: any) => (c.chainName || c.brand || c.brandName || c.dbSource === 'brand_official') && !/^(milk|berry|berries|banana|apple|water|grape|grapes|strawberry|strawberries|blueberries|raspberry|almond|almonds|walnut|fresh fruit|mixed fruits|fruit)$/i.test(String(c.primaryBaseMatchName || c.name || c.keyword || '')));
    const hasFresh = subComps.some((c: any) => !c.chainName && !c.brand && !c.brandName && c.dbSource !== 'brand_official');
    return {
      text: hasBranded && hasFresh ? 'Composite (Brand + Fresh)' : 'Composite',
      className: 'bg-purple-100/90 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
    };
  }
  if (isUsda) {
    return {
      text: 'USDA FoodData Central',
      className: 'bg-blue-100/90 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
    };
  }
  if (item.dbSource === 'internal_catalog' || item.source === 'catalog_tag') {
    return {
      text: 'Verified Catalog',
      className: 'bg-indigo-100/90 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
    };
  }
  return {
    text: 'AI Estimated',
    className: 'bg-purple-100/90 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
  };
}

// Fields that realistically appear printed on a packaged-food Nutrition Facts panel.
// Micronutrients (calcium, iron, magnesium, zinc, vitamins, omega3, unsaturated fat, etc.)
// are essentially never printed and must NEVER be treated as "verified from label" truth,
// even when a backend/AI estimate happens to be merged into the same object shape.
const LABEL_PRINTABLE_NUTRIENT_KEYS = new Set([
  'calories', 'energy',
  'protein',
  'totalfat', 'fat', 'saturatedfat', 'transfat',
  'totalcarbohydrate', 'carbohydrates', 'carbs', 'totalcarbs',
  'sugar', 'totalsugar', 'addedsugar',
  'totalfibre', 'fiber', 'fibre',
  'sodium', 'salt', 'potassium'
]);

// Standard International Nutrition Facts sort order:
// 1. Calories -> 2. Total Fat (Saturated, Trans, Unsaturated) -> 3. Carbohydrates (Fiber, Total Sugars, Added Sugars) -> 4. Protein -> 5. Sodium / Salt & Cholesterol -> 6. Vitamins & Minerals
const STANDARD_NUTRIENT_ORDER: Record<string, number> = {
  // 1. Calories / Energy
  calories: 10,
  energy: 11,

  // 2. Fat & Lipids
  totalfat: 20,
  fat: 21,
  saturatedfat: 22,
  transfat: 23,
  unsaturatedfat: 24,
  omega3: 25,

  // 3. Carbohydrates, Fiber, Sugars
  totalcarbohydrate: 30,
  carbohydrates: 31,
  carbs: 32,
  totalcarbs: 33,
  totalfibre: 34,
  fiber: 35,
  fibre: 36,
  solublefibre: 37,
  sugar: 38,
  totalsugar: 39,
  addedsugar: 40,

  // 4. Protein
  protein: 50,

  // 5. Sodium / Salt & Cholesterol (placed after macros)
  sodium: 60,
  salt: 61,
  cholesterol: 62,

  // 6. Micronutrients / Minerals / Vitamins
  potassium: 70,
  calcium: 71,
  iron: 72,
  magnesium: 73,
  zinc: 74,
  selenium: 75,
  iodine: 76,
  phosphorus: 77,
  vitamind: 80,
  vitamina: 81,
  vitaminc: 82,
  vitamine: 86,
  vitamink: 87,
  thiamine: 88,
  riboflavin: 89,
  niacin: 90,
  vitaminb6: 91,
  folate: 92,
  vitaminb12: 93
};

const NON_NUTRIENT_LABEL_KEYS = new Set([
  '_synthetic',
  'issynthetic',
  'name',
  'keyword',
  'originalname',
  'canonicaldbname',
  'components',
  'componentsdetail',
  'componentsdetaillist',
  'ingredients',
  'ingredientslist',
  'cookingmethod',
  'cooking_method',
  'brand',
  'brandname',
  'chainname',
  'id',
  'dbid',
  'fdcid',
  'source',
  'dbsource',
  'itemconfidence',
  'boundingbox2d',
  'sourceimageindex',
  'anomalyflags',
  'searchquery',
  'visualingredients',
  'visualform',
  'physicalform',
  'portionsize',
  'portionunit',
  'weightgrams',
  'estimatedweightgrams',
  'primarybasematchname',
  'primarybaseweightg',
  'iscomponentofcomposite',
  'iscompositedish',
  'iscomposite',
  'servingsize',
  'servingSize',
  'weight',
  'servingspercontainer',
  'servingsPerContainer',
  'basistype',
  'basisType',
  'isdishbasis',
  'isDishBasis',
  'density',
  'servingsizegrams',
  'servingSizeGrams',
  'servings',
  'isrealtruth',
  'isRealTruth',
  'compositesiblings',
  'compositeSiblings',
  'lockednutrientkeys',
  'estimatedfields',
  '_estimatedfields',
  'nutrientsourcemap',
  'saltconversionnote',
  'confidence',
  'visualtexture',
  'visualripeness',
  'visualcookstate',
  'matchconfidence',
  'verdict'
]);

const NUTRIENT_DEFAULT_UNITS: Record<string, string> = {
  calories: 'kcal', energy: 'kcal',
  protein: 'g',
  totalfat: 'g', fat: 'g', saturatedfat: 'g', transfat: 'g', unsaturatedfat: 'g', omega3: 'g',
  carbohydrates: 'g', totalcarbohydrate: 'g', carbs: 'g',
  sugar: 'g', totalsugar: 'g', addedsugar: 'g',
  totalfibre: 'g', fiber: 'g', fibre: 'g', solublefibre: 'g',
  sodium: 'mg', salt: 'g', potassium: 'mg',
  calcium: 'mg', iron: 'mg', magnesium: 'mg', phosphorus: 'mg', zinc: 'mg',
  vitamind: 'mcg', vitaminb12: 'mcg', folate: 'mcg',
  vitamina: 'mcg', vitaminc: 'mg', vitamine: 'mg', vitamink: 'mcg',
  vitaminb6: 'mg', thiamine: 'mg', riboflavin: 'mg', niacin: 'mg', selenium: 'mcg', iodine: 'mcg'
};

function buildSynthesizedRawLabel(item: any, source: any) {
  if (!source || typeof source !== 'object') return null;
  const isDishBasis = source.basisType === 'per_dish' || source.basisType === 'total' || source.basisType === 'per_portion' || source.basisType === 'per_serving' || source.basisType === 'per_pack' || item.basisType === 'per_dish';
  const itemWeight = Number(item.weightGrams || item.estimatedWeightGrams || item.primaryBaseWeightG || 100);
  const isExplicit100g = Boolean(item.syntheticBase100g || item.baseNutrients100g || item.primaryBase100g || source.servingSizeGrams === 100 || source.basisType === 'per_100g');
  
  // If the source holds portion-total macros and is not an explicit 100g baseline, calculate per-100g scaling:
  const factor100 = (!isDishBasis && !isExplicit100g && itemWeight > 0) ? (100 / itemWeight) : 1.0;
  
  const servingSizeStr = source.servingSizeGrams 
    ? `${source.servingSizeGrams}g` 
    : (isDishBasis ? `${itemWeight}g` : '100g');

  const rawLabel: Record<string, any> = {
    servingSize: servingSizeStr,
    basisType: source.basisType || item.basisType || (isDishBasis ? 'per_dish' : 'per_100g')
  };

  Object.entries(source).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || typeof v === 'object') return;
    const kLower = k.toLowerCase().replace(/[\s_-]/g, '');
    if (NON_NUTRIENT_LABEL_KEYS.has(k) || NON_NUTRIENT_LABEL_KEYS.has(kLower)) return;
    // Never synthesize micronutrients (calcium, iron, magnesium, omega3, etc.) into a
    // "raw label" shaped object — those are not printed on real labels and must not be
    // eligible for the "Verified from printed label" badge or label-serving-size rescaling.
    if (!LABEL_PRINTABLE_NUTRIENT_KEYS.has(kLower)) return;
    
    const unit = NUTRIENT_DEFAULT_UNITS[kLower] || '';
    const num = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.]/g, ''));
    if (!isNaN(num)) {
      const scaledVal = (factor100 !== 1.0 && !['servingSizeGrams', 'servingsPerContainer'].includes(k)) 
        ? parseFloat((num * factor100).toFixed(2)) 
        : num;
      rawLabel[k] = unit ? `${scaledVal}${unit}` : String(scaledVal);
    }
  });

  // Mark this object as backend/AI-synthesized (not genuinely OCR'd from a photographed
  // label) so downstream badge/tick logic never mistakes it for printed label truth.
  rawLabel._synthetic = true;

  return rawLabel;
}

function resolveComponentWeightGrams(comp: any, dishWeight: number = 0, compCount: number = 1): number {
  if (!comp) return 0;
  if (typeof comp === 'string') return compCount > 0 && dishWeight > 0 ? Math.round(dishWeight / compCount) : 0;
  const direct = Number(
    comp.weightGrams ??
    comp.estimatedWeightGrams ??
    comp.weight ??
    comp.portionWeightGrams ??
    comp.servingSizeGrams ??
    0
  );
  if (direct > 0 && !isNaN(direct)) return direct;
  const volPct = Number(comp.volumePercentage || comp.percentage || comp.volume_percentage || 0);
  if (volPct > 0 && dishWeight > 0) {
    const derived = Math.round(dishWeight * (volPct / 100));
    if (derived > 0) return derived;
  }
  if (dishWeight > 0 && compCount > 0) {
    return Math.round(dishWeight / compCount);
  }
  return 0;
}

export function NutritionLabelTable({ 
  activeScoutItems, 
  onConfirmItem, 
  defaultOpen = true, 
  hideOwnToggle = false, 
  language = "en", 
  isSaved = false,
  onScalePortion,
  currentPortionRatio
}: { 
  activeScoutItems: any[], 
  onConfirmItem?: (idx: any) => void, 
  defaultOpen?: boolean, 
  hideOwnToggle?: boolean, 
  language?: string, 
  isSaved?: boolean,
  onScalePortion?: (ratio: number) => void,
  currentPortionRatio?: number
}) {
  const t = translations[language || "en"] || translations.en;
  const [showEstimatedMap, setShowEstimatedMap] = React.useState<Record<number, boolean>>({});
  const [confirmedIndices, setConfirmedIndices] = React.useState<Set<number>>(new Set());
  const [activeTabMap, setActiveTabMap] = React.useState<Record<number, number>>({});
  const [customPortionMap, setCustomPortionMap] = React.useState<Record<string, number>>({});

  const toggleShowEstimated = (idx: number) => {
    setShowEstimatedMap(prev => ({ ...prev, [idx]: !prev[idx] }));
  };
  let items = activeScoutItems;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch(e) { items = []; }
  }

  if (!Array.isArray(items)) {
    items = [];
  }

  // Preserve composite items with their sub-components
  const expandedItems: any[] = [];
  items.forEach(item => {
    if (!item) return;

    // Collect all sub-components that actually have a nutrient profile
    const allDishComps = (Array.isArray(item.compositeSiblings) && item.compositeSiblings.length > 0)
      ? item.compositeSiblings
      : (Array.isArray(item.componentsDetailList) && item.componentsDetailList.length > 0)
        ? item.componentsDetailList
        : ((Array.isArray(item.components) && item.components.length > 0) ? item.components : []);

    const subComps = allDishComps.filter((c: any) => {
      if (!c) return false;
      const cLower = String(c.name || c.keyword || c.searchQuery || '').toLowerCase();
      // Skip pure condiment additions like "cooking oil" or "frying oil" unless it's a standalone food
      if (cLower === 'cooking oil' || cLower === 'vegetable oil' || cLower === 'butter') return false;
      return true;
    });

    const isMultiCompComposite = (Array.isArray(subComps) && subComps.length >= 2) || item.dbSource === 'composite' || item.isComposite;
    const itemLabelSource = item.syntheticBase100g || item.baseNutrients100g || item.primaryBase100g || item.labelNutrientsPerServing || item.nutrients || item.nutritionFacts || item.nutrients_per_100g || item.core_nutrients || item;
    let itemRawLabel = item.rawNutritionLabel;
    
    if ((!itemRawLabel || Object.keys(normalizeNutritionKeys(itemRawLabel) || {}).length === 0) && itemLabelSource && typeof itemLabelSource === 'object') {
      itemRawLabel = buildSynthesizedRawLabel(item, itemLabelSource);
    }

    expandedItems.push({
      ...item,
      rawNutritionLabel: itemRawLabel || item.rawNutritionLabel || {},
      dbSource: item.dbSource || (isMultiCompComposite ? 'composite' : (item.source === 'label' ? 'label' : 'visual')),
      compositeSiblings: subComps
    });
  });

  const processedItems = expandedItems.map(item => {
    if (!item) return item;
    let parsedRaw = item.rawNutritionLabel;
    if (typeof parsedRaw === 'string') {
      try { parsedRaw = JSON.parse(parsedRaw.replace(/'/g, '"')); } catch (e) { parsedRaw = null; }
    }
    let parsedFacts = item.nutritionFacts;
    if (typeof parsedFacts === 'string') {
      try { parsedFacts = JSON.parse(parsedFacts.replace(/'/g, '"')); } catch (e) { parsedFacts = null; }
    }
    
    let autoCorrectedCalories = item.autoCorrectedCalories || false;
    let originalCalories = item.originalCalories || null;
    let correctedRaw = normalizeNutritionKeys(parsedRaw);
    let correctedFacts = normalizeNutritionKeys(parsedFacts);

    const isRealTruth = item.dbSource === 'label' || item.dbSource === 'brand_official' || item.dbSource === 'label_partial' || item.dbSource === 'off' || item.dbSource === 'open_food_facts' || item.dbSource === 'openfoodfacts' || item.source === 'label' || item.source === 'brand_official' || Boolean(item.isRealTruth);
    const labelSource = item.syntheticBase100g || item.baseNutrients100g || item.primaryBase100g || item.labelNutrientsPerServing || item.nutrients || item.nutritionFacts || item.nutrients_per_100g || item.core_nutrients;
    const hasCoreMacros = correctedRaw && typeof correctedRaw === 'object' ? ['calories', 'protein', 'totalfat', 'fat', 'carbohydrates', 'totalcarbohydrate', 'energy'].some(k => correctedRaw[k] !== undefined && correctedRaw[k] !== null && correctedRaw[k] !== '' && correctedRaw[k] !== '-') : false;
    
    if ((!correctedRaw || typeof correctedRaw !== 'object' || Object.keys(correctedRaw).length === 0 || !hasCoreMacros) && labelSource) {
      correctedRaw = buildSynthesizedRawLabel(item, labelSource);
    }
    
    // Check if anomalyFlags indicate calorie correction
    if (item.anomalyFlags && Array.isArray(item.anomalyFlags)) {
      const calorieFlag = item.anomalyFlags.find((f: string) => f.includes("calories mathematically auto-corrected from"));
      if (calorieFlag) {
        autoCorrectedCalories = true;
        const match = calorieFlag.match(/from (\d+(?:\.\d+)?) to/);
        if (match) {
          originalCalories = match[1];
        }
      }
    }
    
    return { 
      ...item, 
      rawNutritionLabel: correctedRaw, 
      nutritionFacts: correctedFacts,
      autoCorrectedCalories,
      originalCalories,
      isRealTruth
    };
  });

  const hasLabels = processedItems.some((item: any) => {
    if (!item) return false;
    return true;
  });

  if (!hasLabels) return null;

  const renderedItems = processedItems.map((rootItem: any, i: number) => {
            const subComps: any[] = (Array.isArray(rootItem.compositeSiblings) && rootItem.compositeSiblings.length > 0)
              ? rootItem.compositeSiblings
              : ((Array.isArray(rootItem.components) && rootItem.components.length > 0)
                ? rootItem.components
                : []);
            const hasTabs = subComps.length > 1;
            const activeTab = activeTabMap[i] || 0;
            const itemKeyPrefix = rootItem.id || rootItem.keyword || String(i);
            const staticDishTotalWeight = getResolvedItemWeightGrams(rootItem) || 0;
            const dishTotalWeight = hasTabs
              ? subComps.reduce((sum: number, comp: any, cIdx: number) => {
                  const compW = customPortionMap[`${itemKeyPrefix}-${cIdx + 1}`] ?? customPortionMap[`${i}-${cIdx + 1}`] ?? resolveComponentWeightGrams(comp, staticDishTotalWeight, subComps.length);
                  return sum + compW;
                }, 0)
              : staticDishTotalWeight;

            let item = rootItem;
            if (activeTab === 0 && hasTabs) {
              item = {
                ...rootItem,
                weightGrams: dishTotalWeight,
                estimatedWeightGrams: dishTotalWeight,
              };
            }
            let activeTitle = rootItem.primaryBaseMatchName || rootItem.labelProductName || rootItem.scoutOriginalName || rootItem.originalName || rootItem.keyword || 'Food Item';
            let activePackGrams = rootItem.packGrams || null;

            if (activeTab > 0 && subComps[activeTab - 1]) {
              const comp = subComps[activeTab - 1];
              const compWeight = customPortionMap[`${itemKeyPrefix}-${activeTab}`] ?? customPortionMap[`${i}-${activeTab}`] ?? resolveComponentWeightGrams(comp, dishTotalWeight, subComps.length);
              const compName = String(comp.primaryBaseMatchName || comp.name || comp.searchQuery || comp.keyword || (typeof comp === 'string' ? comp : 'Ingredient'))
                .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                .replace(/^[📖\s]+/, '')
                .replace(/\s*\((internal_catalog|usual_catalog|canonical base)\)/gi, '')
                .trim();
              
              let base100g = comp.baseNutrients100g || comp.syntheticBase100g || comp.primaryBase100g;
              if (!base100g && comp.nutrients && compWeight > 0) {
                base100g = {
                  calories: Math.round(((comp.calories ?? comp.nutrients.calories ?? 0) / compWeight) * 100),
                  protein: Math.round(((comp.protein ?? comp.nutrients.protein ?? 0) / compWeight) * 100 * 10) / 10,
                  totalFat: Math.round(((comp.totalFat ?? comp.fat ?? comp.nutrients.totalFat ?? comp.nutrients.fat ?? 0) / compWeight) * 100 * 10) / 10,
                  saturatedFat: Math.round(((comp.saturatedFat ?? comp.nutrients.saturatedFat ?? 0) / compWeight) * 100 * 10) / 10,
                  carbohydrates: Math.round(((comp.carbohydrates ?? comp.carbs ?? comp.nutrients.carbohydrates ?? 0) / compWeight) * 100 * 10) / 10,
                  sodium: Math.round(((comp.sodium ?? comp.nutrients.sodium ?? 0) / compWeight) * 100),
                };
              }

              const scale = (compWeight || 100) / 100;
              const mergedNutrients: Record<string, any> = { ...(comp.nutrients || {}) };
              if (base100g) {
                Object.entries(base100g).forEach(([k, v]) => {
                  if (typeof v === 'number' && Number.isFinite(v)) {
                    mergedNutrients[k] = Math.round(v * scale * 10) / 10;
                  }
                });
              }

              const rawLabel = comp.rawNutritionLabel || (base100g ? buildSynthesizedRawLabel({ weightGrams: compWeight }, base100g) : buildSynthesizedRawLabel({ weightGrams: compWeight }, mergedNutrients));

              item = {
                ...comp,
                name: compName,
                keyword: compName,
                originalName: compName,
                primaryBaseMatchName: compName,
                weightGrams: compWeight,
                estimatedWeightGrams: compWeight,
                packGrams: comp.packGrams ?? null,
                cookingMethod: comp.cookingMethod || rootItem.cookingMethod || 'cooked',
                dbSource: comp.dbSource || 'estimated',
                source: comp.source || comp.dbSource || 'visual',
                rawNutritionLabel: normalizeNutritionKeys(rawLabel),
                nutritionFacts: normalizeNutritionKeys(mergedNutrients),
                nutrients: mergedNutrients,
                baseNutrients100g: base100g,
                isComponentOfComposite: true,
              };

              activeTitle = compName;
              activePackGrams = comp.packGrams ?? null;
            }

            const meaningfulRawKeys = item.rawNutritionLabel
              ? Object.keys(item.rawNutritionLabel).filter((k: string) =>
                  !NON_NUTRIENT_LABEL_KEYS.has(k) &&
                  !NON_NUTRIENT_LABEL_KEYS.has(k.toLowerCase()) &&
                  item.rawNutritionLabel[k] !== undefined &&
                  item.rawNutritionLabel[k] !== null &&
                  item.rawNutritionLabel[k] !== '' &&
                  item.rawNutritionLabel[k] !== '-' &&
                  item.rawNutritionLabel[k] !== '--'
                )
              : [];
            const hasRaw = meaningfulRawKeys.length > 0;
            const hasNut = item.nutritionFacts && Object.keys(item.nutritionFacts).length > 0;
            const hasIngredients = !!(item.ingredientsList && String(item.ingredientsList).trim());

            const resolvedWeight = getResolvedItemWeightGrams(item);
            const isVolume = isVolumeServing(item);
            const isStandaloneLabelPhoto = item.source === 'label' && (!resolvedWeight || resolvedWeight === 0);
            const missingWeight = !isStandaloneLabelPhoto && (!resolvedWeight || resolvedWeight <= 0);

            const cleanAnomalyFlags = (item.anomalyFlags || []).filter((f: string) => 
              typeof f === 'string' &&
              !f.includes("Converted printed salt") &&
              !f.includes("Formula: 1g salt") &&
              !f.toLowerCase().includes("converted printed salt")
            );

            const isUnclear = (item.itemConfidence?.toLowerCase().includes('low') || 
                               item.itemConfidence?.toLowerCase().includes('medium')) || 
                              (cleanAnomalyFlags.length > 0);
            const itemIsSaved = isSaved || Boolean(
              item.isSaved || 
              item.saved || 
              item.savedToHistory || 
              item.savedToLog || 
              item.isAlreadyLogged || 
              item.confirmed || 
              item.scoutConfirmed || 
              item.isConfirmed
            );
            const isConfirmedByUser = confirmedIndices.has(item.scoutIndex ?? i) || confirmedIndices.has(i);
            const showWarning = !itemIsSaved && !isConfirmedByUser && (missingWeight || isUnclear);

            const saltConversionNoteText = item.saltConversionNote ||
              (Array.isArray(item.anomalyFlags) && item.anomalyFlags.find((f: string) => typeof f === 'string' && f.includes("Converted printed salt"))) ||
              (item.rawNutritionLabel?.salt && (item.rawNutritionLabel?.sodium || item.nutritionFacts?.sodium)
                ? `Converted printed salt (${item.rawNutritionLabel.salt}${item.rawNutritionLabel?.servingSize ? ` per ${item.rawNutritionLabel.servingSize}` : ''}) to sodium. Formula: 1g salt = 400mg sodium.`
                : null);

            // Merge keys for table
            // Defensive guard: if calories are present but every core macro (protein/fat/carbs)
            // reads exactly 0, that pattern means the source data was never actually captured
            // for those fields (a real food with real calories always has non-zero macros
            // somewhere). Treat those specific 0-valued fields as "not captured" and hide them,
            // rather than showing misleading zeros. A genuine single-field zero (e.g. real
            // "0g trans fat" sitting next to normal non-zero macros) is left untouched.
            const parseRowNumber = (raw: any): number | null => {
              if (raw === undefined || raw === null || raw === '') return null;
              const m = String(raw).match(/-?\d+(?:\.\d+)?/);
              return m ? parseFloat(m[0]) : null;
            };
            const calsForZeroCheck = parseLabelCalories(item.rawNutritionLabel?.calories ?? item.nutritionFacts?.calories);
            const macroKeysForZeroCheck = ['protein', 'totalFat', 'totalCarbohydrate', 'carbohydrates'];
            const macroValsForZeroCheck = macroKeysForZeroCheck
              .map(k => parseRowNumber(item.rawNutritionLabel?.[k] ?? item.nutritionFacts?.[k]))
              .filter((v): v is number => v !== null);
            const hasImplausibleAllZeroMacros = (calsForZeroCheck || 0) > 0 &&
              macroValsForZeroCheck.length > 0 &&
              macroValsForZeroCheck.every(v => v === 0);

            const allKeys = Array.from(
              new Set([
                ...(hasRaw ? Object.keys(item.rawNutritionLabel) : []),
                ...(hasNut ? Object.keys(item.nutritionFacts) : []),
              ])
            ).filter((k) => {
              const kLower = k.toLowerCase().replace(/[\s_-]/g, '');
              if (NON_NUTRIENT_LABEL_KEYS.has(k) || NON_NUTRIENT_LABEL_KEYS.has(k.toLowerCase()) || NON_NUTRIENT_LABEL_KEYS.has(kLower)) return false;
              const rawVal = item.rawNutritionLabel?.[k];
              const nutVal = item.nutritionFacts?.[k];
              const val = rawVal !== undefined ? rawVal : nutVal;
              
              if (val === undefined || val === null || val === '' || val === '-' || val === '--') return false;
              if (typeof val === 'object' || Array.isArray(val) || typeof val === 'function' || typeof val === 'boolean') return false;
              const numVal = parseRowNumber(val);
              if (numVal === null) return false;
              
              if (hasImplausibleAllZeroMacros && !k.toLowerCase().includes('calorie') && !k.toLowerCase().includes('energy')) {
                if (numVal === 0) return false;
              }
              
              // Hide 0-value trace nutrients for branded/official foods if they weren't explicitly printed on the label.
              // Brand databases often default trace nutrients to 0, which clutters the UI with implausible zeros.
              if (numVal === 0) {
                const isMacro = ['calories', 'protein', 'totalfat', 'fat', 'carbohydrates', 'totalcarbohydrate', 'sodium', 'sugar', 'addedsugar', 'saturatedfat', 'transfat', 'totalfibre', 'fiber'].includes(k.toLowerCase());
                const isOfficial = Boolean(item.chainName || item.brand || item.brandName || item.dbSource === 'brand_official' || item.dbSource === 'label' || item.source === 'brand_official' || item.source === 'label');
                
                if (isOfficial && !isMacro) {
                  // If it's a 0 trace nutrient on a branded food, only show it if the printed label explicitly stated it was 0.
                  if (rawVal === undefined || rawVal === null || rawVal === '') {
                    return false;
                  }
                }
              }
              
              return true;
            });

            // Sort nutrients to strictly follow official FDA/International Nutrition Facts order (Calories -> Fat -> Sodium -> Carbs -> Protein -> Vitamins)
            allKeys.sort((a, b) => {
              const aKey = String(a).toLowerCase().replace(/[\s_-]/g, '');
              const bKey = String(b).toLowerCase().replace(/[\s_-]/g, '');
              const aOrder = STANDARD_NUTRIENT_ORDER[aKey] ?? 999;
              const bOrder = STANDARD_NUTRIENT_ORDER[bKey] ?? 999;
              return aOrder - bOrder;
            });

            const rootTitle = rootItem.primaryBaseMatchName || rootItem.labelProductName || rootItem.scoutOriginalName || rootItem.originalName || rootItem.keyword || 'Food Item';
            const cleanDishTitle = String(rootTitle)
              .replace(/^Estimated:\s*/i, '')
              .replace(/\s*\(category fallback\)/gi, '')
              .trim();
            const cookingMethod = item.cookingMethod || item.cooking_method;
            const sourceBadge = getSourceBadge(item);

            return (
              <div
                key={`nut-${i}`}
                className="text-[10px] text-theme-text-secondary bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-theme-border/80"
              >
                {/* Header Title with Brand & Badges */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex flex-col text-left min-w-0">
                    <strong className="block text-slate-800 dark:text-slate-200 font-display text-xs">
                      {(rootItem.chainName || rootItem.brand || rootItem.brandName) && (rootItem.dbSource === 'brand_official' || String(rootItem.dbId || '').includes('brand_menu_') || String(rootItem.fdcId || '').includes('brand_menu_')) ? (
                        <>
                          <span className="text-indigo-500 dark:text-indigo-400">{rootItem.chainName || rootItem.brand || rootItem.brandName}</span>
                          {' · '}
                        </>
                      ) : null}
                      {cleanDishTitle}
                    </strong>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {sourceBadge && (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0 ${sourceBadge.className}`}>
                        {sourceBadge.text}
                      </span>
                    )}
                    {cookingMethod && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 shrink-0 capitalize">
                        {cookingMethod}
                      </span>
                    )}
                  </div>
                </div>

                {/* Composite Dish Tabset */}
                {hasTabs && (
                  <div className="flex items-stretch gap-1.5 p-1 bg-slate-200/70 dark:bg-slate-900/70 rounded-xl mb-3 overflow-x-auto border border-slate-300/40 dark:border-slate-800/60">
                    {/* Tab 0: Whole Dish */}
                    <button
                      type="button"
                      onClick={() => setActiveTabMap(prev => ({ ...prev, [i]: 0 }))}
                      className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-lg text-xs font-semibold transition-all min-w-[70px] shrink-0 cursor-pointer ${
                        activeTab === 0
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-300/40 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <span className="capitalize">{rootItem.dishName || 'Dish'}</span>
                      <span className={`text-[10px] font-normal leading-tight mt-0.5 ${activeTab === 0 ? 'text-indigo-100' : 'text-slate-400'}`}>
                        {dishTotalWeight}g
                      </span>
                    </button>

                    {/* Tabs 1..N: Sub-components */}
                    {subComps.map((comp: any, cIdx: number) => {
                      const isActive = activeTab === cIdx + 1;
                      const compW = customPortionMap[`${itemKeyPrefix}-${cIdx + 1}`] ?? customPortionMap[`${i}-${cIdx + 1}`] ?? resolveComponentWeightGrams(comp, staticDishTotalWeight, subComps.length);
                      const cName = String(comp.primaryBaseMatchName || comp.name || comp.searchQuery || comp.keyword || (typeof comp === 'string' ? comp : 'Ingredient'))
                        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                        .replace(/^[📖\s]+/, '')
                        .replace(/\s*\((internal_catalog|usual_catalog|canonical base)\)/gi, '')
                        .trim();

                      return (
                        <button
                          key={cIdx}
                          type="button"
                          onClick={() => setActiveTabMap(prev => ({ ...prev, [i]: cIdx + 1 }))}
                          className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-lg text-xs font-semibold transition-all min-w-[70px] shrink-0 cursor-pointer ${
                            isActive
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'bg-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-300/40 dark:hover:bg-slate-800/60'
                          }`}
                        >
                          <span className="capitalize truncate max-w-[120px]">{cName}</span>
                          <span className={`text-[10px] font-normal leading-tight mt-0.5 ${isActive ? 'text-indigo-100' : 'text-slate-400'}`}>
                            {compW}g
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Pack Portion Selection with 5s Accept Feedback */}
                {activePackGrams && activePackGrams > 0 && (
                  <PackPortionRow
                    key={`portion-${itemKeyPrefix}-${activeTab}`}
                    foodName={activeTitle}
                    packGrams={activePackGrams}
                    currentWeight={resolvedWeight || 100}
                    dishWeight={activeTab === 0 ? dishTotalWeight : undefined}
                    portionAccepted={Boolean(rootItem.portionAccepted || item.portionAccepted)}
                    language={language}
                    onConfirmPortion={() => {
                      rootItem.portionAccepted = true;
                      item.portionAccepted = true;
                      if (onConfirmItem) onConfirmItem(i);
                    }}
                    onScaleWeight={(newWeight) => {
                      if (activeTab > 0) {
                        setCustomPortionMap(prev => {
                          const updatedMap = {
                            ...prev,
                            [`${itemKeyPrefix}-${activeTab}`]: newWeight,
                            [`${i}-${activeTab}`]: newWeight
                          };
                          // Compute new dish weight with updated subcomponent weight
                          const newDishWeight = subComps.reduce((sum: number, c: any, cIdx: number) => {
                            const cW = updatedMap[`${itemKeyPrefix}-${cIdx + 1}`] ?? updatedMap[`${i}-${cIdx + 1}`] ?? resolveComponentWeightGrams(c, staticDishTotalWeight, subComps.length);
                            return sum + cW;
                          }, 0);
                          if (onScalePortion && staticDishTotalWeight > 0 && newDishWeight > 0) {
                            onScalePortion(newDishWeight / staticDishTotalWeight);
                          }
                          return updatedMap;
                        });
                      } else if (onScalePortion && dishTotalWeight > 0) {
                        onScalePortion(newWeight / dishTotalWeight);
                      }
                    }}
                  />
                )}

                {/* Fallback portion control when there is no PackPortionRow */}
                {(!activePackGrams || activePackGrams <= 0) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 p-2 mb-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 text-xs font-sans">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{activeTitle}</span>
                      <span className="text-slate-500 dark:text-slate-400 font-normal">{t.weightLabel}:</span>
                      <PortionDropdown
                        baseWeight={activeTab > 0 ? (resolveComponentWeightGrams(subComps[activeTab - 1], staticDishTotalWeight, subComps.length) || 100) : (staticDishTotalWeight || 100)}
                        currentWeight={resolvedWeight || 100}
                        language={language}
                        onScale={(ratio) => {
                          const baseW = activeTab > 0 ? (resolveComponentWeightGrams(subComps[activeTab - 1], staticDishTotalWeight, subComps.length) || 100) : (staticDishTotalWeight || 100);
                          const newWeight = Math.round(baseW * ratio);
                          if (activeTab > 0) {
                            setCustomPortionMap(prev => {
                              const updatedMap = {
                                ...prev,
                                [`${itemKeyPrefix}-${activeTab}`]: newWeight,
                                [`${i}-${activeTab}`]: newWeight
                              };
                              // Compute new dish weight with updated subcomponent weight
                              const newDishWeight = subComps.reduce((sum: number, c: any, cIdx: number) => {
                                const cW = updatedMap[`${itemKeyPrefix}-${cIdx + 1}`] ?? updatedMap[`${i}-${cIdx + 1}`] ?? resolveComponentWeightGrams(c, staticDishTotalWeight, subComps.length);
                                return sum + cW;
                              }, 0);
                              if (onScalePortion && staticDishTotalWeight > 0 && newDishWeight > 0) {
                                onScalePortion(newDishWeight / staticDishTotalWeight);
                              }
                              return updatedMap;
                            });
                          } else if (onScalePortion && dishTotalWeight > 0) {
                            onScalePortion(newWeight / dishTotalWeight);
                          }
                        }}
                      />
                    </div>
                  </div>
                )}

                {item.lockedNutrientKeys && Array.isArray(item.lockedNutrientKeys) && item.lockedNutrientKeys.length > 0 && (
                  <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/30 text-[10px] text-amber-800 dark:text-amber-200 flex items-start gap-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 shrink-0 mt-0.5">
                      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
                      <path d="M12 9v4"></path>
                      <path d="M12 17h.01"></path>
                    </svg>
                    <div>
                      <span className="font-bold">Partial Printed Label:</span> Official truth locked for <span className="font-semibold underline">{item.lockedNutrientKeys.join(', ')}</span>. Unprinted macros (<span className="font-bold text-amber-600 dark:text-amber-400">⚠️</span>) are estimated by AI agent heuristic knowledge.
                    </div>
                  </div>
                )}

                {allKeys.length > 0 && (() => {
                  const isKeyLocked = (k: string) => {
                    const standardMapping: Record<string, string> = {
                      calories: 'calories',
                      protein: 'protein',
                      totalfat: 'totalFat',
                      saturatedfat: 'saturatedFat',
                      sodium: 'sodium',
                      totalcarbohydrate: 'carbohydrates',
                      carbohydrates: 'carbohydrates',
                      totalcarbs: 'carbohydrates',
                      totalfibre: 'totalFibre',
                      fiber: 'totalFibre',
                      fibre: 'totalFibre',
                      sugar: 'sugar',
                      addedsugar: 'addedSugar',
                      transfat: 'transFat'
                    };
                    const normKey = standardMapping[k.toLowerCase()] || k;
                    const normLower = String(normKey).toLowerCase();
                    const kLower = String(k).toLowerCase();
                    const isFromRawLabel = item.rawNutritionLabel?.[k] !== undefined && 
                                           item.rawNutritionLabel?.[k] !== null && 
                                           item.rawNutritionLabel?.[k] !== '' &&
                                           item.rawNutritionLabel?.[k] !== '-' &&
                                           !item.rawNutritionLabel?._synthetic &&
                                           (LABEL_PRINTABLE_NUTRIENT_KEYS.has(kLower) || LABEL_PRINTABLE_NUTRIENT_KEYS.has(normLower));
                    const isExplicitlyEstimated = (Array.isArray(item.estimatedFields) && item.estimatedFields.map((f: string) => String(f).toLowerCase()).includes(normLower)) ||
                                                 (Array.isArray(item._estimatedFields) && item._estimatedFields.map((f: string) => String(f).toLowerCase()).includes(normLower));
                    const hasLockedKeys = Array.isArray(item.lockedNutrientKeys) && item.lockedNutrientKeys.length > 0;
                    const inLockedKeys = hasLockedKeys && item.lockedNutrientKeys.some((lk: string) => {
                      const lkLower = String(lk).toLowerCase();
                      return lkLower === normLower ||
                        lkLower === kLower ||
                        (normLower === 'carbohydrates' && (lkLower === 'carbohydrate' || lkLower === 'carbs' || lkLower === 'totalcarbohydrate')) ||
                        (normLower === 'totalfat' && (lkLower === 'fat' || lkLower === 'totalfat')) ||
                        (normLower === 'totalfibre' && (lkLower === 'fiber' || lkLower === 'fibre' || lkLower === 'totalfibre')) ||
                        (normLower === 'calories' && (lkLower === 'energy' || lkLower === 'cals'));
                    });
                    if (isExplicitlyEstimated) return false;
                    if (hasLockedKeys) return inLockedKeys;
                    if (isFromRawLabel) return true;
                    const isCoreMacro = ['calories', 'protein', 'totalfat', 'fat', 'carbohydrates', 'totalcarbohydrate', 'sodium'].includes(kLower) || ['calories', 'protein', 'totalfat', 'carbohydrates', 'sodium'].includes(normLower);
                    return isCoreMacro;
                  };

                  const hasEstimatedNutrients = allKeys.some(k => !isKeyLocked(k));
                  const isEstimatedExpanded = Boolean(showEstimatedMap[i]);
                  const visibleKeys = allKeys.filter(k => isEstimatedExpanded || isKeyLocked(k));

                  return (
                    <div>
                      {visibleKeys.length > 0 && (
                        <div className="overflow-x-auto rounded-lg border border-theme-border/50">
                          <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-100/50 dark:bg-slate-800/50">
                              <th className="py-1.5 px-2 font-bold text-theme-text-secondary border-b border-theme-border/50">
                                {t.nutrientLabel}
                              </th>
                              <th className="py-1.5 px-2 font-bold text-theme-text-secondary border-b border-theme-border/50">
                                {(() => {
                                   const ssRaw = String(item.rawNutritionLabel?.servingSize || item.nutritionFacts?.servingSize || '').trim();
                                   const totalG = resolvedWeight;
                                   const ssGramsMatch = ssRaw.match(/^(\d+(?:\.\d+)?)\s*(?:g|ml)$/i);
                                   const isExplicit100g = /\b100\s*(?:g|ml)\b/i.test(ssRaw);
                                   const rawBasis = item.rawNutritionLabel?.basisType || item.basisType;
                                   if (isExplicit100g || rawBasis === 'per_100g') {
                                     return isVolume ? 'Per 100ml' : 'Per 100g';
                                   }
                                   if (ssRaw && ssGramsMatch && totalG && Math.abs(parseFloat(ssGramsMatch[1]) - totalG) < 0.5) {
                                     return 'Serving Size (1 dish)';
                                   }
                                   if (ssRaw) return `Serving Size (${ssRaw})`;
                                   if (rawBasis === 'per_dish' || rawBasis === 'total' || rawBasis === 'per_portion') {
                                     return 'Per Dish';
                                   }
                                   const isCooked = (item.cookingMethod && item.cookingMethod !== 'raw') || 
                                     /porridge|cooked|boiled|soup|stew|hotpot|fried|baked|steamed/i.test(item.originalName || item.keyword || item.name || '');
                                   return isVolume ? 'Per 100ml' : (isCooked ? 'Per 100g (cooked)' : 'Per 100g');
                                })()}
                              </th>
                              <th className="py-1.5 px-2 font-bold text-theme-text-secondary border-b border-theme-border/50 whitespace-nowrap">
                                {t.totalLabel}{resolvedWeight ? ` (${resolvedWeight}${isVolume ? 'ml' : 'g'})` : ''}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                            {visibleKeys.map((k) => {
                              const standardMapping: Record<string, string> = {
                                calories: 'calories',
                                protein: 'protein',
                                totalfat: 'totalFat',
                                saturatedfat: 'saturatedFat',
                                sodium: 'sodium',
                                totalcarbohydrate: 'carbohydrates',
                                carbohydrates: 'carbohydrates',
                                totalcarbs: 'carbohydrates',
                                totalfibre: 'totalFibre',
                                fiber: 'totalFibre',
                                fibre: 'totalFibre',
                                sugar: 'sugar',
                                addedsugar: 'addedSugar',
                                transfat: 'transFat',
                                potassium: 'potassium',
                                calcium: 'calcium',
                                iron: 'iron',
                                magnesium: 'magnesium',
                                vitamind: 'vitaminD',
                                omega3: 'omega3',
                                solublefibre: 'solubleFibre'
                              };
                              const normKey = standardMapping[k.toLowerCase()] || k;
                              const normLower = String(normKey).toLowerCase();
                              const kLower = String(k).toLowerCase();

                              const isFromRawLabel = item.rawNutritionLabel?.[k] !== undefined && 
                                                     item.rawNutritionLabel?.[k] !== null && 
                                                     item.rawNutritionLabel?.[k] !== '' &&
                                                     item.rawNutritionLabel?.[k] !== '-' &&
                                                     !item.rawNutritionLabel?._synthetic &&
                                                     (LABEL_PRINTABLE_NUTRIENT_KEYS.has(kLower) || LABEL_PRINTABLE_NUTRIENT_KEYS.has(normLower));

                              const isServingField = k.toLowerCase().includes('serving');
                              const isCalorieKey = k.toLowerCase().includes('calories') || k.toLowerCase().includes('energy');

                              const nutDef = nutrientDefinitions.find((n: any) => n.key.toLowerCase() === normLower || n.key.toLowerCase() === kLower);
                              const defaultUnit = isCalorieKey ? 'kcal' : (isServingField ? '' : (nutDef ? nutDef.unit : 'g'));

                              const weightToDisplay = resolvedWeight || 100;

                              let originalDisplay = '-';
                              let totalStr = '-';

                              if (isServingField) {
                                const sVal = item.rawNutritionLabel?.[k] || item.nutritionFacts?.[k] || `${weightToDisplay}g`;
                                originalDisplay = String(sVal);
                              } else if (isFromRawLabel) {
                                const rawVal = item.rawNutritionLabel[k];
                                const unit = isCalorieKey ? 'kcal' : (String(rawVal).replace(/[\d.\s]/g, '') || defaultUnit);
                                let numVal: number | null = null;
                                if (isCalorieKey) {
                                  numVal = parseLabelCalories(rawVal);
                                } else {
                                  const match = String(rawVal).match(/[\d.]+/);
                                  if (match) numVal = parseFloat(match[0]);
                                }

                                const hasUnit = /[a-zA-Z%]/.test(String(rawVal));
                                originalDisplay = isCalorieKey && numVal !== null ? `${numVal} kcal` : (hasUnit ? String(rawVal) : `${rawVal}${defaultUnit}`);

                                if (numVal !== null && weightToDisplay > 0) {
                                  const ssServingSize = String(item.rawNutritionLabel?.servingSize || '').trim();
                                  const isExplicit100g = /\b100\s*g\b/i.test(ssServingSize);
                                  const bType = item.rawNutritionLabel?.basisType || (isExplicit100g ? 'per_100g' : 'per_dish');
                                  const isDishBasis = !isExplicit100g && (bType === 'per_dish' || bType === 'total' || bType === 'per_portion' || bType === 'per_serving' || bType === 'per_pack');

                                  let labelServingGrams = isDishBasis ? weightToDisplay : 100;
                                  if (item.rawNutritionLabel?.servingSize) {
                                    labelServingGrams = parseServingSizeGrams(String(item.rawNutritionLabel.servingSize), weightToDisplay);
                                  }

                                  const multiplier = (isDishBasis && (!item.rawNutritionLabel?.servingSize || item.rawNutritionLabel?.servingSize === '1 dish' || item.rawNutritionLabel?.servingSize === '1 serving'))
                                    ? 1.0
                                    : (labelServingGrams > 0 ? (weightToDisplay / labelServingGrams) : 1.0);

                                  const total = (numVal * multiplier).toFixed(1).replace(/\.0$/, '');
                                  totalStr = `${total}${unit}`;
                                }
                              } else {
                                // AI Estimated or DB match: portion total is the ground truth
                                const portionVal = item.nutrients?.[normKey] ?? item.nutrients?.[k] ?? item.truthNutrients?.[normKey] ?? item.truthNutrients?.[k];
                                const base100gVal = item.primaryBase100g?.[normKey] ?? item.primaryBase100g?.[k] ?? item.baseNutrients100g?.[normKey] ?? item.baseNutrients100g?.[k];
                                const fallbackVal = item.nutritionFacts?.[k] ?? item.nutritionFacts?.[normKey];

                                let finalPortionNum: number | null = null;
                                let final100gNum: number | null = null;

                                if (portionVal !== undefined && portionVal !== null && !isNaN(Number(portionVal))) {
                                  finalPortionNum = Number(portionVal);
                                  if (finalPortionNum === 0) {
                                    final100gNum = 0;
                                  } else if (base100gVal !== undefined && base100gVal !== null && !isNaN(Number(base100gVal))) {
                                    final100gNum = Number(base100gVal);
                                  } else if (weightToDisplay > 0) {
                                    final100gNum = (finalPortionNum / weightToDisplay) * 100;
                                  }
                                } else if (base100gVal !== undefined && base100gVal !== null && !isNaN(Number(base100gVal))) {
                                  final100gNum = Number(base100gVal);
                                  finalPortionNum = (final100gNum * weightToDisplay) / 100;
                                } else if (fallbackVal !== undefined && fallbackVal !== null) {
                                  const parsedF = isCalorieKey ? parseLabelCalories(fallbackVal) : parseFloat(String(fallbackVal).match(/[\d.]+/)?.[0] || '');
                                  if (parsedF !== null && !isNaN(parsedF)) {
                                    finalPortionNum = parsedF;
                                    final100gNum = weightToDisplay > 0 ? (parsedF / weightToDisplay) * 100 : parsedF;
                                  }
                                }

                                const unit = defaultUnit;

                                const ssServingSize = String(item.rawNutritionLabel?.servingSize || item.nutritionFacts?.servingSize || '').trim();
                                const isExplicit100g = /\b100\s*g\b/i.test(ssServingSize);
                                const rawBasis = item.rawNutritionLabel?.basisType || item.basisType;
                                let targetServingGrams = 100;
                                if (!isExplicit100g && rawBasis !== 'per_100g' && ssServingSize) {
                                  targetServingGrams = parseServingSizeGrams(ssServingSize, weightToDisplay);
                                }

                                let servingValNum = final100gNum;
                                if (targetServingGrams !== 100 && targetServingGrams > 0) {
                                  if (finalPortionNum !== null && weightToDisplay > 0) {
                                    servingValNum = (finalPortionNum * targetServingGrams) / weightToDisplay;
                                  } else if (final100gNum !== null) {
                                    servingValNum = (final100gNum * targetServingGrams) / 100;
                                  }
                                }

                                if (servingValNum !== null) {
                                  originalDisplay = isCalorieKey ? `${Math.round(servingValNum)} kcal` : `${servingValNum.toFixed(2).replace(/0$/, '').replace(/\.$/, '')}${unit}`;
                                }

                                if (finalPortionNum !== null) {
                                  totalStr = isCalorieKey ? `${Math.round(finalPortionNum)} kcal` : `${finalPortionNum.toFixed(1).replace(/\.0$/, '')}${unit}`;
                                }
                              }

                              const isExplicitlyEstimated = (Array.isArray(item.estimatedFields) && item.estimatedFields.map((f: string) => String(f).toLowerCase()).includes(normLower)) ||
                                                           (Array.isArray(item._estimatedFields) && item._estimatedFields.map((f: string) => String(f).toLowerCase()).includes(normLower));

                              const hasLockedKeys = Array.isArray(item.lockedNutrientKeys) && item.lockedNutrientKeys.length > 0;
                              const inLockedKeys = hasLockedKeys && item.lockedNutrientKeys.some((lk: string) => {
                                const lkLower = String(lk).toLowerCase();
                                return lkLower === normLower ||
                                  lkLower === kLower ||
                                  (normLower === 'carbohydrates' && (lkLower === 'carbohydrate' || lkLower === 'carbs' || lkLower === 'totalcarbohydrate')) ||
                                  (normLower === 'totalfat' && (lkLower === 'fat' || lkLower === 'totalfat')) ||
                                  (normLower === 'totalfibre' && (lkLower === 'fiber' || lkLower === 'fibre' || lkLower === 'totalfibre')) ||
                                  (normLower === 'calories' && (lkLower === 'energy' || lkLower === 'cals'));
                              });

                              const sourceKey = item.nutrientSourceMap?.[k] || item.nutrientSourceMap?.[normKey];
                              const isVerifiedFromBrand = Boolean(
                                !isExplicitlyEstimated &&
                                (isFromRawLabel || sourceKey === 'brand_label_data' || (item.dbSource === 'brand_official' && inLockedKeys))
                              );
                              const verifiedTooltipText = (sourceKey === 'brand_label_data' || item.dbSource === 'brand_official')
                                ? (t.verifiedFromBrandData || 'Verified from brand label data')
                                : (t.verifiedFromPrintedLabel || 'Verified from printed label');

                              const isSodium = k.toLowerCase().includes('sodium') || k.toLowerCase().includes('salt');

                              return (
                                <tr key={k} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                                  <td className="py-1.5 px-2 font-medium text-theme-neutral capitalize">
                                    <div className="flex items-center gap-1">
                                      <span>{k.replace(/([A-Z])/g, ' $1').trim()}</span>
                                      {isVerifiedFromBrand && !isServingField && (
                                        <div className="inline-flex items-center ml-1 z-20">
                                          <PositionedTooltip
                                            trigger={
                                              <div
                                                className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 cursor-pointer transition-colors"
                                                aria-label={t.verifiedFromBrandLabel || "Verified from brand label"}
                                              >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-emerald-500">
                                                  <polyline points="20 6 9 17 4 12"></polyline>
                                                </svg>
                                              </div>
                                            }
                                            content={verifiedTooltipText}
                                            contentClassName="bg-slate-900/95 dark:bg-slate-950/95 text-emerald-200 border-emerald-500/30 text-center text-[10px]"
                                          />
                                        </div>
                                      )}
                                      {isSodium && saltConversionNoteText && (
                                        <div className="inline-flex items-center z-20 ml-1">
                                          <PositionedTooltip
                                            trigger={
                                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500 hover:text-blue-600 cursor-help shrink-0">
                                                <circle cx="12" cy="12" r="10"></circle>
                                                <line x1="12" y1="16" x2="12" y2="12"></line>
                                                <line x1="12" y1="8" x2="12.01" y2="8"></line>
                                              </svg>
                                            }
                                            content={saltConversionNoteText}
                                            contentClassName="bg-slate-800 text-white text-[10px]"
                                          />
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-1.5 px-2 text-theme-text-secondary relative group/tooltip">
                                    <div className="flex items-center gap-1">
                                      {originalDisplay}
                                      {k.toLowerCase().includes('calories') && item.autoCorrectedCalories && (
                                        <div className="inline-flex items-center z-50 ml-1">
                                          <PositionedTooltip
                                            trigger={
                                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 cursor-help">
                                                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
                                                <path d="M12 9v4"></path>
                                                <path d="M12 17h.01"></path>
                                              </svg>
                                            }
                                            content={t.abnormalValueMsg.replace("{item.originalCalories}", item.originalCalories).replace("{originalDisplay}", originalDisplay)}
                                            contentClassName="bg-slate-800 text-white text-[10px] text-center"
                                          />
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-1.5 px-2 text-indigo-600 dark:text-indigo-400 font-bold">
                                    {totalStr}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      )}
                      {hasEstimatedNutrients && (
                        <div className="mt-2 text-center font-sans">
                          <button
                            type="button"
                            onClick={() => toggleShowEstimated(i)}
                            className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer inline-flex items-center gap-1 py-1 px-2.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
                          >
                            <span>{isEstimatedExpanded ? t.viewLess : t.viewMore}</span>
                            <svg
                              className={`w-3.5 h-3.5 transition-transform ${isEstimatedExpanded ? 'rotate-180' : ''}`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {(() => {
                  let ingList = String(item.ingredientsList || '').trim();
                  if (!ingList) return null;
                  const isUnsweetenedDish = /unsweetened|unsweatened|tawar/i.test(String(item.name || item.originalName || ''));
                  if (isUnsweetenedDish) {
                    ingList = ingList
                      .replace(/es\s+teh\s+manis/gi, 'Es Teh Tawar')
                      .replace(/sweet\s+iced?\s+tea/gi, 'Unsweetened Iced Tea')
                      .replace(/^sweet\s+/i, 'Unsweetened ');
                  }
                  const isRedundant = 
                    ingList.toLowerCase() === String(item.name || '').trim().toLowerCase() ||
                    ingList.toLowerCase() === String(item.originalName || '').trim().toLowerCase() || 
                    ingList.toLowerCase() === String(item.keyword || '').trim().toLowerCase();
                  if (isRedundant) return null;
                  
                  return (
                    <div className="mt-2.5 p-2 bg-slate-100/60 dark:bg-slate-800/40 rounded-lg text-[9.5px] leading-normal border border-slate-200/40 dark:border-slate-700/30 text-left">
                      <span className="font-bold text-theme-text-secondary uppercase tracking-wider block mb-1 text-[8.5px]">{t.ingredientsLabel}</span>
                      <span className="text-theme-neutral font-normal">{ingList}</span>
                    </div>
                  );
                })()}

                {showWarning && (
                  <div className="mt-2 flex flex-col gap-1.5 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-800/50 rounded-lg p-2 font-sans">
                    <div className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
                      <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div className="flex flex-col">
                        <span className="text-[11px] font-bold leading-tight">
                          {missingWeight ? t.missingPortionSize : t.visualScoutUnclear}
                        </span>
                        <span className="text-[10px] font-medium leading-tight opacity-90 mt-0.5">
                          {isUnclear 
                            ? (t.lowConfidenceAnomalies ? t.lowConfidenceAnomalies.replace('{flags}', cleanAnomalyFlags.join(', ') || (t.unclearDetail || 'unclear detail')) : `Low confidence or anomalies detected (${cleanAnomalyFlags.join(', ') || 'unclear detail'}).`) 
                            : t.providePortionSize}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-1">
                      <button 
                        onClick={() => { document.getElementById('food-chat-input')?.focus(); }} 
                        className="flex-1 text-[10px] font-bold bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 py-1.5 px-3 rounded-md shadow-sm hover:bg-amber-50 dark:hover:bg-amber-900/40 active:scale-95 transition-all text-center"
                      >
                        {t.editItem}
                      </button>
                      <button 
                        onClick={() => { 
                          const targetIdx = item.scoutIndex ?? i;
                          setConfirmedIndices(prev => new Set(prev).add(targetIdx).add(i));
                          if (onConfirmItem) {
                            onConfirmItem(targetIdx);
                          }
                        }} 
                        className="flex-1 text-[10px] font-bold bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 py-1.5 px-3 rounded-md shadow-sm hover:bg-amber-50 dark:hover:bg-amber-900/40 active:scale-95 transition-all text-center"
                      >
                        {t.thisIsCorrect}
                      </button>
                    </div>
                  </div>
                )}
                {item._preservedAnomalyFlags && item._preservedAnomalyFlags.length > 0 && (
                  <div className="mt-2 text-[10px] text-theme-text-secondary font-sans px-1">
                    {t.noteAnomaly}{item._preservedAnomalyFlags.join(', ')}
                  </div>
                )}
              </div>
            );
          }).filter(Boolean);

  if (!renderedItems || renderedItems.length === 0) return null;

  const labelsContent = (
    <div className="mt-2 space-y-3 pl-2 border-l-2 border-indigo-100 dark:border-indigo-900/30">
      {renderedItems}
    </div>
  );

  if (hideOwnToggle) {
    return <div className="mt-2 text-left pt-1 font-sans">{labelsContent}</div>;
  }

  return (
    <div className="mt-2 text-left pt-1 font-sans">
      <details className="group [&_summary::-webkit-details-marker]:hidden" open={defaultOpen}>
        <summary className="flex items-center gap-1.5 cursor-pointer text-[10px] font-bold text-indigo-600 dark:text-indigo-400 select-none">
          <span>{t.viewNutritionLabels}</span>
          <svg
            className="w-3 h-3 transition-transform group-open:rotate-180"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        {labelsContent}
      </details>
    </div>
  );
}

export function checkHasNutritionLabels(activeScoutItems: any[]): boolean {
  let items = activeScoutItems;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch(e) { items = []; }
  }
  if (!Array.isArray(items) || !items.length) return false;

  const NON_NUTRIENT_LABEL_KEYS = new Set([
    'servingsize',
    'servingSize',
    'weight',
    'servingspercontainer',
    'servingsPerContainer',
    'basistype',
    'basisType',
    'isdishbasis',
    'isDishBasis',
    'compositesiblings',
    'compositeSiblings'
  ]);

  const expandedItems: any[] = [];
  (items || []).forEach(item => {
    if (!item) return;
    const subComps = (Array.isArray(item.componentsDetailList) && item.componentsDetailList.length > 0)
      ? item.componentsDetailList
      : ((Array.isArray(item.components) && item.components.length > 0)
        ? item.components
        : ((Array.isArray(item.componentsDetail) && item.componentsDetail.length > 0)
          ? item.componentsDetail
          : []));
    
    const officialSubComps: any[] = [];
    const allDishComps: any[] = [];

    if (Array.isArray(subComps) && subComps.length > 0) {
      subComps.forEach((comp: any) => {
        if (!comp) return;
        allDishComps.push(comp);
        const compSrc = String(comp.dbSource || comp.source || '').toLowerCase();
        const isStandardRef = ['canonical_dict', 'canonical', 'internal_catalog', 'usda'].includes(compSrc);
        const isCompOfficial = !isStandardRef && (comp.dbSource === 'brand_official' || comp.dbSource === 'label' || comp.dbSource === 'off' || comp.dbSource === 'open_food_facts' || comp.dbSource === 'openfoodfacts' || comp.source === 'brand_official' || comp.source === 'label' || Boolean(comp.isRealTruth) || (comp.dbId && String(comp.dbId).includes('brand_menu_')) || (comp.fdcId && String(comp.fdcId).includes('brand_menu_')) || Boolean(comp.chainName) || Boolean(comp.brand) || Boolean(comp.brandName));
        const compLabelSource = comp.baseNutrients100g || comp.primaryBase100g || comp.labelNutrientsPerServing || comp.nutrients;
        if (isCompOfficial && (comp.rawNutritionLabel || compLabelSource)) {
          const rawName = comp.primaryBaseMatchName || comp.name || comp.searchQuery || comp.keyword || comp.dish_name;
          const cleanName = String(rawName).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^[📖\s]+/, '').trim();
          const compWeight = comp.weightGrams || comp.estimatedWeightGrams || comp.primaryBaseWeightG;
          
          let compRawLabel = comp.rawNutritionLabel;
          if (compLabelSource && typeof compLabelSource === 'object') {
            const cals = compLabelSource.calories ?? compLabelSource.energy;
            if (cals != null && cals !== '') {
              const calNum = parseLabelCalories(cals) ?? Number(cals);
              compRawLabel = {
                servingSize: '100g',
                basisType: 'per_100g',
                calories: !isNaN(calNum) ? `${calNum} kcal` : `${cals}`,
                protein: compLabelSource.protein != null ? `${compLabelSource.protein}g` : undefined,
                totalFat: (compLabelSource.totalFat ?? compLabelSource.fat) != null ? `${compLabelSource.totalFat ?? compLabelSource.fat}g` : undefined,
                saturatedFat: compLabelSource.saturatedFat != null ? `${compLabelSource.saturatedFat}g` : undefined,
                totalCarbohydrate: (compLabelSource.totalCarbohydrate ?? compLabelSource.carbohydrates ?? compLabelSource.carbs) != null ? `${compLabelSource.totalCarbohydrate ?? compLabelSource.carbohydrates ?? compLabelSource.carbs}g` : undefined,
                sugar: compLabelSource.sugar != null ? `${compLabelSource.sugar}g` : (compLabelSource.addedSugar != null ? `${compLabelSource.addedSugar}g` : undefined),
                addedSugar: compLabelSource.addedSugar != null ? `${compLabelSource.addedSugar}g` : undefined,
                totalFibre: (compLabelSource.totalFibre ?? compLabelSource.fiber) != null ? `${compLabelSource.totalFibre ?? compLabelSource.fiber}g` : undefined,
                sodium: compLabelSource.sodium != null ? `${compLabelSource.sodium}mg` : undefined,
                salt: compLabelSource.salt != null ? `${compLabelSource.salt}g` : undefined
              };
            }
          }

          officialSubComps.push({
            ...comp,
            name: cleanName,
            originalName: cleanName,
            keyword: cleanName,
            chainName: comp.chainName || comp.brand || comp.brandName || null,
            brand: comp.brand || comp.chainName || comp.brandName || null,
            rawNutritionLabel: compRawLabel
          });
        }
      });
    }

    if (officialSubComps.length > 0) {
      officialSubComps.forEach((comp) => {
        expandedItems.push(comp);
      });
    }

    const isMultiCompComposite = (Array.isArray(subComps) && subComps.length >= 2) || item.dbSource === 'composite';
    const itemLabelSource = item.labelNutrientsPerServing || item.baseNutrients100g || item.primaryBase100g || item.nutritionFacts || item.nutrients || item.nutrients_per_100g || item.core_nutrients;
    let itemRawLabel = item.rawNutritionLabel;
    
    if ((!itemRawLabel || Object.keys(normalizeNutritionKeys(itemRawLabel) || {}).length === 0) && itemLabelSource && typeof itemLabelSource === 'object') {
      const cals = itemLabelSource.calories ?? itemLabelSource.energy;
      if (cals != null && cals !== '') {
        const isDishBasis = itemLabelSource.basisType === 'per_dish' || itemLabelSource.basisType === 'total' || itemLabelSource.basisType === 'per_portion' || itemLabelSource.basisType === 'per_serving' || itemLabelSource.basisType === 'per_pack';
        const itemW = getResolvedItemWeightGrams(item) || 100;
        const servingSizeStr = itemLabelSource.servingSizeGrams 
          ? `${itemLabelSource.servingSizeGrams}g` 
          : (isDishBasis ? `${itemW}g` : '100g');
        const calNum = parseLabelCalories(cals) ?? Number(cals);
        itemRawLabel = {
          servingSize: servingSizeStr,
          basisType: itemLabelSource.basisType || (isDishBasis ? 'per_dish' : 'per_100g'),
          calories: !isNaN(calNum) ? `${calNum} kcal` : `${cals}`,
          protein: itemLabelSource.protein != null ? `${itemLabelSource.protein}g` : undefined,
          totalFat: (itemLabelSource.totalFat ?? itemLabelSource.fat) != null ? `${itemLabelSource.totalFat ?? itemLabelSource.fat}g` : undefined,
          saturatedFat: itemLabelSource.saturatedFat != null ? `${itemLabelSource.saturatedFat}g` : undefined,
          totalCarbohydrate: (itemLabelSource.totalCarbohydrate ?? itemLabelSource.carbohydrates ?? itemLabelSource.carbs) != null ? `${itemLabelSource.totalCarbohydrate ?? itemLabelSource.carbohydrates ?? itemLabelSource.carbs}g` : undefined,
          sugar: itemLabelSource.sugar != null ? `${itemLabelSource.sugar}g` : (itemLabelSource.addedSugar != null ? `${itemLabelSource.addedSugar}g` : undefined),
          addedSugar: itemLabelSource.addedSugar != null ? `${itemLabelSource.addedSugar}g` : undefined,
          totalFibre: (itemLabelSource.totalFibre ?? itemLabelSource.fiber) != null ? `${itemLabelSource.totalFibre ?? itemLabelSource.fiber}g` : undefined,
          sodium: itemLabelSource.sodium != null ? `${itemLabelSource.sodium}mg` : undefined,
          salt: itemLabelSource.salt != null ? `${itemLabelSource.salt}g` : undefined
        };
      }
    }

    if (itemRawLabel && Object.keys(normalizeNutritionKeys(itemRawLabel) || {}).length > 0) {
      expandedItems.push({
        ...item,
        rawNutritionLabel: itemRawLabel
      });
    }
  });

  const processedItems = expandedItems.map(item => {
    if (!item) return item;
    let parsedRaw = item.rawNutritionLabel;
    if (typeof parsedRaw === 'string') {
      try { parsedRaw = JSON.parse(parsedRaw.replace(/'/g, '"')); } catch (e) { parsedRaw = null; }
    }
    let correctedRaw = normalizeNutritionKeys(parsedRaw);
    const isRealTruth = item.dbSource === 'label' || item.dbSource === 'brand_official' || item.dbSource === 'label_partial' || item.dbSource === 'off' || item.dbSource === 'open_food_facts' || item.dbSource === 'openfoodfacts' || item.source === 'label' || item.source === 'brand_official' || Boolean(item.isRealTruth);
    const labelSource = item.labelNutrientsPerServing || item.baseNutrients100g || item.primaryBase100g || item.nutritionFacts || item.nutrients || item.nutrients_per_100g || item.core_nutrients;
    const hasCoreMacros = correctedRaw && typeof correctedRaw === 'object' ? ['calories', 'protein', 'totalfat', 'fat', 'carbohydrates', 'totalcarbohydrate', 'energy'].some(k => correctedRaw[k] !== undefined && correctedRaw[k] !== null && correctedRaw[k] !== '' && correctedRaw[k] !== '-') : false;

    if ((!correctedRaw || typeof correctedRaw !== 'object' || Object.keys(correctedRaw).length === 0 || !hasCoreMacros) && labelSource) {
      const source = labelSource;
      if (source && typeof source === 'object') {
        const cals = source.calories ?? source.energy;
        if (cals != null && cals !== '') {
          const isDishBasis = source.basisType === 'per_dish' || source.basisType === 'total' || source.basisType === 'per_portion' || source.basisType === 'per_serving' || source.basisType === 'per_pack';
          const itemW = getResolvedItemWeightGrams(item) || 100;
          const servingSizeStr = source.servingSizeGrams 
            ? `${source.servingSizeGrams}g` 
            : (isDishBasis ? `${itemW}g` : '100g');
          const calNum = parseLabelCalories(cals) ?? Number(cals);
          correctedRaw = {
            servingSize: servingSizeStr,
            basisType: source.basisType || (isDishBasis ? 'per_dish' : 'per_100g'),
            calories: !isNaN(calNum) ? `${calNum} kcal` : `${cals}`,
            protein: source.protein != null ? `${source.protein}g` : undefined,
            totalFat: (source.totalFat ?? source.fat) != null ? `${source.totalFat ?? source.fat}g` : undefined,
            saturatedFat: source.saturatedFat != null ? `${source.saturatedFat}g` : undefined,
            totalCarbohydrate: (source.totalCarbohydrate ?? source.carbohydrates ?? source.carbs) != null ? `${source.totalCarbohydrate ?? source.carbohydrates ?? source.carbs}g` : undefined,
            sugar: source.sugar != null ? `${source.sugar}g` : (source.addedSugar != null ? `${source.addedSugar}g` : undefined),
            addedSugar: source.addedSugar != null ? `${source.addedSugar}g` : undefined,
            totalFibre: (source.totalFibre ?? source.fiber) != null ? `${source.totalFibre ?? source.fiber}g` : undefined,
            sodium: source.sodium != null ? `${source.sodium}mg` : undefined,
            salt: source.salt != null ? `${source.salt}g` : undefined
          };
        }
      }
    }
    
    return { 
      ...item, 
      rawNutritionLabel: correctedRaw
    };
  });

  const hasAnyMeaningfulLabel = processedItems.some(item => {
    if (!item || !item.rawNutritionLabel || typeof item.rawNutritionLabel !== 'object') return false;
    const meaningfulKeys = Object.keys(item.rawNutritionLabel).filter(k => 
      !NON_NUTRIENT_LABEL_KEYS.has(k) &&
      !NON_NUTRIENT_LABEL_KEYS.has(k.toLowerCase()) &&
      item.rawNutritionLabel[k] !== undefined &&
      item.rawNutritionLabel[k] !== null &&
      item.rawNutritionLabel[k] !== '' &&
      item.rawNutritionLabel[k] !== '-' &&
      item.rawNutritionLabel[k] !== '--'
    );
    return meaningfulKeys.length > 0;
  });

  return hasAnyMeaningfulLabel;
}

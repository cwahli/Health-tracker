import { NUTRIENT_KEYS } from "./src/utils/nutrients";
import { resolveLabelEnergyKcal, shouldPreferLabelEnergy } from "./src/utils/labelEnergy";
import { getTraceNutrientsForFoodType, getCookingMethodModifier, calculateUniversalAddedNutrients, BEVERAGE_PATTERN, lookupCanonicalBaseFood } from "./server_food_db";
import { classifyUniversalPhysicalFormV3 } from "./server_matching_engine";
import { decidePrepAddition } from "./server_prep_policy";
import { namesReferToSameFood } from "./server_scout_reconcile";
import { 
  sanitizeMealWeight, 
  sanitizeString,
  extractUSDANutrientsPer100g, 
  extractOFFNutrientsPer100g,
  checkIfItemIsAlreadyPrepared,
  applyNutrientRealityChecks,
  backfillSolubleFibre
} from "./server_pure_helpers";
import { deduceSugarBreakdown } from "./server_sugar_engine";

export function cleanNutrientNumber(val: any): number {
  if (val === null || val === undefined || isNaN(Number(val))) return 0;
  let num = Number(val);
  if (num < 0) num = 0;
  num = Math.round(num * 100) / 100;
  if (num >= 10) {
    num = Math.round(num * 10) / 10;
  }
  return num;
}

export interface AggregatedNutrientsResult {
  nutrients: Record<string, number>;
  itemsBreakdown: any[];
}

export function aggregateItemsNutrients(
  rawItems: any[],
  totalWeightGrams: number,
  dbMatchMap: Map<string, any>,
  databaseMatchesArray: any[],
  addDebugLog: (msg: string) => void
): AggregatedNutrientsResult {
  const nutrients: Record<string, number> = {};
  for (const key of NUTRIENT_KEYS) {
    nutrients[key] = 0;
  }

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { nutrients, itemsBreakdown: [] };
  }

  const itemsBreakdown = rawItems.map((item: any) => {
    const canonicalName = sanitizeString(item.canonicalDbName || item.name, "Unspecified Item");
    const itemTruthNutrients = item.truthNutrients || {};
    const itemLockedKeys = new Set<string>(item.lockedNutrientKeys || []);
    const itemWeight = sanitizeMealWeight(item.weightGrams, Math.round(totalWeightGrams / rawItems.length));
    const dbSource = sanitizeString(item.dbSource, "estimated");
    const dbId = item.dbId !== undefined && item.dbId !== null ? String(item.dbId) : null;
    
    const itemNutrients: Record<string, any> = {};
    for (const key of NUTRIENT_KEYS) {
      itemNutrients[key] = 0;
    }

    // Computed early (was previously computed near the end of this loop, AFTER the sugar
    // engine calls below — which meant deduceSugarBreakdown() never saw the real physicalForm
    // and whole-food/dairy sugar immunity never fired). Single source of truth for the rest
    // of this item's processing.
    const physicalFormClassification = item.physicalFormClassification || classifyUniversalPhysicalFormV3({
      name: canonicalName,
      canonicalDbName: canonicalName,
      originalLocalName: item.originalLocalName || item.originalName,
      keyword: item.keyword || canonicalName,
      visualIngredients: item.visualIngredients,
      components: item.components
    });

    const labelData = item.labelNutrientsPerServing || item.syntheticBase100g;
    // A verified catalog match owns the whole panel once applied (STEP 2 below),
    // so the printed-label energy gate must stand down rather than overrule it.
    let verifiedDbApplied = false;
    let servingSizeGrams = labelData && labelData.servingSizeGrams !== undefined && labelData.servingSizeGrams !== null
      ? Number(labelData.servingSizeGrams)
      : 0;
    if (labelData && (!servingSizeGrams || isNaN(servingSizeGrams) || servingSizeGrams <= 0)) {
      servingSizeGrams = itemWeight > 0 ? itemWeight : 100;
    }
    if (labelData) {
      const saltVal = labelData.salt !== undefined && labelData.salt !== null ? Number(labelData.salt) : 0;
      const sodVal = labelData.sodium !== undefined && labelData.sodium !== null ? Number(labelData.sodium) : 0;
      if (!isNaN(saltVal) && saltVal > 0) {
        if (!sodVal || sodVal < saltVal * 200) {
          const saltGrams = saltVal >= 20 ? saltVal / 1000 : saltVal;
          labelData.sodium = Math.round(saltGrams * 400);
        }
      }
    }

    // When printed-label (or brand) truth is locked, force those portion totals first.
    // Multi-component primaryBase100g may still carry USDA density for micros/receipt
    // sub-rows, but locked macros must never be recomputed from that density
    // (debug: Co-op beef topside 25g label 37/7.3/63 → USDA 35/5.5/11).
    const applyTruthLocks = (target: Record<string, any>) => {
      Object.entries(itemTruthNutrients).forEach(([key, val]) => {
        if (!itemLockedKeys.has(key)) return;
        const num = Number(val);
        if (Number.isFinite(num)) target[key] = num;
      });
    };

    if (item.primaryBase100g) {
      // It's a multi-component item! Calculate base and sauces and cooking method additions deterministically
      const raw100 = { ...item.primaryBase100g };
      if (raw100.salt !== undefined && raw100.salt !== null) {
        const saltVal = Number(raw100.salt);
        const sodVal = raw100.sodium !== undefined && raw100.sodium !== null ? Number(raw100.sodium) : 0;
        if (!isNaN(saltVal) && saltVal > 0 && (!sodVal || sodVal < saltVal * 200)) {
          const saltGrams = saltVal >= 20 ? saltVal / 1000 : saltVal;
          raw100.sodium = Math.round(saltGrams * 400);
        }
      }
      const itemWeightG = itemWeight;
      
      let baseW = item.primaryBaseWeightG || itemWeightG;
      let sauceWSum = 0;
      let scaleRatio = 1;
      
      if (item.saucesDetailList && item.saucesDetailList.length > 0) {
        sauceWSum = item.saucesDetailList.reduce((acc: number, s: any) => acc + (s.weightGrams || 0), 0);
      }
      
      if (item.primaryBaseWeightG) {
         const originalWeight = item.primaryBaseWeightG + sauceWSum;
         if (originalWeight > 0 && Math.abs(originalWeight - itemWeightG) > 2) {
            scaleRatio = itemWeightG / originalWeight;
            baseW = Math.round(item.primaryBaseWeightG * scaleRatio);
         }
      } else if (sauceWSum > 0) {
         if (baseW === itemWeightG && sauceWSum < itemWeightG) {
            baseW = Math.max(10, itemWeightG - sauceWSum);
         }
      }

      const isDishBasis = raw100.basisType === 'total' || raw100.basisType === 'per_dish';
      const baseFactor = isDishBasis ? 1 : (baseW / 100);

      addDebugLog(`[Nutrient] "${canonicalName}" multi-component aggregation. raw100=${JSON.stringify(raw100)}, baseW=${baseW}, baseFactor=${baseFactor}`);

      // 1. Calculate base ingredient nutrients
      const portionBaseCal = Math.round((raw100.calories || 0) * baseFactor);
      const portionBaseP = Math.round((raw100.protein || 0) * baseFactor * 10) / 10;
      const portionBaseFat = Math.round((raw100.totalFat || 0) * baseFactor * 10) / 10;
      const portionBaseSatFat = Math.round((raw100.saturatedFat || 0) * baseFactor * 10) / 10;
      const portionBaseTransFat = Math.round((raw100.transFat || 0) * baseFactor * 10) / 10;
      const portionBaseNa = Math.round((raw100.sodium || 0) * baseFactor);
      const portionBaseCarbs = Math.round((raw100.carbohydrates || 0) * baseFactor * 10) / 10;
      const portionBaseTotalSugar = Math.round((raw100.sugar !== undefined ? raw100.sugar : 0) * baseFactor * 10) / 10;
      const portionBaseSugar = Math.round((raw100.addedSugar !== undefined ? raw100.addedSugar : 0) * baseFactor * 10) / 10;
      const portionBaseK = Math.round((raw100.potassium || 0) * baseFactor);
      const portionBaseFibre = Math.round((raw100.totalFibre !== undefined ? raw100.totalFibre : (raw100.fiber !== undefined ? raw100.fiber : (raw100.fibre !== undefined ? raw100.fibre : 0))) * baseFactor * 10) / 10;
      let portionBaseSolubleFibre = Math.round((raw100.solubleFibre || 0) * baseFactor * 10) / 10;
      if (portionBaseFibre > 0 && portionBaseSolubleFibre === 0) {
        const compN = { totalFibre: portionBaseFibre, solubleFibre: 0 };
        backfillSolubleFibre(compN, canonicalName || item.keyword || "");
        portionBaseSolubleFibre = compN.solubleFibre || 0;
      }

      let sumCal = portionBaseCal;
      let sumP = portionBaseP;
      let sumFat = portionBaseFat;
      let sumSatFat = portionBaseSatFat;
      let sumTransFat = portionBaseTransFat;
      let sumNa = portionBaseNa;
      let sumCarbs = portionBaseCarbs;
      let sumTotalSugar = portionBaseTotalSugar;
      let sumSugar = portionBaseSugar;
      let sumK = portionBaseK;
      let sumFibre = portionBaseFibre;
      let sumSolubleFibre = portionBaseSolubleFibre;

      // 2. Add sauces
      if (item.saucesDetailList && Array.isArray(item.saucesDetailList) && item.saucesDetailList.length > 0) {
        item.saucesDetailList.forEach((s: any) => {
          const sCal = Math.round((s.calories || 0) * scaleRatio);
          const sP = Math.round((s.protein || 0) * scaleRatio * 10) / 10;
          const sF = Math.round((s.totalFat || 0) * scaleRatio * 10) / 10;
          const sSatFat = Math.round((s.saturatedFat !== undefined ? s.saturatedFat : 0.3) * scaleRatio * 10) / 10;
          const sTransFat = Math.round((s.transFat || 0) * scaleRatio * 10) / 10;
          const sNa = Math.round((s.sodium || 0) * scaleRatio);
          const sCarbs = Math.round((s.carbohydrates || 0) * scaleRatio * 10) / 10;
          const sTotalSugar = Math.round((s.sugar || 0) * scaleRatio * 10) / 10;
          const sSugar = Math.round((s.addedSugar || 0) * scaleRatio * 10) / 10;
          const sK = Math.round((s.potassium || 0) * scaleRatio);
          const sFibre = Math.round((s.totalFibre || s.fiber || 0) * scaleRatio * 10) / 10;
          const sSolubleFibre = Math.round((s.solubleFibre || 0) * scaleRatio * 10) / 10;

          sumCal += sCal;
          sumP += sP;
          sumFat += sF;
          sumSatFat += sSatFat;
          sumTransFat += sTransFat;
          sumNa += sNa;
          sumCarbs += sCarbs;
          sumTotalSugar += sTotalSugar;
          sumSugar += sSugar;
          sumK += sK;
          sumFibre += sFibre;
          sumSolubleFibre += sSolubleFibre;
        });
      }

      // 3. Add cooking modifiers
      let cookingCal = 0;
      let cookingFat = 0;
      let cookingSatFat = 0;
      let cookingNa = 0;

      const itemKwLower = (item.keyword || item.name || item.canonicalDbName || "").toLowerCase();
      const isBeverage = BEVERAGE_PATTERN.test(itemKwLower);

      if (!isBeverage) {
        let rawMethod = (item.cookingMethod && item.cookingMethod !== 'unknown') ? item.cookingMethod : null;
        if (!rawMethod) {
          const kwLower = (item.keyword || item.name || "").toLowerCase();
          if (kwLower.includes('wedge') || kwLower.includes('fries') || kwLower.includes('chip') || kwLower.includes('nugget')) {
            rawMethod = 'deep_fried';
          } else if (kwLower.includes('vegetable') || kwLower.includes('veg') || kwLower.includes('corn') || kwLower.includes('pea') || kwLower.includes('carrot') || kwLower.includes('broccoli')) {
            rawMethod = 'boiled';
          } else {
            rawMethod = 'pan_fried';
          }
        }

        const hasSauces = (item.saucesDetailList && item.saucesDetailList.length > 0 && item.saucesDetailList.some((s: any) => (s.sodium || 0) > 0)) ||
          Boolean((item.name || item.canonicalDbName || "").toLowerCase().match(/\b(sauce|mayo|mayonnaise|dressing|gravy|salsa)\b/));
        
        const prepRes = decidePrepAddition({
          weightGrams: itemWeightG,
          cookingMethod: rawMethod,
          dishName: item.originalName || item.name || item.keyword,
          keyword: item.keyword,
          canonicalDbName: item.canonicalDbName,
          foodType: item.foodType,
          componentCount: Array.isArray(item.components) ? item.components.length : 0,
          hasLockedTruth: Boolean(item.hasLockedTruth || (item.truthNutrients && Object.keys(item.truthNutrients).length >= 11)),
          isAlreadyPrepared: checkIfItemIsAlreadyPrepared(item.originalName || item.name || item.keyword, item.keyword || '', item.dbSource || dbSource, item.truthNutrients?.sodium || (labelData && labelData.sodium) || 0) || Boolean(item.isDishEstimate || (item.truthNutrients && Object.keys(item.truthNutrients).length > 0)),
          cookingAdded: item.cookingAdded || null,
          visualSheen: 0.5,
          visualCoating: 0.5,
          diningEnvironment: item.diningEnvironment || 'unknown',
          hasSauceOrDressing: hasSauces,
          physicalForm: physicalFormClassification.physicalForm,
          dbSource: item.dbSource || dbSource,
        });

        cookingCal = prepRes.addedCalories;
        cookingFat = prepRes.addedFat;
        cookingSatFat = prepRes.addedSaturatedFat;
        cookingNa = prepRes.addedSodium;
      }

      sumCal += cookingCal;
      sumFat += cookingFat;
      sumSatFat += cookingSatFat;
      sumNa += cookingNa;

      itemNutrients.calories = sumCal;
      itemNutrients.protein = parseFloat(sumP.toFixed(2));
      itemNutrients.totalFat = parseFloat(sumFat.toFixed(2));
      itemNutrients.saturatedFat = parseFloat(sumSatFat.toFixed(2));
      itemNutrients.transFat = parseFloat(sumTransFat.toFixed(2));
      itemNutrients.sodium = sumNa;
      itemNutrients.carbohydrates = parseFloat(sumCarbs.toFixed(2));
      {
        const componentNames = [
          item.ingredientsList,
          ...(Array.isArray(item.components) ? item.components.map((c: any) => (typeof c === 'string' ? c : c.searchQuery || c.name || '')) : []),
          ...(Array.isArray(item.componentsDetailList) ? item.componentsDetailList.map((c: any) => c.name || c.searchQuery || '') : []),
        ].filter(Boolean).join(', ');
        const sugarResult = deduceSugarBreakdown({
          totalSugar: sumTotalSugar > 0 ? sumTotalSugar : sumSugar,
          addedSugarPrinted: null,
          carbohydrates: sumCarbs,
          totalFibre: sumFibre,
          physicalForm: physicalFormClassification.physicalForm,
          ingredientsList: componentNames || item.ingredientsList,
          foodName: canonicalName || item.keyword || item.originalName,
        });
        itemNutrients.sugar = sugarResult.sugar;
        itemNutrients.addedSugar = sugarResult.addedSugar;
      }
      itemNutrients.potassium = sumK;
      itemNutrients.totalFibre = parseFloat(sumFibre.toFixed(2));
      itemNutrients.solubleFibre = parseFloat(sumSolubleFibre.toFixed(2));

      // Re-apply printed locks immediately so the "summing components" log reflects truth
      applyTruthLocks(itemNutrients);

      addDebugLog(`[Nutrient] "${canonicalName}" computed DETERMINISTICALLY by summing components: Cal=${itemNutrients.calories}, Protein=${itemNutrients.protein}, Fat=${itemNutrients.totalFat}, SatFat=${itemNutrients.saturatedFat}, Sodium=${itemNutrients.sodium}, AddedSugar=${itemNutrients.addedSugar}, TotalFibre=${itemNutrients.totalFibre}${itemLockedKeys.size ? ` (locks=${Array.from(itemLockedKeys).join(',')})` : ''}`);
    } else {
      // STEP 1: Apply LLM core-11 estimate (present for label and estimated items)
      if (labelData && servingSizeGrams > 0) {
        const scaleFactor = itemWeight / servingSizeGrams;
        for (const key of NUTRIENT_KEYS) {
          if (labelData[key] !== undefined && labelData[key] !== null) {
            itemNutrients[key] = parseFloat((Number(labelData[key]) * scaleFactor).toFixed(2));
          }
        }
        addDebugLog(`[Nutrient] "${canonicalName}" core-11 from LLM estimate (servingSizeGrams=${servingSizeGrams}).`);
      } else if (dbSource === "estimated") {
        addDebugLog(`[Nutrient Warning] "${canonicalName}" is 'estimated' but LLM did not provide labelNutrientsPerServing. Core-11 will be zero.`);
        itemNutrients.isUnverified = true;
      }

      // STEP 2: Override or reinforce core-11 with verified DB data from dbMatchMap or databaseMatchesArray
      if (dbId) {
        const hasInMap = dbMatchMap.has(dbId);
        const match = !hasInMap ? databaseMatchesArray.find((m: any) => m.id === dbId) : null;
        if (hasInMap) {
          const baseNutrientsPer100g = dbMatchMap.get(dbId);
          verifiedDbApplied = true;
          addDebugLog(`[Nutrient] "${canonicalName}" STEP 2 fallback override. baseNutrientsPer100g=${JSON.stringify(baseNutrientsPer100g)}`);
          const factor = ((baseNutrientsPer100g as any)?.basisType === 'total' || (baseNutrientsPer100g as any)?.basisType === 'per_dish') ? 1 : (itemWeight / 100);
          for (const key of NUTRIENT_KEYS) {
            if (baseNutrientsPer100g[key] !== undefined && baseNutrientsPer100g[key] !== null) {
              itemNutrients[key] = parseFloat((baseNutrientsPer100g[key] * factor).toFixed(2));
            }
          }
          addDebugLog(`[Nutrient] "${canonicalName}" core-11 reinforced by dbMatchMap (source=${dbSource}, dbId=${dbId}).`);
        } else if (match) {
          const baseNutrientsPer100g = dbSource === "usda" ? extractUSDANutrientsPer100g(match) : extractOFFNutrientsPer100g(match);
          const factor = ((baseNutrientsPer100g as any)?.basisType === 'total' || (baseNutrientsPer100g as any)?.basisType === 'per_dish') ? 1 : (itemWeight / 100);
          for (const key of NUTRIENT_KEYS) {
            if (baseNutrientsPer100g[key] !== undefined && baseNutrientsPer100g[key] !== null) {
              itemNutrients[key] = parseFloat((baseNutrientsPer100g[key] * factor).toFixed(2));
            }
          }
          verifiedDbApplied = true;
          addDebugLog(`[Nutrient] "${canonicalName}" core-11 reinforced by match object.`);
        }
      }

      // STEP 2.1: Fallback to canonical base food or database lookup if nutrients are zero or placeholder-zero macros
      const isZeroMacros = (itemNutrients.calories === 0) ||
        (itemNutrients.calories > 0 && itemNutrients.protein === 0 && itemNutrients.totalFat === 0 && itemNutrients.carbohydrates === 0);

      if (isZeroMacros) {
        if (itemNutrients.calories === 0 && Array.isArray(databaseMatchesArray) && databaseMatchesArray.length > 0) {
          const matchQuery = (canonicalName || item.keyword || item.originalName || '').toLowerCase();
          const dbMatch = databaseMatchesArray.find((m: any) => {
            const mName = (m.name || m.description || '').toLowerCase();
            return mName.includes(matchQuery) || matchQuery.includes(mName) || namesReferToSameFood(mName, matchQuery);
          });
          if (dbMatch && dbMatch.calories && Number(dbMatch.calories) > 0) {
            itemNutrients.calories = Number(dbMatch.calories);
            if (dbMatch.id && !item.dbId) item.dbId = dbMatch.id;
            if (dbMatch.brandName && !item.chainName) item.chainName = dbMatch.brandName;
          }
        }

        const canonical = lookupCanonicalBaseFood(canonicalName || item.keyword || item.originalName || '');
        if (canonical) {
          addDebugLog(`[Nutrient Fallback] "${canonicalName}" resolved from canonical base food: ${JSON.stringify(canonical)}`);
          const targetKcal = itemNutrients.calories > 0 ? itemNutrients.calories : Math.round(canonical.calories * (itemWeight / 100));
          const base100Kcal = Math.round(targetKcal / (itemWeight / 100));
          const ratio = canonical.calories > 0 ? (base100Kcal / canonical.calories) : 1;

          item.primaryBase100g = {
            servingSizeGrams: 100,
            basisType: 'per_100g',
            calories: base100Kcal,
            protein: parseFloat((canonical.protein * ratio).toFixed(1)),
            totalFat: parseFloat((canonical.totalFat * ratio).toFixed(1)),
            saturatedFat: parseFloat((canonical.saturatedFat * ratio).toFixed(1)),
            carbohydrates: parseFloat((canonical.carbohydrates * ratio).toFixed(1)),
            sodium: Math.round(canonical.sodium * ratio),
            sugar: canonical.sugar ? parseFloat((canonical.sugar * ratio).toFixed(1)) : 0,
            totalFibre: canonical.totalFibre ? parseFloat((canonical.totalFibre * ratio).toFixed(1)) : 0,
            potassium: canonical.potassium ? Math.round(canonical.potassium * ratio) : 0
          };
          for (const [k, v] of Object.entries(canonical)) {
            if (typeof v === 'number' && item.primaryBase100g[k] === undefined) {
              item.primaryBase100g[k] = parseFloat((v * ratio).toFixed(2));
            }
          }
          item.primaryBaseMatchName = canonicalName;

          const fPortion = itemWeight / 100;
          for (const key of NUTRIENT_KEYS) {
            if (item.primaryBase100g[key] !== undefined && item.primaryBase100g[key] !== null) {
              itemNutrients[key] = parseFloat((item.primaryBase100g[key] * fPortion).toFixed(2));
            }
          }
          itemNutrients.calories = Math.round(targetKcal);
        } else if (itemNutrients.calories > 0) {
          // Has calories (e.g. 783 kcal from brand OCR) but 0 macros: extrapolate macros from foodType/generic ratios
          const base100Kcal = Math.round(itemNutrients.calories / (itemWeight / 100));
          const defaultP = (itemWeight * 0.12);
          const defaultF = (itemNutrients.calories * 0.40) / 9;
          const defaultC = (itemNutrients.calories - (defaultP * 4) - (defaultF * 9)) / 4;
          const f100 = 100 / itemWeight;

          item.primaryBase100g = {
            servingSizeGrams: 100,
            basisType: 'per_100g',
            calories: base100Kcal,
            protein: parseFloat((defaultP * f100).toFixed(1)),
            totalFat: parseFloat((defaultF * f100).toFixed(1)),
            saturatedFat: parseFloat((defaultF * 0.25 * f100).toFixed(1)),
            carbohydrates: parseFloat((defaultC * f100).toFixed(1)),
            sodium: Math.round((itemNutrients.calories * 1.8) * f100)
          };
          item.primaryBaseMatchName = canonicalName;

          itemNutrients.protein = parseFloat(Math.max(5, defaultP).toFixed(1));
          itemNutrients.totalFat = parseFloat(Math.max(5, defaultF).toFixed(1));
          itemNutrients.saturatedFat = parseFloat((itemNutrients.totalFat * 0.25).toFixed(1));
          itemNutrients.carbohydrates = parseFloat(Math.max(10, defaultC).toFixed(1));
          itemNutrients.sodium = Math.round(itemNutrients.calories * 1.8);
          addDebugLog(`[Nutrient Backfill] "${canonicalName}" extrapolated macros for ${itemNutrients.calories} kcal: P=${itemNutrients.protein}g, F=${itemNutrients.totalFat}g, C=${itemNutrients.carbohydrates}g, Na=${itemNutrients.sodium}mg.`);
        }
      }

      // STEP 2.2: Deep Micronutrient Imputation
      // If we have calories (e.g. from LLM core-11 estimation or label), but deep micronutrients are still 0,
      // we can scale the canonical/database nutrients to fill in the blanks.
      if (!isZeroMacros && itemNutrients.calories > 0) {
        let fallbackBase100g: Record<string, any> | null = null;
        
        if (Array.isArray(databaseMatchesArray) && databaseMatchesArray.length > 0) {
          const matchQuery = (canonicalName || item.keyword || item.originalName || '').toLowerCase();
          const dbMatch = databaseMatchesArray.find((m: any) => {
            const mName = (m.name || m.description || '').toLowerCase();
            return mName.includes(matchQuery) || matchQuery.includes(mName) || namesReferToSameFood(mName, matchQuery);
          });
          if (dbMatch) {
            fallbackBase100g = dbSource === "usda" ? extractUSDANutrientsPer100g(dbMatch) : extractOFFNutrientsPer100g(dbMatch);
          }
        }
        
        if (!fallbackBase100g) {
          const canonical = lookupCanonicalBaseFood(canonicalName || item.keyword || item.originalName || '');
          if (canonical) fallbackBase100g = canonical;
        }

        if (fallbackBase100g) {
          const canonicalKcal = Number(fallbackBase100g.calories) || 0;
          const ratio = canonicalKcal > 0 ? (itemNutrients.calories / canonicalKcal) : (itemWeight / 100);
          
          let imputedCount = 0;
          const excludeFromImputation = new Set(['calories', 'protein', 'totalFat', 'carbohydrates']);
          
          for (const key of NUTRIENT_KEYS) {
            if (excludeFromImputation.has(key)) continue;
            if ((itemNutrients[key] === 0 || itemNutrients[key] === undefined) && fallbackBase100g[key] !== undefined && fallbackBase100g[key] !== null) {
              const val = parseFloat((Number(fallbackBase100g[key]) * ratio).toFixed(2));
              if (val > 0) {
                itemNutrients[key] = val;
                imputedCount++;
              }
            }
          }
          if (imputedCount > 0) {
            addDebugLog(`[Nutrient Imputation] "${canonicalName}" imputed ${imputedCount} missing micronutrients from fallback data.`);
          }
        }
      }
    }

    // STEP 2.5: Apply cooking method modifiers (fat, calories, sodium)
    const cookingMethod = item.cookingMethod || 'unknown';
    const visualSheen = item.visualSheen !== undefined ? item.visualSheen : 0.5;
    const visualCoating = item.visualCoating !== undefined ? item.visualCoating : 0.5;
    const diningEnvironment = item.diningEnvironment || 'unknown';
    const nameLowerForMatrix = canonicalName.toLowerCase();
    const foodMatrix = (item.foodType === 'ultra_processed' || item.foodType === 'root_veg' || nameLowerForMatrix.includes('potato') || nameLowerForMatrix.includes('wedge') || nameLowerForMatrix.includes('fry') || nameLowerForMatrix.includes('fries') || nameLowerForMatrix.includes('chip')) ? 'CELLULAR_STARCH' : nameLowerForMatrix;
    
    // Check if the item is already prepared or seasoned to avoid "double-salting"
    let baselineSodium: number | undefined = undefined;
    if (item.primaryBase100g && item.primaryBase100g.sodium !== undefined) {
      baselineSodium = item.primaryBase100g.sodium;
    } else if (item.labelNutrientsPerServing && item.labelNutrientsPerServing.sodium !== undefined) {
      baselineSodium = item.labelNutrientsPerServing.sodium;
    }
    const isAlreadyPrepared = checkIfItemIsAlreadyPrepared(canonicalName, item.keyword || "", dbSource, baselineSodium);
    const hasSauceOrDressing = (item.saucesDetailList && item.saucesDetailList.length > 0 && item.saucesDetailList.some((s: any) => (s.sodium || 0) > 0)) ||
      Boolean((canonicalName || "").toLowerCase().match(/\b(sauce|mayo|mayonnaise|dressing|gravy|salsa)\b/));

    const addedNutrients = decidePrepAddition({
      weightGrams: itemWeight,
      cookingMethod: cookingMethod,
      dishName: canonicalName,
      keyword: item.keyword,
      canonicalDbName: item.canonicalDbName,
      foodType: item.foodType,
      componentCount: Array.isArray(item.components) ? item.components.length : 0,
      hasLockedTruth: Boolean(item.hasLockedTruth || (itemTruthNutrients && Object.keys(itemTruthNutrients).length >= 11)),
      isAlreadyPrepared: isAlreadyPrepared,
      cookingAdded: item.cookingAdded || null,
      visualSheen: visualSheen,
      visualCoating: visualCoating,
      diningEnvironment: diningEnvironment,
      hasSauceOrDressing: hasSauceOrDressing,
      physicalForm: physicalFormClassification.physicalForm,
      dbSource: item.dbSource || dbSource,
    });

    if ((addedNutrients.addedFat > 0 || addedNutrients.addedSodium > 0) && dbSource !== 'estimated' && !item.primaryBase100g) {
      itemNutrients.totalFat = parseFloat((itemNutrients.totalFat + addedNutrients.addedFat).toFixed(2));
      itemNutrients.saturatedFat = parseFloat((itemNutrients.saturatedFat + addedNutrients.addedSaturatedFat).toFixed(2));
      itemNutrients.calories = parseFloat((itemNutrients.calories + addedNutrients.addedCalories).toFixed(1));
      itemNutrients.sodium = parseFloat((itemNutrients.sodium + addedNutrients.addedSodium).toFixed(1));
      addDebugLog(`[Nutrient Modifier] Applied universal adhesion equation for "${canonicalName}": added +${addedNutrients.addedFat.toFixed(2)}g fat, +${addedNutrients.addedCalories.toFixed(1)} kcal, +${addedNutrients.addedSodium.toFixed(1)}mg sodium.`);
    }

    // Pre-apply truth locks so reality checks validate against locked truth values
    Object.entries(itemTruthNutrients).forEach(([key, val]) => {
      const num = Number(val);
      if (Number.isFinite(num)) {
        itemNutrients[key] = num;
      }
    });

    // DIETITIAN REALITY CHECK: Sodium & Macro Sanity Check (Consolidated)
    applyNutrientRealityChecks(
      item.originalName || item.originalLocalName || item.keyword || canonicalName,
      itemWeight,
      itemNutrients,
      addedNutrients.addedSodium,
      addDebugLog,
      dbSource,
      {
        originalName: item.originalName || item.originalLocalName || item.keyword,
        keyword: item.keyword,
        componentCount: Array.isArray(item.components) ? item.components.length : 0,
        physicalForm: physicalFormClassification.physicalForm,
        chainName: item.chainName || null,
        syntheticBase100g: item.syntheticBase100g,
      }
    );

    // Zero-macro fallback for essential fields
    if (isNaN(itemNutrients.calories) || itemNutrients.calories < 0) itemNutrients.calories = 0;
    if (isNaN(itemNutrients.protein) || itemNutrients.protein < 0) itemNutrients.protein = 0;
    if (isNaN(itemNutrients.totalFat) || itemNutrients.totalFat < 0) itemNutrients.totalFat = 0;
    if (isNaN(itemNutrients.carbohydrates) || itemNutrients.carbohydrates < 0) itemNutrients.carbohydrates = 0;

    // STEP 3: Derive the 20 trace nutrients from authentic DB data or food-type classification
    let foodType = item.foodType;
    if (!foodType || foodType === 'unknown') {
      if (item.primaryBase100g && (item.primaryBase100g as any).foodType) {
        foodType = (item.primaryBase100g as any).foodType;
      } else {
        const canonicalBase = lookupCanonicalBaseFood(canonicalName) || lookupCanonicalBaseFood(item.name || "") || lookupCanonicalBaseFood(item.originalName || "") || lookupCanonicalBaseFood(item.keyword || "");
        if (canonicalBase?.foodType) {
          foodType = canonicalBase.foodType;
        }
      }
    }
    if (!foodType || foodType === 'unknown') {
      const lower = (canonicalName + " " + (item.keyword || "") + " " + (item.originalName || "")).toLowerCase();
      if (/\b(oat|oats|oatmeal|wheat|bread|rice|pasta|noodle|grain|cereal|flour|quinoa|barley|rye|porridge)\b/.test(lower)) foodType = 'grain';
      else if (/\b(milk|dairy|cheese|yogurt|butter|cream|latte|cappuccino)\b/.test(lower)) foodType = 'dairy';
      else if (/\b(chicken|turkey|duck|poultry)\b/.test(lower)) foodType = 'poultry';
      else if (/\b(beef|pork|lamb|steak|bacon|sausage|meat)\b/.test(lower)) foodType = 'red_meat';
      else if (/\b(salmon|tuna|mackerel|sardine|trout)\b/.test(lower)) foodType = 'fish_fatty';
      else if (/\b(cod|haddock|tilapia|halibut|bass|whitefish|fish)\b/.test(lower)) foodType = 'fish_lean';
      else if (/\b(shrimp|prawn|crab|lobster|mussel|clam|oyster|squid|calamari)\b/.test(lower)) foodType = 'shellfish';
      else if (/\b(egg|eggs|omelet|omelette)\b/.test(lower)) foodType = 'egg';
      else if (/\b(bean|beans|lentil|lentils|chickpea|chickpeas|tofu|edamame|soy|hummus|falafel)\b/.test(lower)) foodType = 'legume';
      else if (/\b(apple|banana|berry|berries|orange|fruit|grape|melon|peach|mango)\b/.test(lower)) foodType = 'fruit';
      else if (/\b(salad|lettuce|spinach|kale|cabbage|greens|cucumber|broccoli)\b/.test(lower)) foodType = 'leafy_veg';
      else if (/\b(potato|potatoes|carrot|carrots|beet|beetroot|sweet potato|yam|radish)\b/.test(lower)) foodType = 'root_veg';
      else if (/\b(zero\s*sugar|zero\s*calorie|diet\s*soda|diet\s*cola|coca[- ]*cola\s*zero|pepsi\s*zero|pepsi\s*max|coke\s*zero|diet\s*pepsi|diet\s*coke|water|sparkling\s*water|club\s*soda|seltzer|black\s*coffee|espresso|green\s*tea|black\s*tea|herbal\s*tea)\b/i.test(lower) || (itemNutrients.calories <= 5 && itemNutrients.protein === 0 && itemNutrients.totalFat === 0 && itemNutrients.carbohydrates === 0 && /\b(cola|soda|drink|beverage|tea|coffee|water)\b/i.test(lower))) foodType = 'beverage_zero';
      else if (/\b(cola|soda|soft\s*drink|juice|beverage|drink|tea|coffee|lemonade|punch)\b/.test(lower) || foodType === 'beverage') foodType = 'beverage';
      else foodType = 'unknown';
    }

    // Special case: If item is recognized as a beverage or has zero macros with beverage keywords, force beverage_zero
    if (foodType === 'beverage' && itemNutrients.calories <= 5 && itemNutrients.protein === 0 && itemNutrients.totalFat === 0 && itemNutrients.carbohydrates <= 1) {
      foodType = 'beverage_zero';
    }

    const traceNutrients = { ...getTraceNutrientsForFoodType(foodType, itemWeight) };
    
    // Natural citrus fruit & juice baseline: standard orange/citrus juice and whole citrus provide ~35-50mg Vitamin C per 100g
    const lowerItemName = (canonicalName + " " + (item.keyword || "") + " " + (item.originalName || "")).toLowerCase();
    const isCitrusBeverageOrFruit = /\b(orange\s*juice|grapefruit\s*juice|lemonade|lime\s*juice|citrus\s*juice|orange|grapefruit|lemon|lime|clementine|tangerine|mandarin)\b/i.test(lowerItemName) && !/\b(cake|cookie|chicken|duck|pie|candy|soda|pepsi|coca|flavour|flavor)\b/i.test(lowerItemName);
    if (isCitrusBeverageOrFruit) {
      const minCitrusVitC = parseFloat((38 * (itemWeight / 100)).toFixed(1));
      if (traceNutrients.vitaminC === undefined || traceNutrients.vitaminC < minCitrusVitC) {
        traceNutrients.vitaminC = minCitrusVitC;
      }
    }

    // Geofencing and Regional Fortification Logic
    const fullText = ((item.ingredientsList || "") + " " + (item.originalName || "") + " " + JSON.stringify(item.rawNutritionLabel || {}) + " " + JSON.stringify(item.visualIngredients || []) + " " + (item.canonicalDbName || "")).toLowerCase();
    const isUKRegion = fullText.includes(".info") || fullText.match(/\bgb\b/) || fullText.includes("saturates") || fullText.match(/\buk\b/);
    if (isUKRegion) {
        if (foodType === 'dairy' || foodType === 'grain') {
            traceNutrients.vitaminD = 0; // Disable US fortification assumptions for UK/Europe
            addDebugLog(`[Geofencing] Detected UK/European markers for "${canonicalName}". Disabling US fortification assumptions (Vitamin D = 0).`);
        }
    }
    
    let baseRef100g: Record<string, number> | null = null;
    if (item.primaryBase100g) {
      baseRef100g = item.primaryBase100g;
    } else if (dbId && dbMatchMap && dbMatchMap.has(dbId)) {
      baseRef100g = dbMatchMap.get(dbId);
    } else if (dbId && databaseMatchesArray) {
      const matchObj = databaseMatchesArray.find((m: any) => String(m.id) === String(dbId));
      if (matchObj) {
        baseRef100g = dbSource === "usda" ? extractUSDANutrientsPer100g(matchObj) : extractOFFNutrientsPer100g(matchObj);
      }
    } else if (!baseRef100g) {
      const canonicalBase = lookupCanonicalBaseFood(canonicalName) || lookupCanonicalBaseFood(item.name || "") || lookupCanonicalBaseFood(item.originalName || "");
      if (canonicalBase) {
        baseRef100g = canonicalBase as any;
      }
    }

    const itemFactor = itemWeight / 100;
    // NUTRIENT SOURCE TRACKING (Aug 2026): record, per trace-nutrient key, whether the value
    // came from a matched database entry or the food-type heuristic fallback, so the UI can
    // show an accurate source instead of a blanket "estimated by AI agent" label (no LLM is
    // involved in producing any of these trace-20 values).
    const nutrientSourceMap: Record<string, string> = { ...(item.nutrientSourceMap || {}) };
    for (const key of Object.keys(traceNutrients)) {
      if (baseRef100g && baseRef100g[key] !== undefined && baseRef100g[key] !== null && Number(baseRef100g[key]) > 0) {
        itemNutrients[key] = parseFloat((baseRef100g[key] * itemFactor).toFixed(2));
        // "label" dbSource means the item's core MACROS were OCR'd from a photographed
        // label — it does NOT mean this specific trace micronutrient (pulled here from the
        // generic USDA reference density, not from the photo) was printed anywhere. Only a
        // genuinely curated "brand_official" record (a specific branded product's official
        // nutrition data) should ever be attributed as label/brand-verified truth.
        nutrientSourceMap[key] = dbSource === "usda" ? "usda_database"
          : dbSource === "off" ? "openfoodfacts_database"
          : dbSource === "brand_official" ? "brand_label_data"
          : "matched_database_entry";
      } else if (itemNutrients[key] === undefined || itemNutrients[key] === 0 || isNaN(itemNutrients[key])) {
        itemNutrients[key] = (traceNutrients as any)[key];
        nutrientSourceMap[key] = "foodtype_estimate";
      }
    }
    addDebugLog(`[Nutrient] "${canonicalName}" trace-20 computed from ${baseRef100g ? 'authentic DB nutrients with fallback' : 'foodType=' + foodType}.`);

    // Ensure physical consistency of fats for the item
    if (itemNutrients.saturatedFat > itemNutrients.totalFat) {
      itemNutrients.totalFat = itemNutrients.saturatedFat;
    }
    if (itemNutrients.transFat > itemNutrients.totalFat) {
      itemNutrients.totalFat = itemNutrients.transFat;
    }
    if (itemNutrients.saturatedFat + itemNutrients.transFat > itemNutrients.totalFat) {
      itemNutrients.totalFat = parseFloat((itemNutrients.saturatedFat + itemNutrients.transFat).toFixed(2));
    }
    itemNutrients.unsaturatedFat = parseFloat(Math.max(0, itemNutrients.totalFat - itemNutrients.saturatedFat - itemNutrients.transFat).toFixed(2));
    if (itemNutrients.sugar || itemNutrients.addedSugar || (itemNutrients.carbohydrates && itemNutrients.carbohydrates > 0)) {
      const existingAddedSugar = (itemNutrients.addedSugar !== undefined && itemNutrients.addedSugar !== null && Number(itemNutrients.addedSugar) > 0)
        ? Number(itemNutrients.addedSugar)
        : null;
      const sugarResult = deduceSugarBreakdown({
        totalSugar: itemNutrients.sugar != null && Number(itemNutrients.sugar) > 0 ? Number(itemNutrients.sugar) : (existingAddedSugar || null),
        addedSugarPrinted: labelData?.addedSugar != null ? (Number(labelData.addedSugar) * (servingSizeGrams > 0 ? itemWeight / servingSizeGrams : 1)) : existingAddedSugar,
        carbohydrates: itemNutrients.carbohydrates,
        totalFibre: itemNutrients.totalFibre,
        physicalForm: physicalFormClassification.physicalForm,
        ingredientsList: item.ingredientsList,
        foodName: canonicalName || item.keyword || item.originalName,
      });
      if (!itemLockedKeys.has('sugar')) {
        itemNutrients.sugar = sugarResult.sugar;
      }
      if (!itemLockedKeys.has('addedSugar')) {
        itemNutrients.addedSugar = existingAddedSugar ?? sugarResult.addedSugar;
      }
    }
    itemNutrients.addedSugar = itemNutrients.addedSugar || 0;
    itemNutrients.sugar = itemNutrients.sugar || 0;
    itemNutrients.totalFibre = Math.max(0, itemNutrients.totalFibre || itemNutrients.fiber || itemNutrients.fibre || itemNutrients.serat || 0);

    // Force locked truth nutrients for the individual item BEFORE clean precision clamp.
    Object.entries(itemTruthNutrients).forEach(([key, val]) => {
      if (itemLockedKeys.has(key)) {
        const num = Number(val);
        if (Number.isFinite(num)) {
          itemNutrients[key] = num;
        }
      }
    });

    // Clamp all nutrients to 0 and clean precision
    for (const key of NUTRIENT_KEYS) {
      itemNutrients[key] = cleanNutrientNumber(itemNutrients[key]);
    }

    // Ensure lipid sub-components sum cleanly to totalFat
    if (itemNutrients.totalFat > 0) {
      if (itemNutrients.saturatedFat > itemNutrients.totalFat) {
        itemNutrients.totalFat = itemNutrients.saturatedFat;
      }
      if (itemNutrients.transFat > itemNutrients.totalFat) {
        itemNutrients.totalFat = itemNutrients.transFat;
      }
      if (itemNutrients.saturatedFat + itemNutrients.transFat > itemNutrients.totalFat) {
        itemNutrients.totalFat = parseFloat((itemNutrients.saturatedFat + itemNutrients.transFat).toFixed(2));
      }
      itemNutrients.unsaturatedFat = parseFloat(Math.max(0, itemNutrients.totalFat - itemNutrients.saturatedFat - (itemNutrients.transFat || 0)).toFixed(2));
    } else {
      itemNutrients.saturatedFat = 0;
      itemNutrients.transFat = 0;
      itemNutrients.unsaturatedFat = 0;
    }

    const displayName = sanitizeString(
      item.originalName || item.originalLocalName || item.keyword || item.name || canonicalName,
      canonicalName
    );

    // Atwater Energy Consistency Floor Sanity:
    // Calories must never be lower than the physical thermal energy of fat alone (fat * 9)
    // for fat-dominant foods (e.g. butter, oils, ghee).
    if (itemNutrients.totalFat > 0) {
      const minFatKcal = itemNutrients.totalFat * 9;
      if ((itemNutrients.calories || 0) < minFatKcal) {
        const derivedKcal = Math.round((itemNutrients.protein || 0) * 4 + (itemNutrients.carbohydrates || 0) * 4 + itemNutrients.totalFat * 9);
        if (derivedKcal > (itemNutrients.calories || 0)) {
          addDebugLog(`[Atwater Energy Consistency Gate] "${displayName}": Calories (${itemNutrients.calories} kcal) below fat thermal energy (${itemNutrients.totalFat}g fat * 9 = ${minFatKcal.toFixed(1)} kcal). Reconciled calories to ${derivedKcal} kcal.`);
          itemNutrients.calories = derivedKcal;
        }
      }
    }

    // Printed-label energy is truth: macros cannot express fibre, polyols or
    // alcohol energy, so Atwater silently under-reports those foods. Live:
    // job_1791044439374_4x4srekyi logged a 440 ml beer labelled 54 kcal/100ml
    // (~238 kcal) as 88 kcal = 22 g carbs × 4. An explicit calories lock still wins.
    if (!itemLockedKeys.has('calories') && !verifiedDbApplied) {
      const labelEnergy = resolveLabelEnergyKcal({
        rawNutritionLabel: item.rawNutritionLabel,
        labelNutrientsPerServing: labelData,
        servingSizeGrams,
        itemWeightGrams: itemWeight,
      });
      // Printed panel only. The numeric per-serving panel is the model's core-11
      // estimate rather than label truth, and must not overrule a verified match.
      if (
        labelEnergy.source === 'rawNutritionLabel' &&
        shouldPreferLabelEnergy({ derivedKcal: itemNutrients.calories, labelKcal: labelEnergy.kcal })
      ) {
        addDebugLog(
          `[Label Energy Gate] "${displayName}": derived ${itemNutrients.calories} kcal (Atwater) vs printed label ` +
          `${labelEnergy.perServingKcal} kcal per ${labelEnergy.basisGrams}g → ${labelEnergy.kcal} kcal for ${itemWeight}g ` +
          `(${labelEnergy.source}). Using the printed label.`
        );
        itemNutrients.calories = labelEnergy.kcal;
      }
    }

    // Add to aggregated nutrients
    for (const key of NUTRIENT_KEYS) {
      nutrients[key] = cleanNutrientNumber(nutrients[key] + (itemNutrients[key] || 0));
    }

    const matchType = dbSource === "usda" ? "USDA FDC Entry" : dbSource === "off" ? "Open Food Facts Entry" : dbSource === "backend_calculated" || dbSource === "canonical" ? "Canonical Base Food Reference" : "Universal Nutrient Estimator";

    return {
      name: displayName,
      canonicalDbName: item.canonicalDbName || canonicalName,
      originalName: item.originalName || item.originalLocalName || null,
      originalLocalName: item.originalLocalName || item.originalName || null,
      keyword: item.keyword || null,
      chainName: item.chainName || null,
      rawNutritionLabel: item.rawNutritionLabel || null,
      scoutIndex: item.scoutIndex !== undefined ? item.scoutIndex : null,
      weightGrams: itemWeight,
      calories: itemNutrients.calories || 0,
      protein: itemNutrients.protein || 0,
      totalFat: itemNutrients.totalFat || 0,
      saturatedFat: itemNutrients.saturatedFat || 0,
      transFat: itemNutrients.transFat || 0,
      carbohydrates: itemNutrients.carbohydrates || 0,
      sugar: itemNutrients.sugar || 0,
      addedSugar: itemNutrients.addedSugar || 0,
      sodium: itemNutrients.sodium || 0,
      potassium: itemNutrients.potassium || 0,
      totalFibre: itemNutrients.totalFibre || itemNutrients.fiber || itemNutrients.fibre || itemNutrients.serat || 0,
      solubleFibre: itemNutrients.solubleFibre || 0,
      nutrients: itemNutrients,
      nutrientSourceMap,
      labelNutrientsPerServing: item.labelNutrientsPerServing || null,
      dbSource,
      dbId,
      isUnverified: itemNutrients.isUnverified || false,
      cookingMethod: item.cookingMethod || null,
      boundingBox2D: item.boundingBox2D || null,
      sourceImageIndex: item.sourceImageIndex !== undefined ? item.sourceImageIndex : null,
      components: item.components || null,
      visualIngredients: item.visualIngredients || null,
      saucesDetailList: item.saucesDetailList || [],
      primaryBase100g: item.primaryBase100g || null,
      primaryBaseMatchName: item.primaryBaseMatchName || null,
      primaryBaseWeightG: item.primaryBaseWeightG || null,
      cookingAdded: item.cookingAdded || null,
      truthNutrients: itemTruthNutrients,
      lockedNutrientKeys: Array.from(itemLockedKeys),
      ingredientsList: item.ingredientsList || null,
      physicalFormClassification,
      matchReasonInfo: {
        matchType,
        physicalForm: physicalFormClassification.physicalForm,
        matchedKeywords: Array.from(new Set(Array.isArray(physicalFormClassification.matchedTokens) ? physicalFormClassification.matchedTokens.map((t: any) => String(t).trim()) : [String(physicalFormClassification.matchedTokens || '').trim()])).filter(Boolean),
        explanation: physicalFormClassification.explanation
      }
    };
  });

  for (const k of NUTRIENT_KEYS) {
    if (nutrients[k] !== undefined) {
      nutrients[k] = cleanNutrientNumber(nutrients[k]);
    }
  }

  return {
    nutrients,
    itemsBreakdown
  };
}

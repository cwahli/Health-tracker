import {
  cleanQuery,
  loosenQuery,
  scoutHasCompletePrintedLabel,
  formatOFFNutrients,
} from './server_food_analyze_helpers.js';

/**
 * F-8.10 shard 14 — database search stage, extracted verbatim from
 * runFoodAnalyze. OFF/brand fan-out, result shaping, internal catalog
 * + dish cache, resolver gaps + curator LLM, category fallbacks.
 *
 * All services arrive via deps (full DI): production passes the live
 * imports, tests pass stubs. Pure helpers come from the helpers shard.
 * Mutates databaseMatchesArray / dbMatchMap / quarantinedIdsSet in place;
 * returns the databaseMatches text block.
 */

export interface DbSearchStageInput {
  uniqueQueries: string[];
  visionScoutItems: any[];
  visionScoutContentType?: string;
  detectedChainKey?: string;
  explicitFoodTags: any[];
  engine: any;
  databaseMatchesArray: any[];
  dbMatchMap: Map<string, any>;
  quarantinedIdsSet: Set<string>;
}

export interface DbSearchStageDeps {
  sendStreamEvent: (event: any) => void;
  flushRes: () => void;
  sendLog: (type: string, stage: string, message: string, data?: any) => void;
  addDebugLog: (msg: string) => void;
  searchOpenFoodFacts: (query: string, n: number) => Promise<any[]>;
  searchBrandMenuItems: (query: string, chain?: string) => Promise<any[]>;
  isKnownDatabaseBrand: (query: string) => Promise<boolean>;
  isKnownDatabaseBrandSync: (query: string) => boolean;
  getBrandMenuItemById: (id: string) => Promise<any>;
  isUsableWebNutritionHit: (hit: any) => boolean;
  brandHitFitsQuery: (query: string, hit: any) => boolean;
  extractUSDANutrientsPer100g: (food: any) => any;
  extractOFFNutrientsPer100g: (product: any) => any;
  resolveInternalFood: (query: string) => Promise<any>;
  resolveDishCache: (name: string) => Promise<any>;
  rankAndClassifyCandidates: (query: string, usda: any, threshold: number) => any;
  writeAliasIfHitUnique: (...args: any[]) => Promise<any>;
  sanitizeDishTitle: (query: string) => string;
  normalizeFoodKey: (query: string) => string;
  fetchOFFProductByBarcode: (fdcId: string) => Promise<any>;
  getFallbackCategoryProfile: (query: string) => any;
  recordFoodObservation: (event: any) => void;
  upsertFoodItemCandidate: (event: any) => Promise<any>;
  upsertFoodAlias: (event: any) => Promise<any>;
  callUnifiedLLM: (args: any) => Promise<any>;
  executeFoodResolverCurator: (...args: any[]) => Promise<any[]>;
  importSupabaseAdmin: () => Promise<any>;
  selfCleanBrandDatabase: (admin: any, region: string, onLog: (msg: string) => void) => Promise<any>;
}

export async function runDatabaseSearchStage(
  input: DbSearchStageInput,
  deps: DbSearchStageDeps
): Promise<string> {
  const {
    uniqueQueries,
    visionScoutItems,
    visionScoutContentType,
    detectedChainKey,
    explicitFoodTags,
    engine,
    databaseMatchesArray,
    dbMatchMap,
    quarantinedIdsSet,
  } = input;
  const {
    sendStreamEvent,
    flushRes,
    sendLog,
    addDebugLog,
    searchOpenFoodFacts,
    searchBrandMenuItems,
    isKnownDatabaseBrand,
    isKnownDatabaseBrandSync,
    getBrandMenuItemById,
    isUsableWebNutritionHit,
    brandHitFitsQuery,
    extractUSDANutrientsPer100g,
    extractOFFNutrientsPer100g,
    resolveInternalFood,
    resolveDishCache,
    rankAndClassifyCandidates,
    sanitizeDishTitle,
    normalizeFoodKey,
    fetchOFFProductByBarcode,
    getFallbackCategoryProfile,
    recordFoodObservation,
    upsertFoodItemCandidate,
    upsertFoodAlias,
    callUnifiedLLM,
    executeFoodResolverCurator,
    importSupabaseAdmin,
    selfCleanBrandDatabase,
  } = deps;

  let databaseMatches = "";
  sendStreamEvent({ type: 'status', stage: 'db_search', status: 'started', message: 'Searching nutrition databases...' });
  flushRes();
  sendLog('db_search', 'db_search', `Querying OpenFoodFacts & brand catalog for: [${uniqueQueries.join(', ')}]`);
  addDebugLog(`[Database Search] Performing OFF & brand searches for queries: ${JSON.stringify(uniqueQueries)}`);
  const searchPromises = uniqueQueries.map(async (q) => {
    try {
      const cleaned = cleanQuery(q);
      const isBarcode = /^\d{6,}$/.test(cleaned);
      let dataTypes = 'Foundation,SR Legacy,Survey (FNDDS)';
      const isDbBrand = await isKnownDatabaseBrand(cleaned);
      if (isBarcode || visionScoutContentType === 'text' || cleaned.toLowerCase().includes('brand') || isDbBrand) {
        dataTypes = 'Foundation,SR Legacy,Survey (FNDDS),Branded';
      }
      const isGeneric = /^(mayo|mayonnaise|granola|tortilla|salad greens|mixed salad leaves|lettuce|tomato|onion|cucumber|bread|wrap|egg|boiled egg|salt|pepper|oil|butter|sugar|chicken|beef|pork|fish|tuna|salmon|rice|pasta|cheese)$/i.test(cleaned);
      if (isGeneric && !isDbBrand && !isBarcode) {
        dataTypes = 'Foundation,SR Legacy,Survey (FNDDS)'; // Override and lock to generics
        addDebugLog(`[BrandGuard] Using generic types for "${cleaned}" (not a brand — skip branded/OFF catalog)`);
      }
      let offP = Promise.resolve([]);
      if (isBarcode || dataTypes.includes('Branded')) {
        offP = searchOpenFoodFacts(cleaned, 3);
      }
      // BrandGuard: a generic token (e.g. plain "mayonnaise") should not be allowed to
      // match a specific restaurant's branded catalog item (e.g. "Pot of Chimi Mayo")
      // unless that chain was actually detected for this meal. Previously this guard
      // only restricted the USDA/OFF `dataTypes`, but `searchBrandMenuItems` ran
      // unconditionally, polluting gap-resolver candidates with irrelevant chain-specific
      // products for ordinary generic ingredients.
      const brandP = (isGeneric && !isDbBrand && !isBarcode && !detectedChainKey)
        ? Promise.resolve([])
        : searchBrandMenuItems(cleaned, detectedChainKey);
      let [off, brandHits] = await Promise.all([
        offP,
        brandP,
      ]);
      const web: any[] = [];
      // If zero results found in main database search, retry with loosened query
      if (off.length === 0 && brandHits.length === 0) {
        const loosened = loosenQuery(cleaned);
        if (loosened && loosened !== cleaned) {
          addDebugLog(`[Database Search Fallback] Zero results for "${cleaned}". Retrying with loosened query "${loosened}"...`);
          let fallbackOffP = Promise.resolve([]);
          if (isBarcode || dataTypes.includes('Branded')) {
            fallbackOffP = searchOpenFoodFacts(loosened, 3);
          }
          const fallbackBrandP = (isGeneric && !isDbBrand && !isBarcode && !detectedChainKey)
            ? Promise.resolve([])
            : searchBrandMenuItems(loosened, detectedChainKey);
          const [fallOFF, fallBrand] = await Promise.all([
            fallbackOffP,
            fallbackBrandP
          ]);
          if (fallOFF.length > 0 || fallBrand.length > 0) {
            addDebugLog(`[Database Search Fallback] Succeeded for "${loosened}". OFF: ${fallOFF.length}, Brand: ${fallBrand.length}`);
            off = fallOFF;
            brandHits = fallBrand;
          }
        }
      }
      return { query: q, off, brandHits, web };
    } catch (err) {
      return { query: q, off: [], brandHits: [], web: [] };
    }
  });
  const searchResultsList = await Promise.all(searchPromises);
  // Ensure explicit food tags from internal catalog and previous meals are present in databaseMatchesArray
  if (Array.isArray(explicitFoodTags) && explicitFoodTags.length > 0) {
    for (const tag of explicitFoodTags) {
      if (tag.source === 'previous_meal' || (tag.originalLog && tag.source !== 'catalog_tag')) {
        const log = tag.originalLog || {};
        const dishName = tag.name || log.name || 'Previous Meal';
        const hitId = tag.dbId || log.id || `food_${Date.now()}`;
        const previousMealHit = {
          id: hitId,
          source: 'previous_meal',
          brandPriority: true,
          searchQuery: dishName,
          name: dishName,
          dish_name: dishName,
          chainName: 'Previous Meal',
          chain_name: 'Previous Meal',
          basisType: 'per_dish',
          basis_type: 'per_dish',
          servingGrams: tag.weightGrams || log.portionGrams || 100,
          calories: log.calories != null ? String(log.calories) : undefined,
          protein: log.protein != null ? Number(log.protein) : undefined,
          fat: log.totalFat != null ? Number(log.totalFat) : (log.fat != null ? Number(log.fat) : undefined),
          saturatedFat: log.saturatedFat != null ? Number(log.saturatedFat) : undefined,
          carbohydrates: log.carbohydrates != null ? Number(log.carbohydrates) : undefined,
          totalFibre: log.totalFibre != null ? Number(log.totalFibre) : (log.fiber != null ? Number(log.fiber) : undefined),
          sodium: log.sodium != null ? Number(log.sodium) : undefined,
          imageUrl: log.imageUrl || log.imageUrls?.[0] || tag.imageUrl || undefined,
          imageUrls: log.imageUrls || (log.imageUrl ? [log.imageUrl] : []),
          nutrients: {
            basisType: 'per_dish',
            calories: log.calories != null ? Number(log.calories) : 0,
            protein: log.protein,
            totalFat: log.totalFat ?? log.fat,
            saturatedFat: log.saturatedFat,
            carbohydrates: log.carbohydrates,
            totalFibre: log.totalFibre ?? log.fiber,
            sodium: log.sodium,
          },
          itemsBreakdown: log.itemsBreakdown,
          snippet: `Previous logged meal: ${dishName}. Nutrition: ${log.calories ?? 0} kcal, ${log.protein ?? 0}g protein, ${log.carbohydrates ?? 0}g carbs, ${log.totalFat ?? 0}g fat.`
        };
        searchResultsList.push({
          query: dishName,
          off: [],
          brandHits: [previousMealHit],
          web: []
        });
        addDebugLog(`[Explicit Tag] Injected direct previous meal lookup for tag "${dishName}" (ID: ${hitId})`);
      } else if (tag.dbId && typeof tag.dbId === 'string' && tag.dbId.startsWith('brand_menu_')) {
        const brandItem = await getBrandMenuItemById(tag.dbId);
        if (brandItem) {
          searchResultsList.push({
            query: tag.name,
            off: [],
            brandHits: [brandItem],
            web: []
          });
          addDebugLog(`[Explicit Tag] Injected direct brand menu lookup for tag "${tag.name}" (ID: ${tag.dbId})`);
        }
      }
    }
  }
  const list: string[] = [];
  const seenBrandTargets = new Set<string>();
  for (const resItem of searchResultsList) {
    if (resItem.brandHits && Array.isArray(resItem.brandHits)) {
      resItem.brandHits.filter((bmHit: any) => brandHitFitsQuery(resItem.query, bmHit)).forEach((bmHit: any) => {
        const bType = bmHit.basisType || 'per_dish';
        const bmNutrients = {
          ...(bmHit.nutrients || {}),
          basisType: bType,
          calories: Number(bmHit.calories || 0),
          protein: bmHit.protein,
          totalFat: bmHit.fat,
          saturatedFat: bmHit.saturatedFat,
          carbohydrates: bmHit.carbohydrates,
          totalFibre: bmHit.totalFibre,
          sodium: bmHit.sodium
        };
        dbMatchMap.set(bmHit.id, bmNutrients);
        databaseMatchesArray.push({
          ...bmHit,
          searchQuery: resItem.query,
          basisType: bType,
          nutrients: bmNutrients
        });
        const brandKey = `${String(bmHit.chainName || '').toLowerCase()}::${String(bmHit.name || '').toLowerCase()}`;
        if (seenBrandTargets.has(brandKey)) return;
        seenBrandTargets.add(brandKey);
        const bmProteinStr = (bmHit.protein !== undefined && bmHit.protein !== null) ? `${bmHit.protein}g` : 'n/a';
        const bmCarbsStr = (bmHit.carbohydrates !== undefined && bmHit.carbohydrates !== null) ? `${bmHit.carbohydrates}g` : 'n/a';
        const bmFatStr = (bmHit.fat !== undefined && bmHit.fat !== null) ? `${bmHit.fat}g` : 'n/a';
        list.push(`- [Brand Menu (Official)] Chain: ${bmHit.chainName} | Item: ${bmHit.name} | Calories: ${bmHit.calories} | P: ${bmProteinStr} | C: ${bmCarbsStr} | F: ${bmFatStr} | Source: brand_official`);
        addDebugLog(`[Brand DB Match] Found official restaurant/brand menu item for "${resItem.query}" -> "${bmHit.name}" (${bmHit.chainName})`);
      });
    }
    resItem.off.forEach((product: any) => {
      const idStr = String(product.barcode || product.id || product.code || "");
      if (idStr) {
        dbMatchMap.set(idStr, extractOFFNutrientsPer100g(product));
        const parsedNutrients = extractOFFNutrientsPer100g(product);
        const caloriesStr = String(parsedNutrients.calories);
        databaseMatchesArray.push({
          id: idStr,
          source: "off",
          searchQuery: resItem.query,
          name: product.product_name || "",
          servingGrams: 100,
          ...parsedNutrients,
          calories: caloriesStr,
          protein: parsedNutrients.protein,
          fat: parsedNutrients.totalFat,
          saturatedFat: parsedNutrients.saturatedFat,
          sodium: parsedNutrients.sodium,
          carbohydrates: parsedNutrients.carbohydrates,
          totalFibre: parsedNutrients.totalFibre,
          nutrients: parsedNutrients
        });
        list.push(`- [OpenFoodFacts] Barcode: ${idStr} | Name: ${product.product_name} (${product.brands || 'No Brand'}) | Nutrients (per 100g): ${formatOFFNutrients(product.nutriments)}`);
      }
    });
    if (resItem.web && Array.isArray(resItem.web)) {
      resItem.web.forEach((webItem: any, wIdx: number) => {
        if (webItem && isUsableWebNutritionHit(webItem)) {
          const webId = `web_search_${resItem.query}_${wIdx}`;
          const isBrandResult = Boolean(resItem.query && isKnownDatabaseBrandSync(resItem.query)) || webItem.source === 'brand_official';
          const webCarbsRaw = webItem.carbohydrates ?? webItem.carbs;
          const webCarbs = webCarbsRaw != null ? Number(webCarbsRaw) : null;
          const webFibreRaw = webItem.fiber ?? webItem.totalFibre;
          const webFibre = webFibreRaw != null ? Number(webFibreRaw) : null;
          const webSugar = webItem.sugar != null ? Number(webItem.sugar) : null;
          const webSalt = webItem.salt != null ? Number(webItem.salt) : null;
          const webSodiumRaw = webItem.sodium ?? (webSalt != null ? Math.round(webSalt * 400) : null);
          const webSodium = webSodiumRaw != null ? Number(webSodiumRaw) : null;
          const webProt = webItem.protein != null ? Number(webItem.protein) : null;
          const webFat = webItem.fat != null ? Number(webItem.fat) : null;
          const webSatFat = webItem.saturatedFat != null ? Number(webItem.saturatedFat) : null;
          const webCals = Number(webItem.calories || 0);
          // NUTRITION BASIS FIX (Aug 2026): live web/brand search results report calories for
          // the WHOLE named dish as sold (e.g. "YOLK Chicken Sandwich: 783 kcal" = one whole
          // sandwich), NOT per 100g. Tag as basisType 'total' so downstream scaling does not
          // re-multiply by weight/100 a second time. Reuses the existing 'basisType' convention
          // already used elsewhere in this file (see the printed-label truthMatch object).
          const nutritionBasisType = isBrandResult ? 'total' : 'per_100g';
          const dbEntry = {
            id: webId,
            source: isBrandResult ? 'brand_official' : (webItem.source || "web_search"),
            searchQuery: resItem.query,
            name: webItem.name || resItem.query,
            calories: String(webCals),
            protein: webProt,
            fat: webFat,
            saturatedFat: webSatFat,
            carbohydrates: webCarbs,
            totalFibre: webFibre,
            sugar: webSugar,
            salt: webSalt,
            sodium: webSodium,
            ingredients: webItem.ingredients || webItem.ingredientsList || webItem.description || '',
            brandPriority: isBrandResult,
            basisType: nutritionBasisType
          };
          databaseMatchesArray.push(dbEntry);
          dbMatchMap.set(webId, {
            servingSizeGrams: 100,
            basisType: nutritionBasisType,
            calories: webCals,
            protein: webProt,
            totalFat: webFat,
            saturatedFat: webSatFat,
            transFat: 0,
            carbohydrates: webCarbs,
            addedSugar: 0,
            sodium: webSodium,
            salt: webSalt,
            potassium: 0,
            totalFibre: webFibre,
            solubleFibre: 0
          });
          list.push(`- [WebSearch${isBrandResult ? ' (Brand Priority)' : ''}] Query: ${resItem.query} | Name: ${webItem.name || resItem.query} | Calories: ${webCals} | P: ${webProt}g | C: ${webCarbs}g | F: ${webFat}g | Provider: ${webItem.source || 'web_search'}`);
        } else if (webItem) {
          addDebugLog(`[WebSearch] Discarded unusable hit for "${resItem.query}" (calories=${webItem.calories ?? 'n/a'}).`);
        }
      });
    }
  }
  if (list.length > 0) {
    databaseMatches = list.slice(0, 50).join("\n");
  } else {
    databaseMatches = "No matches found in Open Food Facts or brand catalog for these queries.";
  }
  sendLog('db_search_complete', 'db_search', `Found ${databaseMatchesArray.length} database match(es) across OpenFoodFacts & brand catalog.`);
  sendStreamEvent({ type: 'status', stage: 'db_search', status: 'completed', message: 'Database search completed.' });
  // Run Food Resolver Agent only for query gaps that do NOT hit the internal catalog or dish cache
  // and that are NOT covered by a complete printed packaging label (token save + avoid bad USDA).
  const gapsForResolver: Array<{ query: string; candidates: Array<{ id: string; name: string; source: string }> }> = [];
  const labelCompleteQueries = new Set<string>();
  for (const s of visionScoutItems || []) {
    if (!scoutHasCompletePrintedLabel(s)) continue;
    for (const q of [s.originalName, s.keyword, s.name]) {
      if (q && String(q).trim()) labelCompleteQueries.add(String(q).toLowerCase().trim());
    }
    // Parent label is dish truth — skip component gap LLM too (macros locked later from label)
    if (Array.isArray(s.components)) {
      for (const c of s.components) {
        const cq = c?.searchQuery || c?.name || c?.keyword;
        if (cq && String(cq).trim()) labelCompleteQueries.add(String(cq).toLowerCase().trim());
      }
    }
  }
  const internalHits = await Promise.all(searchResultsList.map(async (resItem) => {
    const hit = await resolveInternalFood(resItem.query);
    return { resItem, hit };
  }));
  for (const { resItem, hit } of internalHits) {
    if (hit) {
      const virtualId = hit.food_id || `internal_${hit.food_key}`;
      dbMatchMap.set(virtualId, hit.nutrients_per_100g);
      databaseMatchesArray.push({
        id: virtualId,
        source: 'internal_catalog',
        searchQuery: resItem.query,
        name: hit.display_name || resItem.query,
        servingGrams: 100,
        calories: String(hit.nutrients_per_100g.calories || 0),
        protein: hit.nutrients_per_100g.protein || 0,
        fat: hit.nutrients_per_100g.totalFat || hit.nutrients_per_100g.fat || 0,
        saturatedFat: hit.nutrients_per_100g.saturatedFat || 0,
        sodium: hit.nutrients_per_100g.sodium || 0,
        carbohydrates: hit.nutrients_per_100g.carbohydrates || hit.nutrients_per_100g.carbs || 0,
        totalFibre: hit.nutrients_per_100g.totalFibre || 0,
        nutrients: hit.nutrients_per_100g
      });
      addDebugLog(`[Internal Catalog Hit] Resolved "${resItem.query}" from internal catalog without Food Resolver agent gap.`);
      continue;
    }
    const qNorm = String(resItem.query || '').toLowerCase().trim();
    if (qNorm && labelCompleteQueries.has(qNorm)) {
      addDebugLog(`[Food Resolver Skip] Complete printed label covers "${resItem.query}" — skipping LLM resolver for this gap.`);
      continue;
    }
    const compositeParentDishQueries = new Set<string>();
    for (const s of visionScoutItems || []) {
      if (Array.isArray(s.components) && s.components.length >= 2) {
        for (const q of [s.originalName, s.keyword, s.name]) {
          if (q && String(q).trim()) compositeParentDishQueries.add(String(q).toLowerCase().trim());
        }
      }
    }
    if (qNorm && compositeParentDishQueries.has(qNorm)) {
      addDebugLog(`[Food Resolver Skip] Composite multi-component parent dish "${resItem.query}" is resolved via its sub-components — skipping monolithic LLM resolver gap.`);
      continue;
    }
    const candidates: Array<{ id: string; name: string; source: string }> = [];
    resItem.brandHits?.forEach((item: any) => {
      candidates.push({ id: String(item.id), name: `${item.chainName || ''} ${item.name || item.dish_name || ''}`.trim(), source: "brand_official" });
    });
    const cleanedForRank = cleanQuery(resItem.query);
    // F-12.1: USDA candidate feed deleted; rank runs over an empty set (MISS)
    // until F-11.2 rewires gap candidates to brand/OFF rows.
    rankAndClassifyCandidates(cleanedForRank, [], 85);

    // For MULTI_MATCH or MISS, pass the survivors to the Curator.
    // F-12.3: USDA survivor feed deleted with rank input (always []); OFF
    // rows below are the only candidates until F-11.2 rewires brand/OFF gaps.
    resItem.off.forEach((product: any) => {
      const idStr = String(product.barcode || product.id || product.code || "");
      if (idStr) {
        candidates.push({ id: idStr, name: product.product_name || "", source: "off" });
      }
    });
    const cleanGapQuery = sanitizeDishTitle(resItem.query);
    const gapKey = normalizeFoodKey(cleanGapQuery);
    const isDuplicateGap = gapsForResolver.some(g => normalizeFoodKey(sanitizeDishTitle(g.query)) === gapKey);
    if (!isDuplicateGap && cleanGapQuery) {
      gapsForResolver.push({
        query: cleanGapQuery,
        candidates
      });
    }
  }
  if (visionScoutItems && visionScoutItems.length > 0) {
    for (const scoutItem of visionScoutItems) {
      const dishName = scoutItem.originalName || scoutItem.keyword || scoutItem.name;
      if (dishName && (!scoutItem.components || scoutItem.components.length < 2)) {
        const dishHit = await resolveDishCache(dishName);
        if (dishHit) {
          const virtualId = `dish_cache_${dishHit.dish_key}`;
          dbMatchMap.set(virtualId, dishHit.core_nutrients);
          databaseMatchesArray.push({
            id: virtualId,
            source: 'internal_dish_cache',
            searchQuery: dishName,
            name: dishHit.display_name || dishName,
            servingGrams: 100,
            calories: String(dishHit.core_nutrients.calories || 0),
            protein: dishHit.core_nutrients.protein || 0,
            fat: dishHit.core_nutrients.totalFat || dishHit.core_nutrients.fat || 0,
            saturatedFat: dishHit.core_nutrients.saturatedFat || 0,
            sodium: dishHit.core_nutrients.sodium || 0,
            carbohydrates: dishHit.core_nutrients.carbohydrates || dishHit.core_nutrients.carbs || 0,
            totalFibre: dishHit.core_nutrients.totalFibre || 0,
            nutrients: dishHit.core_nutrients
          });
          addDebugLog(`[Dish Cache Hit] Resolved dish "${dishName}" from dish_cache.`);
        }
      }
    }
  }
  if (gapsForResolver.length > 0) {
    sendLog('status', 'food_resolver', `Dispatched Food Resolver agent for ${gapsForResolver.length} gap items.`);
    const callLLMFn = async (prompt: string, sysInst: string) => {
      return await callUnifiedLLM({
        modelId: engine || "gemini-3.5-flash-lite",
        systemInstruction: sysInst,
        promptText: prompt,
        logStagePrefix: 'food_resolver',
        temperature: 0.1,
      });
    };
    const fetchFoodDetailsForFdcId = async (fdcId: string): Promise<{ title: string, nutrients: Record<string, number> } | null> => {
      if (dbMatchMap.has(fdcId)) {
        const data = dbMatchMap.get(fdcId);
        return data ? { title: data.name || data.description || data.searchQuery || '', nutrients: data } : null;
      }
      if (/^\d+$/.test(fdcId)) {
        if (/^\d{6,}$/.test(fdcId)) {
          const prod = await fetchOFFProductByBarcode(fdcId);
          if (prod) return { title: prod.product_name || '', nutrients: extractOFFNutrientsPer100g(prod) };
        }
      }
      return null;
    };
    const fetchNutrientsForFdcId = async (fdcId: string): Promise<Record<string, number> | null> => {
      if (dbMatchMap.has(fdcId)) {
        return dbMatchMap.get(fdcId) || null;
      }
      if (/^\d+$/.test(fdcId)) {
        if (/^\d{6,}$/.test(fdcId)) {
          const prod = await fetchOFFProductByBarcode(fdcId);
          if (prod) return extractOFFNutrientsPer100g(prod);
        }
      }
      return null;
    };
    // F-12.3: USDA hook removed from the curator; fetchFoodDetailsForFdcId
    // is now the 5th positional arg.
    const resolvedGaps = await executeFoodResolverCurator(
      gapsForResolver,
      addDebugLog,
      callLLMFn,
      fetchNutrientsForFdcId,
      fetchFoodDetailsForFdcId
    );
    // For each resolved item, add it to databaseMatchesArray & dbMatchMap
    resolvedGaps.forEach(rg => {
      if (Array.isArray(rg.quarantinedIds)) {
        rg.quarantinedIds.forEach(id => {
          if (id) {
            const idStr = String(id);
            if (idStr.startsWith('brand_menu_') || idStr.startsWith('internal_')) {
              addDebugLog(`[Quarantine Guard] Ignored global quarantine for catalog/brand ID ${idStr}`);
              return;
            }
            if (!quarantinedIdsSet.has(idStr)) {
              quarantinedIdsSet.add(idStr);
              addDebugLog(`[Quarantine Sync] Added FDC ID ${idStr} to quarantinedIdsSet from curator.`);
            }
          }
        });
      }
      if (rg.nutrientsPer100g) {
        const virtualId = rg.chosenFdcId ? String(rg.chosenFdcId) : `resolver_${normalizeFoodKey(rg.query)}`;
        if (quarantinedIdsSet.has(virtualId)) {
          addDebugLog(`[Quarantine Block] Refusing to inject nutrients for quarantined FDC ID ${virtualId} ("${rg.query}").`);
          return;
        }
        dbMatchMap.set(virtualId, rg.nutrientsPer100g);
        const caloriesStr = String(rg.nutrientsPer100g.calories || 0);
        databaseMatchesArray.push({
          id: virtualId,
          // F-12.3: no new 'usda' meal writes. OFF barcodes keep 'off';
          // everything else the curator resolves is labelled 'estimated'.
          source: rg.chosenFdcId && rg.chosenFdcId.match(/^\d{8,}$/) ? "off" : "estimated",
          searchQuery: rg.query,
          name: rg.query,
          servingGrams: 100,
          calories: caloriesStr,
          protein: rg.nutrientsPer100g.protein || 0,
          fat: rg.nutrientsPer100g.totalFat || rg.nutrientsPer100g.fat || 0,
          saturatedFat: rg.nutrientsPer100g.saturatedFat || 0,
          sodium: rg.nutrientsPer100g.sodium || 0,
          carbohydrates: rg.nutrientsPer100g.carbohydrates || rg.nutrientsPer100g.carbs || 0,
          totalFibre: rg.nutrientsPer100g.totalFibre || rg.nutrientsPer100g.fiber || 0,
          nutrients: rg.nutrientsPer100g
        });
        addDebugLog(`[Food Resolver Integration] Injected resolved nutrients for "${rg.query}" into databaseMatchesArray: ${JSON.stringify(rg.nutrientsPer100g)}`);
      }
    });
    // Trigger self-cleaning pass on brand database during Food Resolver review
    try {
      const { supabaseAdmin } = await importSupabaseAdmin();
      if (supabaseAdmin) {
        const cleanResult = await selfCleanBrandDatabase(supabaseAdmin, 'GB', addDebugLog);
        if (cleanResult.removedUnofficialCount > 0 || cleanResult.deletedDuplicatesCount > 0) {
          sendLog('status', 'food_resolver', `Self-healing database pass: Purged ${cleanResult.removedUnofficialCount} non-branded/unofficial item(s) and ${cleanResult.deletedDuplicatesCount} duplicate(s).`);
        }
      }
    } catch (cleanErr: any) {
      addDebugLog(`[Food Resolver Self-Clean] Background cleaning notice: ${cleanErr?.message || cleanErr}`);
    }
    // Record deferred gaps & category fallbacks for queries that couldn't be resolved from candidates
    const resolvedQuerySet = new Set(resolvedGaps.filter(rg => rg.nutrientsPer100g).map(rg => normalizeFoodKey(rg.query)));
    uniqueQueries.forEach(query => {
      const normQ = normalizeFoodKey(query);
      if (resolvedQuerySet.has(normQ)) return;
      const qLower = String(query || '').toLowerCase().trim();
      if (qLower && labelCompleteQueries.has(qLower)) {
        addDebugLog(`[Food Resolver Fallback] skip category fallback; printed label covers "${query}"`);
        return;
      }
      const already = databaseMatchesArray.some((m: any) =>
        normalizeFoodKey(m.searchQuery || '') === normQ &&
        m.source !== 'category_fallback' &&
        !String(m.id || '').startsWith('fallback_')
      );
      if (already) {
        addDebugLog(`[Food Resolver Fallback] skip category fallback; non-fallback match exists for "${query}"`);
        return;
      }
      const fallbackProfile = getFallbackCategoryProfile(query);
      const virtualId = `fallback_${normQ}`;
      dbMatchMap.set(virtualId, fallbackProfile);
      databaseMatchesArray.push({
        id: virtualId,
        source: "category_fallback",
        searchQuery: query,
        name: `Estimated: ${query} (category fallback)`,
        servingGrams: 100,
        calories: String(fallbackProfile.calories || 0),
        protein: fallbackProfile.protein || 0,
        fat: fallbackProfile.totalFat || 0,
        saturatedFat: fallbackProfile.saturatedFat || 0,
        sodium: fallbackProfile.sodium || 0,
        carbohydrates: fallbackProfile.carbohydrates || 0,
        totalFibre: fallbackProfile.totalFibre || 0,
        nutrients: fallbackProfile
      });
      recordFoodObservation({
        event_type: 'deferred_gap',
        payload: { query, fallbackProfile }
      });
      upsertFoodItemCandidate({
        food_id: virtualId,
        food_key: normQ,
        display_name: query,
        nutrients_per_100g: fallbackProfile,
        status: 'category_fallback',
        provenance: 'category_fallback'
      }).catch(err => console.warn('[FallbackPersist] Error saving fallback item:', err));
      upsertFoodAlias({
        alias_key: normQ,
        food_id: virtualId,
        source: 'category_fallback'
      }).catch(err => console.warn('[FallbackPersist] Error saving fallback alias:', err));
      addDebugLog(`[Food Resolver Fallback] Created category fallback for gap "${query}": ${JSON.stringify(fallbackProfile)}`);
    });
  }
  return databaseMatches;
}

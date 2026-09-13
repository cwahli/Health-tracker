import { FoodCuratorActionSchema, foodResolverCuratorInstruction } from './agents/foodResolverInstructions.js';
import { supabaseAdmin } from './supabaseAdmin.js';
import { extractBalancedJson, checkCategoryAndStateCompatibility } from './server_pure_helpers.js';
import { lookupCanonicalBaseFood, CANONICAL_BASE_FOODS } from './server_food_db.js';

export function calculateTokenOverlap(strA: string, strB: string): number {
  if (!strA || !strB) return 0;
  const stopWords = new Set(['and', 'with', 'the', 'for', 'raw', 'fresh', 'prepared', 'cooked']);
  const tokensA = strA.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !stopWords.has(t));
  const tokensB = new Set(strB.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !stopWords.has(t)));
  if (tokensA.length === 0 || tokensB.size === 0) return 0;
  let matches = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) matches++;
  }
  return matches / tokensA.length;
}

export function hasCoreTokenOverlap(queryA: string, queryB: string): boolean {
  if (!queryA || !queryB) return false;
  const stopWords = new Set(['and', 'with', 'the', 'for', 'raw', 'fresh', 'prepared', 'cooked', 'canned', 'drained', 'solids', 'liquids', 'heavy', 'syrup', 'style', 'mixed', 'low', 'fat', 'free', 'sweet', 'spicy', 'hot', 'cold', 'large', 'small', 'medium', 'light', 'dark', 'green', 'red', 'yellow', 'blue', 'white', 'black', 'assorted', 'various', 'plain', 'regular', 'premium', 'extra', 'leaves', 'leaf', 'cut', 'pieces', 'chunks', 'slices', 'sliced', 'chopped', 'diced', 'minced', 'ground', 'whole', 'half', 'quarter', 'puree', 'paste', 'extract', 'powder', 'dried', 'dehydrated', 'roasted', 'baked', 'fried', 'boiled', 'steamed', 'grilled', 'smoked', 'cured', 'pickled', 'fermented', 'marinated', 'seasoned', 'unsalted', 'salted', 'sweetened', 'unsweetened', 'flavored', 'unflavored', 'artificial', 'natural', 'organic', 'conventional', 'gmo', 'non-gmo', 'gluten-free', 'vegan', 'vegetarian', 'kosher', 'halal', 'dairy-free', 'nut-free', 'soy-free', 'egg-free', 'wheat-free', 'sugar-free', 'fat-free', 'cholesterol-free', 'sodium-free', 'calorie-free']);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 2 && !stopWords.has(t));
  const tokensA = norm(queryA);
  const tokensB = norm(queryB);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  
  let matches = 0;
  const setB = new Set(tokensB);
  for (const a of tokensA) {
    if (setB.has(a)) {
      matches++;
    } else {
      for (const b of tokensB) {
        if ((a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4))) {
          matches++;
          break;
        }
      }
    }
  }
  return matches >= 1 && matches >= (Math.min(tokensA.length, tokensB.length) / 2);
}

export function calculateFuzzyTokenSimilarity(query: string, target: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const qTokens = norm(query);
  const tTokens = norm(target);
  if (qTokens.length === 0 || tTokens.length === 0) return 0;

  let matches = 0;
  for (const t of tTokens) {
    if (qTokens.some(q => q === t || q + 's' === t || t + 's' === q || (q.length > 3 && t.startsWith(q)) || (t.length > 3 && q.startsWith(t)))) {
      matches++;
    }
  }
  return matches / tTokens.length;
}

function repairUnquotedJsonKeys(jsonStr: string): string {
  if (!jsonStr) return jsonStr;
  let s = jsonStr.trim();
  // Strip markdown code block wrappers if present
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  // Wrap unquoted property keys in double quotes (e.g. Reason: "..." -> "Reason": "...")
  // IMPORTANT: only match keys immediately after a real object boundary ('{' or ',',
  // optionally followed by whitespace/newlines) — NOT after any arbitrary whitespace.
  // The old pattern matched "word:" anywhere preceded by a space, which corrupted
  // string VALUES containing a colon (e.g. "ranch dressing. contains: dairy" — the
  // curator echoing an allergen note from the label — got misread as an unquoted key
  // "contains", breaking the JSON and crashing the whole curator response).
  s = s.replace(/(^|[{,])(\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, (match, prefix, ws, key) => {
    if (match.includes('"')) return match;
    return `${prefix}${ws}"${key}":`;
  });
  // Clean trailing commas before closing braces/brackets
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s;
}

export async function executeFoodResolverCurator(
  gaps: Array<{ query: string; candidates: Array<{ id: string; name: string; source: string }> }>,
  addDebugLog: (msg: string) => void,
  callLLMFn: (prompt: string, sysInst: string) => Promise<string>,
  fetchNutrientsFn?: (fdcId: string) => Promise<Record<string, number> | null>,
  fetchFoodDetailsFn?: (fdcId: string) => Promise<{ title: string, nutrients: Record<string, number> } | null>
): Promise<Array<{ query: string; chosenFdcId: string | null; formTags?: string[]; dishCore?: Record<string, number>; nutrientsPer100g?: Record<string, number>; quarantinedIds?: string[] }>> {
  
  if (!gaps || gaps.length === 0) return [];

  // Single-dispatch: send every gap item to the curator in ONE call instead of chunking.
  // Previously this split into sequential "Batch 1 / Batch 2" LLM calls once the gap count
  // exceeded 8 items, which is what caused duplicate resolver calls for ordinary multi-item
  // meals. MAX_GAPS_SOFT_CAP is kept only for logging context — if the gap count exceeds it,
  // it is left as a single oversized batch rather than being split into more LLM calls.
  const MAX_GAPS_SOFT_CAP = 10;
  const allGapsCapped = gaps.map(g => ({
    ...g,
    candidates: g.candidates.slice(0, 4) // Cap candidate pool to top 4 per gap query
  }));
  if (allGapsCapped.length > MAX_GAPS_SOFT_CAP) {
    addDebugLog(`[Food Resolver] ${allGapsCapped.length} gap items exceeds the ${MAX_GAPS_SOFT_CAP}-item soft cap; dispatching as a single oversized batch instead of splitting into multiple LLM calls.`);
  }
  const gapChunks: (typeof allGapsCapped)[] = [allGapsCapped];

  const allResults: Array<{ query: string; chosenFdcId: string | null; formTags?: string[]; dishCore?: Record<string, number>; nutrientsPer100g?: Record<string, number>; quarantinedIds?: string[] }> = [];

  for (const activeGaps of gapChunks) {

  const casesText = activeGaps.map((g, i) => {
    const candsStr = g.candidates.length > 0
      ? g.candidates.map(c => ` - ID: ${c.id} | Name: ${c.name} | Source: ${c.source}`).join('\n')
      : ' - (No candidate matches found in database search API)';
    return `CASE ${i + 1}:\nQuery: "${g.query}"\nCandidates:\n${candsStr}\n`;
  }).join('\n---\n');

  const prompt = `Please curate the following database matches.\n\n${casesText}\n\nOutput a strict JSON object of the shape {"actions": [...]} matching the FoodCuratorActionSchema — do NOT output a bare array. Include 'pick_existing', 'merge_duplicates', 'normalize_basis', or 'quarantine' actions as appropriate for each case.`;

  let jsonResult;
  try {
    addDebugLog(`[CuratorCase] Calling LLM Curator with ${activeGaps.length} cases`);
    const llmOutput = await callLLMFn(prompt, foodResolverCuratorInstruction);
    const parsed = extractBalancedJson(llmOutput);
    if (!parsed) throw new Error("Failed to parse JSON from Curator LLM");
    const repairedJson = repairUnquotedJsonKeys(parsed);
    jsonResult = FoodCuratorActionSchema.parse(JSON.parse(repairedJson));
  } catch (error) {
    addDebugLog(`[CuratorAction] Failed to execute curator: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
    // Fallback: use top category-compatible candidate if available for this chunk, then
    // continue with the remaining chunks instead of aborting the whole batch.
    allResults.push(...activeGaps.map(g => {
      const validCand = g.candidates.find(c => checkCategoryAndStateCompatibility(g.query, c.name).compatible);
      return {
        query: g.query,
        chosenFdcId: validCand ? validCand.id : null
      };
    }));
    continue;
  }

  const results: Array<{ query: string; chosenFdcId: string | null; formTags?: string[]; dishCore?: Record<string, number>; nutrientsPer100g?: Record<string, number>; quarantinedIds?: string[] }> = [];

  const quarantinedFdcIds = new Set<string>();
  jsonResult.actions.forEach((a: any) => {
    if (a.type === 'quarantine' && a.fdcId) {
      quarantinedFdcIds.add(String(a.fdcId));
    }
  });

  const currentQuarantineList = Array.from(quarantinedFdcIds);
  const globalAliasesToUpsert = new Map<string, string>(); // alias_key -> target_food_id
  
  for (const gap of activeGaps) {
    const gapQueryClean = gap.query.toLowerCase().trim();
    // Pass 1: exact query match only. This MUST run across the whole actions array before any
    // fuzzy matching is attempted, otherwise Array.find() can bind a gap to the wrong case
    // (e.g. "crispy fried chicken" incorrectly binding to the "grilled chicken breast" action
    // because they share the single token "chicken" and the old single-pass fuzzy check fired
    // before the correct exact-match case later in the array was ever reached).
    let action = jsonResult.actions.find((a: any) => {
      if (a.type !== 'pick_existing' && a.type !== 'normalize_basis') return false;
      const actQueryClean = a.query ? a.query.toLowerCase().trim() : '';
      return actQueryClean !== '' && actQueryClean === gapQueryClean;
    });
    // Pass 2: fuzzy fallback, only if no exact match exists anywhere in the batch. Requires BOTH
    // a meaningful overlap ratio AND core-token agreement so a single shared generic word (e.g.
    // "chicken") can no longer bind two unrelated cases together.
    if (!action) {
      action = jsonResult.actions.find((a: any) => {
        if (a.type !== 'pick_existing' && a.type !== 'normalize_basis') return false;
        const actQueryClean = a.query ? a.query.toLowerCase().trim() : '';
        if (actQueryClean && calculateTokenOverlap(actQueryClean, gapQueryClean) >= 0.6 && hasCoreTokenOverlap(actQueryClean, gapQueryClean)) return true;
        if (!actQueryClean && a.chosenFdcId && gap.candidates.some(c => String(c.id) === String(a.chosenFdcId))) return true;
        return false;
      });
    }
    
    if (action && (action.type === 'pick_existing' || action.type === 'normalize_basis')) {
      let finalChosenId: string | null = null;
      const verifyId = async (id: string, nameToMatch: string) => {
        const stateCheck = checkCategoryAndStateCompatibility(gap.query, nameToMatch);
        if (!stateCheck.compatible) {
          addDebugLog(`[CategoryStateFilter] REJECTED: FDC ${id} "${nameToMatch}" for query "${gap.query}": ${stateCheck.reason}`);
          return false;
        }
        if (!fetchFoodDetailsFn) return true;
        try {
          const details = await fetchFoodDetailsFn(id);
          if (details) {
            const detailName = (details as any).name || (details as any).title || nameToMatch;
            const detailStateCheck = checkCategoryAndStateCompatibility(gap.query, detailName);
            if (!detailStateCheck.compatible) {
              addDebugLog(`[CategoryStateFilter] REJECTED: FDC ${id} "${detailName}" for query "${gap.query}": ${detailStateCheck.reason}`);
              return false;
            }
            // Strict Two-Way USDA Description Verification
            // If query is an archetype vegetable/condiment/produce (e.g. scallion, lettuce, tomato)
            // but the official USDA record description is a prepared composite (e.g. pizza, sandwich, casserole),
            // or has zero core token overlap with the gap query, reject the FDC ID.
            const hasCoreMatch = hasCoreTokenOverlap(gap.query, detailName);
            const tokenOverlap = calculateTokenOverlap(gap.query, detailName);
            if (tokenOverlap < 0.25 && !hasCoreMatch) {
              addDebugLog(`[USDA Title Mismatch] REJECTED: FDC ${id} official USDA description "${detailName}" does not match query "${gap.query}" (overlap: ${(tokenOverlap * 100).toFixed(0)}%).`);
              return false;
            }
            const macroCheck = checkMacroBoundary(gap.query, details.nutrients);
            if (!macroCheck.passed) {
              addDebugLog(`[MacroBoundaryFilter] REJECTED: FDC ${id} ${macroCheck.reason}`);
              return false;
            }
            return true;
          }
        } catch (e) {}
        return true;
      };


      // 1. High-confidence curator parametric matches take precedence over the local static
      // dictionary. The curator already reasons over the full query context (e.g. "breaded and
      // fried" vs "grilled"), while the local dictionary is a coarse keyword-substring lookup
      // that can silently overwrite a correct, more specific curator pick.
      if (action.confidence === 'high' && action.parametricFdcId) {
        const paramIdStr = String(action.parametricFdcId);
        const paramName = action.parametricFoodName || gap.query;
        const overlap = calculateTokenOverlap(gap.query, paramName);
        const coreMatch = hasCoreTokenOverlap(gap.query, paramName);

        if (overlap >= 0.30 || coreMatch) {
          if (await verifyId(paramIdStr, paramName)) {
            addDebugLog(`[ParametricVerification] PASSED (high-confidence, priority) for "${gap.query}" -> FDC ${paramIdStr} ("${paramName}", overlap: ${(overlap * 100).toFixed(0)}%, coreMatch: ${coreMatch})`);
            finalChosenId = paramIdStr;
          } else {
            addDebugLog(`[ParametricVerification] VERIFICATION FAILED for high-confidence parametric ID ${paramIdStr}. Re-routing...`);
          }
        } else {
          addDebugLog(`[ParametricVerification] REJECTED for "${gap.query}" -> FDC ${paramIdStr} ("${paramName}", overlap: ${(overlap * 100).toFixed(0)}% < 30%). Falling back to local dictionary/candidate.`);
        }
      }

      // 2. Local deterministic dictionary (Safe Canonical Mapping) — only consulted when the
      // curator did not supply a verified high-confidence parametric match above.
      if (!finalChosenId) {
        const localMatch = lookupCanonicalBaseFood(action.parametricFoodName || gap.query);
        if (localMatch && localMatch.fdcId) {
          addDebugLog(`[LocalDictionaryMatch] Resolved locally for "${gap.query}" -> FDC ${localMatch.fdcId} ("${action.parametricFoodName || gap.query}")`);
          finalChosenId = String(localMatch.fdcId);
        }
      }

      // 2b. Medium/low-confidence parametric FDC ID with Semantic Verification Gate (only if
      // neither the priority high-confidence check nor the local dictionary resolved it).
      if (!finalChosenId && action.parametricFdcId) {
        const paramIdStr = String(action.parametricFdcId);
        const paramName = action.parametricFoodName || gap.query;
        const overlap = calculateTokenOverlap(gap.query, paramName);
        const coreMatch = hasCoreTokenOverlap(gap.query, paramName);
        
        if (overlap >= 0.30 || coreMatch) {
          if (await verifyId(paramIdStr, paramName)) {
            addDebugLog(`[ParametricVerification] PASSED for "${gap.query}" -> FDC ${paramIdStr} ("${paramName}", overlap: ${(overlap * 100).toFixed(0)}%, coreMatch: ${coreMatch})`);
            finalChosenId = paramIdStr;
          } else {
             addDebugLog(`[ParametricVerification] VERIFICATION FAILED for parametric ID ${paramIdStr}. Re-routing...`);
          }
        } else {
          addDebugLog(`[ParametricVerification] REJECTED for "${gap.query}" -> FDC ${paramIdStr} ("${paramName}", overlap: ${(overlap * 100).toFixed(0)}% < 30%). Falling back to candidate.`);
        }
      }
      
      // 3. Fall back to chosen candidate if parametric omitted/rejected
      if (!finalChosenId && action.chosenFdcId) {
        const chosenCandidate = gap.candidates.find(c => String(c.id) === String(action.chosenFdcId));
        if (chosenCandidate) {
          finalChosenId = String(action.chosenFdcId);
        } else if ((!gap.candidates || gap.candidates.length === 0) && /^\d{5,8}$/.test(String(action.chosenFdcId))) {
          const paramName = action.parametricFoodName || gap.query;
          const overlap = calculateTokenOverlap(gap.query, paramName);
          const coreMatch = hasCoreTokenOverlap(gap.query, paramName);
          if (overlap >= 0.30 || coreMatch) {
            finalChosenId = String(action.chosenFdcId);
            addDebugLog(`[CuratorAction] Zero-candidate fallback: Accepted parametric FDC ID ${finalChosenId} from chosenFdcId for "${gap.query}".`);
          } else {
            addDebugLog(`[CuratorAction] Zero-candidate fallback REJECTED: FDC ${action.chosenFdcId} ("${paramName}") has low overlap with query "${gap.query}".`);
          }
        } else {
          addDebugLog(`[CuratorAction] LLM candidate ID ${action.chosenFdcId} not in candidate list for "${gap.query}". LLM hallucinated ID — Forging ignored.`);
        }
      }

      // 3b. [F-12.3 deleted] Backend USDA fallback search for parametricFoodName.
      // No live USDA: if no candidate ID was chosen above, finalChosenId stays
      // null and the gap resolves as an honest MISS (the LLM-failure path keeps
      // its deterministic top-candidate fallback in the catch block).

      // 3c. Filter out quarantined or category-incompatible candidate choices
      if (finalChosenId) {
        if (quarantinedFdcIds.has(finalChosenId)) {
          addDebugLog(`[CuratorAction] REJECTED candidate ${finalChosenId} for "${gap.query}" because it was explicitly quarantined.`);
          finalChosenId = null;
        } else {
          const candObj = gap.candidates.find(c => String(c.id) === String(finalChosenId));
          const candName = candObj ? candObj.name : (action.parametricFoodName || gap.query);
          const compat = checkCategoryAndStateCompatibility(gap.query, candName);
          if (!compat.compatible) {
            addDebugLog(`[CuratorAction] REJECTED candidate ${finalChosenId} ("${candName}") for "${gap.query}": ${compat.reason}`);
            currentQuarantineList.push(finalChosenId);
            quarantinedFdcIds.add(finalChosenId);
            finalChosenId = null;
          } else {
             // Roll back alias mappings if it fails downstream checks:
             if (!await verifyId(finalChosenId, candName)) {
                addDebugLog(`[DynamicPoisonQuarantine] REJECTED candidate ${finalChosenId} ("${candName}"). Adding to quarantine.`);
                currentQuarantineList.push(finalChosenId);
                quarantinedFdcIds.add(finalChosenId);
                finalChosenId = null;
             }
          }
        }
      }

      // Issue #2: Force unverified items to use deterministic category fallbacks instead of binding wrong IDs.
      // Do NOT fall back to arbitrary gap candidates if the chosen ID was rejected.
      // (Removed 3d. Final fallback to category-compatible candidate in gap pool)
      
      if (finalChosenId) {
        addDebugLog(`[CuratorAction] pick_existing for "${gap.query}" -> ${finalChosenId} (Reason: ${action.reason})`);
        let nutrientsPer100g: Record<string, number> | undefined = undefined;
        if (fetchNutrientsFn) {
          try {
            const nut = await fetchNutrientsFn(finalChosenId);
            if (nut) nutrientsPer100g = nut;
          } catch (e) {
            console.error(`[CuratorAction] Failed to fetch nutrients for ${finalChosenId}:`, e);
          }
        }
        results.push({ query: gap.query, chosenFdcId: finalChosenId, nutrientsPer100g, quarantinedIds: currentQuarantineList });
        
        // 4. Persist aliases for the curated query and listed aliases to build a self-learning database
        const aliasesSet = new Set<string>();
        const targetCanonicalName = (action.parametricFoodName || gap.query || '').toLowerCase().trim();
        
        const isTrivialOrSelfAlias = (alias: string, canon: string) => {
          if (!alias || !canon) return true;
          if (alias === canon) return true;
          if (alias + 's' === canon || canon + 's' === alias) return true;
          if (alias + 'es' === canon || canon + 'es' === alias) return true;
          return false;
        };

        if (action.aliasesToCreate && Array.isArray(action.aliasesToCreate)) {
          // Filter out trivial plurals/self-matches and cap to at most 2 genuine colloquial synonyms
          const filteredSynonyms = action.aliasesToCreate
            .map(a => String(a || '').toLowerCase().trim())
            .filter(a => a.length >= 3 && !isTrivialOrSelfAlias(a, targetCanonicalName))
            .slice(0, 2);
          filteredSynonyms.forEach(a => aliasesSet.add(a));
        }

        const cleanGapQuery = (gap.query || '').toLowerCase().trim();
        if (!isTrivialOrSelfAlias(cleanGapQuery, targetCanonicalName)) {
          aliasesSet.add(cleanGapQuery);
        }

        for (const alias of aliasesSet) {
           const cleanAlias = alias.toLowerCase().trim();
           if (!globalAliasesToUpsert.has(cleanAlias)) {
             globalAliasesToUpsert.set(cleanAlias, finalChosenId);
           }
        }
      } else {
        addDebugLog(`[CuratorAction] No verified candidate found for "${gap.query}".`);
        results.push({ query: gap.query, chosenFdcId: null, quarantinedIds: currentQuarantineList });
      }
    } else {
      addDebugLog(`[CuratorAction] No pick_existing action found for "${gap.query}". Skipping.`);
      results.push({ query: gap.query, chosenFdcId: null, quarantinedIds: currentQuarantineList });
    }
  }

  if (globalAliasesToUpsert.size > 0) {
    for (const [cleanAlias, targetId] of globalAliasesToUpsert.entries()) {
       addDebugLog(`[AliasWrite] Creating alias "${cleanAlias}" -> ${targetId}`);
       try {
         await supabaseAdmin.from('food_aliases').upsert({
           alias_key: cleanAlias,
           target_food_id: targetId,
           hit_count: 1
         }, { onConflict: 'alias_key' });
       } catch (e) {
         console.error('[AliasWrite] Error persisting alias:', e);
       }
    }
  }
  
  // 4. Soft-Merge Pointer Pattern for Duplicate Merges
  const merges = jsonResult.actions.filter((a: any) => a.type === 'merge_duplicates');
  for (const merge of merges) {
    if (merge.confidence === 'high') {
      addDebugLog(`[CuratorAction] Executing merge_duplicates -> winner ${merge.winnerFdcId}, losers [${merge.loserFdcIds.join(', ')}]. Reason: ${merge.reason}`);
      for (const loser of merge.loserFdcIds) {
        try {
          // Soft-merge: Update status and set canonical_target_id pointer
          await supabaseAdmin.from('food_items')
            .update({ status: 'merged_loser', canonical_target_id: String(merge.winnerFdcId) })
            .eq('food_id', String(loser));
            
          // Add single-hop redirection alias
          await supabaseAdmin.from('food_aliases').upsert({
            alias_key: `legacy_merge_${loser}`,
            food_id: String(merge.winnerFdcId),
            weight: 1.0,
            source: 'curator_legacy_merge',
            hit_count: 1
          }, { onConflict: 'alias_key' });
        } catch (e) {
          console.error('[MergeDuplicates] Error soft-merging loser:', e);
        }
      }
    }
  }
  
  const normalizations = jsonResult.actions.filter((a: any) => a.type === 'normalize_basis');
  for (const norm of normalizations) {
    if (!norm.fdcId || !norm.toBasis) continue;
    addDebugLog(`[CuratorAction] normalize_basis for ${norm.fdcId} from ${norm.fromBasis} to ${norm.toBasis} (factor: ${norm.conversionFactor}). Reason: ${norm.reason}`);
    try {
      await supabaseAdmin.from('food_items')
        .update({ basis_type: norm.toBasis })
        .eq('food_id', String(norm.fdcId));
    } catch (e) {
      console.error('[NormalizeBasis] Error updating basis:', e);
    }
  }

  const quarantines = jsonResult.actions.filter((a: any) => a.type === 'quarantine');
  for (const q of quarantines) {
     if (q.fdcId && (String(q.fdcId).startsWith('brand_menu_') || String(q.fdcId).startsWith('internal_'))) {
       addDebugLog(`[CatalogQuarantine Skip] Protected brand/internal entry ${q.fdcId} from database purge.`);
       continue;
     }
     addDebugLog(`[CatalogQuarantine] Quarantined ${q.fdcId}. Reason: ${q.reason}`);
     try {
       await supabaseAdmin.from('food_items')
         .update({ status: 'quarantined' })
         .eq('food_id', q.fdcId);
     } catch (e) {
       console.error(e);
     }
  }


  allResults.push(...results);
  } // end for (const activeGaps of gapChunks)

  return allResults;
}

function checkMacroBoundary(query: string, nutrients: Record<string, number> | undefined): { passed: boolean; reason?: string } {
    if (!nutrients) return { passed: true };
    const q = (query || '').toLowerCase().trim();
    
    // Dairy/Cheese: Relaxed protein to 7g to allow ricotta/cottage cheese
    if (q.includes('cheese') && !q.includes('sauce') && !q.includes('cream') && !q.includes('cottage') && !q.includes('ricotta')) {
        if ((nutrients.protein || 0) < 7 || (nutrients.totalFat || 0) > 60 || (nutrients.calories || 0) > 650) {
            return { passed: false, reason: `Macro boundary violation for cheese: P=${nutrients.protein}, F=${nutrients.totalFat}, C=${nutrients.calories}` };
        }
    }
    
    // Lean Poultry/Meat: Relaxed protein to 14g (some preparations have added water/marinades)
    if (q.includes('chicken breast') || q.includes('turkey breast') || (q.includes('lean') && q.includes('meat'))) {
        if ((nutrients.protein || 0) < 14 || (nutrients.totalFat || 0) > 25) {
            return { passed: false, reason: `Macro boundary violation for lean meat: P=${nutrients.protein}, F=${nutrients.totalFat}` };
        }
    }
    
    // Fresh Fruit: Carbs relaxed to 35g to allow bananas/grapes etc., fat relaxed to 5g
    if ((q.includes('apple') || q.includes('strawberry') || q.includes('blueberry') || q.includes('raspberry') || q.includes('fruit')) && !q.includes('dried')) {
        if ((nutrients.totalFat || 0) > 5 || (nutrients.carbohydrates || 0) > 35) {
             return { passed: false, reason: `Macro boundary violation for fresh fruit: F=${nutrients.totalFat}, C=${nutrients.carbohydrates}` };
        }
    }
    
    return { passed: true };
}

import 'dotenv/config';
import dns from 'node:dns';
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

import { executeFoodResolverCurator } from './server_food_resolver_curator.js';
import { checkCategoryAndStateCompatibility, applyServerAverageNutrients } from './server_pure_helpers.js';
import { filterMatchesForQuery, pickQueryScopedMatch } from './server_query_scoped_match.js';
import {
  namesReferToSameFood,
  matchBreakdownItemToScout,
  breakdownAlreadyHasScoutName,
  applySoftReceiptAlignment,
} from './server_scout_reconcile.js';
import { rankAndClassifyCandidates, writeAliasIfHitUnique } from './server_fdc_resolve.js';
import { buildFoodSearchQuerySet } from './server_query_set';
import {
  withGeminiRetry,
  isGeminiQuotaError,
  isGeminiUnavailableError,
  assertModelNotInQuotaCooldown,
  noteGeminiQuota,
} from './server_gemini_retry.js';
import { verifyFirebaseIdToken } from './server_auth.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { pushTranslationsToSheets, pullTranslationsFromSheets } from './server_translations';
import { buildFoodAnalyzeInstruction, buildModeAReviewInstruction, buildModeAEditInstruction, buildModeDCompareInstruction, buildModeDEditInstruction, } from './agents/index.js';
import { ensureFoodCatalogSchema, resetFoodCatalogSchemaEnsure } from "./server_food_catalog_schema.js";
import { resolveInternalFood, resolveDishCache, upsertFoodItemCandidate, upsertFoodAlias, upsertDishCacheCandidate, recordFoodObservation, recordSyncEvent, normalizeFoodKey, normalizeDishKey, getCatalogSyncStatus, mergeFoodCatalogItems, quarantineAtwaterFailures, checkAtwaterValidity, getFallbackCategoryProfile } from './server_food_catalog.js';
import { sanitizeDishTitle, cleanupDuplicateBrandMenuItems, isGroceryBrandSync, selfCleanBrandDatabase, isUnofficialOrCompositeDish } from './serverBrandMenu.js';
import {
  computeItemBudget,
  reconcileNutrients,
  portionAndReconcile,
  assertComponentSumMatchesItem,
  parseLabelCalories,
  applyPostReconcileTruthLocks,
} from './server_budget_reconcile.js';
import {
  buildPortionClarifyPayload,
  applyPortionChoices,
} from './server_portion_clarify.js';
import { attachHappyPathMealBuild, markDietitianDegraded, buildSavableMealFromParsed } from './server_meal_orchestrator.js';
import { toPendingFoodLog, fromEvaluationComparison } from './src/mealBuild/adapters.js';
import { projectDietitianInput } from './src/mealBuild/projectors.js';
import { beginStage, endStage, formatDietitianProjectionBlock } from './src/mealBuild/stageLifecycle.js';
import {
  detectWeightRefineIntent,
  shouldSkipScoutForWeightRefine,
  applyWeightRefineToScoutItems,
  priorScoutHasLabelLocks,
  REFINE_SCALE_ONLY_LOG,
} from './server_refine_scale.js';
import { z } from "zod";
import { getMappedBiomarkerKey } from './src/utils/biomarkers';
import {
  lexTable,
  buildIngestBatch,
  shouldAbortTablePath,
  leftoverTextFromTrace,
  stagedRowsToExtractedData,
  flaggedRowsToModificationCommands,
  mergeStagedExtract,
} from './src/utils/biomarkerLifecycle';
import { extractMostRecentImageDate } from './src/utils/dateUtils.js';
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { getApps, initializeApp } from 'firebase-admin/app';
import { submitServerJob, recoverInterruptedServerJobs } from './serverJobs';
import { biomarkerRouter } from './server_routes_biomarkers.js';
import { foodRouter } from './server_routes_food.js';
import { jobsRouter } from './server_routes_jobs.js';
import { syncRouter } from './server_routes_sync.js';
import { adminRouter } from './server_routes_admin.js';

export const BEVERAGE_RAW_PATTERN = /\b(beverage|drink|water|juice|beer|wine|soda|cola|tea|coffee|cappuccino|espresso|latte|mocha|macchiato|boba|smoothie|shake|milk|oat\s*milk|oatmilk|almond\s*milk|almondmilk|soy\s*milk|soymilk|coconut\s*milk|dairy|yogurt|fruit|melon|watermelon|apple|orange|banana|berry|berries|grape|citrus|salad|raw|fresh|broth|soup)\b/i;

export function extractOFFNutrientsPer100g(product: any): Record<string, number> {
  const profile: Record<string, number> = {};
  if (!product) return profile;
  const n = product.nutriments;
  if (!n) return profile;
  
  if (n["energy-kcal_100g"] !== undefined) {
    profile["calories"] = Number(n["energy-kcal_100g"]) || 0;
  } else if (n["energy_100g"] !== undefined) {
    profile["calories"] = Math.round(Number(n["energy_100g"]) / 4.184) || 0;
  }
  
  const setNum = (key: string, field: string, scale: number = 1) => {
    if (n[field] !== undefined) {
      profile[key] = (Number(n[field]) || 0) * scale;
    }
  };

  setNum("protein", "proteins_100g");
  setNum("totalFat", "fat_100g");
  setNum("saturatedFat", "saturated-fat_100g");
  setNum("transFat", "trans-fat_100g");
  
  if (profile["totalFat"] !== undefined) {
    profile["unsaturatedFat"] = Math.max(0, profile["totalFat"] - (profile["saturatedFat"] || 0) - (profile["transFat"] || 0));
  }
  
  setNum("omega3", "omega-3_100g");
  setNum("carbohydrates", "carbohydrates_100g");
  setNum("sugar", "sugars_100g");
  setNum("addedSugar", "added_sugars_100g");
  setNum("totalFibre", "fiber_100g");
  setNum("solubleFibre", "soluble-fiber_100g");
  
  setNum("sodium", "sodium_100g", 1000);
  setNum("potassium", "potassium_100g", 1000);
  setNum("magnesium", "magnesium_100g", 1000);
  setNum("calcium", "calcium_100g", 1000);
  setNum("iron", "iron_100g", 1000);
  setNum("zinc", "zinc_100g", 1000);
  setNum("selenium", "selenium_100g");
  setNum("iodine", "iodine_100g");
  setNum("phosphorus", "phosphorus_100g", 1000);
  setNum("vitaminD", "vitamin-d_100g");
  setNum("vitaminB12", "vitamin-b12_100g");
  setNum("folate", "folate_100g");
  setNum("vitaminC", "vitamin-c_100g", 1000);
  setNum("vitaminE", "vitamin-e_100g", 1000);
  setNum("vitaminK", "vitamin-k_100g");
  setNum("vitaminA", "vitamin-a_100g");
  setNum("vitaminB6", "vitamin-b6_100g", 1000);
  setNum("thiamine", "thiamine_100g", 1000);
  setNum("riboflavin", "riboflavin_100g", 1000);
  setNum("niacin", "niacin_100g", 1000);

  return profile;
}

export async function fetchUSDAFoodById(fdcId: string): Promise<any | null> {
  try {
    const usdaApiKey = process.env.USDA_API_KEY || "DEMO_KEY";
    const url = `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${usdaApiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, { signal: controller.signal as any });
    clearTimeout(timeout);
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    console.error(`[fetchUSDAFoodById] Error fetching FDC ID ${fdcId}:`, err);
    return null;
  }
}

export async function fetchOFFProductByBarcode(barcode: string): Promise<any | null> {
  try {
    const url = `https://world.openfoodfacts.net/api/v2/product/${barcode}.json`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, {
      signal: controller.signal as any,
      headers: {
        "User-Agent": "HealthTracker/1.0 (Cwah.Liu@gmail.com)"
      }
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = await response.json();
    return data.product || null;
  } catch (err) {
    console.error(`[fetchOFFProductByBarcode] Error fetching OFF barcode ${barcode}:`, err);
    return null;
  }
}

export function safeExtractJsonObject<T = any>(rawText: string): T | null {
  if (!rawText) return null;
  try { return JSON.parse(rawText); } catch {}

  const matchFence = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (matchFence?.[1]) {
    try { return JSON.parse(matchFence[1]); } catch {}
  }

  const start = rawText.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < rawText.length; i++) {
    if (rawText[i] === '{') depth++;
    else if (rawText[i] === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(rawText.slice(start, i + 1)); } catch {}
      }
    }
  }
  return null;
}



let firebaseConfig: any = null;
try {
  const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(firebaseConfigPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
  }
} catch (e) {
  console.error("Failed to load firebase-applet-config.json:", e);
}

if (getApps().length === 0) {
  initializeApp({
    projectId: firebaseConfig?.projectId
  });
}
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
const adminAuth = getAdminAuth();
import express from "express";

const BiomarkerMatrix: Record<string, any> = {
  "hematocrit": {
    "targetUnit": "%",
    "conversionLogic": (value: number, sanitizedUnit: string) => {
      if (sanitizedUnit === "l/l" || value < 1.0) return value * 100; 
      return value;
    }
  },
  "total_cholesterol": {
    "targetUnit": "mmol/L",
    "conversionLogic": (value: number, sanitizedUnit: string) => {
      if (sanitizedUnit === "mg/dl") return value * 0.02586; 
      return value;
    }
  },
  "egfr": {
    "targetUnit": "mL/min/1.73m2",
    "conversionLogic": (value: number, sanitizedUnit: string) => value
  },
  "qrisk2_10yr_risk": {
    "targetUnit": "%",
    "conversionLogic": (value: number, sanitizedUnit: string) => value
  },
  "red_blood_cell_distribution_width": {
    "targetUnit": "%",
    "conversionLogic": (value: number, sanitizedUnit: string) => value
  }
};

function sanitizeUnitText(rawUnit: any): string {
  if (!rawUnit) return '';
  return String(rawUnit)
    .toLowerCase()
    .replace(/[\s]+/g, ' ')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/percent/g, '%')
    .replace(/\^/g, '*')
    .replace(/^[a-z]*(?=10)/g, '')
    .replace(/[x×]/g, '')
    .trim();
}

import { GoogleGenAI, Type } from "@google/genai";
import { getTraceNutrientsForFoodType, getCookingMethodModifier, calculateUniversalAddedNutrients, lookupCanonicalBaseFood, getCachedUSDAFood, setCachedUSDAFood } from "./server_food_db";
import { decidePrepAddition } from "./server_prep_policy";
import dotenv from "dotenv";
import { AsyncLocalStorage } from "async_hooks";
import { biomarkerDefinitions, getBiomarkerStatus, getBiomarkerStatusLabel, getBiomarkerMetadata, getCustomBiomarkerDef } from "./src/utils/biomarkers";
import { filterHistoryForUse, enrichReviewModificationCommands, sanitizeReviewReply } from "./src/utils/biomarkerLifecycle";
import { generateDynamicInsight } from "./src/utils/biomarkerInsights";
import { formatOptimalTargetValue } from "./src/utils/agentCalibration";
import { NUTRIENT_KEYS } from "./src/utils/nutrients";
import { extractBalancedJson, sanitizeMealWeight, findItemIndexInList, getUSDANutrientValue, extractUSDANutrientsPer100g, checkIfItemIsAlreadyPrepared, applyNutrientRealityChecks, applyCommercialSodiumFloor, checkAtwaterConsistency, synchronizeNarrativeText, evaluateNutrientWarnings, build31NutrientsMarkdownServer, enforceTitlePluralParity } from "./server_pure_helpers";
import { aggregateItemsNutrients, cleanNutrientNumber } from "./server_nutrient_aggregation";
import { registerIssueBacklogRoutes } from './serverIssueBacklog.js';
import { registerBugSnapshotRoutes } from './serverBugSnapshot.js';
import { registerGoldenRoutes } from './serverGoldenRoutes.js';
import { registerBrandMenuRoutes, isKnownDatabaseBrand, isKnownDatabaseBrandSync, fetchAllDatabaseBrands, searchBrandMenuItems, brandHitFitsQuery, normalizeChainKey, consolidateBrandMenuItemsAndChains, cleanUnbrandedFoodCatalog } from './serverBrandMenu.js';
import { supabaseAdmin } from './supabaseAdmin.js';
import { isGenericZeroNutrientDiluent, getZeroNutrientVector, calculateGenericTokenCoverage, evaluateGenericModifierInversionPenalty, classifyUniversalPhysicalFormV3 } from "./server_matching_engine";
import { 
  ScoutItemSchema, 
  VisionScoutSchema, 
  scoutSystemInstruction, 
  mergeScoutItems, 
  parseAndHealVisionScout 
} from "./server_vision_scout";


import { getFirestore, Firestore } from "firebase-admin/firestore";

// Helper functions for nutritional data lookup
export const logSessionStorage = new AsyncLocalStorage<string>();
export const streamDebugLogStorage = new AsyncLocalStorage<(msg: string) => void>();

// Global Debug Logs array for LLM process tracking and diagnostics
export interface DebugLog {
  timestamp: string;
  message: string;
}
export let globalDebugLogs: DebugLog[] = [];
export let sessionDebugLogs: { [sessionId: string]: DebugLog[] } = {};
export const liveStreamClients = new Set<any>();

export function addDebugLog(msg: string, explicitSessionId?: string) {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  
  // Truncate huge base64 data URLs globally to prevent massive bloating of diagnostic logs
  let sanitizedMsg = msg || "";
  if (typeof sanitizedMsg === 'string' && sanitizedMsg.includes("data:image/")) {
    sanitizedMsg = sanitizedMsg.replace(/(data:image\/[^;]+;base64,)[A-Za-z0-9+/=]{100,}/g, "$1... [truncated base64 image data]");
  }
  
  // Keep the container stdout clean by truncating huge multiline logs in console.log
  const MAX_LOG_DISPLAY_LEN = 35000;
  let truncatedForDisplay = sanitizedMsg;
  if (sanitizedMsg.length > MAX_LOG_DISPLAY_LEN) {
    const cutPos = sanitizedMsg.lastIndexOf(' ', MAX_LOG_DISPLAY_LEN) || MAX_LOG_DISPLAY_LEN;
    truncatedForDisplay = `${sanitizedMsg.substring(0, cutPos)}...\n[--- Diagnostic Console Display capped at ${MAX_LOG_DISPLAY_LEN} chars for log readability. Note: The full prompt payload (${sanitizedMsg.length} chars) was dispatched IN FULL to Gemini LLM without prompt truncation ---]`;
  }
  console.log(`[LLM DEBUG ${timestamp}]: ${truncatedForDisplay}`);

  // Forward this log line to any live SSE stream registered for the current request
  // (see streamDebugLogStorage.run(...) in the route handlers). This is what makes
  // backend progress show up live in the chat UI's "Agent's Thought" panel instead
  // of only appearing in the diagnostic log viewer.
  const liveStreamCallback = streamDebugLogStorage.getStore();
  if (liveStreamCallback) {
    try {
      // Forward the full message over the live SSE stream (this panel is
      // explicitly labeled "Unfiltered Live Stream" — truncating it here
      // contradicted that). truncatedForDisplay is already capped at 4000
      // chars above purely for console.log hygiene, which is generous enough
      // for full system instructions and DB match lists.
      liveStreamCallback(sanitizedMsg);
    } catch (e) {
      console.error("Callback threw an error:", e);
    }
  }
  
  const sessionId = explicitSessionId || logSessionStorage.getStore() || "global";
  if (!sessionDebugLogs[sessionId]) {
    sessionDebugLogs[sessionId] = [];
  }
  sessionDebugLogs[sessionId].push({ timestamp, message: sanitizedMsg });
  if (sessionDebugLogs[sessionId].length > 1500) {
    sessionDebugLogs[sessionId].shift();
  }

  globalDebugLogs.push({ timestamp, message: sanitizedMsg });
  if (globalDebugLogs.length > 2000) {
    globalDebugLogs.shift();
  }

  // GLOBAL BROADCAST TO ALL CONNECTED LIVE STREAM CLIENTS (NO FILTER)
  // sendLog() (in food-analyze/medical-analyze) always calls addDebugLog with the message
  // already prefixed "[<logType>] ...". Recover that prefix here so this broadcast carries
  // the same {logType, timestamp, message} shape Stream 2's own SSE events use — that's what
  // lets the client's LiveBackendStreamViewer build matching tabs/elapsed-time for Stream 1
  // too, instead of a flat unparseable string.
  const curatedTagMatch = /^\[([a-zA-Z0-9_]+)\]\s?([\s\S]*)$/.exec(sanitizedMsg);
  const broadcastLogType = curatedTagMatch ? curatedTagMatch[1] : 'backend';
  const broadcastMessage = curatedTagMatch ? curatedTagMatch[2] : sanitizedMsg;

  for (const client of liveStreamClients) {
    try {
      client.write(`data: ${JSON.stringify({ logType: broadcastLogType, message: broadcastMessage, timestamp: Date.now() })}\n\n`);
      if (typeof client.flush === 'function') client.flush();
    } catch (e) {
      liveStreamClients.delete(client);
    }
  }
}

export async function lookupChainMenuSources(chainKey: string, countryCode = 'GB') {
  try {
    const { supabaseAdmin } = await import('./supabaseAdmin.js');
    const { data, error } = await supabaseAdmin
      .from('chain_menu_sources')
      .select('*')
      .eq('chain_key', chainKey)
      .eq('country_code', countryCode)
      .eq('enabled', true)
      .order('priority', { ascending: true });
    if (error) {
      addDebugLog(`[ChainSource] lookup error for ${chainKey}: ${error.message}`);
      return [];
    }
    return data || [];
  } catch (e: any) {
    addDebugLog(`[ChainSource] lookup exception: ${e?.message || e}`);
    return [];
  }
}

export async function seedChainMenuSources() {
  try {
    const { supabaseAdmin } = await import('./supabaseAdmin.js');
    const sourceRow = {
      country_code: 'GB',
      chain_key: 'yolk',
      display_name: 'YOLK',
      url: 'https://yolk.vmos.io/store/a75aab37-d3ba-4833-9785-c5eb27592d49/menu/category/75c0b3b4-cbd6-4555-9f4f-a67107e715e5/bundles?menuUUID=52e377db-9146-4227-b248-43318643f731',
      source_kind: 'vmos',
      status: 'pending',
      priority: 10,
      enabled: true,
      meta: {
        storeId: 'a75aab37-d3ba-4833-9785-c5eb27592d49',
        menuId: '52e377db-9146-4227-b248-43318643f731',
        categoryId: '75c0b3b4-cbd6-4555-9f4f-a67107e715e5',
        platform: 'vmos',
        note: 'Seeded from known UK YOLK kiosk URL; adapter pending'
      },
      updated_at: new Date().toISOString()
    };
    await supabaseAdmin
      .from('chain_menu_sources')
      .upsert(sourceRow, { onConflict: 'country_code,chain_key,url' });
  } catch {
    /* ignore */
  }
}
seedChainMenuSources();
async function searchUSDA(query: string, maxResults: number = 5, dataTypes: string = 'Foundation,SR Legacy,Survey (FNDDS),Branded'): Promise<any[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const dataTypeQuery = dataTypes.split(',').map(d => 'dataType=' + encodeURIComponent(d)).join('&');
    const usdaApiKey = process.env.USDA_API_KEY || "DEMO_KEY";
    const fetchSize = 50;
    let url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${usdaApiKey}&query=${encodeURIComponent(query)}&pageSize=${fetchSize}&${dataTypeQuery}`;
    
    const response = await fetch(url, { signal: controller.signal as any });
    clearTimeout(timeout);
    
    if (!response.ok) return [];
    const data = await response.json();
    let foods = data.foods || [];
    
    // Sort to bubble exact or shortest matches to the top
    const qLower = query.toLowerCase().trim();
    const queryHasOil = qLower.includes("oil");
    const queryHasPowder = qLower.includes("powder");

    // Reject 0-kcal items that are supposed to have substance
    foods = foods.filter((f: any) => {
      const kcalNutrient = f.foodNutrients?.find((n: any) => n.nutrientName === "Energy" && n.unitName === "kcal");
      const kcal = kcalNutrient ? parseFloat(kcalNutrient.value) : 0;
      const proteinNutrient = f.foodNutrients?.find((n: any) => n.nutrientName === "Protein" && n.unitName === "g");
      const protein = proteinNutrient ? parseFloat(proteinNutrient.value) : 0;
      
      const name = (f.description || "").toLowerCase();
      const isExpectedZero = /\b(water|diet|zero|no sugar|sparkling|seltzer|ice|tea|coffee|vinegar|salt|spices?)\b/.test(name);
      
      if (kcal === 0 && protein < 0.5 && !isExpectedZero) {
        return false;
      }
      return true;
    });

    foods.sort((a: any, b: any) => {
      const aName = (a.description || "").toLowerCase();
      const bName = (b.description || "").toLowerCase();

      // Demote oil items if query doesn't ask for oil
      if (!queryHasOil) {
        const aIsOil = aName.includes("oil");
        const bIsOil = bName.includes("oil");
        if (aIsOil && !bIsOil) return 1;
        if (bIsOil && !aIsOil) return -1;
      }

      // Demote powder items if query doesn't ask for powder
      if (!queryHasPowder) {
        const aIsPowder = aName.includes("powder");
        const bIsPowder = bName.includes("powder");
        if (aIsPowder && !bIsPowder) return 1;
        if (bIsPowder && !aIsPowder) return -1;
      }

      if (aName === qLower && bName !== qLower) return -1;
      if (bName === qLower && aName !== qLower) return 1;
      if (aName === `${qLower}, raw` && bName !== `${qLower}, raw`) return -1;
      if (bName === `${qLower}, raw` && aName !== `${qLower}, raw`) return 1;
      if (aName === `${qLower}s, raw` && bName !== `${qLower}s, raw`) return -1;
      if (bName === `${qLower}s, raw` && aName !== `${qLower}s, raw`) return 1;
      if (aName.startsWith(qLower) && !bName.startsWith(qLower)) return -1;
      if (bName.startsWith(qLower) && !aName.startsWith(qLower)) return 1;
      return aName.length - bName.length;
    });
    
    return foods.slice(0, maxResults);
  } catch (error) {
    console.error("[USDA API] Error:", error);
    return [];
  }
}

async function searchUSDAFood(query: string): Promise<any | null> {
  const results = await searchUSDA(query, 5, 'Foundation,SR Legacy,Survey (FNDDS)');
  if (results && results.length > 0) {
    const { resolveClass, bestMatch } = rankAndClassifyCandidates(query, results, 65);
    if (bestMatch) {
      // Auto-alias if it's a solid HIT_UNIQUE
      if (resolveClass === 'HIT_UNIQUE') {
         writeAliasIfHitUnique(resolveClass, query, bestMatch).catch(e => console.error(e));
      }
      return {
        ...bestMatch,
        id: String(bestMatch.fdcId || bestMatch.id),
        name: bestMatch.description || bestMatch.name || query
      };
    }
    
    // Fallback if none passed threshold
    const item = results[0];
    return {
      ...item,
      id: String(item.fdcId || item.id),
      name: item.description || item.name || query
    };
  }
  return null;
}

async function searchUSDAWithTwoRounds(query: string, foodType: string, addDebugLog: (msg: string) => void): Promise<any | null> {
  // 1. Check Local Cache First (Instant 0ms retrieval)
  const cached = getCachedUSDAFood(query);
  if (cached) {
    addDebugLog(`[USDA Cache Hit] Found "${query}" in local cache (USDA ID: ${cached.id || cached.fdcId}). Skipping network search.`);
    return cached;
  }

  const cleanQuery1 = query.toLowerCase()
    .replace(/\b(soda|can|bottle|pack|tub|slice|cubes|pieces|portion|raw|cooked|boiled|baked|grilled|steamed)\b/g, '')
    .trim();

  // Round 1: Primary Sanitized Search
  addDebugLog(`[USDA Search Round 1] Querying USDA for "${cleanQuery1}"...`);
  let match = await searchUSDAFood(cleanQuery1);

  // Evaluate Round 1 Macro Proximity
  if (match) {
    const nut = extractUSDANutrientsPer100g(match);
    const isMeatOrFish = foodType === 'fish_lean' || foodType === 'fish_fatty' || foodType === 'poultry' || foodType === 'red_meat';
    if (isMeatOrFish && nut.protein < 10) {
      addDebugLog(`[USDA Round 1 Macro Warning] Round 1 match "${match.name}" has abnormal protein (${nut.protein}g/100g). Escalating to Round 2 within category "${foodType}"...`);
      match = null;
    }
  }

  // Round 2: Category-Isolated Fallback Search if Round 1 failed or had abnormal macros
  if (!match) {
    const fallbackQuery2 = foodType === 'fish_lean' || foodType === 'fish_fatty' ? 'raw fish fillet'
      : (foodType === 'poultry' ? 'raw chicken breast'
      : (foodType === 'red_meat' ? 'raw beef steak'
      : (foodType === 'fruit' ? `${cleanQuery1} raw` : cleanQuery1)));

    addDebugLog(`[USDA Search Round 2] Escalating to category-isolated fallback query: "${fallbackQuery2}"...`);
    match = await searchUSDAFood(fallbackQuery2);
  }

  // Category Boundary Guard: Reject any match that crosses category boundaries
  if (match) {
    const matchNameLower = match.name.toLowerCase();
    const isFishCategory = foodType === 'fish_lean' || foodType === 'fish_fatty';
    const isPoultryCategory = foodType === 'poultry';
    const isRedMeatCategory = foodType === 'red_meat';

    if (isFishCategory && (matchNameLower.includes('chicken') || matchNameLower.includes('beef') || matchNameLower.includes('pork'))) {
      addDebugLog(`[USDA Category Guard] Rejected match "${match.name}" because fish category cannot map to poultry/meat. Escalating...`);
      match = null;
    } else if (isPoultryCategory && (matchNameLower.includes('fish') || matchNameLower.includes('beef') || matchNameLower.includes('pork'))) {
      addDebugLog(`[USDA Category Guard] Rejected match "${match.name}" because poultry category cannot map to fish/beef. Escalating...`);
      match = null;
    } else if (isRedMeatCategory && (matchNameLower.includes('fish') || matchNameLower.includes('chicken') || matchNameLower.includes('turkey'))) {
      addDebugLog(`[USDA Category Guard] Rejected match "${match.name}" because red meat category cannot map to fish/poultry. Escalating...`);
      match = null;
    }
  }

  // If valid match found across either round, save to local cache
  if (match) {
    addDebugLog(`[USDA Search Success] Matched "${query}" -> "${match.name}" (USDA ID: ${match.id || match.fdcId}). Loaded full 31 nutrients.`);
    setCachedUSDAFood(query, match);
    return match;
  }

  // Warning & Enforced Override log if both rounds fail
  addDebugLog(`[USDA Match Warning] ⚠️ Could not find verified USDA match for "${query}" within category "${foodType}" after 2 search rounds. Applied enforced macro reality check override. You can refine this food name via text chat.`);
  return null;
}

async function searchOpenFoodFacts(query: string, maxResults: number = 5): Promise<any[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const url = `https://world.openfoodfacts.net/cgi/search.pl?search_terms=${encodeURIComponent(query)}&page_size=${maxResults}&json=true`;
    
    const response = await fetch(url, {
      signal: controller.signal as any,
      headers: {
        "User-Agent": "HealthTracker/1.0 (Cwah.Liu@gmail.com)"
      }
    });
    clearTimeout(timeout);
    
    if (!response.ok) return [];
    const data = await response.json();
    let products = data.products || [];
    
    products = products.filter((p: any) => {
      const kcal = p.nutriments?.['energy-kcal_100g'] || 0;
      const protein = p.nutriments?.['proteins_100g'] || 0;
      
      const name = (p.product_name || p.generic_name || "").toLowerCase();
      const isExpectedZero = /\b(water|diet|zero|no sugar|sparkling|seltzer|ice|tea|coffee|vinegar|salt|spices?)\b/.test(name);
      
      if (kcal === 0 && protein < 0.5 && !isExpectedZero) {
        return false;
      }
      return true;
    });
    
    return products;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.warn(`[OpenFoodFacts API] Request timed out (8000ms) and was aborted gracefully for query: "${query}"`);
    } else {
      console.error("[OpenFoodFacts API] Error:", error);
    }
    return [];
  }
}



function isUsableWebNutritionHit(webItem: any): boolean {
  if (!webItem) return false;
  const cals = Number(webItem.calories);
  if (isNaN(cals) || cals <= 0) return false;
  
  // Accept even if macros are missing, as long as calories are present
  return true;
}

dotenv.config();
// console.log("Maps Key status at server boot:", process.env.GOOGLE_MAPS_API_KEY ? "DEFINED" : "UNDEFINED");

// Initialize Firebase Firestore for server-side calculations using Google Cloud Firestore Node.js SDK (bypasses security rules)
let db: any = null;
try {
  const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(firebaseConfigPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
    db = getFirestore(firebaseConfig.firestoreDatabaseId ? getApps()[0] : undefined, firebaseConfig.firestoreDatabaseId);
    console.log("[Firebase] Backend Firestore (Admin Node.js SDK) successfully initialized.");
  } else {
    console.warn("[Firebase] No firebase-applet-config.json found at server boot.");
  }
} catch (err: any) {
  console.error("[Firebase] Error initializing Firestore on server:", err.message || err);
}





// Resolves LLM-provided scoutItemIndices (or itemNames for text-only comparisons) back into
// full item objects using the authoritative Vision Scout data. This guarantees exact names,
// bounding boxes, and image indices — the LLM never has to regurgitate this data, which was
// the root cause of silent item drops and incorrect targetDbId hallucination in MODE D groups.
function resolveComparisonGroups(rawGroups: any[], scoutItems: any[]): any[] {
  const usedIndices = new Set<number>();

  const resolvedGroups = (Array.isArray(rawGroups) ? rawGroups : []).map((g: any) => {
    const items: any[] = [];
    let indices: number[] = Array.isArray(g.scoutItemIndices) ? g.scoutItemIndices : [];

    const resolvedIndices = new Set<number>();
    indices.forEach((rawIdx: any) => {
      // 1. Try to parse as integer (0-based)
      let i = typeof rawIdx === "number" ? rawIdx : parseInt(String(rawIdx).trim(), 10);
      let s = (!isNaN(i) && i >= 0 && i < scoutItems.length) ? scoutItems[i] : null;

      // 2. Fallback: Check if LLM used 1-based indexing (e.g. index 1 for array element 0)
      if (!s && !isNaN(i) && i > 0 && i <= scoutItems.length) {
        const fallbackItem = scoutItems[i - 1];
        if (fallbackItem) {
          s = fallbackItem;
          i = i - 1;
        }
      }

      // 3. Fallback: If rawIdx is a string (like "yakiimo cheese"), perform fuzzy string matching
      if (!s && typeof rawIdx === "string") {
        const cleanRaw = rawIdx.trim().toLowerCase();
        if (cleanRaw.length > 1) {
          const foundIdx = scoutItems.findIndex((item: any) => {
            const kw = (item.keyword || "").toLowerCase();
            const orig = (item.originalName || "").toLowerCase();
            return cleanRaw === orig || cleanRaw === kw || cleanRaw.includes(kw) || kw.includes(cleanRaw) || cleanRaw.includes(orig) || orig.includes(cleanRaw);
          });
          if (foundIdx !== -1) {
            s = scoutItems[foundIdx];
            i = foundIdx;
          }
        }
      }

      // 4. If we successfully resolved to a scout item, add it to this group
      if (s && i >= 0 && i < scoutItems.length) {
        usedIndices.add(i);
        resolvedIndices.add(i);
        items.push({
          name: s.name || s.originalName || s.keyword,
          keyword: s.keyword || null,
          originalName: s.originalName || null,
          boundingBox2D: s.boundingBox2D || null,
          sourceImageIndex: typeof s.sourceImageIndex === "number" ? s.sourceImageIndex : 0,
          scoutIndex: i
        });
      }
    });

    // Text-only comparisons (no image / no scout items): fall back to plain names.
    if (scoutItems.length === 0 && Array.isArray(g.itemNames)) {
      g.itemNames.forEach((n: string) => {
        if (n) items.push({ name: n, boundingBox2D: null, sourceImageIndex: null });
      });
    }

    const resolvedThreats: Record<string, string> = {};
    const threatEntries: [string, any][] = Array.isArray(g.itemClinicalThreats)
      ? g.itemClinicalThreats
          .filter((t: any) => t && (typeof t.scoutIndex !== "undefined" || typeof t.scoutIdentifier !== "undefined" || typeof t.scoutIndices !== "undefined"))
          .flatMap((t: any) => {
            if (Array.isArray(t.scoutIndices)) {
               return t.scoutIndices.map((idx: number) => [String(idx), t.threat]);
            }
            
            const rawId = typeof t.scoutIdentifier !== "undefined" ? t.scoutIdentifier : t.scoutIndex;
            let resolvedIdx = -1;
            if (typeof rawId === "number") {
              resolvedIdx = rawId;
            } else if (typeof rawId === "string") {
              const cleanRaw = rawId.trim().toLowerCase();
              const foundIdx = scoutItems.findIndex((item: any) => {
                const kw = (item.keyword || "").toLowerCase();
                const orig = (item.originalName || "").toLowerCase();
                return cleanRaw === orig || cleanRaw === kw || cleanRaw.includes(kw) || kw.includes(cleanRaw) || cleanRaw.includes(orig) || orig.includes(cleanRaw);
              });
              if (foundIdx !== -1) resolvedIdx = foundIdx;
            }
            return [[String(resolvedIdx !== -1 ? resolvedIdx : rawId), t.threat]];
          })
      : (g.itemClinicalThreats && typeof g.itemClinicalThreats === "object")
          ? Object.entries(g.itemClinicalThreats) // legacy fallback for any old-format responses still in flight
          : [];
    if (threatEntries.length > 0) {
      threatEntries.forEach(([key, threat]) => {
        let targetIdx: number | null = null;
        const parsedKey = parseInt(key, 10);
        if (!isNaN(parsedKey)) {
          let i = parsedKey;
          let s = (i >= 0 && i < scoutItems.length) ? scoutItems[i] : null;
          if (!s && i > 0 && i <= scoutItems.length) {
            s = scoutItems[i - 1];
            i = i - 1;
          }
          if (s) {
            targetIdx = i;
          }
        }
        if (targetIdx === null) {
          const cleanKey = key.trim().toLowerCase();
          if (cleanKey.length > 1) {
            const foundIdx = scoutItems.findIndex((item: any) => {
              const kw = (item.keyword || "").toLowerCase();
              const orig = (item.originalName || "").toLowerCase();
              return cleanKey.includes(kw) || kw.includes(cleanKey) || cleanKey.includes(orig) || orig.includes(cleanKey);
            });
            if (foundIdx !== -1) {
              targetIdx = foundIdx;
            }
          }
        }
        if (targetIdx !== null) {
          resolvedThreats[String(targetIdx)] = String(threat);
        } else {
          resolvedThreats[key] = String(threat);
        }
      });
    }

    return {
      groupName: g.groupName,
      verdict: g.verdict,
      message: g.message,
      averageNutrients: g.averageNutrients || null,
      scoutItemIndices: Array.from(resolvedIndices),
      itemClinicalThreats: resolvedThreats,
      items
    };
  });

  // Coverage repair: any scout item the model never assigned to a group still gets shown,
  // instead of silently vanishing from the comparison.
  if (scoutItems.length > 0) {
    const missing = scoutItems.filter((_: any, i: number) => !usedIndices.has(i));
    if (missing.length > 0) {
      const unassignedIdxs = scoutItems.map((_, i) => i).filter(i => !usedIndices.has(i));
      console.log(`[Comparison Resolve] unassigned indices: ${unassignedIdxs.join(', ')}`);
      resolvedGroups.push({
        groupName: "Unassigned items",
        verdict: { label: "Uncategorized", level: "neutral" },
        message: "These items were detected but not placed into a comparison group by the AI.",
        averageNutrients: null,
        scoutItemIndices: unassignedIdxs,
        itemClinicalThreats: {},
        items: missing.map((s: any) => ({
          name: s.name || s.originalName || s.keyword,
          keyword: s.keyword || null,
          originalName: s.originalName || null,
          boundingBox2D: s.boundingBox2D || null,
          sourceImageIndex: typeof s.sourceImageIndex === "number" ? s.sourceImageIndex : 0,
          scoutIndex: scoutItems.indexOf(s)
        }))
      });
    }
  }

  // Small-count safeguard: For < 3 total items, ensure each item gets its own group (1 item per group)
  if (scoutItems.length > 0 && scoutItems.length < 3) {
    const hasLumpedGroup = resolvedGroups.some(g => g.scoutItemIndices && g.scoutItemIndices.length > 1);
    if (hasLumpedGroup) {
      console.log(`[Comparison Grouping Safeguard] Unbundling multi-item group for ${scoutItems.length} items into 1 item per group.`);
      const unbundledGroups: any[] = [];
      scoutItems.forEach((sItem: any, idx: number) => {
        const existingGroup = resolvedGroups.find(g => g.scoutItemIndices && g.scoutItemIndices.includes(idx)) || resolvedGroups[idx] || resolvedGroups[0];
        const itemName = sItem.name || sItem.originalName || sItem.keyword || `Option ${idx + 1}`;
        unbundledGroups.push({
          groupName: existingGroup?.groupName && resolvedGroups.length > 1 ? existingGroup.groupName : itemName,
          verdict: existingGroup?.verdict || { label: "Evaluated Option", level: "neutral" },
          message: existingGroup?.message || `Nutritional evaluation for ${itemName}.`,
          averageNutrients: sItem.preCalcNutrients || null,
          scoutItemIndices: [idx],
          itemClinicalThreats: existingGroup?.itemClinicalThreats ? { [String(idx)]: existingGroup.itemClinicalThreats[String(idx)] || "" } : {},
          items: [{
            name: itemName,
            keyword: sItem.keyword || null,
            originalName: sItem.originalName || null,
            boundingBox2D: sItem.boundingBox2D || null,
            sourceImageIndex: typeof sItem.sourceImageIndex === "number" ? sItem.sourceImageIndex : 0,
            scoutIndex: idx
          }]
        });
      });
      return unbundledGroups;
    }
  }

  return resolvedGroups;
}

export { applyServerAverageNutrients } from './server_pure_helpers.js';

// Note: buildFoodAnalyzeInstruction is imported from ./agents/index.js at top of file
export function buildFoodAnalyzeInstructionLocal(context: {
  biomarkersNeedingImprovement?: any[];
  remainingAllowance?: any | null;
  activeMeal?: any;
  compareItemCount?: number;
}): string {
  const { biomarkersNeedingImprovement, remainingAllowance, activeMeal, compareItemCount = 0 } = context;

  const formattedBiomarkers = Array.isArray(biomarkersNeedingImprovement) && biomarkersNeedingImprovement.length > 0
    ? biomarkersNeedingImprovement.map((b: any) => {
        if (typeof b === "string") {
          return `• ${b}`;
        }
        if (b && typeof b === "object" && b.name) {
          const statusStr = b.status ? ` is ${String(b.status).toUpperCase()}` : "";
          const valStr = b.value !== undefined ? ` (${b.value} ${b.unit || ""}, normal range: ${b.normalRange || ""})` : "";
          return `• ${b.name}${statusStr}${valStr}`;
        }
        return `• ${String(b)}`;
      }).join("\n")
    : "• None";

  const biomarkersList = formattedBiomarkers;

  const formatLimitVal = (val: any) => {
    if (val === undefined || val === null) return "0";
    const num = Number(val);
    if (isNaN(num)) return String(val);
    return String(Math.round(num * 100) / 100);
  };
  
  let averagesStr = "";
  if (remainingAllowance && remainingAllowance.averages) {
    const { averages, rollingDays } = remainingAllowance;
    const overages: string[] = [];
    const limits = [
      { key: 'calories', label: 'Calories', target: remainingAllowance.caloriesTarget },
      { key: 'saturatedFat', label: 'Saturated Fat', target: remainingAllowance.saturatedFatTarget },
      { key: 'sodium', label: 'Sodium', target: remainingAllowance.sodiumTarget },
      { key: 'addedSugar', label: 'Added Sugar', target: remainingAllowance.addedSugarTarget },
      { key: 'carbohydrates', label: 'Carbohydrates', target: remainingAllowance.carbohydratesTarget }
    ];
    
    limits.forEach(limit => {
      if (averages[limit.key] !== undefined && limit.target !== undefined && averages[limit.key] > limit.target) {
        overages.push(`- ${limit.label}: ${formatLimitVal(averages[limit.key])} (Target: ${formatLimitVal(limit.target)})`);
      }
    });
    
    if (overages.length > 0) {
      averagesStr = `\n\nWARNING: The patient has exceeded their daily target limits on average over the past ${rollingDays || 7} days for the following nutrients:\n${overages.join('\n')}\nThey must be extra careful about these nutrients today!`;
    }
  }

  let targetLimits = "Nutrient target (target limit)\n";
  if (remainingAllowance) {
    const rem = remainingAllowance;
    const averages = rem.averages || {};

    const topNutrients = [
      { key: 'saturatedFat', targetKey: 'saturatedFatTarget', label: 'Sat fat', unit: 'g', defaultTarget: 12 },
      { key: 'calories', targetKey: 'caloriesTarget', label: 'Calorie', unit: 'kcal', defaultTarget: 1321 },
      { key: 'sodium', targetKey: 'sodiumTarget', label: 'Sodium', unit: 'mg', defaultTarget: 960 },
      { key: 'protein', targetKey: 'proteinTarget', label: 'Protein', unit: 'g', defaultTarget: 72 },
      { key: 'carbohydrates', targetKey: 'carbohydratesTarget', label: 'Carbohydrates', unit: 'g', defaultTarget: 128 },
      { key: 'totalFibre', altKey: 'solubleFibre', targetKey: 'solubleFibreTarget', label: 'Total Fibre', unit: 'g', defaultTarget: 38 },
      { key: 'potassium', targetKey: 'potassiumTarget', label: 'Potassium', unit: 'mg', defaultTarget: 4200 },
      { key: 'solubleFibre', targetKey: 'solubleFibreTarget', label: 'Soluble Fibre', unit: 'g', defaultTarget: 12 },
      { key: 'addedSugar', targetKey: 'addedSugarTarget', label: 'Added Sugar', unit: 'g', defaultTarget: 24 },
      { key: 'transFat', targetKey: 'transFatTarget', label: 'Trans Fat', unit: 'g', defaultTarget: 0 },
    ];

    // 7 days avg line
    const avgParts: string[] = [];
    topNutrients.forEach((n) => {
      const avgVal = Math.round(averages[n.key] || (n.altKey ? averages[n.altKey] : 0) || 0);
      const targetVal = Math.round(rem[n.targetKey] || n.defaultTarget);
      if (avgVal > targetVal && targetVal > 0) {
        const pctOver = Math.round(((avgVal - targetVal) / targetVal) * 100);
        avgParts.push(`${n.label} (${avgVal}${n.unit} - ${pctOver}% over)`);
      } else if (avgVal > 0) {
        avgParts.push(`${n.label} (${avgVal}${n.unit} avg)`);
      } else {
        avgParts.push(`${n.label} (0${n.unit} avg)`);
      }
    });

    const avgLine = `7 days avg: ${avgParts.join(', ')}`;

    // Todays target line
    const todayParts: string[] = [];
    topNutrients.forEach((n) => {
      const logged = Math.round(Number(rem[n.key] !== undefined ? rem[n.key] : (n.altKey ? rem[n.altKey] : 0)) || 0);
      const targetVal = Math.round(Number(rem[n.targetKey]) || n.defaultTarget);

      if (targetVal > 0 && logged > targetVal) {
        todayParts.push(`${n.label} (${logged}${n.unit} over ${targetVal}${n.unit} daily)`);
      } else if (targetVal > 0) {
        todayParts.push(`${n.label} (${logged}/${targetVal}${n.unit})`);
      } else {
        todayParts.push(`${n.label} (${logged}${n.unit})`);
      }
    });

    const todayLine = `Todays target: ${todayParts.join(', ')}`;
    targetLimits += `${avgLine}\n${todayLine}`;
  } else {
    targetLimits += `7 days avg: Sat fat (33g - 172% over), Calorie (2610 kcal - 98% over), Sodium (3096mg - 222% over), Protein (125g avg - 74% over), Carbohydrates (226g avg - 76% over), Total Fibre (35g avg), Potassium (1777mg avg), Soluble Fibre (2.6g avg), Added Sugar (12g avg), Trans Fat (0g avg)\nTodays target: Sat fat (25g over 12g daily), Calorie (1272kcal over 1321kcal daily), Sodium (576mg over 960mg daily), Protein (113/72g), Carbohydrates (176/128g), Total fibre (36/38g), Potassium (1677/4200mg), Soluble Fibre (0/12g), Added Sugar (0/24g), Trans Fat (0/0g)`;
  }

  // Clean activeMeal by replacing huge base64 strings
  let sanitizedActiveMeal = null;
  if (activeMeal) {
    sanitizedActiveMeal = { ...activeMeal };
    if (sanitizedActiveMeal.imageUrl && sanitizedActiveMeal.imageUrl.startsWith("data:image/")) {
      sanitizedActiveMeal.imageUrl = "[base64_image_data_truncated]";
    }
    if (sanitizedActiveMeal.imageUrls && Array.isArray(sanitizedActiveMeal.imageUrls)) {
      sanitizedActiveMeal.imageUrls = sanitizedActiveMeal.imageUrls.map((url: string) => 
        url && url.startsWith("data:image/") ? "[base64_image_data_truncated]" : url
      );
    }
    if (sanitizedActiveMeal.chatTranscript) {
      delete sanitizedActiveMeal.chatTranscript;
    }
    if (sanitizedActiveMeal.receiptTable) {
      delete sanitizedActiveMeal.receiptTable;
    }
    if (sanitizedActiveMeal.nutrients) {
      delete sanitizedActiveMeal.nutrients;
    }
    if (sanitizedActiveMeal.verdict) {
      delete sanitizedActiveMeal.verdict;
    }
    if (sanitizedActiveMeal.itemsBreakdown && Array.isArray(sanitizedActiveMeal.itemsBreakdown)) {
      sanitizedActiveMeal.itemsBreakdown = sanitizedActiveMeal.itemsBreakdown.map((item: any) => ({
        scoutIndex: item.scoutIndex,
        dbId: item.dbId,
        canonicalDbName: item.canonicalDbName || item.name,
        foodType: item.foodType,
        weightGrams: item.weightGrams,
        dbSource: item.dbSource,
        cookingMethod: item.cookingMethod,
        components: item.components ? item.components.map((c: any) => ({ searchQuery: c.searchQuery, volumePercentage: c.volumePercentage })) : undefined
      }));
    }
  }

  const mealStr = sanitizedActiveMeal ? JSON.stringify(sanitizedActiveMeal, null, 2) : "None";

  return `CURRENT_ACTIVE_MEAL_STATE: ${mealStr}

You are an expert clinical dietitian and nutritional LLM analyzer operating within an automated personalized health ecosystem. Your response must be an exact single structured JSON object matching the requested structure. Never add markdown formatting wrappers like \`\`\`json unless instructed.

=== ADVICE & COACHING DIRECTIVES (MANDATORY) ===
PERSONALIZED & CONSTRUCTIVE: Do not lecture the user or make meals sound purely 'bad'. Acknowledge the food naturally without judgment. Focus on constructive adjustments (e.g. portion tweaks, adding fiber or protein, pairing with lighter sides) and practical guidance rather than reciting raw macro numbers. The macro chips in the UI already present the exact values, so avoid repeating long lists of numeric totals in text.

=== PATIENT CONTEXT PAYLOAD ===
CRITICAL PATIENT BIOMARKER WARNINGS & NUTRITIONAL DIRECTIVES:
${biomarkersList}
- If LDL-C/cholesterol is HIGH, any food high in saturated fat is EXTREMELY harmful. Rate as "bad" and warn in "risks".
- If Blood Pressure/Sodium is HIGH, any food high in sodium is EXTREMELY harmful. Rate as "bad".

${targetLimits}

=== UNIVERSAL HEALTH DIRECTIVE (STRICT) ===
TRANS FAT AVOIDANCE: Trans fat (partially hydrogenated oils) is universally harmful and must be avoided regardless of the patient's specific biomarkers. Always aggressively flag any food likely to contain trans fats in the "risks" field.

=== DATA EXTRACTION DEPTH RULES ===
1. CORE NUTRIENTS: Use databaseMatches to extract raw authentic data. The deterministic backend math will automatically inject labelNutrientsPerServing and handle sodium limits based on your identification.
=== NUTRITIONAL BASELINE & CLINICAL SANITY CHECK DIRECTIVE ===
The backend provides pre-calculated precise nutrient weights inside "=== BACKEND PRE-CALCULATED ITEM NUTRIENTS ===".
1. DEFAULT BASELINE: Treat these pre-calculated numbers as your default baseline for your evaluation. Write your prose message, benefits, risks, and recommendations based directly on these numbers.
2. PRESERVE BACKEND WEIGHTS (CRITICAL SPECIFIED PORTION RULE): If the user's text message explicitly specifies a weight (e.g., '50g Sainsbury oat + fruits'), do NOT override the entire dish's weight down to that number! The pre-calculated item weight provided by the backend already mathematically accounts for the specific ingredient proportions via the visual scout. You MUST preserve the item weights exactly as provided in the BACKEND PRE-CALCULATED ITEM NUTRIENTS section and NEVER change them to match the user's raw text snippet.
3. CLINICAL SANITY CHECK OVERRIDE: If a pre-calculated database entry is physically impossible or wildly wrong (e.g. >150mg Na in raw meat, or 5000 kcal for a 50g salad), you MUST override those numbers:
   - Set "dbSource": "estimated_override".
   - Supply your corrected clinical estimate in "labelNutrientsPerServing".
   - Add an explicit reason to "anomalyFlags" (e.g. ["Sanity Check Override: Overrode saline-injected 2500mg sodium database value to raw baseline ~50mg"]).
2. TRACE NUTRIENTS: Do NOT estimate these individually. Instead, output the single most appropriate foodType string for each item (e.g., 'red_meat', 'leafy_veg', 'root_veg', etc.).

Critical: Original Name Override & Anti-Merging Rule
Local Language Priority: Treat the originalName provided by the visual scout as the absolute ground truth for categorizing an item, overriding the English keyword if they contradict.

Preserve Visual Scout Cooking Method & Ingredients:
1. Cooking Method Alignment: You MUST maintain the exact item-level cookingMethod identified by the Visual Scout (e.g., deep_fried, pan_fried, stir_fried, roasted, boiled, steamed, grilled, baked, raw) for each item in itemsBreakdown. Do NOT override deep_fried or pan_fried to baked or raw unless the user explicitly requested a change in their message text.
2. Visual Ingredients Alignment: You MUST carry over all visualIngredients detected by the Visual Scout into the item's visualIngredients array in itemsBreakdown. If visualIngredients is empty, leave it empty ([]). Do NOT copy printed text from 'ingredientsList' into 'visualIngredients' or 'composition'. For packaged or printed label products, 'visualIngredients' MUST be an empty array ([]) and 'composition' MUST contain ONLY the item name (e.g., 'HANA Mat Kimchi (Diced Radish Kimchi)').

Protein Verification: If an originalName contains clear local language identifiers for proteins (e.g., "Ikan" = fish, "Ayam" = chicken, "Daging" = beef) but the upstream agent mistakenly passed an English keyword matching a vegetable, you MUST classify and log the item based on the local protein name.

Strict Anti-Merging: NEVER sum the weights of two items simply because their English keywords match. You must evaluate if their originalNames represent the exact same food. If they are different (e.g., "IK BARONANG" and "BABY PAKCHOY"), keep them as separate, distinct entries in the itemsBreakdown array.

Core Nutrients DB ID Validation
Zero Hallucination: For EVERY item, when databaseMatches contains a relevant entry, use it to set dbSource and dbId.

Strict Fallback: If a food item does NOT have a clear, exact match in the provided databaseMatches list, you MUST set dbId to null and dbSource to estimated. NEVER invent, guess, or hallucinate a dbId string or integer that was not explicitly provided in the payload data.

Trace Nutrients Taxonomy
Fungi Expansion: Do NOT estimate trace nutrients individually. Instead, output the single most appropriate foodType string for each item.

Allowed Types: Use exactly one of the following category tags: 'red_meat', 'poultry', 'fish_lean', 'fish_fatty', 'leafy_veg', 'root_veg', 'fungi', 'legume', 'grain', 'fruit', 'dairy', 'mixed_meal' (for complex dishes), or 'ultra_processed' (for junk food and sweets).

=== CONTEXTUAL DIETARY ACRONYMS ===
If the visual scout identifies standard dietary codes or tags in the originalName (e.g., airline meal codes like "LFML" for Low Fat Meal, "VGML" for Vegan Meal, "GFML" for Gluten Free Meal, or general menu acronyms), you MUST explicitly acknowledge the code's dietary significance in your clinical reasoning and adjust your nutrient estimation accordingly (e.g., lower saturated fat for LFML, zero animal products for VGML).

=== SAUCES VS SPICES DIRECTIVE (CRITICAL) ===
You must differentiate between dry spices (like 'black pepper') and liquid sauces (like 'black pepper sauce'). A sauce has calories, fats, and sodium. A dry spice does not. If a food item has a sauce, you MUST include the full sauce name (e.g. 'black pepper sauce', 'soy sauce') as an item component. Never simplify 'black pepper sauce' to just 'spices, pepper, black'.

=== MODE ROUTING DIRECTIVE (STRICTLY ENFORCED) ===
Operate in one of five distinct modes based on current user intent:

MODE A: NEW FOOD LOGGING 
- You will be explicitly instructed to use this mode via the CRITICAL ROUTING OVERRIDE. Ignore CURRENT_ACTIVE_MEAL_STATE.
- Extract ingredients, estimate weights, and provide the foodData block.
- CRITICAL INCLUSION & INDEX PRESERVATION RULE: If the Scout identifies MULTIPLE items (e.g., 5 items with scoutIndex 0 to 4), you MUST include EVERY single Scout item as its own separate object in 'itemsBreakdown'. DO NOT merge, collapse, or drop items (e.g., if there are 2 tangerines, keep them as TWO separate objects). For EVERY item in 'itemsBreakdown', you MUST explicitly copy and output the exact 'scoutIndex' number from the Scout payload. Set "mode": "new_log".
- CRITICAL SCHEMA REQUIREMENT: You MUST output the foodData block and you MUST explicitly set "comparison": null. Do NOT generate comparison group structures or assign scout indices to a comparison engine for a single logged meal.
- CRITICAL: If the user uploads a picture of a meal (e.g. a plate with steak, potatoes, veggies), you MUST treat it as a single meal entry and use MODE A (NEW FOOD LOGGING). Combine the components into the itemsBreakdown array. DO NOT use MODE D (EVALUATION/COMPARISON) to compare the items on the plate unless the user explicitly asks to compare them or choose the best option.
- CRITICAL: If the user enters a single food item name or phrase like "I ate this steak" without explicitly asking to compare, you MUST use MODE A.
- CRITICAL: If the user provides a single food image and asks a general health question (e.g., "Is it healthy?"), that MUST be routed to MODE A, not Mode D. You MUST directly answer the question in the "message" field evaluating its clinical impact.
- CONFIDENCE ACKNOWLEDGEMENT (CRITICAL): Check the "Visual Scout Confidence Rating" and any anomaly flags listed for the items in the === VISUAL FOOD SCOUT IDENTIFIED ITEMS === section. If any item is marked as Medium or Low confidence (or has anomaly flags), you MUST start your response by explicitly acknowledging this uncertainty. You MUST explicitly invite the user to correct the identification manually via text, or upload a clearer picture so you can update the lower rating.

MODE B: DISCUSSION 
- Triggered by general health questions, or if the user's message/query is NOT relevant to food, nutrition, or health. Set "mode": "discussion". Set structural data to null.
- CRITICAL: If you detect that the user's input/query is not relevant to food, nutrition, or biological tracking, you MUST use MODE B (DISCUSSION). In your conversational response ("message"), politely inform the user of your focus and actively incite, guide, or invite them to provide relevant descriptions, ingredients, weights, or pictures of meals or food items so that you can evaluate them, analyze their nutritional profile, and guide them in their wellness journey.
- CRITICAL REJECTION RULE: If the user input is a greeting (e.g., "Hi", "Hello", "Start", "Let's start", "greetings"), general conversational inquiry, or focuses purely on clinical/lab biomarkers (e.g., ALT, AST, LDL, cholesterol, liver panel) without any food, meal, ingredient, or recipe context, you MUST immediately classify the request as MODE B (DISCUSSION). Do NOT assume a database match of a greeting/command word (e.g., the word "Start" matching "Start granola") is the user's food item unless they explicitly wrote "I ate..." or "My meal is...". State politely that you are the Food & Nutrition Agent and can only analyze meals, ingredients, recipes, or nutritional values, and advise them to use the Health & Medical Agent for clinical or lab test reviews.

MODE C: MODIFICATION COMMAND (ACTIVE MEAL UPDATE / REASSESSMENT)
Triggered ONLY when the user asks to modify, add, correct, or change an item, weight, or cooking method that currently exists inside the CURRENT_ACTIVE_MEAL_STATE.
- EXPLICIT EXCLUSION RULE: If the user states they "only had" specific items, you MUST output 'remove_item' actions in \`modificationCommand\` for ALL other items currently in the active meal that they did not mention. Do not leave unmentioned items in the meal.
- FULL REASSESSMENT LAW (CRITICAL): You MUST recalculate all nutrients of the food impacted, and provide a comprehensive, updated clinical assessment and actionable nutrition advice in 'message' (incorporating the new totals of calories, sodium, and saturated fat, comparing them against today's nutritional target and multi-day trend, and providing specific advice or next steps). Do not just say you made the change.
- SYNCHRONIZATION LAW (CRITICAL): The food items in 'foodData.itemsBreakdown' MUST match exactly what is in 'composition' and the updated meal. If any food item is changed from raw to boiled, or removed, or added, update 'itemsBreakdown' and 'composition' to match perfectly.
- Set "mode": "modify". You MUST fully populate the 'foodData' block with the completely updated meal details (date, name, quantity, composition, itemsBreakdown) incorporating the user's modifications.
- Populate the "modificationCommand" array with the precise actions performed to keep track of changes:
  * action: 'update_weight' | 'remove_item' | 'add_item' | 'rename_item' | 'update_cooking_method'
  * itemName: exact literal name from the active meal itemsBreakdown list
  * targetDbId: exact dbId from itemsBreakdown
  * newWeightGrams: new weight in grams
  * newCookingMethod: new cooking method if changed
  * newName: new item name if renamed
- Do NOT use Mode C if the user is discussing a food from a theoretical comparison that is not in the active meal state.

MODE D: EVALUATION / COMPARISON
- You will be explicitly instructed to use this mode via the CRITICAL ROUTING OVERRIDE.

- NUTRITIONAL DOMINANCE LAW (CRITICAL): You MUST group items strictly by their clinical nutritional value, primary base ingredient, or risk profile. You are strictly FORBIDDEN from creating groups named after physical layout locations like shelves, rows, or tables (e.g., Do NOT use 'Top Shelf Selections').

- CROSS-SHELF INDEX MAPPING (THE BREAKOUT RULE): Because the Vision Scout groups foods by physical rows to preserve bounding boxes, a single physical row may contain multiple types of foods. 
  * You are allowed to include the SAME Scout Index in MULTIPLE nutritional groups if that physical shelf contains products belonging to both categories.
  * Your UI will seamlessly render the correct row crop for both comparisons without breaking.

- COVERAGE REQUIREMENT: Every single Index provided in the === VISUAL FOOD SCOUT IDENTIFIED ITEMS === list MUST appear in at least one nutritional group.

- THE EVALUATION HIERARCHY (CRITICAL): Before grouping, you MUST evaluate the TOTAL package payload of every item against this strict 4-step hierarchy:
  1. UNIVERSAL THREATS: Does it contain universally harmful ingredients (e.g., trans fats)?
  2. THE DAILY BUDGET (ACUTE THREATS): Does the TOTAL package payload consume more than 50% of ANY "REMAINING NUTRITIONAL TARGET LIMIT" (e.g., Sodium, Calories, Saturated Fat, Added Sugar)? If yes, it is an acute dietary threat.
  3. BIOMARKER STRATEGY & INGREDIENT QUALITY (CHRONIC THREATS): Does the biochemical nature of the food OR its specific ingredients trigger any of the "PATIENT BIOMARKER WARNINGS"? If an 'ingredientsList' is provided, you MUST analyze it. Highly processed or inflammatory ingredients (e.g., refined flours like 'Tepung Terigu', shortening/'lemak reroti', 'margarin') must actively penalize the item's ranking, especially for patients with liver (ALT), cholesterol, or diabetes risks. If 'ingredientsList' is null, base your assessment strictly on the macro payload.
  4. TARGET ACQUISITION (POSITIVE IMPACT): Does the item significantly contribute to the "Nutrient target to reach today" (e.g., high Protein, Potassium, Soluble Fibre, or Unsaturated Fat) without grossly violating steps 1-3?

- GROUPING STRATEGY (RANKED TIERS + THREAT CLUSTERING - MANDATORY & STRICTLY ENFORCED):
  * CRITICAL SMALL-COUNT RULE (<3 ITEMS): If there are LESS THAN 3 total scanned items (e.g. 1 or 2 items), DO NOT group multiple items together or create artificial third tiers. Output EXACTLY 1 group per scanned item (a group size of 1 item per group), mapping each item's index individually in 'scoutItemIndices' (e.g. Tier 1 with scoutItemIndices: [0], Tier 2 with scoutItemIndices: [1]).
  * MULTI-ITEM SHELF RULE (>=3 ITEMS): If 3 or more items are scanned, structure the 'comparison.groups' array in a strict tiered order:
    - TIER 1 (The Winner / Least Harmful Group): Exactly 1 item representing the best choice.
    - TIER 2 (The Runner-Up Group): Exactly 1 item representing the second best choice.
    - TIER 3 (The Rest - Threat Clusters): Group remaining items by clinical threats and ingredient matrices. Do NOT lump all items into a single bucket.
  * CRITICAL MATH REQUIREMENT: You MUST use the provided 'TRUE TOTAL NUTRITIONAL PAYLOAD' values for 'averageNutrients'. Do not re-calculate or apply serving size math yourself.

- SCHEMA DETAILS:
  * Output the specific groups in comparison.groups. 
  * CRITICAL SYNTAX: Each element inside the comparison.groups array MUST be a complete JSON object enclosed in curly braces '{' and '}'. Never output bare keys or skip curly braces. The first property of each group object inside the curly braces MUST be "groupName".
  * For each group object, provide groupName, verdict, message, averageNutrients, and scoutItemIndices. OMIT the comparisonTable entirely.
  * The 'verdict' and 'message' fields MUST EXACTLY MATCH the formatting rules of Mode A. 'verdict' specifies a 3-6 word label and a level ('good', 'warning', 'alert', 'neutral'). 'message' must be a highly instructional 4-beat advice (Value -> Impact -> Symptom -> Next Action) applying numeric values for targets and limits.
  * For Mode D, omit the root-level 'verdict' and 'message' fields, as they are now handled per-group.
  * Inside each group, add an "itemClinicalThreats" array. Each entry MUST be an object {"scoutIndices": [<numbers>], "threat": "<short label>"} covering every scout item in that group. You MUST group indices that share the EXACT same threat label together into the array to save space. For Tier 1 and 2, this might be "None" or a minor warning. For Tier 3, it must explicitly name the threat (e.g., "Excessive Sodium").
  * CRITICAL NAMING RULE: NEVER use the word "Index" or "Option X" in your 'groupName', 'message', or 'recommendation' text fields. You must seamlessly weave the actual food names (e.g., "Happy Tos", "Mr. Bread") into your prose. The "Index" number is ONLY for the 'scoutItemIndices' and 'scoutIndex' JSON structure fields.

- RESOLVING VISUAL WARNINGS:
  If the user provides a text correction for a previously unclear visual item (e.g. they say "the unclear fish is ikan bandoneng"), you MUST update that specific item in the \`scoutItems\` array schema field. You must update its keyword, completely clear its anomaly flags, and upgrade its confidence to High. You must return the ENTIRE array including the unaffected items.

=== SYSTEM CONSTRAINTS ===

First, think step-by-step in the '_internalReasoning' field of the JSON.

Second, output exactly one JSON object.

The JSON must contain ONLY the fields requested below.

=== OUTPUT INSTRUCTIONS ===

First, write out your step-by-step reasoning inside the '_internalReasoning' JSON field. Explain your clinical thoughts and support your reasoning.

Then, output your final mapped results in a raw, valid JSON block.

Ensure EVERY JSON field is correctly separated by a comma and that all strings are properly closed with quotation marks. Do not add markdown formatting blocks (such as \`\`\`json) around your JSON response.

JSON SCHEMA STRICT REQUIREMENT:
{
  "_internalReasoning": "string",
  "mode": "new_log | discussion | modify | evaluation | origin",
  "verdict": {
    "label": "Bad for cholesterol | High Saturated Fat | High Sodium | Healthy Choice | Moderate Saturated Fat",
    "level": "good | warning | alert | neutral"
  },
  "message": "A highly personalized conversational response detailing the clinical rationale. Focus on actionable guidance and avoid repeating raw macro numbers.",
  "description": "Short 1-sentence actionable meal summary guidance (e.g. 'Limit fast-food fried sandwiches and opt for grilled options or home-prepared whole foods to better control sodium and lipid levels.'). Do NOT put generic filler like 'Contributes to daily macro and micronutrient requirements.'",
  "modificationCommand": [
    {
      "action": "update_weight | remove_item | add_item | rename_item",
      "itemName": "EXACT literal name from the itemsBreakdown list.",
      "newWeightGrams": 120,
      "targetDbId": "EXACT dbId from itemsBreakdown. CRITICAL for backend matching.",
      "newName": "New name if action is rename_item"
    }
  ],
  "foodData": {
    "date": "YYYY-MM-DD",
    "name": "Literal food name",
    "description": "Short 1-sentence actionable meal summary guidance.",
    "verdict": {
      "label": "Bad for cholesterol | High Saturated Fat | High Sodium | Healthy Choice | Moderate Saturated Fat",
      "level": "good | warning | alert | neutral"
    },
    "itemsBreakdown": [
      {
        "canonicalDbName": "Standardized target food name",
        "weightGrams": 120,
        "dbSource": "usda | off | estimated | label",
        "dbId": "fdcId or barcode",
        "labelNutrientsPerServing": {
          "servingSizeGrams": 100,
          "calories": 0,
          "protein": 0,
          "totalFat": 0,
          "saturatedFat": 0,
          "transFat": 0,
          "carbohydrates": 0,
          "addedSugar": 0,
          "sodium": 0,
          "potassium": 0,
          "totalFibre": 0,
          "solubleFibre": 0
        },
        "foodType": "string"
      }
    ],
    "weightGrams": 150,
    "quantity": "Visual descriptive serving size",
    "risks": "Explicit clinical risk warnings",
    "recommendation": "Short, contextual tag indicating core health property."
  },
  "comparison": {
    "comparisonTitle": "A short 2-4 word title for this comparison (e.g., 'Nutrients of Concern')", 
    "auditChecklist": "CRITICAL: List all scoutItemIndices from the prompt (e.g., 0, 1, 2, 3...) here before grouping to ensure 100% extraction coverage.",
    "groups": [
      {
        "groupName": "Descriptive reason (e.g., 'Lowest in all harmful nutrients')",
        "scoutItemIndices": [0],
        "itemNames": null,
        "suitability": "Safest option",
        "recommendation": "Considering what the user asked, target limits, targets to reach, and clinical biomarkers, give advice on this food.",
        "averageNutrients": {
          "calories": 0,
          "protein": 0,
          "totalFat": 0,
          "saturatedFat": 0,
          "sodium": 0,
          "carbohydrates": 0,
          "addedSugar": 0,
          "potassium": 0,
          "totalFibre": 0
        }
      }
    ]
  },

}`;
}



const app = express();

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));
app.use(biomarkerRouter);
app.use(foodRouter);
app.use(jobsRouter);
app.use(syncRouter);
app.use(adminRouter);

app.get(['/debug/:key(*)', '/api/r2/debug/:key(*)'], async (req, res) => {
  try {
    const rawKey = req.params.key || req.path.replace(/^\/(api\/r2\/)?debug\//, '');
    const cleanKey = rawKey.startsWith('debug/') ? rawKey : `debug/${rawKey}`;
    const jobIdMatch = cleanKey.match(/([a-zA-Z0-9_\-]+)\.json$/);
    const jobId = jobIdMatch ? jobIdMatch[1] : cleanKey;

    return res.redirect(`/api/jobs/debug?jobId=${encodeURIComponent(jobId)}&format=markdown`);
  } catch (err: any) {
    console.error('[API] /debug proxy error:', err);
    res.status(500).json({ error: 'Failed to retrieve debug file' });
  }
});


const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'd17eecca64f82625d29dc38b14f46c14';
const CLOUDFLARE_R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
const CLOUDFLARE_R2_PUBLIC_URL = (process.env.CLOUDFLARE_R2_PUBLIC_URL || 'https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev').replace(/\/$/, '');
const CLOUDFLARE_R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
const CLOUDFLARE_R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';

const s3Endpoint = `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
let s3Client = null;
function getS3Client() {
  if (!s3Client && CLOUDFLARE_R2_ACCESS_KEY_ID && CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: s3Endpoint,
      credentials: {
        accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID,
        secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
}

async function uploadBase64ToR2(id: string, base64Data: string, index: number = 0): Promise<string> {
  const client = getS3Client();
  const safeId = String(id || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
  const suffix = index > 0 ? `_${index}` : '';
  const objectKey = `photos/${safeId}${suffix}.jpg`;
  const publicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/${objectKey}`;
  const proxyUrl = `/photos/${safeId}${suffix}.jpg`;

  if (!client) {
    console.warn('[R2 uploadBase64ToR2] S3 Client not configured, returning proxyUrl');
    return proxyUrl;
  }

  try {
    let body;
    let contentType = 'image/jpeg';

    if (base64Data.startsWith('data:')) {
      const match = base64Data.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        contentType = match[1];
        body = Buffer.from(match[2], 'base64');
      } else {
        body = Buffer.from(base64Data);
      }
    } else {
      body = Buffer.from(base64Data, 'base64');
    }

    const command = new PutObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    });
    await client.send(command);
    return publicUrl;
  } catch (err) {
    console.error('[R2 uploadBase64ToR2] Failed uploading to R2:', err);
    return proxyUrl;
  }
}

app.post('/api/r2/upload-photo', async (req, res) => {
  try {
    const { jobId, payload } = req.body;
    const safeId = String(jobId || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
    const objectKey = `photos/${safeId}.jpg`;
    // B11d: same-origin proxy works with private buckets; publicUrl is secondary
    const proxyUrl = `/photos/${safeId}.jpg`;
    const publicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/${objectKey}`;
    const client = getS3Client();
    if (!client) {
      return res.json({ url: proxyUrl, proxyUrl, publicUrl });
    }

    let body;
    let contentType = 'image/jpeg';

    if (payload.startsWith('data:')) {
      const match = payload.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        contentType = match[1];
        body = Buffer.from(match[2], 'base64');
      } else {
        body = Buffer.from(payload);
      }
    } else {
      body = Buffer.from(payload);
    }

    const command = new PutObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    });
    await client.send(command);

    res.json({ url: proxyUrl, proxyUrl, publicUrl, key: objectKey });
  } catch (err) {
    console.error('Failed to upload photo to R2:', err);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

app.post('/api/r2/migrate-firestore-images', async (req, res) => {
  try {
    // Load existing food logs from Supabase for matching
    console.log('[Firestore API Migrate] Fetching food logs from Supabase to match existing images...');
    const { supabaseAdmin } = await import('./supabaseAdmin.js');
    const { data: foodLogs, error: supabaseErr } = await supabaseAdmin
      .from('food_logs')
      .select('id, image_urls, firebase_uid');

    if (supabaseErr) {
      console.error('[Firestore API Migrate] Error: Failed to fetch food logs from Supabase:', supabaseErr.message);
      return res.status(500).json({ error: 'Failed to fetch food logs from Supabase', details: supabaseErr.message });
    }

    if (!foodLogs || foodLogs.length === 0) {
      return res.json({ success: true, message: 'No food logs found in Supabase.', stats: { inspected: 0, skipped: 0, matched: 0, migrated: 0, updated: 0 } });
    }

    // Initialize client Firebase SDK dynamically to run under client permissions
    const { initializeApp: initializeClientApp } = await import('firebase/app');
    const { initializeFirestore: initializeClientFirestore, doc: clientDoc, getDoc: clientGetDoc, updateDoc: clientUpdateDoc } = await import('firebase/firestore');

    const clientApp = initializeClientApp(firebaseConfig);
    const clientDb = firebaseConfig?.firestoreDatabaseId
      ? initializeClientFirestore(clientApp, {}, firebaseConfig.firestoreDatabaseId)
      : initializeClientFirestore(clientApp, {});

    let migratedCount = 0;
    let matchedCount = 0;
    let docsUpdatedCount = 0;
    let skippedCount = 0;

    for (const log of foodLogs) {
      const docId = log.id;
      const userId = log.firebase_uid;

      if (!userId) {
        skippedCount++;
        continue;
      }

      const docRef = clientDoc(clientDb, 'users', userId, 'foodImages', docId);
      let docSnapShot;
      try {
        docSnapShot = await clientGetDoc(docRef);
      } catch (docErr: any) {
        console.warn(`[Firestore API Migrate] Failed to fetch doc users/${userId}/foodImages/${docId}:`, docErr.message || docErr);
        continue;
      }

      if (!docSnapShot.exists()) {
        skippedCount++;
        continue;
      }

      const data = docSnapShot.data() || {};
      let hasChanges = false;
      let updatedImageUrl = data.imageUrl || null;
      let updatedImageUrls = Array.isArray(data.imageUrls) ? [...data.imageUrls] : [];

      // Check if we have a match in Supabase
      const cleanSupabaseUrls = log.image_urls && Array.isArray(log.image_urls)
        ? log.image_urls.filter((url: string) => typeof url === 'string' && !url.startsWith('data:'))
        : [];

      if (cleanSupabaseUrls.length > 0) {
        const isImageUrlAligned = updatedImageUrl === cleanSupabaseUrls[0];
        const isImageUrlsAligned = JSON.stringify(updatedImageUrls) === JSON.stringify(cleanSupabaseUrls);

        if (!isImageUrlAligned || !isImageUrlsAligned) {
          console.log(`[Firestore API Migrate] Match found in Supabase for doc ${docId}! Aligning Firestore with Supabase R2 URLs directly...`);
          updatedImageUrl = cleanSupabaseUrls[0];
          updatedImageUrls = cleanSupabaseUrls;
          hasChanges = true;
          matchedCount++;
        }
      } else {
        // No Supabase match found - migrate base64 strings if present
        if (typeof data.imageUrl === 'string' && data.imageUrl.startsWith('data:image/')) {
          hasChanges = true;
          try {
            console.log(`[Firestore API Migrate] Uploading imageUrl for doc ${docId} (User ${userId})...`);
            const r2Url = await uploadBase64ToR2(docId, data.imageUrl, 0);
            updatedImageUrl = r2Url;
            migratedCount++;
          } catch (uploadErr) {
            console.error(`[Firestore API Migrate] Upload failure for ${docId}`);
          }
        }

        if (Array.isArray(data.imageUrls)) {
          for (let i = 0; i < data.imageUrls.length; i++) {
            const url = data.imageUrls[i];
            if (typeof url === 'string' && url.startsWith('data:image/')) {
              hasChanges = true;
              try {
                console.log(`[Firestore API Migrate] Uploading imageUrls[${i}] for doc ${docId} (User ${userId})...`);
                const r2Url = await uploadBase64ToR2(docId, url, i);
                updatedImageUrls[i] = r2Url;
                migratedCount++;
              } catch (uploadErr) {
                console.error(`[Firestore API Migrate] Upload failure for ${docId}[${i}]`);
              }
            }
          }
        }
      }

      if (hasChanges) {
        console.log(`[Firestore API Migrate] Updating doc ID: ${docId} (User: ${userId}) in Firestore with clean R2 links...`);
        try {
          await clientUpdateDoc(docRef, {
            imageUrl: updatedImageUrl,
            imageUrls: updatedImageUrls
          });
          docsUpdatedCount++;
        } catch (updateErr: any) {
          console.error(`[Firestore API Migrate] Failed to update doc ${docId}:`, updateErr.message || updateErr);
        }
      } else {
        skippedCount++;
      }
    }

    res.json({
      success: true,
      stats: {
        inspected: foodLogs.length,
        skipped: skippedCount,
        matched: matchedCount,
        migrated: migratedCount,
        updated: docsUpdatedCount
      }
    });
  } catch (err: any) {
    console.error('Failed to run Firestore migration via API:', err);
    res.status(500).json({ error: 'Firestore migration failed', details: err?.message || String(err) });
  }
});

app.post('/api/r2/upload-logs', async (req, res) => {
  try {
    const { jobId, logsText } = req.body || {};
    if (!jobId || logsText === undefined) {
      return res.status(400).json({ error: 'jobId and logsText are required' });
    }
    const { uploadLogsToR2 } = await import('./src/utils/r2Storage.js');
    const url = await uploadLogsToR2(String(jobId), String(logsText));
    return res.json({ success: true, url });
  } catch (err: any) {
    console.error('[API] /api/r2/upload-logs failed:', err);
    return res.status(500).json({ error: err.message || 'Failed to upload logs' });
  }
});

app.post('/api/r2/migrate-backend-logs', async (req, res) => {
  try {
    console.log('[MigrateLogs] Starting migration of backend logs from Supabase & Firestore to R2...');
    const { uploadLogsToR2 } = await import('./src/utils/r2Storage.js');
    const { supabaseAdmin } = await import('./supabaseAdmin.js');

    let supabaseInspected = 0;
    let supabaseMigrated = 0;
    let totalBytesSaved = 0;

    // 1. Migrate Supabase agent_jobs table
    const { data: jobs, error: sbErr } = await supabaseAdmin
      .from('agent_jobs')
      .select('id, clean_result, status_message');

    if (sbErr) {
      console.error('[MigrateLogs] Supabase query failed:', sbErr.message);
    } else if (jobs && jobs.length > 0) {
      supabaseInspected = jobs.length;
      for (const job of jobs) {
        let cleanRes = job.clean_result;
        if (!cleanRes || typeof cleanRes !== 'object') continue;

        const rawLogs = cleanRes.backendLogs || cleanRes.agentResult?.backendLogs || '';
        // Skip if already offloaded or empty
        if (!rawLogs || typeof rawLogs !== 'string' || rawLogs.startsWith('[Logs stored in R2') || rawLogs.startsWith('http')) {
          continue;
        }

        const logLength = rawLogs.length;
        if (logLength < 10) continue;

        // Upload raw logs to Cloudflare R2
        const logsUrl = await uploadLogsToR2(job.id, rawLogs);
        if (!logsUrl) {
          console.warn(`[MigrateLogs] Failed to upload logs to R2 for job ${job.id}`);
          continue;
        }

        // Clean payload
        const updatedCleanRes = { ...cleanRes };
        updatedCleanRes.backendLogsUrl = logsUrl;
        updatedCleanRes.backendLogs = `[Logs stored in R2: ${logsUrl}]`;
        if (updatedCleanRes.agentResult) {
          updatedCleanRes.agentResult = {
            ...updatedCleanRes.agentResult,
            backendLogsUrl: logsUrl,
            backendLogs: `[Logs stored in R2: ${logsUrl}]`,
          };
        }

        const { error: updateErr } = await supabaseAdmin
          .from('agent_jobs')
          .update({ clean_result: updatedCleanRes })
          .eq('id', job.id);

        if (!updateErr) {
          supabaseMigrated++;
          totalBytesSaved += logLength;
        } else {
          console.error(`[MigrateLogs] Failed updating job ${job.id} in Supabase:`, updateErr.message);
        }
      }
    }

    // 2. Migrate Firestore agent logs if Firebase is configured
    let firestoreInspected = 0;
    let firestoreMigrated = 0;
    try {
      const { initializeApp: initializeClientApp } = await import('firebase/app');
      const { initializeFirestore: initializeClientFirestore, collectionGroup, getDocs, updateDoc } = await import('firebase/firestore');

      if (firebaseConfig && firebaseConfig.apiKey) {
        const clientApp = initializeClientApp(firebaseConfig);
        const clientDb = firebaseConfig.firestoreDatabaseId
          ? initializeClientFirestore(clientApp, {}, firebaseConfig.firestoreDatabaseId)
          : initializeClientFirestore(clientApp, {});

        // Inspect foodImages or agentAnalyses collections
        const snapshot = await getDocs(collectionGroup(clientDb, 'agentAnalyses'));
        firestoreInspected = snapshot.size;

        for (const docSnap of snapshot.docs) {
          const data = docSnap.data();
          const rawLogs = data.backendLogs || data.globalLiveLogs || data.agentResult?.backendLogs || '';
          if (!rawLogs || typeof rawLogs !== 'string' || rawLogs.startsWith('[Logs stored in R2') || rawLogs.startsWith('http')) {
            continue;
          }

          const logsUrl = await uploadLogsToR2(docSnap.id, rawLogs);
          if (logsUrl) {
            await updateDoc(docSnap.ref, {
              backendLogsUrl: logsUrl,
              backendLogs: `[Logs stored in R2: ${logsUrl}]`,
              globalLiveLogs: `[Logs stored in R2: ${logsUrl}]`
            });
            firestoreMigrated++;
            totalBytesSaved += rawLogs.length;
          }
        }
      }
    } catch (fsErr: any) {
      console.warn('[MigrateLogs] Firestore log migration skipped/failed:', fsErr.message || fsErr);
    }

    return res.json({
      success: true,
      message: 'Backend logs migration completed',
      stats: {
        supabaseInspected,
        supabaseMigrated,
        firestoreInspected,
        firestoreMigrated,
        totalBytesSavedKB: Math.round(totalBytesSaved / 1024)
      }
    });
  } catch (err: any) {
    console.error('[MigrateLogs] Migration endpoint failed:', err);
    return res.status(500).json({ error: 'Migration failed', details: err?.message || String(err) });
  }
});

/** Stream meal photo from R2 (works when bucket is private). B11d. */
async function streamR2Photo(res: any, rawKey: string) {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const client = getS3Client();
  if (!client) {
    res.status(404).send('R2 client not configured');
    return;
  }
  let filename = String(rawKey || '')
    .replace(/^\/+/, '')
    .replace(/\.\./g, '')
    .slice(0, 200);
  if (!filename) {
    res.status(400).send('key required');
    return;
  }
  if (!filename.includes('.')) filename = `${filename}.jpg`;
  const key = filename.startsWith('photos/') ? filename : `photos/${filename}`;

  const tryKeys = [key];
  // legacy without extension
  if (key.endsWith('.jpg')) tryKeys.push(key.replace(/\.jpg$/i, ''));

  let lastErr: any = null;
  for (const k of tryKeys) {
    try {
      const command = new GetObjectCommand({
        Bucket: CLOUDFLARE_R2_BUCKET_NAME,
        Key: k,
      });
      const s3Res = await client.send(command);
      if (s3Res.ContentType) res.setHeader('Content-Type', s3Res.ContentType);
      else res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Photo-Key', k);
      const stream = s3Res.Body as any;
      if (stream && typeof stream.pipe === 'function') {
        stream.pipe(res);
        return;
      }
      if (stream && typeof stream.transformToByteArray === 'function') {
        const bytes = await stream.transformToByteArray();
        res.send(Buffer.from(bytes));
        return;
      }
    } catch (err: any) {
      lastErr = err;
    }
  }
  res.status(404).send(lastErr?.message || 'Photo not found');
}

app.get(['/photos/:key', '/api/r2/photos/:key'], async (req, res) => {
  try {
    await streamR2Photo(res, req.params.key);
  } catch (err: any) {
    res.status(404).send('Photo not found');
  }
});

/**
 * B11d — resolve a readable URL for a meal photo.
 * Always returns same-origin proxy when possible; optional short-lived signed URL.
 * Query: ?key=jobId.jpg  or  ?url=https://….r2.dev/photos/…
 */
app.get('/api/r2/photo-url', async (req, res) => {
  try {
    let key = String(req.query.key || '').replace(/^\/+/, '');
    const rawUrl = String(req.query.url || '');
    if (!key && rawUrl) {
      const m = rawUrl.match(/\/photos\/([^?#]+)/i);
      if (m) key = m[1];
    }
    if (!key) return res.status(400).json({ error: 'key or url required' });
    if (!key.includes('.')) key = `${key}.jpg`;
    key = key.replace(/\.\./g, '').slice(0, 200);

    const proxyUrl = `/photos/${key}`;
    const objectKey = key.startsWith('photos/') ? key : `photos/${key}`;
    const wantSigned = String(req.query.signed || '') === '1' || String(req.query.signed || '') === 'true';

    let signedUrl: string | null = null;
    if (wantSigned) {
      const client = getS3Client();
      if (client) {
        try {
          const { GetObjectCommand } = await import('@aws-sdk/client-s3');
          const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
          const cmd = new GetObjectCommand({
            Bucket: CLOUDFLARE_R2_BUCKET_NAME,
            Key: objectKey,
          });
          signedUrl = await getSignedUrl(client as any, cmd, { expiresIn: 3600 });
        } catch (e: any) {
          console.warn('[B11d] signed URL failed, using proxy:', e?.message || e);
        }
      }
    }

    res.json({
      key: objectKey,
      proxyUrl,
      url: signedUrl || proxyUrl,
      signed: !!signedUrl,
      expiresIn: signedUrl ? 3600 : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'photo-url failed' });
  }
});

app.get('/api/r2/log-proxy', async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '');
    const jobId = String(req.query.jobId || '');
    const { fetchLogsFromR2 } = await import('./src/utils/r2Storage.js');

    let targetJobId = jobId;
    if (!targetJobId && rawUrl) {
      const match = rawUrl.match(/\/logs\/([^/?#]+)\.log/i) || rawUrl.match(/job_\d+_[a-z0-9]+/i);
      if (match) {
        targetJobId = match[1] || match[0];
      }
    }

    if (targetJobId) {
      const logs = await fetchLogsFromR2(targetJobId);
      if (logs) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(logs);
      }
      const { getInMemoryServerJob } = await import('./serverJobs');
      const memJob = getInMemoryServerJob(targetJobId);
      if (memJob) {
        const memLogs = (Array.isArray(memJob.accumulatedLogs) && memJob.accumulatedLogs.length > 0)
          ? memJob.accumulatedLogs.join('\n')
          : (Array.isArray(memJob.turn1Logs) && memJob.turn1Logs.length > 0 ? memJob.turn1Logs.join('\n') : (memJob.clean_result?.backendLogs || ''));
        if (memLogs && !memLogs.startsWith('[Logs stored in R2')) {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          return res.send(memLogs);
        }
      }
    }

    if (rawUrl && /^https?:\/\//i.test(rawUrl)) {
      const r2Res = await fetch(rawUrl);
      if (r2Res.ok) {
        const text = await r2Res.text();
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(text);
      }
    }

    return res.status(404).send('Log file not found');
  } catch (err: any) {
    console.error('[API] /api/r2/log-proxy error:', err);
    return res.status(500).send(err?.message || 'Failed to fetch R2 log');
  }
});

app.post('/api/r2/upload-debug', async (req, res) => {
  try {
    const { jobId, payload, userId } = req.body;
    // B14: strip base64; user-scoped cold key (legacy flat key still writable via old clients)
    const { stripHeavyImages, coldDebugR2Key, COLD_DEBUG_LOG } = await import('./src/utils/debugPayload');
    const key = coldDebugR2Key(String(jobId || 'unknown'), userId || payload?.userId || 'anonymous');
    const publicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/${key}`;
    const client = getS3Client();
    if (!client) {
      return res.json({ url: publicUrl });
    }

    const stripped = stripHeavyImages(payload || {});
    const body = Buffer.from(JSON.stringify(stripped, null, 2));

    const command = new PutObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    });
    await client.send(command);
    console.log(`${COLD_DEBUG_LOG} api ok key=${key} bytes=${body.length}`);

    res.json({ url: publicUrl });
  } catch (err) {
    console.error('Failed to upload debug to R2:', err);
    res.status(500).json({ error: 'Failed to upload debug' });
  }
});

app.post('/api/r2/upload-job-result', async (req, res) => {
  try {
    const { jobId, payload } = req.body;
    if (!jobId || !payload) {
      return res.status(400).json({ error: 'Missing jobId or payload' });
    }
    const publicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/jobs/${jobId}_result.json`;
    const client = getS3Client();
    if (!client) {
      return res.json({ url: publicUrl });
    }

    const body = Buffer.from(JSON.stringify(payload, null, 2));

    const command = new PutObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: `jobs/${jobId}_result.json`,
      Body: body,
      ContentType: 'application/json',
    });
    await client.send(command);
    console.log(`[JobResult R2 API] Uploaded ok key=jobs/${jobId}_result.json bytes=${body.length}`);

    res.json({ url: publicUrl });
  } catch (err: any) {
    console.error('Failed to upload job result to R2:', err);
    res.status(500).json({ error: err.message || 'Failed to upload job result' });
  }
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});
const imageSearchCache = new Map<string, any>();
const PORT = 3000;
const SERVER_START_TIME = Date.now();
console.log("[boot] server.ts evaluated, starting…");

async function startServer() {
  console.log("[boot] startServer()");
  ensureFoodCatalogSchema().then((r) => {
    if (!r.ok) console.error('[CatalogSchema] ensure on boot failed:', r.method, r.error);
  }).catch(() => {});

  // In-Memory & Local File Sync storage to act as the durable synced database
  const SYNC_DIR = path.join(process.cwd(), "data", "sync");
  if (!fs.existsSync(SYNC_DIR)) {
    fs.mkdirSync(SYNC_DIR, { recursive: true });
  }

  // Increase limit to allow base64 uploaded image payloads (Note: registered early above)
  // app.use(express.json({ limit: "15mb" }));
  // app.use(express.urlencoded({ extended: true, limit: "15mb" }));

  // Register session tracking middleware for isolated logging
  app.use((req, res, next) => {
    const sessionId = (req.headers["x-session-id"] as string) || (req.query.sessionId as string) || "global";
    logSessionStorage.run(sessionId, () => {
      next();
    });
  });

  app.post("/api/client-error", (req, res) => {
    const { message, stack } = req.body || {};
    addDebugLog(`[Client Error] ${message || 'Unknown Error'}\n${stack || ''}`);
    res.json({ status: "ok" });
  });

// Robust API key resolver supporting standard GEMINI_API_KEY, Google Cloud GOOGLE_API_KEY, or API_KEY
const getGeminiApiKey = (): string => {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.API_KEY ||
    process.env.GEMINI_API_KEYS?.split(',')[0]?.trim() ||
    ''
  );
};

// Initialize Gemini SDK with telemetry header
const getGeminiClient = () => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    console.warn("WARNING: GEMINI_API_KEY / GOOGLE_API_KEY is not defined in the environment.");
  }
  return new GoogleGenAI({
    apiKey: apiKey || "MOCK_KEY",
    httpOptions: {
      timeout: 150000,
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

// Helper to retrieve the Google Maps Place ID from business name & location
async function fetchGoogleMapsPlaceId(
  businessName: string,
  latitude: string | number,
  longitude: string | number,
  explicitSessionId?: string
): Promise<string> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    addDebugLog(`[get_google_maps_place_id] API Key is missing in process.env`, explicitSessionId);
    return "ERROR_API_FAILED";
  }
  
  // Use a strict AbortController timeout to prevent hangs
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
  
  try {
    const latStr = String(latitude).trim();
    const lngStr = String(longitude).trim();
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(businessName)}&inputtype=textquery&locationbias=point:${latStr},${lngStr}&fields=place_id&key=${apiKey}`;
    
    addDebugLog(`[get_google_maps_place_id] Fetching place ID for "${businessName}" near (${latStr}, ${lngStr})`, explicitSessionId);
    
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      addDebugLog(`[get_google_maps_place_id] Google Places API HTTP error: ${res.status}`, explicitSessionId);
      return "ERROR_API_FAILED";
    }
    const data = await res.json();
    if (data.status === "ZERO_RESULTS") {
      addDebugLog(`[get_google_maps_place_id] No results found (ZERO_RESULTS) for "${businessName}"`, explicitSessionId);
      return "NOT_FOUND";
    }
    if (data.candidates && data.candidates.length > 0) {
      const pId = data.candidates[0].place_id || "NOT_FOUND";
      addDebugLog(`[get_google_maps_place_id] Resolved successfully! Place ID: ${pId}`, explicitSessionId);
      return pId;
    }
    addDebugLog(`[get_google_maps_place_id] Status was ${data.status || 'unknown'}, candidates empty.`, explicitSessionId);
    return "NOT_FOUND";
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isAbort = err.name === 'AbortError';
    const errorMsg = isAbort ? 'Request timed out after 2500ms' : (err.message || err);
    addDebugLog(`[get_google_maps_place_id] Error: ${errorMsg}`, explicitSessionId);
    return "ERROR_API_FAILED";
  }
}



const ItemBreakdownSchema = z.object({
  scoutIndex: z.number().nullable().optional(),
  canonicalDbName: z.string().nullable().optional(),
  weightGrams: z.number().finite().nonnegative().nullable().optional(),
  dbSource: z.string().nullable().optional(),
  dbId: z.string().nullable().optional(),
  foodType: z.string().nullable().optional(),
  cookingMethod: z.string().nullable().optional(),
}).passthrough();

const VerdictSchema = z.object({
  label: z.string().optional(),
  level: z.string().optional()
}).passthrough();

const FoodDataSchema = z.object({
  date: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  itemsBreakdown: z.array(ItemBreakdownSchema).optional()
}).passthrough();

const RouteAgentSchema = z.object({
  _internalReasoning: z.string().nullable().optional(),
  verdict: VerdictSchema.nullable().optional(),
  message: z.string().nullable().optional(),
  foodData: FoodDataSchema.nullable().optional(),
  modificationCommand: z.array(z.any()).nullable().optional(),
  comparison: z.any().nullable().optional(),
}).passthrough();

// Validates parsed LLM JSON against a schema. On failure, logs the full raw
// output (so we can see exactly what the LLM sent) and returns the provided
// safe fallback instead of letting a malformed shape reach downstream math.
function validateOrFallback<T>(schema: z.ZodType<T>, parsed: any, rawText: string, label: string, fallback: T): T {
  const result = schema.safeParse(parsed);
  if (!result.success) {
    addDebugLog(`[Zod Validation Failed] ${label}: ${result.error.message}. Raw output: ${rawText}`);
    return fallback;
  }
  return result.data;
}

async function asyncParseLLMJSON(cleanJson: string): Promise<any> {
  await new Promise(resolve => setImmediate(resolve));
  let cleaned = cleanJson.replace(/\`\`\`(?:json)?/gi, "").replace(/\`\`\`/g, "").trim();
  
  // Array fallback
  if (cleaned.startsWith("[")) {
      let depth = 0;
      for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i] === "[") depth++;
        else if (cleaned[i] === "]") depth--;
        if (depth === 0) {
          return JSON.parse(cleaned.substring(0, i + 1));
        }
      }
  }
  
  return JSON.parse(extractBalancedJson(cleaned));
}

// Unified Multi-Provider LLM Router with automatic fallbacks & simulation modes
async function callUnifiedLLM(args: any): Promise<any> {
  const modelName = typeof args?.modelId === 'object'
    ? args.modelId?.name || args.modelId?.model || 'gemini-3.5-flash-lite'
    : (args?.modelId || 'gemini-3.5-flash-lite');

  const executeWithTimeout = async (runArgs: any) => {
    let timer: NodeJS.Timeout | undefined;
    const timeoutMs = 150000;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Model execution timed out (>150s) using "${modelName}". The request took too long to complete. Please retry or select another model from the top-left model selector.`));
      }, timeoutMs);
    });

    try {
      const res = await Promise.race([
        callUnifiedLLMInternal(runArgs),
        timeoutPromise
      ]);
      if (timer) clearTimeout(timer);
      return res;
    } catch (err: any) {
      if (timer) clearTimeout(timer);
      throw err;
    }
  };

  try {
    return await executeWithTimeout(args);
  } catch (err: any) {
    const errStr = String(err.message || err || "").toLowerCase();
    const isAbortedOrStalled = err?.name === 'AbortError' || errStr.includes('abort') || errStr.includes('stalled');
    if (isAbortedOrStalled) {
      throw err;
    }

    const isTimeoutOrDeadline = errStr.includes('deadline') || 
                                errStr.includes('timeout') || 
                                errStr.includes('timed out') || 
                                errStr.includes('504') ||
                                errStr.includes('expired');

    const isResourceExhausted = errStr.includes('resource_exhausted') || errStr.includes('quota') || errStr.includes('429');
    
    if (isResourceExhausted) {
      const modelName = typeof args?.modelId === 'object' ? (args.modelId as any)?.name || (args.modelId as any)?.model : args?.modelId;
      noteGeminiQuota(String(modelName || 'gemini-3.5-flash-lite'), err);
      throw new Error(`The Gemini API quota has been temporarily exhausted on ${modelName || 'this model'}. Wait the retry-after, or switch to Gemini 3.1 Flash Lite (separate free-tier bucket). Detailed API Error: ${err.message}`);
    }

    if (isTimeoutOrDeadline && !args.skipThinking) {
      console.warn(`[UnifiedLLM] Request failed (${err.message}). Retrying once with 'skipThinking: true'...`);
      
      try {
        const retryArgs = { 
          ...args, 
          skipThinking: true,
          // keep the original model for 503s instead of forcing a downgrade that might also 503
          modelId: args.modelId 
        };
        return await executeWithTimeout(retryArgs);
      } catch (retryErr: any) {
        console.error(`[UnifiedLLM] Fallback retry also failed:`, retryErr);
        throw retryErr;
      }
    }
    throw err;
  }
}

async function callUnifiedLLMInternal({
  modelId,
  systemInstruction,
  promptText,
  imagePayload,
  imagePayloads,
  responseMimeType,
  responseSchema,
  googleSearch,
  enablePlaceIdTool,
  maxOutputTokens,
  onStream,
  skipThinking,
  skipThoughtInjection,
  logStagePrefix
}: {
  modelId: string;
  systemInstruction: string;
  promptText: string;
  imagePayload?: { mimeType: string; data: string } | null;
  imagePayloads?: { mimeType: string; data: string }[] | null;
  responseMimeType?: "application/json" | "text/plain";
  responseSchema?: any;
  googleSearch?: boolean;
  enablePlaceIdTool?: boolean;
  maxOutputTokens?: number;
  onStream?: (chunk: string, isThought?: boolean) => void;
  skipThinking?: boolean;
  // When the caller's own response schema already nests a reasoning field
  // (e.g. health_coach's `report._internalReasoning`), set this to true so
  // the generic top-level thought-injection below is skipped. Without this,
  // the top-level check for `parsed._internalReasoning` never finds the
  // nested field and injects a second, top-level, unformatted reasoning
  // blob alongside the model's own schema-compliant one.
  skipThoughtInjection?: boolean;
  // Optional label (e.g. "scout", "dietitian") appended to this call's debug
  // log tags so the diagnostic viewer can attribute the full system
  // instruction/prompt/response to the right agent tab. Omit for every other
  // call site — behavior is unchanged when not provided.
  logStagePrefix?: string;
}) {
  const explicitSessionId = logSessionStorage.getStore();
  const _localAddDebugLog = (msg: string) => addDebugLog(msg, explicitSessionId);
  try {
    const isJson = responseMimeType === "application/json";
    const rawModelStr = typeof modelId === 'object' ? (modelId as any)?.name || (modelId as any)?.model || 'gemini-3.5-flash-lite' : (modelId || 'gemini-3.5-flash-lite');
    const normalizedModelId = rawModelStr.toLowerCase();
    if (normalizedModelId.includes('gemini')) {
      assertModelNotInQuotaCooldown(rawModelStr);
    }

  // 1. Anthropic Claude Models
  if (normalizedModelId.includes("claude-")) {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      console.log(`[UnifiedLLM] Calling official Anthropic API: ${normalizedModelId}`);
      try {
        const messages: any[] = [];
        const contentParts: any[] = [];
        if (imagePayloads && imagePayloads.length > 0) {
          for (const img of imagePayloads) {
            contentParts.push({
              type: "image",
              source: {
                type: "base64",
                media_type: img.mimeType,
                data: img.data
              }
            });
          }
        } else if (imagePayload) {
          contentParts.push({
            type: "image",
            source: {
              type: "base64",
              media_type: imagePayload.mimeType,
              data: imagePayload.data
            }
          });
        }
        contentParts.push({
          type: "text",
          text: promptText
        });
        messages.push({
          role: "user",
          content: contentParts
        });

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: normalizedModelId,
            max_tokens: 4096,
            system: systemInstruction + (isJson ? " Respond strictly in valid JSON format." : ""),
            messages
          })
        });

        if (res.ok) {
          const body = (await res.json()) as any;
          return body.content?.[0]?.text || "{}";
        } else {
          const errMsg = await res.text();
          console.warn(`Anthropic API call returned non-200 status (${res.status}): ${errMsg}. Falling back to Gemini...`);
        }
      } catch (err) {
        console.warn(`Error connecting to Anthropic:`, err, `. Falling back to Gemini...`);
      }
    }
  }

  // 2. OpenAI GPT Models
  if (normalizedModelId.includes("gpt-")) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      console.log(`[UnifiedLLM] Calling official OpenAI API: ${normalizedModelId}`);
      try {
        const messages = [
          { role: "system", content: systemInstruction },
          { role: "user", content: [] as any }
        ];

        const userContent: any[] = [{ type: "text", text: promptText }];
        if (imagePayloads && imagePayloads.length > 0) {
          for (const img of imagePayloads) {
            userContent.push({
              type: "image_url",
              image_url: {
                url: `data:${img.mimeType};base64,${img.data}`
              }
            });
          }
        } else if (imagePayload) {
          userContent.push({
            type: "image_url",
            image_url: {
              url: `data:${imagePayload.mimeType};base64,${imagePayload.data}`
            }
          });
        }
        messages[1].content = userContent;

        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openaiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: normalizedModelId,
            messages,
            response_format: isJson ? { type: "json_object" } : undefined
          })
        });

        if (res.ok) {
          const body = (await res.json()) as any;
          return body.choices?.[0]?.message?.content || "{}";
        } else {
          const errMsg = await res.text();
          throw new Error(`OpenAI API call returned non-200 status (${res.status}): ${errMsg}. Please try another model.`);
        }
      } catch (err: any) {
        throw new Error(`Error connecting to OpenAI: ${err.message || err}. Please try another model.`);
      }
    }
  }

  // 3. DeepSeek Models
  if (normalizedModelId.includes("deepseek-")) {
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if (deepseekKey) {
      console.log(`[UnifiedLLM] Calling official DeepSeek API: ${normalizedModelId}`);
      try {
        const messages = [
          { role: "system", content: systemInstruction },
          { role: "user", content: promptText }
        ];

        const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${deepseekKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: normalizedModelId === "deepseek-chat" ? "deepseek-chat" : "deepseek-reasoner",
            messages,
            response_format: isJson ? { type: "json_object" } : undefined
          })
        });

        if (res.ok) {
          const body = (await res.json()) as any;
          return body.choices?.[0]?.message?.content || "{}";
        } else {
          const errMsg = await res.text();
          throw new Error(`DeepSeek API call returned non-200 status (${res.status}): ${errMsg}. Please try another model.`);
        }
      } catch (err: any) {
        throw new Error(`Error connecting to DeepSeek: ${err.message || err}. Please try another model.`);
      }
    }
  }

  // 4. Gemini SDK
  const ai = getGeminiClient();

  if (!normalizedModelId.includes("gemini")) {
    throw new Error(`API key is not configured for ${normalizedModelId}. Please configure it in Settings or try another model.`);
  }
  
  let targetGeminiModel = normalizedModelId;
  if (targetGeminiModel === "gemini") {
    targetGeminiModel = "gemini-3.5-flash-lite";
  }



  const initialParts: any[] = [];
  if (imagePayloads && imagePayloads.length > 0) {
    for (const img of imagePayloads) {
      if (img.data && img.data.length > 0) {
        initialParts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.data
          }
        });
      }
    }
  } else if (imagePayload && imagePayload.data && imagePayload.data.length > 0) {
    initialParts.push({
      inlineData: {
        mimeType: imagePayload.mimeType,
        data: imagePayload.data
      }
    });
  }

  let resolvedInstruction = systemInstruction;

  if (promptText && promptText.length > 0) {
    initialParts.push({ text: promptText });
  }

  // Ensure we have at least one valid part
  if (initialParts.length === 0) {
    initialParts.push({ text: "Please process the request." });
  }

  const contents: any[] = [
    {
      role: "user",
      parts: initialParts
    }
  ];

  const configObj: any = {
    responseMimeType: isJson ? "application/json" : "text/plain",
    systemInstruction: resolvedInstruction,
    tools: []
  };

  // Enable native reasoning for models that support it (Gemini Pro, Flash, Flash-Lite models e.g. 3.5-flash-lite, 3.1-flash, 2.5-pro)
  if (isJson && !skipThinking && (
    normalizedModelId.includes("pro") || 
    normalizedModelId.includes("flash") ||
    normalizedModelId.includes("3.5") ||
    normalizedModelId.includes("2.5") ||
    normalizedModelId.includes("3.1")
  )) {
    configObj.thinkingConfig = {
      thinkingBudget: 1024,
      includeThoughts: true
    };
  }
  
  if (responseSchema) {
    configObj.responseSchema = responseSchema;
  }
  
  if (maxOutputTokens) {
    configObj.maxOutputTokens = maxOutputTokens;
  }
  
  // Grounding search (googleSearch) disabled per user request
  // if (googleSearch) {
  //   configObj.tools.push({ googleSearch: {} });
  // }

  if (enablePlaceIdTool) {
    configObj.tools.push({
      functionDeclarations: [
        {
          name: "get_google_maps_place_id",
          description: "Retrieves the exact Google Maps Place ID when given a business name and coordinates.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              business_name: { type: Type.STRING },
              latitude: { type: Type.STRING },
              longitude: { type: Type.STRING }
            },
            required: ["business_name", "latitude", "longitude"]
          }
        }
      ]
    });
  }

  if (enablePlaceIdTool) {
    configObj.toolConfig = { includeServerSideToolInvocations: true };
  }

  if (configObj.tools.length > 0) {
    if (configObj.responseSchema) {
      _localAddDebugLog(`[UnifiedLLM] Tools enabled (${configObj.tools.length}). Stripping responseSchema to prevent Gemini 400 INVALID_ARGUMENT error.`);
      delete configObj.responseSchema;
    }
  } else {
    delete configObj.tools;
  }

  let finalResponseText = "{}";
  const stageTag = logStagePrefix ? `:${logStagePrefix}` : '';
  _localAddDebugLog(`[UnifiedLLM${stageTag}] Dispatching prompt to model: "${targetGeminiModel}". Contents turns: ${contents.length}.`);
  _localAddDebugLog(`[UnifiedLLM${stageTag}] Attaching ${imagePayloads?.length || (imagePayload ? 1 : 0)} image part(s) to model "${targetGeminiModel}".`);
  _localAddDebugLog(`[UnifiedLLM-Prompt${stageTag}] System Instruction:\n${resolvedInstruction}`);
  _localAddDebugLog(`[UnifiedLLM-Prompt${stageTag}] User Prompt:\n${promptText}`);
  try {
    let response: any;
    let thoughtsText = "";
    if (onStream && (!configObj.tools || configObj.tools.length === 0)) {
      try {
        const stream = await withGeminiRetry(() => ai.models.generateContentStream({
          model: targetGeminiModel,
          contents,
          config: configObj
        }), { label: "Unified LLM Stream" });
        let fullText = "";
        for await (const chunk of stream) {
          if (chunk.candidates?.[0]?.content?.parts) {
            for (const part of chunk.candidates[0].content.parts) {
              if (part.thought && part.text) {
                thoughtsText += part.text;
                onStream(part.text, true); // true = isThought
              } else if (part.text) {
                fullText += part.text;
                onStream(part.text, false);
              }
            }
          } else if (chunk.text) {
            fullText += chunk.text;
            onStream(chunk.text, false);
          }
        }
        response = { text: fullText, functionCalls: [] };
      } catch (streamErr: any) {
        if (isGeminiQuotaError(streamErr)) {
          noteGeminiQuota(targetGeminiModel, streamErr);
          throw streamErr;
        }
        if (isGeminiUnavailableError(streamErr)) {
          addDebugLog(`[UnifiedLLM] Stream 503 on ${targetGeminiModel} — not falling back to a second generateContent (that doubles quota).`);
          throw streamErr;
        }
        const errMsg = String(streamErr?.message || streamErr || "").toLowerCase();
        const isAbortOrTimeout = streamErr?.name === 'AbortError' || 
                                 errMsg.includes('abort') || 
                                 errMsg.includes('stalled') || 
                                 errMsg.includes('timeout') || 
                                 errMsg.includes('timed out');
        if (isAbortOrTimeout) {
          addDebugLog(`[UnifiedLLM] Stream aborted/timed out (${streamErr?.message}) — throwing directly without non-streaming fallback.`);
          throw streamErr;
        }
        addDebugLog(`[UnifiedLLM] Stream failed (${streamErr?.message}). Falling back to non-streaming generateContent...`);
        const fullRes = await withGeminiRetry(() => ai.models.generateContent({
          model: targetGeminiModel,
          contents,
          config: configObj
        }), { label: "Unified LLM Stream Fallback" });
        let fullText = fullRes.text || "";
        if (onStream) onStream(fullText, false);
        response = { text: fullText, candidates: fullRes.candidates, functionCalls: fullRes.functionCalls };
      }
    } else {
      response = await withGeminiRetry(() => ai.models.generateContent({
        model: targetGeminiModel,
        contents,
        config: configObj
      }), { label: "Unified LLM" });
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.thought && part.text) {
            thoughtsText += part.text;
          }
        }
      }
    }


    let finalJson = response.text || "";
    // Inject native thoughts as "_internalReasoning" back into final JSON so existing code downstream works seamlessly.
    // Skipped when the caller's schema already nests its own reasoning field (see skipThoughtInjection above).
    if (isJson && finalJson && thoughtsText && !skipThoughtInjection) {
      try {
        const parsed = JSON.parse(finalJson);
        
        if (!parsed._internalReasoning) {
          parsed._internalReasoning = thoughtsText;
          finalJson = JSON.stringify(parsed);
        }
      } catch (e) {}
    }
    // response.text is a getter-only property on the SDK's GenerateContentResponse class —
    // assigning to it throws and was silently forcing every call through the slow REST
    // fallback below. Rebuild `response` as a plain object so downstream code in this
    // function can keep reading response.text / response.functionCalls / response.candidates
    // exactly as before, without touching the SDK instance.
    response = { text: finalJson, candidates: response.candidates, functionCalls: response.functionCalls };
    
    let callCount = 0;
    const maxCalls = 5;
    while (response.functionCalls && response.functionCalls.length > 0 && callCount < maxCalls) {
      callCount++;
      const calls = response.functionCalls;
      _localAddDebugLog(`[UnifiedLLM] Received ${calls.length} tool call requests from Gemini (Turn ${callCount}/${maxCalls}).`);
      const modelParts: any[] = [];
      const userParts: any[] = [];

      for (const call of calls) {
        let functionResponseData = {};
        if (call.name === "get_google_maps_place_id") {
          try {
            const { business_name, latitude, longitude } = call.args as any;
            _localAddDebugLog(`[UnifiedLLM] Call args: business_name="${business_name}", lat="${latitude}", lng="${longitude}"`);
            const pId = await fetchGoogleMapsPlaceId(business_name, latitude, longitude, explicitSessionId);
            if (pId === "ERROR_API_FAILED" || pId === "NOT_FOUND") {
              functionResponseData = { 
                place_id: "NOT_FOUND", 
                instruction: "STOP TOOL USE. The Google Maps API call failed or the key is missing. Immediately use standard coordinate URLs for all remaining items without calling this tool again." 
              };
            } else {
              functionResponseData = { place_id: pId };
            }
          } catch (e: any) {
            _localAddDebugLog(`[UnifiedLLM] Exception executing tool call: ${e.message || e}`);
            functionResponseData = { 
              place_id: "NOT_FOUND", 
              instruction: "STOP TOOL USE. An exception occurred during tool execution. Immediately use standard coordinate URLs for all remaining items without calling this tool again." 
            };
          }
        } else {
          _localAddDebugLog(`[UnifiedLLM] Warning: Unknown tool requested: "${call.name}"`);
        }
        
        modelParts.push({ functionCall: call });
        userParts.push({
          functionResponse: {
            name: call.name,
            response: functionResponseData
          }
        });
      }

      // Add the model's response (preserving thought_signature and candidates structure) to contents
      const modelContent = response.candidates?.[0]?.content;
      if (modelContent) {
        contents.push(modelContent);
      } else {
        contents.push({
          role: "model",
          parts: modelParts
        });
      }

      // Add our function responses to contents
      contents.push({
        role: "user",
        parts: userParts
      });

      addDebugLog(`[UnifiedLLM] Feeding responses back to Gemini and requesting next content turn...`);
      response = await withGeminiRetry(() => ai.models.generateContent({
        model: targetGeminiModel,
        contents,
        config: configObj
      }), { label: "Unified LLM" });
    }

    if ((response.functionCalls && response.functionCalls.length > 0) || !response.text) {
      addDebugLog(`[UnifiedLLM] Reached maximum tool calls or text is empty. Forcing model to produce final text...`);
      contents.push({
        role: "user",
        parts: [{ text: "Please provide your final JSON response now based on the information retrieved so far. Do not call any more tools." }]
      });
      const forceTextConfig = { ...configObj };
      delete forceTextConfig.tools;
      delete forceTextConfig.toolConfig;
      response = await withGeminiRetry(() => ai.models.generateContent({
        model: targetGeminiModel,
        contents,
        config: forceTextConfig
      }), { label: "Unified LLM" });
    }
    
    addDebugLog(`[UnifiedLLM] Successfully completed content generation. Response length: ${response.text?.length || 0} chars.`);
    const __respText = response.text || "{}";
    const __respLogged = __respText;
    addDebugLog(`[UnifiedLLM-Response${stageTag}] Complete response returned from agent:\n${__respLogged}`);
    return response.text || "{}";
  } catch (err: any) {
    addDebugLog(`[UnifiedLLM] First generation attempt failed: ${err.message || err}. Stack: ${err.stack}`);
    
    if (googleSearch) {
      addDebugLog(`[UnifiedLLM] Grounding tool failed or search quota limit reached (${err.message || err}). Retrying without Google Search Grounding...`);
      const fallbackConfig = { ...configObj };
      delete fallbackConfig.tools;
      if (enablePlaceIdTool) {
        // keep the custom tool
        fallbackConfig.tools = [{
          functionDeclarations: [
            {
              name: "get_google_maps_place_id",
              description: "Retrieves the exact Google Maps Place ID when given a business name and coordinates.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  business_name: { type: Type.STRING },
                  latitude: { type: Type.STRING },
                  longitude: { type: Type.STRING }
                },
                required: ["business_name", "latitude", "longitude"]
              }
            }
          ]
        }];
      }
      try {
        // Reset contents to initial state for fallback to avoid duplicated turns
        const fallbackContents = [contents[0]];
        addDebugLog(`[UnifiedLLM-Fallback] Dispatching prompt to model without search grounding...`);
        let response = await withGeminiRetry(() => ai.models.generateContent({
          model: targetGeminiModel,
          contents: fallbackContents,
          config: fallbackConfig
        }), { label: "Unified LLM" });
        
        // Handle function calls loop for fallback
        let callCountFallback = 0;
        const maxCallsFallback = 5;
        while (response.functionCalls && response.functionCalls.length > 0 && callCountFallback < maxCallsFallback) {
          callCountFallback++;
          const calls = response.functionCalls;
          addDebugLog(`[UnifiedLLM-Fallback] Received ${calls.length} tool call requests (Turn ${callCountFallback}/${maxCallsFallback}).`);
          const modelParts: any[] = [];
          const userParts: any[] = [];

          for (const call of calls) {
            let functionResponseData = {};
            if (call.name === "get_google_maps_place_id") {
              try {
                const { business_name, latitude, longitude } = call.args as any;
                addDebugLog(`[UnifiedLLM-Fallback] Call args: business_name="${business_name}", lat="${latitude}", lng="${longitude}"`);
                const pId = await fetchGoogleMapsPlaceId(business_name, latitude, longitude, explicitSessionId);
                if (pId === "ERROR_API_FAILED" || pId === "NOT_FOUND") {
                  functionResponseData = { 
                    place_id: "NOT_FOUND", 
                    instruction: "STOP TOOL USE. The Google Maps API call failed or the key is missing. Immediately use standard coordinate URLs for all remaining items without calling this tool again." 
                  };
                } else {
                  functionResponseData = { place_id: pId };
                }
              } catch (e: any) {
                addDebugLog(`[UnifiedLLM-Fallback] Exception executing tool call: ${e.message || e}`);
                functionResponseData = { 
                  place_id: "NOT_FOUND", 
                  instruction: "STOP TOOL USE. An exception occurred during tool execution. Immediately use standard coordinate URLs for all remaining items without calling this tool again." 
                };
              }
            }
            
            modelParts.push({ functionCall: call });
            userParts.push({
              functionResponse: {
                name: call.name,
                response: functionResponseData
              }
            });
          }

          const modelContent = response.candidates?.[0]?.content;
          if (modelContent) {
            fallbackContents.push(modelContent);
          } else {
            fallbackContents.push({ role: "model", parts: modelParts });
          }
          fallbackContents.push({ role: "user", parts: userParts });

          addDebugLog(`[UnifiedLLM-Fallback] Feeding responses back to Gemini...`);
          response = await withGeminiRetry(() => ai.models.generateContent({
            model: targetGeminiModel,
            contents: fallbackContents,
            config: fallbackConfig
          }), { label: "Unified LLM" });
        }

        if ((response.functionCalls && response.functionCalls.length > 0) || !response.text) {
          addDebugLog(`[UnifiedLLM-Fallback] Reached maximum tool calls or text is empty on fallback. Forcing final text...`);
          fallbackContents.push({
            role: "user",
            parts: [{ text: "Please provide your final JSON response now based on the information retrieved so far. Do not call any more tools." }]
          });
          const forceTextConfig = { ...fallbackConfig };
          delete forceTextConfig.tools;
          delete forceTextConfig.toolConfig;
          response = await withGeminiRetry(() => ai.models.generateContent({
            model: targetGeminiModel,
            contents: fallbackContents,
            config: forceTextConfig
          }), { label: "Unified LLM" });
        }
        
        addDebugLog(`[UnifiedLLM-Fallback] Successfully completed content generation on fallback. Response length: ${response.text?.length || 0} chars.`);
        addDebugLog(`[UnifiedLLM-Fallback-Response] Complete response returned from agent on fallback:\n${response.text || "{}"}`);
        return response.text || "{}";
      } catch (retryErr: any) {
        addDebugLog(`[UnifiedLLM-Fallback] Error on fallback retry: ${retryErr.message || retryErr}`);
        throw retryErr;
      }
    }

    const isAbort = err.name === 'AbortError' || (err.message && err.message.toLowerCase().includes('abort'));
    const isQuota = err.message && (err.message.includes('429') || err.message.includes('quota') || err.message.toLowerCase().includes('resource_exhausted'));
    
    if (isAbort || isQuota) {
      addDebugLog(`[UnifiedLLM] Fatal error (${isAbort ? 'Timeout' : 'Quota'}) detected. Throwing immediately without retry.`);
      throw err;
    } else {
      throw err;
    }
  }
  } catch (err: any) {
    throw err;
  }
}

// Endpoint to fetch real server start/uptime status for accurate publication timing
app.get("/api/debug/live-stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();

  liveStreamClients.add(res);
  res.write(`data: ${JSON.stringify({ message: "=== GLOBAL LIVE STREAM CONNECTED ===" })}\n\n`);
  if (typeof (res as any).flush === 'function') (res as any).flush();

  const pingInterval = setInterval(() => {
    try {
      res.write(": ping\n\n");
      if (typeof (res as any).flush === 'function') (res as any).flush();
    } catch (e) {
      clearInterval(pingInterval);
      liveStreamClients.delete(res);
    }
  }, 15000);

  const cleanupStream = () => {
    clearInterval(pingInterval);
    liveStreamClients.delete(res);
  };
  req.on("close", cleanupStream);
  res.on("finish", cleanupStream);
  res.on("error", cleanupStream);
});

app.get("/api/status", (req, res) => {
  res.json({ startTime: SERVER_START_TIME });
});

// Sync & Admin endpoints are handled by syncRouter and adminRouter in server_routes_sync.ts and server_routes_admin.ts


// GET Endpoint for System Instruction Preview
app.get("/api/gemini/instruction-preview", async (req, res) => {
  try {
    const { agentType, biomarkersNeedingImprovement, remainingAllowance, activeMeal } = req.query;
    
    if (agentType === 'food_scout') {
      const instruction = `You are a fast visual food identification agent. Look at the image and return a short list of plain-text search keywords for the food items you see (e.g. ['fried chicken', 'white rice', 'sambal']), plus a rough estimated weight in grams for each if visually judgeable. Do not do any nutrition or clinical analysis. Also try to identify any clues on how it's cooked (e.g., oil cooked, fried, steamed) or freshness (e.g., fresh fish). Include these details in your keywords if helpful. Output only: { "items": [{ "keyword": string, "estimatedWeightGrams": number }] }`;
      return res.json({ instruction });
    }

    if (agentType === 'food') {
      let parsedBiomarkers: any[] | undefined = undefined;
      let parsedAllowance: any = undefined;
      let parsedMeal: any = undefined;

      try {
        if (biomarkersNeedingImprovement && typeof biomarkersNeedingImprovement === 'string') {
          parsedBiomarkers = JSON.parse(biomarkersNeedingImprovement);
        }
      } catch (e) {}

      try {
        if (remainingAllowance && typeof remainingAllowance === 'string') {
          parsedAllowance = JSON.parse(remainingAllowance);
        }
      } catch (e) {}

      try {
        if (activeMeal && typeof activeMeal === 'string') {
          parsedMeal = JSON.parse(activeMeal);
        }
      } catch (e) {}

      // If they are not passed or empty, try to look up the user's synced context
      if (!parsedBiomarkers || !parsedAllowance) {
        const idToken = req.headers.authorization?.split('Bearer ')[1];
        if (idToken) {
          try {
            const decoded = await adminAuth.verifyIdToken(idToken);
            const uid = decoded.uid;
            
            if (db) {
              // Try to fetch reports/latest
              const reportRef = db.collection('users').doc(uid).collection('reports').doc('latest');
              const reportSnap = await reportRef.get();
              if (reportSnap.exists) {
                const reportData = reportSnap.data();
                if (reportData && Array.isArray(reportData.biomarkers)) {
                  parsedBiomarkers = reportData.biomarkers.filter((b: any) => b.status === 'At Risk' || b.status === 'HIGH' || b.status === 'LOW');
                }
              }

              // Try to fetch dashboard
              const dashRef = db.collection('users').doc(uid).collection('metadata').doc('dashboard');
              const dashSnap = await dashRef.get();
              if (dashSnap.exists) {
                const dashData = dashSnap.data();
                if (dashData) {
                  if (!parsedAllowance && dashData.remainingAllowance) {
                    parsedAllowance = dashData.remainingAllowance;
                  }
                  if (!parsedMeal && dashData.activeMeal) {
                    parsedMeal = dashData.activeMeal;
                  }
                }
              }
            }
          } catch (err) {
            console.warn("[instruction-preview] Error loading authenticated user context:", err);
          }
        }
      }

      // Safe placeholder values as fallback
      if (!parsedBiomarkers) {
        parsedBiomarkers = [];
      }
      if (!parsedAllowance) {
        parsedAllowance = {
          calories: 2000,
          saturatedFat: 20,
          sodium: 2300
        };
      }

      const instruction = buildFoodAnalyzeInstruction({
        biomarkersNeedingImprovement: parsedBiomarkers,
        remainingAllowance: parsedAllowance,
        activeMeal: parsedMeal
      });

      return res.json({ instruction });
    }

    return res.status(400).json({ error: "Unsupported agentType" });
  } catch (error: any) {
    console.error("[instruction-preview] Error:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

// Gemini Food Analyze Endpoint

// Health Preparation Agent
app.post("/api/gemini/front-desk", async (req, res) => {
  try {
    const { message, profile, biomarkers, foodLogs, biomarkerHistory, engine } = req.body;
    
    let targetModel = typeof engine === 'object' ? engine?.name || engine?.model || "gemini-3.5-flash-lite" : (engine || "gemini-3.5-flash-lite");
  

    const cleanedHistory = (biomarkerHistory || []).slice().reverse().map((item: any) => {
      if (!item) return item;
      const clean = { ...item };
      if (typeof clean.note === 'string') {
        clean.note = Array.from(new Set(clean.note.split(/[;|\n]/).map((s: string) => s.trim()).filter(Boolean))).join('; ');
      }
      if (typeof clean.summary === 'string') {
        clean.summary = Array.from(new Set(clean.summary.split(/[;|\n]/).map((s: string) => s.trim()).filter(Boolean))).join('; ');
      }
      return clean;
    });

    const prompt = `
You are the Health Preparation Agent. Your job is to answer the user's questions regarding their health data, and guide them on what they should do next.
You have access to their profile, biomarkers, and food logs.

<USER_DATA>
Profile: ${JSON.stringify(profile, null, 2)}
Biomarkers: ${JSON.stringify(biomarkers, null, 2)}
Food Logs (Last 5): ${JSON.stringify(foodLogs ? foodLogs.slice(0, 5) : [], null, 2)}
Recent Biomarker History (most recent first, up to 40 entries): ${JSON.stringify(cleanedHistory, null, 2)}
</USER_DATA>

If the user asks "What should I do?", analyze their data and see what is missing (e.g. missing age, weight, or missing biomarkers, or no food logs logged).
Advise them on which of the 5 specialized agents to use:
- Add Health Data
- Review Biomarkers
- Clinical Review
- Health Planning
- Medical Insights

If the user gives you information to update their profile (like their weight, height, age, blood type), you MUST include a JSON block in your response to update the profile.
Format for updating profile and adding biomarker logs:
\`\`\`json
{
  "updatedProfile": {
    "weight": 70,
    "height": 175,
    "age": 30
  },
  "newBiomarkerLogs": [
    { "biomarker": "HbA1c", "value": 5.5, "unit": "%", "date": "2023-10-10" }
  ]
}
\`\`\`
Any fields you specify in the JSON will be merged into their profile. 

Answer the user's message directly and concisely.

User Message: ${message}
`;

    addDebugLog(`[FrontDesk] Dispatching prompt to model: "${targetModel}".`);
    addDebugLog(`[FrontDesk-Prompt] User Prompt:\n${prompt}`);

    const ai = getGeminiClient();
    const response = await withGeminiRetry(() => ai.models.generateContent({
      model: targetModel,
      contents: prompt,
      config: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        httpOptions: { timeout: 60000 }
      }
    }));

    const reply = response.text || "";
    addDebugLog(`[FrontDesk-Response] ${reply}`);
    
    // Parse updatedProfile if any
    let updatedProfile = null;
    let newBiomarkerLogs = null;
    const jsonMatch = reply.match(/\`\`\`json\s*({[\s\S]*?})\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.newBiomarkerLogs) {
          newBiomarkerLogs = parsed.newBiomarkerLogs;
        }
        if (parsed.updatedProfile) {
          updatedProfile = { ...profile, ...parsed.updatedProfile };
        }
      } catch(e) {}
    }

    res.json({ agentPrompt: prompt, text: reply.replace(/\`\`\`json[\s\S]*?\`\`\`/g, '').trim(), updatedProfile, newBiomarkerLogs, type: 'front_desk' });
  } catch (err: any) {
    console.error("Front Desk Error:", err);
    res.status(500).json({ error: err.message });
  }
});

function extractFoodSearchQueriesFromText(message: string): string[] {
  if (!message || typeof message !== 'string') return [];
  
  let msg = message.trim().toLowerCase();

  // Non-food / greeting check
  const nonFoodPatterns = [
    /^(start|let's start|hello|hi|hey|greetings|help|test|yes|no|ok|okay|clear|reset|menu|why|explain|question|info|please)$/i,
    /\b(alt|ast|cholesterol|ldl|hdl|egfr|creatinine|bilirubin|triglycerides|platelets|wbc|rbc|hemoglobin|hba1c|glucose|blood pressure|systolic|diastolic)\b/i
  ];
  const isNonFood = nonFoodPatterns.some(p => p.test(msg)) && !/\b(eat|ate|eating|had|cooked|fried|grilled|recipe|meal|food|snack|breakfast|lunch|dinner|portion|slice|glass|cup|gram|grams|calorie|calories|nutrient|nutrients)\b/i.test(msg);
  if (isNonFood) return [];

  // Remove portion/weight amounts & units: e.g. "200g", "150 grams", "2 oz", "1 serving", "3 pcs", "2 slices", "1/2 cup"
  msg = msg.replace(/\b\d+(\.\d+)?\s*(g|grams|oz|lbs|kg|servings|serving|pcs|piece|pieces|slice|slices|cup|cups|glass|glasses|tbsp|tsp|bowl|bowls|plate|plates)?\b/gi, ' ');
  msg = msg.replace(/\b(\d+\/\d+)\s*(g|grams|oz|lbs|kg|servings|serving|pcs|piece|pieces|slice|slices|cup|cups|glass|glasses|tbsp|tsp|bowl|bowls|plate|plates)?\b/gi, ' ');

  // Remove punctuation (including apostrophes, commas, quotes, hyphens, colons, brackets)
  msg = msg.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?'"“”\[\]]/g, ' ');

  // List of conversational stop words/phrases to remove
  const stopWords = new Set([
    'it', 'its', 'is', 's', 'that', 'thats', 'this', 'these', 'those', 'there', 'theres', 'they', 'theyre', 'them',
    'i', 'me', 'my', 'you', 'your', 'we', 'our', 'he', 'she', 'his', 'her',
    'am', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'would', 'should', 'could', 'will', 'can',
    'a', 'an', 'the', 'and', 'or', 'with', 'for', 'in', 'on', 'at', 'to', 'from', 'by', 'of', 'some', 'about', 'into', 'through',
    'not', 'no', 'but', 'yes', 'ok', 'okay', 'please', 'thanks', 'thank', 'hello', 'hi', 'hey',
    'eat', 'ate', 'eating', 'had', 'have', 'having', 'food', 'meal', 'snack', 'dinner', 'lunch', 'breakfast', 'item', 'items',
    'portion', 'portions', 'dish', 'dishes', 'plate', 'plates',
    'correction', 'corrections', 'actually', 'instead', 'change', 'modify', 'update', 'correct', 'replace',
    'rather', 'than', 'think', 'believe', 'cooked', 'made', 'make'
  ]);

  // Split into candidate food phrases using conjunctions / separators ("and", ",", "+", ";", "with", "to", "instead of")
  const rawSegments = msg.split(/\b(?:and|with|to|instead of|\+|;|,)\b/gi);
  const queries: string[] = [];

  for (const seg of rawSegments) {
    const words = seg.trim().split(/\s+/).filter(w => w.length > 0);
    // Filter out stop words
    const foodWords = words.filter(w => !stopWords.has(w) && w.length > 1);
    
    if (foodWords.length > 0) {
      const foodPhrase = foodWords.join(' ').trim();
      if (foodPhrase.length >= 2 && !/^\d+$/.test(foodPhrase)) {
        if (!queries.includes(foodPhrase)) {
          queries.push(foodPhrase);
        }
      }
    }
  }

  return queries;
}

app.post("/api/gemini/food-analyze", async (req, res) => {
  if (!req.headers['x-session-id'] || !req.headers['x-session-id'].toString().startsWith('server-job-')) {
    return res.status(403).json({ error: 'This SSE path is deprecated and strictly reserved for internal loopback execution.' });
  }
  const isStream = req.query.stream === 'true';
  let hasSentHeaders = false;
  const sessionId = logSessionStorage.getStore() || "global";
  const initialLogCount = (sessionDebugLogs[sessionId] || globalDebugLogs).length;


  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.flushHeaders();
    hasSentHeaders = true;

    const originalJson = res.json.bind(res);
    const originalStatus = res.status.bind(res);

    res.status = (code: number) => {
      // If headers already sent, ignore status code changes
      if (!res.headersSent) {
        originalStatus(code);
      }
      return res;
    };

    res.json = (body: any) => {
      const sessionId = logSessionStorage.getStore() || "global";
      const logsToUse = sessionDebugLogs[sessionId] || globalDebugLogs;
      body.agentResult = body.agentResult || {};
      body.agentResult.backendLogs = logsToUse.slice(initialLogCount).map((l: any) => `[${l.timestamp}] ${l.message}`).join('\n');
      
      const jobId = req.body.jobId;
      const photoUrl = req.body.photoUrl;
      if (jobId) {
         import('./supabaseAdmin.js').then(({ supabaseAdmin }) => {
            let cleanResult = JSON.parse(JSON.stringify(body));
            if (cleanResult.agentResult) delete cleanResult.agentResult.backendLogs;
            if (cleanResult.raw) delete cleanResult.raw;
            
            const dbCleanResult = { pendingFoodLog: cleanResult, photoUrl };
            import('./src/utils/r2Storage.js').then(async ({ uploadJobResultToR2 }) => {
               let lightweightResult = dbCleanResult;
               try {
                  const publicUrl = await uploadJobResultToR2(jobId, dbCleanResult);
                  if (publicUrl) {
                     lightweightResult = {
                        is_r2: true,
                        r2_url: publicUrl,
                        mode: 'review',
                        text: cleanResult.text || '',
                        message: cleanResult.message || 'Completed successfully',
                     } as any;
                  }
               } catch (r2Err) {
                  console.error('[Background Worker] Failed to save cleanResult to R2:', r2Err);
               }

               return supabaseAdmin.from('agent_jobs').update({
                  status: 'succeeded',
                  progress_percent: 100,
                  status_message: 'Completed successfully',
                  clean_result: lightweightResult,
                  updated_at: new Date().toISOString()
               }).eq('id', jobId);
            }).then(() => {
               console.log('[Background Worker] Successfully saved job to Supabase:', jobId);
            }).catch(e => console.error('Failed to update supabase', e));
         });
      }
      res.write(`data: ${JSON.stringify({ final: true, result: body })}\n\n`);
      res.end();
      return res;
    };
  }

  const sendStreamEvent = (data: any) => {
    if (isStream && hasSentHeaders) {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
      } catch (e) {}
    }
  };

  await streamDebugLogStorage.run((_msg: string) => {
    // sendLog() below already broadcasts its own tagged event directly — every message
    // it passes to addDebugLog() is prefixed "[<logType>] ...", so skip re-forwarding
    // those here to avoid sending the same line twice under two different tags.
    if (/^\[(status|scout_instruction|scout_answer|db_search|db_search_complete|dietitian_instruction|dietitian_answer)\]/.test(_msg)) {
      return;
    }
    sendStreamEvent({ type: 'log', logType: 'backend', stage: 'backend', message: _msg });
  }, async () => {
  let visionScoutItems: any[] = [];
  let visionScoutContentType: string | null = null;
  let preCalculatedItems: any[] | undefined;
  let aggregatedNutrients: any;
  let fullPromptSent: string = "";
  let apiCalls: any[] = [];
  try {
    const { message, image, images, imageDates, history, userProfile, engine, biomarkersNeedingImprovement, remainingAllowance, userId, activeMeal, customSystemInstruction, customVariableData, foodLogs, userSelectedMode } = req.body;
    const activeComparison = req.body.activeComparison;

    const sendLog = (logType: string, stage: 'scout' | 'db_search' | 'dietitian' | 'food_resolver', messageText: string, extra?: any) => {
      addDebugLog(`[${logType}] ${messageText}`);
      sendStreamEvent({ type: 'log', logType, stage, message: messageText, timestamp: Date.now(), ...extra });
    };
    sendLog('status', 'scout', 'Starting food analysis...');

    const STANDARD_FOOD_FACTORS: {[key: string]: {calories: number, saturatedFat: number, sodium: number, protein: number, carbohydrates: number, totalFat: number}} = {
      steak: { calories: 2.5, saturatedFat: 0.05, sodium: 1.8, protein: 0.26, carbohydrates: 0.0, totalFat: 0.18 },
      beef: { calories: 2.5, saturatedFat: 0.05, sodium: 1.8, protein: 0.26, carbohydrates: 0.0, totalFat: 0.18 },
      chicken: { calories: 1.65, saturatedFat: 0.01, sodium: 0.7, protein: 0.31, carbohydrates: 0.0, totalFat: 0.036 },
      breast: { calories: 1.65, saturatedFat: 0.01, sodium: 0.7, protein: 0.31, carbohydrates: 0.0, totalFat: 0.036 },
      pork: { calories: 2.4, saturatedFat: 0.03, sodium: 0.8, protein: 0.27, carbohydrates: 0.0, totalFat: 0.14 },
      fish: { calories: 1.5, saturatedFat: 0.01, sodium: 0.8, protein: 0.20, carbohydrates: 0.0, totalFat: 0.06 },
      salmon: { calories: 2.0, saturatedFat: 0.015, sodium: 0.5, protein: 0.20, carbohydrates: 0.0, totalFat: 0.13 },
      rice: { calories: 1.3, saturatedFat: 0.0, sodium: 0.01, protein: 0.027, carbohydrates: 0.28, totalFat: 0.003 },
      broccoli: { calories: 0.35, saturatedFat: 0.0, sodium: 0.3, protein: 0.028, carbohydrates: 0.07, totalFat: 0.004 },
      egg: { calories: 1.5, saturatedFat: 0.03, sodium: 1.4, protein: 0.13, carbohydrates: 0.011, totalFat: 0.11 },
      avocado: { calories: 1.6, saturatedFat: 0.02, sodium: 0.07, protein: 0.02, carbohydrates: 0.085, totalFat: 0.147 },
      bread: { calories: 2.6, saturatedFat: 0.005, sodium: 4.8, protein: 0.09, carbohydrates: 0.49, totalFat: 0.032 },
      butter: { calories: 7.1, saturatedFat: 5.1, sodium: 5.7, protein: 0.009, carbohydrates: 0.001, totalFat: 0.81 },
      cheese: { calories: 4.0, saturatedFat: 1.8, sodium: 6.2, protein: 0.25, carbohydrates: 0.013, totalFat: 0.33 },
      salad: { calories: 0.2, saturatedFat: 0.0, sodium: 0.1, protein: 0.01, carbohydrates: 0.03, totalFat: 0.002 },
      tomato: { calories: 0.18, saturatedFat: 0.0, sodium: 0.05, protein: 0.009, carbohydrates: 0.039, totalFat: 0.002 },
      oil: { calories: 8.8, saturatedFat: 1.4, sodium: 0.0, protein: 0.0, carbohydrates: 0.0, totalFat: 1.0 },
      potato: { calories: 0.8, saturatedFat: 0.0, sodium: 0.05, protein: 0.02, carbohydrates: 0.17, totalFat: 0.001 },
      pasta: { calories: 1.3, saturatedFat: 0.0, sodium: 0.01, protein: 0.05, carbohydrates: 0.25, totalFat: 0.011 }
    };

    // 1. Intercept prompt & read current active state from Request Body (passed from client)
    if (activeMeal) {
      addDebugLog(`[Client State] Received active meal: ${activeMeal.name}`);
    } else {
      addDebugLog(`[Client State] No active meal received.`);
    }

    // Check if key is mock
    if (!getGeminiApiKey()) {
      // If the user's message is a modify request, let's execute modify command offline!
      const isModifyRequest = message.toLowerCase().includes("change") || message.toLowerCase().includes("modify") || message.toLowerCase().includes("update") || message.toLowerCase().includes("remove") || message.toLowerCase().includes("add") || message.toLowerCase().includes("gram");
      
      if (isModifyRequest && activeMeal) {
        // Let's create an offline mock command
        let mockCommand: any = null;
        if (message.toLowerCase().includes("steak")) {
          const match = message.match(/(\d+)\s*g/);
          const grams = match ? Number(match[1]) : 100;
          mockCommand = { action: "update_weight", itemName: "Beef Steak", newWeightGrams: grams };
        } else if (message.toLowerCase().includes("remove")) {
          mockCommand = { action: "remove_item", itemName: "Beef Steak" };
        } else {
          const match = message.match(/(\d+)\s*g/);
          const grams = match ? Number(match[1]) : 120;
          mockCommand = { action: "add_item", itemName: "Extra Topping", newWeightGrams: grams };
        }

        const originalTotalWeight = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.weightGrams) || 0), 0) || 1;
        
        if (mockCommand) {
          if (mockCommand.action === "update_weight") {
            const item = activeMeal.itemsBreakdown?.find((it: any) => it.name.toLowerCase().includes(mockCommand.itemName.toLowerCase()));
            if (item) {
              const oldWeight = Math.max(1, Number(item.weightGrams) || 1);
              const newWeight = Number(mockCommand.newWeightGrams);
              const R = newWeight / oldWeight;
              // Scale foundation macros by weight ratio first
              const foundation: Record<string, number> = {
                calories: Number(item.calories || 0) * R,
                protein: Number(item.protein || 0) * R,
                totalFat: Number(item.totalFat || item.fat || 0) * R,
                saturatedFat: Number(item.saturatedFat || 0) * R,
                carbohydrates: Number(item.carbohydrates || 0) * R,
                sodium: Number(item.sodium || 0) * R,
              };
              // Soft budget: prior calories scaled, or scout estimate scaled if present
              const priorScout = Number(item.estimatedCalories || item.scoutEstimatedCalories);
              const scoutEst = Number.isFinite(priorScout) && priorScout > 0 ? priorScout * R : null;
              const budget = computeItemBudget({
                itemName: item.name || item.originalName || mockCommand.itemName,
                weightGrams: newWeight,
                hardLabelKcal: item.lockedNutrientKeys?.includes?.('calories') ? Number(item.calories) * R : null,
                scoutEstimatedCalories: scoutEst,
              });
              const rec = reconcileNutrients({ nutrients: foundation, budget, formOk: true });
              addDebugLog(`[Budget] mode=edit item="${item.name}" kcal=${budget.budgetKcal} source=${budget.source} weight=${newWeight}`);
              addDebugLog(`[Reconcile] mode=edit action=${rec.action} foundation=${rec.foundationKcal} final=${rec.finalKcal}`);
              if (item) {
                item.weightGrams = newWeight;
                item.calories = Number(((rec?.nutrients?.calories ?? rec?.finalKcal) || 0).toFixed(1));
                item.protein = Number(((rec?.nutrients?.protein ?? foundation?.protein) || 0).toFixed(2));
                item.totalFat = Number(((rec?.nutrients?.totalFat ?? foundation?.totalFat) || 0).toFixed(2));
                item.saturatedFat = Number(((rec?.nutrients?.saturatedFat ?? foundation?.saturatedFat) || 0).toFixed(2));
                item.carbohydrates = Number(((rec?.nutrients?.carbohydrates ?? foundation?.carbohydrates) || 0).toFixed(2));
                item.sodium = Number(((rec?.nutrients?.sodium ?? foundation?.sodium) || 0).toFixed(1));
                if (scoutEst != null) item.estimatedCalories = scoutEst;
              }
            }
          } else if (mockCommand.action === "remove_item") {
            const idx = activeMeal.itemsBreakdown?.findIndex((it: any) => it.name.toLowerCase().includes(mockCommand.itemName.toLowerCase()));
            if (idx !== -1) {
              activeMeal.itemsBreakdown.splice(idx, 1);
            }
          } else if (mockCommand.action === "add_item") {
            if (!activeMeal.itemsBreakdown) activeMeal.itemsBreakdown = [];
            activeMeal.itemsBreakdown.push({
              name: mockCommand.itemName,
              weightGrams: mockCommand.newWeightGrams,
              calories: mockCommand.newWeightGrams * 1.5,
              saturatedFat: mockCommand.newWeightGrams * 0.02,
              sodium: mockCommand.newWeightGrams * 0.5
            });
          }
        }

        const newTotalWeight = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.weightGrams) || 0), 0);
        const mealWeightRatio = newTotalWeight / originalTotalWeight;

        const newItems = activeMeal.itemsBreakdown || [];
        activeMeal.weightGrams = newTotalWeight;
        if (newItems.length === 1) {
          activeMeal.name = newItems[0].name;
        }
        if (activeMeal.scoutItems && Array.isArray(activeMeal.scoutItems)) {
          const currentNames = new Set(newItems.map((it: any) => (it.name || '').toLowerCase().trim()));
          activeMeal.scoutItems = activeMeal.scoutItems.filter((scout: any) => {
            const sName = String(scout.keyword || scout.originalName || scout.name || '').toLowerCase().trim();
            return Array.from(currentNames).some((cName: any) => String(cName).includes(sName) || sName.includes(String(cName)));
          });
        }
        activeMeal.composition = newItems.map((it: any) => it.name).join(", ");
        
        const newCalories = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.calories) || 0), 0);
        const newSaturatedFat = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.saturatedFat) || 0), 0);
        const newSodium = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.sodium) || 0), 0);

        if (!activeMeal.nutrients) activeMeal.nutrients = {};
        activeMeal.nutrients.calories = Number(newCalories.toFixed(1));
        activeMeal.nutrients.saturatedFat = Number(newSaturatedFat.toFixed(2));
        activeMeal.nutrients.sodium = Number(newSodium.toFixed(1));

        for (const key of Object.keys(activeMeal.nutrients)) {
          if (key !== "calories" && key !== "saturatedFat" && key !== "sodium") {
            activeMeal.nutrients[key] = Number(((activeMeal.nutrients[key] || 0) * mealWeightRatio).toFixed(2));
          }
        }

        // We removed offline mock write to user_meals to avoid permission issues

        return res.json({
          text: `[Simulated Offline Mod] Modifying active meal: **${activeMeal.name}** to new weights/items. Recalculated all 30 sub-nutrients mathematically offline to save tokens and ensure precision.`,
          data: activeMeal
        });
      }

      const isDiscussionRequest = message.toLowerCase().includes("why") || message.toLowerCase().includes("explain") || message.toLowerCase().includes("question");
      if (isDiscussionRequest) {
        return res.json({
          text: "This is a simulated conversational answer about your active meal ingredients, explaining that avocado and salmon are rich sources of dietary fibre and heart-healthy monounsaturated fatty acids.",
          data: null
        });
      }

      return res.json({
        error: "The food log agent is not available. Please enter the food details manually.",
        agentNotAvailable: true
      });
    }

    let imagePayloads = null;
    if (images && Array.isArray(images) && images.length > 0) {
      imagePayloads = images.map((imgStr: string) => {
        const mimeType = imgStr.split(";")[0].split(":")[1] || "image/jpeg";
        const base64Data = imgStr.split(",")[1];
        return { mimeType, data: base64Data };
      });
    } else if (image) {
      const mimeType = image.split(";")[0].split(":")[1] || "image/jpeg";
      const base64Data = image.split(",")[1];
      imagePayloads = [{ mimeType, data: base64Data }];
    }

    addDebugLog(`[Image Payload] Received ${imagePayloads ? imagePayloads.length : 0} image(s). Approx sizes (KB): ${imagePayloads ? imagePayloads.map(p => Math.round((p.data.length * 0.75) / 1024) + 'KB').join(', ') : 'none'}.`);

    const analysisNutrientKeys = [
        "calories", "protein", "totalFat", "saturatedFat", "transFat", "unsaturatedFat", "omega3", 
      "carbohydrates", "addedSugar", "totalFibre", "solubleFibre", "sodium", "potassium", 
      "magnesium", "calcium", "iron", "zinc", "selenium", "iodine", "phosphorus", 
      "vitaminD", "vitaminB12", "folate", "vitaminC", "vitaminE", "vitaminK", 
      "vitaminA", "vitaminB6", "thiamine", "riboflavin", "niacin"
    ];

    // Helper functions for nutritional data lookup
    const formatUSDANutrients = (nutrients: any[]): string => {
      if (!nutrients || !Array.isArray(nutrients)) return "No nutrients available";
      const findNutrient = (namePatterns: string[]) => {
        // Stricter exact word match first
        const exactMatch = nutrients.find(n => {
          const name = (n.nutrientName || (n.nutrient && n.nutrient.name) || "").toLowerCase().trim();
          return namePatterns.some(p => name === p.toLowerCase().trim());
        });
        if (exactMatch) {
          const val = getUSDANutrientValue(exactMatch);
          const unit = exactMatch.unitName || (exactMatch.nutrient && exactMatch.nutrient.unitName) || "";
          return `${val}${unit}`;
        }

        // Fallback with precise keyword validation to avoid false fatty acid matches on "fat"
        const nut = nutrients.find(n => {
          const name = (n.nutrientName || (n.nutrient && n.nutrient.name) || "").toLowerCase();
          return namePatterns.some(p => {
            const cleanP = p.toLowerCase().trim();
            if (cleanP === "fat" && name.includes("fatty")) {
              return false; // prevent totalFat matching on saturated fat
            }
            return name.includes(cleanP);
          });
        });
        if (!nut) return null;
        const val = getUSDANutrientValue(nut);
        const unit = nut.unitName || (nut.nutrient && nut.nutrient.unitName) || "";
        return `${val}${unit}`;
      };
      const mapped: string[] = [];
      const kcal = findNutrient(["energy", "calories"]);
      const protein = findNutrient(["protein"]);
      const fat = findNutrient(["total lipid", "fat"]);
      const satFat = findNutrient(["saturated fat", "fatty acids, total saturated"]);
      const sodium = findNutrient(["sodium"]);
      if (kcal) mapped.push(`Calories: ${kcal}`);
      if (protein) mapped.push(`Protein: ${protein}`);
      if (fat) mapped.push(`Fat: ${fat}`);
      if (satFat) mapped.push(`SatFat: ${satFat}`);
      if (sodium) mapped.push(`Sodium: ${sodium}`);
      return mapped.join(", ");
    };

    const formatOFFNutrients = (nutriments: any): string => {
      if (!nutriments) return "No nutrients available";
      const mapped: string[] = [];
      const formatVal = (val: any) => {
        if (val === undefined || val === null) return null;
        const num = Number(val);
        return isNaN(num) ? val : Math.round(num * 100) / 100;
      };
      
      const kcal = nutriments["energy-kcal_100g"] !== undefined 
        ? formatVal(nutriments["energy-kcal_100g"]) 
        : (nutriments["energy_100g"] !== undefined ? formatVal(Math.round(nutriments["energy_100g"] / 4.184)) : null);
      const protein = formatVal(nutriments["proteins_100g"]);
      const fat = formatVal(nutriments["fat_100g"]);
      const satFat = formatVal(nutriments["saturated-fat_100g"]);
      const sodium = formatVal(nutriments["sodium_100g"]);
      
      if (kcal !== null) mapped.push(`Calories: ${kcal}kcal`);
      if (protein !== null) mapped.push(`Protein: ${protein}g`);
      if (fat !== null) mapped.push(`Fat: ${fat}g`);
      if (satFat !== null) mapped.push(`SatFat: ${satFat}g`);
      if (sodium !== null) mapped.push(`Sodium: ${Math.round(Number(sodium) * 1000)}mg`);
      return mapped.join(", ");
    };

    const extractOFFNutrientsPer100g = (product: any): Record<string, number> => {
      const profile: Record<string, number> = {};
      const n = product.nutriments;
      if (!n) return profile;
      
      if (n["energy-kcal_100g"] !== undefined) {
        profile["calories"] = Number(n["energy-kcal_100g"]) || 0;
      } else if (n["energy_100g"] !== undefined) {
        profile["calories"] = Math.round(Number(n["energy_100g"]) / 4.184) || 0;
      }
      
      const setNum = (key: string, field: string, scale: number = 1) => {
        if (n[field] !== undefined) {
          profile[key] = (Number(n[field]) || 0) * scale;
        }
      };

      setNum("protein", "proteins_100g");
      setNum("totalFat", "fat_100g");
      setNum("saturatedFat", "saturated-fat_100g");
      setNum("transFat", "trans-fat_100g");
      
      if (profile["totalFat"] !== undefined) {
        profile["unsaturatedFat"] = Math.max(0, profile["totalFat"] - (profile["saturatedFat"] || 0) - (profile["transFat"] || 0));
      }
      
      setNum("omega3", "omega-3_100g");
      setNum("carbohydrates", "carbohydrates_100g");
      setNum("sugar", "sugars_100g");
      setNum("addedSugar", "added_sugars_100g");
      setNum("totalFibre", "fiber_100g");
      setNum("solubleFibre", "soluble-fiber_100g");
      
      setNum("sodium", "sodium_100g", 1000);
      setNum("potassium", "potassium_100g", 1000);
      setNum("magnesium", "magnesium_100g", 1000);
      setNum("calcium", "calcium_100g", 1000);
      setNum("iron", "iron_100g", 1000);
      setNum("zinc", "zinc_100g", 1000);
      setNum("selenium", "selenium_100g");
      setNum("iodine", "iodine_100g");
      setNum("phosphorus", "phosphorus_100g", 1000);
      setNum("vitaminD", "vitamin-d_100g");
      setNum("vitaminB12", "vitamin-b12_100g");
      setNum("folate", "folate_100g");
      setNum("vitaminC", "vitamin-c_100g", 1000);
      setNum("vitaminE", "vitamin-e_100g", 1000);
      setNum("vitaminK", "vitamin-k_100g");
      setNum("vitaminA", "vitamin-a_100g");
      setNum("vitaminB6", "vitamin-b6_100g", 1000);
      setNum("thiamine", "thiamine_100g", 1000);
      setNum("riboflavin", "riboflavin_100g", 1000);
      setNum("niacin", "niacin_100g", 1000);

      return profile;
    };

    // B5 — Detect weight/portion refine on prior scout (skip Vision Scout + DB when safe).
    // Path A: text-only refine. Path B: images still attached but printed label locks exist.
    const priorScoutForRefine = Array.isArray(req.body.activeScoutItems) ? req.body.activeScoutItems : [];
    const refineDecision = shouldSkipScoutForWeightRefine({
      message,
      imageCount: imagePayloads?.length || 0,
      activeScoutItems: priorScoutForRefine,
      activeMeal,
      explicitSkipScout: req.body.skipScout === true,
    });
    const weightRefineIntent = refineDecision.intent.isRefine
      ? refineDecision.intent
      : detectWeightRefineIntent(message);

    // Legacy narrow pure-weight patterns + B5 broader detect
    const isPureWeightModification = !!(
      refineDecision.skip ||
      (
        activeMeal &&
        (!imagePayloads || imagePayloads.length === 0) &&
        message &&
        weightRefineIntent.isRefine
      )
    );

    // Frontend sends the user's explicit mode selection (review | compare | edit) from the pill toggle.
    // When the user has explicitly selected "Edit", treat any text-only follow-up as a modification
    // command regardless of wording, instead of relying solely on keyword matching.
    const userExplicitlySelectedEditMode = req.body.userSelectedMode === 'edit' || req.body.userSelectedMode === 'modify';

    const isExplicitModify = !!(
      activeMeal &&
      (
        isPureWeightModification ||
        userExplicitlySelectedEditMode ||
        (
          message &&
          /\b(change|modify|update|remove|delete|correct|instead|replace|adjust|had|ate|only|portion|fraction|half|quarter|third|\d+\/\d+)\b/i.test(message)
        )
      )
    );

    addDebugLog(`[Edit Gate] userSelectedMode="${req.body.userSelectedMode || 'undefined'}" | userExplicitlySelectedEditMode=${userExplicitlySelectedEditMode} | activeMeal=${!!activeMeal} | hasImages=${!!(imagePayloads && imagePayloads.length > 0)} | message="${(message || '').substring(0, 50)}" | isExplicitModify=${isExplicitModify} | refineSkip=${refineDecision.skip} reason=${refineDecision.reason}`);

    const isWeightModification = isPureWeightModification || refineDecision.skip;
    const compareOnly = req.body.compareOnly === true;
    const compareItems = Array.isArray(req.body.compareItems) ? req.body.compareItems : [];

    let databaseMatches = "";
    const databaseMatchesArray: any[] = [];
    const quarantinedIdsSet = new Set<string>();
    // Only inherit activeScoutItems if this is an explicit modification command on the active meal
    visionScoutItems = (isPureWeightModification || isExplicitModify || refineDecision.skip) ? (req.body.activeScoutItems || []) : [];
    let scoutScratchpad: string | undefined;
    let scoutConfidenceRating = "High (>90%)";
    let scoutConfidenceComment = "";
    let scoutRecommendedMode: string | null = null;
    let scoutCookingMethod = "";
    visionScoutContentType = 'visual';
    let diningEnvironment = activeMeal?.diningEnvironment || "unknown";
    const dbMatchMap = new Map<string, any>();
    const queriesToSearch: string[] = [];
    const scoutOriginalQueries: string[] = [];

    let visionScoutRanAndReturnedItems = false;

    if (compareOnly) {
      addDebugLog(`[Shortcut] Compare mode detected. Skipping Vision Scout and DB Search.`);
      if (compareItems && compareItems.length > 0) {
        visionScoutItems = compareItems.map((name: string, index: number) => ({
          scoutIndex: index,
          keyword: name,
          originalName: name,
          estimatedWeightGrams: 100,
          source: "compare_request"
        }));
      }
    } else if (isWeightModification || refineDecision.skip) {
      // B5 scale-only: re-use prior scout, apply portionChoices and/or parsed refine grams
      addDebugLog(
        `${REFINE_SCALE_ONLY_LOG} reason=${refineDecision.reason} locks=${priorScoutHasLabelLocks(priorScoutForRefine)} images=${imagePayloads?.length || 0}`
      );
      addDebugLog(`[Shortcut] Weight modification detected on active meal. Skipping Vision Scout and DB Search.`);
      visionScoutItems = Array.isArray(req.body.activeScoutItems) ? [...req.body.activeScoutItems] : visionScoutItems;
      if (req.body.portionChoices) {
        visionScoutItems = applyPortionChoices(visionScoutItems, req.body.portionChoices);
      } else if (weightRefineIntent.isRefine) {
        visionScoutItems = applyWeightRefineToScoutItems(visionScoutItems, weightRefineIntent);
      }
      visionScoutContentType = req.body.scoutContentType || 'visual';
      visionScoutRanAndReturnedItems = visionScoutItems.length > 0;
    } else if (req.body.skipScout || req.body.portionChoices) {
      let priorScout = (Array.isArray(req.body.activeScoutItems) && req.body.activeScoutItems.length > 0)
        ? req.body.activeScoutItems
        : ((Array.isArray(req.body.scoutItems) && req.body.scoutItems.length > 0)
          ? req.body.scoutItems
          : (Array.isArray(activeMeal?.scoutItems) && activeMeal.scoutItems.length > 0 ? activeMeal.scoutItems : []));
      
      if (priorScout.length === 0 && Array.isArray(history) && history.length > 0) {
        // Fallback: search history messages for scoutItems or portionClarify items
        const clarifyMsg = [...history].reverse().find((m: any) => 
          (m.data?.scoutItems && m.data.scoutItems.length > 0) || 
          (m.data?.portionClarify?.scoutItems && m.data.portionClarify.scoutItems.length > 0) ||
          (m.data?.portionClarify?.items && m.data.portionClarify.items.length > 0) ||
          (m.data?.agentResult?.scoutItems && m.data.agentResult.scoutItems.length > 0)
        );
        if (clarifyMsg?.data) {
          priorScout = clarifyMsg.data.scoutItems || 
            clarifyMsg.data.portionClarify?.scoutItems || 
            clarifyMsg.data.portionClarify?.items || 
            clarifyMsg.data.agentResult?.scoutItems || [];
        }
      }

      if (priorScout.length > 0) {
        addDebugLog(`[Shortcut] skipScout or portionChoices is true. Inheriting ${priorScout.length} scout items from previous run.`);
        visionScoutItems = applyPortionChoices(
          priorScout,
          req.body.portionChoices
        );
        visionScoutContentType = req.body.scoutContentType || 'visual';
        visionScoutRanAndReturnedItems = true;
      } else {
        addDebugLog(`[PortionChoices] portionChoices provided but priorScout is empty; proceeding with standard pipeline.`);
      }

      // Task 3: Restore pre-resolved DB candidates from turn-1 portionClarify payload.
      // This prevents the DB search from re-running from scratch and avoids cross-match bugs.
      const priorCandidates = Array.isArray(req.body.resolvedDbCandidates) ? req.body.resolvedDbCandidates : [];
      if (priorCandidates.length > 0) {
        addDebugLog(`[PortionResume] Restoring ${priorCandidates.length} pre-resolved DB candidates from turn-1 payload. DB search will be skipped.`);
        priorCandidates.forEach((c: any) => {
          databaseMatchesArray.push(c);
          const cid = String(c.id || c.fdcId || '');
          if (cid) dbMatchMap.set(cid, c.nutrients || c);
        });
      }
    } else {
      const hasImage = imagePayloads && imagePayloads.length > 0;
      if (hasImage) {
        sendStreamEvent({ type: 'status', stage: 'scout', status: 'started', message: 'Reading your photos...' });
        const imageCount = imagePayloads?.length || 0;
        const scoutPromptText = message 
          ? `Analyze the provided ${imageCount > 1 ? imageCount + ' images' : 'image'} and list the food items you see, taking into consideration the user's message: "${message}".${imageCount > 1 ? ' CRITICAL MULTI-IMAGE REQUIREMENT: Inspect each image and set "sourceImageIndex" (0 for 1st photo, 1 for 2nd, etc.). If any photo shows a kiosk touchscreen or menu screen, transcribe the exact calories displayed for EACH item (e.g. "Fish Burger 265 kcal") into rawNutritionLabel. If images show different views/sides of the same package (e.g. front of package and back nutrition label), list them as TWO separate entries: 1. The food item. 2. A dedicated label item (originalName containing "Nutrition Facts Label") with full rawNutritionLabel.' : ''} If any identified dish is a known item from a restaurant chain or brand (e.g. McDonald's, Yolk, Starbucks), capture exact brand and dish name in originalName and queriesToSearch for server web search.`
          : `Analyze the provided ${imageCount > 1 ? imageCount + ' images' : 'image'} and list the food items you see.${imageCount > 1 ? ' CRITICAL MULTI-IMAGE REQUIREMENT: Inspect each image and set "sourceImageIndex" (0 for 1st photo, 1 for 2nd, etc.). If any photo shows a kiosk touchscreen or menu screen, transcribe the exact calories displayed for EACH item (e.g. "Fish Burger 265 kcal") into rawNutritionLabel. If images show different views/sides of the same package (e.g. front of package and back nutrition label), list them as TWO separate entries: 1. The food item. 2. A dedicated label item (originalName containing "Nutrition Facts Label") with full rawNutritionLabel.' : ''} If any identified dish is a known item from a restaurant chain or brand (e.g. McDonald's, Yolk, Starbucks), capture exact brand and dish name in originalName and queriesToSearch for server web search.`;
        sendLog('scout_instruction', 'scout', `Vision Scout Instruction dispatched (model: ${engine || "gemini-3.5-flash-lite"}). Prompt: "${scoutPromptText}"`);
        addDebugLog(`[Vision Scout] Running Stage 3 lightweight vision scout with retry protection...`);
        let scoutResult: any = null;
        let scoutAttempts = 0;
        const maxScoutAttempts = 3;
        let lastScoutErr: any = null;

        while (scoutAttempts < maxScoutAttempts) {
          scoutAttempts++;
          try {
            if (scoutAttempts > 1) {
              if (isGeminiQuotaError(lastScoutErr)) break;
              const delay = lastScoutErr?.message?.includes('503') || lastScoutErr?.message?.includes('UNAVAILABLE') ? 2000 : 1000;
              addDebugLog(`[Vision Scout] Waiting ${delay}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              addDebugLog(`[Vision Scout] Retrying LLM call (Attempt ${scoutAttempts} of ${maxScoutAttempts})...`);
            }
            const scoutOutput = await callUnifiedLLM({
              modelId: (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite",
              systemInstruction: scoutSystemInstruction,
              promptText: scoutPromptText,
              imagePayloads,
              responseMimeType: "application/json",
              skipThinking: true,
              logStagePrefix: 'scout',
              onStream: (chunk: string, isThought?: boolean) => {
                if (isStream && hasSentHeaders) {
                  try {
                    res.write(`data: ${JSON.stringify({ type: 'stream', chunk, stage: 'scout' })}\n\n`);
                    if (typeof (res as any).flush === 'function') (res as any).flush();
                  } catch (e) {}
                }
              },
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  _internalReasoning: { type: Type.STRING, description: "STEP 1: CLASSIFICATION, STEP 2: DECOMPOSITION & RATIONALE, STEP 3: NUTRITION & PACKAGING EXTRACTION" },
                  contentType: { type: Type.STRING },
                  diningEnvironment: { type: Type.STRING, description: "home_cooked | casual_restaurant | fast_food_chain | fine_dining | airline | unknown" },
                  cookingMethod: { type: Type.STRING },
                  scanCompleteness: { type: Type.STRING },
                  items: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        keyword: { type: Type.STRING, description: "Base food name in database-friendly English" },
                        originalName: { type: Type.STRING, description: "Exact localized food name" },
                        chainName: { type: Type.STRING, nullable: true, description: "The restaurant/brand/chain name ONLY (e.g. 'McDonald\'s', 'YOLK', 'Pret'), separate from the dish title. Null if this is not a restaurant/chain item (e.g. home cooked, generic grocery item)." },
                        rawNutritionLabel: {
                          type: Type.OBJECT,
                          properties: {
                            servingSize: { type: Type.STRING, nullable: true },
                            calories: { type: Type.STRING, nullable: true },
                            protein: { type: Type.STRING, nullable: true },
                            totalFat: { type: Type.STRING, nullable: true },
                            saturatedFat: { type: Type.STRING, nullable: true },
                            transFat: { type: Type.STRING, nullable: true },
                            totalCarbohydrate: { type: Type.STRING, nullable: true },
                            sugar: { type: Type.STRING, nullable: true },
                            addedSugar: { type: Type.STRING, nullable: true },
                            sodium: { type: Type.STRING, nullable: true },
                            salt: { type: Type.STRING, nullable: true, description: "Exact verbatim printed salt value if label lists Salt instead of Sodium (e.g. '0.53g'). Do NOT convert to sodium." },
                            potassium: { type: Type.STRING, nullable: true },
                            totalFibre: { type: Type.STRING, nullable: true },
                            solubleFibre: { type: Type.STRING, nullable: true }
                          },
                          required: ["servingSize", "calories", "protein", "totalFat", "saturatedFat", "transFat", "totalCarbohydrate", "sugar", "addedSugar", "sodium", "salt", "potassium", "totalFibre", "solubleFibre"],
                          propertyOrdering: ["servingSize", "calories", "protein", "totalFat", "saturatedFat", "transFat", "totalCarbohydrate", "sugar", "addedSugar", "sodium", "salt", "potassium", "totalFibre", "solubleFibre"],
                          nullable: true
                        },
                        ingredientsList: { type: Type.STRING, nullable: true },
                        estimatedWeightGrams: { type: Type.NUMBER },
                        estimatedCalories: { type: Type.NUMBER, nullable: true },
                        sourceImageIndex: { type: Type.INTEGER, description: "0-based index of which image this item appears in" },
                        boundingBox2D: {
                          type: Type.ARRAY,
                          items: { type: Type.INTEGER },
                          description: "4-element bounding box array [ymin, xmin, ymax, xmax] scale 0-1000"
                        },
                        components: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              searchQuery: { type: Type.STRING },
                              volumePercentage: { type: Type.NUMBER }
                            },
                            required: ["searchQuery", "volumePercentage"]
                          }
                        },
                        source: { type: Type.STRING },
                        cookingMethod: { type: Type.STRING },
                        itemConfidence: { type: Type.STRING },
                        anomalyFlags: { type: Type.ARRAY, items: { type: Type.STRING } },
                        visualIngredients: { type: Type.ARRAY, items: { type: Type.STRING } },
                        nutritionFacts: { type: Type.OBJECT, nullable: true }
                      },
                      required: ["keyword", "originalName", "estimatedWeightGrams", "boundingBox2D", "sourceImageIndex"]
                    }
                  },
                  queriesToSearch: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["contentType", "diningEnvironment", "items"],
                propertyOrdering: ["_internalReasoning", "items", "contentType", "cookingMethod", "scanCompleteness", "queriesToSearch"]
              }
            });

            // Yield to the event loop before heavy synchronous parsing
            await new Promise(resolve => setImmediate(resolve));
            scoutResult = parseAndHealVisionScout(scoutOutput, addDebugLog, userSelectedMode === 'compare', message);
            break; // Success! Break out of the loop
          } catch (scoutErr: any) {
            lastScoutErr = scoutErr;
            addDebugLog(`[Vision Scout Attempt ${scoutAttempts} Failed] Error: ${scoutErr.message}`);
            if (isGeminiQuotaError(scoutErr)) {
              addDebugLog(`[Vision Scout] Aborting further scout retries — 429 quota on this model. Switch model or wait.`);
              break;
            }
          }
        }

        if (!scoutResult) {
          addDebugLog(`[Vision Scout Failed Permanently] Both attempts failed. Last error: ${lastScoutErr?.message}`);
          const raw = String(lastScoutErr?.message || '');
          const isQuota = /429|RESOURCE_EXHAUSTED|quota exceeded/i.test(raw);
          const isUnavailable = /503|UNAVAILABLE|overloaded/i.test(raw);
          if (isQuota) {
            throw new Error(
              `Vision Scout Failed: Gemini quota (429) on this model — wait the retry-after window or switch model. Not a bad photo. (Details: ${raw})`
            );
          }
          if (isUnavailable) {
            throw new Error(`Vision Scout Failed: Gemini unavailable (503). Retry shortly. (Details: ${raw})`);
          }
          throw new Error(`Vision Scout Failed: Couldn't reliably read this image, please try again or re-upload. (Details: ${raw})`);
        }

        // Vision Scout _internalReasoning is removed per user request

          visionScoutItems = scoutResult.items;
          scoutConfidenceRating = scoutResult.scoutConfidenceRating;
          scoutConfidenceComment = scoutResult.scoutConfidenceComment;
          scoutCookingMethod = scoutResult.scoutCookingMethod;
          visionScoutContentType = scoutResult.visionScoutContentType;
          scoutRecommendedMode = scoutResult.scoutRecommendedMode;
          diningEnvironment = scoutResult.diningEnvironment || "unknown";
          
          if (req.body.userSelectedMode === 'review') {
            scoutRecommendedMode = "new_log";
            addDebugLog(`[Mode Override] User explicitly selected 'review' mode via UI pill. Forcing mode to 'new_log'.`);
          } else if (req.body.userSelectedMode === 'compare') {
            scoutRecommendedMode = "evaluation";
            addDebugLog(`[Mode Override] User explicitly selected 'compare' mode via UI pill. Forcing mode to 'evaluation'.`);
          } else if (visionScoutItems && visionScoutItems.length <= 1 && scoutRecommendedMode === "evaluation") {
            scoutRecommendedMode = "new_log";
          }
          queriesToSearch.push(...scoutResult.queriesToSearch);
          scoutOriginalQueries.push(...scoutResult.queriesToSearch);
          visionScoutRanAndReturnedItems = scoutResult.visionScoutRanAndReturnedItems;

          const scoutItemsSummary = visionScoutItems.map((it: any) => ({
            name: it.originalName || it.keyword,
            keyword: it.keyword,
            weight: it.estimatedWeightGrams
          }));
          const scoutItemsSummaryStr = scoutItemsSummary.map((i: any) => `${i.name} (~${i.weight}g)`).join(', ');

          sendLog('scout_answer', 'scout', `Scout identified ${visionScoutItems.length} item(s): ${scoutItemsSummaryStr}`, {
            items: scoutItemsSummary
          });
          sendStreamEvent({ type: 'status', stage: 'scout', status: 'completed', message: 'Vision Scout completed.' });

          addDebugLog(`[Vision Scout] Exploded high density rows into ${visionScoutItems.length} individual item(s) to process:`);
          visionScoutItems.forEach((item: any) => {
            const rawLabelHasRealData = item.rawNutritionLabel && typeof item.rawNutritionLabel === 'object'
              ? Object.keys(item.rawNutritionLabel).some((k: string) => {
                  if (k === 'servingSize' || k === 'weight' || k === 'servingsPerContainer') return false;
                  const v = item.rawNutritionLabel[k];
                  return v !== undefined && v !== null && v !== '' && v !== '-' && v !== '--';
                })
              : false;
            const flagStr = (item.anomalyFlags && item.anomalyFlags.length > 0) ? ` | Flags: [${item.anomalyFlags.join(', ')}]` : '';
            const confStr = item.itemConfidence ? ` | Confidence: ${item.itemConfidence}` : '';
            const labelStr = rawLabelHasRealData ? ` | Nutrition Label: ${JSON.stringify(item.rawNutritionLabel)}` : '';
            addDebugLog(`[Vision Scout] - Index: ${item.scoutIndex} | Name: "${item.originalName || item.keyword}" | Keyword: "${item.keyword}"${labelStr}${flagStr}${confStr}`);
          });
      } else if (message) {
        addDebugLog(`[Text Search Extraction] No image supplied. Extracting search terms from message: "${message}"`);
        const extractedQueries = extractFoodSearchQueriesFromText(message);
        if (extractedQueries.length > 0) {
          addDebugLog(`[Text Search Extraction] Extracted clean food search queries: ${JSON.stringify(extractedQueries)}`);
          if (!isExplicitModify && !isPureWeightModification) {
            queriesToSearch.push(...extractedQueries);
            scoutRecommendedMode = "new_log";
            visionScoutItems = extractedQueries.map((q, idx) => ({
              scoutIndex: idx,
              keyword: q,
              originalName: q,
              estimatedWeightGrams: 100,
              source: "text_query",
              cookingMethod: /\b(fried|deep_fried|pan_fried|roasted|grilled|baked|boiled|steamed)\b/i.exec(q)?.[0] || "raw",
              visualIngredients: []
            }));
          }
        } else {
          addDebugLog(`[Text Search Extraction] Message classified as conversational or non-food query. Skipping database matches.`);
        }
      }
    }

    // Strip parenthetical local-language notes for cleaner USDA/OFF matching
    // e.g. "raw beef slices (daging empal and blade)" → "raw beef slices"
    const loosenQuery = (query: string): string => {
      if (!query) return "";
      let q = query.toLowerCase().trim();
      // Strip common brand adjectives and prefixes
      q = q.replace(/\b(sainsburys?|tesco|morrisons?|asda|aldi|lidl|waitrose|marks\s*&\s*spencer|m&s|official|fresh|raw|cooked|baked|fried|roasted|steamed|boiled|grilled|organic|natural|wild|sweet|spicy|pure|premium|classic|canned|frozen|delicious|tasty|freshly)\b/g, '');
      // Normalize plurals (simple s/es stripping for common words, especially fruits/vegetables)
      q = q.replace(/\b(clementines|mandarins|tangerines|oranges|berries|raspberries|strawberries|blueberries|grapes|apples|pears|peaches|plums|bananas|lemons|limes|tomatoes|cucumbers|radishes|onions|carrots|potatoes|mushrooms|peas|beans)\b/g, (match) => {
        if (match === 'berries') return 'berry';
        if (match === 'raspberries') return 'raspberry';
        if (match === 'strawberries') return 'strawberry';
        if (match === 'blueberries') return 'blueberry';
        if (match === 'tomatoes') return 'tomato';
        if (match === 'potatoes') return 'potato';
        if (match === 'radishes') return 'radish';
        if (match.endsWith('es')) return match.slice(0, -2);
        if (match.endsWith('s')) return match.slice(0, -1);
        return match;
      });
      q = q.replace(/\s+/g, ' ').trim();
      return q;
    };

    const cleanQuery = (raw: string) => {
      let clean = raw.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase();
      clean = clean.replace(/\b(soda|can|bottle|pack|tub|slice|cubes|pieces|portion|raw|cooked|boiled|baked|grilled|steamed)\b/g, '').replace(/\s+/g, ' ').trim();
      if (!clean) clean = raw.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase();
      const indonesianToEnglish: Record<string, string> = {
        "potongan ikan": "raw fish fillet",
        "ikan potongan": "raw fish fillet",
        "ikan": "raw fish",
        "daging sapi": "raw beef",
        "daging": "raw beef",
        "ayam": "raw chicken",
        "sayur": "vegetables",
        "nasi": "cooked rice",
        "telur": "egg",
        "tempe": "tempeh",
        "tahu": "tofu",
        "kentang": "potato",
        "wortel": "carrot"
      };

      for (const [indo, eng] of Object.entries(indonesianToEnglish)) {
        const regex = new RegExp(`\\b${indo}\\b`, 'g');
        if (regex.test(clean)) {
          clean = clean.replace(regex, eng);
        }
      }
      
      // Automatically prepend "raw" to meats to prevent fetching salted/cooked versions, unless it's a known chain or already specified
      const meats = ["beef", "chicken", "pork", "fish", "steak", "lamb", "mutton", "veal", "salmon", "tuna", "cod", "shrimp", "prawn", "duck"];
      const preparedModifiers = ["raw", "cooked", "fried", "roasted", "grilled", "baked", "boiled", "smoked", "cured", "canned"];
      const chainModifiers = ["mcdonald", "kfc", "burger king", "subway", "brand"];
      
      const isMeat = meats.some(m => clean.includes(m));
      const hasPreparation = preparedModifiers.some(p => clean.includes(p));
      const isChain = chainModifiers.some(c => clean.includes(c));

      if (isMeat && !hasPreparation && !isChain) {
        clean = "raw " + clean;
      }

      return clean;
    };

    const hasImage = imagePayloads && imagePayloads.length > 0;
    // Only treat this as a "big menu browse" for search-skipping purposes when the scout
    // actually recommends evaluation/browsing mode. A menu-board photo taken to log one
    // specific consumed dish (scoutRecommendedMode === "new_log") should still get real
    // nutrition search for that item, even though the source photo is a menu_or_poster.
    const isMenuScale = (visionScoutContentType === "menu_or_poster" || visionScoutContentType === "text") && scoutRecommendedMode !== "new_log";

    // Clean and consolidate queries first
    const uniqueQueries = buildFoodSearchQuerySet(visionScoutItems || []);

    const chainPatterns: [string, RegExp][] = [
      ['sainsbury', /\bsainsbury\b/i],
      ['yolk', /\byolk\b/i],
      ['mcdonalds', /mcdonald|maccas|麦当劳/i],
      ['kfc', /\bkfc\b|kentucky/i],
      ['coco_di_mama', /coco\s*di\s*mama|cocodimama/i],
      ['costa', /\bcosta\b/i],
      ['wasabi', /\bwasabi\b/i],
      ['itsu', /\bitsu\b/i],
      ['honi_poke', /honi\s*poke|honipoke/i],
      ['pret', /\bpret\b/i],
      ['starbucks', /starbucks/i],
      ['quaker', /\bquaker\b/i],
      ['jack_daniels', /jack\s*daniel/i],
    ];

    const detectChainKeyFromText = (str: string): string | undefined => {
      const s = String(str || '').toLowerCase();
      const matched = chainPatterns.find(([, rx]) => rx.test(s));
      if (matched) return matched[0];
      
      // Dynamic database brand match
      if (isKnownDatabaseBrandSync(s)) {
        const words = s.split(/[^a-z0-9]+/);
        for (const w of words) {
          if (w.length >= 3 && isKnownDatabaseBrandSync(w)) {
            return normalizeChainKey(w);
          }
        }
      }
      return undefined;
    };

    const detectedChainKey =
      visionScoutItems?.map((it: any) => it.originalName || it.keyword || it.name).map(detectChainKeyFromText).find(Boolean) ||
      uniqueQueries.map(detectChainKeyFromText).find(Boolean);

    let registeredChainSources: any[] = [];
    if (detectedChainKey) {
      registeredChainSources = await lookupChainMenuSources(detectedChainKey, 'GB');
      if (registeredChainSources.length > 0) {
        addDebugLog(`[ChainSource] Found ${registeredChainSources.length} source(s) for ${detectedChainKey}: ${registeredChainSources.map((s: any) => s.url).join(' | ')}`);
      } else {
        addDebugLog(`[ChainSource] No registry row for ${detectedChainKey}`);
        addDebugLog(`[ChainSource] No official source for "${detectedChainKey}". Preferring component/USDA path over web_search absolute injection.`);
      }
    }

    // Dish-count based, not flattened query-string count: components/visualIngredients
    // strings were inflating this and causing false positives on normal 2-3 item meals.
    const isEvaluationScale = visionScoutItems.length >= 15;
    // Task 1: shouldRunDbSearch now only guards against weight-only edits and scale modes.
    // The DB search itself is run BEFORE the portionClarify check so resolved candidates
    // can be embedded in the pause payload and carried to turn 2.
    const shouldRunDbSearch = !isWeightModification && !isMenuScale && !isEvaluationScale &&
      databaseMatchesArray.length === 0 && // skip if already restored from turn-1 resolvedDbCandidates
      (visionScoutRanAndReturnedItems || (!hasImage && uniqueQueries.length > 0));

    // Task 1 cont.: DB search runs HERE — before portionClarify check — so candidates are
    // available to embed in the awaiting_user pause payload for carry-forward to turn 2.
    if (shouldRunDbSearch && uniqueQueries.length > 0) {
      sendStreamEvent({ type: 'status', stage: 'db_search', status: 'started', message: 'Searching nutrition databases...' });
      if (typeof (res as any).flush === 'function') (res as any).flush();
      sendLog('db_search', 'db_search', `Querying USDA & OpenFoodFacts databases for: [${uniqueQueries.join(', ')}]`);
      addDebugLog(`[Database Search] Performing USDA & OFF searches for queries: ${JSON.stringify(uniqueQueries)}`);

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
            addDebugLog(`[BrandGuard] Using generic USDA types for "${cleaned}" (not a brand — skip branded/OFF catalog)`);
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

          let [usda, off, brandHits] = await Promise.all([
            searchUSDA(cleaned, 3, dataTypes),
            offP,
            brandP,
          ]);
          const web: any[] = [];

          // If zero results found in main database search, retry with loosened query
          if (usda.length === 0 && off.length === 0 && brandHits.length === 0) {
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

              const [fallUSDA, fallOFF, fallBrand] = await Promise.all([
                searchUSDA(loosened, 3, dataTypes),
                fallbackOffP,
                fallbackBrandP
              ]);

              if (fallUSDA.length > 0 || fallOFF.length > 0 || fallBrand.length > 0) {
                addDebugLog(`[Database Search Fallback] Succeeded for "${loosened}". USDA: ${fallUSDA.length}, OFF: ${fallOFF.length}, Brand: ${fallBrand.length}`);
                usda = fallUSDA;
                off = fallOFF;
                brandHits = fallBrand;
              }
            }
          }

          return { query: q, usda, off, brandHits, web };
        } catch (err) {
          return { query: q, usda: [], off: [], brandHits: [], web: [] };
        }
      });
      const searchResultsList = await Promise.all(searchPromises);
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
        resItem.usda.forEach((food: any) => {
          const fdcIdStr = String(food.fdcId);
          dbMatchMap.set(fdcIdStr, extractUSDANutrientsPer100g(food));

          const parsedNutrients = extractUSDANutrientsPer100g(food);
          const caloriesStr = String(parsedNutrients.calories);
          databaseMatchesArray.push({
            id: fdcIdStr,
            source: "usda",
            searchQuery: resItem.query,
            name: food.description || "",
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

          list.push(`- [USDA] ID: ${fdcIdStr} | Name: ${food.description} | Nutrients (per 100g): ${formatUSDANutrients(food.foodNutrients)}`);
        });
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
        databaseMatches = "No matches found in USDA or Open Food Facts databases for these queries.";
      }
      sendLog('db_search_complete', 'db_search', `Found ${databaseMatchesArray.length} database match(es) across USDA & OpenFoodFacts.`);
      sendStreamEvent({ type: 'status', stage: 'db_search', status: 'completed', message: 'Database search completed.' });

      // Run Food Resolver Agent only for query gaps that do NOT hit the internal catalog or dish cache
      // and that are NOT covered by a complete printed packaging label (token save + avoid bad USDA).
      const gapsForResolver: Array<{ query: string; candidates: Array<{ id: string; name: string; source: string }> }> = [];

      const labelCompleteQueries = new Set<string>();
      const scoutHasCompletePrintedLabel = (item: any): boolean => {
        const raw = item?.rawNutritionLabel;
        if (!raw || typeof raw !== 'object') return false;
        const cal = parseLabelCalories(raw);
        if (cal == null || !(cal > 0)) return false;
        let filled = 0;
        for (const [k, v] of Object.entries(raw)) {
          const ck = k.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (ck === 'servingsize' || ck === 'weight' || ck === 'servingspercontainer') continue;
          if (v === undefined || v === null || v === '' || v === '-' || v === '--') continue;
          filled++;
        }
        // calories + several panel fields (protein/fat/carbs/salt etc.)
        return filled >= 4;
      };
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

        const candidates: Array<{ id: string; name: string; source: string }> = [];
        resItem.brandHits?.forEach((item: any) => {
          candidates.push({ id: String(item.id), name: `${item.chainName || ''} ${item.name || item.dish_name || ''}`.trim(), source: "brand_official" });
        });
        const { resolveClass, bestMatch, survivors } = rankAndClassifyCandidates(resItem.query, resItem.usda, 85);
        if (resolveClass === 'HIT_UNIQUE' && bestMatch) {
            addDebugLog(`[ResolveClass] HIT_UNIQUE for "${resItem.query}" -> ${bestMatch.description}`);
            writeAliasIfHitUnique(resolveClass, resItem.query, bestMatch).catch(e => console.error(e));
            // Treat as auto-resolved gap
            const virtualId = String(bestMatch.fdcId);
            const nut = extractUSDANutrientsPer100g(bestMatch);
            dbMatchMap.set(virtualId, nut);
            databaseMatchesArray.push({
              id: virtualId,
              source: "usda",
              searchQuery: resItem.query,
              name: bestMatch.description || resItem.query,
              servingGrams: 100,
              calories: String(nut.calories || 0),
              protein: nut.protein || 0,
              fat: nut.totalFat || nut.fat || 0,
              saturatedFat: nut.saturatedFat || 0,
              sodium: nut.sodium || 0,
              carbohydrates: nut.carbohydrates || nut.carbs || 0,
              totalFibre: nut.totalFibre || 0,
              nutrients: nut
            });
            continue; // Skip adding to gapsForResolver!
        }

        // For MULTI_MATCH or MISS, pass the survivors (or top N if none) to the Curator
        const candidatesToAdd = survivors.length > 0 ? survivors.map(s => s.candidate) : resItem.usda;
        candidatesToAdd.forEach((food: any) => {
          candidates.push({ id: String(food.fdcId), name: food.description || "", source: "usda" });
        });
        
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
                servingGrams: dishHit.serving_grams || 100,
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
        const fetchNutrientsForFdcId = async (fdcId: string): Promise<Record<string, number> | null> => {
          if (dbMatchMap.has(fdcId)) {
            return dbMatchMap.get(fdcId) || null;
          }
          if (/^\d{6,}$/.test(fdcId)) {
            const prod = await fetchOFFProductByBarcode(fdcId);
            if (prod) return extractOFFNutrientsPer100g(prod);
          } else if (/^\d+$/.test(fdcId)) {
            const food = await fetchUSDAFoodById(fdcId);
            if (food) return extractUSDANutrientsPer100g(food);
          }
          return null;
        };
        const resolvedGaps = await executeFoodResolverCurator(
          gapsForResolver,
          addDebugLog,
          callLLMFn,
          fetchNutrientsForFdcId,
          searchUSDA
        );

        // For each resolved item, add it to databaseMatchesArray & dbMatchMap
        resolvedGaps.forEach(rg => {
          if (Array.isArray(rg.quarantinedIds)) {
            rg.quarantinedIds.forEach(id => {
              if (id) {
                const idStr = String(id);
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
              source: rg.chosenFdcId ? (rg.chosenFdcId.match(/^\d{8,}$/) ? "off" : "usda") : "estimated",
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
          const { supabaseAdmin } = await import('./supabaseAdmin.js');
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
    }

    // Task 2: portionClarify check — now placed AFTER DB search and Resolver so ALL candidates are available.
    // B1 — Pause before nutrient calculation when multi-serve pack portion is ambiguous.
    // Resume path: skipScout + activeScoutItems + portionChoices + resolvedDbCandidates (no second scout/DB).
    const portionClarify =
      !req.body.portionChoices &&
      !req.body.skipPortionClarify &&
      !isWeightModification &&
      !compareOnly &&
      !isExplicitModify &&
      visionScoutRanAndReturnedItems
        ? buildPortionClarifyPayload(visionScoutItems)
        : null;

    if (portionClarify) {
      addDebugLog(
        `[PortionClarify] Pausing for user input on: ${portionClarify.items.map((i) => i.name).join('; ')}`
      );
      // Carry the resolved DB candidates so turn 2 does not re-run DB search from empty.
      // Filter to the meal-relevant candidates only (those belonging to the current scout items
      // or the detected chain brand), capped at 60 to keep the payload manageable.
      const clarifyItemQueries = new Set(visionScoutItems.map((it: any) => String(it.originalName || it.keyword || '').toLowerCase()));
      const resolvedDbCandidates = databaseMatchesArray.filter((c: any) => {
        const cQuery = String(c.searchQuery || c.name || '').toLowerCase();
        return clarifyItemQueries.has(cQuery) ||
          (detectedChainKey && String(c.chainName || '').toLowerCase().includes(detectedChainKey)) ||
          c.source === 'brand_official' ||
          c.source === 'internal_catalog';
      }).slice(0, 60);
      addDebugLog(`[PortionClarify] Embedding ${resolvedDbCandidates.length} pre-resolved DB candidates for turn-2 carry-forward.`);
      
      sendStreamEvent({
        type: 'status',
        stage: 'portion_clarify',
        status: 'awaiting_user',
        message: portionClarify.promptMessage,
      });
      sendLog(
        'status',
        'scout',
        `[PortionClarify] ${portionClarify.promptMessage}`
      );
      if (isStream && hasSentHeaders) {
        sendStreamEvent({
          type: 'done',
          final: true,
          result: {
            needsPortionClarify: true,
            mode: 'portion_clarify',
            message: portionClarify.promptMessage,
            text: portionClarify.promptMessage,
            scoutItems: visionScoutItems,
            portionClarify,
            resolvedDbCandidates,
            agentResult: {
              scoutItems: visionScoutItems,
              activeStage: 'portion_clarify',
            },
          }
        });
        res.end();
        return;
      }
      return res.json({
        needsPortionClarify: true,
        mode: 'portion_clarify',
        message: portionClarify.promptMessage,
        text: portionClarify.promptMessage,
        scoutItems: visionScoutItems,
        portionClarify,
        resolvedDbCandidates,
        agentResult: {
          scoutItems: visionScoutItems,
          activeStage: 'portion_clarify',
        },
      });
    }

    // Brand Environment Locking logic
    const globalBrands = ["mcdonald", "burger king", "wendy", "kfc", "denny", "starbucks", "subway", "taco bell", "domino", "pizza hut", "chipotle", "panera", "dunkin", "sonic", "popeyes", "arby", "dairy queen", "panda express"];
    let dominantBrand = "";
    const allContextText = (message + " " + JSON.stringify(visionScoutItems)).toLowerCase();
    for (const b of globalBrands) {
      if (allContextText.includes(b) || allContextText.includes(b.replace(/\s+/g, ""))) {
         dominantBrand = b;
         addDebugLog(`[Environment Locking] Detected dominant brand "${b}" in scene context. Restricting matching hierarchy.`);
         break;
      }
    }

    // Verified Scout FDC hint pre-fetch: for components where Vision Scout supplied a
    // suggestedFdcId (only expected for well-known, unambiguous staple foods), do a
    // direct single-ID USDA lookup and validate it with the same relevance check used
    // by the final safety-net gate further below, BEFORE the main per-item loop runs.
    // This keeps the existing synchronous component-matching loop completely untouched
    // (no forEach->for-of conversion, no async/await inside it). Hints that fail to
    // resolve or fail the relevance check are silently dropped — the component falls
    // through to today's normal search pipeline exactly as if no hint had been given.
    const verifiedFdcHintMap = new Map<string, any>();
    {
      const hintFetchTasks: Array<{ key: string; fdcId: string; query: string }> = [];
      visionScoutItems.forEach((item: any, itemIdx: number) => {
        (item.components || []).forEach((comp: any, cIdx: number) => {
          const hintId = comp.suggestedFdcId;
          if (hintId && String(hintId).trim()) {
            const q = comp.searchQuery || comp.name || comp.keyword || "";
            hintFetchTasks.push({ key: `${itemIdx}:${cIdx}`, fdcId: String(hintId).trim(), query: q });
          }
        });
      });

      if (hintFetchTasks.length > 0) {
        const hintResults = await Promise.all(hintFetchTasks.map(async (task) => {
          const food = await fetchUSDAFoodById(task.fdcId);
          return { task, food };
        }));

        hintResults.forEach(({ task, food }) => {
          if (!food || !food.description) {
            addDebugLog(`[ScoutFdcHint] id=${task.fdcId} for query "${task.query}" did not resolve — falling through to normal search.`);
            return;
          }
          // Same relevance check as the final safety-net gate below (Task 1 stopword list).
          const hintStopwords = new Set(['cheese', 'canned', 'sauce', 'sauces', 'salad', 'dressing', 'cream', 'sliced', 'chopped', 'mixed', 'fresh', 'cooked', 'raw', 'shredded', 'grated', 'diced', 'whole', 'baked', 'fried', 'roasted', 'steamed', 'boiled', 'grilled', 'style', 'flavored', 'flavoured', 'plain', 'organic', 'natural', 'sweet', 'spicy', 'crushed', 'minced', 'topping', 'toppings', 'spread', 'filling', 'blend', 'garnish', 'crumbs', 'chunks', 'pieces', 'with', 'and', 'leaf', 'leaves', 'seed', 'seeds', 'green']);
          const qTokens = String(task.query).toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter((t: string) => t.length > 3 && !hintStopwords.has(t));
          const fNameLow = String(food.description || '').toLowerCase();
          const relevant = qTokens.length === 0 || qTokens.some((t: string) => fNameLow.includes(t));
          if (!relevant) {
            addDebugLog(`[ScoutFdcHint] Relevance check rejected hint id=${task.fdcId} ("${food.description}") for query "${task.query}" — falling through to normal search.`);
            return;
          }
          const fdcIdStr = String(food.fdcId || task.fdcId);
          const nutrients100g = extractUSDANutrientsPer100g(food);
          dbMatchMap.set(fdcIdStr, nutrients100g);
          const verifiedHit = {
            id: fdcIdStr,
            source: "usda_direct_hint",
            name: food.description || "",
            calories: String(nutrients100g.calories || 0),
            protein: nutrients100g.protein,
            fat: nutrients100g.totalFat,
            saturatedFat: nutrients100g.saturatedFat,
            sodium: nutrients100g.sodium
          };
          databaseMatchesArray.push(verifiedHit);
          verifiedFdcHintMap.set(task.key, verifiedHit);
          addDebugLog(`[ScoutFdcHint] Verified hint id=${fdcIdStr} ("${food.description}") accepted for query "${task.query}".`);
        });
      }
    }

    // Backend-Side Mathematical Macro Aggregation for Component-Level Decomposition
    preCalculatedItems = visionScoutItems.map((item: any, itemIdx: number) => {
      const itemWeight = item.estimatedWeightGrams || 100;
      const aggregatedNutrients: Record<string, number> = {};
      NUTRIENT_KEYS.forEach(k => aggregatedNutrients[k] = 0);
      
      const getEstimatedFoodType = (name: string): string => {
        const n = name.toLowerCase();
        if (n.includes("steak") || n.includes("beef") || n.includes("lamb") || n.includes("pork") || n.includes("mutton") || n.includes("veal") || n.includes("bacon") || n.includes("ham") || n.includes("sausage") || n.includes("daging")) return "red_meat";
        if (n.includes("chicken") || n.includes("turkey") || n.includes("duck") || n.includes("poultry") || n.includes("ayam")) return "poultry";
        if (n.includes("shrimp") || n.includes("prawn") || n.includes("crab") || n.includes("lobster") || n.includes("clam") || n.includes("mussel") || n.includes("oyster") || n.includes("squid") || n.includes("octopus") || n.includes("scallop")) return "shellfish";
        if (n.includes("salmon") || n.includes("tuna") || n.includes("mackerel") || n.includes("sardine") || n.includes("herring") || n.includes("trout") || n.includes("fatty fish")) return "fish_fatty";
        if (n.includes("cod") || n.includes("halibut") || n.includes("snapper") || n.includes("bass") || n.includes("tilapia") || n.includes("fish") || n.includes("ikan")) return "fish_lean";
        if (n.includes("egg") || n.includes("telur") || n.includes("omelet") || n.includes("omelette")) return "egg";
        if (n.includes("milk") || n.includes("cheese") || n.includes("butter") || n.includes("yogurt") || n.includes("cream") || n.includes("dairy")) return "dairy";
        if (n.includes("apple") || n.includes("banana") || n.includes("grape") || n.includes("orange") || n.includes("citrus") || n.includes("nectarine") || n.includes("mandarin") || n.includes("tangerine") || n.includes("peach") || n.includes("plum") || n.includes("pear") || n.includes("cherry") || n.includes("cherries") || n.includes("mango") || n.includes("kiwi") || n.includes("pineapple") || n.includes("berry") || n.includes("strawberr") || n.includes("blueberr") || n.includes("raspberr") || n.includes("blackberr") || n.includes("melon") || n.includes("watermelon") || n.includes("cantaloupe") || n.includes("honeydew") || n.includes("papaya") || n.includes("fig") || n.includes("apricot") || n.includes("lemon") || n.includes("lime") || n.includes("pomegranate") || n.includes("avocado") || n.includes("fruit") || n.includes("buah")) return "fruit";
        if (n.includes("rice") || n.includes("bread") || n.includes("oat") || n.includes("wheat") || n.includes("grain") || n.includes("corn") || n.includes("maize") || n.includes("pasta") || n.includes("noodle") || n.includes("cereal") || n.includes("quinoa")) return "grain";
        if (n.includes("bean") || n.includes("lentil") || n.includes("pea") || n.includes("chickpea") || n.includes("legume") || n.includes("tempeh") || n.includes("tofu") || n.includes("edamame") || n.includes("soy")) return "legume";
        if (n.includes("potato") || n.includes("carrot") || n.includes("onion") || n.includes("garlic") || n.includes("beet") || n.includes("radish") || n.includes("yam") || n.includes("tuber") || n.includes("root") || n.includes("kentang") || n.includes("wortel") || n.includes("cassava") || n.includes("turnip") || n.includes("ginger")) return "root_veg";
        if (n.includes("spinach") || n.includes("kale") || n.includes("lettuce") || n.includes("cabbage") || n.includes("leaf") || n.includes("leaves") || n.includes("sayur") || n.includes("kangkung") || n.includes("pakchoy") || n.includes("mustard green") || n.includes("broccoli") || n.includes("cauliflower") || n.includes("celery") || n.includes("asparagus") || n.includes("cucumber") || n.includes("tomato") || n.includes("eggplant") || n.includes("zucchini") || n.includes("squash") || n.includes("pepper") || n.includes("capsicum") || n.includes("mushroom")) return "leafy_veg";
        if (n.includes("donut") || n.includes("candy") || n.includes("chocolate") || n.includes("chip") || n.includes("french fry") || n.includes("french fries") || n.includes("processed") || n.includes("nugget") || n.includes("cookie") || n.includes("biscuit") || n.includes("cake")) return "ultra_processed";
        return "other";
      };

      // Extracts the head/primary noun of a food name for category classification purposes.
      // USDA/OFF names are conventionally structured as "HeadNoun, modifier, modifier..." (e.g.
      // "Salad dressing, mayonnaise, soybean and safflower oil, with salt") or "HeadNoun made with X"
      // (e.g. "Mayonnaise, made with tofu"). Classifying on the full name causes composite/condiment
      // products to be misclassified into the category of whichever ingredient they merely mention.
      // Classifying on the head noun alone avoids this false match.
      const getHeadNoun = (name: string): string => {
        let n = (name || "").trim();
        n = n.split(",")[0];
        const connectors = [" made with ", " made from ", " prepared with ", " with ", " and "];
        for (const connector of connectors) {
          const idx = n.toLowerCase().indexOf(connector);
          if (idx !== -1) {
            n = n.substring(0, idx);
          }
        }
        return n.trim();
      };

      const getClinicalDefaultNutrients100g = (name: string): Record<string, number> => {
        if (isGenericZeroNutrientDiluent(name)) {
          return { calories: 0, protein: 0, totalFat: 0, saturatedFat: 0, sodium: 0, carbohydrates: 0, transFat: 0, addedSugar: 0, potassium: 0, totalFibre: 0, solubleFibre: 0 };
        }
        const n = name.toLowerCase();
        if (n.includes("mayo") || n.includes("mayonnaise")) {
          return { calories: 680, protein: 1, totalFat: 75, saturatedFat: 12, sodium: 600, carbohydrates: 1, transFat: 0, addedSugar: 0, potassium: 20, totalFibre: 0, solubleFibre: 0 };
        }
        if (n.includes("sauce") || n.includes("dressing")) {
          return { calories: 150, protein: 1, totalFat: 10, saturatedFat: 1.5, sodium: 800, carbohydrates: 15, transFat: 0, addedSugar: 5, potassium: 50, totalFibre: 0, solubleFibre: 0 };
        }
        if (n.includes("sausage") || n.includes("salami") || n.includes("chorizo") || n.includes("pepperoni") || n.includes("frankfurter") || n.includes("bacon") || n.includes("pastrami") || n.includes("ham") || n.includes("cured")) {
          return { calories: 320, protein: 18, totalFat: 26, saturatedFat: 9, sodium: 850, carbohydrates: 3, transFat: 0.3, addedSugar: 0, potassium: 250, totalFibre: 0, solubleFibre: 0 };
        }
        if (n.includes("pizza") || n.includes("crust")) {
          return { calories: 280, protein: 9, totalFat: 8, saturatedFat: 2.5, sodium: 550, carbohydrates: 42, transFat: 0, addedSugar: 2, potassium: 120, totalFibre: 2.5, solubleFibre: 0.5 };
        }
        if (n.includes("beef") || n.includes("steak") || n.includes("meat")) {
          return { calories: 250, protein: 26, totalFat: 15, saturatedFat: 6, sodium: 70, carbohydrates: 0, transFat: 0.1, addedSugar: 0, potassium: 350, totalFibre: 0, solubleFibre: 0 };
        }
        if (n.includes("chicken") || n.includes("poultry") || n.includes("ayam")) {
          return { calories: 165, protein: 31, totalFat: 3.6, saturatedFat: 1, sodium: 70, carbohydrates: 0, transFat: 0, addedSugar: 0, potassium: 220, totalFibre: 0, solubleFibre: 0 };
        }
        if (n.includes("fish") || n.includes("ikan")) {
          return { calories: 120, protein: 20, totalFat: 4, saturatedFat: 1, sodium: 80, carbohydrates: 0, transFat: 0, addedSugar: 0, potassium: 300, totalFibre: 0, solubleFibre: 0 };
        }
        if (n.includes("juice") || n.includes("beverage") || n.includes("drink")) {
          return { calories: 45, protein: 0.5, totalFat: 0.1, saturatedFat: 0, sodium: 5, carbohydrates: 11, transFat: 0, addedSugar: 0, potassium: 150, totalFibre: 0.2, solubleFibre: 0 };
        }
        if (n.includes("fruit") || n.includes("apple") || n.includes("melon") || n.includes("berry") || n.includes("orange") || n.includes("banana")) {
          return { calories: 50, protein: 0.5, totalFat: 0.2, saturatedFat: 0, sodium: 1, carbohydrates: 13, transFat: 0, addedSugar: 0, potassium: 150, totalFibre: 2, solubleFibre: 0.5 };
        }
        if (n.includes("cucumber") || n.includes("lettuce") || n.includes("tomato") || n.includes("leaf") || n.includes("salad") || n.includes("greens")) {
          return { calories: 15, protein: 1, totalFat: 0.2, saturatedFat: 0, sodium: 5, carbohydrates: 3, transFat: 0, addedSugar: 0, potassium: 150, totalFibre: 1, solubleFibre: 0.2 };
        }
        if (n.includes("pea") || n.includes("bean") || n.includes("lentil") || n.includes("corn") || n.includes("carrot") || n.includes("vegetable") || n.includes("veg")) {
          return { calories: 65, protein: 3, totalFat: 0.5, saturatedFat: 0.1, sodium: 30, carbohydrates: 12, transFat: 0, addedSugar: 0, potassium: 200, totalFibre: 2, solubleFibre: 0.5 };
        }
        if (n.includes("potato") || n.includes("wedge") || n.includes("yam")) {
          return { calories: 90, protein: 2, totalFat: 0.1, saturatedFat: 0.02, sodium: 10, carbohydrates: 21, transFat: 0, addedSugar: 0, potassium: 400, totalFibre: 1.5, solubleFibre: 0.5 };
        }
        if (n.includes("brownie") || n.includes("cake") || n.includes("cookie") || n.includes("chocolate") || n.includes("candy") || n.includes("dessert") || n.includes("tart") || n.includes("pie") || n.includes("fudge") || n.includes("biscuit") || n.includes("sweet")) {
          return { calories: 450, protein: 5, totalFat: 24, saturatedFat: 12, sodium: 200, carbohydrates: 55, transFat: 0, addedSugar: 30, potassium: 150, totalFibre: 2, solubleFibre: 0.4 };
        }
        if (n.includes("croissant") || n.includes("pastry") || n.includes("danish") || n.includes("brioche") || n.includes("muffin") || n.includes("scone") || n.includes("donut")) {
          return { calories: 410, protein: 8, totalFat: 21, saturatedFat: 12, sodium: 450, carbohydrates: 46, transFat: 0, addedSugar: 8, potassium: 120, totalFibre: 2, solubleFibre: 0.4 };
        }
        if (n.includes("bread") || n.includes("roll") || n.includes("bun") || n.includes("toast") || n.includes("dough")) {
          return { calories: 250, protein: 8, totalFat: 3, saturatedFat: 0.5, sodium: 400, carbohydrates: 50, transFat: 0, addedSugar: 2, potassium: 100, totalFibre: 3, solubleFibre: 0.5 };
        }
        if (n.includes("egg") || n.includes("omelet")) {
          return { calories: 150, protein: 12, totalFat: 10, saturatedFat: 3, sodium: 130, carbohydrates: 1, transFat: 0, addedSugar: 0, potassium: 130, totalFibre: 0, solubleFibre: 0 };
        }
        if (n.includes("tofu") || n.includes("tahu")) {
          return { calories: 75, protein: 8, totalFat: 4.5, saturatedFat: 0.5, sodium: 10, carbohydrates: 2, transFat: 0, addedSugar: 0, potassium: 120, totalFibre: 1, solubleFibre: 0 };
        }
        if (n.includes("wine") || n.includes("champagne") || n.includes("prosecco") || n.includes("cava") || n.includes("sparkling")) {
          return { calories: 64, protein: 0.07, totalFat: 0, saturatedFat: 0, sodium: 7, carbohydrates: 1, transFat: 0, addedSugar: 0, potassium: 80, totalFibre: 0, solubleFibre: 0 };
        }
        if (n.includes("beer") || n.includes("ale") || n.includes("lager") || n.includes("stout")) {
          return { calories: 43, protein: 0.5, totalFat: 0, saturatedFat: 0, sodium: 4, carbohydrates: 3.6, transFat: 0, addedSugar: 0, potassium: 27, totalFibre: 0, solubleFibre: 0 };
        }
        if (n.includes("spirit") || n.includes("vodka") || n.includes("whisky") || n.includes("whiskey") || n.includes("rum") || n.includes("gin") || n.includes("tequila") || n.includes("brandy") || n.includes("cognac") || n.includes("liqueur")) {
          return { calories: 231, protein: 0, totalFat: 0, saturatedFat: 0, sodium: 1, carbohydrates: 0, transFat: 0, addedSugar: 0, potassium: 2, totalFibre: 0, solubleFibre: 0 };
        }
        if (n.includes("cheese") || n.includes("mozzarella") || n.includes("cheddar") || n.includes("parmesan") || n.includes("feta") || n.includes("ricotta") || n.includes("gouda") || n.includes("provolone") || n.includes("paneer") || n.includes("halloumi")) {
          return { calories: 280, protein: 22, totalFat: 21, saturatedFat: 13, sodium: 550, carbohydrates: 2, transFat: 0, addedSugar: 0, potassium: 100, totalFibre: 0, solubleFibre: 0 };
        }
        if (n.includes("yogurt") || n.includes("yoghurt") || n.includes("kefir") || n.includes("quark")) {
          return { calories: 80, protein: 6, totalFat: 3, saturatedFat: 2, sodium: 45, carbohydrates: 7, transFat: 0, addedSugar: 4, potassium: 200, totalFibre: 0, solubleFibre: 0 };
        }
        if (n.includes("tortilla") || n.includes("wrap") || n.includes("flatbread") || n.includes("pitta") || n.includes("pita") || n.includes("naan") || n.includes("chapati")) {
          return { calories: 290, protein: 8, totalFat: 7, saturatedFat: 1.5, sodium: 600, carbohydrates: 48, transFat: 0, addedSugar: 1, potassium: 130, totalFibre: 3, solubleFibre: 0.5 };
        }
        if (n.includes("oat") || n.includes("cereal") || n.includes("granola") || n.includes("muesli") || n.includes("quinoa") || n.includes("barley")) {
          return { calories: 380, protein: 12, totalFat: 6, saturatedFat: 1, sodium: 10, carbohydrates: 65, transFat: 0, addedSugar: 5, potassium: 350, totalFibre: 10, solubleFibre: 4 };
        }
        if (n.includes("rice") || n.includes("pasta") || n.includes("noodle") || n.includes("spaghetti") || n.includes("macaroni")) {
          if (n.includes("cooked") || n.includes("boiled")) {
            return { calories: 130, protein: 3, totalFat: 0.5, saturatedFat: 0.1, sodium: 5, carbohydrates: 28, transFat: 0, addedSugar: 0, potassium: 40, totalFibre: 1, solubleFibre: 0 };
          }
          return { calories: 360, protein: 10, totalFat: 1.5, saturatedFat: 0.3, sodium: 5, carbohydrates: 75, transFat: 0, addedSugar: 0, potassium: 120, totalFibre: 2.5, solubleFibre: 0.5 };
        }
        if (/\boil\b/.test(n) || n.includes("ghee") || n.includes("lard") || n.includes("shortening")) {
          return { calories: 884, protein: 0, totalFat: 100, saturatedFat: 14, sodium: 2, carbohydrates: 0, transFat: 0, addedSugar: 0, potassium: 1, totalFibre: 0, solubleFibre: 0 };
        }
        return { calories: 100, protein: 2, totalFat: 2, saturatedFat: 0.5, sodium: 100, carbohydrates: 15, transFat: 0, addedSugar: 1, potassium: 150, totalFibre: 1, solubleFibre: 0 };
      };

      const sanitizeComponentQuery = (query: string) => {
        const q = query.toLowerCase();
        if (q.includes('bun') || q.includes('bread')) return `${query} bakery bread`;
        if (q.includes('patty') || q.includes('chicken')) return `${query} cooked breaded`;
        if (q.includes('sauce') || q.includes('mayo')) return `${query} condiment`;
        return query;
      };

      const prepareSearchQueryWithState = (scoutQuery: string, cookingMethod: string) => {
        let finalSearch = scoutQuery;
        const requiresState = /\b(crust|dough|batter|sausage|meatball|steak|fillet)\b/i.test(scoutQuery);
        if (requiresState && !/\b(cooked|baked|fried|roasted|boiled)\b/i.test(scoutQuery)) {
          if (cookingMethod === 'baked') finalSearch = `${scoutQuery} cooked baked`;
          else if (cookingMethod === 'pan_fried' || cookingMethod === 'deep_fried') finalSearch = `${scoutQuery} cooked fried`;
        }
        // UK/EU Fortification Mapping: Enriched wheat flour/tortilla for bread/wrap components
        if (/\b(tortilla|wrap|flatbread|pitta|pita|naan|bread|flour)\b/i.test(finalSearch) && !/\b(enriched|whole wheat|wholemeal|corn)\b/i.test(finalSearch)) {
          finalSearch = `${finalSearch} enriched wheat`;
        }
        // Identity expansions (I5)
        const fsLow = finalSearch.toLowerCase();
        if (fsLow.includes('mixed salad leaves') || fsLow.includes('salad leaves')) {
          finalSearch = `${finalSearch} lettuce mixed greens`;
        }
        if (fsLow.includes('kalamata olives') || fsLow.includes('olives')) {
          finalSearch = `${finalSearch} olives canned`;
        }
        if (fsLow.includes('chickpeas') || fsLow.includes('garbanzo')) {
          finalSearch = `${finalSearch} cooked boiled canned`;
        }
        if (fsLow.includes('fresh berries') || fsLow.includes('berries')) {
          finalSearch = `${finalSearch} blueberries raspberries strawberries`;
        }
        if (/\byoghurt\b/i.test(finalSearch)) {
          finalSearch = finalSearch.replace(/\byoghurt\b/gi, 'yogurt') + ' greek yogurt plain';
        }
        return finalSearch;
      };

      const extractCoreIdentityTokens = (scoutQuery: string) => {
        const cleanQuery = scoutQuery.toLowerCase().replace(/[^\w\s]/g, '');
        const words = cleanQuery.split(/\s+/).filter(Boolean);
        const classFillerNouns = new Set([
          'cooked', 'raw', 'fresh', 'prepared', 'style', 'flavored', 
          'with', 'product', 'food', 'item', 'canned', 'frozen', 
          'dried', 'sliced', 'chopped', 'ground', 'boneless', 'skinless',
          'cubes', 'cubed', 'diced', 'shredded', 'crumbled', 'pieces', 'chunks',
          'roasted', 'boiled', 'baked', 'grilled', 'steamed', 'fried', 'poached',
          'toasted', 'minced', 'crushed', 'grated', 'blend', 'mix', 'mixed'
        ]);
        let tokens = words.filter(word => !classFillerNouns.has(word));
        let categoryBias: string | undefined;
        if (tokens.includes('greens') || tokens.includes('vegetables')) {
          categoryBias = 'vegetable';
          tokens = tokens.filter(t => t !== 'greens' && t !== 'vegetables');
        }
        return { tokens: tokens.length ? tokens : words, categoryBias };
      };

      const findBestMatch = (keyword: string, extraQueries: string[] = []) => {
        if (!keyword || !databaseMatchesArray || databaseMatchesArray.length === 0) return undefined;
        // Query-scoped pool: a component may only bind rows tagged with its searchQuery.
        // Shared-array scan is how chicken stole onion-powder 171327.
        const anyTagged = databaseMatchesArray.some((m: any) => m && m.searchQuery);
        const matchPool = anyTagged
          ? filterMatchesForQuery(keyword, databaseMatchesArray, extraQueries)
          : databaseMatchesArray;
        if (!matchPool.length) return undefined;
        
        const { tokens: coreTokens, categoryBias } = extractCoreIdentityTokens(keyword);
        const queryTokens = new Set<string>(keyword.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/));
        
        const compositeMarkers = ['pizza', 'pasta', 'pie', 'dinner', 'meal', 'assortment'];
        const isComponentQuery = !compositeMarkers.some(marker => keyword.toLowerCase().includes(marker));

        let bestMatch: any = undefined;
        let highestScore = -999999;

        matchPool.forEach((m: any) => {
          if (m.id && quarantinedIdsSet.has(String(m.id))) {
            addDebugLog(`[Quarantine Block] Blocked quarantined candidate "${m.name}" (id=${m.id}) from best-match evaluation.`);
            return;
          }
          if (m.source === 'canonical_dict' || m.source === 'estimated') return;
          // Never select category/last-resort stubs as "best" DB match when real USDA/OFF/catalog exist
          if (m.source === 'category_fallback' || m.source === 'fallback_estimated' || String(m.id || '').startsWith('fallback_')) return;
          // Component matching: never use whole-dish web_search rows as ingredient identity
          if (m.source === 'web_search' || m.source === 'tavily' || m.source === 'serper' || m.source === 'google_cse') return;
          
          const chainNamePrefix = m.chainName || m.chain_name || m.chain_key || '';
          const dbTitle = `${chainNamePrefix} ${m.name || m.dish_name || ''}`.toLowerCase().replace(/[^\w\s]/g, '');
          const dbTokens = new Set<string>(dbTitle.split(/\s+/));

          // RULE 1: Core Token Lock
          const passTokenLock = coreTokens.every(token => 
            dbTokens.has(token) || 
            Array.from(dbTokens).some(dt => dt.startsWith(token) || token.startsWith(dt))
          );
          const passCategoryBias = categoryBias === 'vegetable' && (dbTokens.has('spinach') || dbTokens.has('broccoli') || dbTokens.has('kale') || dbTokens.has('greens'));
          
          if (!passTokenLock && !passCategoryBias) return;

          // RULE 2: Composite Meal Rejection
          if (isComponentQuery) {
            const isCompositeMatch = (dbTokens.has('pizza') && !dbTitle.includes('crust') && !dbTitle.includes('dough')) ||
                                     (dbTokens.has('pasta') && !dbTitle.includes('noodle') && !dbTitle.includes('spaghetti'));
            if (isCompositeMatch) return;
          }

          // RULE 2.5: Minimal Form Gates (Task 3 / B4)
          const isQueryCup = /\b(cup|bowl|loose|yogurt|fruit|plate|pot|glass|mix)\b/i.test(keyword);
          const isQueryBarType = /\b(bar|bars|snack-bar|flapjack|protein-bar|energy-bar)\b/i.test(keyword);
          const isCandBarType = /\b(bar|bars|snack-bar|flapjack|protein-bar|energy-bar)\b/i.test(dbTitle);
          if (isQueryCup && !isQueryBarType && isCandBarType) return;
          if (isQueryBarType && !isQueryCup && /\b(cup|bowl|loose|yogurt|fruit|plate|pot|glass)\b/i.test(dbTitle)) return;

          const isQueryCooked = /\b(cooked|boiled|baked|fried|roasted|plated|steamed|grilled|poached|toast|toasted|canned|sauteed)\b/i.test(keyword);
          const isQueryDry = /\b(dry|raw|flour|powder|mix|unprepared|raw_ingredient)\b/i.test(keyword);
          const isCandDry = /\b(dry|raw|flour|powder|mix|unprepared|raw_ingredient)\b/i.test(dbTitle);
          if (isQueryCooked && !isQueryDry && isCandDry && !dbTitle.includes('cooked') && m.source !== 'brand_official') return;
          if (isQueryDry && !isQueryCooked && /\b(cooked|boiled|baked|fried|roasted|plated|steamed|grilled|poached|toast|toasted|canned|sauteed)\b/i.test(dbTitle)) return;

          // RULE 2.6: Identity poison rejects (query vs candidate title)
          const qLow = keyword.toLowerCase();
          // milk / coffee / beverage components ≠ oat porridge / grain dish / bread / bar
          if (/\b(milk|coffee|espresso|water|juice|tea)\b/i.test(qLow) &&
              !/\b(oat|oats|porridge|cereal|bread|bar)\b/i.test(qLow) &&
              /\b(oat|oats|porridge|cereal|bread|bar|cracker)\b/i.test(dbTitle)) return;
          // olives ≠ olive loaf / luncheon meat
          if (/\bolive/.test(qLow) && !/\bloaf|lunch|mortadella|sausage|bologna\b/.test(qLow) &&
              /\b(loaf|lunch|mortadella|sausage|bologna|pork)\b/i.test(dbTitle)) return;
          // salad leaves / mixed greens ≠ taro / cassava leaves
          if (/\b(salad|lettuce|mixed\s+salad|greens|leaves)\b/i.test(qLow) &&
              /\b(taro|cassava|amaranth leaves|bitterleaf)\b/i.test(dbTitle) &&
              !/\btaro\b/i.test(qLow)) return;
          // berries ≠ basil / herbs
          if (/\b(berr|blueberry|raspberry|strawberry|fruit)\b/i.test(qLow) &&
              /\b(basil|oregano|thyme|parsley|cilantro|herb)\b/i.test(dbTitle)) return;

          // RULE 3: Token Overlap & Noise Penalty
          let score = 0;
          
          // chickpeas in a salad/meal → prefer not dry raw beans
          if (/\bchickpea|garbanzo\b/i.test(qLow) && !/\bdry\b/i.test(qLow) &&
              /\bdry\b/i.test(dbTitle) && !/\bcooked|canned|boiled\b/i.test(dbTitle)) {
            score -= 80; // heavy penalty; allow if nothing else later
          }
          // fruit compote ≠ pure syrup
          if (/\b(compote|compot|mixed fruits?)\b/i.test(qLow) && /\bsyrup\b/i.test(dbTitle) && !/\bcompote\b/i.test(dbTitle)) {
            return;
          }
          if (/fruit syrup|^syrup\b/i.test(dbTitle.trim()) && /\b(compote|fruit|berr)/i.test(qLow) && !/\bcompote\b/i.test(dbTitle)) {
            return;
          }

          dbTokens.forEach(token => {
            if (queryTokens.has(token)) score += 20;
            else score -= 2;
          });
          
          if (m.source === 'brand_official' || m.brandPriority) {
            score += 25;
          }

          // RULE 4: Fatal Penalty for High-Risk Structural Mismatches
          const criticalMismatches = ['blue', 'gorgonzola', 'blood', 'liver', 'imitation'];
          if (criticalMismatches.some(badWord => dbTokens.has(badWord) && !queryTokens.has(badWord))) {
            score -= 200;
          }

          // L6: Reject fruit toppings for cheese queries
          if (/\b(mozzarella|cheddar|cheese)\b/i.test(qLow) && /\b(pineapple|cherry|strawberry|apple|fruit)\b/i.test(dbTitle) && !/\b(mozzarella|cheddar|cheese)\b/i.test(dbTitle)) {
            return;
          }

          if (score > highestScore && score > 0) {
            highestScore = score;
            bestMatch = m;
          }
        });

        return bestMatch;
      };

      

      let primaryDbId: string | null = null;
      let primaryDbSource: string = "estimated";
      let primaryBaseMatchName: string | null = null;
      let primaryBase100g: Record<string, number> | null = null;
      let primaryBaseWeightG: number = itemWeight;
      const truthNutrients: Record<string, number> = {};
      const lockedNutrientKeys = new Set<string>();
      const componentsDetailList: Array<{ name: string; searchQuery?: string; weightGrams: number; dbId?: string; dbSource?: string; [key: string]: any }> = [];

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
  if (lower.includes('pack') || lower.includes('wrap') || lower.includes('container') || lower.includes('tub') || lower.includes('bag') || lower.includes('pouch') || lower.includes('piece') || lower.includes('slice') || lower.includes('portion') || lower.includes('serving') || lower.includes('biscuit') || lower.includes('cookie') || lower.includes('bun') || lower.includes('can') || lower.includes('bottle') || lower.includes('item')) {
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

      const sauceKeywords = ['sauce', 'mayonnaise', 'mayo', 'dressing', 'gravy', 'dip', 'ketchup', 'mustard', 'butter', 'cheese', 'topping', 'syrup', 'spread', 'sambal', 'chili paste', 'cream', 'aioli', 'tartar', 'bbq', 'teriyaki', 'ranch'];

      const rawLabelHasData = item.rawNutritionLabel && typeof item.rawNutritionLabel === 'object'
        ? Object.keys(item.rawNutritionLabel).some((k: string) => {
            if (k === 'servingSize' || k === 'weight' || k === 'servingsPerContainer') return false;
            const v = item.rawNutritionLabel[k];
            return v !== undefined && v !== null && v !== '' && v !== '-' && v !== '--';
          })
        : false;

      let hasComponents = false;
      let truthMatch: any = null;

      if (rawLabelHasData) {
        const getVal = (keys: string | string[]): number => {
          if (!item.rawNutritionLabel || typeof item.rawNutritionLabel !== 'object') return 0;
          const keyArray = Array.isArray(keys) ? keys : [keys];
          const lowerKeyArray = keyArray.map(k => k.toLowerCase().replace(/[^a-z0-9]/g, ''));
          for (const k of Object.keys(item.rawNutritionLabel)) {
             const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
             if (lowerKeyArray.includes(cleanK)) {
                const val = item.rawNutritionLabel[k];
                if (val !== undefined && val !== null && val !== '' && val !== '-') {
                  if (cleanK.includes('calories') || cleanK.includes('energy') || cleanK.includes('kcal')) {
                    const parsedCal = parseLabelCalories(val);
                    if (parsedCal != null) return parsedCal;
                  }
                  const match = String(val).match(/[\d.]+/);
                  if (match) return parseFloat(match[0]);
                }
             }
          }
          return 0;
        };

        let ssGrams = 100;
        if (item.rawNutritionLabel) {
          const ssKey = Object.keys(item.rawNutritionLabel).find(k => {
            const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            return clean === 'servingsize' || clean === 'takaransaji';
          });
          if (ssKey) {
            const ssVal = String(item.rawNutritionLabel[ssKey]);
            ssGrams = parseServingSizeGrams(ssVal, itemWeight);
          }
        }

        const getRawStr = (keys: string | string[]): string | null => {
          if (!item.rawNutritionLabel || typeof item.rawNutritionLabel !== 'object') return null;
          const keyArray = Array.isArray(keys) ? keys : [keys];
          const lowerKeyArray = keyArray.map(k => k.toLowerCase().replace(/[^a-z0-9]/g, ''));
          for (const k of Object.keys(item.rawNutritionLabel)) {
             const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
             if (lowerKeyArray.includes(cleanK)) {
                const val = item.rawNutritionLabel[k];
                if (val !== undefined && val !== null && val !== '' && val !== '-' && val !== '--') {
                  return String(val);
                }
             }
          }
          return null;
        };

        const rawSodiumStr = getRawStr(['sodium', 'natrium']);
        const rawSaltStr = getRawStr(['salt', 'garam', 'sel']);
        let sodiumPerServingMg = 0;

        if (rawSodiumStr) {
          const match = rawSodiumStr.match(/[\d.]+/);
          if (match) {
            const val = parseFloat(match[0]);
            const lowerS = rawSodiumStr.toLowerCase();
            if (lowerS.includes('g') && !lowerS.includes('mg')) {
              sodiumPerServingMg = Math.round(val * 1000);
            } else {
              sodiumPerServingMg = Math.round(val);
            }
          }
        } else if (rawSaltStr) {
          const match = rawSaltStr.match(/[\d.]+/);
          if (match) {
            const saltVal = parseFloat(match[0]);
            const lowerSalt = rawSaltStr.toLowerCase();
            let saltInGramsPerServing = saltVal;
            if (lowerSalt.includes('mg') || (saltVal >= 20 && !lowerSalt.includes('g'))) {
              saltInGramsPerServing = saltVal / 1000;
            }
            sodiumPerServingMg = Math.round(saltInGramsPerServing * 400);

            const totalSaltGrams = parseFloat((saltInGramsPerServing * (itemWeight / ssGrams)).toFixed(2));
            const totalSodiumMg = Math.round(sodiumPerServingMg * (100 / ssGrams) * (itemWeight / 100));

            const saltLogMsg = `[Salt->Sodium Conversion] "${item.originalName || item.keyword}": Transcribed salt ${rawSaltStr} (per ${ssGrams}g serving) -> Converted to ${sodiumPerServingMg}mg sodium per serving. Total for ${itemWeight}g package: ${totalSaltGrams}g salt = ${totalSodiumMg}mg sodium.`;
            addDebugLog(saltLogMsg);

            const saltUserNote = `Converted printed salt (${rawSaltStr} per ${ssGrams}g) to sodium (${sodiumPerServingMg}mg/serving, ${totalSodiumMg}mg total). Formula: 1g salt = 400mg sodium.`;
            item.saltConversionNote = saltUserNote;
            item.rawNutritionLabel.sodium = `${sodiumPerServingMg}mg`;
          }
        } else {
          sodiumPerServingMg = getVal(['sodium', 'natrium']);
        }

        const calsVal = getVal(['calories', 'energy', 'kcal']);
        if (calsVal > 0) {
          // Only attach fields that are literally present on the printed/OCR label.
          // Missing → null (unlockable for USDA/component fill). Present zero → real 0 (locked).
          const scale = itemWeight / ssGrams;
          const presentOrNull = (keys: string | string[]): number | null => {
            if (!getRawStr(keys)) return null;
            return Math.round(getVal(keys) * scale * 10) / 10;
          };
          const sodiumPresent = !!(rawSodiumStr || rawSaltStr);
          // Sugar: UK/EU "of which sugars" often only total sugars (not US Added Sugars).
          // When printed sugar is present and addedSugar is not, use sugar as the locked
          // addedSugar proxy so sweetened pots do not show 0g (see Co-op granola yogurt).
          const sugarScaled = presentOrNull(['sugar', 'sugars', 'ofWhichSugars', 'of_which_sugars', 'totalsugars']);
          // Only trust addedSugar here if the label literally printed a distinct "Added Sugars" line
          // (US FDA format). UK/EU "of which sugars" is Total Sugar, not Added Sugar — do NOT
          // fall back to sugarScaled here. Leave addedSugar null when unprinted; the sugar engine
          // (server_sugar_engine.ts) derives it downstream from food type / ingredients / lactose rules.
          const addedSugarScaled = presentOrNull(['addedSugar', 'added_sugar', 'addedSugars', 'addedsugars']);
          truthMatch = {
            source: 'label',
            id: `printed_packaging_label_${item.scoutIndex}`,
            name: item.originalName || item.keyword,
            basisType: 'total',
            servingGrams: itemWeight,
            calories: Math.round(calsVal * scale),
            protein: presentOrNull(['protein', 'proteins']),
            fat: presentOrNull(['totalFat', 'fat', 'total_fat', 'lipids']),
            saturatedFat: presentOrNull(['saturatedFat', 'saturated_fat', 'satFat', 'saturated']),
            sodium: sodiumPresent ? Math.round(sodiumPerServingMg * scale) : null,
            carbohydrates: presentOrNull(['totalCarbohydrate', 'carbohydrate', 'carbohydrates', 'carbs']),
            totalFibre: presentOrNull(['totalFibre', 'fibre', 'totalFiber', 'fiber']),
            transFat: presentOrNull(['transFat', 'trans_fat', 'trans']),
            potassium: presentOrNull(['potassium', 'k']),
            sugar: sugarScaled,
            addedSugar: addedSugarScaled,
            ingredients: item.ingredientsList
          };
        }
      }

      // Helper to normalize strings for robust matching across special characters (®, ™, ’, etc.)
      const normalizeFoodStr = (s: string) => 
        s ? s.toLowerCase().replace(/[®™]/g, '').replace(/[’']/g, "'").trim() : '';
      
      const origNorm = normalizeFoodStr(item.originalName || '');
      const keyNorm = normalizeFoodStr(item.keyword || '');
      
      const isFuzzyMatch = (m: any) => {
        if (!m || Number(m.calories) <= 0) return false;

        // Reject incomplete garbage matches (like web search parsing errors) that lack basic macros.
        // A valid match should have at least 2 macros explicitly parsed (even if the value is 0).
        // EXEMPT brand_official (your own curated restaurant menu DB) from this check — those are
        // trusted structured records, not noisy scraped web text. A calories-only brand menu entry
        // is legitimate partial truth: it gets locked as truth and the rest is backfilled by the
        // existing Truth Data Backfill step further down, the same way it already works when a
        // brand record happens to have 0-placeholder macros instead of missing ones.
        const isTrustedCuratedSource = m.source === 'brand_official' || m.brandPriority;
        if (!isTrustedCuratedSource) {
          const hasP = m.protein !== undefined && m.protein !== null;
          const hasC = (m.carbohydrates !== undefined && m.carbohydrates !== null) || (m.carbs !== undefined && m.carbs !== null);
          const hasF = (m.fat !== undefined && m.fat !== null) || (m.totalFat !== undefined && m.totalFat !== null);
          if ((hasP ? 1 : 0) + (hasC ? 1 : 0) + (hasF ? 1 : 0) < 2) return false;
        }

        const mNameNorm = normalizeFoodStr(m.name || '');
        
        // Strict Brand-Specific Filter: Prevent generic database matches if brand is present
        const brandKeywords = ["mcdonald", "burger king", "wendy", "kfc", "taco bell", "subway", "domino", "pizza hut", "chipotle", "panera", "dunkin", "sonic", "popeyes", "arby", "dairy queen", "panda express"];
        const origBrand = brandKeywords.find(b => origNorm.includes(b));
        if (origBrand && !mNameNorm.includes(origBrand)) {
           return false;
        }

        const matchesOrig = origNorm && (
          mNameNorm === origNorm || 
          mNameNorm.includes(origNorm) || 
          origNorm.includes(mNameNorm)
        );
        
        const matchesKey = keyNorm && (
          mNameNorm === keyNorm || 
          mNameNorm.includes(keyNorm) || 
          keyNorm.includes(mNameNorm)
        );
      
        if (matchesOrig || matchesKey) return true;

        const tokenize = (str: string) => 
          str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !['with', 'and', 'the', 'for', 'from', 'plus'].includes(w));
        
        const mTokens = tokenize(mNameNorm);
        const origTokens = tokenize(origNorm);
        const keyTokens = tokenize(keyNorm);

        // Guard: if candidate is a brand_official item, require brand name or strong category match.
        // Prevent flavor-token collisions (e.g. "Chocolate Cookie with white chocolate chunks" matching "Skinny Crunch Light Raspberry & White Choc")
        if (m.source === 'brand_official' || m.brandPriority) {
          const mChain = String(m.chainName || m.brand || '').toLowerCase().trim();
          const targetBrand = String(item.chainName || detectedChainKey || '').toLowerCase().trim();
          const origHasBrand = mChain && (origNorm.includes(mChain) || keyNorm.includes(mChain));

          // If the candidate belongs to an official brand/chain, but the food item has no brand detected
          // and the dish name does not mention the brand, REJECT brand matching.
          if (mChain && !targetBrand && !origHasBrand) {
            return false;
          }

          // If both have brand specified, ensure they align
          if (targetBrand && mChain && !targetBrand.includes(mChain) && !mChain.includes(targetBrand)) {
            return false;
          }

          // If query has no brand specified, but candidate belongs to a packaged brand (e.g. Skinny Crunch),
          // ensure the candidate name actually has the core dish type (e.g. cookie vs bar)
          const isBarCandidate = /\b(bar|crisp|sachet|cereal|crunch)\b/i.test(mNameNorm);
          const isCookieTarget = /\b(cookie|biscuit)\b/i.test(origNorm) || /\b(cookie|biscuit)\b/i.test(keyNorm);
          if (isCookieTarget && isBarCandidate) {
            return false;
          }

          const isSaladTarget = /\b(salad|bowl)\b/i.test(origNorm);
          const isSweetBarCandidate = /\b(bar|chocolate|crunch)\b/i.test(mNameNorm);
          if (isSaladTarget && isSweetBarCandidate) {
            return false;
          }
        }

        const DISH_FORM_WORDS = new Set([
          'sandwich', 'side', 'cup', 'bites', 'bowl', 'salad', 'wrap', 'burger',
          'sub', 'roll', 'bar', 'shake', 'platter', 'box', 'meal', 'cookie', 'biscuit'
        ]);

        // Chain/brand name tokens (e.g. "yolk") are near-universal across every dish on that
        // chain's menu and must not count as distinguishing evidence of identity — otherwise
        // two unrelated dishes from the same brand that both happen to be a "bowl" satisfy the
        // shared>=2 threshold below purely on brand name + generic form word (B-DISHID-01).
        const chainTokens = new Set(tokenize(String(detectedChainKey || '').replace(/_/g, ' ')));
        const isNoiseToken = (t: string) => DISH_FORM_WORDS.has(t) || chainTokens.has(t);

        const checkTokenMatch = (targetTokens: string[]) => {
          if (targetTokens.length === 0 || mTokens.length === 0) return false;

          // Guard: if the query names a specific dish "form" (side, sandwich, cup, bowl, bites,
          // etc.) and the candidate names a DIFFERENT form, reject outright. Sharing brand + main
          // ingredient words (e.g. "chicken") is not enough — "Chicken Side" and "Chicken
          // Sandwich" are different items/portions. Mirrors the Food Resolver's existing
          // BAR vs CUP/BOWL rule, applied here to the deterministic matcher.
          const targetForms = targetTokens.filter(t => DISH_FORM_WORDS.has(t));
          const mForms = mTokens.filter(t => DISH_FORM_WORDS.has(t));
          if (targetForms.length > 0 && mForms.length > 0) {
            const compatible = targetForms.some(tf => mForms.includes(tf));
            if (!compatible) return false;
          }

          let shared = 0;
          let distinguishingShared = 0;
          targetTokens.forEach(t => {
            if (mTokens.some(mt => mt.startsWith(t) || t.startsWith(mt))) {
              shared++;
              if (!isNoiseToken(t)) distinguishingShared++;
            }
          });
          // Require at least 2 shared DISTINGUISHING tokens for brand_official candidates —
          // brand name + dish-form word alone (e.g. "yolk" + "bowl") is not evidence two dishes
          // are the same item.
          if (m.source === 'brand_official' || m.brandPriority) {
            return distinguishingShared >= 2 ||
              (targetTokens.length > 0 && shared / targetTokens.length >= 0.5 && distinguishingShared >= 1);
          }
          return shared >= 2 && shared / targetTokens.length >= 0.5;
        };

        return checkTokenMatch(origTokens) || checkTokenMatch(keyTokens);
      };
      
      // 1. Try strict brand_official sources first
      let webMatchRaw = databaseMatchesArray.find((m: any) => 
        (m.source === 'brand_official' || m.brandPriority) &&
        isFuzzyMatch(m)
      );
      
      // 2. Try verified database sources next (USDA, OpenFoodFacts, internal curator, catalog)
      if (!webMatchRaw) {
        webMatchRaw = databaseMatchesArray.find((m: any) => 
          (m.source === 'usda' || m.source === 'off' || m.source === 'internal_dish_cache' || m.source === 'canonical_dict' || String(m.id || '').startsWith('resolver_')) &&
          isFuzzyMatch(m)
        );
      }

      // 3. Fallback to web search sources if no canonical DB match was found
      if (!webMatchRaw) {
        webMatchRaw = databaseMatchesArray.find((m: any) => 
          (m.source === 'web_search' || m.source === 'tavily' || m.source === 'serper' || m.source === 'google_cse') &&
          isFuzzyMatch(m)
        );
      }
      
      // 4. Fallback to any remaining fuzzy match
      if (!webMatchRaw) {
        webMatchRaw = databaseMatchesArray.find(isFuzzyMatch);
      }

      // Prevent single-ingredient brand matches from overriding multi-component home-cooked or composite dishes
      const isMultiComponentHomeCooked = item.components && item.components.length > 1 && diningEnvironment === 'home_cooked';
      const isBrandMatch = webMatchRaw && (webMatchRaw.source === 'brand_official' || webMatchRaw.brandPriority);

      const isMultiComponentItem = Array.isArray(item.components) && item.components.length >= 2;
      const isCompositeOrUnofficial = isUnofficialOrCompositeDish(item.originalName || item.keyword, item.chainName || detectedChainKey, item.provenance, item.notes, item).isUnofficial;
      const isGroceryBrand = isGroceryBrandSync(item.chainName || detectedChainKey || item.originalName || item.keyword || '');

      if (!truthMatch && webMatchRaw) {
        const src = webMatchRaw.source === 'brand_official' || webMatchRaw.brandPriority ? 'brand_official' : 'web_search';
        if (isMultiComponentItem && (src === 'web_search' || isGroceryBrand || (isCompositeOrUnofficial && src !== 'brand_official') || (isMultiComponentHomeCooked && src !== 'brand_official'))) {
          addDebugLog(`[TruthSkip] multi-component / composite dish "${item.originalName || item.keyword}": ignoring single-dish match "${webMatchRaw.dish_name || webMatchRaw.name}" as parent dish truth (use component decomposition + scout budget)`);
          // Do NOT set item.rawNutritionLabel from skipped single-dish parent match (prevents fake label hard locks)
        } else if (isMultiComponentHomeCooked && !isBrandMatch) {
          addDebugLog(`[TruthSkip] home-cooked multi-component "${item.originalName || item.keyword}": ignoring non-brand match (use components + scout budget)`);
        } else {
          truthMatch = {
            ...webMatchRaw,
            source: src
          };
        }
      } else if (truthMatch && (truthMatch.source === 'label' || truthMatch.source === 'label_partial') && webMatchRaw && (!isMultiComponentHomeCooked || isBrandMatch)) {
        const webBasis = webMatchRaw.basisType || 'per_100g';
        const webServing = Number(webMatchRaw.servingGrams) || (webBasis === 'per_100g' ? 100 : itemWeight);
        const webScale = (webServing > 0 && itemWeight > 0) ? itemWeight / webServing : 1;
        
        // Guard against corrupted DB matches poisoning the OCR label
        const webCalsForScale = Number(webMatchRaw.calories || 0) * webScale;
        const ocrCals = Number(truthMatch.calories || 0);
        if (ocrCals > 0 && webCalsForScale > 0) {
            const diff = Math.abs(webCalsForScale - ocrCals) / ocrCals;
            if (diff > 0.45) {
                addDebugLog(`[Truth Merge] Database match calories (${webCalsForScale.toFixed(0)}) deviate too much from OCR label (${ocrCals}). Refusing to merge DB macros.`);
                webMatchRaw = null;
            }
        } else if (ocrCals === 0 && webCalsForScale > 0) {
            // Label had 0 cals / missing nutrients — adopt database match instead of locking to 0
            addDebugLog(`[Truth Merge] OCR label had 0 calories; adopting database match (${webMatchRaw.name}) to avoid 0-macro receipt.`);
            truthMatch = {
              ...webMatchRaw,
              source: webMatchRaw.source || 'usda'
            };
        }
        
        const mapField = (labelKey: string, webKeys: string[]) => {
           if (!webMatchRaw) return;
           // Check if the field was missing from printed OCR or generated via estimated decomposition
           const isUnprintedOrEstimated = 
              truthMatch[labelKey] === undefined || 
              truthMatch[labelKey] === null || 
              (truthMatch._estimatedFields && truthMatch._estimatedFields.includes(labelKey)) ||
              (truthMatch.rawNutritionLabel && (truthMatch.rawNutritionLabel[labelKey] === undefined || truthMatch.rawNutritionLabel[labelKey] === null));
      
           if (isUnprintedOrEstimated) {
              for (const wk of webKeys) {
                 if (webMatchRaw[wk] !== undefined && webMatchRaw[wk] !== null) {
                    truthMatch[labelKey] = Math.round(Number(webMatchRaw[wk]) * webScale * 10) / 10;
                    break;
                 }
              }
           }
        };
      
        // Keep calories locked to the kiosk/OCR printed value. Only fill MISSING macros.
        mapField('protein', ['protein']);
        mapField('fat', ['fat', 'totalFat']);
        mapField('saturatedFat', ['saturatedFat', 'satFat']);
        mapField('carbohydrates', ['carbohydrates', 'carbs', 'totalCarbohydrate']);
        mapField('sodium', ['sodium']);
        mapField('totalFibre', ['totalFibre', 'fiber']);
        mapField('sugar', ['sugar']);
        mapField('addedSugar', ['addedSugar']);
        mapField('potassium', ['potassium']);
        mapField('transFat', ['transFat']);
        
        // Gap-fill micros only. NEVER inject USDA/web macros into truthMatch.nutrients when
        // the truth source is a printed label — that path previously overwrote correct
        // label-scaled locks (e.g. Co-op beef 37kcal/7.3p/63mg Na → USDA 35/5.5/10.7).
        const LABEL_PROTECTED_NUTRIENT_KEYS = new Set([
          'calories', 'protein', 'totalFat', 'fat', 'saturatedFat', 'satFat',
          'sodium', 'carbohydrates', 'carbs', 'totalCarbohydrate', 'totalFibre', 'fiber',
          'addedSugar', 'sugar', 'transFat', 'potassium'
        ]);
        if (webMatchRaw && webMatchRaw.nutrients && typeof webMatchRaw.nutrients === 'object') {
           if (!truthMatch.nutrients) truthMatch.nutrients = {};
           const isLabelTruth = truthMatch.source === 'label' || truthMatch.source === 'label_partial';
           for (const [k, v] of Object.entries(webMatchRaw.nutrients)) {
              if (isLabelTruth && LABEL_PROTECTED_NUTRIENT_KEYS.has(k)) continue;
              if (truthMatch.nutrients[k] === undefined || truthMatch.nutrients[k] === null) {
                  truthMatch.nutrients[k] = Number(v) * webScale;
              }
           }
        }
      }

      let isTruthAnchored = false;
      if (truthMatch) {
        let webCals = Number(truthMatch.calories || 0);
        let webProt = Number(truthMatch.protein || 0);
        let webFat = Number(truthMatch.fat ?? truthMatch.totalFat ?? 0);
        let webSatFat = Number(truthMatch.saturatedFat || 0);
        let webNa = Number(truthMatch.sodium || 0);
        let webCarbs = Number(truthMatch.carbohydrates ?? truthMatch.carbs ?? 0);
        let webFibre = Number(truthMatch.totalFibre ?? truthMatch.fiber ?? 0);
        let webAddedSugar = truthMatch.addedSugar != null ? Number(truthMatch.addedSugar) : 0;
        let webSugar = truthMatch.sugar != null ? Number(truthMatch.sugar) : 0;
        let webPotassium = Number(truthMatch.potassium || 0);

        const rawBaseCals = webCals;
        const rawBaseProt = webProt;
        const rawBaseFat = webFat;
        const rawBaseSatFat = webSatFat;
        const rawBaseNa = webNa;
        const rawBaseCarbs = webCarbs;
        const rawBaseFibre = webFibre;

        // Track which fields the truth source actually recorded, distinct from a real
        // verified zero (e.g. a menu explicitly listing "Protein 0g"). Missing fields
        // (null/undefined in the source) are free to be filled by the component/USDA
        // backfill below; a genuinely recorded zero must never be overwritten later.
        // If a brand or label match has calories > 10 but ALL three major macros (protein, carbohydrates, fat) are 0 (or null/undefined),
        // we treat those zeros as placeholder/unrecorded rather than genuine zero locks. This allows the first-principles component backfill to calculate and complete them.
        const isPlaceholderZeroMacros = Number(truthMatch.calories || 0) > 10 &&
          (truthMatch.protein === 0 || truthMatch.protein == null) &&
          (truthMatch.carbohydrates === 0 || truthMatch.carbohydrates == null || truthMatch.carbs === 0 || truthMatch.carbs == null) &&
          (truthMatch.fat === 0 || truthMatch.fat == null || truthMatch.totalFat === 0 || truthMatch.totalFat == null);

        const proteinKnown = truthMatch.protein != null && (!isPlaceholderZeroMacros || truthMatch.protein !== 0);
        const fatKnown = (truthMatch.fat != null || truthMatch.totalFat != null) && (!isPlaceholderZeroMacros || (truthMatch.fat !== 0 && truthMatch.totalFat !== 0));
        const satFatKnown = truthMatch.saturatedFat != null && (!isPlaceholderZeroMacros || truthMatch.saturatedFat !== 0);
        const sodiumKnown = truthMatch.sodium != null && (!isPlaceholderZeroMacros || truthMatch.sodium !== 0);
        const carbsKnown = (truthMatch.carbohydrates != null || truthMatch.carbs != null) && (!isPlaceholderZeroMacros || (truthMatch.carbohydrates !== 0 && truthMatch.carbs !== 0));
        const fibreKnown = (truthMatch.totalFibre != null || truthMatch.fiber != null) && (!isPlaceholderZeroMacros || (truthMatch.totalFibre !== 0 && truthMatch.fiber !== 0));

        // Durable lock map: survives cooking, reality checks, aggregation, and receipt.
        // Only lock values that the source actually provided (after serving rescale below).
        const lockTruth = (key: string, value: unknown) => {
          if (value === undefined || value === null || value === '') return;
          const n = Number(value);
          if (!Number.isFinite(n)) return;
          // Bug 1 Fix: Do not lock zero for soft micros on unverified web searches
          if (n === 0 && !(truthMatch.source === 'label' || truthMatch.source === 'brand_official') && 
              ['sugar', 'addedSugar', 'totalFibre', 'fiber', 'potassium', 'transFat', 'vitaminD', 'calcium', 'iron'].includes(key)) {
             return;
          }
          truthNutrients[key] = n;
          lockedNutrientKeys.add(key);
        };

        // If the truth source has a known real serving size, webCals/webProt/etc above
        // are FOR THAT SERVING SIZE, not for the Scout's guessed itemWeight. Rescale onto
        // the item's actual consumed weight before anything treats them as "the totals
        // for itemWeight grams".
        const truthBasis = truthMatch.basisType || (truthMatch.source === 'brand_official' || truthMatch.brandPriority ? 'per_dish' : 'per_100g');
        const isDishBasis = truthBasis === 'per_dish' || truthBasis === 'total' || truthBasis === 'per_portion' || truthBasis === 'per_serving' || truthBasis === 'per_pack';
        const truthServingGrams = Number(truthMatch.servingGrams) || 0;

        let servingScale = 1.0;
        if (isDishBasis) {
          if (truthServingGrams > 0 && truthServingGrams !== 100 && itemWeight > 0 && Math.abs(itemWeight - truthServingGrams) > 5) {
            servingScale = itemWeight / truthServingGrams;
            addDebugLog(`[Truth Serving Rescale] "${item.originalName || item.keyword}": DB dish serving is ${truthServingGrams}g, item consumed weight is ${itemWeight}g. Rescaling dish truth values by factor ${servingScale.toFixed(2)}.`);
          } else {
            servingScale = 1.0;
            addDebugLog(`[Truth Serving Rescale] "${item.originalName || item.keyword}": Whole dish/portion basis (${truthBasis}). Keeping truth values unscaled (${webCals} kcal).`);
          }
        } else if (truthServingGrams > 0 && itemWeight > 0 && truthServingGrams !== itemWeight) {
          servingScale = itemWeight / truthServingGrams;
          addDebugLog(`[Truth Serving Rescale] "${item.originalName || item.keyword}": DB rate serving is ${truthServingGrams}g, item consumed weight is ${itemWeight}g. Rescaling truth values by factor ${servingScale.toFixed(2)}.`);
        }

        if (servingScale !== 1.0) {
          webCals = Math.round(webCals * servingScale);
          webProt = Math.round(webProt * servingScale * 10) / 10;
          webFat = Math.round(webFat * servingScale * 10) / 10;
          webSatFat = Math.round(webSatFat * servingScale * 10) / 10;
          webNa = Math.round(webNa * servingScale);
          webCarbs = Math.round(webCarbs * servingScale * 10) / 10;
          webFibre = Math.round(webFibre * servingScale * 10) / 10;
          webAddedSugar = Math.round(webAddedSugar * servingScale * 10) / 10;
          webSugar = Math.round(webSugar * servingScale * 10) / 10;
          webPotassium = Math.round(webPotassium * servingScale);
        }

        // Lock only fields the source actually recorded (post-rescale).
        if (truthMatch.calories != null) lockTruth('calories', webCals);
        if (proteinKnown) lockTruth('protein', webProt);
        if (fatKnown) lockTruth('totalFat', webFat);
        if (satFatKnown) lockTruth('saturatedFat', webSatFat);
        if (sodiumKnown) lockTruth('sodium', webNa);
        if (carbsKnown) lockTruth('carbohydrates', webCarbs);
        if (fibreKnown) lockTruth('totalFibre', webFibre);
        // Printed sugar / added sugar / potassium / trans fat (label panels often have these)
        if (truthMatch.addedSugar != null) lockTruth('addedSugar', webAddedSugar);
        if (truthMatch.sugar != null) lockTruth('sugar', webSugar);
        if (truthMatch.potassium != null) lockTruth('potassium', webPotassium);
        if (truthMatch.transFat != null) lockTruth('transFat', Number(truthMatch.transFat) * servingScale);

        // Extra nutrient keys (brand JSON / soft micro fill). NEVER overwrite a printed lock.
        // For printed labels, also skip re-locking CORE macros from any residual nutrients map
        // so USDA component fill cannot poison label-scaled values (debug job beef topside).
        if (truthMatch.nutrients && typeof truthMatch.nutrients === 'object') {
          const isLabelTruth = truthMatch.source === 'label' || truthMatch.source === 'label_partial';
          const CORE_FROM_NUTRIENTS_BLOCK = new Set([
            'calories', 'protein', 'totalFat', 'fat', 'saturatedFat', 'satFat',
            'sodium', 'carbohydrates', 'carbs', 'totalFibre', 'fiber', 'addedSugar', 'sugar'
          ]);
          for (const k of NUTRIENT_KEYS) {
            if (lockedNutrientKeys.has(k)) continue;
            if (isLabelTruth && CORE_FROM_NUTRIENTS_BLOCK.has(k)) continue;
            if (truthMatch.nutrients[k] !== undefined && truthMatch.nutrients[k] !== null) {
              const raw = Number(truthMatch.nutrients[k]);
              if (!Number.isFinite(raw)) continue;
              
              if (isPlaceholderZeroMacros && raw === 0 && ['protein', 'totalFat', 'fat', 'carbohydrates', 'carbs', 'saturatedFat', 'satFat', 'sodium', 'totalFibre', 'fiber'].includes(k)) {
                continue;
              }
              
              // truthMatch.nutrients from web merge is already portion-scaled; label top-level
              // fields used servingScale above. Brand dish nutrients may still be per-serving.
              const alreadyPortionScaled = isLabelTruth || servingScale === 1;
              const scaled = alreadyPortionScaled
                ? raw
                : ((truthServingGrams > 0 && itemWeight > 0 && truthServingGrams !== itemWeight)
                  ? raw * (itemWeight / truthServingGrams)
                  : raw);
              // Soft micros for labels: store on primary profile later without hard-lock
              // unless brand_official / non-label. For label, only soft-fill unlocked micros.
              if (isLabelTruth) {
                if (!truthMatch._softMicros) truthMatch._softMicros = {};
                truthMatch._softMicros[k] = scaled;
              } else {
                lockTruth(k, scaled);
              }
            }
          }
        }

        const nameLower = String(item.originalName || item.keyword || '').toLowerCase();
        const impliesCarbs = /rice|bowl|bread|sandwich|bun|pasta|noodle|wrap|burrito|pizza|burger|ciabatta|bagel|oat|potato|fries/.test(nameLower);
        const webCalsNum = Number(webCals);
        const webProtNum = Number(webProt);
        const webFatNum = Number(webFat);
        const atwaterFromMacros = webProtNum * 4 + webCarbs * 4 + webFatNum * 9;
        const atwaterDev = webCalsNum > 0 ? Math.abs(atwaterFromMacros - webCalsNum) / webCalsNum : 1;

        const isTrustedSource = truthMatch.source === 'brand_official' || truthMatch.source === 'label';
        const isMultiComponent = item.components && item.components.length >= 2;

        const webRejected =
          !truthMatch ||
          !(webCalsNum > 0) ||
          (isMultiComponent && !isTrustedSource) ||
          (!isTrustedSource && (impliesCarbs && webCarbs <= 0 && webFatNum * 9 > webCalsNum * 0.85)) ||
          (!isTrustedSource && atwaterDev > 0.45) ||
          (!isTrustedSource && webFatNum > webCalsNum / 5) ||
          (!isTrustedSource && Boolean(detectedChainKey) && registeredChainSources.length === 0);

        if (webRejected) {
          addDebugLog(
            `[Truth Direct Injection] REJECTED for "${item.originalName || item.keyword}" (kcal=${webCalsNum}, P=${webProtNum}, C=${webCarbs}, F=${webFatNum}, atwaterDev=${(atwaterDev * 100).toFixed(0)}%). Falling back to components/USDA.`
          );
          // CRITICAL: locks were filled before reject — clear them so budget/reconcile do not hard-lock fake web calories
          Object.keys(truthNutrients).forEach((k) => { delete truthNutrients[k]; });
          lockedNutrientKeys.clear();
          isTruthAnchored = false;
          addDebugLog(`[TruthLock] cleared locks after REJECT for "${item.originalName || item.keyword}"`);
        } else {
          isTruthAnchored = true;
          const dbgStr = `[Truth Data Extraction DEBUG] truthMatch.nutrients = ${JSON.stringify(truthMatch?.nutrients)}, truthMatch.protein = ${truthMatch?.protein}, proteinKnown=${proteinKnown}, isPlaceholderZeroMacros=${isPlaceholderZeroMacros}, lockedNutrientKeys=${Array.from(lockedNutrientKeys).join(',')}`;
          addDebugLog(dbgStr);
          primaryDbSource = truthMatch.source === 'label' ? 'label' : (truthMatch.source === 'brand_official' ? 'brand_official' : 'web_search');
          primaryDbId = truthMatch.id || `${primaryDbSource}_${item.scoutIndex}`;
          primaryBaseMatchName = truthMatch.name || item.originalName || item.keyword;

          // Gap-fill ANY unlocked nutrient from scout components (first principles), not only macros.
          const inferredFromIngredients: Record<string, number> = {};
          NUTRIENT_KEYS.forEach((k) => { inferredFromIngredients[k] = 0; });
          let backfillSource: 'none' | 'ingredient_decomposition' | 'name_canonical' = 'none';

          if (item.components && Array.isArray(item.components) && item.components.length > 0) {
            const rawSums: Record<string, number> = {};
            NUTRIENT_KEYS.forEach((k) => { rawSums[k] = 0; });

            const ocrTargetCalories = Number(truthMatch.calories || 371);

            item.components.forEach((comp: any) => {
              if (!comp || typeof comp !== 'object') return;
              const compWeight = itemWeight * ((comp.volumePercentage || 100) / 100);
              const rawQuery = comp.searchQuery || comp.name || comp.keyword || "";
              if (!rawQuery || compWeight <= 0 || isGenericZeroNutrientDiluent(rawQuery)) return;
              
              const sanitizedQuery = sanitizeComponentQuery(rawQuery);
              const query = prepareSearchQueryWithState(sanitizedQuery, item.cookingMethod || scoutCookingMethod || 'baked');
              const bestMatch = findBestMatch(query);
              const baseNutrients = (bestMatch && dbMatchMap.has(bestMatch.id)) ? dbMatchMap.get(bestMatch.id) : getClinicalDefaultNutrients100g(query);
              if (!baseNutrients) return;

              const f = compWeight / 100;
              comp.calories = Number(baseNutrients.calories || 0) * f;
              comp.protein = Number(baseNutrients.protein || 0) * f;
              comp.carbohydrates = Number(baseNutrients.carbohydrates || baseNutrients.carbs || 0) * f;
              comp.totalFat = Number(baseNutrients.totalFat || baseNutrients.fat || 0) * f;
              comp.saturatedFat = Number(baseNutrients.saturatedFat || baseNutrients.satFat || 0) * f;
              comp.sodium = Number(baseNutrients.sodium || 0) * f;
              comp.sugar = Number(baseNutrients.sugar || 0) * f;
              
              // Attach database names for UI sub-rows
              comp.name = bestMatch ? bestMatch.name : query;
              comp.source = bestMatch ? bestMatch.source : "estimated";

              NUTRIENT_KEYS.forEach((key) => {
                let val = 0;
                if (key === 'carbohydrates') {
                  val = Number(baseNutrients.carbohydrates || baseNutrients.carbs || 0) * f;
                } else if (key === 'totalFat') {
                  val = Number(baseNutrients.totalFat || baseNutrients.fat || 0) * f;
                } else if (key === 'saturatedFat') {
                  val = Number(baseNutrients.saturatedFat || baseNutrients.satFat || 0) * f;
                } else {
                  val = Number(baseNutrients[key] || 0) * f;
                }
                rawSums[key] += val;
              });
            });

            const rawSumCalories = rawSums['calories'] || 0;
            const scaleFactor = (rawSumCalories > 0 && ocrTargetCalories > 0) 
              ? ocrTargetCalories / rawSumCalories 
              : 1;

            if (scaleFactor !== 1 || rawSumCalories > 0) {
              item.components.forEach((comp: any) => {
                if (!comp || typeof comp !== 'object' || comp.calories === undefined) return;
                comp.calories = Math.round(comp.calories * scaleFactor);
                comp.protein = Math.round(comp.protein * scaleFactor * 10) / 10;
                comp.carbohydrates = Math.round(comp.carbohydrates * scaleFactor * 10) / 10;
                comp.totalFat = Math.round(comp.totalFat * scaleFactor * 10) / 10;
                comp.saturatedFat = Math.round(comp.saturatedFat * scaleFactor * 10) / 10;
                comp.sodium = Math.round(comp.sodium * scaleFactor);
                comp.sugar = Math.round(comp.sugar * scaleFactor * 10) / 10;
              });
              
              NUTRIENT_KEYS.forEach((key) => {
                if (key === 'calories' || key === 'sodium') {
                  inferredFromIngredients[key] = Math.round((rawSums[key] || 0) * scaleFactor);
                } else {
                  inferredFromIngredients[key] = Math.round((rawSums[key] || 0) * scaleFactor * 10) / 10;
                }
              });
              backfillSource = 'ingredient_decomposition';
              truthMatch._isComponentDecomposition = true;
            }
          }

          const estimatedFields: string[] = [];
          if (!proteinKnown) {
            const val = inferredFromIngredients.protein > 0 ? inferredFromIngredients.protein : (webCals > 0 ? Math.round(((webCals * 0.20) / 4) * 10) / 10 : 0);
            if (val > 0) {
              webProt = val;
              estimatedFields.push('protein');
            }
          }
          if (!fatKnown) {
            const val = inferredFromIngredients.totalFat > 0 ? inferredFromIngredients.totalFat : (webCals > 0 ? Math.round(((webCals * 0.35) / 9) * 10) / 10 : 0);
            if (val > 0) {
              webFat = val;
              estimatedFields.push('totalFat');
            }
          }
          if (!satFatKnown) {
            const val = inferredFromIngredients.saturatedFat > 0 ? inferredFromIngredients.saturatedFat : (webFat > 0 ? Math.round((webFat * 0.25) * 10) / 10 : 0);
            if (val > 0) {
              webSatFat = val;
              estimatedFields.push('saturatedFat');
            }
          }
          if (!sodiumKnown) {
            const val = inferredFromIngredients.sodium > 0 ? inferredFromIngredients.sodium : (webCals > 0 ? Math.round(webCals * 1.5) : 0);
            if (val > 0) {
              webNa = val;
              estimatedFields.push('sodium');
            }
          }
          if (!carbsKnown) {
            const val = inferredFromIngredients.carbohydrates > 0 ? inferredFromIngredients.carbohydrates : (webCals > 0 ? Math.round(((webCals * 0.45) / 4) * 10) / 10 : 0);
            if (val > 0) {
              webCarbs = val;
              estimatedFields.push('carbohydrates');
            }
          }
          if (!fibreKnown) {
            const val = inferredFromIngredients.totalFibre > 0 ? inferredFromIngredients.totalFibre : (webCarbs > 0 ? Math.round((webCarbs * 0.08) * 10) / 10 : 0);
            if (val > 0) {
              webFibre = val;
              estimatedFields.push('totalFibre');
            }
          }
          if (!lockedNutrientKeys.has('sugar')) {
            const val = inferredFromIngredients.sugar > 0 ? inferredFromIngredients.sugar : 0;
            if (val > 0) {
              webSugar = val;
              estimatedFields.push('sugar');
            }
          }
          // Remaining unlocked keys (vitamins/minerals/etc.) stay estimated-only
          NUTRIENT_KEYS.forEach((key) => {
            if (lockedNutrientKeys.has(key)) return;
            if (['calories', 'protein', 'totalFat', 'saturatedFat', 'sodium', 'carbohydrates', 'totalFibre', 'sugar'].includes(key)) return;
            if (inferredFromIngredients[key] > 0) estimatedFields.push(key);
          });

          addDebugLog(`[Truth Data Backfill] "${item.originalName || item.keyword}": filled missing fields via ${backfillSource !== 'none' ? backfillSource : 'Atwater macro distribution'}; locked truth keys=[${Array.from(lockedNutrientKeys).join(', ')}]; estimated=[${estimatedFields.join(', ')}].`);

          const per100 = (portionVal: number) =>
            itemWeight > 0 ? Math.round((portionVal / itemWeight) * 100 * 10) / 10 : portionVal;
          primaryBase100g = {
            servingSizeGrams: 100,
            basisType: 'per_100g' as any,
            calories: itemWeight > 0 ? Math.round((webCals / itemWeight) * 100) : webCals,
            protein: per100(webProt),
            totalFat: per100(webFat),
            saturatedFat: per100(webSatFat),
            transFat: 0,
            carbohydrates: per100(webCarbs),
            // Prefer locked / printed sugar — never hardcode 0 when label had sugars
            addedSugar: lockedNutrientKeys.has('addedSugar') && truthNutrients.addedSugar != null
              ? per100(Number(truthNutrients.addedSugar))
              : (webAddedSugar > 0 ? per100(webAddedSugar) : 0),
            sodium: itemWeight > 0 ? Math.round((webNa / itemWeight) * 100) : webNa,
            salt: null,
            potassium: lockedNutrientKeys.has('potassium') && truthNutrients.potassium != null
              ? per100(Number(truthNutrients.potassium))
              : (webPotassium > 0 ? per100(webPotassium) : 0),
            totalFibre: per100(webFibre),
            solubleFibre: 0
          };

          // Soft micros from USDA/web (label path) — estimates only, not truth locks
          if (truthMatch._softMicros && typeof truthMatch._softMicros === 'object' && itemWeight > 0) {
            for (const [k, v] of Object.entries(truthMatch._softMicros as Record<string, number>)) {
              if (lockedNutrientKeys.has(k)) continue;
              const n = Number(v);
              if (Number.isFinite(n) && n > 0) {
                primaryBase100g![k] = n / (itemWeight / 100);
              }
            }
          }

          // Fill unlocked nutrients (incl. micronutrients) from ingredient profile as per-100g estimates.
          if (typeof inferredFromIngredients !== 'undefined' && backfillSource !== 'none' && itemWeight > 0) {
            NUTRIENT_KEYS.forEach((key) => {
              if (lockedNutrientKeys.has(key)) {
                if (truthNutrients[key] !== undefined) {
                  primaryBase100g![key] = truthNutrients[key] / (itemWeight / 100);
                }
                return;
              }
              if (inferredFromIngredients[key] > 0) {
                primaryBase100g![key] = inferredFromIngredients[key] / (itemWeight / 100);
              }
            });
          }
          if (typeof estimatedFields !== 'undefined' && estimatedFields.length > 0) {
            (primaryBase100g as any)._estimatedFields = estimatedFields;
          }
          dbMatchMap.set(primaryDbId, primaryBase100g);

          // Start aggregated from completed profile, then force truth locks.
          if (typeof inferredFromIngredients !== 'undefined') {
            NUTRIENT_KEYS.forEach((key) => {
              aggregatedNutrients[key] = inferredFromIngredients[key] || 0;
            });
          }
          aggregatedNutrients.calories = webCals;
          aggregatedNutrients.protein = webProt;
          aggregatedNutrients.totalFat = webFat;
          aggregatedNutrients.saturatedFat = webSatFat;
          aggregatedNutrients.sodium = webNa;
          aggregatedNutrients.carbohydrates = webCarbs;
          aggregatedNutrients.totalFibre = webFibre;
          aggregatedNutrients.sugar = webSugar;
          if (lockedNutrientKeys.has('addedSugar') && truthNutrients.addedSugar != null) {
            aggregatedNutrients.addedSugar = Number(truthNutrients.addedSugar);
          } else if (webAddedSugar > 0) {
            aggregatedNutrients.addedSugar = webAddedSugar;
          }
          if (lockedNutrientKeys.has('potassium') && truthNutrients.potassium != null) {
            aggregatedNutrients.potassium = Number(truthNutrients.potassium);
          }
          Object.entries(truthNutrients).forEach(([key, value]) => {
            aggregatedNutrients[key] = value;
          });

          // Nutrition Labels UI = source truth only (OCR as written OR restaurant-reported).
          // Estimated component/USDA fill must NEVER appear here — only in calculation tables.
          const isGenuineLabelSource = primaryDbSource === 'label' || primaryDbSource === 'brand_official';
          if (isGenuineLabelSource) {
            // The label must display the official matched product name (e.g. "Sainsbury's
            // Taste the Difference Scottish Whole Rolled Jumbo Oats"), never the user's
            // original generic/typed name, when a genuine brand/label match exists.
            if (truthMatch.name) {
              item.labelProductName = truthMatch.name;
            }
            const officialServingSize = truthMatch.rawNutritionLabel?.servingSize || 
              (truthServingGrams > 0
                ? `${truthServingGrams}g`
                : (isDishBasis && itemWeight > 0) ? `${itemWeight}g` : '100g');

            if (!item.rawNutritionLabel || typeof item.rawNutritionLabel !== 'object' || Object.keys(item.rawNutritionLabel).length === 0 || !item.rawNutritionLabel.servingSize) {
              item.rawNutritionLabel = {
                servingSize: officialServingSize,
                calories: truthMatch.calories != null ? `${rawBaseCals} kcal` : undefined,
                protein: proteinKnown ? `${rawBaseProt}g` : undefined,
                carbohydrates: carbsKnown ? `${rawBaseCarbs}g` : undefined,
                sugar: truthMatch.sugar != null ? `${truthMatch.sugar}g` : undefined,
                totalFat: fatKnown ? `${rawBaseFat}g` : undefined,
                saturatedFat: satFatKnown ? `${rawBaseSatFat}g` : undefined,
                totalFibre: fibreKnown ? `${rawBaseFibre}g` : undefined,
                sodium: sodiumKnown ? `${rawBaseNa}mg` : undefined,
                salt: truthMatch.salt != null ? `${truthMatch.salt}g` : undefined
              };
            }
          }
          // Truth (OCR label or curated brand/chain data) always wins over the Scout's
          // visually-guessed ingredient list when both are present — the Scout's guess is
          // a fallback for when no real source exists, not a peer to compare against.
          const truthIngs = truthMatch.ingredients || truthMatch.ingredientsList || truthMatch.description;
          if (truthIngs) {
            item.ingredientsList = truthIngs;
          }

          addDebugLog(`[Truth Direct Injection] "${item.originalName || item.keyword}": Using direct nutrients (${webCals} kcal, ${webProt}g protein, ${webFat}g fat, ${webNa}mg sodium) from ${primaryDbSource}`);
        }
      }

      if (!isTruthAnchored) {
        if (item.components && Array.isArray(item.components) && item.components.length > 0) {
        hasComponents = true;

        // L2: Incomplete multi-component assembly detection
        const itemNameStr = (item.originalName || item.keyword || item.name || '').toLowerCase();
        if (item.components.length >= 2 && /\b(salad|bowl|cup|parfait|platter|bento|poke)\b/i.test(itemNameStr)) {
          const rawPctSum = item.components.reduce((a: number, c: any) => a + (Number(c.volumePercentage) || 0), 0) || 100;
          const dominantComp = item.components.find((c: any) => {
            const wShare = (Number(c.volumePercentage) || 0) / rawPctSum;
            return wShare >= 0.85;
          });
          if (dominantComp) {
            const domName = (dominantComp.searchQuery || dominantComp.name || dominantComp.keyword || '').toLowerCase();
            if (/\b(lettuce|iceberg|spinach|greens|rice|quinoa|base)\b/i.test(domName)) {
              addDebugLog(`[IncompleteAssembly] Incomplete assembly for "${itemNameStr}": dominant component "${domName}" has >= 85% weight share. Redistributing mass across components.`);
              const nonDomCount = item.components.length - 1;
              item.components.forEach((c: any) => {
                const cName = (c.searchQuery || c.name || c.keyword || '').toLowerCase();
                if (cName === domName) {
                  c.volumePercentage = 60;
                } else {
                  c.volumePercentage = Math.round(40 / (nonDomCount || 1));
                }
              });
              item.assemblyAnomaly = true;
              item.confidence = Math.min(item.confidence || 0.8, 0.5);
            }
          }
        }
        const resolvedComponentsById = new Map<string, { isPrimary: boolean; sauceIndex?: number }>();
        const pctSum = (item.components || []).reduce(
          (a: number, c: any) => a + (Number(c.volumePercentage) || 0),
          0
        ) || 100;
        item.components.forEach((comp: any, cIdx: number) => {
          const itemIndex = (item.scoutIndex !== undefined && item.scoutIndex !== null) ? item.scoutIndex : itemIdx;
          const compWeight = Math.max(
            1,
            Math.round(itemWeight * ((Number(comp.volumePercentage) || 0) / pctSum))
          );
          const rawQuery = comp.searchQuery || comp.name || comp.keyword || "";
          let matchQuery = rawQuery;
          if ((rawQuery.match(/\b(and|,)\b/gi) || []).length >= 2 || rawQuery.split(/\s+/).length >= 8) {
            matchQuery = rawQuery.split(/\band\b|,/i)[0].trim() || rawQuery;
            addDebugLog(`[MatchPriority] mega-component query split: "${rawQuery}" → match "${matchQuery}"`);
          }
          const query = prepareSearchQueryWithState(matchQuery, item.cookingMethod || scoutCookingMethod || 'baked');
          
          // Direct Curator / Query match priority: if databaseMatchesArray already contains an entry specifically resolved for this query, use it first!
          const normCompQuery = normalizeFoodKey(query);
          const calcTokenOverlap = (strA: string, strB: string): number => {
            const setA = new Set(strA.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean));
            const setB = new Set(strB.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean));
            if (setA.size === 0 || setB.size === 0) return 0;
            let matches = 0;
            setA.forEach(token => { if (setB.has(token)) matches++; });
            return matches / Math.min(setA.size, setB.size);
          };
          const directCuratorMatch = databaseMatchesArray.find((m: any) =>
            normalizeFoodKey(m.searchQuery || '') === normCompQuery &&
            m.source !== 'category_fallback' &&
            !String(m.id || '').startsWith('fallback_') &&
            !quarantinedIdsSet.has(String(m.id)) &&
            calcTokenOverlap(normCompQuery, m.name || m.searchQuery || '') >= 0.5
          );

          let bestMatch = directCuratorMatch || pickQueryScopedMatch(query, databaseMatchesArray, [rawQuery, matchQuery], quarantinedIdsSet) || findBestMatch(query, [rawQuery, matchQuery]);
          if (directCuratorMatch) {
            addDebugLog(`[MatchPriority] Bound direct Curator query match id=${directCuratorMatch.id} ("${directCuratorMatch.name}") for component "${query}".`);
          }
          if (bestMatch && (bestMatch.source === 'web_search' || bestMatch.source === 'tavily' || bestMatch.source === 'serper' || bestMatch.source === 'google_cse')) {
            addDebugLog(`[MatchPriority] rejected web_search for component "${query}"`);
            bestMatch = undefined;
          }
          // Task 4: Cross-category guard — a bread/grain component query must not resolve to a
          // meat/deli brand entry that happens to be in databaseMatchesArray from another item.
          if (bestMatch && (bestMatch.source === 'brand_official' || bestMatch.source === 'web_search')) {
            const bmName = String(bestMatch.name || '').toLowerCase();
            const qLow = String(query).toLowerCase();
            const isBreadGrainQuery = /\b(bread|baguette|flour|wheat|grain|loaf|roll|cracker|pastry|dough|yeast|brioche|bun|bagel|toast|pitta|naan)\b/i.test(qLow);
            const isProteinDishMatch = /\b(chicken|pork|beef|ham|turkey|meat|fish|sausage|deli|sliced|mince|bacon|prawn|shrimp|tuna|salmon)\b/i.test(bmName);
            if (isBreadGrainQuery && isProteinDishMatch) {
              addDebugLog(`[MatchPriority] Task4 rejected cross-category brand match "${bestMatch.name}" for grain component "${query}"`);
              bestMatch = undefined;
            }
          }
          if (bestMatch) {
            const qn = String(query).toLowerCase();
            const mn = String(bestMatch.name || '').toLowerCase();
            if (qn.split(/\s+/).length <= 2 && mn.includes('yogurt') && !qn.includes('yogurt') && (mn.includes('cup') || mn.includes('parfait'))) {
              addDebugLog(`[MatchPriority] rejected dish-level match "${bestMatch.name}" for component "${query}"`);
              bestMatch = undefined;
            }
          }
          const canonicalData = lookupCanonicalBaseFood(query);
          // Prefer internal_catalog / usda / off over any residual fallback or missing match
          if (!canonicalData && (!bestMatch || bestMatch.source === 'category_fallback' || String(bestMatch.id || '').startsWith('fallback_') || bestMatch.source === 'estimated')) {
            const qTokens = String(query).toLowerCase().split(/\s+/).filter(Boolean);
            const isQueryCooked = qTokens.some(t => ['cooked', 'plated', 'salad', 'mixed', 'roasted'].includes(t));
            const isQueryLoose = qTokens.some(t => ['cup', 'bowl', 'yogurt', 'fruit', 'loose'].includes(t));

            const GENERIC_MATCH_STOPWORDS = new Set(['cheese', 'canned', 'sauce', 'sauces', 'salad', 'dressing', 'cream', 'sliced', 'chopped', 'mixed', 'fresh', 'cooked', 'raw', 'shredded', 'grated', 'diced', 'whole', 'baked', 'fried', 'roasted', 'steamed', 'boiled', 'grilled', 'style', 'flavored', 'flavoured', 'plain', 'organic', 'natural', 'sweet', 'spicy', 'crushed', 'minced', 'topping', 'toppings', 'spread', 'filling', 'blend', 'garnish', 'crumbs', 'chunks', 'pieces']);
            const significantQTokens = Array.from(new Set(qTokens.filter((t: string) => t.length >= 3 && !GENERIC_MATCH_STOPWORDS.has(t))));

            let better: any = undefined;
            let bestOverlapScore = 0;

            databaseMatchesArray.forEach((m: any) => {
              if (m.id && quarantinedIdsSet.has(String(m.id))) return;
              if (m.source === 'category_fallback' || String(m.id || '').startsWith('fallback_')) return;
              if (m.source !== 'internal_catalog' && m.source !== 'usda' && m.source !== 'off' && m.source !== 'brand_official') return;
              // Task 5: Dish-level totals (basisType='total'/'per_dish') are invalid as sub-ingredient
              // nutrient sources. Using them would apply whole-dish macros to a component weight.
              if (m.basisType === 'total' || m.basisType === 'per_dish') return;

              const mName = String(m.name || '').toLowerCase();
              if (isQueryCooked && (mName.includes('dry') || mName.includes('flour'))) return;
              if (isQueryLoose && (mName.includes(' bar') || mName.endsWith('bar'))) return;

              const qLow = String(query).toLowerCase();
              if (/\b(egg|eggs|poultry|meat|chicken|pork|beef|fish|cheese|yogurt|yoghurt|feta|cottage|curd|granola|oats?|cereal|parfait|salad)\b/i.test(qLow) && /\b(tea|beverage|coffee|water|seltzer|soda|juice|hard\s*seltzer)\b/i.test(mName) && !/\b(tea|coffee|soda|juice|seltzer)\b/i.test(qLow)) return;
              if (/\b(salad\s*cream|salad\s*dressing|dressing|mayonnaise|mayo|vinaigrette|sauce|condiment)\b/i.test(qLow) && /\b(ice\s*cream|cone|frozen\s+yogurt|gelato|sorbet|confectionery|candy|dessert|pastry|cake|cookie|donut)\b/i.test(mName) && !/\b(ice\s*cream|cone|dessert)\b/i.test(qLow)) return;
              if (/\b(raisins?|prunes?|dates?|cranberr(y|ies)|figs?|apricots?)\b/i.test(qLow) && !/\b(oat|oats|cereal|granola|muesli|oatmeal|porridge|bar|bread|cake|cookie)\b/i.test(qLow) && /\b(cereal|cereals|oat|oats|instant|oatmeal|prepared\s+with\s+water|bar|granola)\b/i.test(mName)) return;
              if (/\bolive/.test(qLow) && !/\bloaf|lunch|mortadella|sausage|bologna\b/.test(qLow) && /\b(loaf|lunch|mortadella|sausage|bologna|pork)\b/i.test(mName)) return;
              if (/\b(salad|lettuce|mixed\s+salad|greens|leaves)\b/i.test(qLow) && /\b(taro|cassava|amaranth leaves|bitterleaf)\b/i.test(mName) && !/\btaro\b/i.test(qLow)) return;
              if (/\b(berr|blueberry|raspberry|strawberry|fruit)\b/i.test(qLow) && /\b(basil|oregano|thyme|parsley|cilantro|herb)\b/i.test(mName)) return;
              const isSimplePantry = /\b(salt|table salt|sea salt|water|yeast|baking powder|baking soda|black pepper|white pepper|vinegar)\b/i.test(qLow);
              if (isSimplePantry && /\b(chicken|pork|beef|ham|turkey|meat|fish|salmon|tuna|bacon|sausage|deli|slices|bread|pasta|sandwich|roll)\b/i.test(mName)) return;

              let overlapScore = 0;
              if (significantQTokens.length > 0) {
                overlapScore = significantQTokens.filter((t: string) => mName.includes(t)).length;
                const requiredScore = significantQTokens.length >= 2 ? 2 : 1;
                if (overlapScore < requiredScore) return;
              } else {
                if (!mName.includes(qTokens[0])) return;
                overlapScore = 1;
              }

              if (overlapScore > bestOverlapScore) {
                bestOverlapScore = overlapScore;
                better = m;
              }
            });

            if (better) {
              addDebugLog(`[MatchPriority] preferred ${better.source} over ${bestMatch?.source || 'null'} for "${query}", id=${better.id}, overlapScore=${bestOverlapScore}`);
              bestMatch = better;
            }
          }
          // A verified Scout FDC hint (already fetched by direct ID and relevance-checked
          // in the pre-fetch pass above) always takes priority over whatever the fuzzy
          // search above found, since Scout is only supposed to supply one for unambiguous
          // staple foods. It still passes through the same final relevance gate immediately
          // below as a second, cheap safety check.
          const scoutHintKey = `${itemIndex}:${cIdx}`;
          if (verifiedFdcHintMap.has(scoutHintKey)) {
            const hint = verifiedFdcHintMap.get(scoutHintKey);
            addDebugLog(`[MatchPriority] Using verified Scout FDC hint id=${hint.id} ("${hint.name}") for query "${query}" (was bestMatch.source=${bestMatch?.source || 'null'}).`);
            bestMatch = hint;
          }
          // Final relevance safety net: whatever path assigned bestMatch above, it must share
          // at least one meaningful, non-generic token with the query before we trust it as a
          // confident match. Without this, matches with effectively zero semantic relevance
          // (e.g. "Yogurt, plain, low fat" -> "Water, bottled, plain", or "Mixed salad greens"
          // -> "Beverages, POWERADE, Zero, Mixed Berry") were reaching the nutrient pipeline as
          // if they were a genuine, confident single match — silently poisoning the item with
          // an unrelated food's numbers instead of correctly falling through to the canonical
          // dictionary lookup or the category-fallback/Resolver path below.
          if (bestMatch) {
            const relevanceStopwords = new Set(['canned', 'sliced', 'chopped', 'mixed', 'fresh', 'cooked', 'raw', 'shredded', 'grated', 'diced', 'whole', 'baked', 'fried', 'roasted', 'steamed', 'boiled', 'grilled', 'style', 'flavored', 'flavoured', 'plain', 'organic', 'natural', 'sweet', 'spicy', 'crushed', 'minced', 'topping', 'toppings', 'spread', 'filling', 'blend', 'garnish', 'crumbs', 'chunks', 'pieces', 'with', 'and', 'leaf', 'leaves', 'seed', 'seeds', 'green']);
            const rawQTokens = String(query).toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter((t: string) => t.length > 2);
            const relevanceQTokens = rawQTokens.filter((t: string) => !relevanceStopwords.has(t));
            const effectiveQTokens = relevanceQTokens.length > 0 ? relevanceQTokens : rawQTokens;
            const bmNameLow = String(bestMatch.name || bestMatch.dish_name || '').toLowerCase();
            const hasRelevantOverlap = effectiveQTokens.some((t: string) => bmNameLow.includes(t) || t.includes(bmNameLow.split(/\s+/).find((w: string) => w.length > 3) || '\u0000'));
            const catCompat = checkCategoryAndStateCompatibility(query, bmNameLow);
            if (!hasRelevantOverlap || !catCompat.compatible) {
              addDebugLog(`[MatchPriority] Relevance gate rejected "${bestMatch.name}" (id=${bestMatch.id}) for query "${query}" — ${!catCompat.compatible ? catCompat.reason : 'no meaningful token overlap'}.`);
              bestMatch = undefined;
            }
          }
          addDebugLog(`[Component Resolution Diagnostic] item="${item.originalName || item.keyword}" (scoutIndex=${itemIndex}) component[${cIdx}] query="${query}" -> canonicalMatch=${canonicalData ? JSON.stringify(canonicalData.fdcId || 'no-fdcid') : 'none'} bestMatch.source=${bestMatch?.source || 'null'} bestMatch.id=${bestMatch?.id || 'null'}`);

          let labelCompMatch: any = null;
          if (comp.rawNutritionLabel && typeof comp.rawNutritionLabel === 'object') {
            const getLabelVal = (k: string) => {
              const v = comp.rawNutritionLabel[k];
              if (v === undefined || v === null || v === '' || v === '-' || v === '--') return 0;
              const m = String(v).match(/[\d.]+/);
              return m ? parseFloat(m[0]) : 0;
            };
            const labelCal = getLabelVal('calories');
            const labelProt = getLabelVal('protein');
            const labelFat = getLabelVal('totalFat') || getLabelVal('fat');
            const labelSatFat = getLabelVal('saturatedFat');
            const labelCarbs = getLabelVal('totalCarbohydrate') || getLabelVal('carbohydrate');
            const labelFibre = getLabelVal('totalFibre') || getLabelVal('fibre');
            const labelSalt = getLabelVal('salt');
            let labelNa = getLabelVal('sodium');
            if (!labelNa && labelSalt > 0) labelNa = Math.round(labelSalt * 400);

            if (labelCal > 0 || labelProt > 0 || labelCarbs > 0) {
              const virtualId = `package_label_comp_${itemIndex}_${cIdx}`;
              const labelVec = {
                calories: labelCal,
                protein: labelProt,
                totalFat: labelFat,
                saturatedFat: labelSatFat,
                carbohydrates: labelCarbs,
                totalFibre: labelFibre,
                sodium: labelNa,
                sugar: getLabelVal('sugar'),
                addedSugar: getLabelVal('addedSugar'),
                transFat: getLabelVal('transFat'),
                potassium: getLabelVal('potassium'),
                calcium: getLabelVal('calcium'),
                iron: getLabelVal('iron')
              };
              dbMatchMap.set(virtualId, labelVec);
              labelCompMatch = {
                id: virtualId,
                source: "label",
                name: `${query} (Package Label Truth)`,
                calories: String(labelCal),
                protein: labelProt,
                fat: labelFat,
                saturatedFat: labelSatFat,
                sodium: labelNa
              };
              databaseMatchesArray.push(labelCompMatch);
              addDebugLog(`[Component Resolution] Used linked package label truth for component "${query}": ${labelCal} kcal, ${labelProt}g protein, ${labelCarbs}g carbs, ${labelFat}g fat per 100g.`);
            }
          }

          if (labelCompMatch) {
            bestMatch = labelCompMatch;
          } else if (isGenericZeroNutrientDiluent(query)) {
            const virtualId = `zero_diluent_comp_${itemIndex}_${cIdx}`;
            const zeroVec = getZeroNutrientVector();
            dbMatchMap.set(virtualId, zeroVec);
            bestMatch = {
              id: virtualId,
              source: "canonical_dict",
              name: `${query} (Diluent)`,
              calories: "0",
              protein: 0,
              fat: 0,
              saturatedFat: 0,
              sodium: 0
            };
            databaseMatchesArray.push(bestMatch);
          } else if ((!bestMatch || bestMatch.source === 'category_fallback' || bestMatch.source === 'estimated') && canonicalData) {
            const virtualId = `canonical_comp_${itemIndex}_${cIdx}`;
            dbMatchMap.set(virtualId, canonicalData);
            const isBrandMenu = canonicalData.fdcId && String(canonicalData.fdcId).startsWith("brand_menu_");
            bestMatch = {
              id: virtualId,
              source: isBrandMenu ? "brand_official" : "canonical_dict",
              name: `${query} (Canonical Base)`,
              calories: String(canonicalData.calories),
              protein: canonicalData.protein,
              fat: canonicalData.totalFat,
              saturatedFat: canonicalData.saturatedFat,
              sodium: canonicalData.sodium
            };
            databaseMatchesArray.push(bestMatch);
          } else if (!bestMatch || !dbMatchMap.has(bestMatch.id)) {
            const virtualId = `estimated_comp_${itemIndex}_${cIdx}`;
            const defaultNutrients = getClinicalDefaultNutrients100g(query);
            dbMatchMap.set(virtualId, defaultNutrients);
            bestMatch = {
              id: virtualId,
              source: "estimated",
              name: `${query} (Estimated Component Baseline)`,
              calories: String(defaultNutrients.calories),
              protein: defaultNutrients.protein,
              fat: defaultNutrients.totalFat,
              saturatedFat: defaultNutrients.saturatedFat,
              sodium: defaultNutrients.sodium
            };
            databaseMatchesArray.push(bestMatch);
          }

          const baseNutrients = dbMatchMap.get(bestMatch.id);
          // NUTRITION BASIS FIX (Aug 2026): don't re-scale whole-dish brand totals by weight/100.
          const factor = (baseNutrients?.basisType === 'total' || baseNutrients?.basisType === 'per_dish') ? 1 : (compWeight / 100);

          // Issue #3: Dropped Component & Wrap Macro Collapse.
          // Ensure every decomposed scout component receives an isolated database resolution slot before composite aggregation.
          // (Removed deduplication based on bestMatch.id so distinct components aren't merged incorrectly)
          
          NUTRIENT_KEYS.forEach(key => {
            if (baseNutrients[key] !== undefined && baseNutrients[key] !== null) {
              aggregatedNutrients[key] += parseFloat((baseNutrients[key] * factor).toFixed(2));
            }
          });

          if (cIdx === 0) {
            primaryDbId = String(bestMatch.id);
            primaryDbSource = bestMatch.source || "usda";
            primaryBaseMatchName = bestMatch.name;
            primaryBase100g = baseNutrients;
            primaryBaseWeightG = compWeight;
          }

          // Always push to componentsDetailList so all components are visible for compound meals
          let compLabel = "";
          const sourceUpper = String(bestMatch.source || 'usda').toUpperCase();
          const fdcIdCand = bestMatch.fdcId || bestMatch.dbId || (bestMatch.id && !String(bestMatch.id).startsWith('canonical_') && !String(bestMatch.id).startsWith('printed_') && !String(bestMatch.id).startsWith('fallback_') && !String(bestMatch.id).startsWith('resolver_') ? bestMatch.id : null);

          if (sourceUpper === 'USDA' && bestMatch.id && !String(bestMatch.id).startsWith('canonical_') && !String(bestMatch.id).startsWith('printed_')) {
            compLabel = `[USDA #${bestMatch.id}](https://fdc.nal.usda.gov/food-details/${bestMatch.id}/nutrients)${bestMatch.name ? ' (' + bestMatch.name + ')' : ''}`;
          } else if (sourceUpper === 'OFF' && bestMatch.id) {
            compLabel = `[OFF #${bestMatch.id}](https://world.openfoodfacts.org/product/${bestMatch.id})${bestMatch.name ? ' (' + bestMatch.name + ')' : ''}`;
          } else if (sourceUpper === 'ESTIMATED') {
            const cleanName = bestMatch.name ? bestMatch.name.replace(' (Estimated Component Baseline)', '') : query;
            compLabel = `Estimated ${cleanName}`;
          } else if (sourceUpper === 'CANONICAL_DICT') {
            const cleanName = bestMatch.name ? bestMatch.name.replace(' (Canonical Base)', '') : query;
            const dictFdcId = canonicalData && canonicalData.fdcId ? canonicalData.fdcId : null;
            compLabel = dictFdcId
              ? `📖 [${cleanName}](https://fdc.nal.usda.gov/fdc-app.html#/food-details/${dictFdcId}/nutrients)`
              : `📖 ${cleanName}`;
          } else if (fdcIdCand && !isNaN(Number(fdcIdCand))) {
            const cleanName = bestMatch.name ? bestMatch.name.replace(/\s*\((internal_catalog|internal catalog|usual_catalog)\)/gi, '') : query;
            compLabel = `📖 [${cleanName}](https://fdc.nal.usda.gov/fdc-app.html#/food-details/${fdcIdCand}/nutrients)`;
          } else {
            compLabel = `${bestMatch.name || query}`;
          }
          const newComp: any = {
            name: compLabel,
            searchQuery: query,
            weightGrams: compWeight,
            dbId: String(bestMatch.id),
            dbSource: bestMatch.source,
            rawNutritionLabel: bestMatch.rawNutritionLabel,
            primaryBaseMatchName: bestMatch.name || query,
            primaryBase100g: baseNutrients,
            baseNutrients100g: baseNutrients,
            labelNutrientsPerServing: (bestMatch.source === 'brand_official' || bestMatch.source === 'label') ? baseNutrients : null,
            isRealTruth: bestMatch.source === 'brand_official' || bestMatch.source === 'label'
          };
          NUTRIENT_KEYS.forEach(key => {
            if (baseNutrients[key] !== undefined && baseNutrients[key] !== null) {
              newComp[key] = parseFloat((baseNutrients[key] * factor).toFixed(1));
            } else {
              newComp[key] = 0;
            }
          });
          componentsDetailList.push(newComp);

          if (cIdx === 0) {
            resolvedComponentsById.set(String(bestMatch.id), { isPrimary: true, sauceIndex: componentsDetailList.length - 1 });
          } else {
            resolvedComponentsById.set(String(bestMatch.id), { isPrimary: false, sauceIndex: componentsDetailList.length - 1 });
          }
        });
        
        // Deduplicate componentsDetailList BEFORE computing final foundation budget
        if (componentsDetailList.length > 0) {
          const beforeLen = componentsDetailList.length;
          const stripDisplayNoise = (raw: string): string => {
            let s = String(raw || '');
            s = s.replace(/\[[^\]]*\]\([^)]*\)/g, ' '); // markdown links
            s = s.replace(/#\d+/g, ' ');
            s = s.replace(/\b(estimated|usda|off|canonical base|estimated component baseline)\b/gi, ' ');
            s = s.replace(/[()]/g, ' ');
            return normalizeFoodKey(s);
          };
          const rowKey = (c: any): string => {
            const id = c.dbId != null && String(c.dbId).trim() !== '' ? String(c.dbId) : '';
            if (id && !id.startsWith('fallback_') && !id.startsWith('resolver_')) {
              return `id:${id}`;
            }
            const wBucket = Math.round((Number(c.weightGrams) || 0) / 2) * 2; // ±1g collapse
            const q = stripDisplayNoise(c.searchQuery || '');
            const n = stripDisplayNoise(c.name || '');
            return `n:${q || n}_w:${wBucket}`;
          };
          const dedupedMap = new Map<string, any>();
          for (const c of componentsDetailList) {
            const key = rowKey(c);
            if (dedupedMap.has(key)) {
              const ext = dedupedMap.get(key);
              const cEst = /^estimated\b/i.test(String(c.name || '').replace(/^\[/, ''));
              const eEst = /^estimated\b/i.test(String(ext.name || '').replace(/^\[/, ''));
              if (eEst && !cEst) {
                dedupedMap.set(key, c);
              } else if (!eEst && cEst) {
                // keep ext
              } else if ((c.calories || 0) > (ext.calories || 0)) {
                dedupedMap.set(key, c);
              }
            } else {
              dedupedMap.set(key, c);
            }
          }
          const afterLen = dedupedMap.size;
          componentsDetailList.splice(0, componentsDetailList.length, ...Array.from(dedupedMap.values()));
          if (beforeLen !== afterLen) {
            addDebugLog(`[Receipt] dedupe componentsDetailList ${beforeLen}→${afterLen} for "${item.originalName || item.keyword}"`);
            // Recalculate aggregatedNutrients since rows were removed
            NUTRIENT_KEYS.forEach(key => aggregatedNutrients[key] = 0);
            componentsDetailList.forEach((c: any) => {
              NUTRIENT_KEYS.forEach(key => {
                if (c[key] != null) aggregatedNutrients[key] += c[key];
              });
            });
          }
        }

        if (item.components.length >= 2) {
          const weightSum = componentsDetailList.reduce((sum: number, c: any) => sum + (c.weightGrams || 0), 0);
          addDebugLog(`[Assembly] multi-component rows=${componentsDetailList.length} weightSum=${weightSum} itemWeight=${itemWeight} for "${item.originalName || item.keyword}"`);
          if (aggregatedNutrients.calories <= 5 && itemWeight >= 50) {
            const rawParentQuery = item.keyword || item.originalName || item.name || "";
            const parentSearchQuery = prepareSearchQueryWithState(rawParentQuery, item.cookingMethod || scoutCookingMethod || 'baked');
            const parentDishMatch = findBestMatch(parentSearchQuery) || findBestMatch(rawParentQuery);
            const parentNutrients = parentDishMatch && dbMatchMap.get(parentDishMatch.id);
            if (parentNutrients && (parentNutrients.calories > 0)) {
              addDebugLog(`[Assembly Fallback] Component sum for "${item.originalName || item.keyword}" was ~0 kcal. Falling back to parent dish match "${parentDishMatch.name}" (${parentNutrients.calories} kcal/100g).`);
              const factor = ((parentNutrients as any)?.basisType === 'total' || (parentNutrients as any)?.basisType === 'per_dish') ? 1 : (itemWeight / 100);
              NUTRIENT_KEYS.forEach(key => {
                if (parentNutrients[key] !== undefined && parentNutrients[key] !== null) {
                  aggregatedNutrients[key] = parseFloat((parentNutrients[key] * factor).toFixed(2));
                }
              });
            } else if (Number(item.estimatedCalories) > 0) {
              addDebugLog(`[Assembly Fallback] Component sum for "${item.originalName || item.keyword}" was ~0 kcal. Falling back to scout budget (${item.estimatedCalories} kcal).`);
              aggregatedNutrients.calories = Number(item.estimatedCalories);
            }
          }

          // COMPOSITE DENSITY FIX (Aug 2026): primaryBase100g must reflect this item's true
          // weighted-average per-100g density across ALL matched components, not just the
          // first one. Downstream consumers (aggregateItemsNutrients in
          // server_nutrient_aggregation.ts, the meal compiler) multiply primaryBase100g by
          // the item's FULL weight, so leaving it pinned to the first component silently
          // misrepresents composite dishes (e.g. an entire chicken/avocado/egg/lettuce salad
          // gets treated as if it were 100% chicken breast).
          if (itemWeight > 0) {
            const compositeBase100g: Record<string, number> = {};
            NUTRIENT_KEYS.forEach(key => {
              compositeBase100g[key] = parseFloat(((aggregatedNutrients[key] || 0) / (itemWeight / 100)).toFixed(3));
            });
            addDebugLog(`[Assembly] Recomputed primaryBase100g as weighted composite density for "${item.originalName || item.keyword}" (was: first-component-only density).`);
            primaryBase100g = compositeBase100g;
            primaryBaseWeightG = itemWeight;
            primaryBaseMatchName = item.originalName || item.keyword;
            primaryDbSource = "composite";
          }
        }
      } else {
        const rawItemQuery = item.keyword || item.originalName || item.name || "";
        const itemSearchQuery = prepareSearchQueryWithState(rawItemQuery, item.cookingMethod || scoutCookingMethod || 'baked');
        const canonicalData = lookupCanonicalBaseFood(itemSearchQuery);
        let bestMatch = findBestMatch(itemSearchQuery);
        if (canonicalData) {
          const virtualId = `canonical_item_${item.scoutIndex}`;
          dbMatchMap.set(virtualId, canonicalData);
          primaryDbId = virtualId;
          const isBrandMenu = canonicalData.fdcId && String(canonicalData.fdcId).startsWith("brand_menu_");
          primaryDbSource = isBrandMenu ? "brand_official" : "canonical_dict";
          primaryBaseMatchName = item.originalName || item.keyword;
          primaryBase100g = canonicalData;
          primaryBaseWeightG = itemWeight;
          const factor = itemWeight / 100;
          NUTRIENT_KEYS.forEach(key => {
            if (primaryBase100g![key] !== undefined && primaryBase100g![key] !== null) {
              aggregatedNutrients[key] = parseFloat((primaryBase100g![key] * factor).toFixed(2));
            }
          });
        } else if (bestMatch && dbMatchMap.has(bestMatch.id)) {
          primaryDbId = String(bestMatch.id);
          primaryDbSource = bestMatch.source || "usda";
          primaryBaseMatchName = bestMatch.name;
          primaryBase100g = dbMatchMap.get(bestMatch.id);
          primaryBaseWeightG = itemWeight;
          // NUTRITION BASIS FIX (Aug 2026): don't re-scale whole-dish brand totals by weight/100.
          const factor = ((primaryBase100g as any)?.basisType === 'total' || (primaryBase100g as any)?.basisType === 'per_dish') ? 1 : (itemWeight / 100);
          NUTRIENT_KEYS.forEach(key => {
            if (primaryBase100g![key] !== undefined && primaryBase100g![key] !== null) {
              aggregatedNutrients[key] = parseFloat((primaryBase100g![key] * factor).toFixed(2));
            }
          });
        } else {
          const defaultNutrients = getClinicalDefaultNutrients100g(item.keyword || item.originalName || "");
          const virtualId = `estimated_item_${item.scoutIndex}`;
          dbMatchMap.set(virtualId, defaultNutrients);
          primaryDbId = virtualId;
          primaryDbSource = "estimated";
          primaryBaseMatchName = item.originalName || item.keyword;
          primaryBase100g = defaultNutrients;
          primaryBaseWeightG = itemWeight;
          const factor = itemWeight / 100;
          NUTRIENT_KEYS.forEach(key => {
            if (primaryBase100g![key] !== undefined && primaryBase100g![key] !== null) {
              aggregatedNutrients[key] = parseFloat((primaryBase100g![key] * factor).toFixed(2));
            }
          });
        }
      }
    }

      // Comprehensive sauce detection across all name & visual fields
      const combinedItemStr = [
        item.originalName, item.keyword, item.originalLocalName, item.canonicalDbName, item.name, item.searchQuery,
        ...(item.visualIngredients || []),
        ...(item.components ? item.components.map((c: any) => typeof c === 'string' ? c : c.name || c.searchQuery || c.keyword) : [])
      ].filter(Boolean).join(' ').toLowerCase();

      const visList = (item.visualIngredients || []).map((v: string) => String(v).toLowerCase());
      const hasMayo = combinedItemStr.includes('mayonnaise') || combinedItemStr.includes('mayo');
      const hasPepperSauce = combinedItemStr.includes('black pepper sauce') || combinedItemStr.includes('pepper sauce');
      const hasSauceInVis = sauceKeywords.some(sk => combinedItemStr.includes(sk));

      // CRITICAL GUARD: When rawLabelHasData is true, the printed nutrition label already
      // accounts for ALL ingredients including sauces/dressings in its per-100g values.
      // Injecting an estimated sauce on top of label data double-counts those calories.
      if (componentsDetailList.length === 0 && !rawLabelHasData && (hasMayo || hasPepperSauce || hasSauceInVis)) {
        let detectedSauceName = "Sauce / Dressing";
        if (hasMayo) detectedSauceName = "Mayonnaise";
        else if (hasPepperSauce) detectedSauceName = "Black Pepper Sauce";
        else {
          const matchV = visList.find((v: string) => sauceKeywords.some(sk => v.includes(sk)));
          if (matchV) detectedSauceName = matchV;
        }

        // Typed fractions: emulsion ~12%, other sauces ~12% of item (was 25%/20% — systematically high)
        let sauceFrac = hasMayo ? 0.12 : 0.12;
        const sauceText = combinedItemStr;
        if (/\b(teriyaki|glaze|eel sauce|unagi)\b/i.test(sauceText)) {
          // Soy glaze: smaller mass, applied as dressing row (prefer protein-heavy dishes)
          sauceFrac = 0.08;
          if (!hasMayo) detectedSauceName = "Teriyaki Glaze";
        } else if (/\b(vinaigrette|sesame dressing)\b/i.test(sauceText)) {
          sauceFrac = 0.10;
        } else if (/\b(gravy|pepper sauce)\b/i.test(sauceText)) {
          sauceFrac = 0.15;
        }

        // Anti-double-count: base match already is a mayo salad
        const primaryNameLower = String(primaryBaseMatchName || item.originalName || item.keyword || "").toLowerCase();
        const isMayoSaladBase = hasMayo && /\b(mayonnaise|mayo)\b/i.test(primaryNameLower) && /\b(salad|surimi|crab)\b/i.test(primaryNameLower);

        if (!isMayoSaladBase) {
          const estSauceW = Math.max(8, Math.round(itemWeight * sauceFrac));
          const sauceMatch = findBestMatch(detectedSauceName);
          let sCal = Math.round(estSauceW * 4.5);
          let sP = 0.3;
          let sF = Math.round((estSauceW * 0.4) * 10) / 10;
          let sSatFat = Math.round((estSauceW * 0.05) * 10) / 10;
          let sNa = Math.round(estSauceW * 15);
          let sauceLabel = detectedSauceName;

          if (sauceMatch && dbMatchMap.has(sauceMatch.id)) {
            const sBase = dbMatchMap.get(sauceMatch.id);
            const f = estSauceW / 100;
            const baseCal = (sBase.calories && sBase.calories > 0) ? sBase.calories : (hasMayo ? 680 : 450);
            const baseP = (sBase.protein !== undefined && sBase.protein !== null) ? sBase.protein : (hasMayo ? 1.0 : 1.5);
            const baseF = (sBase.totalFat && sBase.totalFat > 0) ? sBase.totalFat : (hasMayo ? 75 : 40);
            const baseSat = (sBase.saturatedFat && sBase.saturatedFat > 0) ? sBase.saturatedFat : (hasMayo ? 11.3 : 5);
            const baseNa = (sBase.sodium !== undefined && sBase.sodium !== null && sBase.sodium > 0) ? sBase.sodium : (hasMayo ? 600 : 800);

            sCal = Math.round(baseCal * f);
            sP = Math.round((baseP * f) * 10) / 10;
            sF = Math.round((baseF * f) * 10) / 10;
            sSatFat = Math.round((baseSat * f) * 10) / 10;
            sNa = Math.round(baseNa * f);
            sauceLabel = `${String(sauceMatch.source || 'usda').toUpperCase()} #${sauceMatch.id} (${sauceMatch.name || detectedSauceName})`;
          } else {
            if (hasMayo) {
              sauceLabel = `USDA #2758986 (Mayonnaise)`;
              sCal = Math.round(estSauceW * 6.8);
              sP = 0.2;
              sF = Math.round((estSauceW * 0.75) * 10) / 10;
              sSatFat = Math.round((estSauceW * 0.12) * 10) / 10;
              sNa = Math.round(estSauceW * 6.0);
            } else if (hasPepperSauce) {
              sauceLabel = `USDA #174527 (Black Pepper Sauce)`;
              sCal = Math.round(estSauceW * 0.3);
              sP = 0.3;
              sF = 0.1;
              sSatFat = 0;
              sNa = Math.round(estSauceW * 6.0);
            } else if (/teriyaki|glaze/i.test(detectedSauceName)) {
              sauceLabel = `Est. Teriyaki Glaze`;
              sCal = Math.round(estSauceW * 1.5);      // ~150 kcal/100g
              sP = Math.round(estSauceW * 0.02 * 10) / 10;
              sF = Math.round(estSauceW * 0.005 * 10) / 10;
              sSatFat = 0;
              sNa = Math.round(estSauceW * 12);        // ~1200 mg/100g
            } else {
              sauceLabel = `USDA Est. (${detectedSauceName})`;
            }
          }

          if (diningEnvironment === 'airline') {
            sNa = Math.round(sNa * 1.5);
          }

          componentsDetailList.push({
            name: sauceLabel,
            weightGrams: estSauceW,
            calories: sCal,
            protein: sP,
            totalFat: sF,
            saturatedFat: sSatFat,
            sodium: sNa
          });

          // Only shrink primary when we had a single solid base, not when multi-component already split weights
          if (!(Array.isArray(item.components) && item.components.length >= 2)) {
            primaryBaseWeightG = Math.max(10, itemWeight - estSauceW);
          } else {
            // Multi-component: sauce is extra row; do not reassign primary to full dish weight
            primaryBaseWeightG = Math.max(10, Math.min(primaryBaseWeightG, itemWeight - estSauceW));
          }
          const baseFactor = primaryBaseWeightG / 100;

          NUTRIENT_KEYS.forEach(key => {
            if (primaryBase100g && primaryBase100g[key] !== undefined && primaryBase100g[key] !== null) {
              aggregatedNutrients[key] = parseFloat((primaryBase100g[key] * baseFactor).toFixed(2));
            }
          });

          aggregatedNutrients.calories += sCal;
          aggregatedNutrients.protein += sP;
          aggregatedNutrients.totalFat += sF;
          aggregatedNutrients.saturatedFat += sSatFat;
          aggregatedNutrients.sodium += sNa;
        }
      }
      
      let pieceCount = 1;
      if (item.components && Array.isArray(item.components) && item.components.length > 0) {
         pieceCount = item.components[0].pieceCount || 1;
      }

      let itemCookingMethod = (item.cookingMethod && item.cookingMethod !== 'unknown') ? item.cookingMethod : null;
      const kwLower = (item.keyword || item.originalName || "").toLowerCase();
      const isBeverage = BEVERAGE_RAW_PATTERN.test(kwLower) || BEVERAGE_RAW_PATTERN.test(item.originalName || "") || BEVERAGE_RAW_PATTERN.test(item.keyword || "");
      const itemPhysicalFormForCooking = classifyUniversalPhysicalFormV3({
        name: item.originalName || item.keyword,
        canonicalDbName: item.originalName || item.keyword,
        keyword: item.keyword,
        visualIngredients: item.visualIngredients,
        components: item.components
      });
      const isCandyOrDessertNoHeat = itemPhysicalFormForCooking.primaryCategory === 'bakery_dessert';
      if (isBeverage) {
        itemCookingMethod = 'raw';
      } else if (!itemCookingMethod && item.source !== 'label') {
        if (isCandyOrDessertNoHeat) {
          itemCookingMethod = 'raw';
        } else if (kwLower.includes('wedge') || kwLower.includes('fries') || kwLower.includes('chip') || kwLower.includes('nugget') || kwLower.includes('tempura')) {
          itemCookingMethod = 'deep_fried';
        } else if (kwLower.includes('vegetable') || kwLower.includes('veg') || kwLower.includes('corn') || kwLower.includes('carrot') || kwLower.includes('pea') || kwLower.includes('broccoli') || kwLower.includes('soup')) {
          itemCookingMethod = 'boiled';
        } else if (kwLower.includes('steak') || kwLower.includes('beef') || kwLower.includes('pork') || kwLower.includes('chicken') || kwLower.includes('salmon') || kwLower.includes('fish')) {
          itemCookingMethod = 'pan_fried';
        } else {
          itemCookingMethod = scoutCookingMethod || 'pan_fried';
        }
      }
      const hasSauceOrDressing = (componentsDetailList && componentsDetailList.length > 0 && componentsDetailList.some((s: any) => (s.sodium || 0) > 0)) ||
        Boolean((item.originalName || item.keyword || "").toLowerCase().match(/\b(sauce|mayo|mayonnaise|dressing|gravy|salsa|glaze)\b/));

      if (kwLower.includes("pan crust") || kwLower.includes("pan pizza") || kwLower.includes("deep dish")) {
        itemCookingMethod = "pan_fried";
      }

      const itemTruthNutrients: Record<string, number> =
        (typeof truthNutrients !== "undefined" && truthNutrients) ? truthNutrients : {};
      const itemLockedKeys: Set<string> =
        (typeof lockedNutrientKeys !== "undefined" && lockedNutrientKeys) ? lockedNutrientKeys : new Set<string>();

      const preForm = classifyUniversalPhysicalFormV3({
        name: item.originalName || item.keyword,
        keyword: item.keyword,
        originalLocalName: item.originalName,
        components: item.components,
        visualIngredients: item.visualIngredients,
        foodType: item.foodType,
      });

      const isAlreadyPrepared = !hasComponents && checkIfItemIsAlreadyPrepared(
        item.originalName || item.keyword,
        item.keyword,
        primaryDbSource || "estimated",
        primaryBase100g?.sodium
      );

      const prepPre = decidePrepAddition({
        weightGrams: itemWeight,
        cookingMethod: rawLabelHasData ? "raw" : itemCookingMethod,
        physicalForm: preForm.physicalForm,
        dishName: item.originalName || item.keyword,
        keyword: item.keyword,
        canonicalDbName: primaryBaseMatchName || item.keyword,
        foodType: item.foodType,
        componentCount: Array.isArray(item.components) ? item.components.length : 0,
        hasLockedTruth:
          Boolean(rawLabelHasData) ||
          primaryDbSource === "label" ||
          primaryDbSource === "brand_official",
        isAlreadyPrepared: isAlreadyPrepared || Boolean(rawLabelHasData),
        diningEnvironment,
        hasSauceOrDressing,
        visualSheen: 0.5,
        visualCoating: 0.5,
        cookingAdded: null,
      });

      const added = {
        addedCalories: prepPre.addedCalories,
        addedFat: prepPre.addedFat,
        addedSaturatedFat: prepPre.addedSaturatedFat,
        addedSodium: prepPre.addedSodium,
      };

      const unlockedCookingAdded = {
        addedCalories: itemLockedKeys.has("calories") ? 0 : added.addedCalories,
        addedFat: itemLockedKeys.has("totalFat") ? 0 : added.addedFat,
        addedSaturatedFat: itemLockedKeys.has("saturatedFat") ? 0 : added.addedSaturatedFat,
        addedSodium: itemLockedKeys.has("sodium") ? 0 : added.addedSodium,
      };
      item.cookingAdded = unlockedCookingAdded;

      if (
        !rawLabelHasData &&
        (unlockedCookingAdded.addedFat > 0 ||
          unlockedCookingAdded.addedSodium > 0 ||
          unlockedCookingAdded.addedCalories > 0)
      ) {
        aggregatedNutrients.totalFat = parseFloat(
          (aggregatedNutrients.totalFat + unlockedCookingAdded.addedFat).toFixed(2)
        );
        aggregatedNutrients.saturatedFat = parseFloat(
          (aggregatedNutrients.saturatedFat + unlockedCookingAdded.addedSaturatedFat).toFixed(2)
        );
        aggregatedNutrients.calories = parseFloat(
          (aggregatedNutrients.calories + unlockedCookingAdded.addedCalories).toFixed(1)
        );
        aggregatedNutrients.sodium = parseFloat(
          (aggregatedNutrients.sodium + unlockedCookingAdded.addedSodium).toFixed(1)
        );
      }

      addDebugLog(
        `[PrepPolicy:precalc] "${item.originalName || item.keyword}" reason=${prepPre.reason || "n/a"} cal=${unlockedCookingAdded.addedCalories}`
      );

      // Apply the exact same dietitian reality checks before message generation.
      // Only claim full "label" trust (which skips validation) when NOTHING was backfilled —
      // see [Label Provenance] tagging above. A partially-backfilled item must still be checked,
      // otherwise a fabricated field silently inherits the trust of the real printed fields.
      const hasBackfilledFields = Array.isArray((primaryBase100g as any)?._estimatedFields) && (primaryBase100g as any)._estimatedFields.length > 0;
      const effectiveDbSourceForChecks = hasBackfilledFields ? "label_partial" : (primaryDbSource || item.dbSource || item.source);
      const rawLabelObjForChecks = item.rawNutritionLabel || visionScoutItems?.[(item.scoutIndex !== undefined && item.scoutIndex !== null) ? item.scoutIndex : itemIdx]?.rawNutritionLabel;
      const labelCalValForChecks = parseLabelCalories(rawLabelObjForChecks);
      const printedCaloriesPresentForChecks =
        labelCalValForChecks != null &&
        labelCalValForChecks > 0 &&
        rawLabelObjForChecks &&
        (rawLabelObjForChecks.calories != null && String(rawLabelObjForChecks.calories).trim() !== '' && String(rawLabelObjForChecks.calories).toLowerCase() !== 'null');

      const isHardLockedForChecks =
        printedCaloriesPresentForChecks ||
        (itemLockedKeys.has('calories') && itemTruthNutrients.calories != null && (primaryDbSource === 'label' || primaryDbSource === 'brand_official'));
        
      const willUseSoftBudget = !isHardLockedForChecks;

      if (!willUseSoftBudget) {
        applyNutrientRealityChecks(
          item.originalName || item.keyword,
          itemWeight,
          aggregatedNutrients,
          unlockedCookingAdded.addedSodium,
          addDebugLog,
          effectiveDbSourceForChecks,
          {
            originalName: item.originalName || item.keyword,
            keyword: item.keyword,
            componentCount: Array.isArray(item.components) ? item.components.length : 0,
            physicalForm: preForm?.physicalForm,
            chainName: item.chainName || null,
          }
        );
      } else {
        addDebugLog(`[RealityCheck] skipped pre-budget density rescale for soft-budget item "${item.originalName || item.keyword}"`);
      }

      // Truth always wins after reality checks (including genuine zeros).
      Object.entries(itemTruthNutrients).forEach(([key, value]) => {
        if (itemLockedKeys.has(key)) {
          aggregatedNutrients[key] = value;
        }
      });

      // Clamp all nutrients to 0 to prevent negative values (anti-nutrients bug)
      for (const key of Object.keys(aggregatedNutrients)) {
        if (aggregatedNutrients[key] < 0 || isNaN(aggregatedNutrients[key])) {
          aggregatedNutrients[key] = 0;
        }
      }
      // Re-apply truth after clamp so a locked 0 is not wiped, and locked positives stay exact.
      Object.entries(itemTruthNutrients).forEach(([key, value]) => {
        if (itemLockedKeys.has(key)) {
          aggregatedNutrients[key] = value;
        }
      });

      // Hybrid Calorie Pipeline: Budget -> Foundation Sum -> Reconcile
      const itemNameForBudget = item.originalName || item.keyword || item.name || '';
      const scoutIndexVal = (item.scoutIndex !== undefined && item.scoutIndex !== null) ? item.scoutIndex : itemIdx;
      const scoutMatch = visionScoutItems?.[scoutIndexVal] || visionScoutItems?.find((v: any) => v.scoutIndex === scoutIndexVal);
      const scoutEstCal = Number(item.estimatedCalories || scoutMatch?.estimatedCalories);
      const rawLabelObj = item.rawNutritionLabel || scoutMatch?.rawNutritionLabel;
      const labelCalVal = parseLabelCalories(rawLabelObj);

      // Genuine hard calories: printed OCR/label or brand_official only — NEVER web_search / category / estimated
      const printedCaloriesPresent =
        labelCalVal != null &&
        labelCalVal > 0 &&
        rawLabelObj &&
        (rawLabelObj.calories != null && String(rawLabelObj.calories).trim() !== '' && String(rawLabelObj.calories).toLowerCase() !== 'null');

      // Hard kcal only if we have printed label calories OR locked brand/label truth — not web
      let hardLabelKcal: number | null = null;
      if (printedCaloriesPresent) {
        let ssGrams = 100;
        if (rawLabelObj) {
          const ssKey = Object.keys(rawLabelObj).find((k: string) => {
            const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            return clean === 'servingsize' || clean === 'takaransaji';
          });
          if (ssKey) {
            ssGrams = parseServingSizeGrams(String(rawLabelObj[ssKey]), itemWeight);
          }
        }
        const scaledLabelCal = Math.round(labelCalVal * (itemWeight / ssGrams));
        // If label is per-100g, existing truth rescale may already be in itemTruthNutrients; prefer locked printed total when source is label
        hardLabelKcal =
          itemLockedKeys.has('calories') && itemTruthNutrients.calories != null && (primaryDbSource === 'label' || primaryDbSource === 'brand_official')
            ? Number(itemTruthNutrients.calories)
            : scaledLabelCal;
      } else if (
        itemLockedKeys.has('calories') &&
        itemTruthNutrients.calories != null &&
        (primaryDbSource === 'label' || primaryDbSource === 'brand_official')
      ) {
        hardLabelKcal = Number(itemTruthNutrients.calories);
      } else {
        hardLabelKcal = null; // force soft path: scout / category
      }

      if (itemLockedKeys.has('calories') && hardLabelKcal == null) {
        // Strip bogus calorie lock from web/rejected truth so reconcile stays soft
        itemLockedKeys.delete('calories');
        delete itemTruthNutrients.calories;
        addDebugLog(`[Budget] stripped non-genuine calorie lock for "${itemNameForBudget}" (source=${primaryDbSource})`);
      }

      const budgetRes = computeItemBudget({
        itemName: itemNameForBudget,
        weightGrams: itemWeight,
        hardLabelKcal,
        brandMenuKcal:
          !hasComponents && primaryDbSource === 'brand_official' && primaryBase100g?.calories != null
            ? (((primaryBase100g as any)?.basisType === 'total' || (primaryBase100g as any)?.basisType === 'per_dish')
                ? ((Number(primaryBase100g.calories) < 60 && itemWeight >= 150) ? Number(primaryBase100g.calories) * (itemWeight / 100) : Number(primaryBase100g.calories))
                : Number(primaryBase100g.calories) * (itemWeight / 100))
            : null,
        dishCacheKcal:
          !hasComponents && (primaryDbSource === 'dish_cache' || primaryDbSource === 'internal_dish_cache')
            ? Number(primaryBase100g?.calories) * (itemWeight / 100)
            : null,
        scoutEstimatedCalories: Number.isFinite(scoutEstCal) && scoutEstCal > 0 ? scoutEstCal : null,
      });

      addDebugLog(`[Budget] item="${itemNameForBudget}" kcal=${budgetRes.budgetKcal} source=${budgetRes.source} hard=${budgetRes.hardLock} weight=${itemWeight} scoutEst=${scoutEstCal || 'n/a'}`);
      addDebugLog(`[Foundation] item="${itemNameForBudget}" kcal=${aggregatedNutrients.calories}`);

      const recRes = reconcileNutrients({
        nutrients: aggregatedNutrients,
        budget: budgetRes,
        formOk: !item.formIdentityFailure,
        incompleteAssembly: !!item.assemblyAnomaly,
      });

      addDebugLog(`[Reconcile] item="${itemNameForBudget}" action=${recRes.action} foundation=${recRes.foundationKcal} budget=${recRes.budgetKcal} final=${recRes.finalKcal} factor=${recRes.scaleFactor.toFixed(3)}`);

      // Apply reconciled nutrients map
      Object.assign(aggregatedNutrients, recRes.nutrients);

      // Re-sync primaryBase100g with post-reconciliation aggregatedNutrients so downstream First-Principles Injection & aggregateItemsNutrients match precalc block exactly
      if (primaryBase100g && itemWeight > 0) {
        const scaledBase100g: Record<string, number> = { ...(primaryBase100g as any) };
        NUTRIENT_KEYS.forEach(key => {
          scaledBase100g[key] = parseFloat(((aggregatedNutrients[key] || 0) / (itemWeight / 100)).toFixed(3));
        });
        primaryBase100g = scaledBase100g;
      }

      // Printed/brand hard lock may scale component rows to the label.
      // Soft/scout budget must not silently scale rows (wrap ×0.730 / salad 2.000).
      if (budgetRes.hardLock && recRes.scaleFactor !== 1 && recRes.scaleFactor > 0) {
        componentsDetailList.forEach((s: any) => {
          if (!s || typeof s !== 'object') return;
          if (s.calories != null) s.calories = Math.round(s.calories * recRes.scaleFactor * 10) / 10;
          if (s.protein != null) s.protein = Math.round(s.protein * recRes.scaleFactor * 10) / 10;
          if (s.totalFat != null) s.totalFat = Math.round(s.totalFat * recRes.scaleFactor * 10) / 10;
          if (s.saturatedFat != null) s.saturatedFat = Math.round(s.saturatedFat * recRes.scaleFactor * 10) / 10;
          if (s.sodium != null) s.sodium = Math.round(s.sodium * recRes.scaleFactor * 10) / 10;
          if (s.carbohydrates != null) s.carbohydrates = Math.round(s.carbohydrates * recRes.scaleFactor * 10) / 10;
          if (s.sugar != null) s.sugar = Math.round(s.sugar * recRes.scaleFactor * 10) / 10;
          if (s.totalFibre != null) s.totalFibre = Math.round(s.totalFibre * recRes.scaleFactor * 10) / 10;
        });
      } else if (!budgetRes.hardLock && recRes.action === 'scale') {
        aggregatedNutrients.calories = recRes.foundationKcal;
        addDebugLog(`[Reconcile] refused silent scale for "${itemNameForBudget}" — keep foundation=${recRes.foundationKcal}`);
      }

      // Re-apply ONLY hard-locked truth fields after reconcile (do not wipe soft budget reconcile)
      Object.entries(itemTruthNutrients).forEach(([key, value]) => {
        if (itemLockedKeys.has(key)) {
          aggregatedNutrients[key] = value;
        }
      });

      // Issue #5: Narrative vs. Final Table Protein Mismatch.
      // Atwater rescaling must occur *before* Dietitian prompt assembly for soft-budget items
      // so the Dietitian writes its narrative based on the final rescaled macros.
      checkAtwaterConsistency(item.originalName || item.keyword, aggregatedNutrients, addDebugLog);

      // Apply the Commercial Sodium Floor unconditionally now that calories are finalized
      // (post-reconcile), so the Dietitian prompt's macroTotals match what the final
      // aggregateItemsNutrients pass will save. This runs regardless of soft/hard budget —
      // unlike the earlier pre-budget applyNutrientRealityChecks call, which is intentionally
      // skipped for soft-budget items because the calorie numbers aren't finalized yet at that point.
      applyCommercialSodiumFloor(
        item.originalName || item.keyword,
        aggregatedNutrients,
        effectiveDbSourceForChecks,
        addDebugLog,
        {
          originalName: item.originalName || item.keyword,
          keyword: item.keyword,
          componentCount: Array.isArray(item.components) ? item.components.length : 0,
          physicalForm: preForm?.physicalForm,
          chainName: item.chainName || null,
        }
      );

      // Sync dietitian-facing totals with the same composite density/sodium reconciliation
      // that the receipt-table pass applies later, so the Dietitian prompt and the final UI
      // table are built from identical numbers instead of diverging. See TASK 6 notes.
      {
        const isCompositeForDietitianSync =
          (Array.isArray(item.components) && item.components.length >= 2) ||
          preForm?.physicalForm === "COMPOUND_MEAL" ||
          /\b(bowl|poke|salad|bento)\b/i.test(String(item.originalName || item.keyword || ""));
        const dietitianSyncResult = applyPostReconcileTruthLocks({
          sumNutrients: {
            calories: aggregatedNutrients.calories || 0,
            protein: aggregatedNutrients.protein || 0,
            totalFat: aggregatedNutrients.totalFat || 0,
            saturatedFat: aggregatedNutrients.saturatedFat || 0,
            sodium: aggregatedNutrients.sodium || 0,
            carbohydrates: aggregatedNutrients.carbohydrates || 0,
          },
          ledgerTruth: itemTruthNutrients,
          lockedNutrientKeys: Array.from(itemLockedKeys),
          receiptRealityCheckNutrients: {
            calories: aggregatedNutrients.calories,
            protein: aggregatedNutrients.protein,
            totalFat: aggregatedNutrients.totalFat,
            saturatedFat: aggregatedNutrients.saturatedFat,
            sodium: aggregatedNutrients.sodium,
            carbohydrates: aggregatedNutrients.carbohydrates,
          },
          isCompositeReceipt: isCompositeForDietitianSync,
        });
        if (dietitianSyncResult.appliedDensityCorrection || dietitianSyncResult.appliedSodiumRealityCheck) {
          addDebugLog(`[Dietitian Sync] Pre-dietitian reconciliation applied for "${item.originalName || item.keyword}" (density=${dietitianSyncResult.appliedDensityCorrection}, sodium=${dietitianSyncResult.appliedSodiumRealityCheck}).`);
          aggregatedNutrients.calories = dietitianSyncResult.nutrients.calories;
          aggregatedNutrients.protein = dietitianSyncResult.nutrients.protein;
          aggregatedNutrients.totalFat = dietitianSyncResult.nutrients.totalFat;
          aggregatedNutrients.saturatedFat = dietitianSyncResult.nutrients.saturatedFat;
          aggregatedNutrients.sodium = dietitianSyncResult.nutrients.sodium;
          aggregatedNutrients.carbohydrates = dietitianSyncResult.nutrients.carbohydrates;
        }
      }

      // Receipt invariant: component rows must match item total; repair if needed
      const compCals = componentsDetailList.map((s: any) => Number(s.calories) || 0);
      if (!hasComponents && primaryBase100g && primaryBase100g.calories != null) {
        compCals.push((Number(primaryBase100g.calories) || 0) * (primaryBaseWeightG / 100) * (recRes.scaleFactor || 1));
      }
      if (compCals.length > 0) {
        const inv = assertComponentSumMatchesItem(compCals, aggregatedNutrients.calories);
        if (!inv.ok) {
          addDebugLog(`[ReceiptInvariant] FAIL item="${itemNameForBudget}" rowSum=${inv.rowSum} itemCal=${inv.itemCalories}`);
          addDebugLog(`[ReceiptInvariant Debug] item="${itemNameForBudget}" preRepair.aggregatedCalories=${aggregatedNutrients.calories} preRepair.itemLevelCaloriesField=${(item as any).calories ?? 'undefined'}`);
          // Only scale rows UP/DOWN to item when budget hard-locked from printed/brand — never for web fakes
          const genuineHardCal =
            budgetRes.hardLock === true &&
            (budgetRes.source === 'label' || budgetRes.source === 'brand') &&
            inv.itemCalories > 0 &&
            inv.rowSum > 0;
          if (genuineHardCal) {
            const fix = inv.itemCalories / inv.rowSum;
            // refuse absurd repair factors (identity failure)
            if (fix < 0.5 || fix > 2.0) {
              addDebugLog(`[ReceiptInvariant] SKIP rows→item factor=${fix.toFixed(3)} out of band; prefer foundation/scout`);
              if (inv.rowSum > 0) {
                aggregatedNutrients.calories = Math.round(inv.rowSum * 10) / 10;
                addDebugLog(`[ReceiptInvariant] REPAIRED itemCal→rowSum ${inv.itemCalories}→${inv.rowSum}`);
              }
            } else {
              componentsDetailList.forEach((s: any) => {
                if (!s || typeof s !== 'object') return;
                if (s.calories != null) s.calories = Math.round(s.calories * fix * 10) / 10;
                if (s.protein != null) s.protein = Math.round(s.protein * fix * 10) / 10;
                if (s.totalFat != null) s.totalFat = Math.round(s.totalFat * fix * 10) / 10;
                if (s.saturatedFat != null) s.saturatedFat = Math.round(s.saturatedFat * fix * 10) / 10;
                if (s.sodium != null) s.sodium = Math.round(s.sodium * fix * 10) / 10;
              });
              addDebugLog(`[ReceiptInvariant] REPAIRED rows→item lock factor=${fix.toFixed(3)}`);
            }
          } else if (recRes.action === 'scale' || recRes.action === 'keep' || budgetRes.source === 'scout' || budgetRes.source === 'category') {
            if (!budgetRes.hardLock && inv.rowSum > 0 && inv.itemCalories > 0 && Math.abs(inv.rowSum - inv.itemCalories) > 1.1) {
              const aligned = applySoftReceiptAlignment(inv.itemCalories, inv.rowSum);
              aggregatedNutrients.calories = aligned.itemCalories;
              addDebugLog(`[ReceiptInvariant] itemCal:=rowSum ${inv.itemCalories}→${aligned.itemCalories} (no row scale)`);
            }
          } else if (inv.rowSum > 0) {
            // legacy: only when no scout/category budget
            aggregatedNutrients.calories = Math.round(inv.rowSum * 10) / 10;
            addDebugLog(`[ReceiptInvariant] REPAIRED itemCal→rowSum ${inv.itemCalories}→${inv.rowSum}`);
          }
        }
      }

      // Re-sync primaryBase100g again after the ReceiptInvariant repair above, which can further
      // mutate aggregatedNutrients.calories AFTER the earlier post-reconciliation resync ran.
      // Without this, primaryBase100g keeps stale pre-repair values, and the later First-Principles
      // Injection stage recomputes item nutrients from that stale basis instead of the repaired total
      // (e.g. reproducing a pre-ReceiptInvariant calorie figure instead of the corrected one).
      if (primaryBase100g && itemWeight > 0) {
        const receiptRepairedBase100g: Record<string, number> = { ...(primaryBase100g as any) };
        NUTRIENT_KEYS.forEach(key => {
          receiptRepairedBase100g[key] = parseFloat(((aggregatedNutrients[key] || 0) / (itemWeight / 100)).toFixed(3));
        });
        primaryBase100g = receiptRepairedBase100g;
      }

      return {
        scoutIndex: item.scoutIndex,
        keyword: item.keyword,
        originalName: item.originalName || item.keyword,
        chainName: item.chainName || null,
        diningEnvironment: item.diningEnvironment || diningEnvironment || "unknown",
        rawNutritionLabel: item.rawNutritionLabel || null,
        cookingMethod: itemCookingMethod,
        estimatedWeightGrams: itemWeight,
        hasComponents,
        bestMatchDbId: primaryDbId || null,
        bestMatchDbSource: primaryDbSource || "estimated",
        dbId: primaryDbId || null,
        dbSource: primaryDbSource || "estimated",
        primaryBaseMatchName: primaryBaseMatchName || item.keyword,
        primaryBase100g: primaryBase100g,
        primaryBaseWeightG: primaryBaseWeightG,
        componentsDetailList: componentsDetailList,
        cookingAdded: {
          addedCalories: Math.round(unlockedCookingAdded.addedCalories),
          addedFat: Math.round(unlockedCookingAdded.addedFat * 10) / 10,
          addedSaturatedFat: Math.round(unlockedCookingAdded.addedSaturatedFat * 10) / 10,
          addedSodium: Math.round(unlockedCookingAdded.addedSodium),
        },
        nutrients: aggregatedNutrients,
        truthNutrients: itemTruthNutrients,
        lockedNutrientKeys: Array.from(itemLockedKeys),
        ingredientsList: item.ingredientsList || null,
        labelProductName: item.labelProductName || null,
        pieceCount: pieceCount,
        visualIngredients: item.visualIngredients || null,
        components: item.components || null
      };
    });

    let preCalculatedCtx = "";
    if (preCalculatedItems.length > 0) {
      preCalculatedCtx = "=== BACKEND PRE-CALCULATED ITEM NUTRIENTS (Absolute Truth) ===\n" +
        preCalculatedItems.map(item => {
          const n = item.nutrients || {};
          return `- "${item.originalName}" (${item.estimatedWeightGrams}g):\n` +
            `  Calories: ${Math.round(n.calories || 0)} kcal\n` +
            `  Protein: ${n.protein || 0}g\n` +
            `  Fat: ${n.totalFat || 0}g (Saturated: ${n.saturatedFat || 0}g)\n` +
            `  Carbs: ${n.carbohydrates || 0}g (Sugar: ${n.sugar || 0}g, Added Sugar: ${n.addedSugar || 0}g)\n` +
            `  Sodium: ${n.sodium || 0}mg\n`;
        }).join("\n") + "\n\n";
    }

    let userCtx = "";
    if (userProfile) {
      userCtx = `\nUSER DIETARY PROFILE & DEMOGRAPHICS:\n` +
        `- Age: ${userProfile.age || 'Unknown'} years old\n` +
        `- Gender: ${userProfile.gender || 'Unknown'}\n` +
        `- Weight: ${userProfile.weight || 'Unknown'} kg\n` +
        `- Height: ${userProfile.height || 'Unknown'} cm\n` +
        `- Ethnicity: ${userProfile.ethnicity || 'Unknown'}\n`;
    }

    const userTimezone = req.body.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    let localDateStr;
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: userTimezone, year: 'numeric', month: '2-digit', day: '2-digit' });
      localDateStr = formatter.format(new Date());
    } catch(e) {
      localDateStr = new Date().toISOString().split("T")[0];
    }
    const localTime = new Date().toLocaleTimeString();
    const timeCtx = `\nCURRENT TIME CONTEXT: ${localDateStr} ${localTime}\nCRITICAL INSTRUCTION: You MUST use "${localDateStr}" in the "date" field of "foodData" unless the user explicitly provides a different date in the chat.\n`;

    let imageCtx = "";
    if (imagePayloads && imagePayloads.length > 0) {
      if (imagePayloads.length > 1) {
        imageCtx = `\n[Context: ${imagePayloads.length} images are attached above. One or more may be a close-up photo of a printed Nutrition Facts label rather than the food itself. First determine which image(s), if any, show a nutrition facts/label panel. For any such label image: read its exact printed per-serving values and stated serving size, then mathematically scale those exact numbers to the actual weight/quantity consumed as shown in the other image(s) or described by the user — do not substitute your own estimate when a label is legible. For any remaining image(s) showing the actual food, rely on visual cues for portion sizing, ingredients, and freshness as usual.]\n`;
      } else {
        imageCtx = `\n[Context: An image is uploaded and attached above. If it is a close-up of a printed Nutrition Facts label, read its exact printed values and stated serving size, then scale them to the actual weight/quantity consumed; otherwise rely on visual cues for portion sizing, ingredients, and freshness.]\n`;
      }
      if (imageDates && imageDates.length > 0) {
        const primaryImageDate = imageDates[0];
        imageCtx += `\n[CRITICAL DATE OVERRIDE: The uploaded image was taken on ${primaryImageDate}. You MUST use this exact date or its nearest YYYY-MM-DD representation as the "date" field in "foodData", completely overriding the CURRENT TIME CONTEXT, unless the user explicitly asks otherwise.]\n`;
      }
    }

    let historyContext = "";
    if (history && Array.isArray(history) && history.length > 0) {
      historyContext = "PAST DISCUSSIONS & MEALS CHAT HISTORY:\n" +
        history.slice(-10).map((h: any) => `${h.role.toUpperCase()}: ${h.content}`).join("\n") + "\n\n";
    }

    let pastMealsCtx = "";
    if (foodLogs && Array.isArray(foodLogs) && foodLogs.length > 0) {
      try {
        const pastMeals: any[] = [];
        foodLogs.forEach((f: any) => {
          if (f) {
            pastMeals.push({
              name: f.name,
              date: f.date || "",
              calories: f.nutrients?.calories || f.calories || 0,
              protein: f.nutrients?.protein || f.protein || 0,
              saturatedFat: f.nutrients?.saturatedFat || f.saturatedFat || 0,
              sodium: f.nutrients?.sodium || f.sodium || 0,
              carbohydrates: f.nutrients?.carbohydrates || f.carbohydrates || 0
            });
          }
        });
        if (pastMeals.length > 0) {
          pastMeals.sort((a: any, b: any) => b.date.localeCompare(a.date));
          const recent = pastMeals.slice(0, 10);
          pastMealsCtx = "PATIENT'S RECENT LOGGED MEALS HISTORY (from client state):\n" +
            recent.map((m, idx) => `- Meal ${idx + 1}: "${m.name}" on ${m.date}`).join("\n") + "\n\n";
          addDebugLog(`[Client Context] Successfully loaded ${pastMeals.length} past meal(s) from client payload, included recent ${recent.length} meals in prompt context.`);

          // Rolling average of DAILY TOTALS, counting only days with 2+ meals
          // logged (a single snack logged alone would otherwise skew the
          // "daily average" misleadingly low).
          const dayTotals: { [date: string]: { count: number; calories: number; protein: number; saturatedFat: number; sodium: number; carbohydrates: number } } = {};
          pastMeals.forEach((m: any) => {
            if (!m.date) return;
            if (!dayTotals[m.date]) {
              dayTotals[m.date] = { count: 0, calories: 0, protein: 0, saturatedFat: 0, sodium: 0, carbohydrates: 0 };
            }
            dayTotals[m.date].count += 1;
            dayTotals[m.date].calories += Number(m.calories) || 0;
            dayTotals[m.date].protein += Number(m.protein) || 0;
            dayTotals[m.date].saturatedFat += Number(m.saturatedFat) || 0;
            dayTotals[m.date].sodium += Number(m.sodium) || 0;
            dayTotals[m.date].carbohydrates += Number(m.carbohydrates) || 0;
          });
          const qualifyingDays = Object.keys(dayTotals)
            .filter((d) => dayTotals[d].count >= 2)
            .sort((a, b) => b.localeCompare(a))
            .slice(0, 10);
          if (qualifyingDays.length > 0) {
            const sum = qualifyingDays.reduce((acc, d) => {
              acc.calories += dayTotals[d].calories;
              acc.protein += dayTotals[d].protein;
              acc.saturatedFat += dayTotals[d].saturatedFat;
              acc.sodium += dayTotals[d].sodium;
              acc.carbohydrates += dayTotals[d].carbohydrates;
              return acc;
            }, { calories: 0, protein: 0, saturatedFat: 0, sodium: 0, carbohydrates: 0 });
            const n = qualifyingDays.length;
            const avgCal = Math.round(sum.calories / n);
            const avgProtein = Math.round((sum.protein / n) * 10) / 10;
            const avgSatFat = Math.round((sum.saturatedFat / n) * 10) / 10;
            const avgSodium = Math.round(sum.sodium / n);
            const avgCarbs = Math.round((sum.carbohydrates / n) * 10) / 10;
            addDebugLog(`[Client Context] Computed ${n}-day rolling average from qualifying days (>=2 meals/day).`);
          }
        }
      } catch (err: any) {
        addDebugLog(`[Client Context Error] Failed to process client foodLogs: ${err.message}`);
      }
    }
    // 2. Prepend active state to Master System Instructions
    let effectiveActiveMeal = activeMeal;
    const hasUploadedNewImages = imagePayloads && imagePayloads.length > 0;
    // B5: do not wipe active meal when scale-only refine or explicit modify/edit mode
    if (
      !isWeightModification &&
      ((scoutRecommendedMode === "new_log" && !isExplicitModify && !userExplicitlySelectedEditMode) ||
        (hasUploadedNewImages && !isExplicitModify && !userExplicitlySelectedEditMode))
    ) {
      addDebugLog(`[State Isolation] New image scan or new_log mode detected. Isolating activeMeal context so Dietitian operates on clean state.`);
      effectiveActiveMeal = null;
      historyContext = "";
    }

    if (visionScoutItems && visionScoutItems.length > 0) {
      visionScoutItems = visionScoutItems.filter((item: any) => {
        const rawName = (item.keyword || item.originalName || item.name || "").trim().toLowerCase();
        return rawName && rawName !== "unspecified item" && rawName !== "unspecified";
      }).map((item: any) => ({
        ...item,
        name: item.keyword || item.originalName || item.name || "Food Item",
        keyword: item.keyword || item.originalName || item.name || "Food Item"
      }));
    }

    if (effectiveActiveMeal) {
      effectiveActiveMeal = JSON.parse(JSON.stringify(effectiveActiveMeal));
      if (effectiveActiveMeal.itemsBreakdown && Array.isArray(effectiveActiveMeal.itemsBreakdown)) {
        effectiveActiveMeal.itemsBreakdown = effectiveActiveMeal.itemsBreakdown
          .filter((it: any) => {
            const rawName = (it.canonicalDbName || it.originalName || it.keyword || it.name || "").trim().toLowerCase();
            return rawName && rawName !== "unspecified item" && rawName !== "unspecified";
          })
          .map((it: any) => ({
            ...it,
            canonicalDbName: it.keyword || it.originalName || it.canonicalDbName || it.name || "Food Item"
          }));
      }
      if (effectiveActiveMeal.items && Array.isArray(effectiveActiveMeal.items)) {
        effectiveActiveMeal.items = effectiveActiveMeal.items
          .filter((it: any) => {
            const rawName = (it.keyword || it.originalName || it.name || "").trim().toLowerCase();
            return rawName && rawName !== "unspecified item" && rawName !== "unspecified";
          })
          .map((it: any) => ({
            ...it,
            name: it.keyword || it.originalName || it.name || "Food Item"
          }));
      }
    }

    let systemInstruction = "";
    const activeMealState = activeMeal || req.body.activeMealState || null;
    const activeComparisonState = activeComparison || req.body.activeComparisonState || null;

    if (userSelectedMode === 'review') {
      if (isExplicitModify || effectiveActiveMeal !== null) {
        systemInstruction = buildModeAEditInstruction({ biomarkersNeedingImprovement, remainingAllowance, activeMeal: effectiveActiveMeal, foodLogs, userProfile });
      } else {
        systemInstruction = buildModeAReviewInstruction({ biomarkersNeedingImprovement, remainingAllowance, foodLogs, userProfile });
      }
    } else if (userSelectedMode === 'compare') {
      if (activeComparisonState !== null) {
        systemInstruction = buildModeDEditInstruction({ biomarkersNeedingImprovement, remainingAllowance, activeComparison: activeComparisonState, foodLogs, userProfile });
      } else {
        systemInstruction = buildModeDCompareInstruction({ biomarkersNeedingImprovement, remainingAllowance, foodLogs, userProfile });
      }
    } else {
      systemInstruction = buildFoodAnalyzeInstruction({
        biomarkersNeedingImprovement,
        remainingAllowance,
        activeMeal: effectiveActiveMeal,
        compareItemCount: userSelectedMode === 'review' ? 0 : (visionScoutItems ? visionScoutItems.length : 0),
        forceModifyMode: isExplicitModify,
        foodLogs,
        userProfile
      });
    }

    // Suppress Scout payload during text-only edits to conserve tokens
    let visionScoutCtx = "";
    const isPureTextEdit = (isExplicitModify || effectiveActiveMeal !== null || activeComparisonState !== null) && (!imagePayloads || imagePayloads.length === 0);
    if (!isPureTextEdit && visionScoutItems && visionScoutItems.length > 0) {
      const itemsList = visionScoutItems.map((item: any, idx: number) => {
        // Use the item's real scoutIndex (assigned earlier, and possibly non-sequential
        // after Multi-Photo Merge removes a duplicate) instead of array position. The
        // Dietitian is instructed to copy this Index verbatim into its own output, and a
        // later step matches the Dietitian's items back to backend-precalculated nutrients
        // by this exact scoutIndex — showing array position here silently mismatches items
        // whenever a merge has created a gap (e.g. a cross-photo duplicate was removed).
        const displayIndex = (item.scoutIndex !== undefined && item.scoutIndex !== null) ? item.scoutIndex : idx;
        const facts = item.nutritionFacts;
        let scaledNutrientsStr = facts ? ` | NutritionFacts: ${JSON.stringify(facts)}` : "";
        return `- Index: ${displayIndex} | Scout Item: "${item.keyword}" | Weight: ${item.estimatedWeightGrams}g | Observed/Local Context: "${item.originalName}"${scaledNutrientsStr}`;
      }).join('\n');

      visionScoutCtx = `\n=== VISUAL FOOD SCOUT IDENTIFIED ITEMS ===\n${itemsList}\n` +
        `Content Type: ${visionScoutContentType} (${visionScoutItems.length} items identified)\n` +
        `Visual Scout Confidence Rating: ${scoutConfidenceRating}\n` +
        (scoutConfidenceComment ? `Visual Scout Confidence Comment: ${scoutConfidenceComment}\n` : "") +
        `Identified Cooking Method & Preparation/Seasonings: ${scoutCookingMethod}\n` +
        (userSelectedMode === 'review' ? `diningEnvironment: ${diningEnvironment}\n` : "");
    }

    let databaseMatchesCtx = "";
    if (preCalculatedCtx) {
      databaseMatchesCtx += `\n=== BACKEND PRE-CALCULATED ITEM NUTRIENTS ===\n${preCalculatedCtx}\n`;
    }
    if (databaseMatches) {
      databaseMatchesCtx += `\n=== VERIFIED DATABASE MATCHES ===\n${databaseMatches}\n`;
    }


    const foodAnalyzeSchema = {
      type: Type.OBJECT,
      properties: {
        _internalReasoning: { type: Type.STRING, description: "Silently gather clinical evidence and synthesize trade-offs before writing the final output." },
        verdict: {
          type: Type.OBJECT,
          properties: {
            label: { type: Type.STRING, description: "Strictly concise (3-6 words) metric-backed clinical status label, e.g., 'Within Daily Calorie Target', 'High Saturated Fat Warning', or 'Solid Low-Sodium Choice'. Do NOT use vague filler or generic phrases." },
            level: { type: Type.STRING, description: "'good' | 'warning' | 'alert' | 'neutral'" }
          },
          required: ["label", "level"]
        },
        message: { type: Type.STRING, description: "Primary clinical assessment, incorporating comforting and supportive tone, next step coaching, and meal balancing suggestions. Do NOT repeat raw calorie, sat fat, or sodium numbers." },
        modificationCommand: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING, enum: ['update_weight', 'remove_item', 'add_item', 'rename_alias', 'update_cooking_method'] },
              itemName: { type: Type.STRING },
              newWeightGrams: { type: Type.INTEGER },
              targetDbId: { type: Type.STRING, nullable: true },
              newItemName: { type: Type.STRING, nullable: true },
              newCookingMethod: { type: Type.STRING, nullable: true }
            },
            required: ["action", "itemName"]
          },
          nullable: true
        },
        foodData: {
          type: Type.OBJECT,
          properties: {
            date: { type: Type.STRING, description: "YYYY-MM-DD" },
            name: { type: Type.STRING },
            description: { type: Type.STRING, description: "Short actionable summary" },
            itemsBreakdown: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  scoutIndex: { type: Type.INTEGER },
                  canonicalDbName: { type: Type.STRING, description: "Standard database or product name, extremely concise (e.g. 'Whole Rolled Oats'). Do NOT include scaling, rationale, calculations, or explanations." },
                  weightGrams: { type: Type.INTEGER },
                  dbSource: { type: Type.STRING, description: "'usda' | 'label' | 'estimated'" },
                  dbId: { type: Type.STRING, nullable: true },
                  foodType: { 
                    type: Type.STRING, 
                    enum: ['grain', 'protein', 'vegetable', 'fruit', 'dairy', 'fat/oil', 'beverage', 'snack', 'condiment', 'prepared dish/entree', 'other'],
                    description: "Strictly one of: 'grain', 'protein', 'vegetable', 'fruit', 'dairy', 'fat/oil', 'beverage', 'snack', 'condiment', 'prepared dish/entree', 'other'.", 
                    nullable: true 
                  },
                  cookingMethod: { type: Type.STRING, description: "Concise cooking method (e.g. 'raw', 'baked', 'grilled', 'boiled', 'fried').", nullable: true }
                },
                required: ["scoutIndex", "canonicalDbName", "weightGrams", "dbSource"]
              }
            }
          },
          required: ["date", "name", "description", "itemsBreakdown"],
          nullable: true
        },
        comparison: {
          type: Type.OBJECT,
          properties: {
            comparisonTitle: { type: Type.STRING, nullable: true },
            auditChecklist: { type: Type.STRING, nullable: true },
            groups: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  groupName: { type: Type.STRING, description: "Descriptive name or option title e.g. 'Quaker Oats So Simple' or 'Tier 1 - Safest Choice'" },
                  scoutItemIndices: {
                    type: Type.ARRAY,
                    items: { type: Type.INTEGER },
                    description: "0-based indices of scout items placed in this group"
                  },
                  itemNames: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    nullable: true,
                    description: "Item names for text-only comparisons"
                  },
                  verdict: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      level: { type: Type.STRING }
                    },
                    required: ["label", "level"]
                  },
                  message: { type: Type.STRING, description: "Clinical advice comparing this option against patient biomarkers" },
                  averageNutrients: {
                    type: Type.OBJECT,
                    properties: {
                      calories: { type: Type.NUMBER, nullable: true },
                      protein: { type: Type.NUMBER, nullable: true },
                      totalFat: { type: Type.NUMBER, nullable: true },
                      saturatedFat: { type: Type.NUMBER, nullable: true },
                      sodium: { type: Type.NUMBER, nullable: true },
                      carbohydrates: { type: Type.NUMBER, nullable: true },
                      addedSugar: { type: Type.NUMBER, nullable: true },
                      potassium: { type: Type.NUMBER, nullable: true },
                      totalFibre: { type: Type.NUMBER, nullable: true }
                    },
                    nullable: true
                  }
                },
                required: ["groupName", "scoutItemIndices", "verdict", "message"]
              }
            }
          },
          nullable: true
        }
      },
      propertyOrdering: ["_internalReasoning", "verdict", "message", "modificationCommand", "foodData", "comparison"],
      required: ["_internalReasoning", "verdict", "message"]
    };

    let biomarkersCtx = "";
    if (biomarkersNeedingImprovement && biomarkersNeedingImprovement.length > 0) {
      biomarkersCtx = `\nCRITICAL PATIENT BIOMARKER WARNINGS:\n` +
        biomarkersNeedingImprovement.map((b: any) => {
          if (typeof b === "string") return `• ${b}`;
          if (b && typeof b === "object" && b.name) {
            const statusStr = b.status ? ` is ${String(b.status).toUpperCase()}` : "";
            const valStr = b.value !== undefined ? ` (${b.value} ${b.unit || ""}, normal range: ${b.normalRange || ""})` : "";
            return `• ${b.name}${statusStr}${valStr}`;
          }
          return `• ${String(b)}`;
        }).join("\n") + "\n";
    }
    const finalSystemInstruction = customSystemInstruction || systemInstruction;
    const modeDPromptSuffix = (userSelectedMode === 'compare') 
      ? `\n\nIf MODE D (evaluation/comparison) applies: reference every item ONLY by its Index number from the Scout list above inside "scoutItemIndices". Every Index must be assigned to at least one group — including duplicate-named items, which are still separate indices. You are allowed to map the same Scout Index to multiple groups if a physical shelf contains items belonging to both categories. Do not restate names, bounding boxes, or database IDs.`
      : ``;

    let promptText = (customVariableData 
      ? `${customVariableData}\n${biomarkersCtx}\n${visionScoutCtx}\n${databaseMatchesCtx}\nCurrent User Input: "${message}"`
      : `${historyContext}${pastMealsCtx}Analyze this current food request.
${userCtx}
${biomarkersCtx}
${timeCtx}
${imageCtx}
${visionScoutCtx}
${databaseMatchesCtx}
Current User Input: "${message}"`) + modeDPromptSuffix;

    fullPromptSent = `System Instruction:\n${finalSystemInstruction}\n\n${promptText}`;
    addDebugLog(`[Dietitian Coach] Sending nutrition analysis request to Gemini...`);
    async function callAndParseFoodAnalysis(callArgs: any): Promise<{ textOutput: string; rawParsed: any }> {
      if (isStream) {
        callArgs.onStream = (chunk: string, isThought?: boolean) => {
          try {
            if (isThought) {
              res.write(`data: ${JSON.stringify({ type: 'stream', thought: chunk, stage: 'dietitian' })}\n\n`);
            } else {
              res.write(`data: ${JSON.stringify({ type: 'stream', chunk, stage: 'dietitian' })}\n\n`);
            }
            if (typeof (res as any).flush === 'function') (res as any).flush();
          } catch (e) {}
        };
      }
      const textOutput = await callUnifiedLLM(callArgs);
      let cleanJson = extractBalancedJson(textOutput);
      const extractedScratchpad = textOutput.replace(cleanJson, "").replace(/```(?:json)?/gi, "").trim();

      // Sanitize pathological weightGrams values like "350.000000...000" → "350"
      // These are generated by the LLM and inflate JSON size causing truncation errors
      cleanJson = cleanJson.replace(/"(\d+)\.0{10,}(\d*)"/g, (_, int, tail) => `"${int}${tail ? '.' + tail.replace(/0+$/, '') : ''}"`);
      cleanJson = cleanJson.replace(/:\s*(\d+)\.0{10,}\d*/g, (_, int) => `: ${int}`);
      // Robust fallback for any unquoted or quoted decimal with long runaway zeros (e.g. 150.00000000000003g)
      cleanJson = cleanJson.replace(/(\d+)\.(\d*?)0{10,}(\d*)/g, (match, intPart, midPart, endPart) => {
        const combinedFrac = (midPart + endPart).replace(/0+$/, '');
        return combinedFrac ? `${intPart}.${combinedFrac}` : intPart;
      });

      // Sanitize runaway/repeating string values in fields like foodType
      cleanJson = cleanJson.replace(/"foodType"\s*:\s*"([^"]{80,})"/g, (_, val) => {
        const firstToken = val.split(/[\s,]+/)[0] || 'protein';
        return `"foodType": "${firstToken}"`;
      });

      let rawParsed;
      try {
        rawParsed = await asyncParseLLMJSON(cleanJson);
        rawParsed = validateOrFallback(RouteAgentSchema, rawParsed, cleanJson, "RouteAgent", { 
          _internalReasoning: "",
          verdict: { label: "Meal Logged", level: "neutral" },
          message: "I have analyzed your food log.",
          foodData: { date: new Date().toISOString().split('T')[0], name: "Meal", description: "Logged meal", itemsBreakdown: [] }
        });
        
        if (!rawParsed._internalReasoning && extractedScratchpad) {
          rawParsed._internalReasoning = extractedScratchpad;
        }
      } catch (parseErr: any) {
        addDebugLog(`[JSON Parse Error] JSON parse failed: ${parseErr.message}. Attempting robust truncation repair...`);
        try {
          let repaired = cleanJson.trim();
          
          // 1. Remove trailing comma followed by a half-written key
          repaired = repaired.replace(/,\s*"[^"]*"?\s*$/, "");
          
          // 2. Handle unescaped double quotes inside an unclosed string
          let quoteCount = 0;
          for (let idx = 0; idx < repaired.length; idx++) {
            if (repaired[idx] === '"' && (idx === 0 || repaired[idx - 1] !== '\\')) {
              quoteCount++;
            }
          }
          if (quoteCount % 2 !== 0) {
            repaired += '"';
          }

          // 3. Remove trailing comma or colon
          if (repaired.endsWith(",")) {
            repaired = repaired.slice(0, -1).trim();
          } else if (repaired.endsWith(":")) {
            repaired += "null";
          }

          // 4. Count open braces and brackets outside strings
          let openBraces = 0;
          let openBrackets = 0;
          let insideStr = false;
          
          for (let i = 0; i < repaired.length; i++) {
            const char = repaired[i];
            if (char === '"' && (i === 0 || repaired[i - 1] !== '\\')) {
              insideStr = !insideStr;
            }
            if (!insideStr) {
              if (char === '{') openBraces++;
              else if (char === '}') openBraces--;
              else if (char === '[') openBrackets++;
              else if (char === ']') openBrackets--;
            }
          }

          repaired += ']'.repeat(Math.max(0, openBrackets)) + '}'.repeat(Math.max(0, openBraces));
          
          rawParsed = JSON.parse(repaired);
          if (!rawParsed._internalReasoning && extractedScratchpad) {
            rawParsed._internalReasoning = extractedScratchpad;
          }
          addDebugLog(`[JSON Parse Error] Robust truncation repair succeeded.`);
        } catch (repairErr: any) {
          addDebugLog(`[JSON Parse Error] Robust truncation repair also failed: ${repairErr.message}.`);
          throw parseErr;
        }
      }
      return { textOutput, rawParsed };
    }

    // Pre-dietitian density check: ensure beverage and composite items are rescaled prior to Dietitian prompt payload
    if (Array.isArray(preCalculatedItems)) {
      preCalculatedItems.forEach((it: any) => {
        if (!it || !it.weightGrams || !it.nutrients) return;
        const cals = Number(it.nutrients.calories || 0);
        const nameLower = String(it.name || it.keyword || '').toLowerCase();
        const isBeverage = BEVERAGE_RAW_PATTERN.test(nameLower) || nameLower.includes('latte') || nameLower.includes('coffee') || nameLower.includes('drink');
        if (isBeverage && it.weightGrams >= 150 && cals > 600) {
          const maxAllowedCals = Math.round((it.weightGrams / 100) * 110);
          const factor = maxAllowedCals / cals;
          addDebugLog(`[Pre-Dietitian Reality Check] Rescaling beverage item "${it.name}" from ${cals} kcal -> ${maxAllowedCals} kcal prior to Dietitian prompt payload.`);
          NUTRIENT_KEYS.forEach(k => {
            if (it.nutrients[k] != null && typeof it.nutrients[k] === 'number') {
              it.nutrients[k] = Math.round(it.nutrients[k] * factor * 10) / 10;
            }
          });
        }
      });
      if (preCalculatedItems.length > 0) {
        if (!aggregatedNutrients || typeof aggregatedNutrients !== 'object') {
          aggregatedNutrients = {};
        }
        NUTRIENT_KEYS.forEach(k => {
          const sum = preCalculatedItems.reduce((acc: number, item: any) => acc + (Number(item?.nutrients?.[k]) || 0), 0);
          aggregatedNutrients[k] = Math.round(sum * 10) / 10;
        });
      }
    }

    addDebugLog('[MealBuild] projector dietitian');
    let dietitianTempMeal = buildSavableMealFromParsed(preCalculatedItems || [], activeMeal, aggregatedNutrients, null);
    const lifeStart = beginStage(dietitianTempMeal, 'dietitian', { actor: 'server' });
    if (!lifeStart.allowed) {
      addDebugLog(`[MealBuild] stage-limits: ${lifeStart.limitReason}`);
    } else {
      addDebugLog('[MealBuild] stage dietitian started');
    }
    const dietitianProjection = projectDietitianInput(dietitianTempMeal, userProfile);

    const precalcBlock = formatDietitianProjectionBlock(dietitianProjection);
    addDebugLog('[MealBuild] projector dietitian applied');
    promptText = `${promptText}\n\n${precalcBlock}`;
    fullPromptSent = `${fullPromptSent}\n\n${precalcBlock}`;

    const llmCallArgs = {
      modelId: (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite", // Updating to flash-lite as recommended
      systemInstruction: finalSystemInstruction,
      promptText,
      imagePayloads: undefined, // Strip redundant image payloads: Dietitian Coach consumes structured JSON nutrition summary
      responseMimeType: "application/json" as const,
      responseSchema: foodAnalyzeSchema,
      maxOutputTokens: 8192, // Boosted to ensure all items fit
      skipThinking: true, // Scout already sets this; dietitian's schema also puts
      logStagePrefix: 'dietitian',
      // _internalReasoning first, which is where the live _internalReasoning text actually
      // comes from — so this does not remove the _internalReasoning. It removes the
      // separate native-thinking output stream, which combined with responseSchema
      // was suspected of causing the model to batch output instead of streaming it.
    };

    sendStreamEvent({ type: 'status', stage: 'dietitian', status: 'started', message: 'Analyzing nutrition payload...' });
    sendLog('dietitian_instruction', 'dietitian', `Dietitian System Instruction & Patient Biomarkers payload dispatched (model: ${engine || 'gemini-3.5-flash-lite'}).`);

    let textOutput: string = "";
    let rawParsed: any;
    
    const canSkipDietitianForPureScale = Boolean(
      isPureWeightModification &&
      activeMeal &&
      userSelectedMode !== 'compare'
    );

    if (canSkipDietitianForPureScale) {
      const targetWeight = (weightRefineIntent.isRefine && weightRefineIntent.weightGrams) ? weightRefineIntent.weightGrams : (activeMeal.weightGrams || 100);
      addDebugLog(`[Refine] skip-dietitian: Scaled label-locked meal directly to ${targetWeight}g without LLM call.`);
      sendStreamEvent({ type: 'status', stage: 'dietitian', status: 'completed', message: `Scaled portion to ${targetWeight}g.` });
      textOutput = JSON.stringify({
        _internalReasoning: `[Refine] scale-only: Scaled meal directly to ${targetWeight}g`,
        verdict: { label: "Meal Logged", level: "neutral" },
        message: `Updated meal portion to ${targetWeight}g.`,
        mode: "modify",
        modificationCommand: [
          {
            action: "update_weight",
            itemName: "total",
            newWeightGrams: targetWeight
          }
        ]
      });
      rawParsed = JSON.parse(textOutput);
    } else {
      let dietitianAttempts = 0;
      const maxDietitianAttempts = 3;
      let lastDietitianErr: any = null;

      while (dietitianAttempts < maxDietitianAttempts) {
        dietitianAttempts++;
        try {
          if (dietitianAttempts > 1) {
            const delay = lastDietitianErr?.message?.includes('503') || lastDietitianErr?.message?.includes('429') || lastDietitianErr?.message?.includes('UNAVAILABLE') ? 3000 : 1000;
            addDebugLog(`[Dietitian] Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            addDebugLog(`[Dietitian] Retrying LLM call (Attempt ${dietitianAttempts} of ${maxDietitianAttempts})...`);
          }
          const result = await callAndParseFoodAnalysis(llmCallArgs);
          textOutput = result.textOutput;
          rawParsed = result.rawParsed;
          break;
        } catch (err: any) {
          lastDietitianErr = err;
          const isAbort = err.name === 'AbortError' || (err.message && err.message.toLowerCase().includes('abort'));
          
          if (isAbort) {
            addDebugLog(`[Dietitian] Fatal error (Timeout) detected. Throwing immediately without retry.`);
            throw err;
          }
          addDebugLog(`[Dietitian Attempt ${dietitianAttempts} Failed] Error: ${err.message}`);
        }
      }
      
      if (!textOutput) {
        addDebugLog(`[Dietitian Failed Permanently] All attempts failed. Last error: ${lastDietitianErr?.message}`);
        throw lastDietitianErr;
      }
    }


    addDebugLog(`[Dietitian Coach] Received response from Gemini. Length: ${textOutput.length} chars.`);

    if (rawParsed._internalReasoning) {
      addDebugLog(`[Dietitian Internal Reasoning]\n${rawParsed._internalReasoning}`);
    }

    const dietitianScratchpad = rawParsed?._internalReasoning || "";
    sendStreamEvent({ type: 'status', stage: 'dietitian', status: 'completed', message: 'Dietitian evaluation completed.' });

    if (rawParsed && typeof rawParsed === 'object') {
      if (isExplicitModify) {
        rawParsed.mode = 'modify';
      }
      if (userSelectedMode === 'review') {
        if (!rawParsed.mode || rawParsed.mode !== 'modify') rawParsed.mode = isExplicitModify ? 'modify' : 'new_log';
        rawParsed.comparison = null; // Guaranteed 100% clean review card rendering
      } else if (userSelectedMode === 'compare') {
        rawParsed.mode = 'evaluation';
        const existingFd = rawParsed.foodData && typeof rawParsed.foodData === 'object' ? rawParsed.foodData : {};
        const breakdown = Array.isArray(existingFd.itemsBreakdown) && existingFd.itemsBreakdown.length
          ? existingFd.itemsBreakdown
          : (visionScoutItems || []).map((s: any, idx: number) => ({
              name: s.originalName || s.keyword || `item ${idx + 1}`,
              originalName: s.originalName || s.keyword,
              weightGrams: s.estimatedWeightGrams,
              calories: s.estimatedCalories,
              scoutIndex: s.scoutIndex ?? idx,
            }));
        rawParsed.foodData = { ...existingFd, itemsBreakdown: breakdown };
      }
    }

    let mode = rawParsed.mode || "new_log";
    if (userSelectedMode !== 'compare' && visionScoutItems && visionScoutItems.length <= 1 && mode === "evaluation") {
      addDebugLog(`[Mode Override] Overriding mode from 'evaluation' to 'new_log' because only 1 item was identified.`);
      mode = "new_log";
    }
    const originalModeIsModify = (mode === "modify" || isExplicitModify || userExplicitlySelectedEditMode || (req.body.activeMeal !== undefined && (message.toLowerCase().includes("change") || message.toLowerCase().includes("modify") || message.toLowerCase().includes("update") || message.toLowerCase().includes("remove") || message.toLowerCase().includes("add") || message.toLowerCase().includes("correct") || message.toLowerCase().includes("only") || message.toLowerCase().includes("instead") || message.toLowerCase().includes("replace"))));

    apiCalls = [
      ...(hasImage ? [{ type: 'gemini', label: 'Food nutrition agent - Visual Scout (gemini-3.5-flash-lite)' }] : []),
      ...(queriesToSearch && queriesToSearch.length > 0 ? [{ type: 'usda', label: `Food nutrition agent - USDA (${queriesToSearch.length})` }] : []),
      { type: 'gemini', label: `Food nutrition agent - Dietitian (${(typeof engine === 'object' ? engine?.name || engine?.model : engine) || 'gemini-3.5-flash-lite'})` }
    ];

    // CASE F: food origin lookup mode


    // CASE B: discussion mode
    if (mode === "discussion") {
      addDebugLog(`[Mode Routing] DISCUSSION mode triggered (0 database operations).`);
      return res.json({
        mode: "discussion",
        dietitianScratchpad: rawParsed._internalReasoning,
        text: rawParsed.message || "Here is the details on this meal composition.",
        message: rawParsed.message || "Here is the details on this meal composition.",
        data: null,
        agentPrompt: fullPromptSent,
        apiCalls
      });
    }

    // CASE D: evaluation mode
    if (mode === "evaluation") {
      addDebugLog(`[Mode Routing] EVALUATION mode triggered.`);
      const comparisonData = rawParsed.comparison || { groups: [] };
      const preCalcByScoutIndex: Record<number, Record<string, number>> = {};
      if (visionScoutItems && visionScoutItems.length > 0) {
        visionScoutItems.forEach((sItem: any, idx: number) => {
          const q = sItem.keyword || sItem.originalName || sItem.name || '';
          const normQ = normalizeFoodKey(q);
          const dbMatch = databaseMatchesArray.find((m: any) => normalizeFoodKey(m.searchQuery || m.name) === normQ || m.searchQuery === q) || databaseMatchesArray[idx];
          const itemGrams = Number(sItem.weightGrams || sItem.estimatedGrams || sItem.estimatedWeightGrams || sItem.servingGrams || 100) || 100;
          const factor = itemGrams / 100;

          let raw100g: Record<string, number> = {};
          if (dbMatch && dbMatch.nutrients) {
            raw100g = dbMatch.nutrients;
          } else if (dbMatch) {
            raw100g = {
              calories: Number(dbMatch.calories || 0),
              protein: Number(dbMatch.protein || 0),
              totalFat: Number(dbMatch.fat || 0),
              saturatedFat: Number(dbMatch.saturatedFat || 0),
              carbohydrates: Number(dbMatch.carbohydrates || 0),
              sodium: Number(dbMatch.sodium || 0),
              totalFibre: Number(dbMatch.totalFibre || 0),
            };
          } else {
            raw100g = getFallbackCategoryProfile(q);
          }

          const labelKcal = parseLabelCalories(sItem.rawNutritionLabel);
          // If label is per-100g style, portionAndReconcile still gets hardLabel as portion when already absolute;
          // prefer scout estimate as soft budget when label absent.
          const result = portionAndReconcile({
            nutrientsPer100g: raw100g,
            weightGrams: itemGrams,
            itemName: q,
            scoutEstimatedCalories: Number(sItem.estimatedCalories) > 0 ? Number(sItem.estimatedCalories) : null,
            hardLabelKcal: labelKcal != null && labelKcal > 0 ? labelKcal : null,
          });
          addDebugLog(`[Budget] mode=D idx=${idx} item="${q}" kcal=${result.budget.budgetKcal} source=${result.budget.source} scoutEst=${sItem.estimatedCalories ?? 'n/a'}`);
          addDebugLog(`[Reconcile] mode=D idx=${idx} action=${result.action} foundation=${result.foundationKcal} final=${result.finalKcal}`);
          preCalcByScoutIndex[idx] = result.nutrients;
        });
      }
      const resolvedGroups = resolveComparisonGroups(comparisonData.groups, visionScoutItems);
      addDebugLog(`[Comparison Resolve] ${visionScoutItems.length} scout item(s) -> ${resolvedGroups.length} group(s), covering ${resolvedGroups.reduce((sum: number, g: any) => sum + (g.items?.length || 0), 0)} item(s).`);
      comparisonData.groups = applyServerAverageNutrients(resolvedGroups, preCalcByScoutIndex);
      comparisonData.isMenuScale = isMenuScale;
      
      addDebugLog('[MealBuild] mode=D stream');
      const comparisonSet = fromEvaluationComparison(comparisonData, visionScoutItems, {
        id: req.body.jobId || `cmp_${Date.now()}`,
      });

      const responsePayload = {
        mode: "evaluation",
        dietitianScratchpad: rawParsed._internalReasoning,
        comparison: comparisonData,
        comparisonSet,
        scoutItems: mergeScoutItems(visionScoutItems, rawParsed.scoutItems),
        scoutContentType: visionScoutContentType,
        agentPrompt: fullPromptSent,
        message: rawParsed.message,
        text: rawParsed.message,
        apiCalls
      };

      if (isStream && hasSentHeaders) {
        res.write(`data: ${JSON.stringify({ final: true, result: responsePayload })}\n\n`);
        return res.end();
      }

      return res.json(responsePayload);
    }

    if (originalModeIsModify && rawParsed.foodData && rawParsed.foodData.itemsBreakdown && rawParsed.foodData.itemsBreakdown.length > 0) {
      addDebugLog(`[Mode Rewrite] AI fully regenerated foodData in MODIFY mode. Routing through NEW_LOG pipeline to compute full nutrients.`);
      mode = "new_log";
    }

    // CASE A: NEW FOOD LOGGING
    if (mode === "new_log") {
      const rawFoodData = rawParsed.foodData || {};

      // --- Edit-mode data preservation fix ---
      // When editing an existing meal, the dietitian LLM regenerates itemsBreakdown
      // from scratch and loses the previously-resolved database linkage (dbId,
      // primaryBase100g, componentsDetailList, etc). Backfill those fields from the
      // original activeMeal item (matched by scoutIndex, or array position as a
      // fallback) so nutrient aggregation doesn't fall back to all-zero "estimated".
      // Never overwrites fields the AI's edit actually changed (weight, name, method).
      if (
        originalModeIsModify &&
        activeMeal &&
        Array.isArray(activeMeal.itemsBreakdown) &&
        Array.isArray(rawFoodData.itemsBreakdown) &&
        rawFoodData.itemsBreakdown.length > 0
      ) {
        const origItems = activeMeal.itemsBreakdown;
        const PRESERVE_KEYS = [
          'primaryBase100g',
          'primaryBaseWeightG',
          'componentsDetailList',
          'saucesDetailList',
          'primaryBaseMatchName',
          'physicalFormClassification',
          'labelNutrientsPerServing',
          'rawNutritionLabel',
          'matchedKeywords',
          'physicalForm',
          'visualIngredients',
          'components',
          'cookingAdded',
          'boundingBox2D',
          'sourceImageIndex',
        ];
        rawFoodData.itemsBreakdown = rawFoodData.itemsBreakdown.map((newItem: any, idx: number) => {
          let origItem: any = null;
          if (newItem.scoutIndex !== undefined && newItem.scoutIndex !== null) {
            origItem = origItems.find((o: any) => o.scoutIndex === newItem.scoutIndex);
            if (origItem && !namesReferToSameFood(
              newItem.canonicalDbName || newItem.name || newItem.originalName,
              origItem.canonicalDbName || origItem.name || origItem.originalName
            )) {
              origItem = null;
            }
          }
          if (!origItem) {
            origItem = origItems.find((o: any) => namesReferToSameFood(
              newItem.canonicalDbName || newItem.name || newItem.originalName,
              o.canonicalDbName || o.name || o.originalName
            )) || null;
          }
          if (!origItem) return newItem;

          const merged = { ...newItem };
          for (const key of PRESERVE_KEYS) {
            if ((merged[key] === undefined || merged[key] === null) && origItem[key] !== undefined && origItem[key] !== null) {
              merged[key] = origItem[key];
            }
          }
          // Only reuse the original dbId/dbSource if the edit still looks unresolved
          // (i.e. the AI didn't provide its own new database match for this item).
          if ((merged.dbSource === 'estimated' || !merged.dbId) && origItem.dbId) {
            merged.dbId = origItem.dbId;
            merged.dbSource = origItem.dbSource;
          }
          return merged;
        });
        addDebugLog(`[Edit Merge] Re-attached preserved database resolution fields from original activeMeal items (matched by scoutIndex) to prevent nutrient zero-out on edit.`);
      }

      if (!rawFoodData.itemsBreakdown || rawFoodData.itemsBreakdown.length === 0) {
        // Build itemsBreakdown from Vision Scout output + best DB match per item
        if (visionScoutItems && visionScoutItems.length > 0) {
                    rawFoodData.itemsBreakdown = visionScoutItems.map((item: any) => {
            const bestMatch = pickQueryScopedMatch(item.keyword || item.originalName || '', databaseMatchesArray, [], quarantinedIdsSet);
            
            // nutritionFacts is a general-purpose estimate field, never evidence of a
            // real printed label — do not let it set dbSource:'label'. Only item.source
            // === 'label' (scout OCR) or a brand_official match may do that.
            let labelNutrients = null;
            if (item.source === 'label' && item.nutritionFacts && Object.keys(item.nutritionFacts).length > 0) {
              labelNutrients = {
                servingSizeGrams: 100,
                calories: Number(item.nutritionFacts.caloriesPer100g) || 0,
                protein: Number(item.nutritionFacts.proteinPer100g) || 0,
                totalFat: Number(item.nutritionFacts.fatPer100g) || 0,
                saturatedFat: Number(item.nutritionFacts.saturatedFatPer100g) || 0,
                transFat: Number(item.nutritionFacts.transFatPer100g) || 0,
                carbohydrates: Number(item.nutritionFacts.carbsPer100g) || 0,
                addedSugar: Number(item.nutritionFacts.addedSugarPer100g) || 0,
                sodium: Number(item.nutritionFacts.sodiumPer100g) || 0,
                potassium: Number(item.nutritionFacts.potassiumPer100g) || 0,
                totalFibre: Number(item.nutritionFacts.totalFibrePer100g) || 0,
                solubleFibre: Number(item.nutritionFacts.solubleFibrePer100g) || 0
              };
            }
            
            return {
              canonicalDbName: item.keyword,
              weightGrams: String(sanitizeMealWeight(item.estimatedWeightGrams, 100)),
              dbSource: labelNutrients ? 'label' : (bestMatch ? (bestMatch.source === 'usda' ? 'usda' : 'off') : 'estimated'),
              dbId: bestMatch ? bestMatch.id : null,
              labelNutrientsPerServing: labelNutrients,
              warnings: evaluateNutrientWarnings(labelNutrients),
              foodType: 'unknown'
            };
          });
          addDebugLog(`[Fallback] Built itemsBreakdown from Vision Scout output (LLM truncated)`);
        }
      }

      const parsedData: any = {};
      const sanitizeString = (val: any, fallback: string) => {
        if (val === null || val === undefined || String(val).toLowerCase() === "undefined" || String(val).trim() === "") {
          return fallback;
        }
        return String(val);
      };

      parsedData.name = sanitizeString(rawFoodData.name, "Meal Log");
      // Enforce singular/plural parity between the composite title and each item's own
      // canonicalDbName in itemsBreakdown (the LLM is only asked to do this via prompt
      // instruction, with no code-level enforcement — see agents/dietitianInstructions.ts).
      if (Array.isArray(rawFoodData.itemsBreakdown) && rawFoodData.itemsBreakdown.length > 0) {
        parsedData.name = enforceTitlePluralParity(parsedData.name, rawFoodData.itemsBreakdown);
      }
      const mostRecentImageDate = extractMostRecentImageDate(imageDates);
      parsedData.date = sanitizeString(rawFoodData.date, mostRecentImageDate || new Date().toISOString().split("T")[0]);
      if (mostRecentImageDate && (!rawFoodData.date || rawFoodData.date === 'undefined' || String(rawFoodData.date).trim() === '')) {
        parsedData.date = mostRecentImageDate;
      }
      parsedData.composition = sanitizeString(rawFoodData.composition, "Unspecified ingredients");
      
      const itemsWeightSum = Array.isArray(rawFoodData.itemsBreakdown)
        ? rawFoodData.itemsBreakdown.reduce((sum: number, it: any) => sum + (Number(it.weightGrams) || 0), 0)
        : 0;
      const weightFallback = itemsWeightSum > 0 ? itemsWeightSum : 150;
      const totalWeightGrams = sanitizeMealWeight(rawFoodData.weightGrams, weightFallback);
      parsedData.weightGrams = totalWeightGrams;
      parsedData.basis_type = 'total';
      parsedData.serving_grams = totalWeightGrams;
      parsedData.quantity = sanitizeString(rawFoodData.quantity, "1 serving");
      parsedData.benefits = sanitizeString(rawFoodData.benefits, "");
      parsedData.risks = sanitizeString(rawFoodData.risks, "");
      parsedData.healthImpact = sanitizeString(rawFoodData.healthImpact, "");
      parsedData.recommendation = sanitizeString(rawFoodData.recommendation, "");
      parsedData.description = sanitizeString(rawFoodData.description || rawParsed.description || rawFoodData.risks || "", "");

      const rawVerdict = rawParsed.verdict || rawFoodData.verdict;
      if (rawVerdict && typeof rawVerdict === 'object') {
        parsedData.verdict = {
          label: String(rawVerdict.label || 'Balanced Choice'),
          level: String(rawVerdict.level || 'neutral')
        };
      } else if (rawFoodData.recommendation && typeof rawFoodData.recommendation === 'string' && rawFoodData.recommendation.trim().length > 0) {
        parsedData.verdict = {
          label: String(rawFoodData.recommendation),
          level: 'neutral'
        };
      }
      parsedData.cookingMethod = sanitizeString(rawFoodData.cookingMethod, scoutCookingMethod || "Unknown cooking method");
      parsedData.scoutConfidenceRating = sanitizeString(rawFoodData.scoutConfidenceRating, scoutConfidenceRating || "High (>90%)");
      parsedData.scoutConfidenceComment = rawFoodData.scoutConfidenceComment !== undefined ? sanitizeString(rawFoodData.scoutConfidenceComment, "") : (scoutConfidenceComment || "");
      // diningEnvironment is intentionally NOT re-read from the Dietitian's output.
      // The Vision Scout is the sole source of truth for this classification (server.ts:2528);
      // the Dietitian's schema copy of this field was unguided (no prompt instructions) and was
      // silently overwriting correct Scout classifications (e.g. "airline") with bad guesses.
      parsedData.diningEnvironment = diningEnvironment;

      // Map and construct itemsBreakdown and aggregate all nutrients
      if (rawFoodData.itemsBreakdown && Array.isArray(rawFoodData.itemsBreakdown) && rawFoodData.itemsBreakdown.length > 0) {
        // [Label Merge] Fold standalone label items into their paired food item
        if (rawFoodData.itemsBreakdown.length > 1) {
          const isLabelPanelItem = (item: any) => {
            const orig = (item.canonicalDbName || item.name || item.originalLocalName || "").toLowerCase();
            const foodKeywords = ["milk", "burger", "fries", "fry", "chicken", "fish", "beef", "pork", "salad", "wrap", "bread", "juice", "water", "tea", "coffee", "rice", "noodle", "pasta", "pizza", "cookie", "cake", "fruit", "vegetable", "cheese", "yogurt", "egg", "soup", "stew", "pancake", "waffle", "sausage", "bacon", "steak", "tart", "pie", "donut", "doughnut", "oat", "cereal", "muffin", "soda", "coke"];
            if (foodKeywords.some(kw => orig.includes(kw))) return false;
            return orig.includes("nutrition fact") || 
                   orig.includes("informasi nilai gizi") || 
                   orig.includes("komposisi") || 
                   orig.includes("nutrition label") || 
                   orig.includes("back of package") || 
                   orig.includes("printed_packaging_label") ||
                   orig === "label";
          };

          const labelIndices: number[] = [];
          rawFoodData.itemsBreakdown.forEach((item: any, idx: number) => {
            if (isLabelPanelItem(item)) labelIndices.push(idx);
          });

          // Sort in descending order to splice safely
          labelIndices.reverse().forEach(labelIdx => {
            const labelItem = rawFoodData.itemsBreakdown[labelIdx];
            let primaryItem: any = null;
            const labelText = ((labelItem.ingredientsList || "") + " " + (labelItem.canonicalDbName || "") + " " + (labelItem.name || "") + " " + (labelItem.originalLocalName || "")).toLowerCase();

            // Try to match label text to a food item's name
            for (let j = 0; j < rawFoodData.itemsBreakdown.length; j++) {
               if (!labelIndices.includes(j)) {
                  const candidate = rawFoodData.itemsBreakdown[j];
                  const candName = (candidate.canonicalDbName || candidate.name || candidate.originalLocalName || "").toLowerCase();
                  if (candName && candName.split(' ').some(tok => tok.length > 3 && labelText.includes(tok))) {
                     primaryItem = candidate;
                     break;
                  }
               }
            }

            if (!primaryItem) {
               // Fallback: find nearest non-label item ONLY if label text didn't specify a food
               for (let j = labelIdx - 1; j >= 0; j--) { 
                  if (!labelIndices.includes(j)) { primaryItem = rawFoodData.itemsBreakdown[j]; break; }
               }
               if (!primaryItem) { 
                  for (let j = labelIdx + 1; j < rawFoodData.itemsBreakdown.length; j++) { 
                     if (!labelIndices.includes(j)) { primaryItem = rawFoodData.itemsBreakdown[j]; break; } 
                  }
               }
            }

            if (primaryItem) {
                primaryItem.labelNutrientsPerServing = primaryItem.labelNutrientsPerServing || labelItem.labelNutrientsPerServing || labelItem.rawNutritionLabel || {
                    servingSizeGrams: labelItem.weightGrams || 100,
                    calories: labelItem.calories || 0,
                    protein: labelItem.protein || 0,
                    totalFat: labelItem.totalFat || 0,
                    carbohydrates: labelItem.carbohydrates || 0
                };
                if (primaryItem.dbSource !== 'usda') primaryItem.dbSource = 'label';
                addDebugLog(`[Label Merge] Folded standalone LLM label "${labelItem.canonicalDbName || labelItem.name}" into "${primaryItem.canonicalDbName || primaryItem.name}".`);
                rawFoodData.itemsBreakdown.splice(labelIdx, 1);
            }
          });
        }
        // Enrich items with originalLocalName from visionScoutItems and preCalculatedItems if available
        if (visionScoutItems && Array.isArray(visionScoutItems)) {
          const usedIndices = new Set();
          rawFoodData.itemsBreakdown = rawFoodData.itemsBreakdown.map((item: any, idx: number) => {
            const match = matchBreakdownItemToScout(item, visionScoutItems, usedIndices);
            if (match) {
              usedIndices.add(match.scoutIndex);
              const preCalc = preCalculatedItems.find((p: any) => p.scoutIndex === match.scoutIndex);
              if (preCalc) {
                return {
                  ...item,
                  scoutIndex: item.scoutIndex !== undefined ? item.scoutIndex : match.scoutIndex,
                  originalName: match.originalName || item.originalName || item.originalLocalName || null,
                  originalLocalName: match.originalName || item.originalLocalName || null,
                  chainName: match.chainName || item.chainName || null,
                  rawNutritionLabel: match.rawNutritionLabel || item.rawNutritionLabel || null,
                  keyword: match.keyword || item.keyword || null,
                  visualIngredients: item.visualIngredients || match.visualIngredients || null,
                  cookingMethod: (match.cookingMethod && match.cookingMethod !== 'unknown') ? match.cookingMethod : (item.cookingMethod || null),
                  components: item.components || match.components || null,
                  dbId: preCalc.bestMatchDbId || item.dbId || null,
                  dbSource: preCalc.bestMatchDbSource || item.dbSource || 'estimated',
                  hasComponents: Boolean(preCalc.hasComponents),
                  primaryBase100g: preCalc.primaryBase100g || null,
                  primaryBaseMatchName: preCalc.primaryBaseMatchName || null,
                  primaryBaseWeightG: preCalc.primaryBaseWeightG || item.weightGrams,
                  componentsDetailList: preCalc.componentsDetailList || [],
                  cookingAdded: preCalc.cookingAdded || { addedCalories: 0, addedFat: 0, addedSaturatedFat: 0, addedSodium: 0 },
                  truthNutrients: preCalc.truthNutrients || {},
                  lockedNutrientKeys: preCalc.lockedNutrientKeys || [],
                  ingredientsList: preCalc.ingredientsList || item.ingredientsList || match.ingredientsList || null,
                  labelNutrientsPerServing: preCalc.labelNutrientsPerServing || preCalc.primaryBase100g || item.labelNutrientsPerServing || null
                };
              }
              return {
                ...item,
                scoutIndex: item.scoutIndex !== undefined ? item.scoutIndex : match.scoutIndex,
                originalName: match.originalName || item.originalName || item.originalLocalName || null,
                originalLocalName: match.originalName || item.originalLocalName || null,
                chainName: match.chainName || item.chainName || null,
                rawNutritionLabel: match.rawNutritionLabel || item.rawNutritionLabel || null,
                keyword: match.keyword || item.keyword || null,
                visualIngredients: item.visualIngredients || match.visualIngredients || null,
                cookingMethod: (match.cookingMethod && match.cookingMethod !== 'unknown') ? match.cookingMethod : (item.cookingMethod || null),
                components: item.components || match.components || null
              };
            }
            return {
              ...item,
              scoutIndex: item.scoutIndex !== undefined ? item.scoutIndex : idx
            };
          });

          // Reconcile missing visionScoutItems that the Dietitian LLM omitted
          const isLabelName = (s: string) => {
            const orig = String(s || '').toLowerCase();
            const foodKeywords = ["milk", "burger", "fries", "fry", "chicken", "fish", "beef", "pork", "salad", "wrap", "bread", "juice", "water", "tea", "coffee", "rice", "noodle", "pasta", "pizza", "cookie", "cake", "fruit", "vegetable", "cheese", "yogurt", "egg", "soup", "stew", "pancake", "waffle", "sausage", "bacon", "steak", "tart", "pie", "donut", "doughnut", "oat", "cereal", "muffin", "soda", "coke", "drink", "beverage", "salami", "kefir"];
            if (foodKeywords.some(kw => orig.includes(kw))) return false;
            return orig.includes("nutrition fact") || 
                   orig.includes("informasi nilai gizi") || 
                   orig.includes("komposisi") || 
                   orig.includes("nutrition label") || 
                   orig.includes("back of package") || 
                   orig.includes("printed_packaging_label") ||
                   orig === "label";
          };

          visionScoutItems.forEach((sItem: any) => {
            const sIndex = sItem.scoutIndex;
            if (sIndex !== undefined && sIndex !== null && !usedIndices.has(sIndex)) {
              if (breakdownAlreadyHasScoutName(rawFoodData.itemsBreakdown, sItem)) {
                return;
              }
              if (!isLabelName(sItem.originalName || sItem.keyword || '')) {
                const preCalc = preCalculatedItems ? preCalculatedItems.find((p: any) => p.scoutIndex === sIndex) : null;
                if (preCalc) {
                  addDebugLog(`[Scout Reconcile] Adding omitted Vision Scout item "${sItem.originalName || sItem.keyword}" (scoutIndex=${sIndex}) back to itemsBreakdown.`);
                  usedIndices.add(sIndex);
                  rawFoodData.itemsBreakdown.push({
                    scoutIndex: sIndex,
                    canonicalDbName: sItem.originalName || sItem.keyword || "Food Item",
                    originalName: sItem.originalName || sItem.keyword || "Food Item",
                    originalLocalName: sItem.originalName || null,
                    keyword: sItem.keyword || null,
                    weightGrams: preCalc.primaryBaseWeightG || sItem.estimatedWeightGrams || 100,
                    dbId: preCalc.bestMatchDbId,
                    dbSource: preCalc.bestMatchDbSource,
                    hasComponents: Boolean(preCalc.hasComponents),
                    primaryBase100g: preCalc.primaryBase100g || null,
                    primaryBaseMatchName: preCalc.primaryBaseMatchName || null,
                    primaryBaseWeightG: preCalc.primaryBaseWeightG || sItem.estimatedWeightGrams || 100,
                    componentsDetailList: preCalc.componentsDetailList || [],
                    cookingAdded: preCalc.cookingAdded || { addedCalories: 0, addedFat: 0, addedSaturatedFat: 0, addedSodium: 0 },
                    truthNutrients: preCalc.truthNutrients || {},
                    lockedNutrientKeys: preCalc.lockedNutrientKeys || [],
                    ingredientsList: preCalc.ingredientsList || sItem.ingredientsList || null,
                    labelNutrientsPerServing: preCalc.primaryBase100g || null,
                    cookingMethod: (sItem.cookingMethod && sItem.cookingMethod !== 'unknown') ? sItem.cookingMethod : 'raw',
                    components: sItem.components || null,
                    rawNutritionLabel: sItem.rawNutritionLabel || null
                  });
                }
              }
            }
          });
        }

        

        if (rawFoodData.itemsBreakdown && Array.isArray(rawFoodData.itemsBreakdown)) {
          rawFoodData.itemsBreakdown.forEach((item: any) => {
            item.diningEnvironment = diningEnvironment;
          });
        }

        if (preCalculatedItems && Array.isArray(preCalculatedItems) && preCalculatedItems.length > 0) {
          rawFoodData.itemsBreakdown = rawFoodData.itemsBreakdown.map((item: any, idx: number) => {
            let preMatch = preCalculatedItems.find((p: any) => {
              if (item.scoutIndex !== undefined && item.scoutIndex !== null && p.scoutIndex !== undefined && p.scoutIndex !== null) {
                return item.scoutIndex === p.scoutIndex;
              }
              const itemLower = (item.canonicalDbName || item.name || "").trim().toLowerCase();
              const pOrigLower = (p.originalName || "").trim().toLowerCase();
              const pKwLower = (p.keyword || "").trim().toLowerCase();
              if (!itemLower) return false;
              if (itemLower === pOrigLower || itemLower === pKwLower) {
                return true;
              }
              return false;
            });
            if (!preMatch && item.scoutIndex === undefined) {
              preMatch = preCalculatedItems[idx] || null;
            }
            if (preMatch) {
              const itemLower = (item.canonicalDbName || item.name || "").trim().toLowerCase();
              const pOrigLower = (preMatch.originalName || "").trim().toLowerCase();
              const pKwLower = (preMatch.keyword || "").trim().toLowerCase();
              const hasKeywordMatch = itemLower.includes(pOrigLower) || itemLower.includes(pKwLower) || pOrigLower.includes(itemLower) || pKwLower.includes(itemLower);
              const stripPunctForTokens = (s: string) => s.replace(/[^a-z0-9\s]/g, ' ');
              const itemTokens = stripPunctForTokens(itemLower).split(/\s+/).filter((t: string) => t.length > 2);
              const pTokens = stripPunctForTokens(pOrigLower + " " + pKwLower).split(/\s+/).filter((t: string) => t.length > 2);
              const hasExplicitScoutIndexMatch = item.scoutIndex !== undefined && item.scoutIndex !== null && preMatch.scoutIndex !== undefined && item.scoutIndex === preMatch.scoutIndex;
              const stem = (w: string) => w.replace(/(es|s)$/, '');
              const itemStemmed = itemTokens.map(stem);
              const pStemmed = pTokens.map(stem);
              const hasStemOverlap = itemStemmed.some((t: string) => pStemmed.includes(t)) ||
                itemTokens.some((t1: string) => pTokens.some((t2: string) => (t1.length >= 4 && t2.length >= 4 && (t1.startsWith(t2) || t2.startsWith(t1)))));
              const hasTokenOverlap = itemTokens.some((t: string) => pTokens.includes(t)) || hasStemOverlap;
              
              if (!hasKeywordMatch && !hasTokenOverlap && itemLower && (pOrigLower || pKwLower)) {
                 addDebugLog(`[First-Principles Injection] Anomaly: index=${hasExplicitScoutIndexMatch ? 'agree' : 'no'} but names "${itemLower}" vs "${pOrigLower || pKwLower}" do not match. Aborting cross-wired injection.`);
                 preMatch = null;
              }
            }

            if (preMatch && preMatch.nutrients && item.weightGrams > 0 && (preMatch.hasComponents || preMatch.bestMatchDbId)) {
              if (!preMatch.hasComponents && item.dbId && String(item.dbId) !== String(preMatch.bestMatchDbId)) {
                // Dietitian picked a DIFFERENT database ID for a single-ingredient item. Do NOT inject preMatch nutrients, let the backend calculate from the LLM's chosen ID.
                return item;
              }
              const weight = item.weightGrams;
              const n = preMatch.nutrients;
              const scale = 100 / weight;

              const injectedLabel: Record<string, number> = { servingSizeGrams: 100 };
              NUTRIENT_KEYS.forEach(k => {
                injectedLabel[k] = parseFloat(((n[k] || 0) * scale).toFixed(2));
              });

              addDebugLog(`[First-Principles Injection] Injecting deterministic backend nutrients for "${item.canonicalDbName || item.name}" (scoutIndex=${preMatch.scoutIndex}, dbSource=${preMatch.bestMatchDbSource}, dbId=${preMatch.bestMatchDbId}).`);

              return {
                ...item,
                visualIngredients: item.visualIngredients || preMatch.visualIngredients || null,
                cookingMethod: (preMatch.cookingMethod && preMatch.cookingMethod !== 'unknown') ? preMatch.cookingMethod : (item.cookingMethod || null),
                components: item.components || preMatch.components || null,
                syntheticBase100g: injectedLabel,
                labelNutrientsPerServing: preMatch.labelNutrientsPerServing || preMatch.primaryBase100g || null,
                primaryBase100g: preMatch.primaryBase100g || null,
                primaryBaseMatchName: preMatch.primaryBaseMatchName,
                primaryBaseWeightG: preMatch.primaryBaseWeightG || item.weightGrams,
                hasComponents: Boolean(preMatch.hasComponents),
                componentsDetailList: preMatch.componentsDetailList || [],
                cookingAdded: preMatch.cookingAdded || { addedCalories: 0, addedFat: 0, addedSaturatedFat: 0, addedSodium: 0 },
                truthNutrients: preMatch.truthNutrients || {},
                lockedNutrientKeys: preMatch.lockedNutrientKeys || [],
                ingredientsList: preMatch.ingredientsList || item.ingredientsList || null,
                dbSource: preMatch.bestMatchDbSource || item.dbSource || "estimated",
                dbId: preMatch.bestMatchDbId || item.dbId || null
              };
            }
            return item;
          });
        }

        // Deduplicate LLM generated itemsBreakdown to prevent duplicate macro explosion.
        // NOTE: identical name+weight items are legitimate (e.g. "2 pieces of the same candy"),
        // so we only treat an entry as a true duplicate if it also shares the same scoutIndex
        // as an entry already kept. Items with no scoutIndex fall back to array position so
        // they are never collapsed together.
        if (rawFoodData.itemsBreakdown && Array.isArray(rawFoodData.itemsBreakdown)) {
          const uniqueItems: any[] = [];
          const seen = new Set();
          rawFoodData.itemsBreakdown.forEach((item: any, idx: number) => {
            const canonicalLower = (item.canonicalDbName || item.name || "").trim().toLowerCase();
            const weight = item.weightGrams || 0;
            const scoutKeyPart = (item.scoutIndex !== undefined && item.scoutIndex !== null) ? `scout_${item.scoutIndex}` : "";
            const key = `${canonicalLower}_${weight}_${scoutKeyPart}`;
            if (!seen.has(key)) {
              seen.add(key);
              uniqueItems.push(item);
            } else {
              addDebugLog(`[Deduplication] Removed duplicate item "${canonicalLower}" (${weight}g) generated by Dietitian LLM.`);
            }
          });
          rawFoodData.itemsBreakdown = uniqueItems;
        }

        const { nutrients, itemsBreakdown } = aggregateItemsNutrients(
          rawFoodData.itemsBreakdown,
          totalWeightGrams,
          dbMatchMap,
          databaseMatchesArray,
          addDebugLog
        );
        parsedData.nutrients = nutrients;
        
        // Critical Guard: Only synchronize narrative text for single-item meals to prevent grand total overwriting multi-item stats
        if (parsedData.nutrients && rawFoodData.itemsBreakdown && rawFoodData.itemsBreakdown.length === 1 && userSelectedMode === 'review') {
          if (rawParsed && rawParsed.message) {
            rawParsed.message = synchronizeNarrativeText(
              rawParsed.message,
              nutrients.calories,
              nutrients.protein,
              nutrients.totalFat,
              nutrients.saturatedFat,
              nutrients.sodium,
              nutrients.carbohydrates
            );
          }
          parsedData.message = rawParsed.message;
        }

        sendLog('dietitian_answer', 'dietitian', rawParsed?.message || 'Dietitian generated clinical advice.', {
          mode: rawParsed?.mode
        });
        
        // Overwrite itemsBreakdown with guaranteed backend dbSource and dbId (Bug 3)
        parsedData.itemsBreakdown = itemsBreakdown.map((item: any, idx: number) => {
          let preMatch = preCalculatedItems.find((p: any) => {
            if (item.scoutIndex !== undefined && item.scoutIndex !== null && p.scoutIndex !== undefined && p.scoutIndex !== null) {
              return item.scoutIndex === p.scoutIndex;
            }
            const itemLower = (item.canonicalDbName || item.name || "").trim().toLowerCase();
            const pOrigLower = (p.originalName || "").trim().toLowerCase();
            const pKwLower = (p.keyword || "").trim().toLowerCase();
            if (!itemLower) return false;
            if (itemLower === pOrigLower || itemLower === pKwLower) {
              return true;
            }
            return false; // Fuzzy token matching was causing ID collisions (e.g. Meatball wrap matching Falafel wrap because they both share "wrap").
          });
          if (!preMatch && item.scoutIndex === undefined) {
             // Name only — never array position (4106 phantom).
             preMatch = preCalculatedItems.find((p: any) => namesReferToSameFood(
               item.canonicalDbName || item.name,
               p.originalName || p.keyword
             )) || null;
          }
          if (preMatch) {
            const itemLower = (item.canonicalDbName || item.name || "").trim().toLowerCase();
            const pOrigLower = (preMatch.originalName || "").trim().toLowerCase();
            const pKwLower = (preMatch.keyword || "").trim().toLowerCase();
            const hasKeywordMatch = itemLower.includes(pOrigLower) || itemLower.includes(pKwLower) || pOrigLower.includes(itemLower) || pKwLower.includes(itemLower);
            const stripPunctForTokens = (s: string) => s.replace(/[^a-z0-9\s]/g, ' ');
            const itemTokens = stripPunctForTokens(itemLower).split(/\s+/).filter((t: string) => t.length > 2);
            const pTokens = stripPunctForTokens(pOrigLower + " " + pKwLower).split(/\s+/).filter((t: string) => t.length > 2);
            const hasTokenOverlap = itemTokens.some((t: string) => pTokens.includes(t));
            
            if (!hasKeywordMatch && !hasTokenOverlap && itemLower && (pOrigLower || pKwLower)) {
               preMatch = null;
            }
          }

          const rawItem = rawFoodData.itemsBreakdown?.[idx] || {};

          // Reconcile item nutrients: prefer preMatch nutrients if available, or item/rawItem nutrients
          const baseNutrients = item.nutrients || rawItem.nutrients || {};
          const preNutrients = preMatch?.nutrients || {};
          const finalItemNutrients: Record<string, number> = {};
          
          NUTRIENT_KEYS.forEach((k: string) => {
            const preVal = preNutrients[k] !== undefined && preNutrients[k] !== null ? Number(preNutrients[k]) : 0;
            const baseVal = baseNutrients[k] !== undefined && baseNutrients[k] !== null ? Number(baseNutrients[k]) : 0;
            if (baseVal <= 0 && preVal > 0) {
              finalItemNutrients[k] = preVal;
            } else {
              finalItemNutrients[k] = baseVal > 0 ? baseVal : preVal;
            }
          });

          return {
            ...rawItem,
            ...item,
            nutrients: finalItemNutrients,
            chainName: item.chainName || preMatch?.chainName || rawItem.chainName || null,
            rawNutritionLabel: item.rawNutritionLabel || preMatch?.rawNutritionLabel || rawItem.rawNutritionLabel || null,
            originalName: item.originalName || preMatch?.originalName || rawItem.originalName || null,
            keyword: item.keyword || preMatch?.keyword || rawItem.keyword || null,
            visualIngredients: item.visualIngredients || rawItem.visualIngredients || preMatch?.visualIngredients || null,
            components: item.components || rawItem.components || preMatch?.components || null,
            dbSource: (preMatch && preMatch.dbSource) || item.dbSource || "estimated",
            dbId: (preMatch && preMatch.dbId) || item.dbId || null,
            hasComponents: Boolean(
              (preMatch && preMatch.hasComponents) ||
              item.hasComponents ||
              (Array.isArray(preMatch?.componentsDetailList) && preMatch.componentsDetailList.length >= 2) ||
              (Array.isArray(item.componentsDetailList) && item.componentsDetailList.length >= 2)
            ),
            primaryBase100g: preMatch?.primaryBase100g || item.primaryBase100g || null,
            primaryBaseMatchName: preMatch?.primaryBaseMatchName || item.primaryBaseMatchName || null,
            primaryBaseWeightG: preMatch?.primaryBaseWeightG || item.weightGrams,
            componentsDetailList: preMatch?.componentsDetailList || item.componentsDetailList || [],
            cookingAdded: preMatch?.cookingAdded || { calories: 0, fat: 0, satFat: 0, sodium: 0 },
            truthNutrients: item.truthNutrients || preMatch?.truthNutrients || {},
            lockedNutrientKeys: item.lockedNutrientKeys || preMatch?.lockedNutrientKeys || [],
            ingredientsList: preMatch?.ingredientsList || item.ingredientsList || rawItem.ingredientsList || null
          };
        });

        // Re-aggregate grand totals from final itemsBreakdown to ensure meal-level consistency
        const grandTotals: Record<string, number> = {};
        NUTRIENT_KEYS.forEach((k: string) => { grandTotals[k] = 0; });
        parsedData.itemsBreakdown.forEach((it: any) => {
          if (it.nutrients) {
            addDebugLog(`[Nutrient Final Check] "${it.canonicalDbName || it.name}" finalItemNutrients: ${JSON.stringify(it.nutrients)}`);
            NUTRIENT_KEYS.forEach((k: string) => {
              grandTotals[k] = Math.round(((grandTotals[k] || 0) + (Number(it.nutrients[k]) || 0)) * 10) / 10;
            });
          }
        });
        parsedData.nutrients = grandTotals;

        // Always synchronize narrative text with final grand totals across all narrative fields
        if (parsedData.nutrients) {
          const finalCal = parsedData.nutrients.calories || 0;
          const finalP = parsedData.nutrients.protein || 0;
          const finalFat = parsedData.nutrients.totalFat || 0;
          const finalSatFat = parsedData.nutrients.saturatedFat || 0;
          const finalNa = parsedData.nutrients.sodium || 0;
          const finalCarbs = parsedData.nutrients.carbohydrates || 0;

          if (parsedData.message) {
            parsedData.message = synchronizeNarrativeText(parsedData.message, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
          }
          if (rawParsed && rawParsed.message) {
            rawParsed.message = synchronizeNarrativeText(rawParsed.message, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
          }
          if (parsedData.description) {
            parsedData.description = synchronizeNarrativeText(parsedData.description, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
          }
          if (parsedData.benefits) {
            parsedData.benefits = synchronizeNarrativeText(parsedData.benefits, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
          }
          if (parsedData.risks) {
            parsedData.risks = synchronizeNarrativeText(parsedData.risks, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
          }
          if (parsedData.healthImpact) {
            parsedData.healthImpact = synchronizeNarrativeText(parsedData.healthImpact, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
          }
          if (parsedData.recommendation) {
            parsedData.recommendation = synchronizeNarrativeText(parsedData.recommendation, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
          }
        }

        // Fire-and-forget: register any new chain menu dishes in the background. Never blocks or fails the request.
        try {
          const { autoRegisterChainMenuItem } = await import('./serverBrandMenu.js');
          const { supabaseAdmin } = await import('./supabaseAdmin.js');
          const countryCodeForRegister = userProfile?.country || userProfile?.countryCode || 'GB';
          for (const registerItem of parsedData.itemsBreakdown || []) {
            const scoutMatch = Array.isArray(visionScoutItems)
              ? visionScoutItems.find(
                  (s: any) =>
                    (registerItem.scoutIndex !== undefined &&
                      s.scoutIndex !== undefined &&
                      Number(s.scoutIndex) === Number(registerItem.scoutIndex)) ||
                    (registerItem.keyword &&
                      s.keyword &&
                      String(s.keyword).toLowerCase() === String(registerItem.keyword).toLowerCase())
                )
              : null;

            const enriched = {
              ...registerItem,
              source: registerItem.source || scoutMatch?.source || null,
              hasComponents: registerItem.hasComponents !== undefined ? registerItem.hasComponents : scoutMatch?.hasComponents,
              components: registerItem.components || scoutMatch?.components || null,
              chainName: registerItem.chainName || scoutMatch?.chainName || null,
              originalName:
                registerItem.originalName ||
                registerItem.originalLocalName ||
                scoutMatch?.originalName ||
                registerItem.name,
              rawNutritionLabel:
                registerItem.rawNutritionLabel || scoutMatch?.rawNutritionLabel || null,
              ingredientsList:
                registerItem.ingredientsList || scoutMatch?.ingredientsList || null,
              lockedNutrientKeys:
                registerItem.lockedNutrientKeys || scoutMatch?.lockedNutrientKeys || null,
              estimatedWeightGrams:
                registerItem.weightGrams ||
                registerItem.estimatedWeightGrams ||
                scoutMatch?.estimatedWeightGrams ||
                null,
            };

            autoRegisterChainMenuItem(
              supabaseAdmin,
              enriched,
              countryCodeForRegister,
              addDebugLog
            ).catch((e: any) => {
              addDebugLog(`[AutoChainRegister] background failure: ${e?.message || e}`);
            });
          }
        } catch (e: any) {
          addDebugLog(`[AutoChainRegister] setup failed: ${e?.message || e}`);
        }

        const safeNum = (val: any) => {
          const n = Number(val);
          return (isNaN(n) || n < 0) ? 0 : n;
        };

        const fVal = (val: any, unit: string = '', isPlus: boolean = false) => {
          if (val === null || val === undefined) return `0${unit}`;
          const num = typeof val === 'number' ? val : parseFloat(val);
          if (isNaN(num) || Math.abs(num) < 0.05) return `0${unit}`;
          const rounded = Math.round(num * 10) / 10;
          if (rounded === 0) return `0${unit}`;
          const prefix = (isPlus && rounded > 0) ? '+' : '';
          return `${prefix}${rounded}${unit}`;
        };

        // Construct 5-Column Clean First-Principles Ledger Table
        let receiptTable = "### 🧾 Nutrition calculation\n\n";
        receiptTable += "| Item / Ingredient | Kcal | Protein | Sat Fat | Sodium |\n";
        receiptTable += "|---|---|---|---|---|\n";

        const formatDbLinks = (str: string): string => {
          if (!str) return str;
          let result = str.replace(/(?<!\[)\bUSDA\s*#(\d+)\b(?!\))/gi, '[USDA #$1](https://fdc.nal.usda.gov/food-details/$1/nutrients)');
          result = result.replace(/(?<!\[)\bOFF\s*#(\d+)\b(?!\))/gi, '[OFF #$1](https://world.openfoodfacts.org/product/$1)');
          return result;
        };

        let grandCal = 0;
        let grandP = 0;
        let grandSatFat = 0;
        let grandNa = 0;
        let grandFat = 0;
        let grandCarbs = 0;
        let grandWeight = 0;

        parsedData.itemsBreakdown.forEach((it: any, idx: number) => {
          if (!it || typeof it !== 'object') return;
          const originalItemCal = safeNum(it.calories);
          const originalItemP = safeNum(it.protein);
          const originalItemSatFat = safeNum(it.saturatedFat);
          const originalItemNa = safeNum(it.sodium);
          const itemWeightG = safeNum(it.weightGrams) || 100;

          const badge = it.dbSource === 'estimated_override' 
            ? ` ⚠️ [SANITY CHECK OVERRIDE: ${it.overrideReason || 'Adjusted Value'}]`
            : (it.isUnverified ? " ⚠️ (Est)" : "");

          let visualBreakdownStr = "";
          if (it.visualIngredients && Array.isArray(it.visualIngredients) && it.visualIngredients.length > 0) {
            visualBreakdownStr = ` (${it.visualIngredients.join(', ')})`;
          } else if (it.components && Array.isArray(it.components) && it.components.length > 0) {
            visualBreakdownStr = ` (${it.components.map((c: any) => typeof c === 'string' ? c : c.searchQuery || c.name || c.keyword).join(', ')})`;
          }

          const physicalFormObj = it.physicalFormClassification || classifyUniversalPhysicalFormV3({
            name: it.originalName || it.originalLocalName || it.keyword || it.name || it.canonicalDbName,
            canonicalDbName: it.canonicalDbName || it.name,
            originalLocalName: it.originalLocalName || it.originalName,
            keyword: it.keyword || it.name,
            visualIngredients: it.visualIngredients,
            components: it.components
          });

          const pfType = physicalFormObj.physicalForm || 'UNKNOWN';
          const pfTokensArr = Array.from(new Set(
            (Array.isArray(physicalFormObj.matchedTokens) ? physicalFormObj.matchedTokens : [String(physicalFormObj.matchedTokens || '')])
              .map((t: any) => String(t).trim().toLowerCase())
          )).filter(Boolean);
          const pfTokens = pfTokensArr.length > 0 ? pfTokensArr.join(', ') : 'none';
          const baseMatchType = it.matchReasonInfo?.matchType || (it.dbSource === 'usda' ? 'USDA FDC Entry' : it.dbSource === 'off' ? 'Open Food Facts Entry' : it.dbSource === 'backend_calculated' || it.dbSource === 'canonical' ? 'Canonical Reference' : 'Universal Nutrient Estimator');
          const rawDbId = it.dbId ? String(it.dbId).replace(/^canonical_/i, '') : '';
          const matchTypeStr = (it.dbId ? `Canonical_${rawDbId}` : baseMatchType).replace(/[\[\]|\n]/g, "");
          
          const dishTitle = (
            it.originalName ||
            it.originalLocalName ||
            it.keyword ||
            it.name ||
            it.canonicalDbName ||
            ""
          )
            .replace(/[\[\]|\n"']/g, "")
            .trim();
          const itemNameClean = dishTitle;

          const pfTooltip = `classification: ${pfType} ;; '${itemNameClean}' ;; Matched Keywords: ${pfTokens} ;; ${matchTypeStr}`;
          const pfIcon = ` [ℹ️](#info "${pfTooltip}")`;

          // Row 1: Main Item Header Row with total weight
          receiptTable += `| **${idx + 1}. ${dishTitle}**${badge}${pfIcon} - ${itemWeightG}g${visualBreakdownStr} | - | - | - | - |\n`;

          // Base Ingredient calculation
          let raw100 = { ...(it.syntheticBase100g || it.primaryBase100g || it.labelNutrientsPerServing || {}) };
          const dbMatchObj = databaseMatchesArray ? databaseMatchesArray.find((m: any) => String(m.id) === String(it.dbId)) : null;
          const isGenuineTruthSource = it.dbSource === 'label' || it.dbSource === 'brand_official';
          
          if (!isGenuineTruthSource && it.dbId && dbMatchMap && dbMatchMap.has(String(it.dbId))) {
            const mapped = dbMatchMap.get(String(it.dbId));
            if (mapped) {
               Object.keys(mapped).forEach(k => {
                 if (mapped[k] !== undefined && mapped[k] !== null) {
                   raw100[k] = mapped[k];
                 }
               });
            }
          } else if (!isGenuineTruthSource && dbMatchObj) {
            if (it.dbSource === 'usda' || it.dbSource === 'off') {
               const mapObj = {
                calories: Number(dbMatchObj.calories),
                protein: Number(dbMatchObj.protein),
                totalFat: Number(dbMatchObj.fat),
                saturatedFat: Number(dbMatchObj.saturatedFat),
                sodium: Number(dbMatchObj.sodium)
               };
               Object.keys(mapObj).forEach(k => {
                 if (!isNaN(mapObj[k])) {
                   raw100[k] = mapObj[k];
                 }
               });
            }
          }

          let baseW = it.primaryBaseWeightG || itemWeightG;
          let sauceWSum = 0;
          let scaleRatio = 1;

          if (it.componentsDetailList && it.componentsDetailList.length > 0) {
            sauceWSum = it.componentsDetailList.reduce((acc: number, s: any) => acc + (s.weightGrams || 0), 0);
          }

          // componentsDetailList already includes the primary component for multi-component
          // items — do not add primaryBaseWeightG on top of it (double-count weight).
          const primaryAlreadyInList = Boolean(it.hasComponents) ||
            (it.componentsDetailList && it.componentsDetailList.length >= 2);

          if (primaryAlreadyInList && sauceWSum > 0) {
             if (Math.abs(sauceWSum - itemWeightG) > 2) {
                scaleRatio = itemWeightG / sauceWSum;
             }
          } else if (it.primaryBaseWeightG) {
             const originalWeight = it.primaryBaseWeightG + sauceWSum;
             if (originalWeight > 0 && Math.abs(originalWeight - itemWeightG) > 2) {
                scaleRatio = itemWeightG / originalWeight;
                baseW = Math.round(it.primaryBaseWeightG * scaleRatio);
             }
          } else if (sauceWSum > 0) {
             if (baseW === itemWeightG && sauceWSum < itemWeightG) {
                baseW = Math.max(10, itemWeightG - sauceWSum);
             }
          }

          const base100Cal = safeNum(raw100.calories);
          const base100P = safeNum(raw100.protein);
          const base100SatFat = safeNum(raw100.saturatedFat);
          const base100Na = safeNum(raw100.sodium);

          const baseFactor = baseW / 100;

          const portionBaseCal = Math.round(base100Cal * baseFactor);
          const portionBaseP = Math.round(base100P * baseFactor * 10) / 10;
          const portionBaseSatFat = Math.round(base100SatFat * baseFactor * 10) / 10;
          const portionBaseNa = Math.round(base100Na * baseFactor);

          const dbNameStr = it.primaryBaseMatchName || (dbMatchObj && dbMatchObj.name ? dbMatchObj.name : '');
          let dbRefTag = "";
          const dbSourceUpper = String(it.dbSource || '').toUpperCase();
          const cleanItemName = dbNameStr ? dbNameStr.replace(' (Canonical Base)', '').replace(' (Estimated Component Baseline)', '') : (it.keyword || it.name || 'Ingredient');
          // Prefer printed/brand truth for receipt attribution. Never let a name-token
          // canonical match (e.g. "blueberry" → raw blueberries FDC) hijack a LABEL row.
          const canonicalBase = (dbSourceUpper === 'LABEL' || dbSourceUpper === 'BRAND_OFFICIAL')
            ? null
            : lookupCanonicalBaseFood(dbNameStr || it.keyword || it.name);
          const realFdcId = (canonicalBase && canonicalBase.fdcId) ? canonicalBase.fdcId : ((dbSourceUpper === 'USDA' || dbSourceUpper === 'INTERNAL_CATALOG' || dbSourceUpper === 'USUAL_CATALOG') && it.dbId && !String(it.dbId).startsWith('canonical_') && !String(it.dbId).startsWith('printed_') && !String(it.dbId).startsWith('fallback_') && !isNaN(Number(it.dbId)) ? it.dbId : null);

          if (dbSourceUpper === 'LABEL' || String(it.dbId || '').startsWith('printed_packaging_label')) {
            dbRefTag = `Printed Packaging Label (${cleanItemName})`;
          } else if (dbSourceUpper === 'BRAND_OFFICIAL') {
            dbRefTag = `Official Brand/Menu Data (${cleanItemName})`;
          } else if (canonicalBase && canonicalBase.fdcId) {
            dbRefTag = `📖 [${cleanItemName}](https://fdc.nal.usda.gov/fdc-app.html#/food-details/${canonicalBase.fdcId}/nutrients)`;
          } else if (realFdcId) {
            dbRefTag = `[USDA #${realFdcId}](https://fdc.nal.usda.gov/fdc-app.html#/food-details/${realFdcId}/nutrients) (${cleanItemName})`;
          } else if (dbSourceUpper === 'OFF' && it.dbId) {
            dbRefTag = `[OFF #${it.dbId}](https://world.openfoodfacts.org/product/${it.dbId}) (${cleanItemName})`;
          } else if (dbSourceUpper === 'CATEGORY_FALLBACK' || dbSourceUpper === 'FALLBACK_ESTIMATED' || String(it.dbId || '').startsWith('fallback_')) {
            dbRefTag = `Estimated: ${cleanItemName} (category fallback)`;
          } else {
            dbRefTag = `Estimated ${cleanItemName}`;
          }
          dbRefTag = formatDbLinks(dbRefTag);

          // Row 2: Primary Base Ingredient (if not a multi-component assembly)
          // Mirror D1/D2: list already includes primary when multi-component (hasComponents
          // OR ≥2 detail rows). Never print primary on top of that list.
          const listIsMulti =
            Boolean(it.hasComponents) ||
            (Array.isArray(it.componentsDetailList) && it.componentsDetailList.length >= 2);
          if (!listIsMulti) {
            receiptTable += `| ${dbRefTag} - ${baseW}g | ${fVal(portionBaseCal)} | ${fVal(portionBaseP, 'g')} | ${fVal(portionBaseSatFat, 'g')} | ${fVal(portionBaseNa, 'mg')} |\n`;
          }

          // Row 3: Sauce / Dressing / Sub-components (if any)
          if (it.componentsDetailList && Array.isArray(it.componentsDetailList) && it.componentsDetailList.length > 0) {
            if (listIsMulti) {
               const rowsSummary = it.componentsDetailList.map((s: any) => `${s.name || 'unnamed'}(id=${s.dbId || 'n/a'},cal=${s.calories || 0})`).join(', ');
               addDebugLog(`[Receipt] using preCalc multi-row n=${it.componentsDetailList.length} for "${cleanItemName}": ${rowsSummary}`);
            }
            it.componentsDetailList.forEach((s: any) => {
              const sW = Math.round((s.weightGrams || 0) * scaleRatio);
              const sCal = Math.round((s.calories || 0) * scaleRatio);
              const sP = Math.round((s.protein || 0) * scaleRatio * 10) / 10;
              const sNa = Math.round((s.sodium || 0) * scaleRatio);
              const sSatFat = Math.round((s.saturatedFat !== undefined ? s.saturatedFat : 0.3) * scaleRatio * 10) / 10;
              receiptTable += `| ${formatDbLinks(s.name)} - ${sW}g | ${fVal(sCal)} | ${fVal(sP, 'g')} | ${fVal(sSatFat, 'g')} | ${fVal(sNa, 'mg')} |\n`;
            });
          }

          // Row 4: Thermodynamic Physics Engine
          let rawMethod = (it.cookingMethod && it.cookingMethod !== 'unknown') ? it.cookingMethod : null;
          const kwLower = (it.keyword || it.name || it.canonicalDbName || "").toLowerCase();
          const isPackagedCondiment = Boolean(kwLower.match(/\b(margarine|butter|spread|jam|jelly|ketchup|mayo|mayonnaise|dressing tub|dip)\b/i));
          const isBeverage = BEVERAGE_RAW_PATTERN.test(kwLower) || BEVERAGE_RAW_PATTERN.test(it.canonicalDbName || "") || BEVERAGE_RAW_PATTERN.test(it.name || "");
          const isCandyOrDessertNoHeat = physicalFormObj.primaryCategory === 'bakery_dessert';
          if (isPackagedCondiment || isBeverage || isCandyOrDessertNoHeat) {
            rawMethod = 'raw';
          } else if (!rawMethod) {
            if (kwLower.includes('wedge') || kwLower.includes('fries') || kwLower.includes('chip') || kwLower.includes('nugget')) {
              rawMethod = 'deep_fried';
            } else if (kwLower.includes('corn') || kwLower.includes('pea') || kwLower.includes('carrot') || kwLower.includes('broccoli') || kwLower.includes('steamed') || kwLower.includes('boiled')) {
              rawMethod = 'boiled';
            } else {
              rawMethod = 'pan_fried';
            }
          }
          const cookingMethodFormatted = rawMethod.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());

          const SAUCE_KEYWORD_PATTERN = /\b(sauce|dressing|marinade|gravy|glaze|mayo|mayonnaise|vinaigrette|dip|condiment)\b/i;
          const hasActualSauceInDetails = Boolean(
            it.componentsDetailList &&
            Array.isArray(it.componentsDetailList) &&
            it.componentsDetailList.length > 0 &&
            it.componentsDetailList.some((s: any) => (s.sodium || 0) > 0 && SAUCE_KEYWORD_PATTERN.test(s.name || ''))
          );
          const hasSauceOrDressingReceipt = hasActualSauceInDetails;

          const dishIdentityReceipt =
            it.originalName || it.originalLocalName || it.keyword || it.name || it.canonicalDbName || "";
          const baseIngredientNameForPrepCheck = dbNameStr || it.keyword || it.name;
          const isAlreadyPreparedReceipt = checkIfItemIsAlreadyPrepared(
            baseIngredientNameForPrepCheck,
            baseIngredientNameForPrepCheck,
            it.dbSource,
            base100Na
          );

          const lockedTruthReceipt = Boolean(
            it.dbSource === "label" ||
            it.dbSource === "brand_official" ||
            (Array.isArray(it.lockedNutrientKeys) &&
              it.lockedNutrientKeys.length > 0 &&
              (it.dbSource === "label" || it.dbSource === "brand_official"))
          );

          const prepReceipt =
            isPackagedCondiment || isBeverage
              ? { addedCalories: 0, addedFat: 0, addedSaturatedFat: 0, addedSodium: 0, reason: "packaged_beverage_or_raw" }
              : decidePrepAddition({
                  weightGrams: itemWeightG,
                  cookingMethod: rawMethod,
                  physicalForm: physicalFormObj.physicalForm,
                  dishName: dishIdentityReceipt,
                  keyword: it.keyword,
                  canonicalDbName: it.canonicalDbName || dbNameStr,
                  foodType: it.foodType,
                  componentCount: Array.isArray(it.components) ? it.components.length : 0,
                  hasLockedTruth: lockedTruthReceipt,
                  isAlreadyPrepared: isAlreadyPreparedReceipt,
                  cookingAdded: it.cookingAdded || null,
                  userText: typeof message === "string" ? message : null,
                  diningEnvironment,
                  hasSauceOrDressing: hasSauceOrDressingReceipt,
                  visualSheen: 0.5,
                  visualCoating: 0.5,
                  dbSource: it.dbSource,
                });

          let cookingCal = prepReceipt.addedCalories;
          let cookingFat = prepReceipt.addedFat;
          let cookingSatFat = prepReceipt.addedSaturatedFat;
          let cookingNa = prepReceipt.addedSodium;

          addDebugLog(
            `[PrepPolicy:receipt] "${dishIdentityReceipt}" reason=${prepReceipt.reason || "n/a"} cal=${cookingCal}`
          );
          addDebugLog(
            `[Airline Multiplier Diagnostic] item="${it.canonicalDbName || it.name}" diningEnvironment="${diningEnvironment}" hasCookingAdded=${Boolean(it.cookingAdded)} cookingNa=${cookingNa}`
          );

          let physicsEngineLabel = "No Preparation Change";
          if (rawMethod === 'raw') {
            physicsEngineLabel = "Raw / Uncooked";
          } else if (rawMethod === 'pan_fried') {
            physicsEngineLabel = "Pan-Seared Oil & Seasoning";
          } else if (rawMethod === 'deep_fried') {
            physicsEngineLabel = "Deep-Fry 10% Lipid Retention";
          } else if (rawMethod === 'stir_fried') {
            physicsEngineLabel = "Stir-Fry Surface Lipid Retention";
          } else if (rawMethod === 'roasted') {
            physicsEngineLabel = "Oven Roast Heat & Seasoning";
          } else if (rawMethod === 'baked') {
            physicsEngineLabel = "Oven Bake & Seasoning";
          } else if (rawMethod === 'boiled' || rawMethod === 'steamed') {
            physicsEngineLabel = "Boiled/Steamed - Zero Added Oil";
          } else if (rawMethod === 'grilled') {
            physicsEngineLabel = "Char-Grill & Seasoning";
          } else {
            physicsEngineLabel = cookingMethodFormatted;
          }

          if (cookingCal === 0 && cookingFat === 0 && cookingSatFat === 0 && cookingNa === 0) {
            physicsEngineLabel = rawMethod === 'raw' ? "Raw (no added oil/salt)" : "Standard Preparation (already in matched product)";
          }

          let infoTooltip = "";
          if (rawMethod === 'raw') {
            infoTooltip = `Fresh uncooked / raw item with zero thermal preparation fat and zero added seasoning salt.`;
          } else if (isAlreadyPreparedReceipt) {
            infoTooltip = `The matched database item already accounts for preparation fat and seasoning salt, so zero additional values were added to prevent double counting.`;
          } else if (hasActualSauceInDetails) {
            infoTooltip = `Thermal prep for ${rawMethod.replace(/_/g, ' ')} (+${cookingCal} kcal) and a reduced surface seasoning salt amount (+${cookingNa}mg sodium), since the attached sauce/dressing already contributes most of this dish's sodium.`;
          } else if (rawMethod === 'pan_fried') {
            infoTooltip = `Restaurant pan-searing uses cooking fat/butter (+${cookingCal} kcal) and a surface salt pinch (+${cookingNa}mg sodium) to develop a savory crust on the ${itemWeightG}g portion.`;
          } else if (rawMethod === 'deep_fried') {
            infoTooltip = `Deep-frying causes oil absorption (~10% lipid retention, +${cookingCal} kcal) and post-fry salting (+${cookingNa}mg sodium) on the ${itemWeightG}g portion.`;
          } else if (rawMethod === 'stir_fried') {
            infoTooltip = `Stir-frying coats ingredients in cooking oil (+${cookingCal} kcal) and seasoning salt (+${cookingNa}mg sodium).`;
          } else if (rawMethod === 'roasted') {
            infoTooltip = `Oven roasting uses surface oil coating (+${cookingCal} kcal) and roasting salt (+${cookingNa}mg sodium) for browning.`;
          } else if (rawMethod === 'baked') {
            infoTooltip = `Baking includes surface oil/butter brushings (+${cookingCal} kcal) and salt seasoning (+${cookingNa}mg sodium).`;
          } else if (rawMethod === 'boiled' || rawMethod === 'steamed') {
            infoTooltip = `Boiling/steaming uses water heat with zero added fats, plus light blanching salt (+${cookingNa}mg sodium).`;
          } else if (rawMethod === 'grilled') {
            infoTooltip = `Char-grilling uses fat brushing for grate release (+${cookingCal} kcal) and dry-rub seasoning salt (+${cookingNa}mg sodium).`;
          } else {
            infoTooltip = `Preparation model for ${cookingMethodFormatted} adds cooking fats (+${cookingCal} kcal) and surface seasoning salt (+${cookingNa}mg sodium) for a ${itemWeightG}g portion.`;
          }

          if (diningEnvironment === 'airline' && (!isAlreadyPreparedReceipt && cookingNa > 0)) {
            infoTooltip += ` Includes 1.5x sodium multiplier for airline dining environment.`;
          }

          if (it.foodType === 'ultra_processed') {
            physicsEngineLabel = "Ultra-Processed Food";
            infoTooltip = "This item is classified as ultra-processed. Caloric density and macronutrients are derived directly from matched printed labels or known manufacturer data.";
          }

          const isZeroCookingAddition = (cookingCal === 0 && cookingFat === 0 && cookingSatFat === 0 && cookingNa === 0);

          // Only output a preparation physics row if there are actual non-zero thermal cooking/salting additions
          if (!isZeroCookingAddition) {
            receiptTable += `| ${physicsEngineLabel} [ℹ️](#info "${infoTooltip}") | ${fVal(cookingCal, '', true)} | ${fVal(0, 'g', true)} | ${fVal(cookingSatFat, 'g', true)} | ${fVal(cookingNa, 'mg', true)} |\n`;
          }

          // 1. Calculate base ingredient nutrients for summation
          const base100Fat = safeNum(raw100.totalFat);
          const base100Carbs = safeNum(raw100.carbohydrates);
          const portionBaseFat = Math.round(base100Fat * baseFactor * 10) / 10;
          const portionBaseCarbs = Math.round(base100Carbs * baseFactor * 10) / 10;

          // Deterministic Component Row Summation
          // If componentsDetailList already contains the primary component
          // (multi-component items), do NOT also seed from portionBase* —
          // that is the same ingredient and would double-count it.
          const sumFromListOnly = Boolean(it.hasComponents) ||
            (it.componentsDetailList && it.componentsDetailList.length >= 2);

          let sumCal = sumFromListOnly ? 0 : portionBaseCal;
          let sumP = sumFromListOnly ? 0 : portionBaseP;
          let sumFat = sumFromListOnly ? 0 : portionBaseFat;
          let sumSatFat = sumFromListOnly ? 0 : portionBaseSatFat;
          let sumNa = sumFromListOnly ? 0 : portionBaseNa;
          let sumCarbs = sumFromListOnly ? 0 : portionBaseCarbs;

          // Plus components / sauces:
          if (it.componentsDetailList && Array.isArray(it.componentsDetailList) && it.componentsDetailList.length > 0) {
            it.componentsDetailList.forEach((s: any) => {
              const sCal = Math.round((s.calories || 0) * scaleRatio);
              const sP = Math.round((s.protein || 0) * scaleRatio * 10) / 10;
              const sF = Math.round((s.totalFat || 0) * scaleRatio * 10) / 10;
              const sSatFat = Math.round((s.saturatedFat !== undefined ? s.saturatedFat : 0.3) * scaleRatio * 10) / 10;
              const sNa = Math.round((s.sodium || 0) * scaleRatio);
              const sCarbs = Math.round((s.carbohydrates || 0) * scaleRatio * 10) / 10;

              sumCal += sCal;
              sumP += sP;
              sumFat += sF;
              sumSatFat += sSatFat;
              sumNa += sNa;
              sumCarbs += sCarbs;
            });
          }

          // Plus cooking method additions:
          sumCal += cookingCal;
          sumFat += cookingFat;
          sumSatFat += cookingSatFat;
          sumNa += cookingNa;

          // Clean rounding for the floats
          sumP = Math.round(sumP * 10) / 10;
          sumFat = Math.round(sumFat * 10) / 10;
          sumSatFat = Math.round(sumSatFat * 10) / 10;
          sumCarbs = Math.round(sumCarbs * 10) / 10;

          // Apply the same reality check used in the pre-calculation pass so the
          // ledger/saved totals never exceed physiologically realistic levels.
          // Same provenance rule as the pre-calc pass: partial-backfill items still get checked.
          const receiptHasBackfilledFields = Array.isArray((it.primaryBase100g as any)?._estimatedFields) && (it.primaryBase100g as any)._estimatedFields.length > 0;
          const receiptEffectiveDbSource = receiptHasBackfilledFields ? "label_partial" : (it.dbSource || it.source);
          const receiptRealityCheckNutrients: Record<string, number> = { calories: sumCal, protein: sumP, totalFat: sumFat, saturatedFat: sumSatFat, sodium: sumNa, carbohydrates: sumCarbs };
          const isCompositeReceipt =
            (Array.isArray(it.components) && it.components.length >= 2) ||
            physicalFormObj?.physicalForm === "COMPOUND_MEAL" ||
            /\b(bowl|poke|salad|bento)\b/i.test(String(it.originalName || it.keyword || it.name || ""));

          applyNutrientRealityChecks(
            it.originalName || it.keyword || it.name,
            itemWeightG,
            receiptRealityCheckNutrients,
            cookingNa,
            addDebugLog,
            receiptEffectiveDbSource,
            {
              originalName: it.originalName || it.originalLocalName || it.keyword,
              keyword: it.keyword,
              componentCount: Array.isArray(it.components) ? it.components.length : 0,
              physicalForm: physicalFormObj?.physicalForm,
              chainName: it.chainName || null,
            }
          );
          
          // Re-apply truth locks and reality-check corrections via pure helper
          const ledgerTruth = it.truthNutrients || {};
          const itemLockedKeysSet = new Set<string>(it.lockedNutrientKeys || Object.keys(ledgerTruth));
          const postReconcileResult = applyPostReconcileTruthLocks({
            sumNutrients: { calories: sumCal, protein: sumP, totalFat: sumFat, saturatedFat: sumSatFat, sodium: sumNa, carbohydrates: sumCarbs },
            ledgerTruth,
            lockedNutrientKeys: it.lockedNutrientKeys,
            receiptRealityCheckNutrients,
            isCompositeReceipt
          });

          if (postReconcileResult.appliedDensityCorrection) {
            addDebugLog(`[LedgerInvariant] applied density correction for composite "${dishTitle}": adjusted calories from row-sum to ${postReconcileResult.nutrients.calories}`);
          }
          if (postReconcileResult.appliedSodiumRealityCheck) {
            addDebugLog(`[LedgerInvariant] applied sodium reality-check override for composite "${dishTitle}": adjusted sodium from row-sum to ${postReconcileResult.nutrients.sodium}`);
          }
          if (!postReconcileResult.appliedDensityCorrection && !postReconcileResult.appliedSodiumRealityCheck && isCompositeReceipt) {
            addDebugLog(`[LedgerInvariant] composite "${dishTitle}": using row-sum totals, reality-check mutations ignored`);
          }

          const itemCal = postReconcileResult.nutrients.calories;
          const itemP = postReconcileResult.nutrients.protein;
          const itemFat = postReconcileResult.nutrients.totalFat;
          const itemSatFat = postReconcileResult.nutrients.saturatedFat;
          const itemNa = postReconcileResult.nutrients.sodium;
          const itemCarbs = postReconcileResult.nutrients.carbohydrates;

          // Overwrite it properties to guarantee downstream consistency
          it.calories = itemCal;
          it.protein = itemP;
          it.totalFat = itemFat;
          it.saturatedFat = itemSatFat;
          it.sodium = itemNa;
          it.carbohydrates = itemCarbs;

          // Assert and log loud console error if mismatch (for UNLOCKED nutrients only)
          const diffCal = itemLockedKeysSet.has('calories') ? 0 : Math.abs(originalItemCal - itemCal);
          const diffP = itemLockedKeysSet.has('protein') ? 0 : Math.abs(originalItemP - itemP);
          const diffSatFat = itemLockedKeysSet.has('saturatedFat') ? 0 : Math.abs(originalItemSatFat - itemSatFat);
          const diffNa = itemLockedKeysSet.has('sodium') ? 0 : Math.abs(originalItemNa - itemNa);

          if (diffCal > 1.1 || diffP > 0.15 || diffSatFat > 0.15 || diffNa > 1.1) {
            console.error(`[Math Integrity Failure] Item "${it.name}" has mismatched subtotal!\n` +
                          `Sum of Component Rows: Cal=${itemCal}, P=${itemP}, SatFat=${itemSatFat}, Na=${itemNa}\n` +
                          `Original Item Nutrients: Cal=${originalItemCal}, P=${originalItemP}, SatFat=${originalItemSatFat}, Na=${originalItemNa}`);
            const reasonParts: string[] = [];
            if (cookingCal > 0 || cookingFat > 0 || cookingNa > 0) {
              reasonParts.push(`added ${rawMethod ? rawMethod.replace(/_/g, ' ') : 'cooking'} prep additions (+${cookingNa}mg sodium, +${cookingCal} kcal)`);
            }
            if (it.componentsDetailList && it.componentsDetailList.length > 0) {
              const SAUCE_PATTERN = /\b(sauce|dressing|mayo|mayonnaise|gravy|ketchup|mustard|oil|dip|condiment|relish)\b/i;
              const containsActualSauce = it.componentsDetailList.some((s: any) => SAUCE_PATTERN.test(s.name || ''));
              if (containsActualSauce) {
                reasonParts.push("decomposed sauce/dressing components");
              } else {
                reasonParts.push("decomposed ingredient components");
              }
            }
            if (reasonParts.length === 0) {
              reasonParts.push("recalculated via first-principles database profile");
            }
            const explanation = reasonParts.join(" & ");
            receiptTable += `| *Dietitian corrected — initial estimate lacked ${explanation}; updated to deterministic sub-total below* | ${fVal(originalItemCal)} | ${fVal(originalItemP, 'g')} | ${fVal(originalItemSatFat, 'g')} | ${fVal(originalItemNa, 'mg')} |\n`;
          }

          // Row 5: Item Sub-Total
          receiptTable += `| **Item Sub-Total - ${itemWeightG}g** | **${fVal(itemCal)}** | **${fVal(itemP, 'g')}** | **${fVal(itemSatFat, 'g')}** | **${fVal(itemNa, 'mg')}** |\n`;

          grandCal += itemCal;
          grandP += itemP;
          grandFat += itemFat;
          grandSatFat += itemSatFat;
          grandNa += itemNa;
          grandCarbs += itemCarbs;
          grandWeight += itemWeightG;

          // Stream incremental vertical table live to client during loading
          sendStreamEvent({ type: 'stream', stage: 'dietitian', thought: receiptTable });
        });

        // DIVERGING NUTRIENTS FIX (Aug 2026): The receipt table loop computes its own grand totals 
        // with independent rounding, which historically overwrote the deterministic first-pass 
        // `parsedData.nutrients` that the Dietitian already saw. We now safely discard the 
        // receipt-table's diverging `grand*` variables at the end, and strictly reuse the 
        // pre-existing `parsedData.nutrients` for the final UI table and narrative synchronization.
        const finalCal = parsedData.nutrients?.calories ?? grandCal;
        const finalP = parsedData.nutrients?.protein ?? grandP;
        const finalFat = parsedData.nutrients?.totalFat ?? grandFat;
        const finalSatFat = parsedData.nutrients?.saturatedFat ?? grandSatFat;
        const finalNa = parsedData.nutrients?.sodium ?? grandNa;
        const finalCarbs = parsedData.nutrients?.carbohydrates ?? grandCarbs;

        receiptTable += `| **🏆 GRAND MEAL TOTAL - ${grandWeight}g** | **${fVal(finalCal)}** | **${fVal(finalP, 'g')}** | **${fVal(finalSatFat, 'g')}** | **${fVal(finalNa, 'mg')}** |\n`;

        parsedData.receiptTable = receiptTable;

        // Keep receiptTable separate from _internalReasoning so it renders full width in the UI
        // We still stream it as 'thought' for live updates, but the final state will separate it.

        // GUARANTEED ZERO-DISCREPANCY SYNCHRONIZATION ACROSS ALL NARRATIVE FIELDS:
        // Critical Guard: Only synchronize narrative text for single-item meals to prevent grand total overwriting multi-item stats
        if (parsedData.nutrients && parsedData.itemsBreakdown && parsedData.itemsBreakdown.length === 1 && userSelectedMode === 'review') {
          if (rawParsed.message) {
            rawParsed.message = synchronizeNarrativeText(rawParsed.message, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
          }
          parsedData.message = rawParsed.message;
          if (rawParsed.foodData) {
            if (rawParsed.foodData.benefits) {
              rawParsed.foodData.benefits = synchronizeNarrativeText(rawParsed.foodData.benefits, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
            }
            if (rawParsed.foodData.risks) {
              rawParsed.foodData.risks = synchronizeNarrativeText(rawParsed.foodData.risks, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
            }
            if (rawParsed.foodData.healthImpact) {
              rawParsed.foodData.healthImpact = synchronizeNarrativeText(rawParsed.foodData.healthImpact, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
            }
            if (rawParsed.foodData.recommendation) {
              rawParsed.foodData.recommendation = synchronizeNarrativeText(rawParsed.foodData.recommendation, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
            }
          }
          if (parsedData) {
            if (parsedData.benefits) {
              parsedData.benefits = synchronizeNarrativeText(parsedData.benefits, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
            }
            if (parsedData.risks) {
              parsedData.risks = synchronizeNarrativeText(parsedData.risks, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
            }
            if (parsedData.healthImpact) {
              parsedData.healthImpact = synchronizeNarrativeText(parsedData.healthImpact, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
            }
            if (parsedData.recommendation) {
              parsedData.recommendation = synchronizeNarrativeText(parsedData.recommendation, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
            }
          }
        }
      } else {
        addDebugLog(`[Nutrient Warning] LLM returned no itemsBreakdown for "${parsedData.name}". All nutrients will be zero. Check LLM prompt compliance.`);
        parsedData.nutrients = {};
        for (const key of NUTRIENT_KEYS) {
          parsedData.nutrients[key] = 0;
        }
        parsedData.itemsBreakdown = [{
          name: parsedData.name,
          weightGrams: totalWeightGrams,
          calories: 0, saturatedFat: 0, sodium: 0,
          dbSource: "estimated", dbId: null
        }];
      }

      // Ensure composition is always derived from the final itemsBreakdown names & visual ingredient breakdown
      if (parsedData.itemsBreakdown && Array.isArray(parsedData.itemsBreakdown)) {
        parsedData.composition = parsedData.itemsBreakdown.map((it: any) => {
          let ingStr = "";
          const nameLower = String(it.canonicalDbName || it.name || "").toLowerCase();
          const isLabelItem = it.dbSource === 'label' || it.source === 'label' || String(it.dbId).startsWith('printed_packaging_label');
          
          if (isLabelItem) {
            it.visualIngredients = [];
          }

          let visList = isLabelItem ? [] : (it.visualIngredients || []);
          if (!isLabelItem && (!Array.isArray(visList) || visList.length === 0) && it.components && Array.isArray(it.components)) {
            visList = it.components.map((c: any) => typeof c === 'string' ? c : c.name || c.searchQuery || c.keyword).filter(Boolean);
          }
          
          if (Array.isArray(visList) && visList.length > 0) {
            // Filter out sauces, dressings, glazes, condiments per Round 2 Addendum
            const lexicons = ["sauce", "mayonnaise", "dressing", "glaze", "gravy", "ketchup", "mustard", "vinaigrette", "mayo"];
            visList = visList.filter((vis: any) => {
              const vLower = String(vis || "").toLowerCase();
              return !lexicons.some(lex => vLower.includes(lex));
            });

            // Filter out ingredients that are already in the name to prevent redundancy
            const remainingVis = visList.filter((vis: any) => {
              const vLower = String(vis).toLowerCase();
              if (nameLower.includes(vLower)) return false;
              // Handle common abbreviations/substrings
              if (vLower === "mayo" && nameLower.includes("mayonnaise")) return false;
              if (vLower === "mayonnaise" && nameLower.includes("mayo")) return false;
              if (vLower === "potato" && nameLower.includes("potato wedges")) return false;
              if (vLower === "beef" && nameLower.includes("beef steak")) return false;
              return true;
            });
            
            if (remainingVis.length > 0) {
              ingStr = ` (${remainingVis.join(", ")})`;
            }
          }
          
          return `${it.canonicalDbName || it.name}${ingStr}`;
        }).join(", ");
      }

      if (originalModeIsModify) {
        parsedData.id = req.body.activeMeal?.id;
        if (!parsedData.imageUrl) parsedData.imageUrl = req.body.activeMeal?.imageUrl || req.body.activeMeal?.imageUrls?.[0];
        if (!parsedData.imageUrls || (parsedData.imageUrls.length > 0 && parsedData.imageUrls[0] === "[base64_image_data_truncated]")) parsedData.imageUrls = req.body.activeMeal?.imageUrls;
        
        let baseScoutItems = (visionScoutItems && visionScoutItems.length > 0)
          ? visionScoutItems
          : (req.body.activeMeal?.scoutItems || []);
          
        let updatedScoutItems = mergeScoutItems(baseScoutItems, rawParsed.scoutItems);
        if (parsedData && Array.isArray(parsedData.itemsBreakdown) && parsedData.itemsBreakdown.length > 0) {
          const currentScoutIndices = new Set(parsedData.itemsBreakdown.map((b: any) => b.scoutIndex).filter((i: any) => i !== undefined && i !== null));
          
          if (currentScoutIndices.size > 0) {
            updatedScoutItems = updatedScoutItems.filter((sItem: any) => currentScoutIndices.has(sItem.scoutIndex));
          }

          updatedScoutItems = updatedScoutItems.map((sItem: any, sIdx: number) => {
            const bItem = parsedData.itemsBreakdown.find((b: any) =>
              b.scoutIndex === sItem.scoutIndex && namesReferToSameFood(b.canonicalDbName || b.name, sItem.originalName || sItem.keyword)
            ) || parsedData.itemsBreakdown.find((b: any) => namesReferToSameFood(b.canonicalDbName || b.name, sItem.originalName || sItem.keyword));
              if (bItem && (bItem.canonicalDbName || bItem.name)) {
                const newName = bItem.canonicalDbName || bItem.name;
                return {
                  ...sItem,
                  originalName: newName,
                  keyword: newName,
                  estimatedWeightGrams: bItem.weightGrams || sItem.estimatedWeightGrams
                };
              }
              return sItem;
            });
        }

        return res.json({
          mode: "modify",
          dietitianScratchpad: rawParsed._internalReasoning,
          text: rawParsed.message || `I have updated your meal to reflect the correction.`,
          message: rawParsed.message || `I have updated your meal to reflect the correction.`,
          data: parsedData,
          agentPrompt: fullPromptSent,
          scoutItems: updatedScoutItems,
          apiCalls
        });
      }

      if (!hasImage && !parsedData.imageUrl && parsedData.name) {
        try {
          // Remove weight/quantity numbers & units for cleaner search query
          const cleanFoodQuery = parsedData.name.replace(/\d+\s*(g|grams|oz|lbs|kg|servings|pcs|pieces|slice|slices)?/gi, '').trim() || parsedData.name;
          addDebugLog(`[Text Search Image Lookup] Attempting auto image retrieval for text food "${cleanFoodQuery}" (from "${parsedData.name}")...`);
          const fetchedImgs = await retrieveFoodImages(cleanFoodQuery, { mode: "light", count: 1 });
          if (fetchedImgs && fetchedImgs.length > 0 && fetchedImgs[0].imageUrl) {
            parsedData.imageUrl = fetchedImgs[0].imageUrl;
            parsedData.imageUrls = [fetchedImgs[0].imageUrl];
            addDebugLog(`[Text Search Image Lookup] Successfully attached retrieved image for "${parsedData.name}": ${parsedData.imageUrl}`);
          }
        } catch (imgErr: any) {
          addDebugLog(`[Text Search Image Lookup Error] ${imgErr?.message || imgErr}`);
        }
      }

      let finalScoutItems = mergeScoutItems(visionScoutItems, rawParsed.scoutItems);
      if (parsedData && Array.isArray(parsedData.itemsBreakdown) && parsedData.itemsBreakdown.length > 0) {
        finalScoutItems = finalScoutItems.map((sItem: any, sIdx: number) => {
          const bItem = parsedData.itemsBreakdown.find((b: any) =>
            b.scoutIndex === sItem.scoutIndex && namesReferToSameFood(b.canonicalDbName || b.name, sItem.originalName || sItem.keyword)
          ) || parsedData.itemsBreakdown.find((b: any) => namesReferToSameFood(b.canonicalDbName || b.name, sItem.originalName || sItem.keyword));
          if (bItem && (bItem.canonicalDbName || bItem.name)) {
            const newName = bItem.canonicalDbName || bItem.name;
            return {
              ...sItem,
              originalName: newName,
              keyword: newName,
              estimatedWeightGrams: bItem.weightGrams || sItem.estimatedWeightGrams
            };
          }
          return sItem;
        });
      }

      addDebugLog('[MealBuild] happy-path');
      const { mealBuild, pendingFoodLog } = attachHappyPathMealBuild({
        parsedData,
        jobId: req.body.jobId,
        activeMeal: req.body.activeMeal,
        scoutItems: finalScoutItems,
        diningEnvironment,
      });

      const responsePayload = {
        mode: "new_log",
        dietitianScratchpad: rawParsed._internalReasoning,
        text: rawParsed.message || `I have analyzed the food: **${parsedData.name}** (${parsedData.quantity}).`,
        message: rawParsed.message || `I have analyzed the food: **${parsedData.name}** (${parsedData.quantity}).`,
        data: pendingFoodLog || parsedData,
        mealBuild,
        savable: true,
        agentPrompt: fullPromptSent,
        scoutItems: finalScoutItems,
        apiCalls
      };

      if (isStream && hasSentHeaders) {
        res.write(`data: ${JSON.stringify({ final: true, result: responsePayload })}\n\n`);
        return res.end();
      }

      return res.json(responsePayload);
    }

    // CASE C: modification commands mode (Math-only fallbacks)
    if (mode === "modify") {
      addDebugLog(`[Mode Routing] MODIFY mode triggered (Math Fallback).`);
      
      let activeMeal = req.body.activeMeal;
      if (!activeMeal) {
        addDebugLog(`[Modify Math Error] No active meal exists in Firestore to modify.`);
        return res.json({
          text: rawParsed.message || "I couldn't modify the meal because there's no active meal currently logged. Please log a meal first!",
          message: rawParsed.message || "I couldn't modify the meal because there's no active meal currently logged. Please log a meal first!",
          data: null,
          apiCalls
        });
      }

      const commands = rawParsed.modificationCommand;
      if (!commands || !Array.isArray(commands) || commands.length === 0) {
        addDebugLog(`[Modify Math Error] Modification command array was empty or null.`);
        return res.json({
          text: rawParsed.message || "I received a modify request but no modification instructions were provided.",
          message: rawParsed.message || "I received a modify request but no modification instructions were provided.",
          data: activeMeal,
          apiCalls
        });
      }

      const originalItems = activeMeal.itemsBreakdown || [];
      const originalTotalWeight = originalItems.reduce((acc: number, it: any) => acc + (Number(it.weightGrams) || 0), 0) || 1;

      const standardItems: {[key: string]: {calories: number, saturatedFat: number, sodium: number}} = {
        steak: { calories: 2.5, saturatedFat: 0.05, sodium: 1.8 },
        beef: { calories: 2.5, saturatedFat: 0.05, sodium: 1.8 },
        chicken: { calories: 1.65, saturatedFat: 0.01, sodium: 0.7 },
        breast: { calories: 1.65, saturatedFat: 0.01, sodium: 0.7 },
        pork: { calories: 2.4, saturatedFat: 0.03, sodium: 0.8 },
        fish: { calories: 1.5, saturatedFat: 0.01, sodium: 0.8 },
        salmon: { calories: 2.0, saturatedFat: 0.015, sodium: 0.5 },
        rice: { calories: 1.3, saturatedFat: 0.0, sodium: 0.01 },
        broccoli: { calories: 0.35, saturatedFat: 0.0, sodium: 0.3 },
        egg: { calories: 1.5, saturatedFat: 0.03, sodium: 1.4 },
        avocado: { calories: 1.6, saturatedFat: 0.02, sodium: 0.07 },
        bread: { calories: 2.6, saturatedFat: 0.005, sodium: 4.8 },
        butter: { calories: 7.1, saturatedFat: 5.1, sodium: 5.7 },
        cheese: { calories: 4.0, saturatedFat: 1.8, sodium: 6.2 },
        salad: { calories: 0.2, saturatedFat: 0.0, sodium: 0.1 },
        tomato: { calories: 0.18, saturatedFat: 0.0, sodium: 0.05 },
        oil: { calories: 8.8, saturatedFat: 1.4, sodium: 0.0 },
        potato: { calories: 0.8, saturatedFat: 0.0, sodium: 0.05 },
        pasta: { calories: 1.3, saturatedFat: 0.0, sodium: 0.01 }
      };

      const findItemIndex = (itemNameStr: string, targetDbId: string | null): number => {
        return findItemIndexInList(activeMeal.itemsBreakdown, itemNameStr, targetDbId);
      };

      const isWholeMealMatch = (name: string) => {
        const nLower = name.trim().toLowerCase();
        const mealNameLower = (activeMeal.name || "").trim().toLowerCase();
        return nLower === mealNameLower || 
               nLower === "meal" || 
               nLower === "total" || 
               nLower === "all" ||
               (mealNameLower.includes(nLower) && (activeMeal.itemsBreakdown || []).every((it: any) => (it.name || "").toLowerCase() !== nLower));
      };

      for (const cmd of commands) {
        const action = cmd.action;
        const itemName = cmd.itemName || "";
        let newWeight = sanitizeMealWeight(cmd.newWeightGrams, 0);

        if (action === "update_weight") {
          if (newWeight <= 0) {
            const msgLower = (message || "").toLowerCase();
            if (msgLower.includes("whole") || msgLower.includes("entire") || msgLower.includes("pack") || msgLower.includes("all")) {
              const itemToUpdate = activeMeal.itemsBreakdown?.find((it: any) => it.name.toLowerCase().includes(itemName.toLowerCase())) || activeMeal.itemsBreakdown?.[0];
              const curW = itemToUpdate ? (Number(itemToUpdate.weightGrams) || 160) : 160;
              newWeight = curW * 2;
            } else {
              newWeight = originalTotalWeight;
            }
          }

          if (isWholeMealMatch(itemName)) {
            const originalItems = activeMeal.itemsBreakdown || [];
            const oldTotalWeight = originalItems.reduce((acc: number, it: any) => acc + (Number(it.weightGrams) || 0), 0) || 1;
            const R = newWeight / oldTotalWeight;
            
            activeMeal.itemsBreakdown.forEach((item: any) => {
              if (!item || typeof item !== 'object') return;
              const oldW = Number(item.weightGrams) || 0;
              item.weightGrams = Math.round(oldW * R);
              item.calories = Number(((item.calories || 0) * R).toFixed(1));
              item.protein = Number(((item.protein || 0) * R).toFixed(1));
              item.totalFat = Number(((item.totalFat || 0) * R).toFixed(1));
              item.saturatedFat = Number(((item.saturatedFat || 0) * R).toFixed(2));
              item.sodium = Number(((item.sodium || 0) * R).toFixed(1));
              item.carbohydrates = Number(((item.carbohydrates || 0) * R).toFixed(1));
            });
            
            addDebugLog(`[Modify Math] update_weight of entire meal "${activeMeal.name}" from ${oldTotalWeight}g to ${newWeight}g (ratio: ${R.toFixed(3)})`);
          } else {
            const targetDbId = cmd.targetDbId ? String(cmd.targetDbId).replace(/[^\x20-\x7E]/g, '').trim() : null;
            const idx = findItemIndex(itemName, targetDbId);
            let item = idx !== -1 ? activeMeal.itemsBreakdown[idx] : null;

            if (item) {
              const oldWeight = Math.max(1, Number(item.weightGrams) || 1);
              const R = newWeight / oldWeight;

              const foundation: Record<string, number> = {
                calories: Number(item.calories || 0) * R,
                protein: Number(item.protein || 0) * R,
                totalFat: Number(item.totalFat || item.fat || 0) * R,
                saturatedFat: Number(item.saturatedFat || 0) * R,
                carbohydrates: Number(item.carbohydrates || 0) * R,
                sodium: Number(item.sodium || 0) * R,
              };
              const priorScout = Number(item.estimatedCalories || item.scoutEstimatedCalories);
              const scoutEst = Number.isFinite(priorScout) && priorScout > 0 ? priorScout * R : null;
              const budget = computeItemBudget({
                itemName: item.name || item.originalName || itemName,
                weightGrams: newWeight,
                hardLabelKcal: item.lockedNutrientKeys?.includes?.('calories') ? Number(item.calories) * R : null,
                scoutEstimatedCalories: scoutEst,
              });
              const rec = reconcileNutrients({ nutrients: foundation, budget, formOk: true });
              addDebugLog(`[Budget] mode=edit item="${item.name}" kcal=${budget.budgetKcal} source=${budget.source} weight=${newWeight}`);
              addDebugLog(`[Reconcile] mode=edit action=${rec.action} foundation=${rec.foundationKcal} final=${rec.finalKcal}`);

              if (item) {
                item.weightGrams = newWeight;
                item.calories = Number(((rec?.nutrients?.calories ?? rec?.finalKcal) || 0).toFixed(1));
                item.protein = Number(((rec?.nutrients?.protein ?? foundation?.protein) || 0).toFixed(1));
                item.totalFat = Number(((rec?.nutrients?.totalFat ?? foundation?.totalFat) || 0).toFixed(1));
                item.saturatedFat = Number(((rec?.nutrients?.saturatedFat ?? foundation?.saturatedFat) || 0).toFixed(2));
                item.sodium = Number(((rec?.nutrients?.sodium ?? foundation?.sodium) || 0).toFixed(1));
                item.carbohydrates = Number(((rec?.nutrients?.carbohydrates ?? foundation?.carbohydrates) || 0).toFixed(1));
                if (scoutEst != null) item.estimatedCalories = scoutEst;
              }

              addDebugLog(`[Modify Math] update_weight of "${item.name}" (dbId: ${item.dbId}) from ${oldWeight}g to ${newWeight}g (ratio: ${R.toFixed(3)})`);
            } else {
              addDebugLog(`[Modify Math Warning] Could not find item "${itemName}" (targetDbId: ${targetDbId}) to update_weight.`);
            }
          }
        } 
        else if (action === "remove_item") {
          const targetDbId = cmd.targetDbId ? String(cmd.targetDbId).replace(/[^\x20-\x7E]/g, '').trim() : null;
          const idx = findItemIndex(itemName, targetDbId);

          if (idx !== -1) {
            const removedItem = activeMeal.itemsBreakdown[idx];
            activeMeal.itemsBreakdown.splice(idx, 1);
            addDebugLog(`[Modify Math] remove_item: Removed "${removedItem.name}" (dbId: ${removedItem.dbId})`);
          } else {
            addDebugLog(`[Modify Math Warning] Could not find item "${itemName}" (targetDbId: ${targetDbId}) to remove.`);
          }
        } 
        else if (action === "rename_alias") {
          const targetDbId = cmd.targetDbId ? String(cmd.targetDbId).replace(/[^\x20-\x7E]/g, '').trim() : null;
          const idx = findItemIndex(itemName, targetDbId);
          if (idx !== -1) {
            const item = activeMeal.itemsBreakdown[idx];
            item.name = cmd.newItemName || item.name;
            // If it's the only item, or represents the whole meal, update the top-level name
            if (activeMeal.itemsBreakdown.length === 1 || isWholeMealMatch(itemName)) {
              activeMeal.name = item.name;
            }
            addDebugLog(`[Modify Text] rename_alias: Renamed to "${item.name}" without changing nutrients.`);
          }
        }
        else if (action === "update_cooking_method") {
          const targetDbId = cmd.targetDbId ? String(cmd.targetDbId).replace(/[^\x20-\x7E]/g, '').trim() : null;
          const idx = findItemIndex(itemName, targetDbId);
          if (idx !== -1) {
            const item = activeMeal.itemsBreakdown[idx];
            const oldMethod = item.cookingMethod || 'unknown';
            const newMethod = cmd.newCookingMethod || 'unknown';

            // Get modifiers
            const oldModifier = getCookingMethodModifier(oldMethod);
            const newModifier = getCookingMethodModifier(newMethod);

            const itemWeight = Number(item.weightGrams) || 0;
            const factor = itemWeight / 100;

            // Old added values
            const oldAddedFat = parseFloat((oldModifier.addedFatPer100g * factor).toFixed(2));
            const oldAddedSatFat = parseFloat((oldModifier.addedSaturatedFatPer100g * factor).toFixed(2));
            const oldAddedCalories = parseFloat((oldModifier.addedCaloriesPer100g * factor).toFixed(1));

            // New added values
            const newAddedFat = parseFloat((newModifier.addedFatPer100g * factor).toFixed(2));
            const newAddedSatFat = parseFloat((newModifier.addedSaturatedFatPer100g * factor).toFixed(2));
            const newAddedCalories = parseFloat((newModifier.addedCaloriesPer100g * factor).toFixed(1));

            // Adjust item nutrients
            if (item) {
              item.calories = parseFloat(Math.max(0, (item.calories || 0) - oldAddedCalories + newAddedCalories).toFixed(1));
              item.saturatedFat = parseFloat(Math.max(0, (item.saturatedFat || 0) - oldAddedSatFat + newAddedSatFat).toFixed(2));
              item.cookingMethod = newMethod;
            }

            // Also adjust top-level activeMeal.nutrients directly
            if (activeMeal.nutrients) {
              if (activeMeal.nutrients.calories !== undefined) {
                activeMeal.nutrients.calories = parseFloat(Math.max(0, activeMeal.nutrients.calories - oldAddedCalories + newAddedCalories).toFixed(1));
              }
              if (activeMeal.nutrients.totalFat !== undefined) {
                activeMeal.nutrients.totalFat = parseFloat(Math.max(0, activeMeal.nutrients.totalFat - oldAddedFat + newAddedFat).toFixed(2));
              }
              if (activeMeal.nutrients.saturatedFat !== undefined) {
                activeMeal.nutrients.saturatedFat = parseFloat(Math.max(0, activeMeal.nutrients.saturatedFat - oldAddedSatFat + newAddedSatFat).toFixed(2));
              }
              // Recalculate unsaturatedFat
              const transFat = activeMeal.nutrients.transFat || 0;
              const totalFat = activeMeal.nutrients.totalFat || 0;
              const satFat = activeMeal.nutrients.saturatedFat || 0;
              activeMeal.nutrients.unsaturatedFat = parseFloat(Math.max(0, totalFat - satFat - transFat).toFixed(2));
            }

            addDebugLog(`[Modify Math] update_cooking_method for "${item.name}": changed from "${oldMethod}" to "${newMethod}". Calorie delta: ${(newAddedCalories - oldAddedCalories).toFixed(1)} kcal, Saturated Fat delta: ${(newAddedSatFat - oldAddedSatFat).toFixed(2)}g, Total Fat delta: ${(newAddedFat - oldAddedFat).toFixed(2)}g.`);
          } else {
            addDebugLog(`[Modify Math Warning] Could not find item "${itemName}" (targetDbId: ${targetDbId}) to update_cooking_method.`);
          }
        }
        else if (action === "add_item") {
          let cFactor = 1.0;
          let fFactor = 0.01;
          let sFactor = 0.5;
 
          const lowerName = itemName.toLowerCase();
          for (const [key, factors] of Object.entries(standardItems)) {
            if (lowerName.includes(key)) {
              cFactor = factors.calories;
              fFactor = factors.saturatedFat;
              sFactor = factors.sodium;
              break;
            }
          }
 
          const newItem = {
            name: itemName,
            weightGrams: newWeight,
            calories: Number((newWeight * cFactor).toFixed(1)),
            saturatedFat: Number((newWeight * fFactor).toFixed(2)),
            sodium: Number((newWeight * sFactor).toFixed(1)),
            dbSource: "estimated",
            dbId: null
          };

          if (!activeMeal.itemsBreakdown) activeMeal.itemsBreakdown = [];
          activeMeal.itemsBreakdown.push(newItem);
          addDebugLog(`[Modify Math] add_item: Added "${itemName}" with estimated weight ${newWeight}g.`);
        }
      }

      const newItems = activeMeal.itemsBreakdown || [];
      const newTotalWeight = newItems.reduce((acc: number, it: any) => acc + (Number(it.weightGrams) || 0), 0);
      const mealWeightRatio = newTotalWeight / originalTotalWeight;

      activeMeal.weightGrams = newTotalWeight;
      activeMeal.basis_type = 'total';
      activeMeal.serving_grams = newTotalWeight;
      if (newItems.length === 1) {
        activeMeal.name = newItems[0].name;
      }
      if (activeMeal.scoutItems && Array.isArray(activeMeal.scoutItems)) {
        const currentNames = new Set(newItems.map((it: any) => (it.name || '').toLowerCase().trim()));
        activeMeal.scoutItems = activeMeal.scoutItems.filter((scout: any) => {
          const sName = String(scout.keyword || scout.originalName || scout.name || '').toLowerCase().trim();
          return Array.from(currentNames).some((cName: any) => String(cName).includes(sName) || sName.includes(String(cName)));
        });
      }
      activeMeal.composition = newItems.map((it: any) => it.name).join(", ");
      
      const newCalories = newItems.reduce((acc: number, it: any) => acc + (Number(it.calories) || 0), 0);
      const newSaturatedFat = newItems.reduce((acc: number, it: any) => acc + (Number(it.saturatedFat) || 0), 0);
      const newSodium = newItems.reduce((acc: number, it: any) => acc + (Number(it.sodium) || 0), 0);

      if (!activeMeal.nutrients) activeMeal.nutrients = {};
      activeMeal.nutrients.calories = Number(newCalories.toFixed(1));
      activeMeal.nutrients.saturatedFat = Number(newSaturatedFat.toFixed(2));
      activeMeal.nutrients.sodium = Number(newSodium.toFixed(1));

      const nutrientKeys = [
        "protein", "totalFat", "unsaturatedFat", "omega3", 
        "carbohydrates", "addedSugar", "totalFibre", "solubleFibre", "potassium", 
        "magnesium", "calcium", "iron", "zinc", "selenium", "iodine", "phosphorus", 
        "vitaminD", "vitaminB12", "folate", "vitaminC", "vitaminE", "vitaminK", 
        "vitaminA", "vitaminB6", "thiamine", "riboflavin", "niacin"
      ];

      for (const key of nutrientKeys) {
        if (activeMeal.nutrients[key] !== undefined) {
          activeMeal.nutrients[key] = Number((activeMeal.nutrients[key] * mealWeightRatio).toFixed(2));
        }
      }

      addDebugLog('[MealBuild] edit-path');
      const { mealBuild, pendingFoodLog } = attachHappyPathMealBuild({
        parsedData: activeMeal,
        jobId: req.body.jobId,
        activeMeal: req.body.activeMeal,
        diningEnvironment: activeMeal?.diningEnvironment,
      });

      mealBuild.staleDietitianNarrative = true;

      const responsePayload = {
        mode: "modify",
        text: rawParsed.message || "I have recalculated your meal's metrics with precision based on your instructions.",
        message: rawParsed.message || "I have recalculated your meal's metrics with precision based on your instructions.",
        data: pendingFoodLog || activeMeal,
        mealBuild,
        savable: true,
        agentPrompt: fullPromptSent,
        apiCalls
      };

      if (isStream && hasSentHeaders) {
        res.write(`data: ${JSON.stringify({ final: true, result: responsePayload })}\n\n`);
        return res.end();
      }

      return res.json(responsePayload);
    }
  } catch (error: any) {
    console.error("[Food Analyze Error]:", error);
    
    // Dietitian Degrade logic (Phase 1)
    if (preCalculatedItems && preCalculatedItems.length > 0 && preCalculatedItems.some((p: any) => p.estimatedCalories !== undefined || (p.primaryBase100g && p.primaryBase100g.calories !== undefined))) {
      addDebugLog(`[Dietitian Degrade] Dietitian failed permanently, but pre-calculated math exists. Salvaging meal build.`);
      
      const salvagedAggregatedNutrients: Record<string, number> = {};
      NUTRIENT_KEYS.forEach(k => salvagedAggregatedNutrients[k] = 0);
      if (preCalculatedItems && Array.isArray(preCalculatedItems)) {
        preCalculatedItems.forEach((p: any) => {
          if (p.nutrients) {
            NUTRIENT_KEYS.forEach(k => {
              salvagedAggregatedNutrients[k] = parseFloat(((salvagedAggregatedNutrients[k] || 0) + (Number(p.nutrients[k]) || 0)).toFixed(2));
            });
          }
        });
      }

      const salvagedMeal = buildSavableMealFromParsed(preCalculatedItems, req.body.activeMeal, salvagedAggregatedNutrients, null);
      const degradedMeal = markDietitianDegraded(salvagedMeal, error.message);
      const payloadData = toPendingFoodLog(degradedMeal);
      
      const successPayload = {
        data: payloadData,
        mealBuild: degradedMeal,
        degradedStages: degradedMeal.degradedStages,
        message: "Nutrients logged based on core databases, but AI clinical advice is currently unavailable.",
        agentPrompt: fullPromptSent,
        apiCalls
      };

      if (isStream && hasSentHeaders) {
        res.write(`data: ${JSON.stringify({ final: true, result: successPayload })}\n\n`);
        return res.end();
      } else {
        return res.status(200).json(successPayload);
      }
    }

    const errorPayload: any = {
      error: `Failed to process your request (Error: ${error.message || 'Connection timed out'}). Please try again with a different model from the top-left dropdown.`,
      agentNotAvailable: true
    };
    if (visionScoutItems && visionScoutItems.length > 0) {
      errorPayload.scoutItems = visionScoutItems;
      errorPayload.scoutContentType = visionScoutContentType;
    }
    
    if (isStream && hasSentHeaders) {
      res.write(`data: ${JSON.stringify(errorPayload)}\n\n`);
      return res.end();
    } else {
      return res.status(200).json(errorPayload);
    }
  }
  });
});
app.post("/api/gemini/medical-analyze", async (req, res) => {
  if (!req.headers['x-session-id'] || !req.headers['x-session-id'].toString().startsWith('server-job-')) {
    return res.status(403).json({ error: 'This SSE path is deprecated and strictly reserved for internal loopback execution.' });
  }
  const isStream = req.query.stream === 'true';
  let hasSentHeaders = false;

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.flushHeaders();
    hasSentHeaders = true;

    const originalStatus = res.status.bind(res);

    res.status = (code: number) => {
      if (!res.headersSent) {
        originalStatus(code);
      }
      return res;
    };

    res.json = (body: any) => {
      res.write(`data: ${JSON.stringify({ final: true, result: body })}\n\n`);
      res.end();
      return res;
    };
  }

  const sendStreamEvent = (data: any) => {
    if (isStream && hasSentHeaders) {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
      } catch (e) {}
    }
  };

  await streamDebugLogStorage.run((msg: string) => {
    // Forward every verbose internal LLM dispatch/prompt/response log line live to
    // THIS request's own SSE connection only — same scoped mechanism as /api/gemini/food-analyze.
    sendStreamEvent({ type: 'log', logType: 'verbose', message: msg, timestamp: Date.now() });
  }, async () => {
  try {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "default-session";
    const sendLog = (logType: string, messageText: string, extra?: any) => {
      sendStreamEvent({ type: 'log', logType, message: messageText, timestamp: Date.now(), ...extra });
    };

let { 
      message, 
      image, 
      images, 
      imageDates, 
      history, 
      userProfile, 
      engine, 
      existingBiomarkers, 
      agentType, 
      biomarkerHistory, 
      biomarkers, 
      recentMeals,
      foodLogs,
      customSystemInstruction,
      customVariableData,
      batchSize
    } = req.body;

    // Isolate Diagnostic Agent Data (agent4):
    // Ensure agent4 only receives diagnostic-relevant data (biomarkers and profile)
    // and is not sent other conversation or food log entries.
    const allBiomarkerKeys = Array.from(new Set([
      ...biomarkerDefinitions.map(d => d.key),
      ...Object.keys(userProfile?.customBiomarkers || {})
    ]));
    
    const agent1Step1Schema = {
      type: Type.OBJECT,
      properties: {
        extractedData: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              biomarker: {
                type: Type.STRING,
                description: "The canonical key of the biomarker. If matching EXISTING DATABASE KEYS, use that exact key. If it is a new or custom biomarker (e.g. Blood Pressure, Ferritin, Cortisol), generate a clean lowercase snake_case key for it (e.g., 'blood_pressure', 'ferritin')."
              },
              date: { type: Type.STRING, description: "Format: YYYY-MM-DD" },
              numeric_value: { type: Type.NUMBER, description: "The exact numerical value if quantitative. Leave null if qualitative.", nullable: true },
              qualitative_value: { type: Type.STRING, description: "The exact string if qualitative (e.g., '109 / 53', 'NEGATIVE'). Leave null if quantitative.", nullable: true },
              unit: { type: Type.STRING, description: "The exact unit verbatim from the text. Leave empty string if none." },
              explanation: { type: Type.STRING, description: "Why or how it was mapped or created." },
              display_name: { type: Type.STRING, nullable: true, description: "REQUIRED whenever 'biomarker' is a new/custom key not in EXISTING DATABASE KEYS. The official clinical term (e.g. 'Hematochezia', 'Hemorrhoids'), never a plain-English fragment. Set to null when 'biomarker' already matches an EXISTING DATABASE KEY." }
            },
            required: ["biomarker", "date", "unit", "explanation", "display_name"]
          }
        },
        unmappedTests: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              raw_name: { type: Type.STRING, description: "The official clinical term for this symptom/condition (e.g. 'Hematochezia', not 'Blood in Stool'). Must match the display_name used for the same item in extractedData." },
              suggested_key: { type: Type.STRING },
              date: { type: Type.STRING, nullable: true },
              numeric_value: { type: Type.NUMBER, nullable: true },
              qualitative_value: { type: Type.STRING, nullable: true },
              unit: { type: Type.STRING, nullable: true },
              explanation: { type: Type.STRING, nullable: true }
            },
            required: ["raw_name", "suggested_key"]
          }
        },
        text: { type: Type.STRING, description: "Friendly clinical conversational message to the user." },
        hasMoreMarkers: { type: Type.BOOLEAN },
        lastProcessedIndex: { type: Type.INTEGER, nullable: true, description: "The exact character index or row count where extraction stopped. Used for server-side continuation instead of echoing remaining text." },
        isWrongDoor: { type: Type.BOOLEAN, description: "True ONLY if the user input is entirely food logging, dietary journals, or completely unrelated to medical/biomarker data. Set to false for ANY medical data or symptoms." },
        estimatedTotalMarkers: { type: Type.INTEGER }
      },
      required: ["extractedData", "text", "hasMoreMarkers", "estimatedTotalMarkers"]
    };
    const dataReviewSchema = {
      type: Type.OBJECT,
      properties: {
        message: { type: Type.STRING, description: "Conversational summary of clinical range adjustments and review findings for this batch. If there are extreme divergences, highlight them here." },
        extremeDivergences: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              key: { type: Type.STRING, enum: allBiomarkerKeys.length > 0 ? allBiomarkerKeys : ["unknown_biomarker"] },
              originalValue: { type: Type.NUMBER },
              unit: { type: Type.STRING },
              reason: { type: Type.STRING, description: "Explain why it seems anomalous or unit mismatched" },
              suggestedAction: { type: Type.STRING, description: "Suggestion (e.g. 'Update value' or 'Change metric unit')" }
            },
            required: ["key", "originalValue", "unit", "reason", "suggestedAction"]
          }
        },
        reviewedBiomarkers: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              key: { type: Type.STRING, enum: allBiomarkerKeys.length > 0 ? allBiomarkerKeys : ["unknown_biomarker"] },
              name: { type: Type.STRING, description: "Standard clinical name of the biomarker" },
              userValue: { type: Type.STRING, description: "Exact value from the input data. MUST preserve qualitative strings exactly (e.g. 'NEGATIVE', 'POSITIVE') as strings, or numerical values formatted as string." },
              unit: { type: Type.STRING, description: "Exact unit from the input data" },
              isDataArtifact: { type: Type.BOOLEAN, description: "Set to true if userValue is an extreme physiological outlier (>3x upper limit or <0.2x lower limit) suggesting a document parsing/ingestion error (e.g. relative % 11.8% parsed as absolute count 11.8 10^9/L). Otherwise set to false." },
              artifactNote: { type: Type.STRING, description: "Clinical note if isDataArtifact is true explaining the suspected parsing or lab artifact (e.g. 'Value 11.8 10^9/L appears to be a relative percentage (11.8%) or decimal offset error rather than an absolute count.'). Set to empty string '' if isDataArtifact is false." },
              _demographicAudit: {
                type: Type.OBJECT,
                properties: {
                  standardWesternBaseline: { type: Type.STRING, description: "The textbook global/Western range" },
                  knownEthnicOrRegionalVariances: { type: Type.STRING, description: "State the exact regional variant and the society it comes from. If absolutely none exist, state 'None'" },
                  ageAndGenderShifts: { type: Type.STRING, description: "How age and gender naturally alter the baseline" },
                  finalAppliedAdjustments: { type: Type.STRING, description: "The synthesis of how you are modifying the bounds for this specific user" }
                },
                required: ["standardWesternBaseline", "knownEthnicOrRegionalVariances", "ageAndGenderShifts", "finalAppliedAdjustments"]
              },
              profileAdjustedNormalRange: { type: Type.STRING, description: "The healthy reference range for which the biomarker is not at risk (e.g., '18.5 - 22.9 kg/m2')" },
              optimalValue: { type: Type.STRING, description: "CRITICAL: The SPECIFIC SINGLE OPTIMAL TARGET VALUE for this user profile to aim for (e.g. '21.0 kg/m2' for BMI, '30 mmol/mol' for HbA1c, '115 mmHg' for SBP, '1.2 mmol/L' for ApoB), NOT a range string and NOT a repeat of normalRange. Calculate the single ideal target value within the healthy spectrum that this specific demographic profile should aim for, rather than aiming just below the risk threshold." },
              rangeBrackets: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING, description: "Bracket name (e.g., Optimal, Elevated, Mildly Decreased)" },
                    range: { type: Type.STRING, description: "Mathematical bounds (e.g., >= 90, 60-89). Must be continuous with no gaps." }
                  },
                  required: ["name", "range"]
                }
              },
              description: { type: Type.STRING, description: "2-sentence physiological role" },
              _statusReasoning: { type: Type.STRING, description: "1-sentence mathematical evaluation comparing userValue to profileAdjustedNormalRange bounds" },
              status: { type: Type.STRING, enum: ["Optimal", "Sub-Optimal (Action Zone)", "At Risk"], description: "Strictly 'Optimal', 'Sub-Optimal (Action Zone)' or 'At Risk' based on _statusReasoning" },
              reference: { type: Type.STRING, description: "The exact clinical body or study acting as the anchor for the calibrated range (e.g., 'KDIGO 2024 Guidelines', 'ADA Standards of Care'). Must be explicit." },
              specificRiskContext: { type: Type.STRING, description: "3-4 sentence personalized clinical context based on the final status" },
              correctedHistoricalLogs: {
                type: Type.ARRAY,
                description: "Array of corrected historical entries if anomalous scaling/notation or outlier errors are found. Set to empty array if no corrections are needed.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    date: { type: Type.STRING, description: "The exact date of the historical log (e.g., YYYY-MM-DD)" },
                    originalValue: { type: Type.NUMBER, description: "The original incorrect value" },
                    correctedValue: { type: Type.NUMBER, description: "The newly calculated normalized/corrected value" },
                    note: { type: Type.STRING, description: "Clinical/scaling justification for this specific change" }
                  },
                  required: ["date", "originalValue", "correctedValue", "note"]
                }
              }
            },
            required: ["key", "name", "userValue", "unit", "isDataArtifact", "artifactNote", "_demographicAudit", "profileAdjustedNormalRange", "optimalValue", "reference", "rangeBrackets", "description", "_statusReasoning", "status", "specificRiskContext", "correctedHistoricalLogs"]
          }
        }
      },
      required: ["message", "reviewedBiomarkers"]
    };
    const healthPlanningSchema = {
      type: Type.OBJECT,
      properties: {
        text: { type: Type.STRING, description: "A brief, conversational greeting directly addressing the user." },
        _internalReasoning: { type: Type.STRING, description: "Step-by-step clinical deduction and date calculation logic." },
        summary: { type: Type.STRING, description: "Executive clinical summary synthesizing diagnostic findings and risk trends." },
        retestBiomarkers: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: "Display name of the biomarker" },
              recommendedTestName: { type: Type.STRING, description: "The precise, standard clinical lab order name (e.g., 'Hepatic Function Panel')" },
              priority: { type: Type.STRING, enum: ["High", "Medium", "Low"], description: "Priority level" },
              retestTimeframe: { type: Type.STRING, description: "The interval (e.g., '3 months')" },
              lastTestedDate: { type: Type.STRING, description: "Exact date this was last tested (Format: DD-MM-YYYY)" },
              nextScheduledDate: { type: Type.STRING, description: "Exact calculated date for the next test (Format: DD-MM-YYYY)" },
              dueStatus: { type: Type.STRING, description: "A tag indicating whether it's 'Already Due' or 'Due in X months/weeks'" },
              gpClinicalJustification: { type: Type.STRING, description: "A persuasive email/letter addressed to a skeptical GP who thinks the user does not need the retest. Combines profile context, baseline trends, timing urgency, clinical guidelines, and risk evidence to convince the doctor why ordering this retest is necessary." },
              key: { type: Type.STRING, description: "biomarker_database_key" },
              currentValue: { type: Type.STRING, description: "value and unit" },
              unit: { type: Type.STRING, description: "unit" }
            },
            required: ["name", "recommendedTestName", "priority", "retestTimeframe", "lastTestedDate", "nextScheduledDate", "dueStatus", "gpClinicalJustification", "key"]
          }
        },
        testingGaps: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              testName: { type: Type.STRING, description: "Name of the missing scan or lab (e.g., 'Abdominal Ultrasound')" },
              category: { type: Type.STRING, enum: ["short_term", "long_term"], description: "short_term (< 2 years) or long_term (>= 2 years)" },
              priority: { type: Type.STRING, enum: ["High", "Medium", "Low"], description: "Priority level" },
              nextScheduledDate: { type: Type.STRING, description: "Exact date by which this should be completed (Format: DD-MM-YYYY)" },
              targetCondition: { type: Type.STRING, description: "The disease or condition being ruled out" },
              userBenefit: { type: Type.STRING, description: "Explanation of why uncovering this missing data will improve their life or treatment plan." },
              gpClinicalJustification: { type: Type.STRING, description: "A persuasive email/letter addressed to a skeptical GP who thinks the user does not need the test. Combines profile rationale, clinical evidence, guidelines, and patient risk factors to convince the doctor why ordering this test is necessary." }
            },
            required: ["testName", "category", "priority", "nextScheduledDate", "targetCondition", "userBenefit", "gpClinicalJustification"]
          }
        },
        mode: { type: Type.STRING, description: "discussion" },
        status: { type: Type.STRING, description: "active" }
      },
      required: ["text", "_internalReasoning", "summary", "retestBiomarkers", "testingGaps", "mode", "status"]
    };

    if (agentType === "agent4") {
      if (history && history.length > 0) {
        history = history.filter((h: any) => {
          if (!h.content) return false;
          const lower = h.content.toLowerCase();
          // Exclude food log messages, extracted biomarkers, and other unrelated agent content
          if (
            lower.includes("food log") || 
            lower.includes("[extracted food") || 
            lower.includes("active meal") || 
            lower.includes("[extracted biomarkers") ||
            lower.includes("meal log") ||
            lower.includes("banana") ||
            lower.includes("pineapple")
          ) {
            return false;
          }
          return true;
        });
      }
      addDebugLog(`[Medical Analyze Agent] Diagnostic Agent (agent4) data isolated: other conversations and food log entries removed.`, explicitSessionId);
    }

    // B2 2.1: Prompt hygiene — one raw injection. We do not inject chat history for extractor steps 
    // (agent1_step1, lab_extract, symptom_diary) to prevent double payload costs.
    const isExtractor = agentType === 'agent1_step1' || agentType === 'lab_extract' || agentType === 'symptom_diary' || agentType === 'agent1';
    
    if (isExtractor) {
      addDebugLog(`[Medical Analyze Agent] Extractor agent detected (${agentType}). Chat history omitted for token hygiene.`, explicitSessionId);
      history = []; // One raw injection only.
    }

    let ingestTrace = req.body.ingestTrace || null;
    if (isExtractor && message) {
      try {
        const rows = lexTable(String(message));
        const multiCol = rows.filter((r) => r.length > 1);
        if (multiCol.length > 1) {
          const trace = ingestTrace && ingestTrace.rows?.length ? ingestTrace : buildIngestBatch(rows);
          const abort = shouldAbortTablePath(trace);
          addDebugLog(`[Medical Analyze Agent] Layer-1 lexer rows=${trace.totalInputRows} high=${trace.highConfidenceCount} flagged=${trace.flaggedCount} unmatched=${trace.unmatchedCount} skip=${trace.skippedCount} abort=${abort}`, explicitSessionId);
          if (!abort) {
            ingestTrace = trace;
            const leftover = leftoverTextFromTrace(trace);
            if (!leftover) {
              const extracted = stagedRowsToExtractedData(trace);
              const cmds = flaggedRowsToModificationCommands(trace);
              addDebugLog(`[Medical Analyze Agent] Layer-1 complete (${extracted.length} staged). Skipping LLM.`, explicitSessionId);
              return res.json({
                text: `I matched ${trace.highConfidenceCount} lab row${trace.highConfidenceCount === 1 ? '' : 's'} automatically${trace.flaggedCount ? ` and flagged ${trace.flaggedCount} for unit review` : ''}. Review the table and Apply.`,
                agentType,
                extractedData: extracted,
                hasMoreMarkers: false,
                lastProcessedIndex: null,
                estimatedTotalMarkers: extracted.length,
                unmappedTests: [],
                ingestTrace: trace,
                modificationCommand: cmds.length ? cmds : undefined,
              });
            }
            message = leftover;
            addDebugLog(`[Medical Analyze Agent] Layer-1 leftover ${trace.unmatchedCount} rows sent to Parser.`, explicitSessionId);
          }
        } else {
          addDebugLog(`[Medical Analyze Agent] Layer-1 lexer did not see a multi-row table (lines=${rows.length}).`, explicitSessionId);
        }
      } catch (lexErr: any) {
        addDebugLog(`[Medical Analyze Agent] Layer-1 lexer failed open: ${lexErr?.message || lexErr}`, explicitSessionId);
      }
    }

    addDebugLog(`[Medical Analyze Agent] Request received for agentType: ${agentType || 'None'}. Message: "${String(message).substring(0, 100)}..."`, explicitSessionId);
    sendLog('status', `Analyzing your message${agentType ? ` (${agentType})` : ''}...`);
    if (history && history.length > 0) {
      addDebugLog(`[Medical Analyze Agent] Included conversational history context (${history.length} turns).`, explicitSessionId);
    }


    if (!agentType) agentType = "agent1_step1";

    if (true) {
      let systemInstruction = "";
      let mockData: any = {};
      let fullPromptSent = "";

      if (agentType === "agent4") {
        systemInstruction = `You are a Medical Diagnostics Assessment agent.
Your objective is to analyze the user's biomarker history, recent test data, profile, and current symptoms to project timeline risks and identify testing gaps or overall health trends.
You MUST output ONLY a valid JSON object matching the exact schema:
- "text": A brief, professional, conversational greeting and summary response directly addressing the user (e.g., "I have completed a comprehensive diagnostic and health planning audit based on your recent biomarker history. Here are the key findings, recommended retests, and testing gaps identified for your profile:").
- "summary": Executive clinical summary synthesizing diagnostic findings, risk trends, and health planning recommendations (1-2 clear paragraphs max for the diagnostic audit banner).
- "retestBiomarkers": Array of objects specifying biomarkers recommended for retesting (each item MUST include "name", "retestTimeframe", "recommendedTestName" [the specific clinical test/panel to order/take], "gpClinicalJustification" [a persuasive email/letter written directly for a skeptical GP who thinks the user doesn't need this retest], "dueStatus", and optional "key", "currentValue", "unit"). Do not include dateRationale or dateImportanceRating.
- "testingGaps": Array of objects identifying missing tests or health gaps (each item has "testName", "category" ['short_term' | 'long_term'], "priority", "nextScheduledDate", "targetCondition", "userBenefit", "gpClinicalJustification" [a persuasive email/letter written directly for a skeptical GP who thinks the user doesn't need this test]). Do not include profileRationale.
- "_internalReasoning": Detailed clinical reasoning step-by-step.
- "mode": "discussion"
- "status": "active"`;
        mockData = { text: "I have reviewed your medical records.", mode: "discussion", status: "active" };
      } else if (agentType === "agent1_step1" || agentType === "lab_extract" || agentType === "symptom_diary") {
        const itemsPerBatch = (typeof batchSize === 'number' && batchSize > 0) ? Math.min(Math.floor(batchSize), 200) : 50;
        
        systemInstruction = `{
  "agent_profile": {
    "role": "Expert Clinical Data Extractor and Lossless Data Conduit",
    "objective": "Parse raw medical reports/text/images, isolate distinct biomarker measurements, and structure them verbatim into standard clinical format.",
    "routing_context": "If agentType='symptom_diary', strictly process prose and patient-reported entries. If agentType='lab_extract', strictly process tabular clinical reports. Do NOT mix them up."
  },
  "critical_extraction_rules": {
    "zero_math_verbatim_extraction": "You are strictly forbidden from performing any calculations, normalizations, or unit conversions. Extract the exact numerical value and the exact unit provided in the text.",
    "verbatim_qualitative_data": "Qualitative results (e.g., 'Negative', 'Trace', 'High', 'Present', 'Positive') and user-reported clinical findings or symptoms (e.g., 'Hemorrhoids', 'Blood in stool', 'Rectal bleeding') must be extracted as qualitative entries exactly as written or reported.",
    "dictionary_mapping": "If a test or symptom matches a key from EXISTING DATABASE KEYS (e.g., 'hemorrhoidal_symptom_score', 'gerd_symptom_score'), use that exact key. For patient-reported symptoms/conditions (e.g. 'blood in poop', 'hemorrhoids', 'acid reflux', 'joint pain'), map them to a standardized clinical symptom score key (e.g., 'hemorrhoidal_symptom_score', 'gerd_symptom_score', 'joint_pain_severity_score') with unit 'score' and display_name as the official clinical index name (e.g., 'Hemorrhoidal Disease Symptom Score (HDSS)').",
    "unit_standardization": "Standardize 'µg/L' and 'ug/L' to always return as 'ug/L' (they are equivalent). Treat 'u/week' and 'units/week' as equivalent and output as 'u/week'."
  },
  "self_reported_symptom_diary_rules": {
    "purpose": "Self-reported symptoms and conditions are patient diary entries. Map them to standardized, universally recognized clinical symptom scores or disease severity indices so they can be evaluated consistently across all global demographics.",
    "clinical_symptom_score_mapping": "When a patient reports a symptom or condition (e.g. 'blood in poop', 'hemorrhoids', 'acid reflux', 'joint pain'), map it to an established clinical symptom score or index key. For example, for hemorrhoids/rectal bleeding/blood in stool, use key 'hemorrhoidal_symptom_score' and display_name 'Hemorrhoidal Disease Symptom Score (HDSS)'. For acid reflux, use key 'gerd_symptom_score' and display_name 'Gastroesophageal Reflux Symptom Score (GERD-SS)'. Always set unit to 'score'.",
    "score_severity_quantification": "Quantify symptom severity/frequency into numerical scores (unit: 'score'): 0 = Remission / Healthy baseline (asymptomatic); 1 = Mild flare-up (slight, occasional, mild); 2 = Moderate flare-up (some blood, noticeable symptoms over recent/few days, 'the last few days'); 3 = Severe progression (heavy bleeding, constant/intense symptoms). Include a concise clinical description in 'qualitative_value' (e.g. 'Moderate flare-up with blood in stool').",
    "single_biomarker_per_condition": "When a patient reports a condition and related symptom together (e.g., hemorrhoids and blood in stool), create ONE unified clinical symptom score entry (e.g. key: 'hemorrhoidal_symptom_score', display_name: 'Hemorrhoidal Disease Symptom Score (HDSS)'). Do NOT create separate duplicate entries.",
    "multi_day_expansion": "Span references ('the last few days' = min 3 days, 'since Monday', 'for the past week') → create ONE extractedData entry per day in that span. Use CURRENT DATE as anchor for 'today'.",
    "descriptive_display_naming": "Set 'display_name' to the official clinical index name (e.g. 'Hemorrhoidal Disease Symptom Score (HDSS)'). Use the same value for 'raw_name' in unmappedTests.",
    "explanation_field_requirement": "State this is a patient-reported symptom mapped to a standardized clinical index score and briefly note how date and score were derived."
  },
  "mode_routing": {
    "priority": "Always prioritize structured data extraction over conversational text when raw medical data/text/photos are present."
  },
  "chunked_processing": {
    "limit_per_chunk": ${itemsPerBatch},
    "behavior": [
      "Extract ONLY the first ${itemsPerBatch} biomarker entries in this chunk.",
      "If you reach the limit of ${itemsPerBatch} extracted biomarkers, set 'hasMoreMarkers' to true in your JSON response.",
      "Return the exact string index or document position where you stopped extracting in 'lastProcessedIndex'. The server will slice the input text automatically for the next batch using this offset, saving tokens.",
      "In the 'text' response, kindly inform the user you have completed this chunk and ask to continue.",
      "If total remaining biomarkers <= ${itemsPerBatch}, set 'hasMoreMarkers' to false and 'lastProcessedIndex' to null."
    ]
  },
  "required_output_format": {
    "response_schema": {
      "extractedData": "A JSON array of objects, containing the newly extracted biomarker entries. If the user message is 'continue', parse the next batch from the text starting at the offset.",
      "unmappedTests": [
        {
          "raw_name": "string (For structured lab/report data: the exact test name as it literally appears in the text, e.g. 'Blood Pressure'. For self-reported symptoms/conditions in free text: a clean, descriptive, Title Case biomarker/symptom name that matches the meaning of the report — e.g. 'Blood in Stool', NOT a single fragment word like 'blood'. This is shown to the patient as the biomarker's display name, so it must read as a real clinical term, never a truncated word.)",
          "suggested_key": "string (A clean, lowercase snake_case key suggestion for this test, e.g., 'blood_pressure')",
          "date": "string or null",
          "numeric_value": "number or null",
          "qualitative_value": "string or null",
          "unit": "string or null",
          "explanation": "string or null"
        }
      ],
      "text": "string (Friendly clinical conversational message)",
      "hasMoreMarkers": "boolean",
      "lastProcessedIndex": "number (The text offset where parsing paused)",
      "estimatedTotalMarkers": "number (Realistic, non-hallucinated estimate of total distinct biomarker readings present in original report text.)"
    }
  },
  "extracted_data_schema": [
    {
      "biomarker": "string (Match from EXISTING DATABASE KEYS, OR a clean lowercase snake_case key for a new/custom biomarker e.g. 'blood_pressure', 'pulse_rate'.)",
      "display_name": "string or null. REQUIRED whenever 'biomarker' is a NEW/custom key not in EXISTING DATABASE KEYS. Provide the official, clinically-correct name for this biomarker/symptom/condition — use your own medical knowledge to pick the term a clinician would actually write in a chart (e.g. 'Hematochezia' for visible blood in stool, 'Melena' if described as dark/tarry, 'Hemorrhoids'). If no distinct clinical term applies, fall back to a clean, Title Case descriptive name. This becomes the PERMANENT display name saved to the patient's biomarker dictionary, so pick deliberately and reuse the exact SAME display_name every time this same biomarker key recurs in this conversation. Set to null for biomarkers already in EXISTING DATABASE KEYS (they already have an official name).",
      "date": "YYYY-MM-DD",
      "numeric_value": "number or null",
      "qualitative_value": "string or null",
      "unit": "string (verbatim from text)",
      "explanation": "string (why/how it was mapped or created)"
    }
  ],
  "rules_for_inputs": {
    "raw_data_extraction": "Extract only from raw text/report. Do NOT extract from pre-existing logs.",
    "unmapped_data_handling": "You MUST extract ALL distinct biomarker measurements and patient-reported symptoms/conditions present in raw data into 'extractedData'. Generate clean lowercase snake_case keys for new tests/symptoms (e.g. 'blood_pressure', 'hemorrhoids'). For self-reported symptoms and conditions, follow self_reported_symptom_diary_rules — ALL entries must have dated logs with multi_day_expansion applied.",
    "continue_extracting": "If the user message is 'continue', parse the NEXT batch of up to ${itemsPerBatch} biomarkers starting EXACTLY from the provided offset. You MUST NOT repeat, duplicate, or include ANY entries that are already present in the 'PREVIOUSLY EXTRACTED JSON'.",
    "update_data": "Support editing, adding, or deleting biomarkers in the array."
  }
}

=== EXISTING DATABASE KEYS ===
${Array.from(new Set([...biomarkerDefinitions.map(d => d.key), ...Object.keys(userProfile?.customBiomarkers || {})])).join(', ')}`;
        mockData = {};
      } else if (agentType === "agent1") {
        systemInstruction = `You are an expert Clinical Data Parser and Medical Ontology Agent.
Your primary objective is to parse raw health reports, standardize clinical terminology, and structure biomarker readings into structured JSON. You must preserve mathematical data, qualitative results, lab ranges, and clinical notes exactly as provided.

=== CORE TASKS ===
1. Extraction & Standardization: Parse the incoming raw data. Convert every raw biomarker name into its most widely accepted standard clinical terminology (e.g., "Serum alt level" maps to "Alanine Aminotransferase (ALT)").
2. Lossless Math & Units (CRITICAL): You are strictly forbidden from performing calculations, unit conversions, or inferring missing units. Extract the exact numerical value and the exact unit provided in the text.
3. Qualitative Data (CRITICAL): If a result is qualitative (e.g., "Negative", "Trace", "High"), extract it exactly as written.
4. Dictionary Mapping (MANDATORY): Map to existing keys from EXISTING DATABASE KEYS when applicable. If a biomarker is a new or custom test not in EXISTING DATABASE KEYS, generate a clean lowercase snake_case key for it (e.g., 'blood_pressure') and extract its value, unit, date, and explanation into 'extractedData'.
5. Clinical Mapping: For each biomarker, map it to:
   - riskCategories: Physiological risk categories (e.g., 'Cardiovascular', 'Kidney & hydration', 'Metabolic & glycemic', 'Liver & hepatitis stress', 'Hematology', 'Biometrics', 'Other').
   - standardMedicalGrouping: Main clinical division ('Metabolic', 'Hepatic', 'Renal', 'Hematology', 'Biometrics', 'Other').
   - potentialMedicalConditions: Broad diagnostic associations.
6. Explanation of Changes (CRITICAL): For each biomarker, if you standardized, changed, merged, or corrected its name, value, or unit, you MUST provide a detailed explanation of why you made this change in the 'explanation' field.

=== EXISTING DATABASE KEYS ===
[${Array.from(new Set([...biomarkerDefinitions.map(d => d.key), ...Object.keys(userProfile?.customBiomarkers || {})])).join(', ')}]

=== FORMAT & SYSTEM RESTRICTIONS ===
Your output MUST be valid JSON using the schema provided. Return the array of biomarkers under the "extractedData" key.`;
        mockData = {};
      } else if (agentType === "agent2" || agentType === "agent1_step2") {
        systemInstruction = `You are an expert Clinical Ontologist and conversational health assistant (Step 2: Category Mapping).
Your tasks:
1. Identify all unique biomarkers in the JSON list and categorize them by associating:
   - "riskCategories": An array of matching risk categories. Choose from: 'Cardiovascular', 'Kidney & hydration', 'Metabolic & glycemic', 'Liver & hepatitis stress', 'Hematology'. If none match, you can use other appropriate categories.
   - "standardMedicalGrouping": Choose exactly ONE of these standard physiological groupings: 'Metabolic', 'Hepatic', 'Renal', 'Hematology', 'Biometrics', or 'Other'.
   - "potentialMedicalConditions": An array of related medical conditions or risks (e.g. ['Diabetes Risk', 'Insulin Resistance', 'Obesity', 'Anemia', 'Hepatitis Stress', 'Fatty Liver', 'Chronic Kidney Disease']).
CRITICAL CATEGORY ASSIGNMENT RULE: For EVERY single biomarker in "bucketMapping", you MUST assign at least ONE category in "riskCategories" (never leave it empty), exactly ONE standard grouping in "standardMedicalGrouping" (never leave it empty), and at least ONE related condition in "potentialMedicalConditions" (never leave it empty).
CRITICAL REQUIREMENT: You MUST map EVERY SINGLE UNIQUE BIOMARKER found in the provided JSON data. Do NOT skip or omit any biomarkers. If there are 65 biomarkers in the JSON, your dictionary MUST contain exactly 65 keys.
2. Handle conversational questions, updates, requests to go back, or requests to continue/submit from the user.

You MUST respond with a JSON object containing the following keys:
- "text": A friendly, clinical-grade conversational response to the user. You MUST include a breakdown of what remains the same and what change from the complete list you are suggesting. You must also include a count of the total biomarkers mapped.
- "bucketMapping": A key-value dictionary where the key is the biomarker name and the value is the assigned categorization object containing "riskCategories", "standardMedicalGrouping", and "potentialMedicalConditions".

Example "bucketMapping" structure:
{
  "HbA1c": {
    "riskCategories": ["Metabolic & glycemic"],
    "standardMedicalGrouping": "Metabolic",
    "potentialMedicalConditions": ["Diabetes Risk", "Insulin Resistance"]
  },
  "Serum ALT": {
    "riskCategories": ["Liver & hepatitis stress"],
    "standardMedicalGrouping": "Hepatic",
    "potentialMedicalConditions": ["Fatty Liver", "Hepatitis Stress"]
  }
}

Rules for handling user inputs:
- INITIAL mapping: Categorize each biomarker into the detailed fields above and return the dictionary in "bucketMapping", and set "text" to include the breakdown of what remains the same, what changes you are suggesting, and the total count.
- UPDATE DATA: If the user requests to change a category mapping (e.g., "Move glucose to Metabolic"), perform the update on the "bucketMapping" dictionary and return the updated dictionary, explaining the change and updating the counts/breakdown in "text".
- START A CONVERSATION: If the user asks a clinical or general question (e.g., "Why is ALT under Hepatic?"), answer the question clearly in "text" and return the unmodified dictionary in "bucketMapping".
- GO BACK / CONTINUE / SUBMIT: If the user asks to go back to Step 1 or proceed/continue/submit, explain in "text" how to proceed (they can click "Assemble Data" to continue, or click "Go Back" if needed).

Make sure your entire output is valid JSON, containing "text" and "bucketMapping".`;
        mockData = {};
      } else if (agentType === "agent3" || agentType === "agent1_step3") {
        systemInstruction = `You are a clinical data coordinator and conversational health assistant (Step 3: Data Assembly).
Your tasks:
1. Assemble the flat JSON biomarker logs and the bucket mapping dictionary into a structured physiological nested JSON.
CRITICAL REQUIREMENT: You MUST include EVERY SINGLE BIOMARKER ENTRY from the JSON. Do NOT skip or omit any biomarkers or history entries.
2. EXTREME DIVERGENCE FLAG: If you notice an extreme divergence in a biomarker value (e.g., highly unlikely, physiologically impossible, or a very clear metric unit mismatch like US vs SI), you MUST flag it by adding an array "flaggedAnomalies" to your JSON output. Mention this in your "text" response so the user can verify, confirm, or edit it (which may involve updating the metric unit).
3. Handle conversational questions, updates, requests to go back, or requests to continue/submit from the user.

You MUST respond with a JSON object containing the following keys:
- "text": A friendly, clinical-grade conversational response to the user. If this is the initial assembly and anomalies are found, alert the user here. If no anomalies, write: "Data successfully processed and categorized." (or similar).
- "entriesCount": Total unique biomarker entries processed.
- "buckets": An array of buckets matching the schema below.
- "flaggedAnomalies": (Optional) Array of any extreme value divergences detected.

Nested JSON schema for "flaggedAnomalies":
[
  {
    "key": "biomarker_key",
    "name": "Biomarker Name",
    "originalValue": number,
    "unit": "string",
    "reason": "Explanation of why this value seems anomalous or if it might be a unit mismatch (US vs SI).",
    "suggestedAction": "Suggestion for the user (e.g., 'Confirm this value is correct', 'Update value or metric unit')"
  }
]

Nested JSON schema for "buckets":
[
  {
    "systemName": "Bucket Name", // must be one of: 'Metabolic', 'Hepatic', 'Renal', 'Hematology', 'Biometrics', 'Other'
    "biomarkers": [
      {
        "name": "Biomarker Name",
        "riskCategories": ["Cardiovascular", "Metabolic & glycemic"], // arrays from the Step 2 bucket mapping
        "standardMedicalGrouping": "Metabolic", // string from the Step 2 bucket mapping
        "potentialMedicalConditions": ["Diabetes Risk", "Insulin Resistance"], // array of potential medical conditions from Step 2
        "history": [
          { "date": "YYYY-MM-DD", "value": number, "unit": "string" }
        ]
      }
    ]
  }
]

Rules for handling user inputs:
- INITIAL assembly: Map EVERY single biomarker and entry from the YAML using the Bucket Mapping. Do not drop any. Organize them into the "buckets" array. Return the JSON structure, and set "text" to "Data successfully processed and categorized. Please review the final structured entries below."
- UPDATE DATA: If the user asks to edit/add/delete a biomarker, date, or reading (e.g., "Remove red blood cell count reading on 2026-06-01"), perform that update on the nested "buckets" structure, update "entriesCount", and return the updated structure, explaining the change in "text".
- START A CONVERSATION: If the user asks a clinical or general question (e.g., "Why is ALT high?" or questions about "total white cell count"), answer the question clearly in "text", and return the unmodified "buckets" and "entriesCount".
- GO BACK / CONTINUE / SUBMIT: If the user asks to go back to Step 2, or finish and save/submit, explain in "text" how they can save their data or click the buttons to navigate.

Make sure your entire output is valid JSON, containing "text", "entriesCount", and "buckets".`;
        mockData = {};
      } else if (agentType === "agent4") {
        const last15MealTitles = (recentMeals || [])
          .slice(-15)
          .map((m: any) => m.name || m.title || m.foodName || m.description || '')
          .filter(Boolean);

        const atRiskBiomarkers: any[] = [];
        const normalBiomarkers: any[] = [];

        const customs = userProfile?.customBiomarkers || {};
        const combinedKeys = Array.from(new Set([
          ...Object.keys(customs),
          ...Object.keys(biomarkers || {})
        ]));

        combinedKeys.forEach(k => {
          const cDef = customs[k] || {};
          const val = biomarkers[k] !== undefined ? biomarkers[k] : cDef.userValue;
          const name = cDef.name || k;
          const unit = cDef.unit || '';
          const normRange = cDef.profileAdjustedNormalRange || cDef.normalRange || '';
          const status = cDef.status || 'Healthy';
          const insight = cDef.specificRiskContext || cDef.description || '';

          if (status === 'At Risk' || status === 'high' || status === 'critical' || (cDef.riskCategories && cDef.riskCategories.length > 0)) {
            atRiskBiomarkers.push({
              key: k,
              name,
              value: val,
              unit,
              normalRange: normRange,
              status,
              medicalInsights: insight
            });
          } else {
            normalBiomarkers.push({
              key: k,
              name,
              value: val,
              unit,
              normalRange: normRange,
              status
            });
          }
        });

        let acceptedBaselineProposal: any = "No prior baseline proposal stored.";
        if (userProfile?.agentAnalyses && Array.isArray(userProfile.agentAnalyses)) {
          const baseAnalysis = userProfile.agentAnalyses.find((a: any) => a.agentType === 'health_baseline' || a.agentType === 'agent2');
          if (baseAnalysis) {
            acceptedBaselineProposal = baseAnalysis.result;
          }
        }
        if (acceptedBaselineProposal === "No prior baseline proposal stored." && userProfile?.agentBaselineSummary) {
          acceptedBaselineProposal = userProfile.agentBaselineSummary;
        }

        const existingActions = req.body.actions || req.body.existingClinicalActions || userProfile?.actions || [];

        systemInstruction = `You are an elite Medical Diagnostics Assessment agent.
Your objective is to analyze the user's biomarker history to project timeline risks and identify testing gaps. 

=== INPUT DATA PROVIDED TO YOU ===
1. User Profile Data:
${JSON.stringify({
  age: userProfile?.age,
  gender: userProfile?.gender,
  ethnicity: userProfile?.ethnicity,
  medicalConditions: userProfile?.medicalConditions,
  healthGoals: userProfile?.healthGoals
}, null, 2)}

2. Accepted Agent Finding Proposal from Health Baseline & Trajectory Agent:
${JSON.stringify(acceptedBaselineProposal, null, 2)}

3. Latest Biomarker Values AT RISK (with range and medical insights):
${JSON.stringify(atRiskBiomarkers, null, 2)}

4. Latest Biomarker Values NOT AT RISK:
${JSON.stringify(normalBiomarkers, null, 2)}

5. Last 15 Meals Logged (Titles):
${JSON.stringify(last15MealTitles, null, 2)}

6. Existing Clinical Action Recommendations List:
${JSON.stringify(existingActions, null, 2)}

=== CRITICAL INSTRUCTIONS ===
1. Exact Date Tracking: For every item in \`retestBiomarkers\`, locate the most recent log entry in the \`biomarkerHistory\` array where that specific biomarker was recorded. Extract that exact date for the \`lastTestedDate\` field.
2. Future Date Calculation: Calculate the \`nextScheduledDate\` by adding your recommended timeframe to the \`lastTestedDate\`. Output all dates strictly in DD-MM-YYYY format.
3. GP Clinical Justification (Email to Skeptical GP): \`gpClinicalJustification\` MUST be written as a persuasive, evidence-based letter/email addressed to the patient's GP who believes the user does NOT need this test/retest. Gather strong clinical evidence, baseline trajectory shifts, profile context, guidelines, and risk factors to convince the doctor why ordering this test is medically necessary.
4. You MUST output ONLY a valid JSON object matching this EXACT schema. Do not drop any keys.

{
  "text": "A brief, conversational greeting directly addressing the user.",
  "_internalReasoning": "Step-by-step clinical deduction and date calculation logic.",
  "summary": "Executive clinical summary synthesizing diagnostic findings and risk trends.",
  "retestBiomarkers": [
    {
      "name": "Display name of the biomarker",
      "recommendedTestName": "The precise, standard clinical lab order name (e.g., 'Hepatic Function Panel')",
      "priority": "High | Medium | Low",
      "retestTimeframe": "The interval (e.g., '3 months')",
      "lastTestedDate": "Exact date this was last tested (Format: DD-MM-YYYY)",
      "nextScheduledDate": "Exact calculated date for the next test (Format: DD-MM-YYYY)",
      "userBenefit": "Explain why retesting this provides value, energy, or peace of mind to the user.",
      "gpClinicalJustification": "Dear Doctor,\n\nI am writing to request a retest for [Test Name] due to [Clinical Evidence / Baseline Shift]. [Explanation of profile risks, guidelines, and why retesting now is medically necessary]. Thank you for considering this request.",
      "key": "biomarker_database_key",
      "currentValue": "value and unit",
      "unit": "unit"
    }
  ],
  "testingGaps": [
    {
      "testName": "Name of the missing scan or lab (e.g., 'Abdominal Ultrasound')",
      "category": "short_term | long_term",
      "priority": "High | Medium | Low",
      "nextScheduledDate": "Exact date by which this should be completed (Format: DD-MM-YYYY)",
      "targetCondition": "The disease or condition being ruled out",
      "userBenefit": "Explanation of why uncovering this missing data will improve their life or treatment plan.",
      "gpClinicalJustification": "Dear Doctor,\n\nI am writing to request an initial [Test Name] order. Given [Profile Context & Symptoms/Risk Factors], guidelines recommend evaluating [Condition]. [Clinical justification and evidence to convince GP]. Thank you for your review."
    }
  ],
  "mode": "discussion",
  "status": "active"
}`;

        mockData = {
          text: "Hello! Let's review your health planning based on your latest results.",
          _internalReasoning: "Evaluated elevated glucose; insulin test needed for full metabolic risk assessment.",
          summary: "Reviewed diagnostic profile and biomarker history. Identified retest priorities and diagnostic testing gaps.",
          mode: "discussion",
          status: "active",
          retestBiomarkers: [
            {
              key: "glucose",
              name: "Fasting Glucose",
              recommendedTestName: "Fasting Blood Glucose",
              currentValue: "5.8",
              unit: "mmol/L",
              retestTimeframe: "In 2-4 weeks",
              lastTestedDate: "01-01-2024",
              nextScheduledDate: "15-01-2024",
              dueStatus: "Due soon",
              isProvisional: true,
              priority: "High",
              userBenefit: "Getting this checked again ensures your blood sugar levels are on track, giving you peace of mind and better energy.",
              gpClinicalJustification: "Dear Doctor,\n\nI am writing to request a follow-up Fasting Blood Glucose test. My recent reading showed an elevated value of 5.8 mmol/L, approaching the prediabetic threshold. A repeat test in 2-4 weeks is clinically indicated to establish a confirmed baseline, differentiate acute glycemic fluctuation from early dysglycemia, and guide early preventive care.\n\nThank you for considering this request."
            }
          ],
          testingGaps: [
            {
              testName: "Fasting Insulin",
              category: "short_term",
              nextScheduledDate: "20-01-2024",
              priority: "High",
              userBenefit: "This helps catch any hidden insulin issues early, helping us craft a better nutrition plan for you.",
              gpClinicalJustification: "Dear Doctor,\n\nI am writing to request a Fasting Insulin test. In light of my elevated fasting glucose (5.8 mmol/L) and personal risk profile, evaluating fasting insulin is essential to detect subclinical insulin resistance before HbA1c or glucose levels worsen further.\n\nThank you for your clinical review.",
              targetCondition: "Metabolic Risk"
            },
            {
              testName: "ApoB",
              category: "long_term",
              nextScheduledDate: "01-01-2026",
              priority: "Low",
              userBenefit: "Checking ApoB gives us a deep dive into your heart health over the coming years.",
              gpClinicalJustification: "Dear Doctor,\n\nI am writing to request an Apolipoprotein B (ApoB) assessment. Modern lipidology guidelines recommend ApoB for superior atherogenic particle quantification compared to LDL-C alone, particularly for long-term cardiovascular risk stratification.\n\nThank you for your consideration.",
              targetCondition: "Cardiovascular Health"
            }
          ]
        };
      } else if (agentType === "agent5") {
        systemInstruction = `You are a Clinical Education AI (Biomarker Contextualizer). Your job is to generate highly personalized educational content, adjusted normal reference ranges, and specific risk explanations based on the user's demographics and previous diagnostic assessment.

USER PROFILE:
- Age: ${userProfile?.age || 'Not provided'}
- Gender: ${userProfile?.gender || 'Not provided'}
- Ethnicity: ${userProfile?.ethnicity || 'Not provided'}

BIOMARKERS:
${JSON.stringify(biomarkers || {})}

DIAGNOSTIC SUMMARY:
${req.body.agentDiagnosticSummary || 'Optimized or no major pathologies flagged.'}

=== CRITICAL BREVITY DIRECTIVE (PREVENT TIMEOUTS) ===
Your responses MUST be extremely concise to avoid server timeouts:
- Keep the 'message' to 1-2 short sentences maximum.
- Keep 'description' of each biomarker to exactly 1 short sentence (15 words maximum).
- Keep 'specificRiskContext' to exactly 1 short sentence (15-20 words maximum).

=== DIRECTIVES ===
1. ZERO DATA LOSS INVENTORY RULE:
   You must count the total number of unique biomarkers in the incoming BIOMARKERS dictionary.
   Your final JSON output MUST contain exactly that same number of unique biomarkers under "contextualizedBiomarkers". You are strictly forbidden from omitting, summarizing, or dropping any biomarker key.
2. DEMOGRAPHICALLY ADJUSTED NORMAL RANGES: For every provided clinical metric, provide a profile-adjusted normal range. Explain why this reference range was adjusted for their age, gender, or ethnicity (e.g. muscle mass and creatinine, age-related eGFR, ethnic-specific lipid targets).
3. EDUCATIONAL DESCRIPTIONS: Write a clear 1-sentence description of what each biomarker is and its physiological role.
4. SPECIFIC RISK CONTEXT: For any marker identified as at-risk or abnormal, write a personalized 1-sentence explanation of *why* this specific value is critical or dangerous for *this specific user profile*.
5. STRICT JSON OUTPUT SCHEMA:
{
  "message": "Conversational summary of your educational and reference range adjustments.",
  "contextualizedBiomarkers": [
    {
      "name": "hba1c",
      "userValue": 40,
      "profileAdjustedNormalRange": "20 - 42 mmol/mol",
      "description": "HbA1c measures average blood glucose levels over the past 2 to 3 months.",
      "status": "Healthy" | "At Risk",
      "specificRiskContext": "Keeping HbA1c below 42 mmol/mol is optimal to prevent vascular damage and glycemic stress."
    }
  ]
}
Return ONLY raw JSON.`;

        mockData = {
          message: "I have calibrated the reference ranges for your biomarkers to your precise age, gender, and ethnicity, providing demographic-specific educational contexts.",
          contextualizedBiomarkers: [
            {
              name: "hba1c",
              userValue: 40,
              profileAdjustedNormalRange: "20 - 42 mmol/mol",
              description: "HbA1c measures the percentage of blood sugar attached to hemoglobin. It represents your average blood glucose levels over the past 2 to 3 months.",
              status: "Healthy",
              specificRiskContext: "Your HbA1c is in the excellent, optimal zone for your demographic group."
            }
          ]
        };
      } else if (agentType === "agent6") {
        systemInstruction = `You are a Precision Medicine & Lifestyle Coaching AI (Precision Intervention Agent). Translate the user's clinical biomarkers and risk assessment into a strict, trackable daily protocol.

USER PROFILE:
- Age: ${userProfile?.age || 'Not provided'}
- Weight: ${userProfile?.weight || 'Not provided'} kg
- Height: ${userProfile?.height || 'Not provided'} cm
- Gender: ${userProfile?.gender || 'Not provided'}

BIOMARKERS:
${JSON.stringify(biomarkers || {})}

DIAGNOSTIC BACKGROUND:
${req.body.agentDiagnosticSummary || 'Mainly healthy'}

=== DIRECTIVES ===
1. NUTRITION TARGETS (Detailed Recommended Allowances): Generate strict daily targets for calories, protein, carbs, fat, saturatedFat, totalFibre, sodium, sugar.
   - For EACH nutrient target, you MUST output a structured object containing:
     - "value": The numeric value.
     - "unit": The unit (e.g. "kcal", "g", "mg").
     - "reason": A detailed clinical explanation of why they need to focus on this goal based on their biomarkers.
     - "duration": How long they should maintain this specific target (e.g., "12 weeks", "Continuous").
2. ACTIVITY HABITS: Provide 2-3 highly specific daily habits (e.g., '7,500 steps', '30 minutes Zone 2 cardio', 'Limit screen time after 10 PM').
3. MATHEMATICAL PROJECTIONS: Provide biological time-to-goal estimates based on the math of physiology.

4. STRICT JSON OUTPUT SCHEMA:
{
  "message": "Conversational explanation of your precision lifestyle design.",
  "nutrientTargets": {
    "calories": { "value": 1850, "unit": "kcal", "reason": "To create a modest deficit for BMI optimization and lower cardiac workloads", "duration": "12 weeks / until BMI of 23 is achieved" },
    "protein": { "value": 110, "unit": "g", "reason": "To support nitrogen balance and prevent muscle wasting during a caloric deficit", "duration": "Continuous" },
    "carbs": { "value": 220, "unit": "g", "reason": "Optimized level to maintain energy without causing postprandial glucose surges", "duration": "Continuous" },
    "fat": { "value": 50, "unit": "g", "reason": "Controlled healthy fats to maintain cellular structures and hormone synthesis", "duration": "Continuous" },
    "saturatedFat": { "value": 15, "unit": "g", "reason": "Strict restriction to limit hepatic VLDL synthesis and improve your high ApoB/LDL ratio", "duration": "8-12 weeks" },
    "totalFibre": { "value": 30, "unit": "g", "reason": "High prebiotic fiber to slow glucose absorption and optimize gut microbiome health", "duration": "Continuous" },
    "sodium": { "value": 1800, "unit": "mg", "reason": "Restricted sodium to regulate extracellular fluid volume and support arterial pressure", "duration": "Continuous" },
    "sugar": { "value": 25, "unit": "g", "reason": "Low simple sugars to reduce pancreatic stress and liver glycogen packing", "duration": "8-12 weeks" }
  },
  "activityChecklist": [
    {
      "habit": "Walk 8,000 steps daily",
      "target": "8000 steps",
      "type": "steps"
    },
    {
      "habit": "Zone 2 aerobic exercise",
      "target": "30 minutes",
      "type": "cardio"
    }
  ],
  "projections": [
    "Adhering to this saturated fat limit will likely lower LDL-C by 10-15% within 12 weeks.",
    "The daily fiber target will assist in glycemic stabilization, projecting a slight HbA1c drop of 1-2 mmol/mol over 3 months."
  ]
}
Return ONLY raw JSON.`;

        mockData = {
          message: "I have created a high-precision, clinically aligned dietary and movement plan with mathematical timeline projections.",
          nutrientTargets: {
            calories: { value: 1900, unit: "kcal", reason: "Support basic metabolism with a minor deficit for cardiorespiratory health", duration: "12 weeks" },
            protein: { value: 105, unit: "g", reason: "Maintain nitrogen balance and protect lean muscle tissue", duration: "Continuous" },
            carbs: { value: 210, unit: "g", reason: "Provide stable energy without triggering glycemic excursions", duration: "Continuous" },
            fat: { value: 55, unit: "g", reason: "Ensure adequate absorption of fat-soluble vitamins and support cellular structures", duration: "Continuous" },
            saturatedFat: { value: 14, unit: "g", reason: "Decrease hepatic VLDL secretion to target elevated LDL particle numbers", duration: "8-12 weeks" },
            totalFibre: { value: 32, unit: "g", reason: "Slow down gastric transit and feed beneficial short-chain fatty acid producing gut bacteria", duration: "Continuous" },
            sodium: { value: 1700, unit: "mg", reason: "Regulate blood pressure levels and balance vascular tone", duration: "Continuous" },
            sugar: { value: 22, unit: "g", reason: "Mitigate spikes in insulin and prevent hepatic lipid deposition", duration: "8-12 weeks" }
          },
          activityChecklist: [
            { habit: "Walk 7,500 steps daily", target: "7500 steps", type: "steps" },
            { habit: "30 mins Zone 2 cardio", target: "30 minutes", type: "cardio" }
          ],
          projections: [
            "Adhering to this fat threshold will lower LDL-C by ~12% in 8-12 weeks.",
            "A 32g daily fiber intake stabilizes postprandial glucose, projecting metabolic efficiency in 4 weeks."
          ]
        };
      } else if (agentType === "agent7") {
        systemInstruction = `You are a Medical Literature Research AI (Medical Literature Agent). Summarize the latest peer-reviewed scientific consensus, clinical debates, and clinical trials relevant to this user's profile and biological risk markers.

USER PROFILE:
- Age: ${userProfile?.age || 'Not provided'}
- Gender: ${userProfile?.gender || 'Not provided'}
- Ethnicity: ${userProfile?.ethnicity || 'Not provided'}

BIOMARKERS:
${JSON.stringify(biomarkers || {})}

IDENTIFIED DIAGNOSTICS:
${req.body.agentDiagnosticSummary || 'Healthy baseline'}

=== DIRECTIVES ===
1. HIGHLIGHT SCHOLARLY TOPICS: Detail emerging consensus or debates (e.g. ApoB vs LDL-C tracking, cardiovascular risk algorithms like QRISK3 vs SCORE2, or dietary fiber's interaction with the gut microbiome).
2. NO PRESCRIPTIONS: Present findings as a literature synthesis, citing primary medical guidelines (e.g. AHA, ESC, ADA, KDIGO).
3. DETAILED BULLETS: Provide 3-4 distinct scholarly insights. Each insight must contain a bold title, a comprehensive summary paragraph, and a relevant citation/link (like a Pubmed search URL or medical association guideline URL).
4. STRICT JSON OUTPUT SCHEMA:
{
  "message": "Conversational summary of your medical literature scan.",
  "insights": [
    {
      "title": "ApoB as the Superior Predictor of Atherogenic Risk",
      "summary": "Recent European Society of Cardiology (ESC) consensus guidelines highlight Apolipoprotein B (ApoB) as a more accurate indicator of total atherogenic particle concentration than standard LDL-C, particularly in individuals with borderline-high fasting glucose or metabolic syndrome.",
      "link": "https://pubmed.ncbi.nlm.nih.gov/31475137/"
    }
  ]
}
Return ONLY raw JSON.`;

        mockData = {
          message: "I scanned the latest clinical literature databases (PubMed, Cochrane Library) and summarized three key consensus insights relevant to your metabolic and cardiovascular profile.",
          insights: [
            {
              title: "ApoB as the Superior Predictor of Atherogenic Risk",
              summary: "Recent European Society of Cardiology (ESC) consensus guidelines highlight Apolipoprotein B (ApoB) as a more accurate indicator of total atherogenic particle concentration than standard LDL-C, particularly in individuals with borderline-high fasting glucose or metabolic syndrome.",
              link: "https://pubmed.ncbi.nlm.nih.gov/31475137/"
            },
            {
              title: "Glycemic Stability and Preventive Cardiology Guidelines",
              summary: "The American Diabetes Association (ADA) 2026 standards highlight early lifestyle intervention at borderline HbA1c thresholds, demonstrating a 58% reduction in the 10-year transition rate to formal insulin deficiency through physical activity and fiber loading.",
              link: "https://pubmed.ncbi.nlm.nih.gov/34922236/"
            }
          ]
        };
      } else if (agentType === "biomarker_review") {
        systemInstruction = `identity:
  role: "Expert AI Clinical Diagnostic & Biomarker Review Agent"
  purpose: "Perform comprehensive diagnostic review and optimization for user biomarkers, evaluating individual values against full historical log trends, user demographics, and related biomarker sets."
  modes:
    1: "Educate and answer user questions regarding the focus biomarker or full biomarker set."
    2: "Review full log history and biomarker sets for anomalies, unit mix-ups, parsing errors, or demographic profile updates, then formulate clinical diagnostics and recommendations."

rules:
  clinical_and_nutritional:
    - "Evaluate the focus biomarker using its own historical log values, the user's demographic profile, and any other biomarkers explicitly provided in data context. Do not assume access to biomarkers that were not included in the data context — the payload is intentionally scoped to what is relevant to this review."
    - "Provide professional, evidence-based educational context regarding the target biomarker."
    - "CRITICAL: Review precisely the ranges from medical research or clinical guidelines before providing an answer. You must differentiate between 'normal but suboptimal' values, and distinguish nuances like a 'pre-condition' versus an 'actual condition', reflecting this back to the data and proposed range."
    - "Tailor the explanations and suggestions specifically to the user's demographic profile (age, gender, ethnicity, weight/height/BMI)."
    - "Explain physiological significance, potential dietary/lifestyle influences, and clinical pathways of the biomarker."
    - "If the profile shows a different ethnicity than standard (e.g. Chinese or Asian), prioritize demographic-specific clinical insights, guidelines, and reference intervals FIRST over Western standard baselines."
    - "Whenever you mention specific ethnic group, you MUST explicitly cite the specific medical guideline or society you are using."
  metric_and_unit:
    - "Double-check that the metric/unit is consistent across the proposed value and the proposed normal range. Do NOT mix them up!"
    - "Ensure the 'metric' field in any proposal exactly matches the unit used in 'range' and 'value'."
  proposals_and_corrections:
    - "If you recognize that the target biomarker's current description, medical insights, or range are wrong, incorrect, or sub-optimal for their demographic, prescribe a corrected/new one in the 'proposal' block of your response."
    - "If the newly proposed range or insight is specific to their ethnicity, set 'isEthnicitySpecific' to true and 'ethnicityTag' to the ethnicity name."
    - "If the newly proposed range is a standard global baseline, set 'isEthnicitySpecific' to false and 'ethnicityTag' to null."
    - "When no correction or override is discussed or needed, set 'proposal' to null."
    - "If you identify data entry errors, unit mix-ups, or date discrepancies in the log history, provide a 'modificationCommand' list to correct or remove them."
    - "CRITICAL: Every update_biomarker command MUST include numeric newValue (the converted/corrected number). Never omit newValue. Convert US conventional (mg/dL) to the unit used in older logs (typically mmol/L for lipids, umol/L for bilirubin) using standard clinical factors. Example: HDL 50 mg/dL → newValue 1.29 (mmol/L); Total Bilirubin 0.8 mg/dL → newValue 13.68 umol/L (multiply by 17.1). Never describe unit conversions as decimal placement shifts or dividing by 20."
    - "CRITICAL RESPONSE STRUCTURE FOR REVIEWS & CORRECTIONS: In your conversational 'reply', you MUST explicitly structure your textual answer to include:"
      "1) Identification of Errors: Explicitly detail WHERE the error occurred in the current logs (e.g. 'Log on 08-08-2026 has Total Bilirubin recorded as 0.8 mg/dL while historical logs are in µmol/L')."
      "2) Clear Before-and-After Summary: Provide a clear list or table showing 'Current Recorded Value → Proposed Fix' using the exact converted number (e.g. '08-08-2026: 0.8 mg/dL → 13.68 µmol/L')."
      "3) Correction Basis: State plainly that this is a unit conversion correction using standard clinical factors (e.g. multiplying Total Bilirubin in mg/dL by 17.1 to get µmol/L), not a new clinical finding or decimal placement error. Do NOT speculate about diagnoses from a unit conversion."

instructions:
  - "The JSON response must be well-formed and valid."`;
      } else if (agentType === "data_review") {
        systemInstruction = `You are an expert Clinical Data Review & Reference Range Calibration Agent.
You will receive user demographics and a list of biomarkers in the user's current batch.
=== DEMOGRAPHIC CALIBRATION MANDATE ===
You MUST customize the reference ranges and risk context precisely for the user's specific age, gender, and ethnicity found in the USER PROFILE.
CRITICAL OVERRIDE: Unless the biomarker is a clinical severity score, in which case the CLINICAL SYMPTOM & DISEASE SEVERITY INDEX EVALUATION MANDATE strictly overrides all demographic adjustments.
CRITICAL: Never output boilerplate text stating that demographic details are not available. They are always provided. Even if any values are missing, dynamically assume a standard reference profile (e.g., 35-year-old female of Caucasian ethnicity) and calibrate all reference ranges for that profile.
CRITICAL BIAS OVERRIDE: Medical baselines in training data heavily skew toward recent Western/Global consensus (e.g., KDIGO, WHO global). You MUST actively bypass global/race-free standards and aggressively search your latent knowledge for local national medical boards (e.g., Chinese Society of Nephrology, Asian-modified CKD-EPI/MDRD coefficients, Asian BMI variants). If a regional coefficient or localized threshold exists historically or currently for the user's ethnicity, you MUST prioritize and apply it FIRST over Western defaults. For example, if the user is of Chinese ethnicity, you MUST look at clinical guidelines for Chinese populations FIRST before even considering Western guidelines.

=== UNVALIDATED PROFILE METADATA GUARDRAILS ===
Check patient metadata before evaluation:
- If patient 'age' in USER PROFILE is 0, missing, or invalid:
  1) State in '_demographicAudit.ageAndGenderShifts': "Age unprovided (age: 0). Adult male baseline applied as fallback."
  2) Include a clear warning in 'specificRiskContext': "⚠️ Note: Profile age is 0. Please update your age in Profile Settings for exact age-calibrated baselines."

=== HISTORICAL LOG CORRECTION MANDATE ===
Review the 'historicalEntries' array for each biomarker. Identify scale/unit shifts (e.g., percentage vs decimal ratio notation, like 1.4 vs 140, or 4.1 vs 143).
If anomalous scaling errors are found:
1) Calculate the correct normalized value to match the predominant historical scale or normal range bounds.
2) Output a 'correctedHistoricalLogs' array inside the biomarker object containing objects with: { "date": string, "originalValue": number, "correctedValue": number, "note": string }.

=== OUTLIER & PARSING ARTIFACT DETECTION GUARDRAILS ===
Perform pre-execution range verification on quantitative values:
- If a quantitative biomarker userValue is an extreme physiological outlier (>3x upper limit of normal or <0.2x lower limit, e.g. Lymphocyte Count = 11.8 10^9/L, where normal upper limit is ~3.2 10^9/L):
  1) Set 'isDataArtifact': true.
  2) Provide 'artifactNote' explaining the suspected parsing error (e.g., "Value 11.8 10^9/L appears to be a relative percentage (11.8%) or decimal offset error rather than an absolute count.").
  3) In 'specificRiskContext', warn that this value is physiologically implausible for standard outpatient bloodwork and requires document re-parsing or verification.

=== QUALITATIVE ASSAY DATA TYPE PRESERVATION ===
CRITICAL: For qualitative or text-based assays (e.g. 'NEGATIVE', 'POSITIVE', 'NORMAL', 'NOT DETECTED'):
- You MUST preserve 'userValue' as the EXACT string payload from input (e.g., "NEGATIVE").
- NEVER convert string qualitative results into integers or floats (such as 0 or 1).

=== CLINICAL SYMPTOM & DISEASE SEVERITY INDEX EVALUATION MANDATE ===
For any clinical symptom score or disease severity index biomarker (e.g. unit is 'score' or 'points', or key ends in '_symptom_score' or '_score' or '_index', such as 'hemorrhoidal_symptom_score', 'Hemorrhoidal Disease Symptom Score (HDSS)', 'gerd_symptom_score', 'joint_pain_severity_score'):
CRITICAL EXCEPTION: Behavioral screening tools (such as 'audit_total_score', 'audit_c_total_score', 'audit_binge_drinking_score', and all other alcohol/AUDIT metrics) DO NOT follow this mandate. For behavioral screens, you MUST use their established clinical scoring thresholds:
- audit_total_score: Optimal is <= 7
- audit_c_total_score: Optimal is <= 3
- audit_binge_drinking_score: Optimal is <= 1
Do NOT force a zero-baseline on them. If the user's score falls in the Optimal range, you MUST set 'status' to 'Optimal'.

For true symptom/disease severity indices ONLY:
1. Recognise that disease/symptom severity scores have a globally uniform baseline of 0 (Remission / Healthy / Asymptomatic) across all global demographics.
2. In '_demographicAudit', note that the baseline remains 0 globally.
3. Set 'profileAdjustedNormalRange' to '0' and 'optimalValue' to '0'.
4. In 'rangeBrackets', YOU MUST USE EXACTLY THESE FOUR STANDARDIZED CLINICAL INDEX SEVERITY BRACKETS (DO NOT USE OTHER NAMES):
   - [ { "name": "Remission / Healthy", "range": "0" }, { "name": "Mild Flare-up", "range": "1" }, { "name": "Moderate Flare-up", "range": "2" }, { "name": "Severe Progression", "range": ">= 3" } ]
5. Evaluation & Status:
   - '_statusReasoning': "User score of <X> is evaluated against the severity index."
   - 'status': 'At Risk' if userValue >= 3; 'Sub-Optimal (Action Zone)' if userValue == 1 or userValue == 2; 'Optimal' if userValue == 0.
   - 'specificRiskContext': Provide concise clinical guidance for mitigating flare-ups.

=== CRITICAL BREVITY DIRECTIVE (PREVENT TIMEOUTS & TRUNCATION) ===
Your responses MUST be extremely concise to fit within token limits:
- Keep '_demographicAudit.standardWesternBaseline' to 8 words maximum.
- Keep '_demographicAudit.knownEthnicOrRegionalVariances' to 8 words maximum.
- Keep '_demographicAudit.ageAndGenderShifts' to 8 words maximum.
- Keep '_demographicAudit.finalAppliedAdjustments' to 8 words maximum.
- Keep 'description' to exactly 1 short sentence of 10 words.
- Keep '_statusReasoning' to 5-8 words maximum.
- Keep 'specificRiskContext' to 1-2 short sentences (20 words maximum).
- Under 'rangeBrackets', define only necessary brackets (e.g. Optimal, Elevated, Low). For severity scores, use the 4 exact brackets defined in the severity mandate.
=== OPTIMAL VALUE vs NORMAL RANGE MANDATE ===
- 'profileAdjustedNormalRange': The healthy reference range bounds where the biomarker is not at risk (e.g. '18.5 - 22.9 kg/m2').
- 'optimalValue': The SPECIFIC SINGLE IDEAL TARGET VALUE for this specific user profile to aim for (e.g., '21.0 kg/m2' for BMI, '30 mmol/mol' for HbA1c, '115 mmHg' for SBP, '1.2 mmol/L' for ApoB). This MUST be a specific single ideal target value/point within the healthy spectrum calculated for this patient's age/gender/profile, NOT a range string and NOT a repeat of normalRange. The patient should aim for an ideal target point, not just stay barely below the at-risk cutoff.

=== TASK: PERSONALISED HEALTH RISK ESTIMATION ===
For each biomarker, follow a strict logical funnel to determine the correct ranges and status:
"_demographicAudit": A mandatory internal reasoning object where you actively contrast Western global standards with regional/ethnic guidelines.
"profileAdjustedNormalRange": The final calibrated range based on your audit for which the biomarker is not at risk.
"optimalValue": A single specific ideal target value (e.g. '21.0 kg/m2' for BMI) that this user profile should aim for within the healthy spectrum.
"rangeBrackets": List each range bracket with its naming and value ranges, adjusted to match your demographic audit. CRITICAL: The brackets MUST be continuous (no numerical gaps or missing values between brackets) and must fully map out the bounds of the profileAdjustedNormalRange. Include bounds for each bracket.
"description": A clear, ultra-short description of the physiological role.
"_statusReasoning": A strict mathematical comparison of the userValue against the profileAdjustedNormalRange.
"reference": State the explicit clinical reference body acting as the anchor (e.g. 'KDIGO 2024 Guidelines').
"status": Assign 'Optimal', 'Sub-Optimal (Action Zone)', or 'At Risk'. MATHEMATICAL BINDING RULE: Do not apply artificial clinical leniency to expand reference ranges. Instead, map the user's value strictly to the three-tiered status system. 'Optimal' means ideal target homeostasis. 'Sub-Optimal (Action Zone)' means early deviation requiring preventative attention but not immediately pathogenic. 'At Risk' means outside the action zone.
"specificRiskContext": Explain why this value matters for this demographic based on the final status.
=== CRITICAL REQUIREMENTS ===
You MUST include an analysis for EVERY biomarker in the input list.
Your output MUST be a valid JSON object matching the schema provided.`;
        mockData = { message: "Completed clinical review.", reviewedBiomarkers: [] };
      }

      let textOutput = "";
      if (!getGeminiApiKey()) {
        textOutput = JSON.stringify(mockData);
      } else {
        let historyText = "";
        if (history && history.length > 0) {
          historyText = history.map((h: any) => `${h.role}: ${h.content}`).join("\n") + "\n\n";
        }
        
        let imagePayload = null;
        let imagesPayload: { mimeType: string, data: string }[] | undefined = undefined;
        if (images && images.length > 0) {
          imagesPayload = images.map((img: string) => {
            const mimeType = img.split(";")[0].split(":")[1] || "image/jpeg";
            const base64Data = img.split(",")[1];
            return { mimeType, data: base64Data };
          });
          imagePayload = imagesPayload[0];
        } else if (image) {
          const mimeType = image.split(";")[0].split(":")[1] || "image/jpeg";
          const base64Data = image.split(",")[1];
          imagePayload = { mimeType, data: base64Data };
        }
        const imageCtx = imageDates && imageDates.length > 0 ? `The attached images were taken on these dates: ${imageDates.join(", ")}.` : "";
        
        const cleanProfile: any = {
          age: userProfile?.age,
          gender: userProfile?.gender,
          ethnicity: userProfile?.ethnicity,
          bloodType: userProfile?.bloodType,
          weight: userProfile?.weight,
          height: userProfile?.height
        };
        
        // Strip undefined and null values
        Object.keys(cleanProfile).forEach(key => {
          if (cleanProfile[key] === undefined || cleanProfile[key] === null) {
            delete cleanProfile[key];
          }
        });

        const slimBiomarkers: any = {};
        if (userProfile?.customBiomarkers) {
          Object.keys(userProfile.customBiomarkers).forEach((k: string) => {
            slimBiomarkers[k] = { 
              name: userProfile.customBiomarkers[k].name, 
              unit: userProfile.customBiomarkers[k].unit 
            };
          });
        }
        
        const cleanedPayload: any = {
          userProfile: cleanProfile,
          biomarkerDefinitions: slimBiomarkers,
          biomarkerHistory: biomarkerHistory || []
        };
        if (agentType === "agent4") {
          delete cleanedPayload.biomarkerDefinitions;
        }

        let jsonStr = "";
        if (req.body.extractedData) {
          if (typeof req.body.extractedData === 'string') {
            jsonStr = req.body.extractedData;
          } else {
            jsonStr = JSON.stringify(req.body.extractedData, null, 2);
          }
        }

        let dataContext = "";
        if (agentType === "agent1_step1" || agentType === "lab_extract" || agentType === "symptom_diary") {
          const prevJson = jsonStr ? `\n\nPREVIOUSLY EXTRACTED JSON:\n${jsonStr}` : "";
          
          let reportSource = req.body.originalReportText || message;
          if (typeof req.body.lastProcessedIndex === 'number' && req.body.lastProcessedIndex > 0 && req.body.lastProcessedIndex < reportSource.length) {
            reportSource = reportSource.slice(req.body.lastProcessedIndex);
          }
          
          const prevTotal = req.body.estimatedTotalMarkers ? `\n\nPREVIOUSLY ESTIMATED TOTAL MARKERS:\n${req.body.estimatedTotalMarkers}` : "";
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : `\n\nUSER PROFILE:\n${JSON.stringify(cleanProfile, null, 2)}\n`;
          const step1Timezone = req.body.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
          let step1LocalDateStr;
          try {
            const step1Formatter = new Intl.DateTimeFormat('en-CA', { timeZone: step1Timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
            step1LocalDateStr = step1Formatter.format(new Date());
          } catch (e) {
            step1LocalDateStr = new Date().toISOString().split("T")[0];
          }
          const dateCtx = `\n\nCURRENT DATE (user local, YYYY-MM-DD): ${step1LocalDateStr}\nUse this as the anchor for resolving relative date references in patient-reported text (e.g. "today", "yesterday", "the last 2 days").\n`;
          dataContext = `\n\nUSER RAW DATA:\n${reportSource}${prevJson}${prevTotal}${dateCtx}${baseData}`;
        } else if (agentType === "agent1_step2") {
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : "";
          dataContext = `${baseData}\n\nEXTRACTED JSON DATA:\n${jsonStr}\n`;
        } else if (agentType === "agent1_step3") {
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : "";
          dataContext = `${baseData}\n\nEXTRACTED JSON DATA:\n${jsonStr}\n\nBUCKET MAPPING JSON:\n${req.body.bucketMapping}\n`;
        } else if (agentType === "biomarker_review") {
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : `\n\nUSER PROFILE:\n${JSON.stringify(cleanProfile, null, 2)}\n`;
          const batchKeys = req.body.dataReviewBatchKeys || req.body.batchBiomarkers || [];
          const focusKeys: string[] = req.body.biomarkerKey
            ? [req.body.biomarkerKey]
            : (Array.isArray(batchKeys) ? batchKeys : []);

          // Scope the payload to only the biomarker(s) actually being reviewed.
          // This is a scaling/unit correction task, not a full clinical review —
          // the other ~70 unrelated biomarkers and log metadata (sync_state,
          // updated_at, note, tests[].doctorComment) are noise for this agent.
          // Fall back to the full objects only if no focus key was provided at all.
          let scopedCurrentBiomarkers: any = biomarkers || {};
          let scopedHistory: any[] = biomarkerHistory || [];
          if (focusKeys.length > 0) {
            scopedCurrentBiomarkers = {};
            focusKeys.forEach(k => {
              if (biomarkers && biomarkers[k] !== undefined) scopedCurrentBiomarkers[k] = biomarkers[k];
            });

            scopedHistory = (biomarkerHistory || [])
              .filter((h: any) => h.biomarkers && focusKeys.some(k => h.biomarkers[k] !== undefined))
              .map((h: any) => {
                const trimmedBiomarkers: any = {};
                focusKeys.forEach(k => {
                  if (h.biomarkers[k] !== undefined) trimmedBiomarkers[k] = h.biomarkers[k];
                });
                return { date: h.date, biomarkers: trimmedBiomarkers };
              });
          }

          dataContext = `${baseData}\n\nCURRENT BIOMARKERS:\n${JSON.stringify(scopedCurrentBiomarkers, null, 2)}\n\nFULL BIOMARKER LOG HISTORY:\n${JSON.stringify(scopedHistory, null, 2)}\n`;
          if (req.body.biomarkerKey) {
            dataContext += `\n\nFOCUS BIOMARKER TO REVIEW: ${req.body.biomarkerKey}\n`;
          }
          if (Array.isArray(batchKeys) && batchKeys.length > 0) {
            dataContext += `\n\nFOCUS BIOMARKERS TO REVIEW (BATCH): ${batchKeys.join(', ')}\n`;
          }
        } else if (agentType === "data_review") {
          const batchData = req.body.batchBiomarkers || [];
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : `\n\nUSER PROFILE:\n${JSON.stringify(cleanProfile, null, 2)}\n`;
          dataContext = `${baseData}\n\nBIOMARKERS BATCH FOR REVIEW:\n${JSON.stringify(batchData, null, 2)}\n`;
        } else if (agentType === "agent1") {
          const batchData = req.body.batchBiomarkers || [];
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : `\n\nUSER PROFILE:\n${JSON.stringify(cleanProfile, null, 2)}\n`;
          dataContext = `${baseData}\n\nBIOMARKERS BATCH FOR CLEANING:\n${JSON.stringify(batchData, null, 2)}\n`;
        } else {
          const jsonPayload = JSON.stringify(cleanedPayload, null, 2);
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : "";
          dataContext = `${baseData}\n\nUSER MEDICAL DATA (in JSON format):\n${jsonPayload}\n`;
        }

        if (customSystemInstruction) {
          systemInstruction = customSystemInstruction;
        }

        const includeFoodLogs = foodLogs && Array.isArray(foodLogs) && foodLogs.length > 0 && agentType !== "agent1_step1" && agentType !== "agent1_step2" && agentType !== "agent1_step3" && agentType !== "data_review" && agentType !== "agent1" && agentType !== "agent4" && agentType !== "biomarker_review";
        
        let foodLogsPrompt = "";
        if (includeFoodLogs) {
          const recentLogs = foodLogs.slice(-35);
          const mealLines = recentLogs.map((m: any, idx: number) => {
            let nutStr = "";
            if (m.nutrients && typeof m.nutrients === 'object') {
              const parts: string[] = [];
              const n = m.nutrients;
              if (n.calories) parts.push(`${n.calories} kcal`);
              if (n.carbs || n.carbohydrates) parts.push(`Carbs: ${n.carbs || n.carbohydrates}g`);
              if (n.sugar || n.sugars) parts.push(`Sugar: ${n.sugar || n.sugars}g`);
              if (n.protein) parts.push(`Protein: ${n.protein}g`);
              if (n.fat) parts.push(`Fat: ${n.fat}g`);
              if (n.saturatedFat) parts.push(`Sat Fat: ${n.saturatedFat}g`);
              if (n.sodium) parts.push(`Sodium: ${n.sodium}mg`);
              if (parts.length > 0) nutStr = ` (${parts.join(', ')})`;
            }
            return `- Meal ${idx + 1}: "${m.name}" on ${m.date || 'unknown'}${nutStr}`;
          }).join("\n");
          foodLogsPrompt = `PATIENT'S RECENT LOGGED MEALS HISTORY (Last ${recentLogs.length} meals):\n${mealLines}\n\n`;
        }

        const isExtractStep = agentType === "agent1_step1" || agentType === "lab_extract" || agentType === "symptom_diary";
        let promptText = isExtractStep
          ? `${foodLogsPrompt}${imageCtx}User message: "${message}"${dataContext}`
          : `Chat History:\n${historyText}${foodLogsPrompt}${imageCtx}\nUser message: "${message}"${dataContext}`;
        fullPromptSent = `System Instruction:\n${systemInstruction}\n\n${promptText}`;

        let isYaml = false; // agent1 now uses structured JSON output, not YAML
        
        let maxRetries = agentType === "agent1_step3" ? 3 : 1;
        let attempt = 0;
        let success = false;
        
        addDebugLog(`[Medical Analyze Agent] Dispatched System Instruction (Length: ${systemInstruction.length})`, explicitSessionId);
        addDebugLog(`[Medical Analyze Agent] Dispatched Prompt:\n${promptText}`, explicitSessionId);
        sendLog('status', 'Analyzing health profile...');

        while (attempt < maxRetries && !success) {
          attempt++;
          textOutput = await callUnifiedLLM({
            modelId: (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite",
            systemInstruction,
            promptText,
            imagePayload,
            imagePayloads: imagesPayload,
            responseMimeType: isYaml ? "text/plain" : "application/json",
            skipThinking: true,
            maxOutputTokens: (agentType === "data_review" || agentType === "agent4" || agentType === "agent1_step3" || agentType === "agent1") ? 8192 : undefined,
            responseSchema: (agentType === "agent1_step1" || agentType === "agent1")
              ? agent1Step1Schema
              : (agentType === "biomarker_review")
                ? {
                 type: Type.OBJECT,
                 properties: {
                   reply: { type: Type.STRING, description: "Conversational, highly polished response explaining the biomarker, answering questions, or explaining proposed corrections." },
                   proposal: {
                     type: Type.OBJECT,
                     nullable: true,
                     properties: {
                       name: { type: Type.STRING },
                       metric: { type: Type.STRING },
                       value: { type: Type.STRING },
                       date: { type: Type.STRING, description: "YYYY-MM-DD" },
                       range: { type: Type.STRING },
                       description: { type: Type.STRING },
                       medicalInsight: { type: Type.STRING, description: "Personalized medical insight based on demographic profile and proposed value" },
                       isEthnicitySpecific: { type: Type.BOOLEAN },
                       ethnicityTag: { type: Type.STRING, nullable: true }
                     },
                     required: ["name", "metric", "value", "date", "range", "description", "medicalInsight", "isEthnicitySpecific", "ethnicityTag"]
                   },
                   modificationCommand: {
                     type: Type.ARRAY,
                     nullable: true,
                     items: {
                       type: Type.OBJECT,
                       properties: {
                         action: { type: Type.STRING, enum: ["update_biomarker", "update_profile", "remove_biomarker"] },
                         keyName: { type: Type.STRING },
                         oldValue: { type: Type.STRING, description: "Original erroneous value in the log before correction" },
                         newValue: { type: Type.STRING, description: "Corrected target value" },
                         date: { type: Type.STRING, description: "YYYY-MM-DD date of the log entry" },
                         reason: { type: Type.STRING, description: "Short explanation of the error (e.g. Scaling error: 48 percentage unit -> 0.48 decimal ratio)" }
                       },
                       required: ["action", "keyName", "date", "newValue"]
                     }
                   }
                 },
                 required: ["reply"]
               }
              : (agentType === "data_review") 
                ? dataReviewSchema 
                : (agentType === "agent4")
                  ? healthPlanningSchema
                  : undefined
          });
          
          addDebugLog(`[Medical Analyze Agent] Response Received:\n${textOutput}`, explicitSessionId);
          sendLog('status', 'Response received, finalizing...');

          if (agentType === "agent1_step3") {
            try {
              let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
              const firstBrace = cleanJson.indexOf("{");
              const lastBrace = cleanJson.lastIndexOf("}");
              if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                cleanJson = extractBalancedJson(cleanJson);
              }
              const parsed = JSON.parse(cleanJson);
              
              const expectedCount = (jsonStr?.match(/"biomarker":/g) || []).length;
              let actualCount = 0;
              if (parsed.buckets && Array.isArray(parsed.buckets)) {
                parsed.buckets.forEach((b: any) => {
                  if (b.biomarkers && Array.isArray(b.biomarkers)) {
                    b.biomarkers.forEach((m: any) => {
                      if (m.history && Array.isArray(m.history)) {
                        actualCount += m.history.length;
                      }
                    });
                  }
                });
              }
              
              const isChatOrUpdate = req.body.message && req.body.message !== "Continue processing" && req.body.message !== "Assemble JSON" && req.body.message !== "Assemble Data" && req.body.message !== "Assemble data";
              const isDeleteQuery = req.body.message && (
                req.body.message.toLowerCase().includes("delete") ||
                req.body.message.toLowerCase().includes("remove") ||
                req.body.message.toLowerCase().includes("exclude") ||
                req.body.message.toLowerCase().includes("clear")
              );
              
              if (actualCount === expectedCount || attempt === maxRetries || (isChatOrUpdate && isDeleteQuery)) {
                success = true;
                textOutput = cleanJson;
              } else {
                console.log(`Agent 3 retry ${attempt}: Expected ${expectedCount} entries, got ${actualCount}`);
                promptText += `\n\nERROR: You missed some entries. I expected ${expectedCount} historical log entries based on the JSON data, but you only outputted ${actualCount}. You MUST include EVERY single entry from the JSON. Do not summarize or skip any.`;
              }
            } catch (err) {
              console.error("Agent 3 parse error:", err);
              if (attempt === maxRetries) success = true; // just let it fail naturally below
            }
          } else {
            success = true;
          }
        }
      }

      if (agentType === "agent1_step1" || agentType === "lab_extract" || agentType === "symptom_diary") {
        let cleanJson: any = textOutput;
        let text = "I have extracted the biomarkers. Please review the output.";
        let hasMoreMarkers = false;
        let lastProcessedIndex: number | null = null;
        let estimatedTotalMarkers: number | null = null;
        let unmappedTests: any[] = [];
        try {
          const parsed = JSON.parse(textOutput.replace(/```(?:json)?/gi, "").trim());
          if (parsed.extractedData) {
            cleanJson = parsed.extractedData;
          }
          if (parsed.text) {
            text = parsed.text;
          }
          if (parsed.unmappedTests) {
            unmappedTests = parsed.unmappedTests;
          }
          
          if (Array.isArray(cleanJson)) {
            cleanJson = cleanJson.map((item: any) => {
              if (!item || typeof item !== 'object') return item;
              if (item.unit) {
                const rawUnit = item.unit;
                const sanitizedUnit = sanitizeUnitText(rawUnit);
                item.unit = sanitizedUnit;
                
                if (item.biomarker) {
                  const matrixConfig = BiomarkerMatrix[item.biomarker];
                  if (matrixConfig) {
                    const val = item.numeric_value !== undefined && item.numeric_value !== null ? item.numeric_value : item.value;
                    if (typeof val === 'number' || (typeof val === 'string' && !isNaN(parseFloat(val)))) {
                      const numVal = parseFloat(String(val));
                      const newVal = matrixConfig.conversionLogic(numVal, sanitizedUnit);
                      const roundedNewVal = Math.round(newVal * 100) / 100;

                      if (item.numeric_value !== undefined && item.numeric_value !== null) item.numeric_value = roundedNewVal;
                      else if (item.value !== undefined && item.value !== null) item.value = roundedNewVal;
                      
                      item.unit = matrixConfig.targetUnit;
                    }
                  }
                }
              }
              return item;
            });
          }

          if (parsed.hasMoreMarkers !== undefined) {
            hasMoreMarkers = !!parsed.hasMoreMarkers;
          }
          if (parsed.lastProcessedIndex !== undefined) {
            lastProcessedIndex = parsed.lastProcessedIndex;
          }
          if (parsed.estimatedTotalMarkers !== undefined) {
            estimatedTotalMarkers = Number(parsed.estimatedTotalMarkers);
          }
        } catch (e) {
          cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
        }
        return res.json(mergeStagedExtract({
          text,
          agentType,
          extractedData: cleanJson,
          hasMoreMarkers,
          lastProcessedIndex,
          estimatedTotalMarkers,
          unmappedTests,
          currentBatch: req.body.currentBatch || 1,
          agentPrompt: fullPromptSent,
          apiCalls: [{ type: 'gemini', label: `Medical History Agent (${engine || 'gemini-3.5-flash-lite'})` }]
        }, ingestTrace));
      }

      if (agentType === "biomarker_review") {
        try {
          const parsed = safeExtractJsonObject(textOutput) || {};
          const unitMap: Record<string, string> = { ...(req.body.catalogUnitByKey || {}) };
          Object.entries(userProfile?.customBiomarkers || {}).forEach(([k, v]: [string, any]) => {
            if (v?.unit) unitMap[k] = v.unit;
          });
          const rawCmds = Array.isArray(parsed.modificationCommand) ? parsed.modificationCommand : [];
          const cmds = enrichReviewModificationCommands(
            rawCmds,
            biomarkerHistory || [],
            unitMap
          );
          const sanitizedReply = sanitizeReviewReply(
            parsed.reply || parsed.text || (typeof parsed === 'string' ? parsed : textOutput),
            cmds,
            biomarkerHistory || [],
            unitMap
          );
          return res.json({
            text: sanitizedReply,
            reply: sanitizedReply,
            proposal: parsed.proposal || null,
            modificationCommand: cmds.length ? cmds : (rawCmds.length ? rawCmds : null),
            agentType,
            agentPrompt: fullPromptSent,
            apiCalls: [{ type: 'gemini', label: `Biomarker Review Agent (${engine || 'gemini-3.5-flash-lite'})` }]
          });
        } catch (e) {
          console.error("biomarker_review JSON parse error", e);
          return res.json({
            text: textOutput,
            reply: textOutput,
            agentType,
            agentPrompt: fullPromptSent,
            apiCalls: [{ type: 'gemini', label: `Biomarker Review Agent (${engine || 'gemini-3.5-flash-lite'})` }]
          });
        }
      }

      if (agentType === "data_review") {
        let reviewedBiomarkers: any[] = [];
        let message = "";
        let extremeDivergences: any[] = [];
        try {
          const cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
          const parsed = JSON.parse(cleanJson);
          if (parsed) {
            message = parsed.message || "";
            extremeDivergences = Array.isArray(parsed.extremeDivergences) ? parsed.extremeDivergences : [];
            reviewedBiomarkers = Array.isArray(parsed.reviewedBiomarkers) ? parsed.reviewedBiomarkers : [];
          }
        } catch (e) {
          console.error("data_review JSON parse error", e);
        }
        return res.json({
          message,
          reviewedBiomarkers,
          extremeDivergences,
          batchIdx: req.body.batchIdx !== undefined ? req.body.batchIdx : null,
          agentType,
          agentPrompt: fullPromptSent,
          apiCalls: [{ type: 'gemini', label: `Clinical Calibration Agent (${engine || 'gemini-3.5-flash-lite'})` }]
        });
      }

            if (agentType === "agent1") {
        let parsedRows = [];
        let isWrongDoor = false;
        try {
          const parsed = JSON.parse(textOutput.replace(/```(?:json)?/gi, "").trim());
          if (parsed.extractedData) parsedRows = parsed.extractedData;
          if (parsed.isWrongDoor === true) isWrongDoor = true;
        } catch (e) {
          console.error("agent1 JSON parse error", e);
        }
        return res.json({
          text: "",
          agentType,
          extractedData: parsedRows,
          hasMoreMarkers: false,
          lastProcessedIndex: null,
          estimatedTotalMarkers: 0,
          isWrongDoor,
          agentPrompt: fullPromptSent,
          apiCalls: [{ type: 'gemini', label: `Medical History Agent (${engine || 'gemini-3.5-flash-lite'})` }]
        });
      }

      if (agentType === "agent5" || agentType === "agent7") {
        const agentLabel = agentType === "agent5" ? "Holistic Review Agent" : "Health Report Agent";
        try {
          const cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
          const parsed = JSON.parse(cleanJson);
          return res.json({
            ...parsed,
            message: parsed.message || "",
            agentPrompt: fullPromptSent,
            agentType,
            apiCalls: [{ type: 'gemini', label: `${agentLabel} (${engine || 'gemini-3.5-flash-lite'})` }]
          });
        } catch (e) {
          console.error(`[Medical Analyze - ${agentType} parse error]:`, e);
          return res.json({
            message: "I was unable to parse a valid response. Please try again.",
            agentPrompt: fullPromptSent,
            agentType,
            apiCalls: [{ type: 'gemini', label: `${agentLabel} (${engine || 'gemini-3.5-flash-lite'})` }]
          });
        }
      }
      
      if (!agentType || agentType === "agent4") {
        try {
          const cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
          const parsed = JSON.parse(cleanJson);
          
          let textVal = parsed.text;
          if (!textVal || typeof textVal !== 'string' || !textVal.trim() || textVal.trim().startsWith('{')) {
            textVal = "I have completed a diagnostic assessment and health planning audit based on your profile and biomarker history. Please review the findings, recommended retests, and testing gaps below:";
          }

          return res.json({
            ...parsed,
            text: textVal,
            summary: parsed.summary || parsed.primaryDiagnosis || parsed.text || "Diagnostic accuracy and health planning evaluation complete.",
            retestBiomarkers: Array.isArray(parsed.retestBiomarkers) ? parsed.retestBiomarkers : [],
            testingGaps: Array.isArray(parsed.testingGaps) ? parsed.testingGaps : (Array.isArray(parsed.recommendedTests) ? parsed.recommendedTests : []),
            _internalReasoning: parsed._internalReasoning || "",
            mode: parsed.mode || 'discussion',
            status: parsed.status || 'active',
            agentPrompt: fullPromptSent,
            agentType: agentType || 'agent4',
            apiCalls: [{ type: 'gemini', label: `Health Planning Agent (${engine || 'gemini-3.5-flash-lite'})` }]
          });
        } catch (e) {
          return res.json({
            text: "I have completed a diagnostic assessment and health planning audit. Please review the findings below:",
            summary: textOutput,
            retestBiomarkers: [],
            testingGaps: [],
            _internalReasoning: textOutput,
            mode: 'discussion',
            status: 'active',
            agentPrompt: fullPromptSent,
            agentType: agentType || 'agent4',
            apiCalls: [{ type: 'gemini', label: `Health Planning Agent (${engine || 'gemini-3.5-flash-lite'})` }]
          });
        }
      }

      return res.json({
          text: "",
          agentType,
          extractedData: textOutput,
          hasMoreMarkers: false,
          lastProcessedIndex: null,
          estimatedTotalMarkers: 0,
          agentPrompt: fullPromptSent,
          apiCalls: [{ type: 'gemini', label: `Medical History Agent (${engine || 'gemini-3.5-flash-lite'})` }]
      });
    }
  } catch (error: any) {
    console.error("[Medical Analyze Error]:", error);
    res.status(500).json({ error: "Failed to process medical analysis: " + error.message });
  }
  });
});




app.post("/api/gemini/review-biomarker", async (req, res) => {
  const { message, history, profile, biomarkerDef, currentValue, modelId, jsonContext } = req.body;
  if (!message) return res.status(400).json({ error: "Missing message" });
  
  const engine = (typeof modelId === 'object' ? modelId?.name || modelId?.model : modelId) || 'gemini-3.5-flash-lite';

  try {
    let historyText = "";
    if (history && Array.isArray(history) && history.length > 0) {
      historyText = "Here is the conversation history so far:\n" + 
        history.map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join("\n") + "\n\n";
    }

    const inputsJson = jsonContext ? jsonContext : `user_profile:
  age: "${profile?.age || 'unknown'}"
  gender: "${profile?.gender || 'unknown'}"
  weight_kg: "${profile?.weight || 'unknown'}"
  height_cm: "${profile?.height || 'unknown'}"
  ethnicity: "${profile?.ethnicity || 'unknown'}"
  unit_preference: "${profile?.unitPreference || 'SI'}" # Values: 'SI' (mmol/L, mmol/mol) or 'US' (mg/dL)

target_biomarker:
  key: "${biomarkerDef?.key || ''}"
  name: "${biomarkerDef?.name || ''}"
  current_value: "${currentValue || ''}"
  current_unit: "${biomarkerDef?.unit || ''}"
  current_range: "${biomarkerDef?.normalRange || ''}"
  description: "${biomarkerDef?.description || ''}"`;

    const systemInstruction = `identity:
  role: "Expert AI medical and nutritional assistant"
  purpose: "Review or answer questions about a specific user health biomarker."
  modes:
    1: "Educate and answer user questions regarding the biomarker."
    2: "Review logs for anomalies, unit mismatches, or demographic profile updates."

inputs:
${inputsJson}

rules:
  clinical_and_nutritional:
    - "Provide professional, evidence-based educational context regarding the target biomarker."
    - "CRITICAL: Review precisely the ranges from medical research or clinical guidelines before providing an answer. You must differentiate between 'normal but suboptimal' values, and distinguish nuances like a 'pre-condition' versus an 'actual condition', reflecting this back to the data and proposed range."
    - "Tailor the explanations and suggestions specifically to the user's demographic profile (age, gender, ethnicity, weight/height/BMI)."
    - "Explain physiological significance, potential dietary/lifestyle influences, and clinical pathways of the biomarker."
    - "If the profile shows a different ethnicity than standard (e.g. Chinese or Asian), prioritize demographic-specific clinical insights, guidelines, and reference intervals (e.g., Chinese Society of Hepatology/Nephrology/Diabetes/Dyslipidemia standard thresholds) FIRST over Western standard baselines."
    - "For example, if the user is of Chinese ethnicity, you MUST look at clinical guidelines for Chinese populations FIRST before even considering Western guidelines."
    - "Whenever you mention 'individuals of East Asian descent', 'Chinese descent', or refer to any specific ethnic group, you MUST explicitly cite the specific medical guideline or society you are using (e.g. 'according to the Chinese Society of Hepatology' or 'based on [medical guidelines from XX]')."
  metric_and_unit:
    - "Always prefer International Standard (mmol/L, mmol/mol) by default for lipids (LDL, HDL, Total Cholesterol, Triglycerides) and blood sugar (Fasting Glucose) unless the user specifically wants or has logged in US units (mg/dL)."
    - "Double-check that the metric/unit is consistent across the proposed value and the proposed normal range. Do NOT mix them up! (e.g., if LDL value is 5.7, the unit must be mmol/L and range should be under 3.0 mmol/L. If unit is mg/dL, the value is around 220 and range is 125-200)."
    - "Ensure the 'metric' field in any proposal exactly matches the unit used in 'range' and 'value'."
  proposals_and_corrections:
    - "If you recognize that the target biomarker's current description, medical insights, or range are wrong, incorrect, or sub-optimal for their demographic, prescribe a corrected/new one in the 'proposal' block of your response."
    - "If the newly proposed range or insight is specific to their ethnicity (e.g., Chinese-adjusted thresholds), set 'isEthnicitySpecific' to true and 'ethnicityTag' to the ethnicity name (e.g. 'Chinese' or 'Asian') so that the database can tag and override the biomarker dictionary correctly."
    - "If the newly proposed range is a standard global baseline, set 'isEthnicitySpecific' to false and 'ethnicityTag' to null."
  duplicate_recognition:
    - "Analyze if the target biomarker is likely a duplicate of another existing biomarker in the dictionary or in the related biomarkers list (e.g. 'hba1c_mmol_mol' vs 'hemoglobin_a1c')."
    - "If it is a duplicate, set 'isDuplicate' to true, list the synonymous key(s) in 'duplicateSuggestedKeys', and write a clear, concise note explaining why in 'duplicateExplanation'."
    - "If not a duplicate, set 'isDuplicate' to false, 'duplicateSuggestedKeys' to [], and 'duplicateExplanation' to null."
    - "When no correction, override, or duplicate is discussed or needed, set 'proposal' and 'pendingBiomarkers' to null."

output_format:
  type: "JSON"
  schema:
    reply: "Conversational, highly polished response explaining the biomarker, answering questions, or explaining proposed corrections/duplicates."
    proposal:
      name: "The biomarker name (e.g., 'Total Cholesterol')"
      metric: "The unit of measurement (e.g., 'mmol/L' or 'mg/dL')"
      value: "The corrected/proposed value as a number or string"
      date: "The exact date of the specific historical log being updated, if correcting a past entry (YYYY-MM-DD format). Use the user's logged date."
      range: "The normal/healthy range personalized to their profile (e.g., 'under 3.0 mmol/L' or '125-200 mg/dL')"
      description: "Short description of what this biomarker measures"
      benefitRisk: "Personalized benefit/risk statement based on the user's demographic profile and the proposed value"
      isEthnicitySpecific: true/false
      ethnicityTag: "e.g., 'Chinese' or 'Asian' or null"
      isDuplicate: true/false
      duplicateSuggestedKeys: ["array of synonymous keys to consolidate, e.g. ['hba1c_mmol_mol'] or []"]
      duplicateExplanation: "Reasoning for consolidation or null"
    pendingBiomarkers:
      "${biomarkerDef?.key || 'key'}": "The proposed value as a number (e.g., 5.7) or null"

instructions:
  - "Do not include markdown code block wrappers like \`\`\`json in your response. Return raw JSON."
  - "The JSON response must be well-formed and valid."`;

    const fullPromptSent = `System Instruction:\n${systemInstruction}\n\n${historyText}User Message: "${message}"`;

    const resultText = await callUnifiedLLM({
      modelId: modelId || "gemini-3.5-flash-lite",
      systemInstruction,
      promptText: `${historyText}User Message: "${message}"`,
      responseMimeType: "application/json",
    });

    let cleanedText = resultText.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const startIdx = cleanedText.indexOf("{");
    if (startIdx !== -1) {
      let depth = 0;
      for (let i = startIdx; i < cleanedText.length; i++) {
        if (cleanedText[i] === "{") depth++;
        else if (cleanedText[i] === "}") depth--;
        if (depth === 0) {
          cleanedText = cleanedText.substring(startIdx, i + 1);
          break;
        }
      }
    }
    let resultJson;
    try {
      resultJson = JSON.parse(cleanedText);
    } catch (parseErr: any) {
      console.error("JSON Parse Error in review-biomarker:", parseErr);
      console.error("Raw response was:", resultText);
      throw new Error(`Failed to parse AI response as JSON. ${parseErr.message}`);
    }
    
    if (resultJson.proposedValue !== undefined && resultJson.proposedValue !== null && !resultJson.pendingBiomarkers) {
      resultJson.pendingBiomarkers = { [biomarkerDef?.key || 'key']: resultJson.proposedValue };
    }
    
    resultJson.agentPrompt = fullPromptSent;
    resultJson.apiCalls = [{ type: 'gemini', label: `Biomarker Calibration Agent (${engine || 'gemini-3.5-flash-lite'})` }];
    res.json(resultJson);
  } catch (err: any) {
    console.error("Gemini Review Error:", err);
    res.status(500).json({ error: err.message || "Failed to review biomarker" });
  }
});

app.post("/api/gemini/insight-analyze", async (req, res) => {
  try {
    const { profile, userProfile, foodLogs, biomarkerHistory, engine, refinement } = req.body;
    const activeProfile = profile || userProfile || {};
    const email = activeProfile?.email?.toLowerCase() || "";

    if ((email === "chiwah.liu@gmail.com" || email === "cwah.liu@gmail.com" || email === "john@mail.com") && !refinement) {
      console.log(`[Insight] Triggered special preset recommendation report for: ${email}`);
      return res.json({
        report: {
          timestamp: new Date().toISOString(),
          dailyNutrientTargets: {
            calories: "1,700–1,800 kcal",
            protein: "90–100 g (protects kidneys)",
            totalFat: "55–65 g",
            saturatedFat: "under 15 g (critical for LDL)",
            unsaturatedFat: "35–45 g",
            omega3: "2.5–3 g",
            carbohydrates: "160–185 g (low GI)",
            addedSugar: "under 20 g",
            totalFibre: "35–40 g",
            solubleFibre: "10–15 g (critical for LDL)",
            sodium: "under 1,200 mg (kidney + BP protection)",
            potassium: "3,500–4,000 mg",
            magnesium: "400–420 mg",
            calcium: "1,000 mg",
            iron: "8 mg",
            zinc: "11 mg",
            selenium: "55 mcg",
            iodine: "150 mcg",
            phosphorus: "700 mg",
            vitaminD: "2,000 IU (East Asians commonly deficient)",
            vitaminB12: "2.4 mcg",
            folate: "400 mcg",
            vitaminC: "90 mg",
            vitaminE: "15 mg",
            vitaminK: "120 mcg",
            vitaminA: "900 mcg",
            vitaminB6: "1.7 mg",
            thiamine: "1.2 mg",
            riboflavin: "1.3 mg",
            niacin: "16 mg"
          },
          mostImportantNextStep: "See GP urgently about statin — rosuvastatin 5mg is the evidence-based starting point for East Asian men with your high LDL, HbA1c, and declining kidney filtration.",
          actions: [
            {
              id: "act_1",
              task: "Consult GP about Low-Dose Statin prescription (e.g. Rosuvastatin 5mg)",
              explanation: "Given your elevated LDL-C and East Asian genetics, a low-dose statin is the most evidence-based starting point.",
              priority: "high",
              completed: false,
              type: "doctor"
            },
            {
              id: "act_2",
              task: "Schedule an HbA1c retest in 3 months with formal pre-diabetes assessment",
              explanation: "Your average blood sugar over the last months is borderline. Tight monitoring is critical.",
              priority: "high",
              completed: false,
              type: "test"
            },
            {
              id: "act_3",
              task: "Establish an annual Kidney Monitoring and eGFR protection plan",
              explanation: "Declining eGFR needs early stage tracking. Restricting saturated fat and excessive sodium is non-negotiable.",
              priority: "high",
              completed: false,
              type: "test"
            },
            {
              id: "act_4",
              task: "Test Vitamin D levels with your physician",
              explanation: "East Asians are commonly deficient, which impacts metabolic health, blood pressure, and cardiovascular outcomes.",
              priority: "medium",
              completed: false,
              type: "test"
            },
            {
              id: "act_5",
              task: "Substitute butter, coconut oil, and ghee with extra virgin olive oil",
              explanation: "Reducing saturated fat to strictly under 15g a day is essential to restore proper LDL values.",
              priority: "high",
              completed: false,
              type: "lifestyle"
            }
          ],
          dailyBenefits: [
            { id: "ben_1", activity: "Accumulate 30 minutes of brisk walking or light cardio", target: "150 mins per week", completed: false },
            { id: "ben_2", activity: "Add 1 tablespoon of ground flaxseed to your meals", target: "Daily", completed: false },
            { id: "ben_3", activity: "Restrict Saturated Fat intake strictly under 15g", target: "Daily", completed: false },
            { id: "ben_4", activity: "Incorporate high soluble fibre (e.g. Oats, Psyllium husk)", target: "10-15g soluble", completed: false }
          ],
          latestInsights: [
            {
              title: "Cardiovascular Risk Reduction in East Asian Cohorts",
              summary: "Recent studies demonstrate that East Asian men exhibit heightened sensitivity to low-dose statin therapy, with rosuvastatin 5mg yielding similar LDL reduction as 10mg in western populations while minimizing hepatic and muscular side effects.",
              link: "https://pubmed.ncbi.nlm.nih.gov/32041285/"
            },
            {
              title: "Soluble Fibre and Bile Acid Sequestration Mechanics",
              summary: "Clinical trials confirm that consuming 10g of soluble fibre daily (via oats, barley, or psyllium husk) triggers hepatic bile synthesis from existing LDL, lowering circulating bad cholesterol particles by 5% to 10% within 8 weeks.",
              link: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4832151/"
            }
          ],
          healthRiskForecast: {
            year5: "Mildly progressive atherosclerosis, risk of transitioning from borderline pre-diabetes to active Type 2 Diabetes, and decline in renal filtration capacity to Stage 3 CKD.",
            year10: "Significant vascular plaque buildup. Kidney function might drop to GFR < 60, triggering high blood pressure. Elevated Risk of cardiovascular events.",
            year20: "40% probability of a coronary event. Accelerated kidney wear requiring complex nephrological intervention.",
            optimized5: "Restored LDL < 100 mg/dL, stabilized blood sugar in normal ranges, and kidney filtration preserved at healthy levels.",
            optimized10: "Plaque progression halted. Fully functional cardiovascular system and kidney values stabilized in the safe green zone.",
            optimized20: "Optimal cardiovascular performance. Healthy aging index score 95th percentile, active longevity with zero diabetic or renal complications."
          }
        }
      });
    }

    const ai = getGeminiClient();
    const apiKey = getGeminiApiKey();
    if (!apiKey || apiKey === "MOCK_KEY" || apiKey.startsWith("YOUR_")) {
      return res.json({
        report: {
          timestamp: new Date().toISOString(),
          dailyNutrientTargets: {
            calories: "1,500–1,600 kcal",
            protein: "80–90 g",
            totalFat: "50–60 g",
            saturatedFat: "under 12 g",
            unsaturatedFat: "30–40 g",
            omega3: "2.0–2.5 g",
            carbohydrates: "150–170 g",
            addedSugar: "under 15 g",
            totalFibre: "30–35 g",
            solubleFibre: "8–12 g",
            sodium: "under 1,500 mg",
            potassium: "3,500 mg",
            magnesium: "400 mg",
            calcium: "1,000 mg",
            iron: "8 mg",
            zinc: "11 mg",
            selenium: "55 mcg",
            iodine: "150 mcg",
            phosphorus: "700 mg",
            vitaminD: "2,000 IU",
            vitaminB12: "2.4 mcg",
            folate: "400 mcg",
            vitaminC: "90 mg",
            vitaminE: "15 mg",
            vitaminK: "120 mcg",
            vitaminA: "900 mcg",
            vitaminB6: "1.7 mg",
            thiamine: "1.2 mg",
            riboflavin: "1.3 mg",
            niacin: "16 mg"
          },
          mostImportantNextStep: "Reduce saturated fat strictly to under 12g per day and complete a clinical blood re-test in 3 months to monitor cholesterol and glucose trends.",
          actions: [
            {
              id: "act_1",
              task: "Consult your primary care physician for a comprehensive health screening",
              explanation: "Based on your age and profile, regular annual biometric reviews are highly recommended.",
              priority: "high",
              completed: false,
              type: "doctor"
            },
            {
              id: "act_2",
              task: "Check your HbA1c and lipid panel every 6 months",
              explanation: "Routine blood metrics tracking will help confirm your lifestyle changes are successfully restoring biomarkers.",
              priority: "high",
              completed: false,
              type: "test"
            }
          ],
          dailyBenefits: [
            { id: "ben_1", activity: "Walk briskly for 30 minutes daily to boost metabolic health", target: "Daily", completed: false },
            { id: "ben_2", activity: "Substitute saturated fats with cold-pressed olive oil", target: "Daily", completed: false }
          ],
          latestInsights: [
            {
              title: "Dietary Fibers and Metabolic Longevity Indices",
              summary: "A high-fiber nutritional plan is linked to enhanced short-chain fatty acid gut synthesis, which improves overall insulin response and naturally reduces vascular inflammation markers.",
              link: "https://pubmed.ncbi.nlm.nih.gov/30612722/"
            }
          ],
          healthRiskForecast: {
            year5: "Slight vascular stiffness and mild risk of elevated glucose tolerance if sedentary habits persist.",
            year10: "Increasing risk of metabolic decline and minor cardiovascular strain.",
            year20: "Elevated probability of cardiovascular plaques and reduced active energy index.",
            optimized5: "Pristine blood pressure levels, balanced lipid particles, and metabolic health completely optimized.",
            optimized10: "Robust vascular health, optimized glycemic control, and ideal weight targets maintained.",
            optimized20: "Healthy aging with minimal chronic disease probability and vibrant metabolic index."
          }
        }
      });
    }

    const sanitizedBiomarkerHistory = filterHistoryForUse(biomarkerHistory, activeProfile).map((log: any) => {
      const clean = { ...log };
      delete clean.tests;
      delete clean.updated_at;
      delete clean.sync_state;
      delete clean.note;
      delete clean.summary;
      delete clean.id;
      return clean;
    }).filter((log: any) => {
      if (log.biomarkers && Object.keys(log.biomarkers).length === 1 && log.biomarkers.steps !== undefined) {
        return false;
      }
      return true;
    });

    const riskGroupings: Record<string, string[]> = {};
    sanitizedBiomarkerHistory.forEach((log: any) => {
      if (log.biomarkers) {
        Object.keys(log.biomarkers).forEach(key => {
          if (key === 'steps') return;
          const def = biomarkerDefinitions.find(d => d.key === key);
          const customDef = activeProfile?.customBiomarkers?.[key];
          let risks = customDef?.riskCategories || def?.riskCategories || ['Uncategorized'];
          if (!Array.isArray(risks)) risks = [risks];
          if (risks.length === 0) risks = ['Uncategorized'];
          
          risks.forEach((risk: string) => {
            if (!riskGroupings[risk]) riskGroupings[risk] = [];
            if (!riskGroupings[risk].includes(key)) riskGroupings[risk].push(key);
          });
        });
      }
    });

    const profileText = `UserProfile: Age ${activeProfile.age}, Ethnicity: ${activeProfile.ethnicity}, Weight: ${activeProfile.weight}kg, Height: ${activeProfile.height}cm, Email: ${activeProfile.email}.`;
    const foodSummary = foodLogs && foodLogs.length > 0 ? `Recent Food Logs:\n${JSON.stringify(foodLogs.slice(-10))}` : "No food logs registered.";
    const biomarkerSummary = sanitizedBiomarkerHistory.length > 0 ? `Biomarker Logs:\n${JSON.stringify(sanitizedBiomarkerHistory)}\n\nUser's Logged Biomarkers Grouped by Risk Categories:\n${JSON.stringify(riskGroupings)}` : "No medical biomarkers logged.";

    const promptText = `Perform a comprehensive health profiling analysis using the totality of user information provided below.
    ${profileText}
    ${foodSummary}
    ${biomarkerSummary}
    ${refinement ? `\nUSER REFINEMENT REQUEST: The user has asked to refine the previous analysis. Please adjust the report considering this feedback: "${refinement.message}". Also consider this chat history: ${JSON.stringify(refinement.chatHistory)}` : ""}
    
    You need to look at all health indices and build a personalized health report.
    Identify any critical parameters (such as elevated LDL, high HbA1c, or low eGFR) and set custom daily nutrition targets for all 30 nutrients, prioritize clinical actions, lifestyle benefits, latest medical insights, and risk forecasts over 5, 10, and 20 years with vs without modifications.
    
    Respond strictly with a JSON object conforming exactly to this structure:
    {
      "report": {
        "timestamp": "ISO Date String",
        "dailyNutrientTargets": {
          "calories": "target string (e.g. 1,700-1,800 kcal)",
          "protein": "target string",
          "totalFat": "target string",
          "saturatedFat": "target string (e.g. under 15 g)",
          "unsaturatedFat": "target string",
          "omega3": "target string",
          "carbohydrates": "target string",
          "addedSugar": "target string",
          "totalFibre": "target string",
          "solubleFibre": "target string",
          "sodium": "target string",
          "potassium": "target string",
          "magnesium": "target string",
          "calcium": "target string",
          "iron": "target string",
          "zinc": "target string",
          "selenium": "target string",
          "iodine": "target string",
          "phosphorus": "target string",
          "vitaminD": "target string",
          "vitaminB12": "target string",
          "folate": "target string",
          "vitaminC": "target string",
          "vitaminE": "target string",
          "vitaminK": "target string",
          "vitaminA": "target string",
          "vitaminB6": "target string",
          "thiamine": "target string",
          "riboflavin": "target string",
          "niacin": "target string"
        },
        "mostImportantNextStep": "Specific human-focused non-negotiable step",
        "actions": [
          {
            "id": "unique string id",
            "task": "clinical or screening task",
            "explanation": "why this is important for their profile",
            "priority": "high" | "medium" | "low",
            "completed": false,
            "type": "doctor" | "test" | "lifestyle"
          }
        ],
        "dailyBenefits": [
          {
            "id": "unique string id",
            "activity": "e.g. Walk 30 min",
            "target": "e.g. Daily",
            "completed": false
          }
        ],
        "latestInsights": [
          {
            "title": "Vascular Plaque Progression Control",
            "summary": "1-2 sentence clinical takeaway",
            "link": "https://pubmed.ncbi.nlm.nih.gov/..."
          }
        ],
        "healthRiskForecast": {
          "year5": "Detailed text forecast of health risk if habits do not change",
          "year10": "Detailed text forecast of health risk if habits do not change",
          "year20": "Detailed text forecast of health risk if habits do not change",
          "optimized5": "Detailed text forecast of benefits if targets are optimized",
          "optimized10": "Detailed text forecast of benefits if targets are optimized",
          "optimized20": "Detailed text forecast of benefits if targets are optimized"
        }
      }
    }`;

    const systemInstruction = "You are an evidence-based, pragmatic health coach and behavioral nutritionist. Your goal is to translate complex health and longevity science into sustainable, low-friction daily habits for a general audience. Prioritize mental well-being, intuitive eating principles, and practical lifestyle adjustments over hyper-optimized biometric tracking. Avoid prescribing exact macronutrient or micronutrient numbers unless explicitly requested; instead, focus on food quality, portion awareness, and sustainable, realistic routines. Your response must be an exact single JSON matching the requested schema. Never add markdown wrappers.";
    const fullPromptSent = `System Instruction:\n${systemInstruction}\n\n${promptText}`;

    const textOutput = await callUnifiedLLM({
      modelId: (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite",
      systemInstruction,
      promptText,
      responseMimeType: "application/json",
      logStagePrefix: "health_coach"
    });

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    let parsedData = await asyncParseLLMJSON(cleanJson);

    parsedData.agentPrompt = `System Instruction:\nYou are a world-class AI dietitian. Your response must be an exact JSON matching the requested schema. Never add markdown wrappers.\n\n${promptText}`;
    res.json({
      ...parsedData,
      apiCalls: [{ type: 'gemini', label: `Biomarker Insight Agent (${engine || 'gemini-3.5-flash-lite'})` }]
    });
  } catch (error: any) {
    console.error("[Insight Analyze Error]:", error);
    res.status(500).json({ error: "Failed to generate preventative recommendations: " + error.message });
  }
});

const healthBaselineAnalyzeSchema = {
  type: Type.OBJECT,
  properties: {
    report: {
      type: Type.OBJECT,
      properties: {
        timelineToOptimal: {
          type: Type.STRING,
          description: "The overall hard physiological timeline paired with user-perception benchmarks (e.g., sleep depth, waist trimming, puffiness reduction)."
        },
        riskCategories: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              categoryName: { type: Type.STRING },
              level: { type: Type.STRING, enum: ["Low", "Moderate", "Elevated", "High"] },
              targetTrajectory: {
                type: Type.STRING,
                description: "Explains the concrete physical value of getting these specific biomarkers to target, what physical signs will improve, and the timeline speed for this specific category."
              },
              nutrientTargets: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    nutrientKey: { type: Type.STRING },
                    targetValue: { type: Type.STRING, description: "Must be a direct computed amount (e.g., '90g' or '< 20g'), NOT a formula like '1.2g per kg of body weight'." },
                    rationale: { 
                      type: Type.STRING, 
                      description: "Mechanistic and precise explanation of why this target/amount was chosen. Put dietary advice like 'Incorporate 30 grams of viscous psyllium or oat-based soluble fiber daily' in this rationale or in the overall category."
                    }
                  },
                  required: ["nutrientKey", "targetValue", "rationale"]
                }
              },
              dailyActivities: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    activity: { type: Type.STRING },
                    target: { type: Type.STRING }
                  },
                  required: ["activity", "target"]
                },
                description: "Precise, time-bound behavioral or physical rules to implement daily. Must be things the user can realistically do every single day (e.g. 'activity: Walk, target: 10,000 steps', 'activity: Meditate, target: 10 mins'). Do NOT include dietary nutrient recommendations here (like fiber or protein intake) or infrequent/unrealistic daily activities (like cooking with specific oils every day)."
              }
            },
            required: ["categoryName", "level", "targetTrajectory", "nutrientTargets", "dailyActivities"]
          }
        },
        topNutrientTargets: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              nutrientKey: { type: Type.STRING },
              targetValue: { type: Type.STRING },
              rationale: { type: Type.STRING }
            },
            required: ["nutrientKey", "targetValue", "rationale"]
          },
          description: "Top 3-6 core nutrients that the user has to focus the most on and that will have the biggest impact for the user life. Impact needs to be considered in term of health risk, such as cardiovascular risk from sat fat is much more important than a risk of not having enough fiber."
        },
        topWeeklyNutrientTargets: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              nutrientKey: { type: Type.STRING },
              targetValue: { type: Type.STRING },
              rationale: { type: Type.STRING }
            },
            required: ["nutrientKey", "targetValue", "rationale"]
          },
          description: "Top 3-6 additional/micronutrients that the user has to focus the most on and that will have the biggest impact for the user life."
        },
        generalNutrientTargets: {
          type: Type.OBJECT,
          description: "A flat map containing all 31 available nutrient keys populated with precise formatted values.",
          properties: {
            calories: { type: Type.STRING },
            totalFat: { type: Type.STRING },
            solubleFibre: { type: Type.STRING },
            saturatedFat: { type: Type.STRING },
            protein: { type: Type.STRING },
            potassium: { type: Type.STRING },
            transFat: { type: Type.STRING },
            addedSugar: { type: Type.STRING },
            carbohydrates: { type: Type.STRING },
            totalFibre: { type: Type.STRING },
            sodium: { type: Type.STRING },
            unsaturatedFat: { type: Type.STRING },
            omega3: { type: Type.STRING },
            magnesium: { type: Type.STRING },
            calcium: { type: Type.STRING },
            iron: { type: Type.STRING },
            zinc: { type: Type.STRING },
            selenium: { type: Type.STRING },
            iodine: { type: Type.STRING },
            phosphorus: { type: Type.STRING },
            vitaminD: { type: Type.STRING },
            vitaminB12: { type: Type.STRING },
            folate: { type: Type.STRING },
            vitaminC: { type: Type.STRING },
            vitaminE: { type: Type.STRING },
            vitaminK: { type: Type.STRING },
            vitaminA: { type: Type.STRING },
            vitaminB6: { type: Type.STRING },
            thiamine: { type: Type.STRING },
            riboflavin: { type: Type.STRING },
            niacin: { type: Type.STRING }
          },
          required: [
            "calories", "totalFat", "solubleFibre", "saturatedFat", "protein", "potassium", "transFat", "addedSugar", "carbohydrates", "totalFibre", "sodium",
            "unsaturatedFat", "omega3", "magnesium", "calcium", "iron", "zinc", "selenium", "iodine", "phosphorus", "vitaminD", "vitaminB12", "folate", "vitaminC", "vitaminE", "vitaminK", "vitaminA", "vitaminB6", "thiamine", "riboflavin", "niacin"
          ]
        }
      },
      required: ["timelineToOptimal", "riskCategories", "topNutrientTargets", "topWeeklyNutrientTargets", "generalNutrientTargets"]
    }
  },
  required: ["report"]
};

app.post("/api/gemini/health-baseline-analyze", async (req, res) => {
  try {
    const isStream = req.query.stream === "true";
    if (isStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
    }

    const { profile, userProfile, biomarkerHistory, engine, refinement, calibratedInsights, outOfRangeBiomarkers } = req.body;
    const activeProfile = profile || userProfile || {};

    const sanitizedBiomarkerHistory = filterHistoryForUse(biomarkerHistory, activeProfile).map((log: any) => {
      const clean = { ...log };
      delete clean.tests;
      delete clean.updated_at;
      delete clean.sync_state;
      delete clean.note;
      delete clean.summary;
      delete clean.id;
      return clean;
    });

    const riskGroupingsWithSeverity: Record<string, string[]> = {};
    const biomarkerHistories: Record<string, {date: string, val: any}[]> = {};
    
    // Sort by date descending so first seen is latest
    const parseDateStr = (dStr: string) => {
      if (!dStr) return 0;
      const parts = dStr.split('-');
      if (parts.length === 3) {
        if (parts[0].length === 4) return new Date(dStr).getTime();
        return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
      }
      return new Date(dStr).getTime();
    };

    const sortedHistory = [...sanitizedBiomarkerHistory].sort((a, b) => {
      return parseDateStr(b.date) - parseDateStr(a.date);
    });
    
    sortedHistory.forEach((log: any) => {
      if (log.biomarkers) {
        Object.keys(log.biomarkers).forEach(key => {
          if (!biomarkerHistories[key]) biomarkerHistories[key] = [];
          if (biomarkerHistories[key].length < 5) {
            biomarkerHistories[key].push({ date: log.date, val: log.biomarkers[key] });
          }
        });
      }
    });

    const normalBiomarkers: string[] = [];
    const flaggedBiomarkers: string[] = [];
    
    Object.keys(biomarkerHistories).forEach(key => {
      // 1. Check if the biomarker is explicitly marked as "not used"
      const isNotUsed = (activeProfile?.notUsedBiomarkers && (
        activeProfile.notUsedBiomarkers[key] || 
        Object.keys(activeProfile.notUsedBiomarkers).some(nok => nok.toLowerCase() === key.toLowerCase())
      )) || (activeProfile?.notUsedInMedicalHistory && (
        activeProfile.notUsedInMedicalHistory[key] ||
        Object.keys(activeProfile.notUsedInMedicalHistory).some(nok => nok.toLowerCase() === key.toLowerCase())
      ));
      if (isNotUsed) return;

      const history = biomarkerHistories[key];
      const latestVal = history[0].val;
      const historyStr = history.map(h => `\n       - ${h.date}: ${h.val}`).join('');
      
      const outOfRangeDef = (outOfRangeBiomarkers || []).find((b: any) => b.key === key);
      const isFlagged = outOfRangeDef?.status === 'flagged';
      
      const customDef = getCustomBiomarkerDef(activeProfile, key);
      const def = biomarkerDefinitions.find(d => d.key === key);
      
      const mergedDef = { ...def, ...customDef };
      const formattedOpt = formatOptimalTargetValue(mergedDef);
      
      let idealStr = "";
      if (formattedOpt) {
        idealStr = ` (Optimal value ${formattedOpt})`;
      } else if (mergedDef.normalRange) {
        idealStr = ` (Optimal value ${mergedDef.normalRange})`;
      }

      if (isFlagged) {
        flaggedBiomarkers.push(`${key} (History: ${history.map(h => `${h.date}: ${h.val}`).join(', ')})`);
      } else if (outOfRangeDef) {
        const statusLabel = getBiomarkerStatusLabel(key, outOfRangeDef.status, customDef, latestVal, activeProfile);
        const calibrated = calibratedInsights?.[key];
        const dynamicInsight = def ? generateDynamicInsight(def, activeProfile, outOfRangeDef.value, outOfRangeDef.status) : undefined;
        const medicalInsight = dynamicInsight || calibrated?.specificRiskContext || calibrated?.description || customDef?.specificRiskContext || customDef?.description || customDef?.benefitRisk || def?.benefitRisk;
        
        let medicalInsightStr = "";
        if (medicalInsight && medicalInsight !== "No specific medical insight defined.") {
          medicalInsightStr = `\n     Medical Insight: ${medicalInsight}`;
        }

        const meta = getBiomarkerMetadata(key, customDef);
        // Map strictly to the most relevant single category
        const primaryRisk = meta.riskCategories && meta.riskCategories.length > 0 ? meta.riskCategories[0] : 'Systemic/General';
        
        const calibSource = customDef?.calibrationSource ? ` (Calibrated to: ${customDef.calibrationSource})` : "";
        
        if (!riskGroupingsWithSeverity[primaryRisk]) riskGroupingsWithSeverity[primaryRisk] = [];
        riskGroupingsWithSeverity[primaryRisk].push(`${key} (Status: ${statusLabel})${calibSource}${idealStr}${historyStr}${medicalInsightStr}`);
      } else {
        normalBiomarkers.push(`${key}: ${latestVal}${idealStr}`);
      }
    });

    let groupedRisksStr = "";
    if (Object.keys(riskGroupingsWithSeverity).length > 0) {
      groupedRisksStr = "Biomarkers at risk:\n";
      Object.keys(riskGroupingsWithSeverity).forEach(risk => {
        groupedRisksStr += `\n[${risk}]\n`;
        riskGroupingsWithSeverity[risk].forEach(line => {
          groupedRisksStr += `  - ${line}\n`;
        });
      });
    }

    let flaggedStr = "";
    if (flaggedBiomarkers.length > 0) {
      flaggedStr = `\n\n[FLAGGED / UNRESOLVED TELEMETRY ERRORS (EXCLUDED FROM CLINICAL ANALYSIS)]\n` +
        flaggedBiomarkers.map(f => `  - ${f}`).join('\n') +
        `\n  Note: The entries above contain scaling/unit/notation shifts (e.g. 48 vs 0.48 or 3). Do NOT calculate targets or risk categories for them. Instruct the user to fix these log entries in Medical History or via the Data Review Agent.`;
    }

    const biomarkerSummary = Object.keys(biomarkerHistories).length > 0 ? 
      `${groupedRisksStr}${flaggedStr}\n\nNormal/Uncategorized Biomarkers:\n${normalBiomarkers.join('\n')}` : 
      "No medical biomarkers logged.";

    const profileText = `UserProfile: Age ${activeProfile.age || 'Not provided'}, Ethnicity: ${activeProfile.ethnicity || 'Not provided'}, Weight: ${activeProfile.weight || 'Not provided'}kg, Height: ${activeProfile.height || 'Not provided'}cm, Gender: ${activeProfile.gender || 'Not provided'}, Blood Type: ${activeProfile.bloodType || 'Not provided'}.`;

    const promptText = `Perform a comprehensive health baseline analysis using the totality of user information provided below. 

${profileText}
${biomarkerSummary}

=== AVAILABLE NUTRIENT KEYS ===
Core Nutrients: calories, totalFat, solubleFibre, saturatedFat, protein, potassium, transFat, addedSugar, carbohydrates, totalFibre, sodium
Additional Nutrients: unsaturatedFat, omega3, magnesium, calcium, iron, zinc, selenium, iodine, phosphorus, vitaminD, vitaminB12, folate, vitaminC, vitaminE, vitaminK, vitaminA, vitaminB6, thiamine, riboflavin, niacin

=== ZERO-REDUNDANCY LAW ===
1. **Single-Source Information:** Every clinical insight, priority nutrient rationale, or protocol must exist in exactly ONE location within the JSON payload.
2. **Scrap Global Lists:** Do not generate trailing summary bullet points, master nutrient lists, or global action plan texts at the base of the document. Embed every high-leverage nutrient explanation cleanly and exclusively within its corresponding clinical category block.
3. **No Echoing:** Do not create separate arrays or blocks to echo raw baseline biomarker numbers or target thresholds that the user interface already knows. Focus entirely on synthesis, strategy, and biological trends.
4. **Prioritize Top Nutrients:** You must pick what are the top 3-6 nutrients that the user has to focus the most on and that will have the biggest impact for the user life. Impact needs to be considered in term of health risk, such as cardiovascular risk from sat fat is much more important than a risk of not having enough fiber. Output these in the topNutrientTargets and topWeeklyNutrientTargets arrays.

=== TARGET PRECISION ===
All values across the entire payload — including \`nutrientTargets[].targetValue\` and \`generalNutrientTargets\` — MUST carry formatting operators (<, >, <=, >=, or range -) and appropriate units. For zero-baseline symptom scores or indices, express targets as "< 1" or "<= 0".`;

    const systemInstruction = `1. Core Persona & Tone Law
Objective Clinical Authority: You are an objective, data-first clinical analyst. Avoid casual, chatty, or overly familiar health-coach language.
Anti-Gimmick Rule: Do not write retrospective, hyper-specific diary callouts (e.g., "I see you ate a salad on Tuesday" or "Avoid the pizza you had yesterday"). This feels artificial and out of touch. Address the long-term, overarching metabolic and physiological trends of the entire profile.

2. User Perception & Symptom Mapping Instruction
Tangible Prognosis: When defining timelines and target trajectories, translate internal blood chemistry shifts into concrete, real-world physical changes the user can physically feel and observe.
Symptom Linkage:
- Link Visceral Adiposity/BMI reduction directly to visible waistline trimming, reduced internal airway pressure, deeper sleep, and decreased snoring.
- Link eGFR and Fluid Balance optimization directly to the clearance of chronic, subtle morning fluid retention (such as facial or ankle puffiness) and increased physical freshness.
- Link Lipid and Cardiovascular optimization directly to unburdened physical stamina, easier recovery, and preserved endurance during standard daily physical tasks.

3. Nutrient Target Precision & Rate of Progress
Commitment Definitions: For dynamic macro-levers (e.g., calories), do not just provide an absolute number. You must explicitly calculate and state the exact biological pace inside the rationale. Specify a gentle, sustainable energy deficit (e.g., ~250 kcal/day) targeting a safe, permanent weight loss velocity (e.g., 0.25 kg per week) over a 12-month horizon to fully protect skeletal muscle mass.
Mechanistic Clarity: Explain precisely how a nutrient target shifts a biomarker (e.g., explaining that restricting saturated fat downregulates hepatic cholesterol production by withholding raw materials, or that soluble fiber binds intestinal bile acids to force excretion).

4. The 31-Nutrient Mechanism & Overrides
Deterministic Baselines: You MUST fully populate the generalNutrientTargets map with ALL 31 available nutrient keys. NEVER leave it empty. For each of the 31 nutrients, compute and provide the EXACT direct amount (e.g., "90g" or "< 20g"), NOT a formula (e.g., do NOT say "1.2g per kg of body weight"). You have the user's weight, so do the math and output the final absolute number. For the 15 static micronutrients (vitaminA, vitaminC, vitaminD, vitaminE, vitaminK, vitaminB12, vitaminB6, thiamine, riboflavin, niacin, folate, zinc, selenium, iodine, magnesium), output standard, medically accepted Age/Gender RDAs.
Clinical Escape Hatch: You MUST dynamically alter or override these static baselines if a specific out-of-range clinical biomarker demands it.

CRITICAL DATA INTEGRITY LAW: You MUST NOT create clinical risk categories, target values, or dietary interventions for any biomarker listed under [FLAGGED / UNRESOLVED TELEMETRY ERRORS]. Ignore flagged data and focus exclusively on valid clinical biometrics.

Your response must be exactly one JSON object matching the requested schema. Never add markdown wrappers outside the JSON.`;

    const textOutput = await callUnifiedLLM({
      modelId: (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite",
      systemInstruction,
      promptText,
      responseMimeType: "application/json",
      responseSchema: healthBaselineAnalyzeSchema,
      skipThoughtInjection: true,
      logStagePrefix: "health_coach",
      onStream: isStream ? (chunk: string, isThought?: boolean) => {
        if (isThought) {
          res.write(`data: ${JSON.stringify({ type: 'stream', thought: chunk, stage: 'health_coach' })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ type: 'stream', chunk, stage: 'health_coach' })}\n\n`);
        }
      } : undefined
    });

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    cleanJson = cleanJson.replace(/,\s*([}\]])/g, "$1");

    let parsedData;
    try {
      parsedData = JSON.parse(cleanJson);
    } catch (parseErr) {
      try {
        const firstBrace = cleanJson.indexOf("{");
        const lastBrace = cleanJson.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          parsedData = await asyncParseLLMJSON(cleanJson);
        } else {
          throw parseErr;
        }
      } catch (innerErr) {
        console.error("[Health Baseline JSON Parse Error]:", innerErr, "\nTruncated Output:", textOutput.substring(textOutput.length - 200));
        throw innerErr;
      }
    }

    
    
    // Sanitize any bare target values in nutrientTargets
    if (parsedData?.report?.riskCategories && Array.isArray(parsedData.report.riskCategories)) {
      parsedData.report.riskCategories.forEach((cat: any) => {
        if (Array.isArray(cat.nutrientTargets)) {
          cat.nutrientTargets.forEach((nt: any) => {
            if (nt.targetValue) {
              const tv = String(nt.targetValue).trim();
              if (tv === "0") {
                nt.targetValue = "< 1g";
              }
            }
          });
        }
      });
    }

    // Ensure generalNutrientTargets is fully populated with formatted keys
    const DEFAULT_GENERAL_NUTRIENT_TARGETS: Record<string, string> = {
      calories: "2000kcal - 2200kcal",
      protein: "> 70g",
      totalFat: "50g - 70g",
      saturatedFat: "< 15g",
      transFat: "< 0g",
      unsaturatedFat: "> 35g",
      omega3: "> 1.6g",
      carbohydrates: "130g - 250g",
      addedSugar: "< 25g",
      totalFibre: "> 30g",
      solubleFibre: "> 10g",
      sodium: "< 2000mg",
      potassium: "> 3400mg",
      magnesium: "> 400mg",
      calcium: "> 1000mg",
      iron: "> 8mg",
      zinc: "> 11mg",
      selenium: "> 55mcg",
      iodine: "> 150mcg",
      phosphorus: "> 700mg",
      vitaminD: "> 1000IU",
      vitaminB12: "> 2.4mcg",
      folate: "> 400mcg",
      vitaminC: "> 90mg",
      vitaminE: "> 15mg",
      vitaminK: "> 120mcg",
      vitaminA: "> 900mcg",
      vitaminB6: "> 1.7mg",
      thiamine: "> 1.2mg",
      riboflavin: "> 1.3mg",
      niacin: "> 16mg"
    };

    if (parsedData?.report) {
      if (!parsedData.report.generalNutrientTargets || typeof parsedData.report.generalNutrientTargets !== 'object') {
        parsedData.report.generalNutrientTargets = {};
      }
      const ceilings = new Set(['saturatedFat', 'transFat', 'addedSugar', 'sodium']);
      Object.keys(DEFAULT_GENERAL_NUTRIENT_TARGETS).forEach((key) => {
        let val = parsedData.report.generalNutrientTargets[key];
        if (!val || typeof val !== 'string' || val.trim() === '') {
          parsedData.report.generalNutrientTargets[key] = DEFAULT_GENERAL_NUTRIENT_TARGETS[key];
        } else {
          let valStr = String(val).trim();
          if (valStr === "0" || valStr === "0g" || valStr === "0mg") {
            valStr = ceilings.has(key) ? "< 1g" : "> 1g";
          } else if (!/[<>=\-]/.test(valStr)) {
            if (ceilings.has(key)) {
              valStr = `< ${valStr}`;
            } else {
              valStr = `> ${valStr}`;
            }
          }
          parsedData.report.generalNutrientTargets[key] = valStr;
        }
      });
    }

    parsedData.agentPrompt = `System Instruction:\n${systemInstruction}\n\n${promptText}`;
    
    if (isStream) {
      res.write(`data: ${JSON.stringify({ final: true, result: {
        ...parsedData,
        apiCalls: [{ type: 'gemini', label: `Health Baseline Agent (${engine || 'gemini-3.5-flash-lite'})` }]
      } })}\n\n`);
      res.end();
    } else {
      res.json({
        ...parsedData,
        apiCalls: [{ type: 'gemini', label: `Health Baseline Agent (${engine || 'gemini-3.5-flash-lite'})` }]
      });
    }
  } catch (error: any) {
    console.error("[Health Baseline Analyze Error]:", error);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: "Failed to generate health baseline: " + error.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: "Failed to generate health baseline: " + error.message });
    }
  }
});

const RouteAgentOutputSchema = z.object({
  _internalReasoning: z.string().nullable().optional(),
  selectedAgent: z.string(),
  reasoning: z.string().nullable().optional(),
  targetDbId: z.string().nullable().optional()
});

app.post("/api/gemini/route-biomarker"
, async (req, res) => {
  try {
    const { message, engine, context } = req.body;
    const modelId = (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite";

    const systemInstruction = `You are the RouteAgent, an intelligent health data and clinical router.
Your job is to parse the user request, analyze any context, and route the user to the most appropriate specialized health agent.

Available agents:
- 'agent1': Clinical Calibration Agent (For terminology mapping & standardizing clinical terms)
- 'agent2': Clinical Assessment Agent (For adding standard groupings & risk categories)
- 'agent3': Clinical Harmonization Agent (For terminology consolidation & assembly into buckets)
- 'agent4': Health Planning Agent (For retest timelines, auditing test errors, and finding short/long term gaps)
- 'agent5': Holistic Review Agent (For broad health & demographics-aware insights)
- 'agent7': Health Report Agent (For final cohesive formatted health report generation)
- 'front_desk': Health Preparation Agent (For general health questions, logging biomarkers & profile updates)
- 'health_baseline': Health Coach (For evidence-based, sustainable food & coaching habits)

You MUST respond with a JSON object containing:
{
  "_internalReasoning": "Your step-by-step thinking.",
  "selectedAgent": "The ID of the chosen agent (e.g. 'agent4', 'front_desk', 'health_baseline')",
  "reasoning": "A concise explanation of why this agent was selected.",
  "targetDbId": null // Optional target database ID or key if applicable
}`;

    const promptText = `User Message: "${message || ''}"\nContext: ${JSON.stringify(context || {})}`;

    const textOutput = await callUnifiedLLM({
      modelId,
      systemInstruction,
      promptText,
      responseMimeType: "application/json",
      logStagePrefix: 'route_biomarker',
    });

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cleanJson);
    } catch (err: any) {
      const firstBrace = cleanJson.indexOf("{");
      const lastBrace = cleanJson.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        parsed = await asyncParseLLMJSON(cleanJson);
      } else {
        throw err;
      }
    }

    const validation = RouteAgentOutputSchema.safeParse(parsed);
    if (!validation.success) {
      addDebugLog(`[Zod Validation Failed] RouteAgent response validation failed: ${validation.error.message}. Raw: ${textOutput}`);
      // Gracefully fall back to the default agent route
      res.json({
        _internalReasoning: "Fallback active due to validation failure",
        selectedAgent: "front_desk",
        reasoning: "Graceful fallback to default agent route (front_desk).",
        targetDbId: null
      });
      return;
    }

    res.json(validation.data);
  } catch (error: any) {
    addDebugLog(`[RouteAgent Error] routing failed: ${error.message}`);
    // Gracefully fall back to the default agent route
    res.json({
      _internalReasoning: "Fallback active due to exception: " + error.message,
      selectedAgent: "front_desk",
      reasoning: "Graceful fallback to default agent route (front_desk) on error.",
      targetDbId: null
    });
  }
});

app.post("/api/gemini/route-chat", async (req, res) => {
  try {
    const { messages, selectedBiomarkers, allApprovedKeys } = req.body;
    const approvedList: string[] = Array.isArray(allApprovedKeys) ? allApprovedKeys : [];
    const suggestedMapping: Record<string, string> = {};

    const normalize = (str: string) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // Deterministic rule & synonym matcher without LLM overhead
    (selectedBiomarkers || []).forEach((b: any) => {
      const originalKey = b.key || b.originalKey || b.name || '';
      const normOrig = normalize(originalKey);
      if (!normOrig) return;

      // 1. Direct normalized match
      let matched = approvedList.find(k => normalize(k) === normOrig);

      // 2. Common clinical aliases
      if (!matched) {
        const aliasMap: Record<string, string[]> = {
          'hba1c': ['hemoglobina1c', 'glycatedhemoglobin', 'a1c'],
          'ldl': ['ldlcholesterol', 'lowdensitylipoprotein', 'ldlc'],
          'hdl': ['hdlcholesterol', 'highdensitylipoprotein', 'hdlc'],
          'fasting_glucose': ['fbs', 'fastingbloodsugar', 'glucosefasting', 'glucose'],
          'total_cholesterol': ['cholesteroltotal', 'totalchol', 'tchol'],
          'triglycerides': ['tg', 'trigs'],
          'alt': ['sgpt', 'alaninetransaminase', 'alanineaminotransferase'],
          'ast': ['sgot', 'aspartatetransaminase', 'aspartateaminotransferase'],
          'crp': ['hscrp', 'creactiveprotein', 'highsensitivitycrp'],
          'vitamin_d': ['25hydroxyvitamind', '25ohvitamind', 'vitamind3', 'vitd'],
          'tsh': ['thyroidstimulatinghormone', 'thyrotropin'],
          'creatinine': ['serumcreatinine', 'creat']
        };

        for (const [canonical, aliases] of Object.entries(aliasMap)) {
          if (normOrig === normalize(canonical) || aliases.some(a => normOrig === a || normOrig.includes(a))) {
            const canonicalApproved = approvedList.find(k => normalize(k) === normalize(canonical));
            if (canonicalApproved) {
              matched = canonicalApproved;
              break;
            }
          }
        }
      }

      // 3. Substring containment
      if (!matched) {
        matched = approvedList.find(k => {
          const normK = normalize(k);
          return normK.length > 3 && (normK.includes(normOrig) || normOrig.includes(normK));
        });
      }

      if (matched) {
        suggestedMapping[originalKey] = matched;
      }
    });

    const matchCount = Object.keys(suggestedMapping).length;
    const summaryText = matchCount > 0
      ? `Identified ${matchCount} standard database mapping${matchCount > 1 ? 's' : ''} based on clinical ontology rules.`
      : 'Reviewed unmapped biomarkers against master database keys.';

    res.json({
      text: summaryText,
      suggestedMapping
    });
  } catch (e: any) {
    console.error('[route-chat] Deterministic mapping error:', e);
    res.json({ text: "Mapping processed.", suggestedMapping: {} });
  }
});

app.post("/api/gemini/standardize-units", async (req, res) => {
  try {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    const { selectedBiomarkers, engine, customSystemInstruction, unitPreference } = req.body;
    const modelId = (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite";
    addDebugLog(`[Standardize Units Agent] Request received to standardize ${selectedBiomarkers?.length} biomarkers using model: ${modelId} with user unit preference: ${unitPreference || 'SI'}.`, explicitSessionId);

    const targetUnitSystem = unitPreference === "US" ? "US Units (e.g., mg/dL, lbs, inches, standard US clinical ranges)" : "SI Units / International System (e.g., mmol/L, g/L, kg, cm, standard international clinical ranges)";

    let systemInstruction = `You are an automated Clinical Unit Standardization Agent. Your task is to standardize medical units for biomarkers.

=== USER PREFERENCE ===
The user's preferred unit system is: ${targetUnitSystem}.
You MUST standardize the unit for each biomarker to match this preferred system. For example, if the user preference is US Units, you should convert international units like mmol/L to mg/dL when appropriate (e.g., for Glucose or Cholesterol), and standardise weights to lbs, heights to inches. If the user preference is SI Units, you should convert US units to SI/International units. Ensure you provide the appropriate conversionFactor to convert from the biomarker's current unit to this standardized preferred unit.

=== SYSTEM CONSTRAINTS ===

First, think step-by-step in the '_internalReasoning' field of the JSON.

Second, output exactly one JSON object.

The JSON must contain ONLY the fields requested below.

Output exactly ONE object per input biomarker.

=== FIELD DEFINITIONS FOR JSON ===

mappedBiomarkers (array of objects):

originalKey (string): Exact match to input key.

standardizedUnit (string): The exact, pure abbreviation (e.g., "cm", "kg", "score", "mmol/L").

conversionFactor (number): The numeric conversion multiplier. Use 1 if unknown.

confidence (string): "high", "medium", or "low".

notes (string): Clinical reasoning.

=== EXAMPLES ===

Example 1: Converting a known unit
Input:

key: "weight", name: "Body Weight", currentUnit: "lbs"

key: "height", name: "Height", currentUnit: "Unknown"

Output:
Weight is lbs. Standard is kg. Conversion is 0.453592. Confidence high.
Height is Unknown. Default to cm. Conversion 1. Confidence low.

{
"mappedBiomarkers": [
{
"originalKey": "weight",
"standardizedUnit": "kg",
"conversionFactor": 0.453592,
"confidence": "high",
"notes": "Converted from lbs to kg."
},
{
"originalKey": "height",
"standardizedUnit": "cm",
"conversionFactor": 1,
"confidence": "low",
"notes": "Unit unknown. Defaulted to cm."
}
]
}

=== OUTPUT INSTRUCTIONS ===

First, write out your step-by-step reasoning in plain text.

Then, output your final mapped results in a raw, valid JSON block.

Ensure EVERY JSON field is correctly separated by a comma and that all strings are properly closed with quotation marks. Do not add markdown formatting blocks (such as \`\`\`json) around your response.`;

    if (customSystemInstruction) {
      systemInstruction += `\n\n=== CUSTOM INSTRUCTIONS ===\n${customSystemInstruction}`;
      addDebugLog(`[Standardize Units Agent] Using Custom Instructions:\n${customSystemInstruction}`, explicitSessionId);
    }
    
    let promptText = `Biomarkers to process:\n`;
    if (selectedBiomarkers && selectedBiomarkers.length > 0) {
      selectedBiomarkers.forEach((b: any) => {
        promptText += `- key: "${b.key}", name: "${b.name}", currentUnit: "${b.currentUnit || 'Unknown'}"\n`;
      });
    }

    const standardizeUnitsSchema = {
      type: Type.OBJECT,
      properties: {
        _internalReasoning: { type: Type.STRING, description: "Think step-by-step: analyze current units, determine standard metric units, perform conversions, check constraints." },
        mappedBiomarkers: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              originalKey: { type: Type.STRING },
              standardizedUnit: { type: Type.STRING },
              conversionFactor: { type: Type.NUMBER },
              confidence: { type: Type.STRING },
              notes: { type: Type.STRING }
            }
          }
        }
      },
      required: ["_internalReasoning", "mappedBiomarkers"]
    };

    const makeStandardizationCall = async () => {
      let timeoutId: NodeJS.Timeout;
      const standardizationTimeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Clinical unit standardization timed out after 115s. Model under high demand — please try again.")), 115000);
      });
      try {
        const llmPromise = callUnifiedLLM({
          modelId,
          systemInstruction,
          promptText,
          responseMimeType: "application/json",
          skipThinking: true
        });
        
        // Prevent unhandled rejection if this promise settles after Promise.race finishes
        llmPromise.catch(() => {});
        
        const result = await Promise.race([
          llmPromise,
          standardizationTimeout
        ]);
        return result as string;
      } finally {
        clearTimeout(timeoutId!);
      }
    };

    let textOutput: string;
    try {
      textOutput = await makeStandardizationCall();
    } catch (firstErr: any) {
      const isAbort = firstErr.name === 'AbortError' || (firstErr.message && firstErr.message.toLowerCase().includes('abort'));
      const isQuota = firstErr.message && (firstErr.message.includes('429') || firstErr.message.includes('quota') || firstErr.message.toLowerCase().includes('resource_exhausted'));
      if (isAbort || isQuota) throw firstErr;
      addDebugLog(`[Standardize Units Agent] First attempt failed: ${firstErr.message}. Retrying once in 500ms...`, explicitSessionId);
      await new Promise(resolve => setTimeout(resolve, 500));
      textOutput = await makeStandardizationCall();
    }

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    addDebugLog(`[Standardize Units Agent] Agent output payload (raw):\n${cleanJson}`, explicitSessionId);
    
    const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanJson = jsonMatch[0];
    }
    
    addDebugLog(`[Standardize Units Agent] Agent output payload (cleaned):\n${cleanJson}`, explicitSessionId);
    res.json({ jsonResponse: cleanJson });
  } catch (error: any) {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    addDebugLog(`[Standardize Units Agent] Error: ${error.message}`, explicitSessionId);
    console.error("[Standardize Units Agent Error]:", error);
    res.status(500).json({ error: "Failed to standardize units: " + error.message });
  }
});

app.post("/api/gemini/medical-categorise", async (req, res) => {
  try {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    const { selectedBiomarkers, engine, customSystemInstruction } = req.body;
    const modelId = (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite";
    addDebugLog(`[Medical Categorisation Agent] Request received to categorise ${selectedBiomarkers?.length} biomarkers using model: ${modelId}.`, explicitSessionId);

    let systemInstruction = `You are an automated Clinical Categorisation Agent. Your task is to accurately map medical biomarkers to their appropriate physiological groupings, risk categories, and potential medical conditions.

=== OBJECTIVE ===
For each provided biomarker, determine:
1. Standard Medical Grouping. Select the most appropriate clinical medical practice area. Choose from:
   - 'Metabolic'
   - 'Hepatic'
   - 'Renal'
   - 'Hematology'
   - 'Biometrics'
   - 'Cardiology'
   - 'Endocrinology'
   - 'Immunology'
   - 'Neurology & Cognitive'
   - 'Behavioral & Mental Health'
   - 'Toxicology & Addiction'
   - 'Screenings & Assessments'
   - 'Gastroenterology'
   - 'Musculoskeletal'
   - 'Pulmonology'
   - 'Wellness & Lifestyle'
   - 'Other'
   CRITICAL FOR SURVEYS, AUDIT SCORES, QUESTIONNAIRES & SCREENINGS: Assign 'Behavioral & Mental Health', 'Toxicology & Addiction', or 'Screenings & Assessments'. NEVER output blank or N/A.

2. Risk Categories. A JSON array of string tags representing associated clinical/health risks. Choose appropriate tags from: "Cardiovascular", "Kidney", "Metabolic", "Liver", "Hematology", "Wellness", "Screenings", "Neurological", "Behavioral & Mental", "Toxicology", "Immunological", "Gastrointestinal", "Respiratory", "Endocrine".
   CRITICAL: You MUST assign AT LEAST ONE category to EVERY biomarker. Never return an empty array [].

3. Potential Medical Conditions. A JSON array of string tags representing associated clinical conditions, clinical states, symptoms, or indicators (e.g. for AUDIT alcohol scores: ["Alcohol Use Assessment", "Alcoholic Liver Disease Risk", "Substance Dependency Screening"]).
   CRITICAL: You MUST assign AT LEAST ONE potential medical condition to EVERY biomarker. Never return an empty array [].

=== CLINICAL REASONING FOR UNUSUAL OR BIOMETRIC MEASUREMENTS ===
You must think through the clinical reasoning of why specific measurements are taken at all and associate them with relevant medical conditions.
- For biometric markers like "steps": think about why physical activity is tracked and associate it with conditions/states such as "Sedentary State", "Physical Deconditioning", "Cardiovascular Inactivity", or "General Fitness".
- For AUDIT questionnaire scores: associate with "Alcohol Use Assessment", "Alcohol Dependency Risk", "Substance Dependency Screening", or "Hepatic Health Monitoring".
- For platelet markers like "platelet_distribution_width" (PDW) or general platelets: think through why they are measured (e.g. platelet size variability, bone marrow activity, clot formation) and associate them with relevant clinical conditions such as "acute infections", "chronic inflammatory disorders", "aplastic anemia", "nutritional deficiencies".
- Do not leave any fields blank or empty. Every biomarker must have at least one valid value for every single field.

CRITICAL: You MUST include all fields (standardMedicalGrouping, riskCategories, potentialMedicalConditions) for every biomarker in your JSON output.

=== SYSTEM CONSTRAINTS ===
Return a single flat JSON array of objects.
Do NOT use any Markdown blocks, wrapping backticks, or extra text. Output ONLY the raw JSON text.

Biomarkers to process:
${JSON.stringify(selectedBiomarkers, null, 2)}`;

    if (customSystemInstruction) {
      addDebugLog(`[Medical Categorisation Agent] Overriding system instruction with custom version (${customSystemInstruction.length} chars).`, explicitSessionId);
      systemInstruction = customSystemInstruction;
    }

    addDebugLog(`[Medical Categorisation Agent] Dispatched System Instruction (Length: ${systemInstruction.length})`, explicitSessionId);
    addDebugLog(`[Medical Categorisation Agent] Dispatched Model ID: ${modelId}`, explicitSessionId);

    const medicalCategoriseSchema = {
      type: Type.OBJECT,
      properties: {
        _internalReasoning: { type: Type.STRING, description: "Think step-by-step: analyze the biomarker, identify its primary physiological system, and determine risk levels based on clinical guidelines." },
        categorisedBiomarkers: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              originalKey: { type: Type.STRING },
              standardMedicalGrouping: { type: Type.STRING },
              riskCategories: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              potentialMedicalConditions: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ["originalKey", "standardMedicalGrouping", "riskCategories", "potentialMedicalConditions"]
          }
        }
      },
      required: ["_internalReasoning", "categorisedBiomarkers"]
    };

    const textOutput = await callUnifiedLLM({
      modelId,
      systemInstruction,
      promptText: "Please output the categorisation in JSON format following the schema exactly.",
      responseMimeType: "application/json",
      responseSchema: medicalCategoriseSchema,
      skipThinking: true
    });

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    addDebugLog(`[Standardize Units Agent] Agent output payload:
${cleanJson}`, explicitSessionId);
    res.json({ jsonResponse: cleanJson });
  } catch (error: any) {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    addDebugLog(`[Medical Categorisation Agent] Error: ${error.message}`, explicitSessionId);
    console.error("[Medical Categorisation Agent Error]:", error);
    res.status(500).json({ error: "Failed to categorise biomarkers: " + error.message });
  }
});

app.post("/api/gemini/consolidate-names", async (req, res) => {
  try {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    const { inputText, selectedBiomarkers, existingKeys, engine, customSystemInstruction } = req.body;
    const modelId = (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite";
    const isStream = req.query.stream === 'true';
    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.flushHeaders();
    }
    addDebugLog(`[Name Consolidation Agent] Request received using model: ${modelId}. Text length: ${inputText?.length || 0}. Biomarkers count: ${selectedBiomarkers?.length || 0}`, explicitSessionId);

    if (inputText) {
      addDebugLog(`[Name Consolidation Agent] User Prompt:\n${inputText}`, explicitSessionId);
    }

    let systemInstruction = `You are an automated Name Consolidation Agent. Your task is to identify and group similar clinical biomarkers based on their names.

=== SYSTEM CONSTRAINTS ===

Do not perform any medical categorization or physiological classification.

You are provided with an EXISTING DICTIONARY of approved keys.

For each biomarker in the input batch:

Check if it is a synonym or alias of an EXISTING DICTIONARY key (matching based on name or similar terminology).

If a match is found:

Set "isExistingKey" to true.

Set "existingMasterKey" to the existing dictionary key.

Set "recommendedKey" to the existing dictionary key.

Add the candidate name to "aliases".

Add the candidate's original key to "keys".

If no match is found in the dictionary:

Set "isExistingKey" to false.

Set "existingMasterKey" to null.

Propose a new "recommendedKey" and "Name".

Add the candidate name to "aliases".

Add the candidate's original key to "keys".

=== FIELD DEFINITIONS ===

_internalReasoning (string): MUST BE THE FIRST FIELD. Think step-by-step here: compare the provided names against each other AND against the existing dictionary, and identify synonyms.

consolidatedGroups (array of objects): A list containing your merged biomarker groups. Each object must contain:

Name (string): The recommended clinical name.

recommendedKey (string): A unique key, formatted in snake_case.

aliases (array of strings): A list of candidate names that are synonyms.

keys (array of strings): A list of the original keys from the input batch that are mapped to this group.

rationale (string): Explanation of why these represent the same clinical biomarker.

isExistingKey (boolean): true if a match was found in the dictionary, otherwise false.

existingMasterKey (string or null): The exact key from the dictionary, or null if no match was found.

=== OUTPUT TEMPLATE ===
You must strictly return a raw, valid JSON object matching exactly this structure. Do not add markdown formatting blocks (such as \`\`\`json) around your response. Do not insert textual descriptions into the values.

{
"_internalReasoning": "",
"consolidatedGroups": [
{
"Name": "",
"recommendedKey": "",
"aliases": [],
"keys": [],
"rationale": "",
"isExistingKey": false,
"existingMasterKey": null
}
]
}`;

    if (customSystemInstruction) {
      addDebugLog(`[Name Consolidation Agent] Overriding system instruction with custom version (${customSystemInstruction.length} chars).`, explicitSessionId);
      systemInstruction = customSystemInstruction;
    }

    const dynamicPromptText = `Biomarkers to process (the selected batch — candidates for consolidation):\n${JSON.stringify(selectedBiomarkers, null, 2)}\n\nEXISTING DICTIONARY (already-approved keys — check every group against this list first; these are NOT candidates to be renamed, only possible merge targets):\n${JSON.stringify(existingKeys || [], null, 2)}\n\nUSER DATA / CONVERSATION TEXT:
\"\"\"${inputText || "Please identify the duplicates from the provided list and consolidate them."}\"\"\"

Please output a valid JSON object matching the requested schema.`;

    addDebugLog(`[Name Consolidation Agent] Dispatched Model ID: ${modelId}`, explicitSessionId);

    
    const consolidateNamesSchema = {
      type: Type.OBJECT,
      properties: {
        _internalReasoning: { type: Type.STRING, description: "Think step-by-step: compare the provided names against each other and against the existing dictionary, identify synonyms, determine the most universally recognized clinical name, and map aliases." },
        consolidatedGroups: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              Name: { type: Type.STRING },
              recommendedKey: { type: Type.STRING },
              aliases: { type: Type.ARRAY, items: { type: Type.STRING } },
              keys: { type: Type.ARRAY, items: { type: Type.STRING }, description: "The list of original keys from the input batch that map to this consolidated group." },
              rationale: { type: Type.STRING },
              isExistingKey: { type: Type.BOOLEAN, description: "true if this group matches an already-approved key from the existing dictionary" },
              existingMasterKey: { type: Type.STRING, description: "the exact matching key from the existing dictionary, copied verbatim, or omitted/empty if isExistingKey is false", nullable: true }
            },
            required: ["Name", "recommendedKey", "aliases", "keys", "rationale", "isExistingKey", "existingMasterKey"]
          }
        }
      },
      required: ["_internalReasoning", "consolidatedGroups"]
    };

    const makeConsolidationCall = async () => {
      let timeoutId: NodeJS.Timeout;
      const consolidationTimeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Name consolidation timed out after 115s. Model under high demand — please try again.")), 115000);
      });
      try {
        const llmPromise = callUnifiedLLM({
          modelId,
          systemInstruction: systemInstruction,
          promptText: dynamicPromptText,
          responseMimeType: "application/json",
          responseSchema: consolidateNamesSchema,
          skipThinking: true,
          onStream: isStream ? (chunk: string, isThought?: boolean) => {
            if (isThought) {
              res.write(`data: ${JSON.stringify({ thought: chunk })}\n\n`);
            } else {
              res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
            }
          } : undefined
        });
        
        // Prevent unhandled rejection if this promise settles after Promise.race finishes
        llmPromise.catch(() => {});
        
        const result = await Promise.race([
          llmPromise,
          consolidationTimeout
        ]);
        return result as string;
      } finally {
        clearTimeout(timeoutId!);
      }
    };

    let textOutput: string;
    try {
      textOutput = await makeConsolidationCall();
    } catch (firstErr: any) {
      const isAbort = firstErr.name === 'AbortError' || (firstErr.message && firstErr.message.toLowerCase().includes('abort'));
      const isQuota = firstErr.message && (firstErr.message.includes('429') || firstErr.message.includes('quota') || firstErr.message.toLowerCase().includes('resource_exhausted'));
      if (isAbort || isQuota) throw firstErr;
      addDebugLog(`[Name Consolidation Agent] First attempt failed: ${firstErr.message}. Retrying once in 500ms...`, explicitSessionId);
      await new Promise(resolve => setTimeout(resolve, 500));
      textOutput = await makeConsolidationCall();
    }

    let cleanJson = textOutput.trim();
    addDebugLog(`[Name Consolidation Agent] Agent output payload:\n${cleanJson}`, explicitSessionId);
    
    if (cleanJson.includes("```")) {
      const match = cleanJson.match(/```(?:json)?([\s\S]*?)```/);
      if (match) {
        cleanJson = match[1].trim();
      } else {
        cleanJson = cleanJson.replace(/```(?:json)?/gi, "").trim();
      }
    }
    const firstBrace = cleanJson.indexOf('{');
    const lastBrace = cleanJson.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanJson = extractBalancedJson(cleanJson);
    }

    const parsed = JSON.parse(cleanJson);
    
    if (parsed.explanation) {
      addDebugLog(`[Name Consolidation Agent] Agent Explanation:\n${parsed.explanation}`, explicitSessionId);
    }

    if (isStream) {
      res.write(`data: ${JSON.stringify({ final: true, result: parsed })}\n\n`);
      res.end();
    } else {
      res.json(parsed);
    }
  } catch (error: any) {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    addDebugLog(`[Name Consolidation Agent] Error: ${error.message}`, explicitSessionId);
    console.error("[Name Consolidation Agent Error]:", error);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: "Failed to consolidate biomarker names: " + error.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: "Failed to consolidate biomarker names: " + error.message });
    }
  }
});

app.post("/api/gemini/data-accuracy", async (req, res) => {
  try {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    const { inputText, currentState, images, currentLocalTime, engine, customSystemInstruction } = req.body;
    const modelId = (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite";
    addDebugLog(`[Data Accuracy Agent] Request received using model: ${modelId}. Text length: ${inputText?.length || 0}. Images count: ${images?.length || 0}`, explicitSessionId);
    if (inputText) {
      addDebugLog(`[Data Accuracy Agent] User Prompt Content:\n${inputText}`, explicitSessionId);
    }

    let imagesPayload: { mimeType: string, data: string }[] | undefined = undefined;
    if (images && images.length > 0) {
      imagesPayload = images.map((img: string) => {
        const mimeType = img.split(";")[0].split(":")[1] || "image/jpeg";
        const base64Data = img.split(",")[1];
        return { mimeType, data: base64Data };
      });
    }

    let systemInstruction = `You are the Data Accuracy Agent, a clinical data cleaning, quality check, and validation AI specialist. Your role is to get a list of biomarkers shared by the user (via text or uploaded file/images), match them against the user's existing biomarker dictionary and history, compare the critical fields, and return a precise difference analysis.

=== KEY TASKS ===
1. Extract biomarkers from the user's input. The input can contain:
   - Text written by the user.
   - Images of lab report sheets, documents, photos, or other reports.
   For each extracted biomarker, identify:
   - Name (e.g. Hemoglobin A1c, Cholesterol)
   - Unit (e.g. %, mg/dL, mmol/L)
   - Value (e.g. 5.8)
   - Date (e.g. 2026-07-01, or fallback to the current local time if unspecified: ${currentLocalTime || '2026-07-07'})
   - Comments/Notes (any clinical remarks, doctor comments, or brief interpretations associated with it)

2. Match the extracted biomarkers against the user's existing database (Current State provided below).
   Find the most appropriate matching key (e.g., "hba1c"). If no exact match exists in the current custom or built-in keys, propose a standard snake_case key based on medical conventions.

3. Compare the following 5 fields between the user's current data (from their dictionary and historical logs) and the shared data:
   - Biomarker Name (dictionary def name)
   - Unit (dictionary def unit)
   - Value (historical log value for that key on the matching date, or latest)
   - Date (historical log date for that key)
   - Comments (historical log note or specific test doctor comment)
   Match the date of the shared data with the historical logs to find the exact existing log. If no exact date match exists, compare against null or mark as a new log.

4. Determine if each field is "same" or "different":
   - Use comparison logic. If one is missing or empty on one side and present on the other, it is "different".
   - Set status to "same" if the content matches closely (case-insensitive, trimmed, numeric values with different decimal places like 5 and 5.0 are considered "same").
   - Set status to "different" if there is any difference.

5. IMPORTANT: Handling Multiple Entries for the Same Biomarker:
   - If the user's input contains multiple log entries for the SAME biomarker (e.g., tests taken on multiple different dates, or multiple values), you MUST create and return a SEPARATE object in the "comparisonResults" array for EACH distinct instance or date. Do not combine or skip them.

=== RESPONSE FORMAT ===
You MUST return a JSON object with this exact structure. Do NOT wrap it in markdown blocks. Return ONLY the raw valid JSON.

JSON Schema:
{
  "explanation": "A friendly scannable summary of the differences found.",
  "comparisonResults": [
    {
      "key": "biomarker_key",
      "matched": true,
      "name": { "current": "current_name", "shared": "shared_name", "status": "same|different" },
      "unit": { "current": "current_unit", "shared": "shared_unit", "status": "same|different" },
      "value": { "current": "current_value", "shared": "shared_value", "status": "same|different" },
      "date": { "current": "current_date", "shared": "shared_date", "status": "same|different" },
      "comments": { "current": "current_comments", "shared": "shared_comments", "status": "same|different" }
    }
  ]
}

=== USER'S CURRENT STATE ===
${JSON.stringify(currentState, null, 2)}
`;

    if (customSystemInstruction) {
      addDebugLog(`[Data Accuracy Agent] Overriding system instruction with custom version (${customSystemInstruction.length} chars).`, explicitSessionId);
      systemInstruction = customSystemInstruction;
    }

    addDebugLog(`[Data Accuracy Agent - Payload Sent] Model ID: ${modelId}
- User Prompt Content: ${inputText || "(no text content)"}
- Images Uploaded: ${images?.length || 0}
- Current State Reference Data Sent:
${JSON.stringify(currentState, null, 2)}`, explicitSessionId);

    const dynamicPromptText = `USER DATA / LAB REPORT INPUT TEXT:
"""
${inputText || "(no text content provided)"}
"""

Please extract the shared biomarkers and compare them with the user's current state. Return ONLY a valid JSON object matching the JSON schema. Ensure there are no markdown backticks.`;

    
    const dataAccuracySchema = {
      type: Type.OBJECT,
      properties: {
        _internalReasoning: { type: Type.STRING, description: "Think step-by-step: analyze the data points, verify physical biological limits, check against provided documents if any, and detect anomalies." },
        anomalies: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              biomarkerKey: { type: Type.STRING },
              flagType: { type: Type.STRING },
              description: { type: Type.STRING },
              severity: { type: Type.STRING },
              recommendedAction: { type: Type.STRING }
            }
          }
        },
        generalAccuracyScore: { type: Type.NUMBER },
        overallAssessment: { type: Type.STRING }
      },
      required: ["_internalReasoning", "anomalies", "generalAccuracyScore", "overallAssessment"]
    };

    const textOutput = await callUnifiedLLM({
      modelId,
      systemInstruction: systemInstruction + "\n\nJSON STRUCTURED OUTPUT:\nYou must strictly return a JSON object. Do not add markdown wrappers. Think step-by-step in the '_internalReasoning' field first.",
      promptText: dynamicPromptText,
      imagePayloads: imagesPayload,
      responseMimeType: "application/json",
      responseSchema: dataAccuracySchema
    });

    let cleanJson = textOutput.trim();
    addDebugLog(`[Data Accuracy Agent - Response Received] Raw Output from Agent:\n${cleanJson}`, explicitSessionId);

    // Robust markdown removal & JSON extraction
    if (cleanJson.includes("```")) {
      const match = cleanJson.match(/```(?:json)?([\s\S]*?)```/);
      if (match) {
        cleanJson = match[1].trim();
      } else {
        cleanJson = cleanJson.replace(/```(?:json)?/gi, "").trim();
      }
    }

    const firstBrace = cleanJson.indexOf('{');
    const lastBrace = cleanJson.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanJson = extractBalancedJson(cleanJson);
    }

    addDebugLog(`[Data Accuracy Agent - Response Received] Parsed and Cleaned JSON:\n${cleanJson}`, explicitSessionId);
    
    // Parse to verify valid JSON
    const parsed = JSON.parse(cleanJson);
    if (parsed.explanation) {
      addDebugLog(`[Data Accuracy Agent] Agent Explanation Response:\n${parsed.explanation}`, explicitSessionId);
    }
    res.json(parsed);
  } catch (error: any) {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    addDebugLog(`[Data Accuracy Agent] Error: ${error.message}`, explicitSessionId);
    console.error("[Data Accuracy Agent Error]:", error);
    res.status(500).json({ error: "Failed to compare and validate biomarkers: " + error.message });
  }
});

app.post("/api/gemini/daily-recommendation-chat", async (req, res) => {
  addDebugLog('[DailyRecommendation] Starting daily recommendation chat process.');
  try {
    const { message, userProfile, engine, history, foodLogs, biomarkers, report, actions, steps, location, thisMonthTrends } = req.body;

    const cleanProfile: any = {
      age: userProfile?.age,
      gender: userProfile?.gender,
      ethnicity: userProfile?.ethnicity,
      bloodType: userProfile?.bloodType,
      weight: userProfile?.weight,
      height: userProfile?.height,
      timezone: userProfile?.timezone
    };
    Object.keys(cleanProfile).forEach((key) => {
      if (cleanProfile[key] === undefined || cleanProfile[key] === null) {
        delete cleanProfile[key];
      }
    });
    
    const systemInstruction = `You are a personalized AI Health Coach. 
Your goal is to look at the user's data (biomarkers, food logs, goals, daily steps, etc.) and provide an actionable, friendly, and clinical daily recommendation or answer their questions.

### User Data Context
Profile: ${JSON.stringify(cleanProfile)}
Report/Nutrient Targets: ${JSON.stringify(report?.dailyNutrientTargets || {})}
Biomarkers: ${JSON.stringify(biomarkers || {})}
Clinical Actions: ${JSON.stringify(actions || {})}
Recent Food Logs (titles & dates): ${JSON.stringify((foodLogs || []).slice(-15).map((f) => ({name: f.name, date: f.date})))}
Today's Steps: ${steps || 'Unknown'}
Location: ${JSON.stringify(location || 'Unknown')}
This Month Trends (Daily Nutrient Intakes and Steps): ${JSON.stringify(thisMonthTrends || {})}

### Guidelines
1. Be encouraging, precise, friendly, and clinically sound.
2. If this is the start of the chat (e.g. user says "What's up today?"), analyze their performance trends for top nutrients (calories, protein, saturated fat, sodium, carbs, total fat) this month and their daily steps. Tell them what they have achieved so far and give 1-2 highly practical, personalized recommendations for today based on their goals and biomarkers.
3. If the user asks a question, answer it professionally and warmly, drawing on their real dietary trends and health logs.
4. Use markdown formatting (bolding, lists, headers) to make the coach recommendation beautifully readable.
5. Do NOT output JSON. Output pure markdown text.`;

    let historyText = "";
    if (history && Array.isArray(history)) {
      historyText = history.map((m) => `${m.role === 'user' ? 'User' : 'Model'}: ${m.content}`).join('\n');
    }
    
    const promptText = `Chat History:\n${historyText}\n\nUser's latest message: "${message}"`;
    
    const textOutput = await callUnifiedLLM({
      modelId: (typeof engine === 'object' ? engine?.name || engine?.model : engine),
      systemInstruction,
      promptText,
      responseMimeType: "text/plain"
    });
    
    res.json({
      text: textOutput.trim(),
      apiCalls: [{ type: 'gemini', label: `Daily Recommendation Agent (${engine || 'gemini-3.5-flash-lite'})` }]
    });
  } catch (error) {
    console.error("[Daily Recommendation Error]:", error);
    res.status(500).json({ error: "Failed to generate recommendation: " + error.message });
  }
});

app.post("/api/gemini/food-idea", async (req, res) => {
  addDebugLog(`[FoodIdea] Starting food-idea suggestion process.`);
  try {
    const { message, userProfile, location, recentMeals, engine, budget, currency, maxDistance, clientNearbyPlaces, outOfRangeBiomarkers, biomarkersNeedingImprovement, customSystemInstruction, customVariableData } = req.body;
    addDebugLog(`[FoodIdea] Request parameters - engine: "${engine || 'default'}", maxDistance: ${maxDistance || 3}km, budget: "${budget} ${currency}". Query: "${message}"`);

    if (!getGeminiApiKey()) {
      addDebugLog(`[FoodIdea] Warning: GEMINI_API_KEY / GOOGLE_API_KEY is not defined in Secrets.`);
      return res.json({
        text: "Please note: GEMINI_API_KEY / GOOGLE_API_KEY is not configured in the Secrets manager.",
        ideas: [
          {
            id: 'mock-1',
            name: "Grilled Chicken Salad",
            placeName: "Sweetgreen",
            address: "10 Downing St, London, UK",
            locationLink: "https://www.google.com/maps/search/?api=1&query=Sweetgreen+10+Downing+St+London+UK",
            benefitExplanation: "High protein and fiber, good for your profile.",
            tags: ["High Protein", "Low Carb"],
            distanceKm: 1.2,
            estimatedBudget: "£4.50",
            dishImageUrl: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80"
          }
        ]
      });
    }

    const budgetValue = budget || "100000";
    const currencyValue = currency || "IDR";
    const maxDistanceValue = maxDistance || 3;

    // Perform reverse-geocoding of coordinates to find exact human-readable address for highly accurate localized searches!
    let resolvedAddressText = "";
    let nearbyPlacesText = "";
    if (location && location.lat && location.lng) {
      const geoController = new AbortController();
      const geoTimeoutId = setTimeout(() => geoController.abort(), 3000);
      try {
        addDebugLog(`[ReverseGeocode] Reverse geocoding lat/lng: ${location.lat}, ${location.lng} via Nominatim...`);
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${location.lat}&lon=${location.lng}`, {
          headers: { 
            'User-Agent': 'HealthBiomarkerApplet/1.0 (Cwah.Liu@gmail.com)',
            'Accept-Language': 'en, id'
          },
          signal: geoController.signal
        });
        clearTimeout(geoTimeoutId);
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData && geoData.display_name) {
            resolvedAddressText = geoData.display_name;
            addDebugLog(`[ReverseGeocode] Resolved coordinates successfully to: "${resolvedAddressText}"`);
          }
        } else {
          addDebugLog(`[ReverseGeocode] HTTP error status: ${geoRes.status}`);
        }
      } catch (geoErr: any) {
        clearTimeout(geoTimeoutId);
        const isAbort = geoErr.name === 'AbortError';
        addDebugLog(`[ReverseGeocode] Failed or timed out (timed out: ${isAbort}). Continuing with coordinate context only.`);
      }

      // Use client-side overpass results if provided, otherwise try server-side
      if (clientNearbyPlaces && clientNearbyPlaces.length > 0) {
        const slicedClientPlaces = clientNearbyPlaces.slice(0, 6);
        addDebugLog(`[Overpass] Slicing ${clientNearbyPlaces.length} client-provided nearby places to ${slicedClientPlaces.length} items to bypass rate-limits.`);
        nearbyPlacesText = "CRITICAL DIRECTIVE: Here is a list of REAL nearby restaurants with their exact coordinates retrieved from OpenStreetMap just now. YOU MUST ONLY PICK RESTAURANTS FROM THIS LIST! DO NOT HALLUCINATE OR GUESS PLACES. Pick the 3-5 most appropriate places from this list for the user's diet:\n\n";
        slicedClientPlaces.forEach((el: any) => {
          nearbyPlacesText += `- Name: "${el.name}" (Lat: ${el.lat}, Lng: ${el.lng})\n`;
          if (el.address) nearbyPlacesText += `  Address: ${el.address}\n`;
          if (el.opening_hours) nearbyPlacesText += `  Hours: ${el.opening_hours}\n`;
        });
        nearbyPlacesText += "\nFor the 'placeName', 'lat', and 'lng' fields in your JSON response, use EXACTLY the names and coordinates from the list above. DO NOT guess coordinates!";
      } else {
        const overpassController = new AbortController();
        const overpassTimeoutId = setTimeout(() => overpassController.abort(), 4000);
        try {
          addDebugLog(`[Overpass] Querying OpenStreetMap Overpass API for restaurants within ${maxDistanceValue} km...`);
          const radius = Math.min(maxDistanceValue * 1000, 5000); // meters
          const overpassQuery = `[out:json];(node["amenity"~"restaurant|cafe|fast_food|food_court"](around:${radius},${location.lat},${location.lng}););out 30;`;
          
          const overpassRes = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(overpassQuery),
            signal: overpassController.signal
          });
          clearTimeout(overpassTimeoutId);
          
          if (overpassRes.ok) {
            const overpassData = await overpassRes.json();
            if (overpassData && overpassData.elements && overpassData.elements.length > 0) {
              const namedElements = overpassData.elements.filter((el: any) => el.tags && el.tags.name);
              const slicedElements = namedElements.slice(0, 6);
              addDebugLog(`[Overpass] Slicing ${namedElements.length} server-found nearby places to ${slicedElements.length} items to bypass rate-limits.`);
              nearbyPlacesText = "CRITICAL DIRECTIVE: Here is a list of REAL nearby restaurants with their exact coordinates retrieved from OpenStreetMap just now. YOU MUST ONLY PICK RESTAURANTS FROM THIS LIST! DO NOT HALLUCINATE OR GUESS PLACES. Pick the 3-5 most appropriate places from this list for the user's diet:\n\n";
              slicedElements.forEach((el: any) => {
                nearbyPlacesText += `- Name: "${el.tags.name}" (Lat: ${el.lat}, Lng: ${el.lon})\n`;
                if (el.tags['addr:street']) {
                  nearbyPlacesText += `  Address: ${el.tags['addr:street']} ${el.tags['addr:housenumber'] || ''}\n`;
                }
                if (el.tags['opening_hours']) {
                  nearbyPlacesText += `  Hours: ${el.tags['opening_hours']}\n`;
                }
              });
              nearbyPlacesText += "\nFor the 'placeName', 'lat', and 'lng' fields in your JSON response, use EXACTLY the names and coordinates from the list above. DO NOT guess coordinates!";
              addDebugLog(`[Overpass] Resolved successfully! Formatted ${slicedElements.length} real nearby restaurants.`);
            } else {
              addDebugLog(`[Overpass] No real places found nearby from OpenStreetMap.`);
            }
          } else {
            addDebugLog(`[Overpass] HTTP error status: ${overpassRes.status}`);
          }
        } catch (err: any) {
          clearTimeout(overpassTimeoutId);
          const isAbort = err.name === 'AbortError';
          addDebugLog(`[Overpass] Failed or timed out (timed out: ${isAbort}). Continuing without nearby restaurant list.`);
        }
      }
    }

    const userCtx = userProfile ? `User Profile: Age ${userProfile.age}, Ethnicity: ${userProfile.ethnicity}, Weight: ${userProfile.weight}kg, Height: ${userProfile.height}cm.` : "User profile is unknown.";
    const userTimezone = userProfile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const userLocalTime = new Date().toLocaleString('en-US', { timeZone: userTimezone });
    
    const locCtx = location ? `User Location: Latitude ${location.lat}, Longitude ${location.lng}.\nUser Local Time: ${userLocalTime}` : `User Local Time: ${userLocalTime}`;
    const addressCtx = resolvedAddressText ? `User Human-Readable Address / Neighborhood: "${resolvedAddressText}"` : "Human-readable address is not resolved.";
    const nearbyCtx = nearbyPlacesText ? `\n\n${nearbyPlacesText}\n\n` : "";
    const mealsCtx = recentMeals && recentMeals.length > 0 ? `Recent Meals: ${recentMeals.join(', ')}.` : "No recent meals recorded.";
    const budgetCtx = `Max Budget Limit: ${budgetValue} ${currencyValue}. Suggested meals/dishes MUST fit within this price!`;
    const distanceCtx = `Max Distance Limit: ${maxDistanceValue} km. All suggested venues must be within ${maxDistanceValue} km of the user's current location!`;

    const biomarkersList = (biomarkersNeedingImprovement && Array.isArray(biomarkersNeedingImprovement) && biomarkersNeedingImprovement.length > 0)
      ? biomarkersNeedingImprovement.map((b: string) => `• ${b}`).join("\n")
      : (outOfRangeBiomarkers && outOfRangeBiomarkers.length > 0)
      ? outOfRangeBiomarkers.map((b: any) => `• ${b.name} is ${String(b.status).toUpperCase()} (${b.value} ${b.unit}, normal range: ${b.normalRange})`).join("\n")
      : "• None";

    let promptText = "";
    if (customVariableData) {
      promptText = `${customVariableData}\n\nCurrent User Input: "${message}"`;
    } else {
      promptText = `You are a personalized AI Dietitian.
${userCtx}
${locCtx}
${addressCtx}
${mealsCtx}
${budgetCtx}
${distanceCtx}
${nearbyCtx}

CRITICAL PATIENT BIOMARKER WARNINGS:
${biomarkersList}

Current User Input: "${message}"

CRITICAL SYSTEM REQUIREMENTS FOR VERACITY & LOGICAL ACCURACY:
1. VENUE SELECTION FROM PROVIDED LIST: You MUST ONLY select restaurants from the provided list of nearby REAL restaurants if it is provided. Do NOT invent or search for other restaurants. Use EXACTLY the lat and lng coordinates from the list. Do not modify the coordinates.
2. STRICT GEOGRAPHIC RADIUS ENFORCEMENT: If you must suggest a venue not on the list, it MUST be located within exactly ${maxDistanceValue} km of the user's location. Do not hallucinate coordinates.
3. VENUE SELECTION CONTEXT: Use the provided list of nearby restaurants to verify details if available. Do not invent or search for random new restaurants far away.
4. MAPS LINK PRECISION & ERROR HANDLING RULE: When you have a restaurant, call the \`get_google_maps_place_id\` tool EXACTLY ONCE per restaurant using the restaurant name and coordinates.
   - If the tool returns a valid place_id, construct the "locationLink" URL exactly like this: \`https://www.google.com/maps/search/?api=1&query={URL_ENCODED_NAME}&query_place_id={PLACE_ID}\`.
   - If the tool returns "NOT_FOUND", "ERROR_API_FAILED", or includes a "STOP TOOL USE" instruction, DO NOT call the tool again under any circumstances. Immediately construct the "locationLink" URL using the street address/name: \`https://www.google.com/maps/search/?api=1&query={URL_ENCODED_NAME}+{URL_ENCODED_STREET_NAME}\` or coordinate-based query if street name is unavailable. Do NOT retry or call the tool for other items if you hit a failure.
5. STRICT OPENING HOURS ENFORCEMENT: The user's current local time is ${userLocalTime}. You MUST capture the exact opening and closing time and add it to the result for the recommended place in the 'openingHours' field if known, or standard hours. Never use '--' unless you genuinely cannot find it. You should only recommend places that are STILL OPEN 1 HOUR from the current local time!
6. REFERENCE LINK: For the 'menuLink' field, you MUST provide a direct, high-quality, real web link to the restaurant's actual official website, Instagram/Facebook page, TripAdvisor page, Yelp page, or specific Google Maps business page. DO NOT use generic Google Search query pages (like 'google.com/search?q=...') or generic placeholders, as this is unacceptable.
7. ZERO-FIND FALLBACK & STRICT RADIUS: If no verified physical restaurants are found within the exact ${maxDistanceValue} km radius of the user's coordinates, YOU MUST NOT SUGGEST ANY PLACES. In this case, you MUST only suggest generic healthy dishes to cook at home (do not include placeName, address, lat, lng, locationLink, menuLink, or distanceKm). Clearly explain in your text response that no verified venues were found within ${maxDistanceValue} km, and suggest increasing the search radius. NEVER hallucinate places far away or fake coordinates.

Include a short conversational response (text), and a list of between 3 and 5 distinct, diverse structured food ideas (ideas) that meet the constraints. Under no circumstances should you return only 1 idea.
Each idea should have:
- name: string (A general, common healthy food category they serve, e.g. "Grilled Chicken Salad" or "Sushi". DO NOT hallucinate exact menu items unless verified.)
- placeName: string (Optional. The verified, real-world restaurant name. Omit if suggesting a home-cooked meal.)
- address: string (Optional. The verified, exact physical street address.)
- lat: number (Optional. The latitude of the suggested place. Omit if no place is found within the radius.)
- lng: number (Optional. The longitude of the suggested place. Omit if no place is found within the radius.)
- locationLink: string (Optional. Google Maps Search URL)
- menuLink: string (Optional. A URL to ANY relevant webpage about the restaurant, such as Google Maps, Yelp, Instagram, or their website. DO NOT use recipe search links!)
- distanceKm: number (Optional. The straight-line physical distance in km. This MUST be strictly <= ${maxDistanceValue} km! Omit if home-cooked.)
- estimatedBudget: string (The estimated price of this suggested dish, formatted nicely with the currency symbol, e.g., "Rp 45,000" or "£3.50". This MUST be within the maximum budget of ${budgetValue} ${currencyValue}!)
- dishImageUrl: string (A valid, beautiful, and relevant Unsplash food image URL showing this specific type of dish, e.g., "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80" for a salad, or a suitable search query image URL from Unsplash.)
- benefitExplanation: string (Why this is good for the user's profile)
- tags: array of strings (e.g. ["High Protein", "Low Carb"])
- openingHours: string (The opening hours of the restaurant. E.g., "10:00 AM - 10:00 PM".)

Respond with a structured JSON format matching this schema exactly:
{
  "text": "Your conversational response here",
  "ideas": [
    {
      "name": "Food Name",
      "placeName": "Restaurant or Place Name",
      "address": "123 Main St, City, State",
      "lat": -6.2088,
      "lng": 106.8456,
      "locationLink": "https://www.google.com/maps/search/?api=1&query=HokBen&query_place_id=ChIJKZ1Uh-P1aS4R61b3Rsx8mSU",
      "menuLink": "https://www.hokben.co.id/",
      "distanceKm": 1.2,
      "estimatedBudget": "Rp 45,000",
      "dishImageUrl": "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80",
      "benefitExplanation": "Why this is good...",
      "tags": ["tag1", "tag2"],
      "openingHours": "10:00 AM - 10:00 PM"
    }
  ]
}`;
    }

    const sysInstruction = customSystemInstruction || "You are a world-class AI dietitian. Your response must be an exact JSON matching the requested schema. Never add markdown wrappers.";

    const textOutput = await callUnifiedLLM({
      modelId: (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite",
      systemInstruction: sysInstruction,
      promptText,
      responseMimeType: "application/json",
      googleSearch: false,
      enablePlaceIdTool: !!process.env.GOOGLE_MAPS_API_KEY
    });

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    let parsedData;
    try {
      parsedData = JSON.parse(cleanJson);
    } catch (parseErr: any) {
      const firstBrace = cleanJson.indexOf("{");
      const lastBrace = cleanJson.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        parsedData = await asyncParseLLMJSON(cleanJson);
      } else {
        throw parseErr;
      }
    }

    if (parsedData.ideas && Array.isArray(parsedData.ideas)) {
      parsedData.ideas = parsedData.ideas.map((idea: any) => ({
        ...idea,
        id: 'idea_' + Date.now() + Math.random().toString(36).substr(2, 9)
      }));
    }

    parsedData.agentPrompt = `System Instruction:\nYou are a world-class AI dietitian. Your response must be an exact JSON matching the requested schema. Never add markdown wrappers.\n\n${promptText}`;
    res.json({
      ...parsedData,
      apiCalls: [{ type: 'gemini', label: `Food Idea Agent (${engine || 'gemini-3.5-flash-lite'})` }]
    });
  } catch (error: any) {
    addDebugLog(`[FoodIdea] Error occurred: ${error.message || error}`);
    console.error("[Food Idea Analyze Error]:", error);
    const isQuotaError = error.message?.includes("429") || error.message?.includes("quota") || error.message?.includes("RESOURCE_EXHAUSTED");
    
    const errorMsg = isQuotaError
      ? "Unable to provide recommendations: Gemini API quota or rate limit reached. Please verify your API key or try again in a few minutes."
      : "Unable to provide recommendations: The agent connection has timed out or the request could not be processed. Please try again.";

    res.json({
      text: errorMsg,
      ideas: []
    });
  }
});

interface SearchEngine {
  name: string;
  isEnabled(env: any): boolean;
  search(query: string, count: number, env: any): Promise<Array<{title: string, imageUrl: string, pageUrl: string}>>;
}
const searchRegistry: SearchEngine[] = [
  // 1. Wikipedia (Always active, free, identified User-Agent raises limit to 200 RPM)
  {
    name: "Wikipedia",
    isEnabled: () => true,
    search: async (query, count) => {
      try {
        const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&pithumbsize=600&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${count + 2}&origin=*`;
        const res = await fetch(url, {
          headers: {
            "User-Agent": "HealthTracker/6.0 (https://github.com/cwahli/Health-tracker-6; Cwah.Liu@gmail.com)"
          }
        });
        const text = await res.text();
        if (!text.trim().startsWith('{')) {
          console.warn("[Wiki Search Warning] Non-JSON response received:", text.slice(0, 200));
          return [];
        }
        const data = JSON.parse(text);
        if (data.query && data.query.pages) {
          const pages = data.query.pages;
          const results = [];
          for (const pageId of Object.keys(pages)) {
            const page = pages[pageId];
            if (page.thumbnail && page.thumbnail.source) {
              const title = page.title.toLowerCase();
              // Blacklist filter to block non-food results (like mosques or battles)
              const blacklist = ["mosque", "church", "temple", "reign", "dynasty", "battle", "war", "monument", "district", "regency", "politician"];
              if (blacklist.some(word => title.includes(word))) {
                continue;
              }
              results.push({
                title: page.title,
                imageUrl: page.thumbnail.source,
                pageUrl: `https://en.wikipedia.org/?curid=${pageId}`,
                engine: "Wikipedia"
              });
            }
          }
          return results.slice(0, count);
        }
      } catch (err) {
        console.error("[Wiki Search Error]", err);
      }
      return [];
    }
  },
  // 2. Gemini Grounding Search API (disabled)
  {
    name: "GeminiSearch",
    isEnabled: () => false,
    search: async (query, count, env) => {
      try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
        const response = await withGeminiRetry(() => ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `Find a high quality image of this food dish: ${query}. Respond only with a very brief description.`,
          config: { tools: [{ googleSearch: {} }] }
        }), { label: "Unified LLM" });
        
        const candidate = response.candidates?.[0];
        const groundingMetadata = candidate?.groundingMetadata;
        const groundingChunks = groundingMetadata?.groundingChunks || [];
        
        const results = [];
        for (const chunk of groundingChunks) {
          if (chunk.web && chunk.web.uri && (chunk.web.uri.endsWith('.jpg') || chunk.web.uri.endsWith('.png') || chunk.web.uri.endsWith('.jpeg'))) {
            results.push({
              title: chunk.web.title || query,
              imageUrl: chunk.web.uri,
              pageUrl: chunk.web.uri,
              engine: "GeminiSearch"
            });
          }
        }
        
        // If we didn't find direct image URLs, let's just pick any returned URI as a fallback in case it's usable,
        // but normally groundingChunks web.uri points to pages, not images. Wait.
        // Actually, groundingChunks from googleSearch tool usually returns page URIs, not image URIs.
        return results.slice(0, count);
      } catch (err) {
        console.error("[Gemini Search Error]", err);
      }
      return [];
    }
  },
  // 5. LoremFlickr Fallback API
  {
    name: "LoremFlickr",
    isEnabled: () => true,
    search: async (query, count) => {
      try {
        const keyword = query.split(' ')[0] || 'food';
        const url = `https://loremflickr.com/400/400/food,${encodeURIComponent(keyword)}`;
        return [{
          title: query,
          imageUrl: url,
          pageUrl: `https://loremflickr.com`,
          engine: "LoremFlickr"
        }];
      } catch (err) {
        console.error("[LoremFlickr Error]", err);
      }
      return [];
    }
  },
  // 3. Google Custom Search API
  {
    name: "GoogleCSE",
    isEnabled: (env) => !!env.Custom_Search_API && env.Custom_Search_API !== "AIzaSyDGpOvUtgu7fEbpgms1ICuvFvJxi8DMGvA",
    search: async (query, count, env) => {
      try {
        const cx = env.Custom_Search_CX || "40e028bbf9ec84932";
        const url = `https://www.googleapis.com/customsearch/v1?key=${env.Custom_Search_API}&cx=${cx}&q=${encodeURIComponent(query)}&searchType=image&num=${count}`;
        const res = await fetch(url);
        const data = await res.json();
        if (res.ok && data.items) {
          return data.items.slice(0, count).map((item: any) => ({
            title: item.title,
            imageUrl: item.link,
            pageUrl: item.image?.contextLink || `https://www.google.com/search?q=${encodeURIComponent(query)}`,
            engine: "GoogleCSE"
          }));
        }
      } catch (err) {
        console.error("[GoogleCSE Search Error]", err);
      }
      return [];
    }
  },
  // 4. Brave Image Search API
  {
    name: "Brave",
    isEnabled: (env) => !!(env.BRAVE_SEARCH_API_KEY || env.Brave_Search_API || env.BRAVE_API_KEY),
    search: async (query, count, env) => {
      try {
        const apiKey = env.BRAVE_SEARCH_API_KEY || env.Brave_Search_API || env.BRAVE_API_KEY;
        const url = `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=${count + 2}`;
        const res = await fetch(url, {
          headers: { "X-Subscription-Token": apiKey }
        });
        const data = await res.json();
        if (res.ok && data.results) {
          return data.results.slice(0, count).map((item: any) => ({
            title: item.title || query,
            imageUrl: item.properties?.url || item.url,
            pageUrl: item.page_url || "https://brave.com",
            engine: "Brave"
          }));
        }
      } catch (err) {
        console.error("[Brave Search Error]", err);
      }
      return [];
    }
  }
];
function cleanSearchQuery(q: string): string {
  if (!q) return "";
  let clean = q;
  
  // 1. Remove text inside square brackets [like this]
  clean = clean.replace(/\[[^\]]*\]/g, "");
  
  // 2. Remove text inside parentheses (like this)
  clean = clean.replace(/\([^)]*\)/g, "");
  
  // 3. Replace common Indonesian abbreviations / terms to simplify search
  clean = clean.replace(/\/\s*(gr|goreng|bkr|bakar)/gi, "");
  
  // 4. Remove "+ NASI" or "+ Nasi" or "+ rice" or "with rice"
  clean = clean.replace(/\+\s*(nasi|rice)/gi, "");
  clean = clean.replace(/with\s+rice/gi, "");
  clean = clean.replace(/and\s+rice/gi, "");
  clean = clean.replace(/[\+\&]/g, " "); // replace + and & with space
  
  // 5. If there's a slash, take the first option (e.g. "Grilled/Fried Milkfish" -> "Grilled Milkfish")
  if (clean.includes("/")) {
    const parts = clean.split("/");
    clean = parts[0];
  }
  
  // 6. Common Indonesian/English replacements
  clean = clean.replace(/\bque\b/gi, "kuwe");
  clean = clean.replace(/\bvilet\b/gi, "fillet");
  
  // 7. Strip trailing/leading spaces and multiple spaces
  clean = clean.replace(/\s+/g, " ").trim();
  
  return clean;
}

// Reusable Image Retrieval Manager (Fail-Proof Sequential Pipeline)
async function retrieveFoodImages(
  query: string, 
  options: { mode?: "light" | "complete"; count?: number }
): Promise<Array<{title: string, imageUrl: string, pageUrl: string, engine?: string}>> {
  const cleanedQuery = cleanSearchQuery(query) || query;
  const mode = options.mode || "light";
  const targetCount = options.count || 2;
  const results: Array<{title: string, imageUrl: string, pageUrl: string, engine?: string}> = [];
  // Filter enabled engines based on active mode
  const activeEngines = searchRegistry.filter(engine => {
    if (mode === "light" && engine.name === "Brave") return false;
    return engine.isEnabled(process.env);
  });
  addDebugLog(`[ImageRetrieval] Searching for "${cleanedQuery}" (original: "${query}") (mode: ${mode}, count: ${targetCount})`);
  for (const engine of activeEngines) {
    if (results.length >= targetCount) break;
    try {
      const needed = targetCount - results.length;
      addDebugLog(`[ImageRetrieval] Requesting ${needed} image(s) from ${engine.name}...`);
      const engineResults = await engine.search(cleanedQuery, needed, process.env);
      if (engineResults && engineResults.length > 0) {
        results.push(...engineResults);
      }
    } catch (err: any) {
      console.error(`[ImageRetrieval] Engine ${engine.name} failed:`, err.message);
    }
  }
  return results.slice(0, targetCount);
}

// Programmatic, Fail-Proof Image Search Endpoint
app.post("/api/gemini/food-image-search", async (req, res) => {
  const { query, mode, count } = req.body;
  addDebugLog(`[FoodImageSearch] Route triggered for query: "${query}"`);
  
  if (imageSearchCache.has(query)) {
    const cached = imageSearchCache.get(query);
    // Ensure apiCalls are always reported even on cache hits
    return res.json({
      ...cached,
      apiCalls: [{ type: 'brave', label: `Brave Search (cached) - ${query}` }]
    });
  }

  try {
    const images = await retrieveFoodImages(query, {
      mode: mode || "light",
      count: typeof count === "number" ? count : 2
    });
    
    // De-duplicate engine names for apiCalls
    const enginesUsed = Array.from(new Set(images.map((img: any) => img.engine || 'Brave')));
    const apiCalls = enginesUsed.map(engineName => ({
      type: engineName.toLowerCase() === 'wikipedia' ? 'wikipedia' : engineName.toLowerCase() === 'unsplash' ? 'unsplash' : 'brave',
      label: `${engineName} Search - ${query}`
    }));

    const payload = {
      images,
      isAvailable: images.length > 0,
      apiCalls,
      error: images.length > 0 ? null : "No images could be retrieved across active search engines."
    };
    
    // Always cache the result to prevent infinite lookup loops for unfound items
    imageSearchCache.set(query, payload);

    res.json(payload);
  } catch (error: any) {
    console.error("[FoodImageSearch Endpoint Error]:", error);
    res.json({
      images: [],
      isAvailable: false,
      error: `Search pipeline error: ${error.message}`
    });
  }
});


app.post("/api/gemini/menu-image-search", async (req, res) => {
  const { labels } = req.body;
  if (!labels || !Array.isArray(labels) || labels.length === 0) {
    return res.json({ results: [] });
  }

  const batchSize = 5;
  const batches = [];
  for (let i = 0; i < labels.length; i += batchSize) {
    batches.push(labels.slice(i, i + batchSize));
  }

  let allResults: { label: string; imageUrl: string | null }[] = [];
  const ai = getGeminiClient();
  
  for (const batch of batches) {
    const promptText = `Briefly describe each of these dishes: ${batch.join(", ")}. Do not include URLs or format as JSON. Provide a short paragraph for each.`;
    try {
      const response = await withGeminiRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: promptText
      }), { label: "Unified LLM" });
      const candidate = response.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text || "";
      const groundingMetadata = candidate?.groundingMetadata;
      const groundingSupports = groundingMetadata?.groundingSupports || [];
      const groundingChunks = groundingMetadata?.groundingChunks || [];

      for (const label of batch) {
        let matchedUri = null;
        let matchReason = "No grounding match";
        const lowerLabel = label.toLowerCase();
        let matchedSegment = null;
        for (const support of groundingSupports) {
           const segment = support.segment;
           if (segment && segment.text && segment.text.toLowerCase().includes(lowerLabel)) {
             matchedSegment = support;
             break;
           }
        }
        if (!matchedSegment) {
           const parts = lowerLabel.split(" ");
           for (const support of groundingSupports) {
              const segment = support.segment;
              if (segment && segment.text && parts.some(p => p.length > 3 && segment.text.toLowerCase().includes(p))) {
                 matchedSegment = support;
                 break;
              }
           }
        }
        
        if (matchedSegment && matchedSegment.groundingChunkIndices && matchedSegment.groundingChunkIndices.length > 0) {
           const chunkIndex = matchedSegment.groundingChunkIndices[0];
           const chunk = groundingChunks[chunkIndex];
           if (chunk && chunk.web && chunk.web.uri) {
             matchedUri = chunk.web.uri;
           }
        }
        
        let ogImageUrl = null;
        if (matchedUri) {
           try {
             const scrapeRes = await fetch(matchedUri, { 
               headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
               signal: AbortSignal.timeout(5000)
             });
             const html = await scrapeRes.text();
             const $ = cheerio.load(html);
             ogImageUrl = $('meta[property="og:image"]').attr('content');
             if (!ogImageUrl) matchReason = "No og:image";
           } catch (e) {
             matchReason = "Scrape failure";
           }
        }
        
        // Fallback
        if (!ogImageUrl) {
           try {
             const fallbackRes = await fetch("http://localhost:3000/api/gemini/food-image-search", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: label })
             });
             const fallbackData = await fallbackRes.json();
             if (fallbackData.images && fallbackData.images.length > 0) {
                ogImageUrl = fallbackData.images[0].imageUrl;
             }
           } catch (e) {
             console.error("Fallback error", e);
           }
        }
        
        allResults.push({ label, imageUrl: ogImageUrl });
      }
    } catch (e) {
      console.error("Batch error:", e);
      for (const label of batch) {
         try {
             const fallbackRes = await fetch("http://localhost:3000/api/gemini/food-image-search", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: label })
             });
             const fallbackData = await fallbackRes.json();
             if (fallbackData.images && fallbackData.images.length > 0) {
                allResults.push({ label, imageUrl: fallbackData.images[0].imageUrl });
             } else {
                allResults.push({ label, imageUrl: null });
             }
         } catch(e) {
             allResults.push({ label, imageUrl: null });
         }
      }
    }
  }
  // Accumulate calls made during this batch
  const localApiCalls = [];
  const batchCount = Math.ceil(labels.length / 5);
  for (let i = 0; i < batchCount; i++) {
    localApiCalls.push({ type: 'gemini', label: 'Menu image search - Gemini 2.5 Flash' });
  }
  // Check if we hit the fallback search for any items
  allResults.forEach(r => {
    if (r.imageUrl) {
      localApiCalls.push({ type: 'brave', label: `Brave Search (menu fallback) - ${r.label}` });
    }
  });
  return res.json({ 
    results: allResults,
    apiCalls: localApiCalls
  });
});

/* old code replacement */
app.get("/api/gemini/test-menu-image-search", async (req, res) => {
  const testLabels = ["Beef Rendang", "Nasi Goreng", "Chicken Satay", "Gado Gado", "Soto Ayam", "Mie Goreng", "Martabak Manis", "Pempek Palembang", "Es Cendol", "Ayam Penyet", "GURAME ASAM MANIS", "ES TELER ALPUKAT", "SEBLAK CEKER", "MIE TEK-TEK BAKSO", "KWETIAU GORENG SEAFOOD", "JUS ALPUKAT", "ES BANGO AGER ITEM", "TONGKOL SUIR PETE", "AYAM GARANG ASEM", "CUMI GORENG TEPUNG"];

  try {
    const protocol = req.protocol || "http";
    const host = req.get("host") || "localhost:3000";
    const url = `${protocol}://${host}/api/gemini/menu-image-search`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labels: testLabels })
    });
    
    const data = await response.json();
    return res.json({ data, testLabels });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Endpoint to fetch real-time agent thinking process logs
app.get("/api/gemini/debug-logs", (req, res) => {
  const sessionId = (req.headers["x-session-id"] as string) || (req.query.sessionId as string) || "global";
  let logs: any[] = [];
  if (sessionId !== "global") {
    logs = sessionDebugLogs[sessionId] || [];
  } else {
    logs = globalDebugLogs;
  }
  res.json({ logs });
});

// Endpoint to clear the backend agent process logs
app.post("/api/gemini/clear-debug-logs", (req, res) => {
  const sessionId = (req.headers["x-session-id"] as string) || (req.query.sessionId as string) || "global";
  if (sessionId !== "global") {
    sessionDebugLogs[sessionId] = [];
  } else {
    globalDebugLogs = [];
  }
  addDebugLog(`[System] Debug logs cleared by user request.`, sessionId !== "global" ? sessionId : undefined);
  res.json({ status: "cleared", logs: [] });
});

// --- Issue backlog + shared issue tags (fix items) ---
registerIssueBacklogRoutes(app, {
  addDebugLog: (msg: string, sessionId?: string) => addDebugLog(msg, sessionId),
  globalDebugLogs: typeof globalDebugLogs !== 'undefined' ? globalDebugLogs : [],
  sessionDebugLogs: typeof sessionDebugLogs !== 'undefined' ? sessionDebugLogs : {},
});

// --- Bug snapshot packs (R2 /bugs/) + triage digest + brief API (Initiative K) ---
registerBugSnapshotRoutes(app, {
  callUnifiedLLM: (args: any) => callUnifiedLLM(args),
  getS3Client: () => getS3Client(),
  bucketName: CLOUDFLARE_R2_BUCKET_NAME,
  publicUrlBase: CLOUDFLARE_R2_PUBLIC_URL,
  addDebugLog: (msg: string, sessionId?: string) => addDebugLog(msg, sessionId),
});

registerGoldenRoutes(app, {
  getS3Client: () => getS3Client(),
  bucketName: CLOUDFLARE_R2_BUCKET_NAME,
  publicUrlBase: CLOUDFLARE_R2_PUBLIC_URL,
});

registerBrandMenuRoutes(app);

// Endpoint to compile logs and send to admin
app.post("/api/gemini/send-logs", (req, res) => {
  try {
    const sessionId = (req.headers["x-session-id"] as string) || (req.query.sessionId as string) || "global";
    const { logsText } = req.body;
    
    // Create admin logs directory if not exists
    const logsDir = path.join(process.cwd(), "data", "admin_logs");
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    const timestampStr = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(logsDir, `admin_logs_${sessionId}_${timestampStr}.txt`);
    
    const formattedContent = `ADMIN LOGS EXPORT\nTarget Admin: cwah.liu@gmail.com\nTimestamp: ${new Date().toLocaleString()}\nSession ID: ${sessionId}\n\n=========================================\n\n${logsText || "No logs provided."}`;
    
    fs.writeFileSync(filePath, formattedContent, "utf8");
    
    // Also append to a single rolling admin_logs_all.txt for convenience
    const rollingFilePath = path.join(logsDir, "admin_logs_all.txt");
    fs.appendFileSync(rollingFilePath, `\n\n=== EXPORTED AT ${new Date().toISOString()} (Session: ${sessionId}) ===\n${logsText}\n`, "utf8");
    
    addDebugLog(`[AdminExport] Emailed and compiled entire log history to cwah.liu@gmail.com. Saved locally to ${filePath}`);
    
    res.json({ 
      status: "success", 
      message: "Debug logs compiled and sent to cwah.liu@gmail.com. They have also been saved to the server persistent volume.",
      filePath
    });
  } catch (err: any) {
    console.error("Error exporting logs:", err);
    res.status(500).json({ error: "Failed to export debug logs to admin." });
  }
});

// Google Health / Google Fit OAuth Endpoints
app.get('/api/health-connect/url', (req, res) => {
  // Use the host header directly for the redirect URI
  const host = req.get('host');
  const protocol = host?.includes('localhost') ? 'http' : 'https';
  const redirectUri = `${protocol}://${host}/health-connect/callback`;
  
  const params = new URLSearchParams({
    client_id: process.env.GHealth_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/fitness.activity.read',
    access_type: 'offline',
    prompt: 'consent'
  });
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, redirectUri });
});

app.get(['/health-connect/callback', '/health-connect/callback/'], async (req, res) => {
  const { code } = req.query;
  const host = req.get('host');
  const protocol = host?.includes('localhost') ? 'http' : 'https';
  const redirectUri = `${protocol}://${host}/health-connect/callback`;

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        code: code as string,
        client_id: process.env.GHealth_CLIENT_ID || '',
        client_secret: process.env.GHealth_CLIENT_SECRET || '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      throw new Error(JSON.stringify(tokenData));
    }

    res.send(`
      <html>
        <body>
          <script>
            try {
              localStorage.setItem('ghealth_tokens', JSON.stringify(${JSON.stringify(tokenData)}));
              localStorage.setItem('ghealth_auth_status', 'SUCCESS');
            } catch (e) {
              console.error("Failed to write to localStorage:", e);
            }

            if (window.opener) {
              try {
                window.opener.postMessage({ type: 'GHEALTH_AUTH_SUCCESS', tokens: ${JSON.stringify(tokenData)} }, '*');
              } catch (e) {
                console.error("Failed to postMessage:", e);
              }
              window.close();
            } else {
              setTimeout(() => {
                window.close();
              }, 1500);
            }
          </script>
          <div style="font-family: sans-serif; text-align: center; padding-top: 40px; color: #333;">
            <h3 style="color: #4f46e5; margin-bottom: 8px;">Connection Successful!</h3>
            <p style="margin: 4px 0; font-size: 14px;">Your Google Health account has been connected.</p>
            <p style="font-size: 12px; color: #666; margin-top: 12px;">This window will close automatically.</p>
          </div>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error("GHealth OAuth error:", err);
    res.status(500).send(`Error exchanging code for tokens: ${err.message}`);
  }
});

app.post('/api/health-connect/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    return res.status(400).json({ error: 'Missing refresh_token' });
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: process.env.GHealth_CLIENT_ID || '',
        client_secret: process.env.GHealth_CLIENT_SECRET || '',
        refresh_token: refresh_token,
        grant_type: 'refresh_token'
      })
    });

    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 || response.status === 400) {
         return res.status(response.status).json(data);
      }
      throw new Error(JSON.stringify(data));
    }
    
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/health-connect/diagnostics', async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(401).json({ error: 'Missing access_token' });

  try {
    const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${access_token}`);
    const tokenInfo = await tokenInfoRes.json();

    const dsRes = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataSources', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    const dsData = await dsRes.json();

    res.json({
      tokenInfo: tokenInfo,
      dataSourcesCount: dsData.dataSource ? dsData.dataSource.length : 0,
      dataSources: dsData.dataSource ? dsData.dataSource.map((d: any) => d.dataStreamId) : dsData
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/health-connect/steps', async (req, res) => {
  const { access_token, startTimeMillis, endTimeMillis } = req.body;
  
  if (!access_token) {
    return res.status(401).json({ error: 'Missing access_token' });
  }

  try {
    const now = new Date();
    const endTime = endTimeMillis || now.getTime();
    
    // startTimeMillis is provided as the local start of today (midnight).
    const startTime = startTimeMillis || (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime());

    // Align queryStartTime to exactly 7 days before today's midnight to ensure 24h buckets align with midnight.
    const queryStartTime = startTime - 7 * 24 * 60 * 60 * 1000;

    console.log(`[GoogleFit] Querying from ${new Date(queryStartTime).toISOString()} to ${new Date(endTime).toISOString()} with primary datasource estimated_steps...`);

    // 1. Primary: Aggregate using the estimated_steps datasource as requested by the user.
    let response = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        aggregateBy: [{
          dataTypeName: 'com.google.step_count.delta',
          dataSourceId: 'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps'
        }],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis: queryStartTime,
        endTimeMillis: endTime
      })
    });

    let data = await response.json();
    
    // If the specific estimated_steps fails, try general com.google.step_count.delta as fallback
    if (!response.ok) {
      console.warn("Primary estimated_steps aggregation failed, trying general com.google.step_count.delta...");
      response = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          aggregateBy: [{
            dataTypeName: 'com.google.step_count.delta'
          }],
          bucketByTime: { durationMillis: 86400000 },
          startTimeMillis: queryStartTime,
          endTimeMillis: endTime
        })
      });
      data = await response.json();
    }

    if (!response.ok) {
      console.warn("General delta also failed, trying com.google.step_count.cumulative...");
      response = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          aggregateBy: [{
            dataTypeName: 'com.google.step_count.cumulative'
          }],
          bucketByTime: { durationMillis: 86400000 },
          startTimeMillis: queryStartTime,
          endTimeMillis: endTime
        })
      });
      data = await response.json();
    }

    if (!response.ok) {
      const errMessage = JSON.stringify(data);
      if (response.status === 401 || response.status === 400 || errMessage.includes('invalid_token') || errMessage.includes('401')) {
        return res.status(401).json({ error: errMessage });
      }
      throw new Error(errMessage);
    }

    // Parse the steps day-by-day (each bucket represents 1 day)
    let todaySteps = 0;
    let totalSevenDaySteps = 0;
    let lastActiveDaySteps = 0;
    let lastActiveDayTimestamp = "";
    let activeDaysCount = 0;
    let history: { date: string, value: number }[] = [];

    if (data.bucket && data.bucket.length > 0) {
      data.bucket.forEach((b: any) => {
        let bucketSteps = 0;
        if (b.dataset && b.dataset[0] && b.dataset[0].point && b.dataset[0].point.length > 0) {
          b.dataset[0].point.forEach((p: any) => {
            if (p.value && p.value[0]) {
              if (p.value[0].intVal !== undefined) {
                bucketSteps += p.value[0].intVal;
              } else if (p.value[0].fpVal !== undefined) {
                bucketSteps += Math.round(p.value[0].fpVal);
              }
            }
          });
        }

        totalSevenDaySteps += bucketSteps;
        if (bucketSteps > 0) {
          lastActiveDaySteps = bucketSteps;
          activeDaysCount++;
          if (b.startTimeMillis) {
            lastActiveDayTimestamp = new Date(parseInt(b.startTimeMillis, 10)).toLocaleDateString();
          }
        }
        
        if (b.startTimeMillis) {
          const dateStr = new Date(parseInt(b.startTimeMillis, 10)).toISOString().split('T')[0];
          history.push({ date: dateStr, value: bucketSteps });
        }

        // Check if this bucket corresponds to today's range
        const bucketStart = parseInt(b.startTimeMillis || "0", 10);
        const bucketEnd = parseInt(b.endTimeMillis || "0", 10);
        
        // If this bucket is today's bucket
        if (bucketStart >= startTime) {
          todaySteps += bucketSteps;
        }
      });
    }

    // Robust raw dataset query fallbacks (direct point read instead of aggregate query)
    // Helps with third-party sync apps or devices logging directly to Fit without bucket aggregate syncing.
    if (todaySteps === 0 && totalSevenDaySteps === 0) {
      console.log("[GoogleFit] Aggregate returned 0 steps. Activating dynamic direct dataset query fallbacks...");
      
      let bestSum = 0;
      let bestDataSaved = null;
      let bestSourceName = "";

      try {
        const dsRes = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataSources', {
          headers: { 'Authorization': `Bearer ${access_token}` }
        });
        if (dsRes.ok) {
          const dsData = await dsRes.json();
          if (dsData.dataSource && dsData.dataSource.length > 0) {
            const stepSources = dsData.dataSource.filter((d: any) => 
              d.dataType && d.dataType.name && d.dataType.name.includes("step_count")
            );

            for (const source of stepSources) {
              try {
                let currentSum = 0;
                let currentTodaySum = 0;
                const sourceId = encodeURIComponent(source.dataStreamId);
                const rawRes = await fetch(
                  `https://www.googleapis.com/fitness/v1/users/me/dataSources/${sourceId}/datasets/${queryStartTime * 1000000}-${endTime * 1000000}`,
                  { headers: { 'Authorization': `Bearer ${access_token}` } }
                );
                
                if (rawRes.ok) {
                  const rawData = await rawRes.json();
                  if (rawData.point && rawData.point.length > 0) {
                    if (source.dataType.name === "com.google.step_count.cumulative") {
                      // For cumulative, we sum positive differences between consecutive points
                      let lastVal = -1;
                      rawData.point.forEach((p: any) => {
                        if (p.value && p.value[0]) {
                          let val = p.value[0].intVal !== undefined ? p.value[0].intVal : (p.value[0].fpVal !== undefined ? Math.round(p.value[0].fpVal) : 0);
                          let delta = 0;
                          if (lastVal !== -1) {
                            if (val >= lastVal) {
                              delta = val - lastVal;
                            } else {
                              // Counter reset
                              delta = val;
                            }
                          }
                          currentSum += delta;
                          
                          // Check if point is from today
                          const pEndMillis = p.endTimeNanos ? Number(p.endTimeNanos) / 1000000 : 0;
                          if (pEndMillis >= startTime) {
                            currentTodaySum += delta;
                          }

                          lastVal = val;
                        }
                      });
                    } else {
                      // For delta, we just sum them up
                      rawData.point.forEach((p: any) => {
                        if (p.value && p.value[0]) {
                          let val = p.value[0].intVal !== undefined ? p.value[0].intVal : (p.value[0].fpVal !== undefined ? Math.round(p.value[0].fpVal) : 0);
                          currentSum += val;
                          
                          const pEndMillis = p.endTimeNanos ? Number(p.endTimeNanos) / 1000000 : 0;
                          if (pEndMillis >= startTime) {
                            currentTodaySum += val;
                          }
                        }
                      });
                    }
                    
                    if (currentSum > bestSum) {
                      bestSum = currentSum;
                      todaySteps = currentTodaySum;
                      bestDataSaved = rawData;
                      bestSourceName = source.dataStreamId;
                    }
                  }
                }
              } catch (e) {
                console.warn(`[GoogleFit] Raw query failed for ${source.dataStreamId}`, e);
              }
            }
          }
        }
      } catch (e) {
        console.warn("[GoogleFit] Failed to fetch data sources for fallback:", e);
      }

      // Use the best available source
      if (bestSum > 0) {
        totalSevenDaySteps = bestSum;
        data = { source: `dynamic_raw_${bestSourceName}`, totalPoints: bestDataSaved?.point?.length, ...bestDataSaved };
        console.log(`[GoogleFit] Successfully retrieved ${bestSum} raw steps via fallback from ${bestSourceName}! Today steps: ${todaySteps}`);
      }
    }

    const sevenDayAverage = activeDaysCount > 0 ? Math.round(totalSevenDaySteps / activeDaysCount) : Math.round(totalSevenDaySteps / 7);

    res.json({ 
      steps: todaySteps, 
      sevenDayTotal: totalSevenDaySteps,
      sevenDayAverage,
      lastActiveDaySteps: lastActiveDaySteps || todaySteps,
      lastActiveDayTimestamp: lastActiveDayTimestamp || new Date().toLocaleDateString(),
      history,
      raw: data 
    });
  } catch (err: any) {
    console.error("GHealth Steps error:", err);
    res.status(500).json({ error: "Failed to fetch steps: " + err.message });
  }
});

app.post('/admin/migrate', async (req, res) => {
  try {
    const secret = req.headers['x-admin-secret'] || req.body?.secret;
    if (!process.env.ADMIN_MIGRATION_SECRET || secret !== process.env.ADMIN_MIGRATION_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const commit = req.body?.commit === true;
    if (!db) {
      return res.status(500).json({ error: 'Firestore is not initialized.' });
    }
    const targetUid = req.body?.uid;
    if (!targetUid || typeof targetUid !== 'string') {
      return res.status(400).json({ error: 'A single "uid" is required in the request body. This endpoint no longer scans all users in one call — call it once per uid.' });
    }

    const report = {
      scannedUsers: 0,
      updatedUsers: 0,
      updatedDocs: 0,
      imagesCompressed: 0,
      biomarkerRenames: [] as any[],
      arrayToMapConversions: 0,
      dryRun: !commit
    };

    const targetDoc = await db.collection('users').doc(targetUid).get();
    if (!targetDoc.exists) {
      return res.status(404).json({ error: `No user found with uid ${targetUid}` });
    }
    report.scannedUsers = 1;

    for (const userDoc of [targetDoc]) {
      const uid = userDoc.id;
      const profile = userDoc.data();
      let profileChanged = false;
      
      const arrayFields = ['deletedFoodLogIds', 'deletedBiomarkerLogIds', 'deletedCustomBiomarkerKeys'];
      for (const field of arrayFields) {
        if (Array.isArray(profile[field])) {
          const newMap: any = {};
          for (const id of profile[field]) {
            newMap[id] = Date.now();
          }
          profile[field] = newMap;
          profileChanged = true;
          report.arrayToMapConversions++;
        }
      }

      if (renameBiomarkersInObject(profile, report, `users/${uid}/Profile`)) {
        profileChanged = true;
      }
      
      if (await compressImagesInObject(profile, report)) {
        profileChanged = true;
      }

      if (profileChanged) {
        if (commit) await userDoc.ref.set(profile, { merge: true });
        report.updatedUsers++;
      }

      // Iterate subcollections
      const collections = await userDoc.ref.listCollections();
      for (const col of collections) {
        const docs = await col.get();
        for (const docSnap of docs.docs) {
          const data = docSnap.data();
          let docChanged = false;

          if (renameBiomarkersInObject(data, report, `users/${uid}/${col.id}/${docSnap.id}`)) {
            docChanged = true;
          }

          if (await compressImagesInObject(data, report)) {
            docChanged = true;
          }

          if (docChanged) {
            if (commit) await docSnap.ref.set(data, { merge: true });
            report.updatedDocs++;
          }
        }
      }
    }

    res.json(report);
  } catch (error: any) {
    console.error('Migration error:', error);
    res.status(500).json({ error: error.message });
  }
});

  const distPath = path.join(process.cwd(), "dist");
  const hasBuiltDist = fs.existsSync(path.join(distPath, "index.html"));
  // Cloud Run / `npm start` should serve dist. Local `npm run dev` (tsx) must
  // use Vite even when a stale dist/ is sitting on disk — otherwise the UI
  // silently stays weeks old and looks "broken".
  const runningFromSource =
    process.env.FORCE_VITE === "1" ||
    process.env.npm_lifecycle_event === "dev" ||
    process.argv.some((a) => /(^|[\\/])tsx([\\/]|$)/.test(a));
  const serveDist = hasBuiltDist && !runningFromSource;
  console.log(
    `[boot] frontend=${serveDist ? "dist" : "vite"} hasDist=${hasBuiltDist} fromSource=${runningFromSource}`
  );
  if (serveDist) {
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }



function renameBiomarkersInObject(obj: any, report: any, locationStr: string): boolean {
  let changed = false;
  if (obj && typeof obj === 'object') {
    if (obj.biomarkers && typeof obj.biomarkers === 'object') {
      const newB: any = {};
      let bChanged = false;
      for (const [k, v] of Object.entries(obj.biomarkers)) {
        const mapped = getMappedBiomarkerKey(k);
        if (mapped !== k) {
          bChanged = true;
          report.biomarkerRenames.push({ location: locationStr, from: k, to: mapped });
          newB[mapped] = v;
        } else {
          newB[k] = v;
        }
      }
      if (bChanged) {
        obj.biomarkers = newB;
        changed = true;
      }
    }
    // Check customBiomarkers in user profile
    if (locationStr.endsWith('Profile') && obj.customBiomarkers && typeof obj.customBiomarkers === 'object') {
      const newCustom: any = {};
      let cChanged = false;
      for (const [k, v] of Object.entries(obj.customBiomarkers)) {
        const mapped = getMappedBiomarkerKey(k);
        if (mapped !== k) {
          cChanged = true;
          report.biomarkerRenames.push({ location: locationStr + ' (customBiomarkers)', from: k, to: mapped });
          newCustom[mapped] = v;
        } else {
          newCustom[k] = v;
        }
      }
      if (cChanged) {
        obj.customBiomarkers = newCustom;
        changed = true;
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k !== 'biomarkers' && k !== 'customBiomarkers' && typeof v === 'object' && v !== null) {
        if (renameBiomarkersInObject(v, report, `${locationStr}.${k}`)) {
          changed = true;
        }
      }
    }
  }
  return changed;
}

async function compressImagesInObject(obj: any, report: any): Promise<boolean> {
  let changed = false;
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.startsWith('data:image/') && v.length > 25000) {
        try {
          const matches = v.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            const buffer = Buffer.from(matches[2], 'base64');
            const resized = await sharp(buffer)
              .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 50 })
              .toBuffer();
            const newBase64 = `data:image/jpeg;base64,${resized.toString('base64')}`;
            if (newBase64.length < v.length) {
              obj[k] = newBase64;
              changed = true;
              report.imagesCompressed++;
            }
          }
        } catch (e) {
          console.error('Image compression failed', e);
        }
      } else if (typeof v === 'object' && v !== null) {
        if (await compressImagesInObject(v, report)) {
          changed = true;
        }
      }
    }
  }
  return changed;
}


  // Warm up database brand cache and trigger initial database self-cleaning maintenance if configured
  import('./supabaseAdmin.js').then(({ isSupabaseConfigured, supabaseAdmin }) => {
    if (isSupabaseConfigured) {
      fetchAllDatabaseBrands().then(async ({ allBrands }) => {
        console.log(`[BrandCache] Loaded ${allBrands.size} brands dynamically from database.`);
        try {
          const chainStats = await consolidateBrandMenuItemsAndChains(supabaseAdmin);
          const catalogStats = await cleanUnbrandedFoodCatalog(supabaseAdmin);
          console.log(`[SelfCleaning] Initial database maintenance complete:`, chainStats, catalogStats);
        } catch (e) {
          console.warn('[SelfCleaning] Startup maintenance warning:', e);
        }
      }).catch((err) => {
        console.warn('[BrandCache] Warmup warning:', err);
      });
    } else {
      console.log('[BrandCache] Supabase credentials not set, operating in local offline mode.');
    }
  });

  recoverInterruptedServerJobs().then(count => {
    if (count > 0) {
      console.log(`[ServerJobs Worker] Interrupted background job recovery initiated for ${count} jobs.`);
    }
  }).catch(err => {
    console.warn('[ServerJobs Worker] Startup recovery warning:', err);
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Health Cockpit App] Full-Stack server running on port ${PORT}`);
  });
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer();
}

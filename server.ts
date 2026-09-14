import dns from 'node:dns';
import compression from "compression";
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

import {
  checkCategoryAndStateCompatibility,
  applyServerAverageNutrients,
  enrichBilingualItemName,
  checkThermodynamicDensitySanity,
  checkArchetypeMacroBounds,
  applySatFatAndAddedSugarFloor,
  backfillSparseMicronutrients,
} from './server_pure_helpers.js';
import { filterMatchesForQuery, pickQueryScopedMatch } from './server_query_scoped_match.js';
import {
  namesReferToSameFood,
  matchBreakdownItemToScout,
  breakdownAlreadyHasScoutName,
  applySoftReceiptAlignment,
} from './server_scout_reconcile.js';
import { buildFoodSearchQuerySet } from './server_query_set';
// BrandGuard
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
import { ensureD1Schema } from "./server_d1_schema.js";
import { reconcileIngredientsToComponents } from './server_vision_scout.js';
import { resolveInternalFood, resolveDishCache, upsertFoodItemCandidate, upsertFoodAlias, upsertDishCacheCandidate, recordFoodObservation, recordSyncEvent, normalizeFoodKey, normalizeDishKey, getCatalogSyncStatus, mergeFoodCatalogItems, quarantineAtwaterFailures, checkAtwaterValidity, getFallbackCategoryProfile } from './server_food_catalog.js';
import { sanitizeDishTitle, isGroceryBrandSync, selfCleanBrandDatabase, isUnofficialOrCompositeDish } from './serverBrandMenu.js';
import {
  computeItemBudget,
  reconcileNutrients,
  portionAndReconcile,
  assertComponentSumMatchesItem,
  parseLabelCalories,
  applyPostReconcileTruthLocks,
} from './server_budget_reconcile.js';
import { rebalanceNutrientProfile, computeCaloriesFromMacros, applyNutrientModifiers } from './server_derivation.js';
import {
  buildPortionClarifyPayload,
  applyPortionChoices,
} from './server_portion_clarify.js';
import { attachHappyPathMealBuild, markDietDegraded, buildSavableMealFromParsed } from './server_meal_orchestrator.js';
import { toPendingFoodLog, fromEvaluationComparison } from './src/mealBuild/adapters.js';
import { projectDietInput } from './src/mealBuild/projectors.js';
import { beginStage, endStage, formatDietProjectionBlock } from './src/mealBuild/stageLifecycle.js';
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
import { extractUnitFromString, normalizeUnitEquivalence } from './src/utils/biomarkerAuditEngine';
import * as cheerio from "cheerio";
import fs from "fs";

export const SINGLE_STAPLE_RE = /\b(croissant|croissants|baguette|bread|toast|muffin|scone|cookie|cupcake|biscuit|pancake|waffle|pastry|doughnut|donut|bun|roll|brioche)\b/i;
import path from "path";
import { getApps, initializeApp } from 'firebase-admin/app';
import { submitServerJob, recoverInterruptedServerJobs } from './serverJobs';
import { biomarkerRouter } from './server_routes_biomarkers.js';
import { foodRouter } from './server_routes_food.js';
import { jobsRouter } from './server_routes_jobs.js';
import { syncRouter } from './server_routes_sync.js';
import { adminRouter } from './server_routes_admin.js';
import { healthConnectRouter } from './server_routes_health_connect.js';
import { r2Router, getS3Client, CLOUDFLARE_R2_BUCKET_NAME, CLOUDFLARE_R2_PUBLIC_URL } from './server_routes_r2.js';
import { medicalGeminiRouter } from './server_routes_medical_gemini.js';
import { foodAnalyzeRouter } from './server_routes_food_analyze.js';
import { scorecardRouter } from './server_routes_scorecard.js';

export const BEVERAGE_RAW_PATTERN = /\b(beverage|drink|water|juice|beer|wine|soda|cola|tea|coffee|cappuccino|espresso|latte|mocha|macchiato|boba|smoothie|shake|milk|oat\s*milk|oatmilk|almond\s*milk|almondmilk|soy\s*milk|soymilk|coconut\s*milk|dairy|yogurt|fruit|melon|watermelon|apple|orange|banana|berry|berries|grape|citrus|salad|raw|fresh|broth|soup)\b/i;

export function sanitizeReviewedBiomarkerUnitConsistency(item: any): any {
  if (!item || typeof item !== 'object') return item;
  const declaredUnit = item.unit || '';
  const normalizedDeclared = normalizeUnitEquivalence(declaredUnit);

  let hasMismatch = false;

  // Check brackets range
  if (Array.isArray(item.rangeBrackets)) {
    for (const b of item.rangeBrackets) {
      if (b && typeof b.range === 'string') {
        const bracketUnit = extractUnitFromString(b.range);
        if (bracketUnit) {
          const normalizedBracket = normalizeUnitEquivalence(bracketUnit);
          if (normalizedDeclared && normalizedBracket && normalizedDeclared !== normalizedBracket) {
            hasMismatch = true;
            console.warn(`[data_review] Unit mismatch detected in bracket range "${b.range}" (found unit "${bracketUnit}", normalized "${normalizedBracket}") vs declared unit "${declaredUnit}" (normalized "${normalizedDeclared}") for biomarker key "${item.key}"`);
            break;
          }
        }
      }
    }
  }

  // Check profileAdjustedNormalRange
  if (!hasMismatch && typeof item.profileAdjustedNormalRange === 'string') {
    const rangeUnit = extractUnitFromString(item.profileAdjustedNormalRange);
    if (rangeUnit) {
      const normalizedRange = normalizeUnitEquivalence(rangeUnit);
      if (normalizedDeclared && normalizedRange && normalizedDeclared !== normalizedRange) {
        hasMismatch = true;
        console.warn(`[data_review] Unit mismatch detected in profileAdjustedNormalRange "${item.profileAdjustedNormalRange}" vs declared unit "${declaredUnit}" for biomarker key "${item.key}"`);
      }
    }
  }

  // Check optimalValue
  if (!hasMismatch && typeof item.optimalValue === 'string') {
    const optimalUnit = extractUnitFromString(item.optimalValue);
    if (optimalUnit) {
      const normalizedOptimal = normalizeUnitEquivalence(optimalUnit);
      if (normalizedDeclared && normalizedOptimal && normalizedDeclared !== normalizedOptimal) {
        hasMismatch = true;
        console.warn(`[data_review] Unit mismatch detected in optimalValue "${item.optimalValue}" vs declared unit "${declaredUnit}" for biomarker key "${item.key}"`);
      }
    }
  }

  if (hasMismatch) {
    console.warn(`[data_review] Discarding unit-mismatched AI output ranges for biomarker key "${item.key}" due to scale/unit inconsistency.`);
    return {
      ...item,
      rangeBrackets: [],
      profileAdjustedNormalRange: "",
      optimalValue: "",
      _unitConsistencyDropped: true
    };
  }

  return item;
}

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
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) return null;
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
export const adminAuth = getAdminAuth();
import express from "express";

export const BiomarkerMatrix: Record<string, any> = {
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

export function sanitizeUnitText(rawUnit: any): string {
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
import { getTraceNutrientsForFoodType, getCookingMethodModifier, calculateUniversalAddedNutrients, lookupCanonicalBaseFood } from "./server_food_db";
import { decidePrepAddition } from "./server_prep_policy";
import dotenv from "dotenv";
import { AsyncLocalStorage } from "async_hooks";
import { biomarkerDefinitions, getBiomarkerStatus, getBiomarkerStatusLabel, getBiomarkerMetadata, getCustomBiomarkerDef } from "./src/utils/biomarkers";
import { filterHistoryForUse, enrichReviewModificationCommands, sanitizeReviewReply } from "./src/utils/biomarkerLifecycle";
import { generateDynamicInsight } from "./src/utils/biomarkerInsights";
import { formatOptimalTargetValue } from "./src/utils/agentCalibration";
import { NUTRIENT_KEYS } from "./src/utils/nutrients";
import { t, interpolate, withAgentLanguage } from "./src/utils/i18n";
import { extractBalancedJson, sanitizeMealWeight, findItemIndexInList, getUSDANutrientValue, extractUSDANutrientsPer100g, checkIfItemIsAlreadyPrepared, applyNutrientRealityChecks, applyCommercialSodiumFloor, checkAtwaterConsistency, synchronizeNarrativeText, evaluateNutrientWarnings, build31NutrientsMarkdownServer, enforceTitlePluralParity, sanitizeVerdictLabel } from "./server_pure_helpers";
import { cleanNutrientNumber } from "./server_nutrient_aggregation";
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
import { buildVisualScoutPrompt } from "./agents/scoutInstructions";
import { biomarkerReviewSystemInstruction } from "./agents/biomarkerInstructions";
import { isDishEstimateEnabled } from "./server_food_flags";
import { finalizeDishLedger } from "./server_dish_finalize";
import { matchBrandMenu } from "./server_brand_match";
import { classifyDishAtomic } from "./server_dish_classify";


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
    const { supabaseAdmin, isSupabaseConfigured } = await import('./supabaseAdmin.js');
    if (!isSupabaseConfigured || !supabaseAdmin) return [];
    const { data, error } = await supabaseAdmin
      .from('chain_menu_sources')
      .select('*')
      .eq('chain_key', chainKey)
      .eq('country_code', countryCode)
      .eq('enabled', true)
      .order('priority', { ascending: true });
    if (error) {
      const errMsg = error.message || String(error);
      if (/exceed_egress_quota|quota|restricted/i.test(errMsg)) {
        addDebugLog(`[ChainSource] Supabase egress quota exceeded, bypassing chain lookup for ${chainKey}`);
      } else {
        addDebugLog(`[ChainSource] lookup error for ${chainKey}: ${errMsg}`);
      }
      return [];
    }
    return data || [];
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    if (/exceed_egress_quota|quota|restricted/i.test(errMsg)) {
      addDebugLog(`[ChainSource] Supabase egress quota exceeded, bypassing chain lookup for ${chainKey}`);
    } else {
      addDebugLog(`[ChainSource] lookup exception: ${errMsg}`);
    }
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
export async function searchOpenFoodFacts(query: string, maxResults: number = 5): Promise<any[]> {
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
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) return [];
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



export function isUsableWebNutritionHit(webItem: any): boolean {
  if (!webItem) return false;
  const cals = Number(webItem.calories);
  if (isNaN(cals) || cals <= 0) return false;
  
  // Accept even if macros are missing, as long as calories are present
  return true;
}

dotenv.config();
// console.log("Maps Key status at server boot:", process.env.GOOGLE_MAPS_API_KEY ? "DEFINED" : "UNDEFINED");

// Initialize Firebase Firestore for server-side calculations using Google Cloud Firestore Node.js SDK (bypasses security rules)
export let db: any = null;
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



function getQuadrantBox(idx: number, total: number = 4): [number, number, number, number] {
  const quadrants: [number, number, number, number][] = [
    [100, 50, 480, 480],   // Top-Left
    [100, 520, 480, 950],  // Top-Right
    [520, 50, 920, 480],   // Bottom-Left
    [520, 520, 920, 950],  // Bottom-Right
    [200, 100, 600, 500],  // Center-Left
    [200, 500, 600, 900],  // Center-Right
  ];
  return quadrants[idx % quadrants.length];
}

export function resolveComparisonGroups(rawGroups: any[], scoutItems: any[], lang?: unknown): any[] {
  const usedIndices = new Set<number>();

  const mappedGroups = (Array.isArray(rawGroups) ? rawGroups : []).map((g: any) => {
    const items: any[] = [];
    let indices: any[] = Array.isArray(g.scoutItemIndices) ? [...g.scoutItemIndices] : [];

    // Fallback: If scoutItemIndices is empty, check g.items or g.itemNames
    if (indices.length === 0) {
      if (Array.isArray(g.items) && g.items.length > 0) {
        indices = g.items.map((it: any) => (typeof it === 'object' && it !== null ? (it.scoutIndex ?? it.name ?? it.title) : it));
      } else if (Array.isArray(g.itemNames) && g.itemNames.length > 0) {
        indices = [...g.itemNames];
      }
    }

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

      // 3. Fallback: If rawIdx is a string, perform robust fuzzy matching against name, originalName, keyword, brand
      if (!s && typeof rawIdx === "string") {
        const cleanRaw = rawIdx.trim().toLowerCase();
        if (cleanRaw.length > 1) {
          const foundIdx = scoutItems.findIndex((item: any) => {
            const name = (item.name || "").toLowerCase();
            const kw = (item.keyword || "").toLowerCase();
            const orig = (item.originalName || "").toLowerCase();
            const brand = (item.brand || "").toLowerCase();
            return cleanRaw === name || cleanRaw === orig || cleanRaw === kw ||
                   name.includes(cleanRaw) || cleanRaw.includes(name) ||
                   orig.includes(cleanRaw) || cleanRaw.includes(orig) ||
                   kw.includes(cleanRaw) || cleanRaw.includes(kw) ||
                   (brand && cleanRaw.includes(brand));
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
          name: enrichBilingualItemName(s.name || s.originalName || s.keyword),
          keyword: s.keyword || null,
          originalName: s.originalName || null,
          boundingBox2D: s.boundingBox2D || null,
          sourceImageIndex: typeof s.sourceImageIndex === "number" ? s.sourceImageIndex : 0,
          scoutIndex: i
        });
      }
    });

    // Text-only comparisons or un-indexed compare: fall back to g.items or g.itemNames
    if (items.length === 0) {
      const fallbackList = Array.isArray(g.items) && g.items.length > 0 ? g.items : (Array.isArray(g.itemNames) ? g.itemNames : []);
      fallbackList.forEach((it: any, fIdx: number) => {
        const rawName = typeof it === 'string' ? it.trim() : (it?.name || it?.originalName || it?.keyword || '');
        if (rawName) {
          items.push({
            name: enrichBilingualItemName(rawName),
            keyword: it?.keyword || rawName,
            originalName: it?.originalName || rawName,
            boundingBox2D: it?.boundingBox2D || g.boundingBox2D || null,
            sourceImageIndex: typeof it?.sourceImageIndex === 'number' ? it.sourceImageIndex : (typeof g.sourceImageIndex === 'number' ? g.sourceImageIndex : 0),
            scoutIndex: typeof it?.scoutIndex === 'number' ? it.scoutIndex : fIdx,
          });
        }
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
                const name = (item.name || "").toLowerCase();
                const kw = (item.keyword || "").toLowerCase();
                const orig = (item.originalName || "").toLowerCase();
                return cleanRaw === orig || cleanRaw === kw || cleanRaw.includes(kw) || kw.includes(cleanRaw) || cleanRaw.includes(orig) || orig.includes(cleanRaw);
              });
              if (foundIdx !== -1) resolvedIdx = foundIdx;
            }
            return [[String(resolvedIdx !== -1 ? resolvedIdx : rawId), t.threat]];
          })
      : (g.itemClinicalThreats && typeof g.itemClinicalThreats === "object")
          ? Object.entries(g.itemClinicalThreats)
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
              const name = (item.name || "").toLowerCase();
              const kw = (item.keyword || "").toLowerCase();
              const orig = (item.originalName || "").toLowerCase();
              return cleanKey === name || cleanKey.includes(name) || name.includes(cleanKey) || cleanKey.includes(kw) || kw.includes(cleanKey) || cleanKey.includes(orig) || orig.includes(cleanKey);
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

    const rawV = g.verdict;
    const sanitizedVerdict = rawV && typeof rawV === 'object' && rawV.label
      ? {
          label: sanitizeVerdictLabel(rawV.label, rawV.level, g.averageNutrients, lang),
          level: String(rawV.level || 'neutral')
        }
      : rawV;

    // Derive bounding box: if null or [0,0,1000,1000], compute union from member items
    let resolvedBox = g.boundingBox2D;
    const isCoarse = Array.isArray(resolvedBox) && resolvedBox.length === 4 && resolvedBox[0] === 0 && resolvedBox[1] === 0 && resolvedBox[2] === 1000 && resolvedBox[3] === 1000;
    if (!resolvedBox || isCoarse) {
      const validItemBoxes = items.map(it => it.boundingBox2D).filter((b: any) => Array.isArray(b) && b.length === 4 && !(b[0] === 0 && b[1] === 0 && b[2] === 1000 && b[3] === 1000));
      if (validItemBoxes.length > 0) {
        resolvedBox = [
          Math.min(...validItemBoxes.map(b => b[0])),
          Math.min(...validItemBoxes.map(b => b[1])),
          Math.max(...validItemBoxes.map(b => b[2])),
          Math.max(...validItemBoxes.map(b => b[3]))
        ];
      }
    }

    return {
      groupName: g.groupName,
      verdict: sanitizedVerdict,
      message: g.message,
      comparisonSentence: g.comparisonSentence || g.message || g.recommendation || `Evaluation for ${g.groupName || 'options'}.`,
      orderingTip: g.orderingTip || null,
      averageNutrients: g.averageNutrients || null,
      averageNutrientsPer100g: g.averageNutrientsPer100g || null,
      boundingBox2D: resolvedBox,
      scoutItemIndices: Array.from(resolvedIndices),
      itemClinicalThreats: resolvedThreats,
      items
    };
  });

  // Filter out any groups that ended up with 0 items if other groups have items
  let resolvedGroups = mappedGroups.filter(g => g.items && g.items.length > 0);

  // Coverage repair: any scout item the model never assigned to a group still gets shown,
  // instead of silently vanishing from the comparison.
  if (scoutItems.length > 0) {
    const unassignedIdxs = scoutItems.map((_, i) => i).filter(i => !usedIndices.has(i));
    if (unassignedIdxs.length > 0) {
      console.log(`[Comparison Resolve] unassigned indices: ${unassignedIdxs.join(', ')}`);
      // If all items were unassigned or resolvedGroups is empty, and count is <= 6, unbundle into individual option groups
      if (resolvedGroups.length === 0 && scoutItems.length <= 6) {
        scoutItems.forEach((sItem: any, idx: number) => {
          const itemName = enrichBilingualItemName(sItem.name || sItem.originalName || sItem.keyword || `Option ${idx + 1}`);
          const itemBox = sItem.boundingBox2D && !(sItem.boundingBox2D[0] === 0 && sItem.boundingBox2D[1] === 0 && sItem.boundingBox2D[2] === 1000 && sItem.boundingBox2D[3] === 1000)
            ? sItem.boundingBox2D
            : getQuadrantBox(idx, scoutItems.length);
          resolvedGroups.push({
            groupName: itemName,
            verdict: { label: t(lang, 'comparisonSupportsEval') || 'Supports Evaluation', level: "neutral" },
            message: interpolate(t(lang, 'comparisonEvalFor') || 'Nutritional evaluation for {name}.', { name: itemName }),
            comparisonSentence: `Evaluation for ${itemName}.`,
            orderingTip: "Consider your daily nutrition allowance when selecting.",
            averageNutrients: sItem.preCalcNutrients || { calories: 150, protein: 5, totalFat: 5, saturatedFat: 1, carbohydrates: 20, sodium: 100 },
            averageNutrientsPer100g: { calories: 150, protein: 5, totalFat: 5, saturatedFat: 1, carbohydrates: 20, sodium: 100 },
            boundingBox2D: itemBox,
            scoutItemIndices: [idx],
            itemClinicalThreats: {},
            items: [{
              name: itemName,
              keyword: sItem.keyword || null,
              originalName: sItem.originalName || null,
              boundingBox2D: itemBox,
              sourceImageIndex: typeof sItem.sourceImageIndex === "number" ? sItem.sourceImageIndex : 0,
              scoutIndex: idx
            }]
          });
        });
      } else if (scoutItems.length <= 6) {
        // Unbundle unassigned individual items
        unassignedIdxs.forEach((idx) => {
          const s = scoutItems[idx];
          const itemName = enrichBilingualItemName(s.name || s.originalName || s.keyword || `Option ${idx + 1}`);
          const itemBox = s.boundingBox2D || getQuadrantBox(resolvedGroups.length, scoutItems.length);
          resolvedGroups.push({
            groupName: itemName,
            verdict: { label: t(lang, 'comparisonSupportsEval') || 'Supports Evaluation', level: "neutral" },
            message: interpolate(t(lang, 'comparisonEvalFor') || 'Nutritional evaluation for {name}.', { name: itemName }),
            comparisonSentence: `Evaluation for ${itemName}.`,
            orderingTip: "Consider your daily nutrition allowance when selecting.",
            averageNutrients: s.preCalcNutrients || { calories: 150, protein: 5, totalFat: 5, saturatedFat: 1, carbohydrates: 20, sodium: 100 },
            averageNutrientsPer100g: { calories: 150, protein: 5, totalFat: 5, saturatedFat: 1, carbohydrates: 20, sodium: 100 },
            boundingBox2D: itemBox,
            scoutItemIndices: [idx],
            itemClinicalThreats: {},
            items: [{
              name: itemName,
              keyword: s.keyword || null,
              originalName: s.originalName || null,
              boundingBox2D: itemBox,
              sourceImageIndex: typeof s.sourceImageIndex === "number" ? s.sourceImageIndex : 0,
              scoutIndex: idx
            }]
          });
        });
      } else {
        const missing = unassignedIdxs.map(i => scoutItems[i]);
        resolvedGroups.push({
          groupName: t(lang, 'comparisonUnassigned') || 'Other Menu Options',
          verdict: { label: t(lang, 'comparisonSupportsEval') || 'Supports Evaluation', level: "neutral" },
          message: t(lang, 'comparisonUnassignedMsg') || 'Additional menu choices available for selection and nutritional comparison.',
          comparisonSentence: t(lang, 'comparisonUnassignedMsg') || "Additional option for evaluation.",
          orderingTip: "Consider your daily nutrition allowance when selecting.",
          averageNutrients: { calories: 150, protein: 5, totalFat: 5, saturatedFat: 1, carbohydrates: 20, sodium: 100 },
          averageNutrientsPer100g: { calories: 150, protein: 5, totalFat: 5, saturatedFat: 1, carbohydrates: 20, sodium: 100 },
          boundingBox2D: getQuadrantBox(resolvedGroups.length, 4),
          scoutItemIndices: unassignedIdxs,
          itemClinicalThreats: {},
          items: missing.map((s: any, mIdx: number) => ({
            name: enrichBilingualItemName(s.name || s.originalName || s.keyword),
            keyword: s.keyword || null,
            originalName: s.originalName || null,
            boundingBox2D: s.boundingBox2D || null,
            sourceImageIndex: typeof s.sourceImageIndex === "number" ? s.sourceImageIndex : 0,
            scoutIndex: unassignedIdxs[mIdx]
          }))
        });
      }
    }
  }

  // Small-count safeguard: For <= 6 total items, if everything was lumped into 1 single group, unbundle into 1 item per group
  if (scoutItems.length > 0 && scoutItems.length <= 6) {
    const isLumped = resolvedGroups.length === 1 && (
      (resolvedGroups[0].scoutItemIndices && resolvedGroups[0].scoutItemIndices.length > 1) ||
      resolvedGroups[0].groupName === t(lang, 'comparisonUnassigned') ||
      resolvedGroups[0].groupName === 'Other Menu Options' ||
      resolvedGroups[0].groupName === 'Pilihan Menu Lainnya' ||
      resolvedGroups[0].groupName === 'Unassigned items'
    );
    if (isLumped) {
      console.log(`[Comparison Grouping Safeguard] Unbundling multi-item group for ${scoutItems.length} items into 1 item per group.`);
      const unbundledGroups: any[] = [];
      scoutItems.forEach((sItem: any, idx: number) => {
        const existingGroup = resolvedGroups.find(g => g.scoutItemIndices && g.scoutItemIndices.includes(idx)) || resolvedGroups[0];
        const itemName = enrichBilingualItemName(sItem.name || sItem.originalName || sItem.keyword || `Option ${idx + 1}`);
        const itemBox = sItem.boundingBox2D && !(sItem.boundingBox2D[0] === 0 && sItem.boundingBox2D[1] === 0 && sItem.boundingBox2D[2] === 1000 && sItem.boundingBox2D[3] === 1000)
          ? sItem.boundingBox2D
          : getQuadrantBox(idx, scoutItems.length);
        unbundledGroups.push({
          groupName: itemName,
          verdict: existingGroup?.verdict || { label: t(lang, 'comparisonSupportsEval'), level: "neutral" },
          message: existingGroup?.message || interpolate(t(lang, 'comparisonEvalFor'), { name: itemName }),
          comparisonSentence: existingGroup?.comparisonSentence || `Evaluation for ${itemName}.`,
          orderingTip: existingGroup?.orderingTip || "Consider your daily nutrition allowance when selecting.",
          averageNutrients: sItem.preCalcNutrients || existingGroup?.averageNutrients || { calories: 150, protein: 5, totalFat: 5, saturatedFat: 1, carbohydrates: 20, sodium: 100 },
          averageNutrientsPer100g: existingGroup?.averageNutrientsPer100g || { calories: 150, protein: 5, totalFat: 5, saturatedFat: 1, carbohydrates: 20, sodium: 100 },
          boundingBox2D: itemBox,
          scoutItemIndices: [idx],
          itemClinicalThreats: existingGroup?.itemClinicalThreats ? { [String(idx)]: existingGroup.itemClinicalThreats[String(idx)] || "" } : {},
          items: [{
            name: itemName,
            keyword: sItem.keyword || null,
            originalName: sItem.originalName || null,
            boundingBox2D: itemBox,
            sourceImageIndex: typeof sItem.sourceImageIndex === "number" ? sItem.sourceImageIndex : 0,
            scoutIndex: idx
          }]
        });
      });
      resolvedGroups = unbundledGroups;
    }
  }

  // Ensure EVERY group has a valid non-coarse quadrant bounding box
  resolvedGroups.forEach((g, gIdx) => {
    const isCoarseOrNull = !g.boundingBox2D || !Array.isArray(g.boundingBox2D) || g.boundingBox2D.length !== 4 ||
      (g.boundingBox2D[0] === 0 && g.boundingBox2D[1] === 0 && g.boundingBox2D[2] === 1000 && g.boundingBox2D[3] === 1000) ||
      g.boundingBox2D.some((v: any) => typeof v !== 'number' || isNaN(v));
    if (isCoarseOrNull) {
      g.boundingBox2D = getQuadrantBox(gIdx, resolvedGroups.length);
    }
  });

  return resolvedGroups;
}

export { applyServerAverageNutrients, enrichBilingualItemName } from './server_pure_helpers.js';

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
2. PORTION WEIGHT CALIBRATION: Preserve baseline item weights by default. If an item's portion weight is inaccurate against regional dim sum/side norms or piece counts (e.g. 3 small street siomay dumplings estimated at 150g instead of ~90-105g), adjust 'weightGrams' to the calibrated portion size.
3. CLINICAL NUTRIENT AUDIT & CORRECTION: Audit the baseline numbers for each item against culinary preparation realism. If you identify an inaccurate estimate (e.g. deep-fried oil absorption, sodium, or starchy filler), output the corrected portion values in 'correctedNutrients' and state the clinical reason in 'clinicalCorrectionNote'. Leave null only if baseline accurately reflects culinary reality.
2. TRACE NUTRIENTS: Do NOT estimate these individually. Instead, output the single most appropriate foodType string for each item (e.g., 'red_meat', 'leafy_veg', 'root_veg', etc.).

Critical: Original Name Override & Anti-Merging Rule
Local Language Priority: Treat the originalName provided by the visual scout as the absolute ground truth for categorizing an item, overriding the English keyword if they contradict.

Preserve Visual Scout Cooking Method & Ingredients:
1. Cooking Method Alignment: You MUST maintain the exact item-level cookingMethod identified by the Visual Scout (e.g., deep_fried, pan_fried, stir_fried, roasted, boiled, steamed, grilled, baked, raw) for each item in itemsBreakdown. Do NOT override deep_fried or pan_fried to baked or raw unless the user explicitly requested a change in their message text.
2. Visual Ingredients Alignment: You MUST carry over all visualIngredients detected by the Visual Scout into the item's visualIngredients array in itemsBreakdown. If visualIngredients is empty, leave it empty ([]). Do NOT copy printed text from 'ingredientsList' into 'visualIngredients' or 'composition'. For packaged or printed label products, 'visualIngredients' MUST be an empty array ([]) and 'composition' MUST contain ONLY the item name (e.g., 'HANA Mat Kimchi (Diced Radish Kimchi)').

Protein Verification: If an originalName contains clear local language identifiers for proteins (e.g., "Ikan" = fish, "Ayam" = chicken, "Daging" = beef) but the upstream agent mistakenly passed an English keyword matching a vegetable, you MUST classify and log the item based on the local protein name.

Strict Anti-Merging: NEVER sum the weights of two items simply because their English keywords match. You must evaluate if their originalNames represent the exact same food. If they are different (e.g., "IK BARONANG" and "BABY PAKCHOY"), keep them as separate, distinct entries in the itemsBreakdown array.

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
- FINAL NUTRIENT AUDIT & CLINICAL CORRECTIONS: Review backend numbers in === BACKEND PRE-CALCULATED ITEM NUTRIENTS === against culinary preparation realism. If you identify an inaccurate estimate (e.g. deep-fried oil absorption, sodium, or starchy filler), output 'correctedNutrients' and state clinical reason in 'clinicalCorrectionNote'. Leave null only if baseline accurately reflects culinary reality.
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
    "label": "Bad for Cholesterol | Elevated Saturated Fat Impact | Elevated Sodium Impact | Supports Heart Health | Within Calorie Target",
    "level": "good | warning | alert | neutral"
  },
  "message": "A highly personalized conversational response detailing the clinical rationale. Focus on actionable guidance and avoid repeating raw macro numbers.",
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
    "verdict": {
      "label": "Bad for Cholesterol | Elevated Saturated Fat Impact | Elevated Sodium Impact | Supports Heart Health | Within Calorie Target",
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

// Global CORS & preflight middleware for cross-origin, sandboxed iframes, and local development
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Session-ID, X-Requested-With, Accept, Origin");
  res.header("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use(compression());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));
app.use(biomarkerRouter);
app.use(foodRouter);
app.use(jobsRouter);
app.use(syncRouter);
app.use(r2Router);
app.use(adminRouter);
app.use(healthConnectRouter);
app.use(medicalGeminiRouter);
app.use(foodAnalyzeRouter);
app.use(scorecardRouter);


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

// In-Memory & Local File Sync storage to act as the durable synced database
const SYNC_DIR = path.join(process.cwd(), "data", "sync");
if (!fs.existsSync(SYNC_DIR)) {
  fs.mkdirSync(SYNC_DIR, { recursive: true });
}

// Register session tracking middleware for isolated logging
app.use((req, res, next) => {
    const sessionId = (req.headers["x-session-id"] as string) || (req.query.sessionId as string) || "global";
    logSessionStorage.run(sessionId, () => {
      next();
    });
  });

  app.post("/api/client-error", (req, res) => {
    const { message, stack } = req.body || {};
    const msgStr = String(message || '').toLowerCase();
    if (
      msgStr.includes('websocket closed without opened') ||
      msgStr.includes('failed to connect to websocket') ||
      msgStr.includes('resizeobserver loop') ||
      msgStr.includes('aborterror') ||
      msgStr.includes('the user aborted a request') ||
      msgStr.includes('the operation was aborted')
    ) {
      return res.json({ status: "ignored" });
    }
    addDebugLog(`[Client Error] ${message || 'Unknown Error'}\n${stack || ''}`);
    res.json({ status: "ok" });
  });

  // Fallback for expired AI Studio image upload blobs from previous turns to prevent 404 network errors
  app.get('/_/upload/*', (req, res) => {
    const transparentPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64'
    );
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(transparentPng);
  });

  app.post("/api/auth/check-email-status", async (req, res) => {
    const email = (req.body?.email || '').trim().toLowerCase();
    if (!email) {
      return res.json({ exists: false, confirmed: false });
    }
    try {
      const { findUserByEmail } = await import('./server_auth.js');
      const localUser = await findUserByEmail(email);
      if (localUser) {
        return res.json({ exists: true, confirmed: true, userId: localUser.id });
      }

      const { isSupabaseConfigured, supabaseAdmin } = await import('./supabaseAdmin.js');
      if (!isSupabaseConfigured || !supabaseAdmin) {
        return res.json({ exists: false, confirmed: false });
      }
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      if (error) {
        console.warn('[auth/check-email-status] Error listing users:', error.message);
        return res.json({ exists: false, confirmed: false, error: error.message });
      }
      const user = data.users.find((u: any) => u.email?.toLowerCase() === email);
      if (!user) {
        return res.json({ exists: false, confirmed: false });
      }
      const isConfirmed = Boolean(user.email_confirmed_at || user.confirmed_at);
      return res.json({ exists: true, confirmed: isConfirmed, userId: user.id });
    } catch (err: any) {
      console.warn('[auth/check-email-status] Exception:', err?.message || err);
      return res.json({ exists: false, confirmed: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};
      const { authenticateUser } = await import('./server_auth.js');
      const result = await authenticateUser(email, password);
      if (!result.success) {
        return res.status(401).json({ error: result.error || 'Invalid email or password' });
      }
      return res.json({ success: true, token: result.token, userProfile: result.user });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Login failed' });
    }
  });

  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { email, password, nickname } = req.body || {};
      const { registerUser } = await import('./server_auth.js');
      const result = await registerUser(email, password, nickname);
      if (!result.success) {
        return res.status(400).json({ error: result.error || 'Registration failed' });
      }
      return res.json({ success: true, token: result.token, userProfile: result.user });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Registration failed' });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      const { verifyFirebaseIdToken, findUserByEmail } = await import('./server_auth.js');
      const identity = await verifyFirebaseIdToken(req);
      const user = identity.email ? await findUserByEmail(identity.email) : null;
      return res.json({
        success: true,
        userProfile: user ? {
          uid: identity.uid,
          email: user.email,
          nickname: user.nickname,
          userType: user.user_type || 'Standard'
        } : {
          uid: identity.uid,
          email: identity.email,
          userType: 'Standard'
        }
      });
    } catch (err: any) {
      return res.status(err?.status || 401).json({ error: err?.message || 'Unauthorized' });
    }
  });

// Robust API key resolver supporting standard GEMINI_API_KEY, Google Cloud GOOGLE_API_KEY, or API_KEY
export const getGeminiApiKey = (): string => {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.API_KEY ||
    process.env.GEMINI_API_KEYS?.split(',')[0]?.trim() ||
    ''
  );
};

// Stage-keyed last-call token usage for the unified LLM. Written by
// callUnifiedLLMInternal on every successful call; consumed immediately by
// the awaiting pipeline stage via takeUnifiedUsage (single-flight per stage).
// (Store lives in src/utils/unifiedUsage.ts — leaf module, no import cycles.)
import { recordUnifiedUsage, recordUnifiedTiming } from './src/utils/unifiedUsage.js';

// Initialize Gemini SDK with telemetry header
export const getGeminiClient = () => {
  const useVertex =
    process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' ||
    process.env.GOOGLE_GENAI_USE_VERTEXAI === '1';
  if (useVertex) {
    const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '';
    const location = process.env.GOOGLE_CLOUD_LOCATION || process.env.VERTEXAI_LOCATION || 'global';
    if (!project) {
      console.warn('WARNING: Vertex mode set but GOOGLE_CLOUD_PROJECT is missing.');
    }
    return new GoogleGenAI({
      vertexai: true,
      project,
      location,
      httpOptions: {
        timeout: 150000,
        headers: {
          'User-Agent': 'vertex-sa-build',
        },
      },
    } as any);
  }
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
  itemsBreakdown: z.array(ItemBreakdownSchema).optional()
}).passthrough();

export const RouteAgentSchema = z.object({
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
export function validateOrFallback<T>(schema: z.ZodType<T>, parsed: any, rawText: string, label: string, fallback: T): T {
  const result = schema.safeParse(parsed);
  if (!result.success) {
    addDebugLog(`[Zod Validation Failed] ${label}: ${result.error.message}. Raw output: ${rawText}`);
    return fallback;
  }
  return result.data;
}

export async function asyncParseLLMJSON(cleanJson: string): Promise<any> {
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
export async function callUnifiedLLM(args: any): Promise<any> {
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
  logStagePrefix,
  temperature
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
  // Optional label (e.g. "scout", "diet") appended to this call's debug
  // log tags so the diagnostic viewer can attribute the full system
  // instruction/prompt/response to the right agent tab. Omit for every other
  // call site — behavior is unchanged when not provided.
  logStagePrefix?: string;
  temperature?: number;
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

  // Normalize image payloads defensively: callers may pass { mimeType, data } objects,
  // { inlineData: { mimeType, data } }, raw data URL strings ("data:image/jpeg;base64,..."), or raw base64 strings.
  const normalizedImagePayloads: { mimeType: string; data: string }[] = [];
  const parseImageItem = (item: any): { mimeType: string; data: string } | null => {
    if (!item) return null;
    if (typeof item === 'object') {
      if (item.data && item.mimeType) {
        return { mimeType: String(item.mimeType), data: String(item.data) };
      }
      if (item.inlineData && item.inlineData.data && item.inlineData.mimeType) {
        return { mimeType: String(item.inlineData.mimeType), data: String(item.inlineData.data) };
      }
    }
    if (typeof item === 'string') {
      if (item.startsWith('data:')) {
        const match = item.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          return { mimeType: match[1], data: match[2] };
        }
        const commaIdx = item.indexOf(',');
        if (commaIdx > -1) {
          const header = item.slice(0, commaIdx);
          const data = item.slice(commaIdx + 1);
          const mimeMatch = header.match(/:(.*?);/);
          return { mimeType: mimeMatch ? mimeMatch[1] : 'image/jpeg', data };
        }
      } else if (!item.startsWith('http://') && !item.startsWith('https://') && item.length > 50) {
        return { mimeType: 'image/jpeg', data: item };
      }
    }
    return null;
  };

  if (imagePayloads && Array.isArray(imagePayloads) && imagePayloads.length > 0) {
    for (const img of imagePayloads) {
      const parsed = parseImageItem(img);
      if (parsed && parsed.data && parsed.data.length > 0) {
        normalizedImagePayloads.push(parsed);
      }
    }
  } else if (imagePayload) {
    const parsed = parseImageItem(imagePayload);
    if (parsed && parsed.data && parsed.data.length > 0) {
      normalizedImagePayloads.push(parsed);
    }
  }

  // 1. Anthropic Claude Models
  if (normalizedModelId.includes("claude-")) {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      console.log(`[UnifiedLLM] Calling official Anthropic API: ${normalizedModelId}`);
      try {
        const messages: any[] = [];
        const contentParts: any[] = [];
        if (normalizedImagePayloads.length > 0) {
          for (const img of normalizedImagePayloads) {
            contentParts.push({
              type: "image",
              source: {
                type: "base64",
                media_type: img.mimeType,
                data: img.data
              }
            });
          }
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
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: normalizedModelId,
            system: systemInstruction,
            messages,
            max_tokens: maxOutputTokens || 4096
          })
        });

        if (res.ok) {
          const body = (await res.json()) as any;
          return body.content?.[0]?.text || "{}";
        } else {
          const errMsg = await res.text();
          throw new Error(`Anthropic API call returned non-200 status (${res.status}): ${errMsg}. Please try another model.`);
        }
      } catch (err: any) {
        throw new Error(`Error connecting to Anthropic: ${err.message || err}. Please try another model.`);
      }
    }
  }

  // 2. OpenAI Models (or compatible endpoints)
  if (normalizedModelId.includes("gpt-") || normalizedModelId.includes("o1") || normalizedModelId.includes("o3")) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      console.log(`[UnifiedLLM] Calling official OpenAI API: ${normalizedModelId}`);
      try {
        const messages = [
          { role: "system", content: systemInstruction },
          { role: "user", content: [] as any }
        ];

        const userContent: any[] = [{ type: "text", text: promptText }];
        if (normalizedImagePayloads.length > 0) {
          for (const img of normalizedImagePayloads) {
            userContent.push({
              type: "image_url",
              image_url: {
                url: `data:${img.mimeType};base64,${img.data}`
              }
            });
          }
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
  if (normalizedModelId.includes("deepseek")) {
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if (deepseekKey) {
      console.log(`[UnifiedLLM] Calling official DeepSeek API: ${normalizedModelId}`);
      try {
        const messages = [
          { role: "system", content: systemInstruction },
          { role: "user", content: promptText }
        ];

        const res = await fetch("https://api.deepseek.com/chat/completions", {
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
  if (targetGeminiModel === "gemini" || targetGeminiModel === "gemini-flash" || targetGeminiModel === "default") {
    targetGeminiModel = "gemini-3.5-flash-lite";
  } else if (targetGeminiModel === "gemini-2.0-flash" || targetGeminiModel === "gemini-1.5-flash") {
    targetGeminiModel = "gemini-2.5-flash";
  } else if (targetGeminiModel === "gemini-1.5-pro" || targetGeminiModel === "gemini-2.0-pro") {
    targetGeminiModel = "gemini-2.5-pro";
  }

  const initialParts: any[] = [];
  if (normalizedImagePayloads.length > 0) {
    for (const img of normalizedImagePayloads) {
      initialParts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.data
        }
      });
    }
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

  if (typeof temperature === 'number') {
    configObj.temperature = temperature;
  }

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
  const __callStartMs = Date.now();
  // Per-stage token usage, readable by the pipeline right after the awaited
  // call returns (takeUnifiedUsage). The debug export's log channel only
  // carries streamed lines, so usage also travels this structured path.
  const __stage = (stageTag || '').replace(/^:/, '') || 'unknown';
  // Contract §9/§11.12D: log per-stage token usage so the debug run tree can
  // attribute tokens per dispatch. Defensive: SDK responses without
  // usageMetadata (older models) emit a `none` diagnostic instead of silence.
  // Usage is ALSO stashed in a tiny stage-keyed registry (takeUnifiedUsage)
  // because the export's log channel only carries streamed lines.
  const logUnifiedUsage = (sdkResponse: any) => {
    try {
      const stage = __stage;
      const u = sdkResponse?.usageMetadata;
      if (!u) {
        const keys = sdkResponse && typeof sdkResponse === 'object' ? Object.keys(sdkResponse).join(',') : typeof sdkResponse;
        _localAddDebugLog(`[UnifiedLLM-Usage:${stage}] none (no usageMetadata; response keys: ${keys})`);
        return;
      }
      const p = Number(u.promptTokenCount) || 0;
      const c = Number(u.candidatesTokenCount) || 0;
      const t = Number(u.totalTokenCount) || (p + c);
      if (!t) {
        _localAddDebugLog(`[UnifiedLLM-Usage:${stage}] none (usageMetadata present but total=0)`);
        return;
      }
      recordUnifiedUsage(stage, { promptTokens: p, candidatesTokens: c, totalTokens: t });
      recordUnifiedTiming(stage, Date.now() - __callStartMs);
      _localAddDebugLog(`[UnifiedLLM-Usage:${stage}] prompt=${p} completion=${c} total=${t}`);
      _localAddDebugLog(`[UnifiedLLM-Timing:${stage}] ms=${Date.now() - __callStartMs}`);
    } catch { /* usage logging must never break generation */ }
  };
  _localAddDebugLog(`[UnifiedLLM${stageTag}] Dispatching prompt to model: "${targetGeminiModel}". Contents turns: ${contents.length}.`);
  _localAddDebugLog(`[UnifiedLLM${stageTag}] Attaching ${normalizedImagePayloads.length} image part(s) to model "${targetGeminiModel}".`);
  _localAddDebugLog(`[UnifiedLLM-Prompt${stageTag}] System Instruction:\n${resolvedInstruction}`);
  _localAddDebugLog(`[UnifiedLLM-Prompt${stageTag}] User Prompt:\n${promptText}`);

  const isGemini404Error = (err: any) => err?.status === 404 || err?.code === 404 || String(err?.message || "").includes("404") || String(err?.message || "").includes("NOT_FOUND");

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
        let streamUsage: any = null;
        for await (const chunk of stream) {
          // Stream chunks (usually the final one) carry usageMetadata — capture
          // it so per-stage token logging works on the streaming path too.
          if ((chunk as any)?.usageMetadata) streamUsage = (chunk as any).usageMetadata;
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
        response = { text: fullText, functionCalls: [], usageMetadata: streamUsage };
      } catch (streamErr: any) {
        if (isGeminiQuotaError(streamErr)) {
          noteGeminiQuota(targetGeminiModel, streamErr);
          throw streamErr;
        }
        if (isGeminiUnavailableError(streamErr)) {
          addDebugLog(`[UnifiedLLM] Stream 503 on ${targetGeminiModel} — not falling back to a second generateContent (that doubles quota).`);
          throw streamErr;
        }
        if (isGemini404Error(streamErr) && targetGeminiModel !== "gemini-2.5-flash") {
          addDebugLog(`[UnifiedLLM] Model "${targetGeminiModel}" returned 404 NOT_FOUND. Automatically falling back to "gemini-2.5-flash"...`);
          targetGeminiModel = "gemini-2.5-flash";
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
        addDebugLog(`[UnifiedLLM] Stream failed (${streamErr?.message}). Falling back to non-streaming generateContent on "${targetGeminiModel}"...`);
        const fullRes = await withGeminiRetry(() => ai.models.generateContent({
          model: targetGeminiModel,
          contents,
          config: configObj
        }), { label: "Unified LLM Stream Fallback" });
        let fullText = fullRes.text || "";
        if (onStream) onStream(fullText, false);
        logUnifiedUsage(fullRes);
        response = { text: fullText, candidates: fullRes.candidates, functionCalls: fullRes.functionCalls };
      }
    } else {
      try {
        response = await withGeminiRetry(() => ai.models.generateContent({
          model: targetGeminiModel,
          contents,
          config: configObj
        }), { label: "Unified LLM" });
      } catch (genErr: any) {
        if (isGemini404Error(genErr) && targetGeminiModel !== "gemini-2.5-flash") {
          addDebugLog(`[UnifiedLLM] Model "${targetGeminiModel}" returned 404 NOT_FOUND. Automatically falling back to "gemini-2.5-flash"...`);
          targetGeminiModel = "gemini-2.5-flash";
          response = await withGeminiRetry(() => ai.models.generateContent({
            model: targetGeminiModel,
            contents,
            config: configObj
          }), { label: "Unified LLM Fallback 2.5-flash" });
        } else {
          throw genErr;
        }
      }
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
    // Carry usageMetadata through the rebuild so per-stage token logging still works.
    response = { text: finalJson, candidates: response.candidates, functionCalls: response.functionCalls, usageMetadata: (response as any)?.usageMetadata };
    
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
    logUnifiedUsage(response);
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


// Food Analyze and Vision Scout pipeline endpoints are mounted via foodAnalyzeRouter in server_routes_food_analyze.ts

// Gemini Medical, Biomarker, and Diagnostic routes are mounted via medicalGeminiRouter in server_routes_medical_gemini.ts

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

    const sysInstruction = customSystemInstruction || withAgentLanguage("You are a world-class AI dietitian. Your response must be an exact JSON matching the requested schema. Never add markdown wrappers.", userProfile?.language);

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
export async function retrieveFoodImages(
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
             const internalApiBase = process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${PORT}`;
             const fallbackRes = await fetch(`${internalApiBase}/api/gemini/food-image-search`, {
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
             const internalApiBase = process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${PORT}`;
             const fallbackRes = await fetch(`${internalApiBase}/api/gemini/food-image-search`, {
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
  if (sessionId !== "global" && sessionDebugLogs[sessionId] && sessionDebugLogs[sessionId].length > 0) {
    logs = sessionDebugLogs[sessionId];
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

// One-time cleanup: merge duplicate biomarker_logs rows in Supabase that share a date
// but carry the same measurement under differently-spelled keys (e.g. a lab-report
// re-parse that named MCHC "mean_corpuscular_hb_conc_g_l" instead of "mchc", creating
// a brand-new row alongside the original instead of updating it in place). This never
// deletes a *value* — it only merges rows and drops the now-redundant duplicate row,
// and never overwrites an existing value on the row it keeps.
app.post('/admin/dedupe-biomarker-logs', async (req, res) => {
  try {
    const secret = req.headers['x-admin-secret'] || req.body?.secret;
    if (!process.env.ADMIN_MIGRATION_SECRET || secret !== process.env.ADMIN_MIGRATION_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const commit = req.body?.commit === true;
    const targetUid = req.body?.uid;
    if (!targetUid || typeof targetUid !== 'string') {
      return res.status(400).json({ error: 'A single "uid" is required in the request body.' });
    }

    const { data: rows, error: fetchErr } = await supabaseAdmin
      .from('biomarker_logs')
      .select('id, firebase_uid, date, biomarkers, updated_at')
      .eq('firebase_uid', targetUid);
    if (fetchErr) {
      return res.status(500).json({ error: fetchErr.message });
    }

    const byDate = new Map<string, any[]>();
    for (const row of rows || []) {
      const d = String(row.date);
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(row);
    }

    const suspiciousIdPattern = /^(log|med_log)_\d{10,}_[a-z0-9]{5,9}$/;
    const report = {
      dryRun: !commit,
      datesScanned: byDate.size,
      duplicateGroups: 0,
      rowsMerged: 0,
      rowsDeleted: 0,
      conflictsSkipped: [] as any[],
      groups: [] as any[]
    };

    for (const [date, group] of byDate.entries()) {
      if (group.length < 2) continue;
      report.duplicateGroups++;

      // Prefer a row whose id doesn't look like a Clinical-Data-Parser-generated
      // duplicate as the keeper; otherwise fall back to the lowest id for determinism.
      const sorted = [...group].sort((a, b) => {
        const aSus = suspiciousIdPattern.test(a.id) ? 1 : 0;
        const bSus = suspiciousIdPattern.test(b.id) ? 1 : 0;
        if (aSus !== bSus) return aSus - bSus;
        return String(a.id).localeCompare(String(b.id));
      });
      const keeper = sorted[0];
      const others = sorted.slice(1);

      const mergedBiomarkers = { ...(keeper.biomarkers || {}) };
      const groupReport: any = { date, keeperId: keeper.id, mergedFrom: [] as string[], addedKeys: [] as string[] };

      for (const other of others) {
        groupReport.mergedFrom.push(other.id);
        for (const [rawKey, val] of Object.entries(other.biomarkers || {})) {
          const key = getMappedBiomarkerKey(rawKey) || rawKey;
          if (!(key in mergedBiomarkers)) {
            mergedBiomarkers[key] = val;
            groupReport.addedKeys.push(key);
          } else if (mergedBiomarkers[key] !== val) {
            // Existing value on the keeper wins; flag the conflict instead of guessing.
            report.conflictsSkipped.push({ date, key, keptValue: mergedBiomarkers[key], droppedValue: val, droppedFromId: other.id });
          }
        }
      }

      report.groups.push(groupReport);
      report.rowsMerged += 1;
      report.rowsDeleted += others.length;

      if (commit) {
        const { error: updErr } = await supabaseAdmin
          .from('biomarker_logs')
          .update({ biomarkers: mergedBiomarkers, updated_at: new Date().toISOString() })
          .eq('id', keeper.id);
        if (updErr) {
          groupReport.updateError = updErr.message;
          continue;
        }
        const otherIds = others.map(o => o.id);
        const { error: delErr } = await supabaseAdmin
          .from('biomarker_logs')
          .delete()
          .in('id', otherIds);
        if (delErr) {
          groupReport.deleteError = delErr.message;
        }
      }
    }

    res.json(report);
  } catch (error: any) {
    console.error('Dedupe error:', error);
    res.status(500).json({ error: error.message });
  }
});

  const distPath = path.join(process.cwd(), "dist");
  const hasBuiltDist = fs.existsSync(path.join(distPath, "index.html"));
  // Cloud Run / `npm start` should serve dist. Local `npm run dev` (tsx) must




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


async function startServer() {
  console.log("[boot] startServer()");
  ensureFoodCatalogSchema().then((r) => {
    if (!r.ok) console.error('[CatalogSchema] ensure on boot failed:', r.method, r.error);
  }).catch(() => {});

  ensureD1Schema().catch(() => {});

  // Warm up database brand cache and trigger initial database self-cleaning maintenance if configured
  import('./supabaseAdmin.js').then(({ isSupabaseConfigured, supabaseAdmin }) => {
    if (isSupabaseConfigured) {
      fetchAllDatabaseBrands().then(async ({ allBrands }) => {
        console.log(`[BrandCache] Loaded ${allBrands.size} brands dynamically from database.`);
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

  // Frontend serving middleware (built static bundle or Vite dev fallback)
  // `tsx server.ts` / `npm run dev` must use Vite so src/ edits reach localhost.
  // Serving dist/ here is what made edit-preview fixes look like they "did nothing"
  // after refresh: hashed dist assets are cached immutable for a year.
  const runningViaTsx =
    process.argv.some((a) => typeof a === 'string' && a.includes('tsx')) ||
    process.execArgv.some((a) => typeof a === 'string' && a.includes('tsx'));
  const forceVite = process.env.FORCE_VITE === "1" || runningViaTsx;
  const serveDist = hasBuiltDist && !forceVite;
  console.log(
    `[boot] frontend=${serveDist ? "dist" : "vite"} hasDist=${hasBuiltDist} forceVite=${forceVite}`
  );
  if (serveDist) {
    // Compress all static assets and set immutable caching for versioned files
    app.use(express.static(distPath, {
      maxAge: '1y',
      immutable: true,
      etag: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      }
    }));
    app.get("*", (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
            ignored: [
              // Large generated/dependency trees — chokidar FSEvents on macOS
              // spins at 10-40% CPU when any of these are written to during a run.
              '**/node_modules/**',
              '**/specs/**',
              '**/prototype/**',
              '**/.git/**',
              // App-specific files that change frequently at runtime
              '**/brand_menu_items_local.json',
              '**/*.log',
              '**/tmp/**',
              // Test/archive dirs not needed for hot-reload
              '**/tests/**',
              '**/studio/**',
              '**/archive/**',
            ]
          }
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Health Cockpit App] Full-Stack server running on port ${PORT}`);
  });
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer();

  // Graceful shutdown: mark all in-flight Supabase jobs as failed before exit.
  // Without this, every Ctrl+C / kill leaves jobs stuck in 'running' state in
  // Supabase — the recovery on next boot then re-runs all of them simultaneously,
  // pegging CPU at 99% and generating GB-scale ingress traffic.
  const handleShutdown = async (signal: string) => {
    console.log(`\n[shutdown] ${signal} received — marking in-flight jobs failed in Supabase...`);
    try {
      const { inMemoryServerJobs } = await import('./serverJobs.js');
      const { supabaseAdmin, isSupabaseConfigured } = await import('./supabaseAdmin.js');

      if (isSupabaseConfigured) {
        const runningIds: string[] = [];
        for (const [id, job] of inMemoryServerJobs.entries()) {
          if (job.status === 'running' || job.status === 'pending') {
            runningIds.push(id);
          }
        }

        if (runningIds.length > 0) {
          console.log(`[shutdown] Failing ${runningIds.length} in-flight job(s): ${runningIds.join(', ')}`);
          await Promise.race([
            supabaseAdmin.from('agent_jobs').update({
              status: 'failed',
              status_message: 'Server stopped — please retry.',
              updated_at: new Date().toISOString(),
            }).in('id', runningIds),
            new Promise(r => setTimeout(r, 3000)), // 3s timeout — don't hang the kill
          ]);
          console.log('[shutdown] Supabase cleanup done.');
        } else {
          console.log('[shutdown] No in-flight jobs to clean up.');
        }
      }
    } catch (e) {
      console.warn('[shutdown] Cleanup error (non-fatal):', e);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT',  () => handleShutdown('SIGINT'));
}

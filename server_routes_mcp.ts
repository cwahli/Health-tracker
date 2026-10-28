import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { verifySessionToken } from './server_auth.js';
import { isD1Configured } from './server_d1.js';
import {
  d1GetProfile,
  d1UpsertProfile,
  d1QueryFoods,
  d1GetFullFoodRecord,
  d1QueryBiomarkers
} from './server_db_d1.js';
import { getBaseUrl, resolveCanonicalUid } from './server_routes_mcp_auth.js';
import { biomarkerDefinitions } from './src/utils/biomarkers.js';
import { applyRecordAction, projectRead, publicBiomarkerMap, userMarkerKeys } from './src/utils/recordProjection.js';
import {
  inMemoryMcpProfiles,
  inMemoryMcpFoods,
  inMemoryMcpBiomarkers,
  setInMemoryProfile,
  clearInMemoryProfiles,
  setInMemoryFoods,
  setInMemoryBiomarkers,
  clearInMemoryMcpStores,
  getCurrentDateInTimezone,
  getYesterdayYYYYMMDD,
  getYesterdayInTimezone,
  formatTimeInTimezone,
  toYYYYMMDD,
  loadUserProfile,
  finalizeAndCreateMeal,
  editMealWithPatch,
  deleteMealLog,
  upsertBiomarkerEntry,
  deleteBiomarkerEntry,
  manageUserActions,
  manageUserHabits,
  withIdempotency,
  clearIdempotencyStore,
  saveProjectedBiomarkerRows
} from './src/server/domain/healthTrackerDomain.js';

export {
  inMemoryMcpProfiles,
  inMemoryMcpFoods,
  inMemoryMcpBiomarkers,
  setInMemoryProfile,
  clearInMemoryProfiles,
  setInMemoryFoods,
  setInMemoryBiomarkers,
  clearInMemoryMcpStores,
  getCurrentDateInTimezone,
  getYesterdayYYYYMMDD,
  getYesterdayInTimezone,
  formatTimeInTimezone,
  toYYYYMMDD,
  loadUserProfile,
  finalizeAndCreateMeal,
  editMealWithPatch,
  deleteMealLog,
  upsertBiomarkerEntry,
  deleteBiomarkerEntry,
  manageUserActions,
  manageUserHabits,
  withIdempotency,
  clearIdempotencyStore
};

// Backward-compatible aliases
export const setInMemoryMcpProfile = setInMemoryProfile;
export const clearInMemoryMcpProfiles = clearInMemoryProfiles;
export const setInMemoryMcpFoods = setInMemoryFoods;
export const setInMemoryMcpBiomarkers = setInMemoryBiomarkers;
export const clearInMemoryMcpData = clearInMemoryMcpStores;

export const mcpRouter = Router();

export interface McpUserContext {
  uid: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      mcpUser?: McpUserContext;
    }
  }
}

export function resolvePossibleUids(uid?: string, email?: string): string[] {
  const cleanEmail = (email || '').toLowerCase().trim();
  const cleanUid = (uid || '').trim();
  const normalizedEmailUid = cleanEmail ? 'admin_' + cleanEmail.replace(/[^a-z0-9]/gi, '_') : null;
  const isCwah = cleanEmail.includes('cwah.liu') || cleanEmail.includes('chiwah.liu') ||
                 cleanUid.includes('cwah_liu') || cleanUid.includes('chiwah_liu') ||
                 cleanUid === 'hiJun2hTdDTk2igwerun2LKvwb42';
  return Array.from(new Set([
    cleanUid,
    cleanEmail,
    normalizedEmailUid,
    isCwah ? 'hiJun2hTdDTk2igwerun2LKvwb42' : null,
    isCwah ? 'cwah.liu@gmail.com' : null,
    isCwah ? 'chiwah.liu@gmail.com' : null,
    isCwah ? 'admin_cwah_liu_gmail_com' : null,
    isCwah ? 'admin_chiwah_liu_gmail_com' : null
  ].filter(Boolean) as string[]));
}

export function formatPhotoUrls(imageUrls: any): string[] {
  if (!imageUrls) return [];
  const list = Array.isArray(imageUrls) ? imageUrls : [imageUrls];
  return list.map((u: any) => {
    if (!u || typeof u !== 'string') return '';
    const trimmed = u.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    if (trimmed.startsWith('/photos/')) return `https://health-tracker.co.uk${trimmed}`;
    if (trimmed.startsWith('photos/')) return `https://health-tracker.co.uk/${trimmed}`;
    return `https://health-tracker.co.uk/photos/${trimmed}`;
  }).filter(Boolean);
}

export function parseNumericTarget(val: any, fallback: number): number {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'number') return isNaN(val) ? fallback : val;
  const str = String(val).replace(/,/g, '').trim();
  const match = str.match(/[-+]?\d*\.?\d+/);
  if (!match) return fallback;
  const parsed = parseFloat(match[0]);
  return isNaN(parsed) ? fallback : parsed;
}

export function mergeTargetsWithRatchet(
  existingTargets: Record<string, any> = {},
  incomingTargets: Record<string, any> = {},
  existingTimestamps: Record<string, number> = {},
  incomingTimestamps: Record<string, number> = {},
  fallbackIncomingTs: number = 0
): { targets: Record<string, any>; targetTimestamps: Record<string, number> } {
  const mergedTargets: Record<string, any> = { ...existingTargets };
  const mergedTimestamps: Record<string, number> = { ...existingTimestamps };

  for (const [key, val] of Object.entries(incomingTargets)) {
    const existTs = existingTimestamps[key] || 0;
    const inTs = incomingTimestamps[key] || fallbackIncomingTs;

    if (inTs >= existTs) {
      mergedTargets[key] = val;
      mergedTimestamps[key] = inTs;
    }
  }

  return { targets: mergedTargets, targetTimestamps: mergedTimestamps };
}

// ---------------------------------------------------------------------------
// Authentication Middleware (RFC 9728 Challenge)
// ---------------------------------------------------------------------------

const MCP_PATHS = ['/api/mcp', '/mcp'];

mcpRouter.use(MCP_PATHS, (req: Request, res: Response, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const baseUrl = getBaseUrl(req);
    res.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", error="invalid_token", error_description="Bearer token required"`
    );
    return res.status(401).json({
      jsonrpc: '2.0',
      id: req.body?.id ?? null,
      error: {
        code: -32000,
        message: 'Unauthorized: Bearer token required'
      }
    });
  }

  const token = authHeader.substring(7).trim();
  const session = verifySessionToken(token);

  if (!session || !session.uid) {
    const baseUrl = getBaseUrl(req);
    res.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", error="invalid_token", error_description="Invalid or expired token"`
    );
    return res.status(401).json({
      jsonrpc: '2.0',
      id: req.body?.id ?? null,
      error: {
        code: -32000,
        message: 'Unauthorized: Invalid or expired Bearer token'
      }
    });
  }

  const canonicalUid = resolveCanonicalUid(session.uid, session.email);
  req.mcpUser = {
    uid: canonicalUid,
    email: session.email
  };
  next();
});

// ---------------------------------------------------------------------------
// Data Fetchers & Aggregators
// ---------------------------------------------------------------------------

async function getAllUserFoods(possibleUids: string[]): Promise<any[]> {
  const foodsMap = new Map<string, any>();

  // 1. In-memory items
  for (const uid of possibleUids) {
    const memList = inMemoryMcpFoods.get(uid);
    if (Array.isArray(memList)) {
      for (const item of memList) {
        if (item && item.id) foodsMap.set(item.id, item);
      }
    }
  }

  // 2. D1 database items
  if (isD1Configured()) {
    try {
      const d1Foods = await d1QueryFoods(possibleUids, 500);
      for (const item of d1Foods) {
        if (item && item.id && !foodsMap.has(item.id)) {
          foodsMap.set(item.id, item);
        }
      }
    } catch (err: any) {
      console.warn('[MCP] d1QueryFoods error:', err?.message);
    }
  }

  return Array.from(foodsMap.values());
}

async function getAllUserBiomarkers(possibleUids: string[]): Promise<any[]> {
  const bioMap = new Map<string, any>();

  // 1. In-memory items
  for (const uid of possibleUids) {
    const memList = inMemoryMcpBiomarkers.get(uid);
    if (Array.isArray(memList)) {
      for (const item of memList) {
        if (item && item.id) bioMap.set(item.id, item);
      }
    }
  }

  // 2. D1 database items
  if (isD1Configured()) {
    try {
      const d1Bios = await d1QueryBiomarkers(possibleUids, 200);
      for (const item of d1Bios) {
        if (item && item.id && !bioMap.has(item.id)) {
          bioMap.set(item.id, item);
        }
      }
    } catch (err: any) {
      console.warn('[MCP] d1QueryBiomarkers error:', err?.message);
    }
  }

  return Array.from(bioMap.values());
}

function computeDayAllowance(targetDate: string, allMeals: any[], targets: any, timezone?: string) {
  const userTz = timezone || 'Europe/London';
  const dayMeals = allMeals.filter((m) => toYYYYMMDD(m.date, userTz) === targetDate);

  const targetCalories = parseNumericTarget(
    targets.calories ?? targets.calorieTarget ?? targets.dailyNutrientTargets?.calories,
    1651
  );
  const targetSatFat = parseNumericTarget(targets.saturatedFat ?? targets.satFat, 15);
  const targetFiber = parseNumericTarget(targets.totalFibre ?? targets.fiber ?? targets.fibre, 30);
  const targetSodium = parseNumericTarget(targets.sodium, 1500);
  const targetProtein = parseNumericTarget(targets.protein, 70);
  const targetCarbs = parseNumericTarget(targets.carbohydrates ?? targets.carbs, 200);
  const targetFat = parseNumericTarget(targets.totalFat ?? targets.fat, 60);

  let consumedCalories = 0;
  let consumedSatFat = 0;
  let consumedFiber = 0;
  let consumedSodium = 0;
  let consumedProtein = 0;
  let consumedCarbs = 0;
  let consumedFat = 0;

  const mealsSummary: any[] = [];

  for (const m of dayMeals) {
    const kcal = Number(m.calories) || Number(m.nutrients?.calories) || 0;
    const sat = Number(m.saturated_fat) || Number(m.nutrients?.saturatedFat) || 0;
    const fib = Number(m.nutrients?.totalFibre) || Number(m.nutrients?.fiber) || 0;
    const sod = Number(m.sodium) || Number(m.nutrients?.sodium) || 0;
    const pro = Number(m.nutrients?.protein) || 0;
    const car = Number(m.nutrients?.carbohydrates) || 0;
    const fat = Number(m.nutrients?.totalFat) || 0;

    consumedCalories += kcal;
    consumedSatFat += sat;
    consumedFiber += fib;
    consumedSodium += sod;
    consumedProtein += pro;
    consumedCarbs += car;
    consumedFat += fat;

    mealsSummary.push({
      id: m.id,
      name: m.name || 'Logged Meal',
      time: m.date,
      date_local: toYYYYMMDD(m.date, userTz),
      time_local: formatTimeInTimezone(m.date, userTz),
      timezone: userTz,
      calories: Math.round(kcal),
      protein_g: Math.round(pro * 10) / 10,
      carbs_g: Math.round(car * 10) / 10,
      fat_g: Math.round(fat * 10) / 10,
      saturated_fat_g: Math.round(sat * 10) / 10,
      fiber_g: Math.round(fib * 10) / 10,
      sodium_mg: Math.round(sod),
      photos: formatPhotoUrls(m.image_urls)
    });
  }

  consumedCalories = Math.round(consumedCalories);
  const remainingCalories = targetCalories - consumedCalories;
  const percentageReached = targetCalories > 0 ? Math.round((consumedCalories / targetCalories) * 100) : 0;
  const status = consumedCalories > targetCalories ? 'exceeded_allowance' : 'within_allowance';

  return {
    date: targetDate,
    timezone: userTz,
    target_allowance_kcal: targetCalories,
    consumed_kcal: consumedCalories,
    remaining_kcal: remainingCalories,
    percentage_reached: percentageReached,
    status,
    meal_count: dayMeals.length,
    nutrients: {
      calories: { target: targetCalories, consumed: consumedCalories, remaining: remainingCalories, unit: 'kcal' },
      saturated_fat: { target: targetSatFat, consumed: Math.round(consumedSatFat * 10) / 10, unit: 'g', ceiling_exceeded: consumedSatFat > targetSatFat },
      fiber: { target: targetFiber, consumed: Math.round(consumedFiber * 10) / 10, unit: 'g', goal_met: consumedFiber >= targetFiber },
      sodium: { target: targetSodium, consumed: Math.round(consumedSodium), unit: 'mg', ceiling_exceeded: consumedSodium > targetSodium },
      protein: { target: targetProtein, consumed: Math.round(consumedProtein * 10) / 10, unit: 'g' },
      carbohydrates: { target: targetCarbs, consumed: Math.round(consumedCarbs * 10) / 10, unit: 'g' },
      total_fat: { target: targetFat, consumed: Math.round(consumedFat * 10) / 10, unit: 'g' }
    },
    meals: mealsSummary
  };
}

// ---------------------------------------------------------------------------
// Tool Catalog (MCP Schema)
// ---------------------------------------------------------------------------

const MCP_TOOLS = [
  {
    name: 'manage_home',
    description: 'Manage user profile, homepage targets, goals, daily allowance progress, health actions, daily habits, and dashboard summary.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'get_profile',
            'get_allowance_progress',
            'get_dashboard',
            'set_targets',
            'update_profile',
            'manage_actions',
            'manage_habits'
          ],
          description: 'The home action to perform: "get_profile", "get_allowance_progress", "get_dashboard", "set_targets", "update_profile", "manage_actions", "manage_habits".'
        },
        date: {
          type: 'string',
          description: 'Optional date (YYYY-MM-DD, "today", or "yesterday") for allowance progress (defaults to today and yesterday summary)'
        },
        timezone: {
          type: 'string',
          description: 'User IANA timezone identifier, e.g. "Europe/London", "America/New_York", "Asia/Tokyo"'
        },
        language: {
          type: 'string',
          description: 'User preferred language, e.g. "en", "id", "fr", "zh"'
        },
        nickname: {
          type: 'string',
          description: 'User nickname or display name'
        },
        targets: {
          type: 'object',
          description: 'Nutrient target updates for set_targets (e.g. { calories: 1651, saturatedFat: "15 g", totalFibre: "30 g" })'
        },
        payload: {
          type: 'object',
          description: 'Optional payload for the action (alias for targets or profile updates)'
        },
        sub_action: {
          type: 'string',
          enum: ['add', 'update', 'toggle', 'delete', 'list'],
          description: 'Sub-action for manage_actions or manage_habits ("add", "update", "toggle", "delete", "list")'
        },
        item: {
          type: 'object',
          description: 'HealthAction item for manage_actions add/update ({ task, explanation, priority, type })'
        },
        itemId: {
          type: 'string',
          description: 'HealthAction ID for toggle, update, or delete'
        },
        item_id: {
          type: 'string',
          description: 'Alias for itemId'
        },
        habit: {
          type: 'object',
          description: 'DailyBenefit habit item for manage_habits add/update ({ activity, target })'
        },
        habitId: {
          type: 'string',
          description: 'DailyBenefit ID for toggle, update, or delete'
        },
        habit_id: {
          type: 'string',
          description: 'Alias for habitId'
        },
        idempotency_key: {
          type: 'string',
          description: 'Optional unique token/UUID preventing duplicate execution on retry'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'manage_meals',
    description: 'Browse, query, log, edit, and delete meals. Calculates calories through single mathematical ledger (finalizeDishLedger).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get_detail', 'log_structured', 'edit', 'delete'],
          description: 'Action to perform: "list" to search and browse meals; "get_detail" to view meal by ID; "log_structured" to log a meal with known items/weights; "edit" to patch an existing meal; "delete" to remove a meal with tombstone.'
        },
        date: {
          type: 'string',
          description: 'Meal date (YYYY-MM-DD, "today", or "yesterday")'
        },
        date_from: {
          type: 'string',
          description: 'Start of date range (YYYY-MM-DD, "today", or "yesterday")'
        },
        date_to: {
          type: 'string',
          description: 'End of date range (YYYY-MM-DD, "today", or "yesterday")'
        },
        timezone: {
          type: 'string',
          description: 'Optional IANA timezone override (e.g. "Europe/London")'
        },
        search: {
          type: 'string',
          description: 'Search keyword matching meal name, composition, or dishes'
        },
        meal_id: {
          type: 'string',
          description: 'Meal ID for get_detail, edit, or delete'
        },
        mealId: {
          type: 'string',
          description: 'Alias for meal_id'
        },
        name: {
          type: 'string',
          description: 'Optional custom meal title/label (e.g. "Breakfast Oatmeal & Blueberries")'
        },
        composition: {
          type: 'string',
          description: 'Optional summary of ingredients/composition'
        },
        items: {
          type: 'array',
          items: { type: 'object' },
          description: 'Array of meal items for log_structured: [{ name, weightGrams, protein, totalFat, carbohydrates, sodium, saturatedFat }]'
        },
        commands: {
          type: 'array',
          items: { type: 'object' },
          description: 'Structured edit commands for edit action: [{ action: "set_weight"|"replace_identity"|"add_item"|"remove_item", itemName, newWeightGrams }]'
        },
        message: {
          type: 'string',
          description: 'Natural language modification request for edit action (e.g. "change chicken to 200g and remove rice")'
        },
        user_message: {
          type: 'string',
          description: 'Alias for message'
        },
        image_urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of photo URLs attached to the meal'
        },
        idempotency_key: {
          type: 'string',
          description: 'Optional unique token/UUID preventing duplicate execution on retry'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of meals to return (default 50)'
        },
        offset: {
          type: 'number',
          description: 'Pagination offset'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'manage_biomarkers',
    description: 'Browse, analyze trends, log entries, and delete biomarker records with same-day merging and clinical range checks.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get_trends', 'log_entries', 'delete_values', 'log', 'edit', 'delete', 'confirm_source', 'confirm_cleanup'],
          description: 'Action: "list" and "get_trends" read the numeric map. "log", "edit", "delete", "confirm_source", and "confirm_cleanup" use the record projection. "log_entries" and "delete_values" remain the step 4 date-map tools.'
        },
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Biomarker keys to filter or trend (e.g. ["ldl_cholesterol", "hba1c", "fasting_glucose", "blood_pressure"])'
        },
        key: {
          type: 'string',
          description: 'Single biomarker key for filter, trends, or deletion'
        },
        date: {
          type: 'string',
          description: 'Target test date for log_entries or delete_values (YYYY-MM-DD, "today", or "yesterday")'
        },
        date_from: {
          type: 'string',
          description: 'Start of date range (YYYY-MM-DD, "today", or "yesterday")'
        },
        date_to: {
          type: 'string',
          description: 'End of date range (YYYY-MM-DD, "today", or "yesterday")'
        },
        timezone: {
          type: 'string',
          description: 'Optional IANA timezone override (e.g. "Europe/London")'
        },
        readings: {
          type: 'object',
          description: 'Map of biomarker key/name to value for log_entries (e.g. { "ldl_cholesterol": 3.2, "hba1c": 5.4, "blood_pressure": "120/80" })'
        },
        note: {
          type: 'string',
          description: 'Optional notes for log_entries'
        },
        summary: {
          type: 'string',
          description: 'Optional panel summary for log_entries'
        },
        record_id: {
          type: 'string',
          description: 'Optional record ID for delete_values'
        },
        recordId: {
          type: 'string',
          description: 'Alias for record_id'
        },
        idempotency_key: {
          type: 'string',
          description: 'Optional unique token/UUID preventing duplicate execution on retry'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of records to return (default 50)'
        }
      },
      required: ['action']
    }
  }
];

// ---------------------------------------------------------------------------
// Dynamic Schema Resource & Clinical Prompts
// ---------------------------------------------------------------------------

export interface NutrientMetricCatalogItem {
  key: string;
  label: string;
  default_target: string;
  unit: string;
  polarity: 'limit' | 'goal';
}

export const DEFAULT_NUTRIENT_METRICS: NutrientMetricCatalogItem[] = [
  { key: 'calories', label: 'Calories', default_target: '1800 kcal', unit: 'kcal', polarity: 'limit' },
  { key: 'protein', label: 'Protein', default_target: '70 g', unit: 'g', polarity: 'goal' },
  { key: 'carbohydrates', label: 'Carbohydrates', default_target: '200 g', unit: 'g', polarity: 'limit' },
  { key: 'totalFat', label: 'Total Fat', default_target: '60 g', unit: 'g', polarity: 'limit' },
  { key: 'saturatedFat', label: 'Saturated Fat', default_target: '20 g', unit: 'g', polarity: 'limit' },
  { key: 'unsaturatedFat', label: 'Unsaturated Fat', default_target: '40 g', unit: 'g', polarity: 'goal' },
  { key: 'omega3', label: 'Omega-3 Fatty Acids', default_target: '1.1 g', unit: 'g', polarity: 'goal' },
  { key: 'addedSugar', label: 'Added Sugar', default_target: '25 g', unit: 'g', polarity: 'limit' },
  { key: 'totalFibre', label: 'Total Dietary Fibre', default_target: '25 g', unit: 'g', polarity: 'goal' },
  { key: 'solubleFibre', label: 'Soluble Fibre', default_target: '5 g', unit: 'g', polarity: 'goal' },
  { key: 'sodium', label: 'Sodium', default_target: '1500 mg', unit: 'mg', polarity: 'limit' },
  { key: 'potassium', label: 'Potassium', default_target: '3500 mg', unit: 'mg', polarity: 'goal' },
  { key: 'magnesium', label: 'Magnesium', default_target: '310 mg', unit: 'mg', polarity: 'goal' },
  { key: 'calcium', label: 'Calcium', default_target: '1000 mg', unit: 'mg', polarity: 'goal' },
  { key: 'iron', label: 'Iron', default_target: '18 mg', unit: 'mg', polarity: 'goal' },
  { key: 'zinc', label: 'Zinc', default_target: '8 mg', unit: 'mg', polarity: 'goal' },
  { key: 'selenium', label: 'Selenium', default_target: '55 mcg', unit: 'mcg', polarity: 'goal' },
  { key: 'iodine', label: 'Iodine', default_target: '150 mcg', unit: 'mcg', polarity: 'goal' },
  { key: 'phosphorus', label: 'Phosphorus', default_target: '700 mg', unit: 'mg', polarity: 'goal' },
  { key: 'vitaminD', label: 'Vitamin D', default_target: '600 IU', unit: 'IU', polarity: 'goal' },
  { key: 'vitaminB12', label: 'Vitamin B12', default_target: '2.4 mcg', unit: 'mcg', polarity: 'goal' },
  { key: 'folate', label: 'Folate', default_target: '400 mcg', unit: 'mcg', polarity: 'goal' },
  { key: 'vitaminC', label: 'Vitamin C', default_target: '75 mg', unit: 'mg', polarity: 'goal' },
  { key: 'vitaminE', label: 'Vitamin E', default_target: '15 mg', unit: 'mg', polarity: 'goal' },
  { key: 'vitaminK', label: 'Vitamin K', default_target: '90 mcg', unit: 'mcg', polarity: 'goal' },
  { key: 'vitaminA', label: 'Vitamin A', default_target: '700 mcg', unit: 'mcg', polarity: 'goal' },
  { key: 'vitaminB6', label: 'Vitamin B6', default_target: '1.3 mg', unit: 'mg', polarity: 'goal' },
  { key: 'thiamine', label: 'Thiamine (Vitamin B1)', default_target: '1.1 mg', unit: 'mg', polarity: 'goal' },
  { key: 'riboflavin', label: 'Riboflavin (Vitamin B2)', default_target: '1.1 mg', unit: 'mg', polarity: 'goal' },
  { key: 'niacin', label: 'Niacin (Vitamin B3)', default_target: '14 mg', unit: 'mg', polarity: 'goal' },
  { key: 'steps', label: 'Daily Steps', default_target: '3000 steps', unit: 'steps', polarity: 'goal' }
];

export function generateHealthTrackerCatalog(profile: any) {
  const userTargets = profile?.dailyNutrientTargets || profile?.nutritionTargets || profile?.targets || {};

  const nutrients = DEFAULT_NUTRIENT_METRICS.map((m) => ({
    key: m.key,
    label: m.label,
    default_target: m.default_target,
    unit: m.unit,
    polarity: m.polarity,
    user_target: userTargets[m.key] || m.default_target
  }));

  const standardBiomarkers = biomarkerDefinitions.map((def) => ({
    key: def.key,
    name: def.name,
    category: def.category,
    unit: def.unit,
    normal_range: def.normalRange,
    descriptions: def.descriptions,
    aliases: def.aliases || []
  }));

  const customBiomarkers = (profile?.customBiomarkers || []).map((cb: any) => ({
    key: cb.key,
    name: cb.name || cb.label || cb.key,
    category: cb.category || 'custom',
    unit: cb.unit || '',
    normal_range: cb.normalRange || cb.rangeText || '',
    is_custom: true
  }));

  const tools = MCP_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    actions: ((t.inputSchema.properties?.action as any)?.enum || []) as string[]
  }));

  return {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    user: {
      timezone: profile?.timezone || 'Europe/London',
      language: profile?.language || 'en'
    },
    nutrients: {
      count: nutrients.length,
      items: nutrients
    },
    biomarkers: {
      count: standardBiomarkers.length + customBiomarkers.length,
      standard_count: standardBiomarkers.length,
      custom_count: customBiomarkers.length,
      items: [...standardBiomarkers, ...customBiomarkers]
    },
    tools,
    user_markers: userMarkerKeys(profile)
  };
}

export interface McpPromptDefinition {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
}

export const MCP_PROMPTS: McpPromptDefinition[] = [
  {
    name: 'audit_meal_accuracy',
    description: 'Forensic nutritional review of a logged meal comparing dishes, portion weights, Atwater math (4*P + 4*C + 9*F), and meal photo against logged totals, proposing precise edits via manage_meals(action: "edit").',
    arguments: [
      {
        name: 'meal_id',
        description: 'The unique ID of the meal to audit. If omitted, the audit inspects the user\'s most recent meal log.',
        required: false
      }
    ]
  },
  {
    name: 'daily_nutrition_debrief',
    description: 'End-of-day nutritional review evaluating consumed calories, macronutrients, and micronutrients against the user\'s daily allowance targets, highlighting deficits or overages with concrete advice.',
    arguments: [
      {
        name: 'date',
        description: 'Target date to debrief (YYYY-MM-DD, "today", or "yesterday"). Defaults to "today".',
        required: false
      }
    ]
  },
  {
    name: 'biomarker_diet_correlation',
    description: 'Clinical analysis cross-correlating out-of-range or trending biomarker readings with 30–90 day rolling dietary intake (e.g. saturated fat vs LDL, sodium vs blood pressure, dietary fiber vs fasting glucose/HbA1c).',
    arguments: [
      {
        name: 'biomarker_key',
        description: 'Specific biomarker key to evaluate (e.g. "ldl", "hba1c", "bloodPressure", "total_cholesterol"). If omitted, assesses all out-of-range biomarkers.',
        required: false
      }
    ]
  },
  {
    name: 'triage_and_fix_latest_issue',
    description: 'Diagnostic triage inspecting recent meal breakdowns, sync integrity, and biomarker records to detect oracle discrepancies or anomalies, proposing direct user-scoped data repairs.',
    arguments: []
  }
];

export function getMcpPromptMessage(name: string, args: Record<string, any> = {}) {
  switch (name) {
    case 'audit_meal_accuracy': {
      const mealId = args.meal_id;
      return {
        description: 'Forensic audit of meal accuracy, Atwater calculation, and dish portion consistency.',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                `Please perform a rigorous nutritional forensic audit of ${mealId ? `meal ID "${mealId}"` : 'the most recent logged meal'}.`,
                '',
                'Follow this protocol:',
                `1. Fetch meal details using manage_meals(action: "${mealId ? 'get_detail' : 'list'}"${mealId ? `, meal_id: "${mealId}"` : ', limit: 1'}).`,
                '2. Inspect each dish in items for realistic portion sizes and macronutrients.',
                '3. Verify the Atwater calculation for each dish (calories = 4*protein + 4*carbohydrates + 9*fat) and verify that dish components sum up to the overall meal totals.',
                '4. If a photo URL is present, verify that the recognized items and portion estimates match the visual evidence.',
                '5. If you find any discrepancies (e.g. missing items, inaccurate portions, Atwater mismatch), state them clearly and propose the exact patch commands using manage_meals(action: "edit", meal_id: "...", commands: [...]).'
              ].join('\n')
            }
          }
        ]
      };
    }

    case 'daily_nutrition_debrief': {
      const dateToken = args.date || 'today';
      return {
        description: 'End-of-day nutritional review evaluating intake against daily allowance targets.',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                `Please provide a comprehensive daily nutrition debrief for "${dateToken}".`,
                '',
                'Follow this protocol:',
                `1. Fetch the day's allowance progress and targets using manage_home(action: "get_allowance_progress", date: "${dateToken}").`,
                `2. Fetch all meals logged for that calendar day using manage_meals(action: "list", date: "${dateToken}").`,
                '3. Calculate the total consumed calories, protein, carbohydrates, total fat, saturated fat, sodium, and dietary fiber in the user\'s local timezone.',
                '4. Assess performance against target thresholds: compare limit metrics (calories, saturated fat, sodium, added sugar) against their ceilings, and goal metrics (protein, fiber, potassium, micronutrients) against their floors.',
                '5. Conclude with encouraging, evidence-based feedback and practical recommendations for evening intake or tomorrow\'s meals.'
              ].join('\n')
            }
          }
        ]
      };
    }

    case 'biomarker_diet_correlation': {
      const biomarkerKey = args.biomarker_key;
      return {
        description: 'Clinical analysis cross-correlating out-of-range biomarkers with rolling dietary intake.',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                `Please analyze the clinical correlation between ${biomarkerKey ? `biomarker "${biomarkerKey}"` : 'out-of-range biomarkers'} and longitudinal dietary patterns.`,
                '',
                'Follow this protocol:',
                `1. Query biomarker logs using manage_biomarkers(action: "list"${biomarkerKey ? `, keys: ["${biomarkerKey}"]` : ''}) to check current readings and reference ranges.`,
                `2. Check trends using manage_biomarkers(action: "get_trends"${biomarkerKey ? `, keys: ["${biomarkerKey}"]` : ''}) to observe historical trajectories.`,
                '3. Query recent dietary intake over the past 30 days using manage_meals(action: "list", limit: 30).',
                '4. Evaluate established clinical diet-biomarker relationships (e.g. saturated fat intake vs LDL cholesterol, sodium-to-potassium ratio vs systolic/diastolic blood pressure, dietary fiber and added sugar vs glycemic markers).',
                '5. Present clinical findings with practical, patient-friendly dietary guidance.'
              ].join('\n')
            }
          }
        ]
      };
    }

    case 'triage_and_fix_latest_issue': {
      return {
        description: 'Diagnostic triage checking recent meals, biomarker entries, and sync state.',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                'Please perform a diagnostic health data triage on recent user records.',
                '',
                'Follow this protocol:',
                '1. Query the latest meal log using manage_meals(action: "list", limit: 1) and inspect its dish breakdown.',
                '2. Query the latest biomarker records using manage_biomarkers(action: "list", limit: 3).',
                '3. Check for anomalies such as duplicate same-day entries, improbable values, or missing macronutrient fields.',
                '4. Summarize the system health status and offer direct data repairs using manage_meals(action: "edit") or manage_biomarkers(action: "delete_values" | "log_entries") if issues are discovered.'
              ].join('\n')
            }
          }
        ]
      };
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Protocol Endpoints: GET & POST /api/mcp and /mcp
// ---------------------------------------------------------------------------

mcpRouter.get(MCP_PATHS, (req: Request, res: Response) => {
  if (req.headers.accept?.includes('text/event-stream')) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();
    res.write(`event: endpoint\ndata: ${getBaseUrl(req)}/api/mcp\n\n`);
    return;
  }
  return res.json({
    name: 'health-tracker-mcp',
    version: '1.1.0',
    protocolVersion: '2024-11-05',
    transport: 'streamable-http',
    status: 'ready'
  });
});

mcpRouter.post(MCP_PATHS, async (req: Request, res: Response) => {
  const { jsonrpc, id, method, params } = req.body || {};

  if (jsonrpc !== '2.0') {
    return res.status(400).json({
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' }
    });
  }

  const currentUser = req.mcpUser!;
  const possibleUids = resolvePossibleUids(currentUser.uid, currentUser.email);

  switch (method) {
    case 'initialize': {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false, subscribe: false },
            prompts: { listChanged: false }
          },
          serverInfo: {
            name: 'health-tracker-mcp',
            version: '1.2.0'
          }
        }
      });
    }

    case 'notifications/initialized': {
      return res.status(200).json({ jsonrpc: '2.0', result: {} });
    }

    case 'ping': {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {}
      });
    }

    case 'resources/list': {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          resources: [
            {
              uri: 'schema://health-tracker/catalog',
              name: 'Health-tracker Clinical & Nutritional Catalog',
              mimeType: 'application/json',
              description: 'Dynamically serialized schema of active nutrient targets (31 daily metrics with units, polarities, and defaults), standard and profile-specific custom biomarker definitions, reference ranges, and domain tool actions.'
            }
          ]
        }
      });
    }

    case 'resources/read': {
      const uri = params?.uri;
      if (uri !== 'schema://health-tracker/catalog') {
        return res.status(404).json({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: `Resource not found: "${uri}". Available: "schema://health-tracker/catalog"`
          }
        });
      }

      const profileData = await loadUserProfile(currentUser.uid);
      const rawProfile = profileData.profile || profileData || {};
      const catalog = generateHealthTrackerCatalog(rawProfile);

      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          contents: [
            {
              uri: 'schema://health-tracker/catalog',
              mimeType: 'application/json',
              text: JSON.stringify(catalog, null, 2)
            }
          ]
        }
      });
    }

    case 'prompts/list': {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          prompts: MCP_PROMPTS
        }
      });
    }

    case 'prompts/get': {
      const promptName = params?.name;
      const promptArgs = params?.arguments || {};
      const prompt = getMcpPromptMessage(promptName, promptArgs);

      if (!prompt) {
        return res.status(404).json({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: `Prompt not found: "${promptName}". Available: "audit_meal_accuracy", "daily_nutrition_debrief", "biomarker_diet_correlation", "triage_and_fix_latest_issue"`
          }
        });
      }

      return res.json({
        jsonrpc: '2.0',
        id,
        result: prompt
      });
    }

    case 'tools/list': {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          tools: MCP_TOOLS
        }
      });
    }

    case 'tools/call': {
      const toolName = params?.name;
      const args = params?.arguments || {};

      // ---------------------------------------------------------------------
      // 1. MANAGE_HOME
      // ---------------------------------------------------------------------
      if (toolName === 'manage_home') {
        const action = args.action;

        if (action === 'get_profile') {
          const profileData = await loadUserProfile(currentUser.uid);
          const rawProfile = profileData.profile || profileData;
          const userTz = args.timezone || rawProfile.timezone || 'Europe/London';
          const report = profileData.report || {};
          const targets = rawProfile.targets || rawProfile.generalNutrientTargets || report.dailyNutrientTargets || {};

          const summary = {
            canonicalUid: currentUser.uid,
            email: currentUser.email,
            possibleUids,
            timezone: userTz,
            current_date: getCurrentDateInTimezone(userTz),
            current_time: formatTimeInTimezone(new Date(), userTz),
            profile: {
              nickname: rawProfile.nickname || 'User',
              language: rawProfile.language || 'en',
              userType: rawProfile.userType || 'Standard',
              timezone: userTz,
              ...rawProfile
            },
            targets,
            targetTimestamps: profileData.targetTimestamps || rawProfile.targetTimestamps || {},
            report
          };

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }]
            }
          });
        }

        if (action === 'get_allowance_progress' || action === 'get_dashboard') {
          const profileData = await loadUserProfile(currentUser.uid);
          const rawProfile = profileData.profile || profileData;
          const userTz = args.timezone || rawProfile.timezone || 'Europe/London';
          const report = profileData.report || {};
          const targets = rawProfile.targets || rawProfile.generalNutrientTargets || report.dailyNutrientTargets || {};

          const allMeals = await getAllUserFoods(possibleUids);

          const todayDate = getCurrentDateInTimezone(userTz);
          const yesterdayDate = getYesterdayInTimezone(userTz);
          const requestedDate = args.date ? toYYYYMMDD(args.date, userTz) : null;

          if (requestedDate && requestedDate !== todayDate && requestedDate !== yesterdayDate) {
            const requestedProgress = computeDayAllowance(requestedDate, allMeals, targets, userTz);
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: JSON.stringify(requestedProgress, null, 2) }]
              }
            });
          }

          const todayProgress = computeDayAllowance(todayDate, allMeals, targets, userTz);
          const yesterdayProgress = computeDayAllowance(yesterdayDate, allMeals, targets, userTz);

          const result: any = {
            timezone: userTz,
            current_date: todayDate,
            current_time: formatTimeInTimezone(new Date(), userTz),
            baseline_daily_allowance_kcal: parseNumericTarget(
              targets.calories ?? report.dailyNutrientTargets?.calories,
              1651
            ),
            today: todayProgress,
            yesterday: yesterdayProgress
          };

          if (action === 'get_dashboard') {
            result.profile = {
              nickname: rawProfile.nickname || 'User',
              language: rawProfile.language || 'en',
              timezone: userTz
            };
            result.targets = targets;
            result.targetTimestamps = profileData.targetTimestamps || rawProfile.targetTimestamps || {};
          }

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            }
          });
        }

        if (action === 'set_targets') {
          const newTargets = args.targets || args.payload || {};
          const profileData = await loadUserProfile(currentUser.uid);
          const rawProfile = profileData.profile || profileData;
          const report = profileData.report || {};

          const existingTimestamps = profileData.targetTimestamps || rawProfile.targetTimestamps || {};
          const nowMs = Date.now();
          const updatedTimestamps = { ...existingTimestamps };

          for (const k of Object.keys(newTargets)) {
            updatedTimestamps[k] = nowMs;
          }

          rawProfile.targets = {
            ...(rawProfile.targets || {}),
            ...newTargets
          };
          rawProfile.targetTimestamps = updatedTimestamps;

          if (!report.dailyNutrientTargets) report.dailyNutrientTargets = {};
          Object.assign(report.dailyNutrientTargets, newTargets);
          report.targetTimestamps = updatedTimestamps;

          const updatedData = {
            ...profileData,
            profile: rawProfile,
            report,
            targetTimestamps: updatedTimestamps,
            updated_at: new Date().toISOString()
          };

          inMemoryMcpProfiles.set(currentUser.uid, updatedData);

          if (isD1Configured()) {
            await d1UpsertProfile(currentUser.uid, updatedData);
          }

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      message: 'Nutrient targets updated successfully',
                      updated_targets: rawProfile.targets,
                      targetTimestamps: updatedTimestamps
                    },
                    null,
                    2
                  )
                }
              ]
            }
          });
        }

        if (action === 'update_profile') {
          const profileData = await loadUserProfile(currentUser.uid);
          const rawProfile = profileData.profile || profileData;

          if (args.timezone) {
            rawProfile.timezone = String(args.timezone).trim();
          }
          if (args.language) {
            rawProfile.language = String(args.language).trim();
          }
          if (args.nickname) {
            rawProfile.nickname = String(args.nickname).trim();
          }
          if (args.payload && typeof args.payload === 'object') {
            Object.assign(rawProfile, args.payload);
          }

          const updatedData = {
            ...profileData,
            profile: rawProfile,
            updated_at: new Date().toISOString()
          };

          inMemoryMcpProfiles.set(currentUser.uid, updatedData);

          if (isD1Configured()) {
            await d1UpsertProfile(currentUser.uid, updatedData);
          }

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      message: 'Profile updated successfully',
                      profile: rawProfile
                    },
                    null,
                    2
                  )
                }
              ]
            }
          });
        }

        if (action === 'manage_actions') {
          const subAction = (args.sub_action || args.action_type || 'list') as any;
          const result = await withIdempotency(args.idempotency_key, () =>
            manageUserActions({
              uid: currentUser.uid,
              action: subAction,
              item: args.item || args.payload,
              itemId: args.itemId || args.item_id || args.id
            })
          );
          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            }
          });
        }

        if (action === 'manage_habits') {
          const subAction = (args.sub_action || args.action_type || 'list') as any;
          const result = await withIdempotency(args.idempotency_key, () =>
            manageUserHabits({
              uid: currentUser.uid,
              action: subAction,
              habit: args.habit || args.payload,
              habitId: args.habitId || args.habit_id || args.id
            })
          );
          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            }
          });
        }

        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Unsupported action "${action}" for tool "manage_home". Available: "get_profile", "get_allowance_progress", "get_dashboard", "set_targets", "update_profile", "manage_actions", "manage_habits".`
              }
            ]
          }
        });
      }

      // ---------------------------------------------------------------------
      // 2. MANAGE_MEALS
      // ---------------------------------------------------------------------
      if (toolName === 'manage_meals') {
        const action = args.action;
        const profileData = await loadUserProfile(currentUser.uid);
        const rawProfile = profileData.profile || profileData;
        const userTz = args.timezone || rawProfile.timezone || 'Europe/London';

        if (action === 'list') {
          const allMeals = await getAllUserFoods(possibleUids);

          const filterDate = args.date ? toYYYYMMDD(args.date, userTz) : null;
          const dateFrom = args.date_from ? toYYYYMMDD(args.date_from, userTz) : null;
          const dateTo = args.date_to ? toYYYYMMDD(args.date_to, userTz) : null;
          const search = args.search ? String(args.search).toLowerCase().trim() : null;

          let filtered = allMeals.filter((m) => {
            const mDate = toYYYYMMDD(m.date, userTz);
            if (filterDate && mDate !== filterDate) return false;
            if (dateFrom && mDate < dateFrom) return false;
            if (dateTo && mDate > dateTo) return false;
            if (search) {
              const nameMatch = (m.name || '').toLowerCase().includes(search);
              const compMatch = (m.composition || '').toLowerCase().includes(search);
              const descMatch = (m.description || '').toLowerCase().includes(search);
              const itemsMatch = Array.isArray(m.items_breakdown) &&
                m.items_breakdown.some((it: any) => (it.name || '').toLowerCase().includes(search));
              if (!nameMatch && !compMatch && !descMatch && !itemsMatch) return false;
            }
            return true;
          });

          filtered.sort((a, b) => {
            const da = toYYYYMMDD(a.date, userTz);
            const db = toYYYYMMDD(b.date, userTz);
            if (da !== db) return db.localeCompare(da);
            return String(b.updated_at || b.id).localeCompare(String(a.updated_at || a.id));
          });

          const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 50;
          const offset = typeof args.offset === 'number' && args.offset > 0 ? args.offset : 0;
          const paged = filtered.slice(offset, offset + limit);

          const formattedMeals = paged.map((m) => {
            const dateLocal = toYYYYMMDD(m.date, userTz);
            const timeLocal = formatTimeInTimezone(m.date, userTz);
            return {
              id: m.id,
              date: m.date,
              date_local: dateLocal,
              time_local: timeLocal,
              timezone: userTz,
              date_formatted: dateLocal,
              name: m.name || 'Logged Meal',
              composition: m.composition || '',
              weight_grams: m.weight_grams || 0,
              calories: Number(m.calories) || Number(m.nutrients?.calories) || 0,
              saturated_fat_g: Number(m.saturated_fat) || Number(m.nutrients?.saturatedFat) || 0,
              sodium_mg: Number(m.sodium) || Number(m.nutrients?.sodium) || 0,
              added_sugar_g: Number(m.added_sugar) || Number(m.nutrients?.addedSugar) || 0,
              nutrients: m.nutrients || {},
              items_breakdown: m.items_breakdown || [],
              image_urls: formatPhotoUrls(m.image_urls),
              benefits: m.benefits || '',
              risks: m.risks || '',
              recommendation: m.recommendation || '',
              updated_at: m.updated_at
            };
          });

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      timezone: userTz,
                      total: filtered.length,
                      limit,
                      offset,
                      meals: formattedMeals
                    },
                    null,
                    2
                  )
                }
              ]
            }
          });
        }

        if (action === 'get_detail') {
          const mealId = args.meal_id || args.mealId || args.id;
          if (!mealId) {
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                isError: true,
                content: [{ type: 'text', text: 'Missing required argument "meal_id"' }]
              }
            });
          }

          let foundMeal: any = null;

          // Check in-memory stores
          for (const uid of possibleUids) {
            const memList = inMemoryMcpFoods.get(uid);
            if (Array.isArray(memList)) {
              foundMeal = memList.find((m) => m && m.id === mealId);
              if (foundMeal) break;
            }
          }

          // Check D1 database
          if (!foundMeal && isD1Configured()) {
            try {
              foundMeal = await d1GetFullFoodRecord(mealId, possibleUids);
            } catch (err: any) {
              console.warn('[MCP] d1GetFullFoodRecord error:', err?.message);
            }
          }

          if (!foundMeal) {
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                isError: true,
                content: [{ type: 'text', text: `Meal not found with ID "${mealId}"` }]
              }
            });
          }

          const dateLocal = toYYYYMMDD(foundMeal.date, userTz);
          const timeLocal = formatTimeInTimezone(foundMeal.date, userTz);

          const detail = {
            ...foundMeal,
            date_formatted: dateLocal,
            date_local: dateLocal,
            time_local: timeLocal,
            timezone: userTz,
            calories: Number(foundMeal.calories) || Number(foundMeal.nutrients?.calories) || 0,
            image_urls: formatPhotoUrls(foundMeal.image_urls)
          };

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }]
            }
          });
        }

        if (action === 'log_structured') {
          const mealItems = Array.isArray(args.items) ? args.items : [];
          if (mealItems.length === 0) {
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                isError: true,
                content: [{ type: 'text', text: 'Missing required argument "items" with at least one food item' }]
              }
            });
          }

          const createdMeal = await withIdempotency(args.idempotency_key, () =>
            finalizeAndCreateMeal({
              uid: currentUser.uid,
              date: args.date,
              timezone: userTz,
              name: args.name,
              composition: args.composition,
              items: mealItems,
              imageUrls: args.image_urls || args.imageUrls || [],
              chatTranscript: args.chat_transcript || args.chatTranscript || []
            })
          );

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(createdMeal, null, 2) }]
            }
          });
        }

        if (action === 'edit') {
          const mealId = args.meal_id || args.mealId || args.id;
          if (!mealId) {
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                isError: true,
                content: [{ type: 'text', text: 'Missing required argument "meal_id"' }]
              }
            });
          }

          const editResult = await withIdempotency(args.idempotency_key, () =>
            editMealWithPatch({
              uid: currentUser.uid,
              mealId,
              possibleUids,
              timezone: userTz,
              commands: args.commands,
              userMessage: args.message || args.user_message || args.userMessage
            })
          );

          if (!editResult.success) {
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                isError: true,
                content: [{ type: 'text', text: editResult.error || 'Failed to edit meal' }]
              }
            });
          }

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(editResult, null, 2) }]
            }
          });
        }

        if (action === 'delete') {
          const mealId = args.meal_id || args.mealId || args.id;
          if (!mealId) {
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                isError: true,
                content: [{ type: 'text', text: 'Missing required argument "meal_id"' }]
              }
            });
          }

          const deleteResult = await withIdempotency(args.idempotency_key, () =>
            deleteMealLog({
              uid: currentUser.uid,
              mealId,
              possibleUids
            })
          );

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(deleteResult, null, 2) }]
            }
          });
        }

        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Unsupported action "${action}" for tool "manage_meals". Available: "list", "get_detail", "log_structured", "edit", "delete".`
              }
            ]
          }
        });
      }

      // ---------------------------------------------------------------------
      // 3. MANAGE_BIOMARKERS
      // ---------------------------------------------------------------------
      if (toolName === 'manage_biomarkers') {
        const action = args.action;
        const profileData = await loadUserProfile(currentUser.uid);
        const rawProfile = profileData.profile || profileData;
        const userTz = args.timezone || rawProfile.timezone || 'Europe/London';
        const allBios = await getAllUserBiomarkers(possibleUids);

        if (action === 'list') {
          const dateFrom = args.date_from ? toYYYYMMDD(args.date_from, userTz) : null;
          const dateTo = args.date_to ? toYYYYMMDD(args.date_to, userTz) : null;
          const requestedKeys: string[] = Array.isArray(args.keys)
            ? args.keys
            : args.key ? [args.key] : [];

          let filtered = allBios.filter((b) => {
            const bDate = toYYYYMMDD(b.date, userTz);
            if (dateFrom && bDate < dateFrom) return false;
            if (dateTo && bDate > dateTo) return false;
            return true;
          });

          filtered.sort((a, b) => toYYYYMMDD(b.date, userTz).localeCompare(toYYYYMMDD(a.date, userTz)));

          const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 50;
          const paged = filtered.slice(0, limit);
          const readModel = projectRead(filtered);

          const formatted = paged.map((b) => {
            let biomarkersMap = publicBiomarkerMap(b.biomarkers || {});
            if (requestedKeys.length > 0) {
              const sub: Record<string, any> = {};
              for (const k of requestedKeys) {
                if (k in biomarkersMap) sub[k] = biomarkersMap[k];
              }
              biomarkersMap = sub;
            }
            const dateLocal = toYYYYMMDD(b.date, userTz);
            const timeLocal = formatTimeInTimezone(b.date, userTz);
            return {
              id: b.id,
              date: b.date,
              date_formatted: dateLocal,
              date_local: dateLocal,
              time_local: timeLocal,
              timezone: userTz,
              biomarkers: biomarkersMap,
              note: b.note || '',
              summary: b.summary || '',
              tests: b.tests || [],
              updated_at: b.updated_at
            };
          });

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      timezone: userTz,
                      total: filtered.length,
                      count: formatted.length,
                      biomarker_logs: formatted,
                      symptomEvents: readModel.symptomEvents,
                      tracked: readModel.tracked,
                      logEntries: readModel.logEntries
                    },
                    null,
                    2
                  )
                }
              ]
            }
          });
        }

        if (action === 'get_trends') {
          const requestedKeys: string[] = Array.isArray(args.keys) && args.keys.length > 0
            ? args.keys
            : args.key ? [args.key] : [];

          // Collect all readings per biomarker key
          const keyReadings = new Map<string, Array<{ date: string; value: number; raw: any; unit: string }>>();

          for (const b of allBios) {
            const dateStr = toYYYYMMDD(b.date, userTz);
            const bios = publicBiomarkerMap(b.biomarkers || {});
            for (const [k, val] of Object.entries(bios)) {
              if (requestedKeys.length > 0 && !requestedKeys.includes(k)) continue;
              const numVal = parseNumericTarget(val, NaN);
              if (isNaN(numVal)) continue;

              const rawStr = String(val);
              const unitMatch = rawStr.match(/(mmol\/L|mg\/dL|g\/dL|mcg\/L|ug\/L|IU\/mL|ng\/mL|%|bpm|mmHg)/i);
              const unit = unitMatch ? unitMatch[0] : '';

              if (!keyReadings.has(k)) keyReadings.set(k, []);
              keyReadings.get(k)!.push({
                date: dateStr,
                value: numVal,
                raw: val,
                unit
              });
            }
          }

          const trends: Record<string, any> = {};

          for (const [k, readings] of keyReadings.entries()) {
            readings.sort((a, b) => a.date.localeCompare(b.date));
            if (readings.length === 0) continue;

            const latest = readings[readings.length - 1];
            const previous = readings.length >= 2 ? readings[readings.length - 2] : null;

            let minReading = readings[0];
            let maxReading = readings[0];
            for (const r of readings) {
              if (r.value < minReading.value) minReading = r;
              if (r.value > maxReading.value) maxReading = r;
            }

            const delta = previous ? Math.round((latest.value - previous.value) * 100) / 100 : 0;
            const deltaPct = previous && previous.value !== 0
              ? Math.round(((latest.value - previous.value) / previous.value) * 100)
              : 0;

            const trendDirection = delta > 0.05 ? 'increasing' : delta < -0.05 ? 'decreasing' : 'stable';

            trends[k] = {
              biomarker_key: k,
              readings_count: readings.length,
              latest: { date: latest.date, value: latest.value, unit: latest.unit },
              previous: previous ? { date: previous.date, value: previous.value, unit: previous.unit } : null,
              min: { date: minReading.date, value: minReading.value, unit: minReading.unit },
              max: { date: maxReading.date, value: maxReading.value, unit: maxReading.unit },
              delta,
              delta_percentage: deltaPct,
              trend: trendDirection,
              history: readings.map((r) => ({ date: r.date, value: r.value, unit: r.unit }))
            };
          }

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify({ timezone: userTz, trends }, null, 2) }]
            }
          });
        }

        if (action === 'log_entries') {
          const readings = args.readings || args.biomarkers || args.values;
          if (!readings || typeof readings !== 'object' || Object.keys(readings).length === 0) {
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                isError: true,
                content: [{ type: 'text', text: 'Missing required argument "readings" object with biomarker key-value pairs' }]
              }
            });
          }

          const logResult = await withIdempotency(args.idempotency_key, () =>
            upsertBiomarkerEntry({
              uid: currentUser.uid,
              possibleUids,
              date: args.date,
              timezone: userTz,
              readings,
              note: args.note,
              summary: args.summary
            })
          );

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(logResult, null, 2) }]
            }
          });
        }

        if (action === 'log' || action === 'edit' || action === 'delete' || action === 'confirm_source' || action === 'confirm_cleanup') {
          const date = args.date ? toYYYYMMDD(args.date, userTz) : toYYYYMMDD('today', userTz);
          const outcome = applyRecordAction(allBios, { ...args, action, date });
          const saved = await withIdempotency(args.idempotency_key, () =>
            saveProjectedBiomarkerRows({
              uid: currentUser.uid,
              possibleUids,
              rows: (outcome.rows as any[]) || [],
              deletedIds: (outcome.deletedIds as string[]) || []
            })
          );
          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify({ ...outcome, rows: saved, sqlWriter: 'd1UpsertBiomarkers' }, null, 2)
              }]
            }
          });
        }

        if (action === 'delete_values') {
          const deleteResult = await withIdempotency(args.idempotency_key, () =>
            deleteBiomarkerEntry({
              uid: currentUser.uid,
              possibleUids,
              date: args.date,
              recordId: args.record_id || args.recordId || args.id,
              key: args.key,
              timezone: userTz
            })
          );

          if (!deleteResult.success) {
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                isError: true,
                content: [{ type: 'text', text: deleteResult.error || 'Failed to delete biomarker entry' }]
              }
            });
          }

          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(deleteResult, null, 2) }]
            }
          });
        }

        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Unsupported action "${action}" for tool "manage_biomarkers". Available: "list", "get_trends", "log_entries", "delete_values", "log", "edit", "delete", "confirm_source", "confirm_cleanup".`
              }
            ]
          }
        });
      }

      return res.status(404).json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Tool not found: "${toolName}"`
        }
      });
    }

    default: {
      return res.status(404).json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: "${method}"`
        }
      });
    }
  }
});

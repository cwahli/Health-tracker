/**
 * healthTrackerDomain.ts
 *
 * Core shared domain service unifying Website HTTP routes and MCP mutations:
 * - Single writer for calories: finalizeDishLedger (Atwater math, never LLM emitted)
 * - Single meal edit engine: applyMealEdits from server_meal_edit.ts
 * - Single meal & biomarker tombstone manager: deletedFoodLogIds & deletedBiomarkerLogIds
 * - Same-day biomarker merging across possibleUids with canonical key mapping and plausibility gates
 * - Health actions and daily habits management
 * - Idempotency wrapper preventing duplicate operations on agent retries
 */

import fs from 'node:fs';
import path from 'node:path';
import { finalizeDishLedger } from '../../../server_dish_finalize.js';
import { buildMealFromFinalizeLedgers, sumItemNutrients } from '../../../server_meal_from_finalize.js';
import { applyMealEdits } from '../../../server_meal_edit.js';
import { resolveMealVerdict, ResolvedVerdict } from '../../utils/verdictUtils.js';
import { getMappedBiomarkerKey, isBiomarkerValueImprobable } from '../../utils/biomarkers.js';
import {
  d1GetProfile,
  d1UpsertProfile,
  d1QueryFoods,
  d1GetFullFoodRecord,
  d1UpsertFoods,
  d1DeleteFoods,
  d1QueryBiomarkers,
  d1UpsertBiomarkers,
  d1DeleteBiomarkers,
  isD1Configured,
  D1FoodRow,
  D1BiomarkerRow
} from '../../../server_db_d1.js';
import type { HealthAction, DailyBenefit } from '../../types.js';

// ---------------------------------------------------------------------------
// In-Memory MCP Mock Stores (for hermetic unit tests & runtime caching)
// ---------------------------------------------------------------------------

export const inMemoryMcpProfiles = new Map<string, any>();
export const inMemoryMcpFoods = new Map<string, any[]>();
export const inMemoryMcpBiomarkers = new Map<string, any[]>();

export function setInMemoryProfile(uid: string, data: any): void {
  inMemoryMcpProfiles.set(uid, data);
}

export function clearInMemoryProfiles(): void {
  inMemoryMcpProfiles.clear();
}

export function setInMemoryFoods(uid: string, foods: any[]): void {
  inMemoryMcpFoods.set(uid, foods);
}

export function setInMemoryBiomarkers(uid: string, biomarkers: any[]): void {
  inMemoryMcpBiomarkers.set(uid, biomarkers);
}

export function clearInMemoryMcpStores(): void {
  inMemoryMcpProfiles.clear();
  inMemoryMcpFoods.clear();
  inMemoryMcpBiomarkers.clear();
}

// ---------------------------------------------------------------------------
// Idempotency Store
// ---------------------------------------------------------------------------

interface IdempotencyEntry {
  result: any;
  createdAt: number;
}

const idempotencyStore = new Map<string, IdempotencyEntry>();
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function withIdempotency<T>(
  key: string | undefined,
  operation: () => Promise<T>
): Promise<T> {
  if (!key) return operation();
  const existing = idempotencyStore.get(key);
  if (existing && Date.now() - existing.createdAt < IDEMPOTENCY_TTL_MS) {
    return existing.result as T;
  }
  const result = await operation();
  idempotencyStore.set(key, { result, createdAt: Date.now() });
  return result;
}

export function clearIdempotencyStore(): void {
  idempotencyStore.clear();
}

// ---------------------------------------------------------------------------
// Timezone and Date Utilities
// ---------------------------------------------------------------------------

export function getCurrentDateInTimezone(timezone: string = 'Europe/London'): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function getYesterdayYYYYMMDD(referenceDate?: string, timezone: string = 'Europe/London'): string {
  const ref = referenceDate ? new Date(referenceDate) : new Date();
  const d = new Date(ref.getTime() - 24 * 60 * 60 * 1000);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function getYesterdayInTimezone(timezone: string = 'Europe/London'): string {
  return getYesterdayYYYYMMDD(undefined, timezone);
}

export function formatTimeInTimezone(dateVal: any, timezone: string = 'Europe/London'): string {
  try {
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(d);
  } catch {
    return '12:00:00';
  }
}

export function toYYYYMMDD(val: any, timezone: string = 'Europe/London'): string {
  if (!val) return getCurrentDateInTimezone(timezone);
  const str = String(val).trim();
  if (!str) return getCurrentDateInTimezone(timezone);

  const lower = str.toLowerCase();
  if (lower === 'today') {
    return getCurrentDateInTimezone(timezone);
  }
  if (lower === 'yesterday') {
    return getYesterdayInTimezone(timezone);
  }

  const ymdMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2].padStart(2, '0')}-${ymdMatch[3].padStart(2, '0')}`;
  }

  const dmyMatch = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }

  const dMmmYMatch = str.match(/^(\d{1,2})-([A-Za-z]+)-(\d{4})/);
  if (dMmmYMatch) {
    const monthMap: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
      january: '01', february: '02', march: '03', april: '04', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
    };
    const mm = monthMap[dMmmYMatch[2].toLowerCase()] || '01';
    return `${dMmmYMatch[3]}-${mm}-${dMmmYMatch[1].padStart(2, '0')}`;
  }

  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const tz = timezone || 'Europe/London';
      try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        return formatter.format(d);
      } catch {
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }
    }
  } catch {}

  return str;
}

// ---------------------------------------------------------------------------
// User Profile Loading & Targets
// ---------------------------------------------------------------------------

export async function loadUserProfile(canonicalUid: string): Promise<any> {
  if (inMemoryMcpProfiles.has(canonicalUid)) {
    return inMemoryMcpProfiles.get(canonicalUid);
  }

  if (isD1Configured()) {
    try {
      const profRow = await d1GetProfile(canonicalUid);
      if (profRow?.data) {
        return profRow.data;
      }
    } catch (err: any) {
      console.warn('[Domain] d1GetProfile error:', err?.message);
    }
  }

  try {
    const syncFilePath = path.join(process.cwd(), 'data', 'sync', `${canonicalUid}_profile.json`);
    if (fs.existsSync(syncFilePath)) {
      const raw = fs.readFileSync(syncFilePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err: any) {
    console.warn('[Domain] Local sync file read error:', err?.message);
  }

  return {
    profile: {
      id: canonicalUid,
      email: `${canonicalUid}@health-tracker.co.uk`,
      targets: {
        calories: 1651
      }
    },
    report: {
      dailyNutrientTargets: {
        calories: '1,651 kcal'
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Domain Service 1: Meal Creation with Single Kcal Writer (finalizeDishLedger)
// ---------------------------------------------------------------------------

export interface CreateMealItemInput {
  name: string;
  weightGrams?: number;
  protein?: number;
  totalFat?: number;
  carbohydrates?: number;
  sodium?: number;
  saturatedFat?: number;
  addedSugar?: number;
  nutrients?: Record<string, number>;
  diningEnvironment?: string;
  cookingMethod?: string;
}

export interface CreateMealOptions {
  uid: string;
  date?: string;
  timezone?: string;
  name?: string;
  composition?: string;
  items: CreateMealItemInput[];
  imageUrls?: string[];
  chatTranscript?: any[];
  mealId?: string;
}

export async function finalizeAndCreateMeal(opts: CreateMealOptions): Promise<any> {
  const mealId = opts.mealId || `meal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const userTz = opts.timezone || 'Europe/London';
  const resolvedDate = toYYYYMMDD(opts.date, userTz);
  const nowTime = formatTimeInTimezone(new Date(), userTz);
  const dateIso = `${resolvedDate}T${nowTime}.000Z`;

  const ledgers: any[] = [];
  for (let idx = 0; idx < (opts.items || []).length; idx++) {
    const it = opts.items[idx];
    const weight = Number(it.weightGrams || 100) || 100;
    const sItem: any = {
      scoutIndex: idx,
      keyword: it.name,
      originalName: it.name,
      estimatedWeightGrams: weight,
      weightGrams: weight,
      diningEnvironment: it.diningEnvironment,
      cookingMethod: it.cookingMethod,
      nutrients: {
        protein: it.protein ?? it.nutrients?.protein ?? 0,
        totalFat: it.totalFat ?? it.nutrients?.totalFat ?? 0,
        carbohydrates: it.carbohydrates ?? it.nutrients?.carbohydrates ?? 0,
        sodium: it.sodium ?? it.nutrients?.sodium ?? 0,
        saturatedFat: it.saturatedFat ?? it.nutrients?.saturatedFat ?? 0,
        addedSugar: it.addedSugar ?? it.nutrients?.addedSugar ?? 0,
        ...(it.nutrients || {})
      }
    };
    const ledger = await finalizeDishLedger({
      item: sItem,
      nutrientBasisWeight: weight,
      consumedWeight: weight,
      diningEnvironment: it.diningEnvironment
    });
    ledgers.push(ledger);
  }

  const mealBook = buildMealFromFinalizeLedgers(ledgers, {
    mealName: opts.name || (ledgers.length > 0 ? ledgers[0].originalName : 'Logged Meal'),
    diningEnvironment: opts.items[0]?.diningEnvironment
  });

  const totals = sumItemNutrients(mealBook.items);
  const verdict = resolveMealVerdict({ ...mealBook, nutrients: totals });

  const mealRow: D1FoodRow = {
    id: mealId,
    firebase_uid: opts.uid,
    date: dateIso,
    name: opts.name || mealBook.name || 'Logged Meal',
    composition: opts.composition || mealBook.items.map((i: any) => i.name).join(', '),
    weight_grams: mealBook.weightGrams,
    calories: totals.calories ?? 0,
    saturated_fat: totals.saturatedFat ?? 0,
    sodium: totals.sodium ?? 0,
    added_sugar: totals.addedSugar ?? 0,
    nutrients: totals,
    items_breakdown: mealBook.items,
    image_urls: opts.imageUrls || [],
    chat_transcript: opts.chatTranscript || [],
    verdict: verdict ? (typeof verdict === 'object' ? JSON.stringify(verdict) : verdict) : null,
    updated_at: new Date().toISOString()
  };

  if (isD1Configured()) {
    await d1UpsertFoods([mealRow]);
  }

  // Update in-memory store
  const memList = inMemoryMcpFoods.get(opts.uid) || [];
  const existingIdx = memList.findIndex((m) => m && m.id === mealId);
  const memoryRecord = { ...mealRow, verdict };
  if (existingIdx !== -1) {
    memList[existingIdx] = memoryRecord;
  } else {
    memList.unshift(memoryRecord);
  }
  inMemoryMcpFoods.set(opts.uid, memList);

  return {
    ...mealRow,
    verdict,
    receiptTable: mealBook.receiptTable,
    date_local: toYYYYMMDD(dateIso, userTz),
    time_local: formatTimeInTimezone(dateIso, userTz),
    timezone: userTz
  };
}

export interface SimulateMealOptions {
  name?: string;
  items: CreateMealItemInput[];
  diningEnvironment?: string;
}

export async function simulateMealCalculation(opts: SimulateMealOptions): Promise<{
  name: string;
  items: any[];
  totals: any;
  weightGrams: number;
  verdict: any;
}> {
  const ledgers: any[] = [];
  for (let idx = 0; idx < (opts.items || []).length; idx++) {
    const it = opts.items[idx];
    const weight = Number(it.weightGrams || 100) || 100;
    const sItem: any = {
      scoutIndex: idx,
      keyword: it.name,
      originalName: it.name,
      estimatedWeightGrams: weight,
      weightGrams: weight,
      diningEnvironment: it.diningEnvironment || opts.diningEnvironment,
      cookingMethod: it.cookingMethod,
      nutrients: {
        protein: it.protein ?? it.nutrients?.protein ?? 0,
        totalFat: it.totalFat ?? it.nutrients?.totalFat ?? 0,
        carbohydrates: it.carbohydrates ?? it.nutrients?.carbohydrates ?? 0,
        sodium: it.sodium ?? it.nutrients?.sodium ?? 0,
        saturatedFat: it.saturatedFat ?? it.nutrients?.saturatedFat ?? 0,
        addedSugar: it.addedSugar ?? it.nutrients?.addedSugar ?? 0,
        ...(it.nutrients || {})
      }
    };
    const ledger = await finalizeDishLedger({
      item: sItem,
      nutrientBasisWeight: weight,
      consumedWeight: weight,
      diningEnvironment: it.diningEnvironment || opts.diningEnvironment
    });
    ledgers.push(ledger);
  }

  const mealBook = buildMealFromFinalizeLedgers(ledgers, {
    mealName: opts.name || (ledgers.length > 0 ? ledgers[0].originalName : 'Simulated Meal'),
    diningEnvironment: opts.items[0]?.diningEnvironment || opts.diningEnvironment
  });

  const totals = sumItemNutrients(mealBook.items);
  const verdict = resolveMealVerdict({ ...mealBook, nutrients: totals });

  return {
    name: opts.name || mealBook.name || 'Simulated Meal',
    items: mealBook.items,
    totals,
    weightGrams: mealBook.weightGrams,
    verdict
  };
}

// ---------------------------------------------------------------------------
// Domain Service 2: Meal Editing via server_meal_edit (applyMealEdits)
// ---------------------------------------------------------------------------

export interface EditMealOptions {
  uid: string;
  mealId: string;
  possibleUids: string[];
  timezone?: string;
  commands?: any[];
  userMessage?: string;
}

export async function editMealWithPatch(opts: EditMealOptions): Promise<any> {
  const userTz = opts.timezone || 'Europe/London';
  let existingMeal: any = null;

  for (const u of opts.possibleUids) {
    const memList = inMemoryMcpFoods.get(u);
    if (Array.isArray(memList)) {
      existingMeal = memList.find((m) => m && m.id === opts.mealId);
      if (existingMeal) break;
    }
  }

  if (!existingMeal && isD1Configured()) {
    existingMeal = await d1GetFullFoodRecord(opts.mealId, opts.possibleUids);
  }

  if (!existingMeal) {
    return { success: false, error: `Meal not found with ID "${opts.mealId}"` };
  }

  const currentItems = existingMeal.items_breakdown || [];
  const editResult = await applyMealEdits({
    items: currentItems,
    commands: opts.commands || [],
    userMessage: opts.userMessage || ''
  });

  if (editResult.refusedEmptyMeal) {
    return {
      success: false,
      refusedEmptyMeal: true,
      error: 'Cannot delete all items from a meal. Use delete action to delete the entire meal.'
    };
  }

  const updatedTotals = sumItemNutrients(editResult.items);
  const updatedVerdict = resolveMealVerdict({
    ...existingMeal,
    items_breakdown: editResult.items,
    nutrients: updatedTotals
  });

  const updatedMeal: D1FoodRow = {
    ...existingMeal,
    items_breakdown: editResult.items,
    weight_grams: editResult.weightGrams,
    calories: updatedTotals.calories ?? 0,
    saturated_fat: updatedTotals.saturatedFat ?? 0,
    sodium: updatedTotals.sodium ?? 0,
    added_sugar: updatedTotals.addedSugar ?? 0,
    nutrients: updatedTotals,
    composition: editResult.items.map((i: any) => i.name).join(', '),
    verdict: updatedVerdict ? (typeof updatedVerdict === 'object' ? JSON.stringify(updatedVerdict) : updatedVerdict) : null,
    updated_at: new Date().toISOString()
  };

  if (isD1Configured()) {
    await d1UpsertFoods([updatedMeal]);
  }

  for (const u of opts.possibleUids) {
    const list = inMemoryMcpFoods.get(u);
    if (Array.isArray(list)) {
      const idx = list.findIndex((m) => m && m.id === opts.mealId);
      if (idx !== -1) {
        list[idx] = { ...updatedMeal, verdict: updatedVerdict };
      }
    }
  }

  return {
    success: true,
    changed: editResult.changed,
    notes: editResult.notes,
    meal: {
      ...updatedMeal,
      verdict: updatedVerdict,
      date_local: toYYYYMMDD(updatedMeal.date, userTz),
      time_local: formatTimeInTimezone(updatedMeal.date, userTz),
      timezone: userTz
    }
  };
}

// ---------------------------------------------------------------------------
// Domain Service 3: Meal Deletion with D1 Removal & Profile Tombstones
// ---------------------------------------------------------------------------

export interface DeleteMealOptions {
  uid: string;
  mealId: string;
  possibleUids: string[];
}

export async function deleteMealLog(opts: DeleteMealOptions): Promise<any> {
  if (isD1Configured()) {
    await d1DeleteFoods([opts.mealId]);
  }

  for (const u of opts.possibleUids) {
    const list = inMemoryMcpFoods.get(u);
    if (Array.isArray(list)) {
      inMemoryMcpFoods.set(u, list.filter((m) => m && m.id !== opts.mealId));
    }
  }

  const nowMs = Date.now();
  const profileData = await loadUserProfile(opts.uid);
  const rawProfile = profileData.profile || profileData;

  if (!rawProfile.deletedFoodLogIds) rawProfile.deletedFoodLogIds = {};
  rawProfile.deletedFoodLogIds[opts.mealId] = nowMs;

  if (!profileData.deletedFoodLogIds) profileData.deletedFoodLogIds = {};
  profileData.deletedFoodLogIds[opts.mealId] = nowMs;

  const updatedProfile = {
    ...profileData,
    profile: rawProfile,
    updated_at: new Date().toISOString()
  };

  inMemoryMcpProfiles.set(opts.uid, updatedProfile);
  if (isD1Configured()) {
    await d1UpsertProfile(opts.uid, updatedProfile);
  }

  return {
    success: true,
    mealId: opts.mealId,
    deleted_at: nowMs
  };
}

// ---------------------------------------------------------------------------
// Domain Service 4: Biomarker Logging (Same-Date Merging & Plausibility)
// ---------------------------------------------------------------------------

export interface UpsertBiomarkerOptions {
  uid: string;
  possibleUids: string[];
  date: string;
  timezone?: string;
  readings: Record<string, any>;
  note?: string;
  summary?: string;
}

export async function upsertBiomarkerEntry(opts: UpsertBiomarkerOptions): Promise<any> {
  const userTz = opts.timezone || 'Europe/London';
  const targetDate = toYYYYMMDD(opts.date, userTz);

  let existingBio: any = null;
  for (const u of opts.possibleUids) {
    const memList = inMemoryMcpBiomarkers.get(u);
    if (Array.isArray(memList)) {
      existingBio = memList.find((b) => b && toYYYYMMDD(b.date, userTz) === targetDate);
      if (existingBio) break;
    }
  }

  if (!existingBio && isD1Configured()) {
    try {
      const all = await d1QueryBiomarkers(opts.possibleUids, 200);
      existingBio = all.find((b) => toYYYYMMDD(b.date, userTz) === targetDate);
    } catch (err: any) {
      console.warn('[Domain] d1QueryBiomarkers error:', err?.message);
    }
  }

  const normalizedReadings: Record<string, any> = {};
  const warnings: string[] = [];

  for (const [rawKey, rawVal] of Object.entries(opts.readings || {})) {
    const canonicalKey = getMappedBiomarkerKey(rawKey) || rawKey.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const numVal = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal).replace(/[^0-9.-]/g, ''));
    if (!isNaN(numVal) && isBiomarkerValueImprobable(canonicalKey, numVal)) {
      warnings.push(`Value ${rawVal} for ${canonicalKey} is flagged as improbable`);
    }
    normalizedReadings[canonicalKey] = rawVal;
  }

  const existingReadings = existingBio?.biomarkers || {};
  const mergedBiomarkers = {
    ...existingReadings,
    ...normalizedReadings
  };

  const recordId = existingBio?.id || `bio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const savedRow: D1BiomarkerRow = {
    id: recordId,
    firebase_uid: opts.uid,
    date: targetDate,
    biomarkers: mergedBiomarkers,
    note: opts.note || existingBio?.note || '',
    summary: opts.summary || existingBio?.summary || '',
    tests: existingBio?.tests || [],
    updated_at: new Date().toISOString()
  };

  if (isD1Configured()) {
    await d1UpsertBiomarkers([savedRow]);
  }

  const memList = inMemoryMcpBiomarkers.get(opts.uid) || [];
  const existingIdx = memList.findIndex((b) => b && b.id === recordId);
  if (existingIdx !== -1) {
    memList[existingIdx] = savedRow;
  } else {
    memList.unshift(savedRow);
  }
  inMemoryMcpBiomarkers.set(opts.uid, memList);

  return {
    success: true,
    record: {
      ...savedRow,
      date_local: targetDate,
      time_local: formatTimeInTimezone(new Date(), userTz),
      timezone: userTz
    },
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

// ---------------------------------------------------------------------------
// Domain Service 5: Biomarker Deletion (Field-level or Whole Record Tombstone)
// ---------------------------------------------------------------------------

export interface DeleteBiomarkerOptions {
  uid: string;
  possibleUids: string[];
  date?: string;
  recordId?: string;
  key?: string;
  timezone?: string;
}

export async function deleteBiomarkerEntry(opts: DeleteBiomarkerOptions): Promise<any> {
  const userTz = opts.timezone || 'Europe/London';
  const targetDate = opts.date ? toYYYYMMDD(opts.date, userTz) : null;
  let targetRecord: any = null;

  for (const u of opts.possibleUids) {
    const memList = inMemoryMcpBiomarkers.get(u);
    if (Array.isArray(memList)) {
      targetRecord = memList.find((b) =>
        b && ((opts.recordId && b.id === opts.recordId) || (targetDate && toYYYYMMDD(b.date, userTz) === targetDate))
      );
      if (targetRecord) break;
    }
  }

  if (!targetRecord && isD1Configured()) {
    const all = await d1QueryBiomarkers(opts.possibleUids, 200);
    targetRecord = all.find((b) =>
      b && ((opts.recordId && b.id === opts.recordId) || (targetDate && toYYYYMMDD(b.date, userTz) === targetDate))
    );
  }

  if (!targetRecord) {
    return { success: false, error: 'Biomarker record not found' };
  }

  if (opts.key) {
    const canonicalKey = getMappedBiomarkerKey(opts.key) || opts.key.toLowerCase();
    const currentBios = { ...(targetRecord.biomarkers || {}) };
    delete currentBios[canonicalKey];
    delete currentBios[opts.key];

    const updatedRow: D1BiomarkerRow = {
      ...targetRecord,
      biomarkers: currentBios,
      updated_at: new Date().toISOString()
    };

    if (isD1Configured()) {
      await d1UpsertBiomarkers([updatedRow]);
    }

    for (const u of opts.possibleUids) {
      const list = inMemoryMcpBiomarkers.get(u);
      if (Array.isArray(list)) {
        const idx = list.findIndex((b) => b && b.id === targetRecord.id);
        if (idx !== -1) list[idx] = updatedRow;
      }
    }

    return {
      success: true,
      deleted_key: opts.key,
      remaining_biomarkers: currentBios,
      record: updatedRow
    };
  }

  if (isD1Configured()) {
    await d1DeleteBiomarkers([targetRecord.id]);
  }

  for (const u of opts.possibleUids) {
    const list = inMemoryMcpBiomarkers.get(u);
    if (Array.isArray(list)) {
      inMemoryMcpBiomarkers.set(u, list.filter((b) => b && b.id !== targetRecord.id));
    }
  }

  const nowMs = Date.now();
  const profileData = await loadUserProfile(opts.uid);
  const rawProfile = profileData.profile || profileData;

  if (!rawProfile.deletedBiomarkerLogIds) rawProfile.deletedBiomarkerLogIds = {};
  rawProfile.deletedBiomarkerLogIds[targetRecord.id] = nowMs;

  if (!profileData.deletedBiomarkerLogIds) profileData.deletedBiomarkerLogIds = {};
  profileData.deletedBiomarkerLogIds[targetRecord.id] = nowMs;

  const updatedProfile = {
    ...profileData,
    profile: rawProfile,
    updated_at: new Date().toISOString()
  };

  inMemoryMcpProfiles.set(opts.uid, updatedProfile);
  if (isD1Configured()) {
    await d1UpsertProfile(opts.uid, updatedProfile);
  }

  return {
    success: true,
    deleted_id: targetRecord.id,
    deleted_at: nowMs
  };
}

// ---------------------------------------------------------------------------
// Domain Service 6: Clinical Health Actions & Daily Habits Management
// ---------------------------------------------------------------------------

export interface ManageActionsOptions {
  uid: string;
  action: 'add' | 'update' | 'toggle' | 'delete' | 'list';
  item?: Partial<HealthAction>;
  itemId?: string;
}

export async function manageUserActions(opts: ManageActionsOptions): Promise<any> {
  const profileData = await loadUserProfile(opts.uid);
  const rawProfile = profileData.profile || profileData;
  const actions: HealthAction[] = Array.isArray(rawProfile.actions)
    ? [...rawProfile.actions]
    : Array.isArray(profileData.actions)
    ? [...profileData.actions]
    : [];

  if (opts.action === 'list') {
    return { success: true, actions };
  }

  if (opts.action === 'add') {
    const newAction: HealthAction = {
      id: opts.item?.id || `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      task: opts.item?.task || 'New Health Action',
      explanation: opts.item?.explanation || '',
      priority: opts.item?.priority || 'medium',
      completed: opts.item?.completed || false,
      type: opts.item?.type || 'lifestyle',
      testName: opts.item?.testName,
      timeframe: opts.item?.timeframe,
      createdAt: Date.now(),
      updated_at: Date.now()
    };
    actions.unshift(newAction);
  } else if (opts.action === 'toggle') {
    const found = actions.find((a) => a.id === opts.itemId);
    if (found) {
      found.completed = !found.completed;
      found.updated_at = Date.now();
    }
  } else if (opts.action === 'update') {
    const found = actions.find((a) => a.id === opts.itemId);
    if (found && opts.item) {
      Object.assign(found, opts.item, { updated_at: Date.now() });
    }
  } else if (opts.action === 'delete') {
    const idx = actions.findIndex((a) => a.id === opts.itemId);
    if (idx !== -1) actions.splice(idx, 1);
  }

  rawProfile.actions = actions;
  profileData.actions = actions;
  const updatedData = { ...profileData, profile: rawProfile, updated_at: new Date().toISOString() };
  inMemoryMcpProfiles.set(opts.uid, updatedData);
  if (isD1Configured()) {
    await d1UpsertProfile(opts.uid, updatedData);
  }

  return { success: true, actions };
}

export interface ManageHabitsOptions {
  uid: string;
  action: 'add' | 'update' | 'toggle' | 'delete' | 'list';
  habit?: Partial<DailyBenefit>;
  habitId?: string;
}

export async function manageUserHabits(opts: ManageHabitsOptions): Promise<any> {
  const profileData = await loadUserProfile(opts.uid);
  const rawProfile = profileData.profile || profileData;
  const habits: DailyBenefit[] = Array.isArray(rawProfile.dailyBenefits)
    ? [...rawProfile.dailyBenefits]
    : Array.isArray(profileData.dailyBenefits)
    ? [...profileData.dailyBenefits]
    : [];

  if (opts.action === 'list') {
    return { success: true, dailyBenefits: habits };
  }

  if (opts.action === 'add') {
    const newHabit: DailyBenefit = {
      id: opts.habit?.id || `habit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      activity: opts.habit?.activity || 'New Habit',
      target: opts.habit?.target || 'Daily',
      completed: opts.habit?.completed || false,
      updated_at: Date.now()
    };
    habits.unshift(newHabit);
  } else if (opts.action === 'toggle') {
    const found = habits.find((h) => h.id === opts.habitId);
    if (found) {
      found.completed = !found.completed;
      found.updated_at = Date.now();
    }
  } else if (opts.action === 'update') {
    const found = habits.find((h) => h.id === opts.habitId);
    if (found && opts.habit) {
      Object.assign(found, opts.habit, { updated_at: Date.now() });
    }
  } else if (opts.action === 'delete') {
    const idx = habits.findIndex((h) => h.id === opts.habitId);
    if (idx !== -1) habits.splice(idx, 1);
  }

  rawProfile.dailyBenefits = habits;
  profileData.dailyBenefits = habits;
  const updatedData = { ...profileData, profile: rawProfile, updated_at: new Date().toISOString() };
  inMemoryMcpProfiles.set(opts.uid, updatedData);
  if (isD1Configured()) {
    await d1UpsertProfile(opts.uid, updatedData);
  }

  return { success: true, dailyBenefits: habits };
}

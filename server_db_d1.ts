/**
 * Cloudflare D1 Database Helper for Health-Tracker
 * Handles typed queries and mutations for food_logs, biomarker_logs, profiles, and agent_jobs.
 */
import { d1Query, safeJsonParse, isD1Configured, D1QueryResult } from './server_d1.js';
export { isD1Configured };

// ==========================================
// FOOD LOGS
// ==========================================

export interface D1FoodRow {
  id: string;
  firebase_uid: string;
  date: string;
  name: string;
  composition?: string;
  weight_grams?: number;
  quantity?: string;
  consumed_amount?: number;
  benefits?: string;
  risks?: string;
  health_impact?: string;
  recommendation?: string;
  verdict?: string | null;
  description?: string;
  message?: string;
  debug_url?: string;
  calories?: number;
  saturated_fat?: number;
  sodium?: number;
  added_sugar?: number;
  nutrients?: any;
  items_breakdown?: any;
  scout_items?: any;
  image_urls?: any;
  chat_transcript?: any;
  source_meal_id?: string;
  updated_at?: string;
}

export async function d1UpsertFoods(foods: D1FoodRow[]): Promise<{ success: boolean; count: number; error?: string }> {
  if (!foods || foods.length === 0) return { success: true, count: 0 };
  if (!isD1Configured()) return { success: false, count: 0, error: 'D1 not configured' };

  // Batch in chunks of 3 (3 * 27 = 81 variables) to stay strictly within Cloudflare D1 SQL variable limits
  const CHUNK_SIZE = 3;
  let totalUpserted = 0;

  for (let i = 0; i < foods.length; i += CHUNK_SIZE) {
    const chunk = foods.slice(i, i + CHUNK_SIZE);
    const valuePlaceholders: string[] = [];
    const params: any[] = [];

    for (const f of chunk) {
      valuePlaceholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      params.push(
        f.id,
        f.firebase_uid,
        f.date,
        f.name || '',
        f.composition || '',
        typeof f.weight_grams === 'number' ? f.weight_grams : 0,
        f.quantity || '',
        typeof f.consumed_amount === 'number' ? f.consumed_amount : 1,
        f.benefits || '',
        f.risks || '',
        f.health_impact || '',
        f.recommendation || null,
        typeof f.verdict === 'object' && f.verdict !== null ? JSON.stringify(f.verdict) : (f.verdict || null),
        f.description || '',
        f.message || '',
        f.debug_url || '',
        typeof f.calories === 'number' ? f.calories : 0,
        typeof f.saturated_fat === 'number' ? f.saturated_fat : 0,
        typeof f.sodium === 'number' ? f.sodium : 0,
        typeof f.added_sugar === 'number' ? f.added_sugar : 0,
        typeof f.nutrients === 'object' ? JSON.stringify(f.nutrients) : (f.nutrients || '{}'),
        Array.isArray(f.items_breakdown) ? JSON.stringify(f.items_breakdown) : (f.items_breakdown || '[]'),
        Array.isArray(f.scout_items) ? JSON.stringify(f.scout_items) : (f.scout_items || '[]'),
        Array.isArray(f.image_urls) ? JSON.stringify(f.image_urls) : (f.image_urls || '[]'),
        Array.isArray(f.chat_transcript) ? JSON.stringify(f.chat_transcript) : (f.chat_transcript || '[]'),
        typeof f.source_meal_id === 'string' ? f.source_meal_id : ((f as any).sourceMealId || ''),
        f.updated_at || new Date().toISOString()
      );
    }

    const sql = `
      INSERT INTO food_logs (
        id, firebase_uid, date, name, composition, weight_grams, quantity, consumed_amount,
        benefits, risks, health_impact, recommendation, verdict, description, message, debug_url,
        calories, saturated_fat, sodium, added_sugar, nutrients, items_breakdown, scout_items,
        image_urls, chat_transcript, source_meal_id, updated_at
      ) VALUES ${valuePlaceholders.join(', ')}
      ON CONFLICT(id) DO UPDATE SET
        firebase_uid = excluded.firebase_uid,
        date = excluded.date,
        name = excluded.name,
        composition = excluded.composition,
        weight_grams = excluded.weight_grams,
        quantity = excluded.quantity,
        consumed_amount = excluded.consumed_amount,
        benefits = excluded.benefits,
        risks = excluded.risks,
        health_impact = excluded.health_impact,
        recommendation = excluded.recommendation,
        verdict = excluded.verdict,
        description = excluded.description,
        message = excluded.message,
        debug_url = excluded.debug_url,
        calories = excluded.calories,
        saturated_fat = excluded.saturated_fat,
        sodium = excluded.sodium,
        added_sugar = excluded.added_sugar,
        nutrients = excluded.nutrients,
        items_breakdown = excluded.items_breakdown,
        scout_items = excluded.scout_items,
        image_urls = excluded.image_urls,
        chat_transcript = excluded.chat_transcript,
        source_meal_id = excluded.source_meal_id,
        updated_at = excluded.updated_at
    `;

    const res = await d1Query(sql, params);
    if (!res.success) {
      console.error('[D1 Food Upsert] Error:', res.error);
      return { success: false, count: totalUpserted, error: res.error };
    }
    totalUpserted += chunk.length;
  }

  return { success: true, count: totalUpserted };
}

export async function d1DeleteFoods(ids: string[]): Promise<{ success: boolean; error?: string }> {
  if (!ids || ids.length === 0) return { success: true };
  if (!isD1Configured()) return { success: false, error: 'D1 not configured' };

  const CHUNK_SIZE = 50;
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(', ');
    const res = await d1Query(`DELETE FROM food_logs WHERE id IN (${placeholders})`, chunk);
    if (!res.success) {
      console.error('[D1 Food Delete] Error:', res.error);
      return { success: false, error: res.error };
    }
  }
  return { success: true };
}

export async function d1GetFoodDetail(logId: string, possibleUids: string[]): Promise<any | null> {
  if (!isD1Configured() || !logId) return null;
  const placeholders = possibleUids.map(() => '?').join(', ');
  const sql = `SELECT id, composition, items_breakdown, scout_items, chat_transcript FROM food_logs WHERE id = ? AND firebase_uid IN (${placeholders}) LIMIT 1`;
  const res = await d1Query(sql, [logId, ...possibleUids]);
  if (!res.success || !res.results || res.results.length === 0) return null;
  const row = res.results[0];
  return {
    ...row,
    items_breakdown: safeJsonParse(row.items_breakdown, []),
    scout_items: safeJsonParse(row.scout_items, []),
    chat_transcript: safeJsonParse(row.chat_transcript, [])
  };
}

// ==========================================
// BIOMARKER LOGS
// ==========================================

export interface D1BiomarkerRow {
  id: string;
  firebase_uid: string;
  date: string;
  biomarkers?: any;
  note?: string;
  summary?: string;
  tests?: any;
  updated_at?: string;
}

export async function d1UpsertBiomarkers(bios: D1BiomarkerRow[]): Promise<{ success: boolean; count: number; error?: string }> {
  if (!bios || bios.length === 0) return { success: true, count: 0 };
  if (!isD1Configured()) return { success: false, count: 0, error: 'D1 not configured' };

  // Batch in chunks of 5 (5 * 8 = 40 variables) to stay strictly within Cloudflare D1 SQL variable limits
  const CHUNK_SIZE = 5;
  let totalUpserted = 0;

  for (let i = 0; i < bios.length; i += CHUNK_SIZE) {
    const chunk = bios.slice(i, i + CHUNK_SIZE);
    const valuePlaceholders: string[] = [];
    const params: any[] = [];

    for (const b of chunk) {
      valuePlaceholders.push('(?, ?, ?, ?, ?, ?, ?, ?)');
      params.push(
        b.id,
        b.firebase_uid,
        b.date,
        typeof b.biomarkers === 'object' ? JSON.stringify(b.biomarkers) : (b.biomarkers || '{}'),
        b.note || '',
        b.summary || '',
        Array.isArray(b.tests) ? JSON.stringify(b.tests) : (b.tests || '[]'),
        b.updated_at || new Date().toISOString()
      );
    }

    const sql = `
      INSERT INTO biomarker_logs (id, firebase_uid, date, biomarkers, note, summary, tests, updated_at)
      VALUES ${valuePlaceholders.join(', ')}
      ON CONFLICT(id) DO UPDATE SET
        firebase_uid = excluded.firebase_uid,
        date = excluded.date,
        biomarkers = excluded.biomarkers,
        note = excluded.note,
        summary = excluded.summary,
        tests = excluded.tests,
        updated_at = excluded.updated_at
    `;

    const res = await d1Query(sql, params);
    if (!res.success) {
      console.error('[D1 Biomarker Upsert] Error:', res.error);
      return { success: false, count: totalUpserted, error: res.error };
    }
    totalUpserted += chunk.length;
  }

  return { success: true, count: totalUpserted };
}

export async function d1DeleteBiomarkers(ids: string[]): Promise<{ success: boolean; error?: string }> {
  if (!ids || ids.length === 0) return { success: true };
  if (!isD1Configured()) return { success: false, error: 'D1 not configured' };

  const CHUNK_SIZE = 50;
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(', ');
    const res = await d1Query(`DELETE FROM biomarker_logs WHERE id IN (${placeholders})`, chunk);
    if (!res.success) {
      console.error('[D1 Biomarker Delete] Error:', res.error);
      return { success: false, error: res.error };
    }
  }
  return { success: true };
}

// ==========================================
// PROFILES
// ==========================================

export async function d1GetProfile(firebaseUid: string): Promise<any | null> {
  if (!isD1Configured()) return null;
  const res = await d1Query<any>('SELECT * FROM profiles WHERE firebase_uid = ? LIMIT 1', [firebaseUid]);
  if (!res.success || !res.results || res.results.length === 0) return null;
  const row = res.results[0];
  return {
    ...row,
    data: safeJsonParse(row.data, {})
  };
}

export async function d1UpsertProfile(firebaseUid: string, data: any): Promise<{ success: boolean; error?: string }> {
  if (!isD1Configured()) return { success: false, error: 'D1 not configured' };
  const jsonStr = typeof data === 'object' ? JSON.stringify(data) : String(data || '{}');
  const now = new Date().toISOString();

  const sql = `
    INSERT INTO profiles (id, firebase_uid, data, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(firebase_uid) DO UPDATE SET
      data = excluded.data,
      updated_at = excluded.updated_at
  `;

  const res = await d1Query(sql, [firebaseUid, firebaseUid, jsonStr, now]);
  if (!res.success) {
    console.error('[D1 Profile Upsert] Error:', res.error);
    return { success: false, error: res.error };
  }
  return { success: true };
}

// ==========================================
// PULL SYNC
// ==========================================

export interface D1PullOptions {
  possibleUids: string[];
  listOnly?: boolean;
  pageSize?: number;
  offset?: number;
  cursor?: { updated_at?: string; id?: string };
  lastSyncTime?: string;
}

export async function d1PullSync(opts: D1PullOptions): Promise<{
  foods: any[];
  biomarkers: any[];
  profiles: any[];
  totalFoodsCount?: number;
  totalBiomarkersCount?: number;
  error?: string;
}> {
  if (!isD1Configured()) {
    return { foods: [], biomarkers: [], profiles: [], error: 'D1 not configured' };
  }

  const { possibleUids, listOnly = true, pageSize = 500, offset, cursor, lastSyncTime } = opts;
  if (!possibleUids || possibleUids.length === 0) {
    return { foods: [], biomarkers: [], profiles: [], totalFoodsCount: 0, totalBiomarkersCount: 0 };
  }

  const limit = Math.min(pageSize || 500, 1000);
  const uidPlaceholders = possibleUids.map(() => '?').join(', ');

  // Columns
  const lightCols = 'id, firebase_uid, date, name, composition, weight_grams, quantity, consumed_amount, benefits, risks, health_impact, recommendation, calories, saturated_fat, sodium, added_sugar, nutrients, updated_at, verdict, description, message, debug_url, image_urls, source_meal_id';
  const fullCols = lightCols + ', items_breakdown, scout_items, chat_transcript';
  const foodCols = listOnly ? lightCols : fullCols;

  // Build food query
  let foodSql = `SELECT ${foodCols} FROM food_logs WHERE firebase_uid IN (${uidPlaceholders})`;
  const foodParams: any[] = [...possibleUids];

  if (cursor?.updated_at && cursor?.id) {
    foodSql += ` AND updated_at < ?`;
    foodParams.push(cursor.updated_at);
  } else if (lastSyncTime) {
    foodSql += ` AND updated_at >= ?`;
    foodParams.push(new Date(lastSyncTime).toISOString());
  }
  foodSql += ` ORDER BY updated_at DESC, id DESC LIMIT ?`;
  foodParams.push(limit);
  if (typeof offset === 'number' && offset > 0) {
    foodSql += ` OFFSET ?`;
    foodParams.push(offset);
  }

  // Build biomarker query
  let bioSql = `SELECT id, firebase_uid, date, biomarkers, note, summary, tests, updated_at FROM biomarker_logs WHERE firebase_uid IN (${uidPlaceholders})`;
  const bioParams: any[] = [...possibleUids];

  if (cursor?.updated_at && cursor?.id) {
    bioSql += ` AND updated_at < ?`;
    bioParams.push(cursor.updated_at);
  } else if (lastSyncTime) {
    bioSql += ` AND updated_at >= ?`;
    bioParams.push(new Date(lastSyncTime).toISOString());
  }
  bioSql += ` ORDER BY updated_at DESC, id DESC LIMIT ?`;
  bioParams.push(limit);
  if (typeof offset === 'number' && offset > 0) {
    bioSql += ` OFFSET ?`;
    bioParams.push(offset);
  }

  // Build profiles query
  const profSql = `SELECT firebase_uid, data, updated_at FROM profiles WHERE firebase_uid IN (${uidPlaceholders})`;
  const profParams: any[] = [...possibleUids];

  // Count queries for accurate total counts
  const countFoodSql = `SELECT count(*) as cnt FROM food_logs WHERE firebase_uid IN (${uidPlaceholders})`;
  const countBioSql = `SELECT count(*) as cnt FROM biomarker_logs WHERE firebase_uid IN (${uidPlaceholders})`;

  // Execute concurrently
  const [foodRes, bioRes, profRes, countFoodRes, countBioRes] = await Promise.all([
    d1Query<any>(foodSql, foodParams),
    d1Query<any>(bioSql, bioParams),
    d1Query<any>(profSql, profParams),
    d1Query<any>(countFoodSql, possibleUids),
    d1Query<any>(countBioSql, possibleUids)
  ]);

  if (!foodRes.success) console.error('[D1 Pull] food query error:', foodRes.error);
  if (!bioRes.success) console.error('[D1 Pull] bio query error:', bioRes.error);
  if (!profRes.success) console.error('[D1 Pull] prof query error:', profRes.error);

  const rawFoods = (foodRes.results || []).map((row: any) => ({
    ...row,
    nutrients: safeJsonParse(row.nutrients, {}),
    items_breakdown: safeJsonParse(row.items_breakdown, []),
    scout_items: safeJsonParse(row.scout_items, []),
    image_urls: safeJsonParse(row.image_urls, []),
    chat_transcript: safeJsonParse(row.chat_transcript, []),
  }));

  const rawBiomarkers = (bioRes.results || []).map((row: any) => ({
    ...row,
    biomarkers: safeJsonParse(row.biomarkers, {}),
    tests: safeJsonParse(row.tests, []),
  }));

  const profiles = (profRes.results || []).map((row: any) => ({
    ...row,
    data: safeJsonParse(row.data, {}),
  }));

  const totalFoodsCount = countFoodRes.success && countFoodRes.results?.[0]?.cnt != null
    ? Number(countFoodRes.results[0].cnt)
    : rawFoods.length;
  const totalBiomarkersCount = countBioRes.success && countBioRes.results?.[0]?.cnt != null
    ? Number(countBioRes.results[0].cnt)
    : rawBiomarkers.length;

  return { foods: rawFoods, biomarkers: rawBiomarkers, profiles, totalFoodsCount, totalBiomarkersCount };
}

export interface D1SearchFoodOptions {
  possibleUids: string[];
  query: string;
  limit?: number;
}

export async function d1SearchUserFoodLogs(opts: D1SearchFoodOptions): Promise<any[]> {
  if (!isD1Configured() || !opts.possibleUids?.length || !opts.query?.trim()) return [];
  const limit = Math.min(opts.limit || 5, 20);
  const uidPlaceholders = opts.possibleUids.map(() => '?').join(', ');
  const sql = `SELECT id, name, calories, nutrients, items_breakdown, image_urls, date, weight_grams, quantity, consumed_amount, source_meal_id 
               FROM food_logs 
               WHERE firebase_uid IN (${uidPlaceholders}) AND name LIKE ? 
               ORDER BY updated_at DESC LIMIT ?`;
  const pattern = `%${opts.query.trim()}%`;
  const res = await d1Query<any>(sql, [...opts.possibleUids, pattern, limit]);
  if (!res.success || !res.results) return [];
  return res.results.map((row: any) => ({
    ...row,
    nutrients: safeJsonParse(row.nutrients, {}),
    items_breakdown: safeJsonParse(row.items_breakdown, []),
    image_urls: safeJsonParse(row.image_urls, []),
  }));
}

/**
 * Batch-fetch usable photo URLs for `ref:<id>` pointer targets.
 * Scoped to the caller's uids so one user can never resolve another's photos.
 */
export async function d1GetFoodLogImageUrls(ids: string[], possibleUids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const cleanIds = Array.from(new Set((ids || []).map((s) => String(s || '').trim()).filter(Boolean))).slice(0, 20);
  const cleanUids = Array.from(new Set((possibleUids || []).map((s) => String(s || '').trim()).filter(Boolean)));
  if (!isD1Configured() || cleanIds.length === 0 || cleanUids.length === 0) return out;
  const idPlaceholders = cleanIds.map(() => '?').join(', ');
  const uidPlaceholders = cleanUids.map(() => '?').join(', ');
  const sql = `SELECT id, image_urls FROM food_logs WHERE id IN (${idPlaceholders}) AND firebase_uid IN (${uidPlaceholders})`;
  const res = await d1Query<any>(sql, [...cleanIds, ...cleanUids]);
  if (!res.success || !res.results) return out;
  for (const row of res.results) {
    const urls = safeJsonParse(row.image_urls, []);
    const list = (Array.isArray(urls) ? urls : [urls]).filter((u: unknown) => typeof u === 'string' && (u as string).trim());
    if (row?.id && list.length > 0) out.set(String(row.id), list as string[]);
  }
  return out;
}

// ==========================================
// AGENT JOBS
// ==========================================

export interface D1JobRecord {
  id: string;
  user_id: string;
  kind: string;
  mode?: string;
  status?: string;
  progress_percent?: number;
  status_message?: string;
  photo_url?: string;
  debug_url?: string;
  clean_result?: any;
  current_turn?: number;
  created_at?: string;
  updated_at?: string;
}

export async function d1UpsertJob(job: D1JobRecord): Promise<{ success: boolean; error?: string }> {
  if (!isD1Configured()) return { success: false, error: 'D1 not configured' };
  if (!job || !job.id || !job.user_id) return { success: false, error: 'Missing job.id or job.user_id' };

  // Guard clean_result size: if clean_result is large and lacks is_r2 pointer, stringify safely
  let cleanResultStr = '{}';
  if (job.clean_result !== undefined) {
    if (typeof job.clean_result === 'object') {
      cleanResultStr = JSON.stringify(job.clean_result);
    } else {
      cleanResultStr = String(job.clean_result);
    }
  }

  const now = new Date().toISOString();
  const sql = `
    INSERT INTO agent_jobs (
      id, user_id, kind, mode, status, progress_percent, status_message,
      photo_url, debug_url, clean_result, current_turn, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      kind = excluded.kind,
      mode = excluded.mode,
      status = excluded.status,
      progress_percent = excluded.progress_percent,
      status_message = excluded.status_message,
      photo_url = excluded.photo_url,
      debug_url = excluded.debug_url,
      clean_result = excluded.clean_result,
      current_turn = excluded.current_turn,
      updated_at = excluded.updated_at
  `;

  const params = [
    job.id,
    job.user_id,
    job.kind || 'food',
    job.mode || 'review',
    job.status || 'queued',
    typeof job.progress_percent === 'number' ? job.progress_percent : 0,
    job.status_message || null,
    job.photo_url || null,
    job.debug_url || null,
    cleanResultStr,
    typeof job.current_turn === 'number' ? job.current_turn : 1,
    job.created_at || now,
    job.updated_at || now
  ];

  const res = await d1Query(sql, params);
  if (!res.success) {
    console.error(`[D1 Job Upsert] Error for ${job.id}:`, res.error);
    return { success: false, error: res.error };
  }
  return { success: true };
}

export async function d1UpdateJob(jobId: string, updates: Partial<D1JobRecord>): Promise<{ success: boolean; error?: string }> {
  if (!isD1Configured()) return { success: false, error: 'D1 not configured' };
  if (!jobId) return { success: false, error: 'jobId is required' };

  const setClauses: string[] = [];
  const params: any[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'id') continue;
    if (key === 'clean_result') {
      setClauses.push('clean_result = ?');
      params.push(typeof value === 'object' ? JSON.stringify(value) : String(value ?? '{}'));
    } else {
      setClauses.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (setClauses.length === 0) return { success: true };

  // Always update updated_at if not explicitly provided
  if (!updates.updated_at) {
    setClauses.push('updated_at = ?');
    params.push(new Date().toISOString());
  }

  params.push(jobId);
  const sql = `UPDATE agent_jobs SET ${setClauses.join(', ')} WHERE id = ?`;

  const res = await d1Query(sql, params);
  if (!res.success) {
    console.error(`[D1 Job Update] Error for ${jobId}:`, res.error);
    return { success: false, error: res.error };
  }
  return { success: true };
}

export async function d1GetJob(jobId: string): Promise<any | null> {
  if (!isD1Configured() || !jobId) return null;
  const res = await d1Query<any>('SELECT * FROM agent_jobs WHERE id = ? LIMIT 1', [jobId]);
  if (!res.success || !res.results || res.results.length === 0) return null;
  const row = res.results[0];
  return {
    ...row,
    clean_result: safeJsonParse(row.clean_result, null)
  };
}

export async function d1ListJobs(filter: { jobId?: string; userId?: string; isFull?: boolean; limit?: number }): Promise<any[]> {
  if (!isD1Configured()) return [];
  const { jobId, userId, isFull = false, limit = 20 } = filter;

  const cols = isFull ? '*' : 'id, user_id, kind, mode, status, progress_percent, status_message, current_turn, updated_at';
  let sql = `SELECT ${cols} FROM agent_jobs WHERE `;
  const params: any[] = [];

  if (jobId) {
    sql += 'id = ?';
    params.push(jobId);
  } else if (userId) {
    sql += 'user_id = ?';
    params.push(userId);
  } else {
    sql += '1=1';
  }

  sql += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(limit);

  const res = await d1Query<any>(sql, params);
  if (!res.success || !res.results) return [];

  return res.results.map((row: any) => ({
    ...row,
    clean_result: isFull ? safeJsonParse(row.clean_result, null) : undefined
  }));
}

export async function d1DeleteJob(jobId: string): Promise<{ success: boolean; error?: string }> {
  if (!isD1Configured() || !jobId) return { success: true };
  const res = await d1Query('DELETE FROM agent_jobs WHERE id = ?', [jobId]);
  if (!res.success) {
    console.error(`[D1 Job Delete] Error for ${jobId}:`, res.error);
    return { success: false, error: res.error };
  }
  return { success: true };
}

export async function d1GetStuckJobs(staleMs: number = 300000): Promise<any[]> {
  if (!isD1Configured()) return [];
  const thresholdIso = new Date(Date.now() - staleMs).toISOString();
  const sql = `SELECT * FROM agent_jobs WHERE status IN ('queued', 'running') AND updated_at < ? LIMIT 50`;
  const res = await d1Query<any>(sql, [thresholdIso]);
  if (!res.success || !res.results) return [];
  return res.results.map((row: any) => ({
    ...row,
    clean_result: safeJsonParse(row.clean_result, null)
  }));
}

// ==========================================
// NUTRITION & FOOD CATALOG (D1)
// ==========================================

export async function d1GetChainMenuSources(countryCode: string = 'GB'): Promise<any[]> {
  if (!isD1Configured()) return [];
  const sql = `SELECT * FROM chain_menu_sources WHERE country_code = ? ORDER BY chain_key ASC`;
  const res = await d1Query(sql, [countryCode]);
  if (!res.success || !res.results) return [];
  return res.results.map((r: any) => ({
    ...r,
    enabled: Boolean(r.enabled),
  }));
}

export async function d1UpsertChainMenuSource(row: any): Promise<{ success: boolean; data?: any; error?: string }> {
  if (!isD1Configured()) return { success: false, error: 'D1 not configured' };
  const id = row.id || `chain_${row.chain_key}`;
  const sql = `
    INSERT INTO chain_menu_sources (
      id, country_code, chain_key, display_name, url, source_kind, status, priority, enabled, last_success_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      country_code = excluded.country_code,
      chain_key = excluded.chain_key,
      display_name = excluded.display_name,
      url = excluded.url,
      source_kind = excluded.source_kind,
      status = excluded.status,
      priority = excluded.priority,
      enabled = excluded.enabled,
      last_success_at = excluded.last_success_at,
      updated_at = excluded.updated_at
  `;
  const params = [
    id,
    row.country_code || 'GB',
    row.chain_key,
    row.display_name || row.chain_key,
    row.url || '',
    row.source_kind || 'unknown',
    row.status || 'pending',
    typeof row.priority === 'number' ? row.priority : 100,
    row.enabled !== false ? 1 : 0,
    row.last_success_at || null,
  ];
  const res = await d1Query(sql, params);
  if (!res.success) return { success: false, error: res.error };
  return { success: true, data: { ...row, id, enabled: row.enabled !== false } };
}

export async function d1DeleteChainMenuSource(id?: string, chainKey?: string): Promise<{ success: boolean; error?: string }> {
  if (!isD1Configured()) return { success: true };
  if (id) {
    await d1Query('DELETE FROM chain_menu_sources WHERE id = ?', [id]);
  }
  if (chainKey) {
    await d1Query('DELETE FROM chain_menu_sources WHERE chain_key = ?', [chainKey]);
    await d1Query('DELETE FROM brand_menu_items WHERE chain_key = ?', [chainKey]);
  }
  return { success: true };
}

export async function d1GetBrandMenuItems(chainKey?: string, countryCode?: string): Promise<any[]> {
  if (!isD1Configured()) return [];
  let sql = `SELECT * FROM brand_menu_items WHERE status != 'quarantined'`;
  const params: any[] = [];
  if (chainKey) {
    sql += ` AND chain_key = ?`;
    params.push(chainKey);
  }
  if (countryCode) {
    sql += ` AND country_code = ?`;
    params.push(countryCode);
  }
  sql += ` ORDER BY dish_name ASC LIMIT 500`;
  const res = await d1Query(sql, params);
  if (!res.success || !res.results) return [];
  return res.results.map((r: any) => ({
    ...r,
    nutrients: safeJsonParse(r.nutrients, {}),
    enabled: Boolean(r.enabled),
  }));
}

export async function d1SearchBrandMenuItems(q: string, countryCode: string = 'GB'): Promise<any[]> {
  if (!isD1Configured() || !q) return [];
  const sql = `SELECT * FROM brand_menu_items WHERE country_code = ? AND status != 'quarantined' AND dish_name LIKE ? LIMIT 50`;
  const res = await d1Query(sql, [countryCode, `%${q}%`]);
  if (!res.success || !res.results) return [];
  return res.results.map((r: any) => ({
    ...r,
    nutrients: safeJsonParse(r.nutrients, {}),
    enabled: Boolean(r.enabled),
  }));
}

export async function d1UpsertBrandMenuItem(item: any): Promise<{ success: boolean; error?: string }> {
  if (!isD1Configured()) return { success: false, error: 'D1 not configured' };
  const id = item.id || `bmi_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const sql = `
    INSERT INTO brand_menu_items (
      id, country_code, chain_key, chain_name, dish_name, dish_name_key, basis_type, serving_grams,
      calories, protein, carbohydrates, total_fat, saturated_fat, sodium, sugar, total_fibre,
      nutrients, ingredients, source_url, image_url, notes, enabled, status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      country_code = excluded.country_code,
      chain_key = excluded.chain_key,
      chain_name = excluded.chain_name,
      dish_name = excluded.dish_name,
      dish_name_key = excluded.dish_name_key,
      basis_type = excluded.basis_type,
      serving_grams = excluded.serving_grams,
      calories = excluded.calories,
      protein = excluded.protein,
      carbohydrates = excluded.carbohydrates,
      total_fat = excluded.total_fat,
      saturated_fat = excluded.saturated_fat,
      sodium = excluded.sodium,
      sugar = excluded.sugar,
      total_fibre = excluded.total_fibre,
      nutrients = excluded.nutrients,
      ingredients = excluded.ingredients,
      source_url = excluded.source_url,
      image_url = excluded.image_url,
      notes = excluded.notes,
      enabled = excluded.enabled,
      status = excluded.status,
      updated_at = excluded.updated_at
  `;
  const nutrientsStr = typeof item.nutrients === 'object' ? JSON.stringify(item.nutrients) : String(item.nutrients || '{}');
  const params = [
    id,
    item.country_code || 'GB',
    item.chain_key || '',
    item.chain_name || item.chain_key || '',
    item.dish_name || '',
    item.dish_name_key || null,
    item.basis_type || 'per_100g',
    item.serving_grams || null,
    item.calories ?? item.nutrients?.calories ?? 0,
    item.protein ?? item.nutrients?.protein ?? 0,
    item.carbohydrates ?? item.nutrients?.carbohydrates ?? 0,
    item.total_fat ?? item.nutrients?.totalFat ?? 0,
    item.saturated_fat ?? item.nutrients?.saturatedFat ?? 0,
    item.sodium ?? item.nutrients?.sodium ?? 0,
    item.sugar ?? item.nutrients?.sugar ?? 0,
    item.total_fibre ?? item.nutrients?.totalFibre ?? item.nutrients?.fiber ?? 0,
    nutrientsStr,
    item.ingredients || '',
    item.source_url || '',
    item.image_url || item.imageUrl || null,
    item.notes || '',
    item.enabled !== false ? 1 : 0,
    item.status || 'active',
  ];
  return d1Query(sql, params);
}

export async function d1DeleteBrandMenuItem(id: string): Promise<{ success: boolean; error?: string }> {
  if (!isD1Configured() || !id) return { success: true };
  return d1Query('DELETE FROM brand_menu_items WHERE id = ?', [id]);
}

export async function d1GetFoodCatalogItems(
  itemType: 'food' | 'dish',
  statusFilter: string = 'all',
  searchQuery: string = '',
  limit: number = 100
): Promise<any[]> {
  if (!isD1Configured()) return [];
  const table = itemType === 'dish' ? 'dish_cache' : 'food_items';
  let sql = `SELECT * FROM ${table} WHERE 1=1`;
  const params: any[] = [];
  if (statusFilter !== 'all') {
    sql += ` AND status = ?`;
    params.push(statusFilter);
  }
  if (searchQuery) {
    sql += ` AND display_name LIKE ?`;
    params.push(`%${searchQuery}%`);
  }
  sql += ` ORDER BY updated_at DESC LIMIT ?`;
  params.push(limit);

  const res = await d1Query(sql, params);
  if (!res.success || !res.results) return [];
  return res.results.map((r: any) => ({
    ...r,
    nutrients_per_100g: safeJsonParse(r.nutrients_per_100g, {}),
    core_nutrients: safeJsonParse(r.core_nutrients, {}),
  }));
}

export async function d1UpdateFoodServing(
  itemType: 'food' | 'dish',
  key: string,
  basisType: string,
  servingGrams: number
): Promise<{ success: boolean; error?: string }> {
  if (!isD1Configured()) return { success: false, error: 'D1 not configured' };
  if (itemType === 'dish') {
    const sql = `UPDATE dish_cache SET basis_type = ?, serving_grams = ?, updated_at = datetime('now') WHERE dish_key = ?`;
    return d1Query(sql, [basisType, servingGrams, key]);
  } else {
    const sql = `UPDATE food_items SET standard_serving_g = ?, updated_at = datetime('now') WHERE food_key = ? OR food_id = ?`;
    return d1Query(sql, [servingGrams, key, key]);
  }
}

export async function d1UpdateItemStatus(
  itemType: 'food' | 'dish',
  key: string,
  status: string
): Promise<{ success: boolean; error?: string }> {
  if (!isD1Configured()) return { success: false, error: 'D1 not configured' };
  const table = itemType === 'dish' ? 'dish_cache' : 'food_items';
  const keyCol = itemType === 'dish' ? 'dish_key' : 'food_key';
  const sql = `UPDATE ${table} SET status = ?, updated_at = datetime('now') WHERE ${keyCol} = ?`;
  return d1Query(sql, [status, key]);
}

export async function d1GetCatalogMetrics(): Promise<{
  success: boolean;
  food_items: { total: number; active: number; candidate: number };
  dish_cache: { total: number; active: number };
  open_deferred_gaps: number;
  sync_failures: number;
  resolver_call_count: number;
  latest_sync_events: any[];
}> {
  if (!isD1Configured()) {
    return {
      success: true,
      food_items: { total: 0, active: 0, candidate: 0 },
      dish_cache: { total: 0, active: 0 },
      open_deferred_gaps: 0,
      sync_failures: 0,
      resolver_call_count: 0,
      latest_sync_events: [],
    };
  }
  const [fTot, fAct, fCand, dTot, dAct] = await Promise.all([
    d1Query('SELECT COUNT(*) as c FROM food_items'),
    d1Query("SELECT COUNT(*) as c FROM food_items WHERE status = 'active'"),
    d1Query("SELECT COUNT(*) as c FROM food_items WHERE status = 'candidate'"),
    d1Query('SELECT COUNT(*) as c FROM dish_cache'),
    d1Query("SELECT COUNT(*) as c FROM dish_cache WHERE status = 'active'"),
  ]);
  return {
    success: true,
    food_items: {
      total: fTot.results?.[0]?.c || 0,
      active: fAct.results?.[0]?.c || 0,
      candidate: fCand.results?.[0]?.c || 0,
    },
    dish_cache: {
      total: dTot.results?.[0]?.c || 0,
      active: dAct.results?.[0]?.c || 0,
    },
    open_deferred_gaps: 0,
    sync_failures: 0,
    resolver_call_count: 0,
    latest_sync_events: [],
  };
}


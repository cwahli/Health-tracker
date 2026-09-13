/**
 * Cloudflare D1 Database Helper for Health-Tracker
 * Handles typed queries and mutations for food_logs, biomarker_logs, profiles, and agent_jobs.
 */
import { d1Query, safeJsonParse, isD1Configured, D1QueryResult } from './server_d1.js';

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
  updated_at?: string;
}

export async function d1UpsertFoods(foods: D1FoodRow[]): Promise<{ success: boolean; count: number; error?: string }> {
  if (!foods || foods.length === 0) return { success: true, count: 0 };
  if (!isD1Configured()) return { success: false, count: 0, error: 'D1 not configured' };

  // Batch in chunks of 3 (3 * 26 = 78 variables) to stay strictly within Cloudflare D1 SQL variable limits
  const CHUNK_SIZE = 3;
  let totalUpserted = 0;

  for (let i = 0; i < foods.length; i += CHUNK_SIZE) {
    const chunk = foods.slice(i, i + CHUNK_SIZE);
    const valuePlaceholders: string[] = [];
    const params: any[] = [];

    for (const f of chunk) {
      valuePlaceholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
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
        f.verdict || null,
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
        f.updated_at || new Date().toISOString()
      );
    }

    const sql = `
      INSERT INTO food_logs (
        id, firebase_uid, date, name, composition, weight_grams, quantity, consumed_amount,
        benefits, risks, health_impact, recommendation, verdict, description, message, debug_url,
        calories, saturated_fat, sodium, added_sugar, nutrients, items_breakdown, scout_items,
        image_urls, chat_transcript, updated_at
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
  cursor?: { updated_at?: string; id?: string };
  lastSyncTime?: string;
}

export async function d1PullSync(opts: D1PullOptions): Promise<{
  foods: any[];
  biomarkers: any[];
  profiles: any[];
  error?: string;
}> {
  if (!isD1Configured()) {
    return { foods: [], biomarkers: [], profiles: [], error: 'D1 not configured' };
  }

  const { possibleUids, listOnly = true, pageSize = 500, cursor, lastSyncTime } = opts;
  if (!possibleUids || possibleUids.length === 0) {
    return { foods: [], biomarkers: [], profiles: [] };
  }

  const limit = Math.min(pageSize || 500, 1000);
  const uidPlaceholders = possibleUids.map(() => '?').join(', ');

  // Columns
  const lightCols = 'id, firebase_uid, date, name, composition, weight_grams, quantity, consumed_amount, benefits, risks, health_impact, recommendation, calories, saturated_fat, sodium, added_sugar, nutrients, updated_at, verdict, description, message, debug_url, image_urls';
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

  // Build profiles query
  const profSql = `SELECT firebase_uid, data, updated_at FROM profiles WHERE firebase_uid IN (${uidPlaceholders})`;
  const profParams: any[] = [...possibleUids];

  // Execute concurrently
  const [foodRes, bioRes, profRes] = await Promise.all([
    d1Query<any>(foodSql, foodParams),
    d1Query<any>(bioSql, bioParams),
    d1Query<any>(profSql, profParams)
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

  return { foods: rawFoods, biomarkers: rawBiomarkers, profiles };
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

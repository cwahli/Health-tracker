/**
 * Cloudflare D1 Database Schema Definitions & Initializer.
 * Provides SQLite DDL for Health-tracker tables.
 */
import { d1Exec, d1Query, isD1Configured } from './server_d1.js';

export const D1_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agent_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'review',
  status TEXT NOT NULL DEFAULT 'queued',
  progress_percent INTEGER DEFAULT 0,
  status_message TEXT,
  photo_url TEXT,
  debug_url TEXT,
  clean_result TEXT,
  current_turn INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_user_updated ON agent_jobs(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS food_logs (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  composition TEXT DEFAULT '',
  weight_grams REAL DEFAULT 0,
  quantity TEXT DEFAULT '',
  consumed_amount REAL DEFAULT 1,
  benefits TEXT DEFAULT '',
  risks TEXT DEFAULT '',
  health_impact TEXT DEFAULT '',
  recommendation TEXT DEFAULT 'good',
  verdict TEXT,
  description TEXT DEFAULT '',
  message TEXT DEFAULT '',
  debug_url TEXT DEFAULT '',
  calories REAL DEFAULT 0,
  saturated_fat REAL DEFAULT 0,
  sodium REAL DEFAULT 0,
  added_sugar REAL DEFAULT 0,
  nutrients TEXT DEFAULT '{}',
  items_breakdown TEXT DEFAULT '[]',
  scout_items TEXT DEFAULT '[]',
  image_urls TEXT DEFAULT '[]',
  chat_transcript TEXT DEFAULT '[]',
  source_meal_id TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_food_logs_uid_updated ON food_logs(firebase_uid, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_food_logs_uid_date ON food_logs(firebase_uid, date DESC);

CREATE TABLE IF NOT EXISTS biomarker_logs (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL,
  date TEXT NOT NULL,
  biomarkers TEXT DEFAULT '{}',
  note TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  tests TEXT DEFAULT '[]',
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_biomarker_logs_uid_updated ON biomarker_logs(firebase_uid, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_biomarker_logs_uid_date ON biomarker_logs(firebase_uid, date DESC);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_profiles_uid ON profiles(firebase_uid);

CREATE TABLE IF NOT EXISTS issue_tags (
  id TEXT PRIMARY KEY,
  title TEXT,
  title_key TEXT,
  category TEXT DEFAULT 'foodcart',
  status TEXT DEFAULT 'open',
  comments TEXT,
  resolution_note TEXT DEFAULT '',
  whats_still_open TEXT DEFAULT '',
  work_item TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS issue_backlog (
  id TEXT PRIMARY KEY,
  tag_id TEXT,
  status TEXT DEFAULT 'open',
  issue_type TEXT DEFAULT '',
  severity TEXT DEFAULT '',
  country_code TEXT DEFAULT '',
  chain_key TEXT DEFAULT '',
  dish_query TEXT DEFAULT '',
  context TEXT DEFAULT '',
  source_url TEXT DEFAULT '',
  user_note TEXT DEFAULT '',
  resolution_note TEXT DEFAULT '',
  ever_tagged INTEGER DEFAULT 0,
  firebase_uid TEXT DEFAULT '',
  payload TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS issue_tag_links (
  id TEXT PRIMARY KEY,
  tag_id TEXT,
  backlog_id TEXT,
  issue_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  nickname TEXT DEFAULT '',
  user_type TEXT DEFAULT 'Standard',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users(email);

CREATE TABLE IF NOT EXISTS chain_menu_sources (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL DEFAULT 'GB',
  chain_key TEXT NOT NULL,
  display_name TEXT,
  url TEXT,
  source_kind TEXT DEFAULT 'unknown',
  status TEXT DEFAULT 'pending',
  priority INTEGER DEFAULT 100,
  enabled INTEGER DEFAULT 1,
  last_success_at TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chain_menu_sources_country_key ON chain_menu_sources(country_code, chain_key);

CREATE TABLE IF NOT EXISTS brand_menu_items (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL DEFAULT 'GB',
  chain_key TEXT NOT NULL,
  chain_name TEXT,
  dish_name TEXT NOT NULL,
  dish_name_key TEXT,
  basis_type TEXT DEFAULT 'per_100g',
  serving_grams REAL,
  calories REAL,
  protein REAL,
  carbohydrates REAL,
  total_fat REAL,
  saturated_fat REAL,
  sodium REAL,
  sugar REAL,
  added_sugar REAL,
  total_fibre REAL,
  nutrients TEXT DEFAULT '{}',
  ingredients TEXT,
  source_url TEXT,
  image_url TEXT,
  notes TEXT,
  enabled INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_brand_menu_items_chain ON brand_menu_items(chain_key, country_code);
CREATE INDEX IF NOT EXISTS idx_brand_menu_items_dish ON brand_menu_items(dish_name);

CREATE TABLE IF NOT EXISTS food_items (
  food_id TEXT PRIMARY KEY,
  food_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  brand_name TEXT,
  basis_type TEXT DEFAULT 'per_100g',
  nutrients_per_100g TEXT DEFAULT '{}',
  standard_serving_g REAL,
  confidence REAL DEFAULT 1.0,
  status TEXT DEFAULT 'active',
  source TEXT DEFAULT 'canonical_local',
  fdc_id TEXT,
  version INTEGER DEFAULT 1,
  capture_count INTEGER DEFAULT 1,
  canonical_target_id TEXT,
  form_tags TEXT DEFAULT '[]',
  state TEXT,
  provenance TEXT DEFAULT 'resolver_candidate',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_food_items_key ON food_items(food_key);

CREATE TABLE IF NOT EXISTS dish_cache (
  dish_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  core_nutrients TEXT DEFAULT '{}',
  basis_type TEXT DEFAULT 'prepared',
  serving_grams REAL DEFAULT 100,
  confidence REAL DEFAULT 1.0,
  status TEXT DEFAULT 'active',
  version INTEGER DEFAULT 1,
  provenance TEXT DEFAULT 'resolver_dish_core',
  components TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dish_aliases (
  alias_key TEXT PRIMARY KEY,
  dish_key TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS food_cache (
  id TEXT PRIMARY KEY,
  provider TEXT,
  query_or_id TEXT,
  name TEXT,
  nutrients TEXT DEFAULT '{}',
  fetched_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  meta TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS food_aliases (
  alias_key TEXT PRIMARY KEY,
  food_id TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  source TEXT DEFAULT 'food_resolver',
  hit_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS food_observations (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT,
  event_type TEXT NOT NULL,
  snapshots TEXT,
  payload TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_food_observations_event ON food_observations(event_type);

CREATE TABLE IF NOT EXISTS food_catalog_sync_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

let schemaEnsured = false;

export async function ensureNutritionD1Seed(): Promise<void> {
  if (!isD1Configured()) return;
  try {
    const chainCheck = await d1Query('SELECT COUNT(*) as c FROM chain_menu_sources');
    if (chainCheck.success && (chainCheck.results[0]?.c ?? 0) === 0) {
      const defaultChains = [
        { country_code: 'GB', chain_key: 'sainsbury', display_name: "Sainsbury's", url: 'https://www.sainsburys.co.uk', status: 'ready', priority: 1 },
        { country_code: 'GB', chain_key: 'yolk', display_name: 'YOLK', url: 'https://yolk.vmos.io', status: 'ready', priority: 2 },
        { country_code: 'GB', chain_key: 'pret', display_name: 'Pret A Manger', url: 'https://www.pret.co.uk', status: 'pending', priority: 3 },
        { country_code: 'GB', chain_key: 'starbucks', display_name: 'Starbucks UK', url: 'https://www.starbucks.co.uk', status: 'pending', priority: 4 },
        { country_code: 'GB', chain_key: 'mcdonalds', display_name: "McDonald's UK", url: 'https://www.mcdonalds.com/gb/en-gb.html', status: 'pending', priority: 5 },
        { country_code: 'GB', chain_key: 'mr_oat', display_name: 'Mr Oat', url: 'https://mroat.co.uk', status: 'ready', priority: 6 },
        { country_code: 'GB', chain_key: 'hemaviton', display_name: 'Hemaviton', url: 'https://hemaviton.com', status: 'ready', priority: 7 },
      ];
      for (const c of defaultChains) {
        await d1Query(`INSERT OR REPLACE INTO chain_menu_sources (
          id, country_code, chain_key, display_name, url, source_kind, status, priority, enabled, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`, [
          'chain_' + c.chain_key, c.country_code, c.chain_key, c.display_name, c.url, 'official', c.status, c.priority, 1
        ]);
      }
    }

    const itemsCheck = await d1Query('SELECT COUNT(*) as c FROM brand_menu_items');
    if (itemsCheck.success && (itemsCheck.results[0]?.c ?? 0) === 0) {
      let localItems: any[] = [];
      try {
        const { loadLocalItems } = await import('./serverBrandMenu.js');
        localItems = loadLocalItems();
      } catch {}
      for (const it of localItems) {
        const id = it.id || ('local_' + it.chain_key + '_' + (it.dish_name_key || (it.dish_name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')));
        await d1Query(`INSERT OR REPLACE INTO brand_menu_items (
          id, country_code, chain_key, chain_name, dish_name, dish_name_key, basis_type, serving_grams,
          calories, protein, carbohydrates, total_fat, saturated_fat, sodium, sugar, total_fibre,
          nutrients, ingredients, source_url, notes, enabled, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`, [
          id,
          it.country_code || 'GB',
          it.chain_key,
          it.chain_name || it.chain_key,
          it.dish_name,
          it.dish_name_key || null,
          it.basis_type || 'per_100g',
          it.serving_grams || 100,
          it.nutrients?.calories || 0,
          it.nutrients?.protein || 0,
          it.nutrients?.carbohydrates || 0,
          it.nutrients?.totalFat || 0,
          it.nutrients?.saturatedFat || 0,
          it.nutrients?.sodium || 0,
          it.nutrients?.sugar || 0,
          it.nutrients?.totalFibre || 0,
          JSON.stringify(it.nutrients || {}),
          it.ingredients || '',
          it.source_url || '',
          it.notes || '',
          1,
          'active'
        ]);
      }
    }

    const foodsCheck = await d1Query('SELECT COUNT(*) as c FROM food_items');
    if (foodsCheck.success && (foodsCheck.results[0]?.c ?? 0) === 0) {
      const { CANONICAL_BASE_FOODS } = await import('./server_food_db.js');
      const entries = Object.entries(CANONICAL_BASE_FOODS);
      const CHUNK = 5;
      for (let i = 0; i < entries.length; i += CHUNK) {
        const chunk = entries.slice(i, i + CHUNK);
        const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const params: any[] = [];
        for (const [key, val] of chunk) {
          const displayName = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          params.push(
            'canonical_' + key,
            key,
            displayName,
            null,
            JSON.stringify(val),
            (val as any).serving_grams || 100,
            1.0,
            'active',
            'canonical_local',
            null,
            1,
            1
          );
        }
        await d1Query(`INSERT OR REPLACE INTO food_items (
          food_id, food_key, display_name, brand_name, nutrients_per_100g, standard_serving_g,
          confidence, status, source, fdc_id, version, capture_count
        ) VALUES ${placeholders}`, params);
      }
    }
  } catch (err) {
    console.warn('[D1 Schema] ensureNutritionD1Seed warning:', err);
  }
}

export async function ensureD1Schema(): Promise<{ success: boolean; error?: string }> {
  if (schemaEnsured) return { success: true };
  if (!isD1Configured()) {
    return { success: false, error: 'D1 not configured' };
  }

  try {
    const res = await d1Exec(D1_SCHEMA_SQL);
    if (!res.success) {
      console.error('[D1 Schema] Failed to ensure schema:', res.error);
      return { success: false, error: res.error };
    }
    schemaEnsured = true;
    console.log('[D1 Schema] Successfully verified/created D1 tables.');
    // Safe migration check for existing D1 databases lacking image_url
    try {
      await d1Query('ALTER TABLE brand_menu_items ADD COLUMN image_url TEXT');
    } catch (_) {}
    // Saved-meal lineage pointer (duplicate/restage parent id).
    try {
      await d1Query('ALTER TABLE food_logs ADD COLUMN source_meal_id TEXT DEFAULT \'\'');
    } catch (_) {}
    // D-2 catalog merge pointer (curator soft-merge loser → winner).
    try {
      await d1Query('ALTER TABLE food_items ADD COLUMN canonical_target_id TEXT');
    } catch (_) {}
    // D-2 catalog basis normalization target.
    try {
      await d1Query('ALTER TABLE food_items ADD COLUMN basis_type TEXT DEFAULT \'per_100g\'');
    } catch (_) {}
    // D-2 catalog candidate metadata (Supabase code drain): additive only.
    for (const sql of [
      'ALTER TABLE food_items ADD COLUMN form_tags TEXT DEFAULT \'[]\'',
      'ALTER TABLE food_items ADD COLUMN state TEXT',
      'ALTER TABLE food_items ADD COLUMN provenance TEXT DEFAULT \'resolver_candidate\'',
      'ALTER TABLE dish_cache ADD COLUMN provenance TEXT DEFAULT \'resolver_dish_core\'',
      'ALTER TABLE dish_cache ADD COLUMN components TEXT',
    ]) {
      try {
        await d1Query(sql);
      } catch (_) {}
    }
    // D-2 issue-tracker columns (Supabase code drain): additive only.
    const issueAlters = [
      'ALTER TABLE issue_tags ADD COLUMN title_key TEXT',
      'ALTER TABLE issue_tags ADD COLUMN category TEXT DEFAULT \'foodcart\'',
      'ALTER TABLE issue_tags ADD COLUMN resolution_note TEXT DEFAULT \'\'',
      'ALTER TABLE issue_tags ADD COLUMN whats_still_open TEXT DEFAULT \'\'',
      'ALTER TABLE issue_backlog ADD COLUMN status TEXT DEFAULT \'open\'',
      'ALTER TABLE issue_backlog ADD COLUMN issue_type TEXT DEFAULT \'\'',
      'ALTER TABLE issue_backlog ADD COLUMN severity TEXT DEFAULT \'\'',
      'ALTER TABLE issue_backlog ADD COLUMN country_code TEXT DEFAULT \'\'',
      'ALTER TABLE issue_backlog ADD COLUMN chain_key TEXT DEFAULT \'\'',
      'ALTER TABLE issue_backlog ADD COLUMN dish_query TEXT DEFAULT \'\'',
      'ALTER TABLE issue_backlog ADD COLUMN context TEXT DEFAULT \'\'',
      'ALTER TABLE issue_backlog ADD COLUMN source_url TEXT DEFAULT \'\'',
      'ALTER TABLE issue_backlog ADD COLUMN user_note TEXT DEFAULT \'\'',
      'ALTER TABLE issue_backlog ADD COLUMN resolution_note TEXT DEFAULT \'\'',
      'ALTER TABLE issue_backlog ADD COLUMN ever_tagged INTEGER DEFAULT 0',
      'ALTER TABLE issue_backlog ADD COLUMN firebase_uid TEXT DEFAULT \'\'',
      'ALTER TABLE issue_tag_links ADD COLUMN issue_id TEXT',
    ];
    for (const sql of issueAlters) {
      try {
        await d1Query(sql);
      } catch (_) {}
    }
    await ensureNutritionD1Seed();
    return { success: true };
  } catch (err: any) {
    console.error('[D1 Schema] Error ensuring schema:', err);
    return { success: false, error: err?.message || String(err) };
  }
}

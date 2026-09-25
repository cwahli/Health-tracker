#!/usr/bin/env node
/**
 * scripts/d1-supabase-recovery.mjs — Track D D-1 (unpaid recovery window).
 *
 * Supabase REST is probed first; when it answers 200 the script:
 *   1. dumps every D-1 table from Supabase (read-only, paginated),
 *   2. diffs against D1 by primary key (missing = in Supabase, not in D1),
 *   3. inserts ONLY the missing rows into D1 with INSERT OR IGNORE
 *      (idempotent: safe to re-run; never updates or deletes),
 *   4. archives the dump + summary to R2 under
 *      backlogs/supabase-recovery-YYYY-MM-DD/ (DATA_PLANE.md D-1 contract).
 *
 * Never pays, never dual-writes new rows, never touches the Supabase project.
 * Columns are the Supabase∩D1 intersection (D1 is a superset today); a schema
 * guard aborts a table if D1 has NOT-NULL-no-default columns the dump lacks
 * (no invented backfill values — F-13.2 rule: do not guess math).
 *
 * Usage: node scripts/d1-supabase-recovery.mjs [--dry-run]
 * Requires .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN,
 * CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY,
 * CLOUDFLARE_R2_BUCKET_NAME.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DRY = process.argv.includes('--dry-run');
const TAG = new Date().toISOString().slice(0, 10);
const DUMP_DIR = `/tmp/supabase-recovery-${TAG}`;

const TABLES = [
  { table: 'food_logs', pk: 'id' },
  { table: 'biomarker_logs', pk: 'id' },
  { table: 'profiles', pk: 'id' },
  { table: 'agent_jobs', pk: 'id' },
  { table: 'food_items', pk: 'food_id' },
];

const need = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_BUCKET_NAME'];
function checkEnv() {
  const missingEnv = need.filter((k) => !process.env[k]);
  if (missingEnv.length) {
    console.error(`missing env: ${missingEnv.join(', ')} (source .env first)`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// D1 (REST query API, same shape as server_d1.ts d1Query)
// ---------------------------------------------------------------------------
async function d1Query(sql, params = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${process.env.CLOUDFLARE_D1_DATABASE_ID}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(`D1 ${res.status}: ${json?.errors?.[0]?.message || json?.error || 'query failed'} — sql: ${sql.slice(0, 120)}`);
  }
  return { results: json.result[0].results || [], meta: json.result[0].meta || {} };
}

// ---------------------------------------------------------------------------
// Supabase REST (read-only)
// ---------------------------------------------------------------------------
function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function supabaseProbe() {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/profiles?select=id&limit=1`, { headers: sbHeaders() });
  return res.status;
}

async function supabaseCount(table) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?select=*`, {
    headers: { ...sbHeaders(), Prefer: 'count=exact', Range: '0-0' },
  });
  if (!res.ok) throw new Error(`${table} count HTTP ${res.status}`);
  const range = res.headers.get('content-range') || '';
  return parseInt(range.split('/')[1] || '0', 10);
}

async function supabaseAll(table, pk) {
  const out = [];
  const limit = 1000;
  for (let offset = 0; ; offset += limit) {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/${table}?select=*&order=${pk}&limit=${limit}&offset=${offset}`,
      { headers: sbHeaders() }
    );
    if (!res.ok) throw new Error(`${table} page HTTP ${res.status} (offset ${offset})`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < limit) return out;
  }
}

// ---------------------------------------------------------------------------
// Value / schema mapping
// ---------------------------------------------------------------------------
export function toSqlValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

async function d1Schema(table) {
  const info = await d1Query(`PRAGMA table_info(${table})`);
  return info.results.map((c) => ({ name: c.name, notnull: !!c.notnull, dflt: c.dflt_value, pk: c.pk > 0 }));
}

/**
 * Extra UNIQUE columns beyond the PK (e.g. food_items.food_key UNIQUE): D1's
 * dedup canoninalises ids, so a legacy row may legitimately collide on a
 * unique key while missing by PK. Such rows are SKIPPED by design — inserting
 * them would either fail or fork the identity that aliases point at.
 */
/** Pure core of d1ExtraUniqueCols: parse a CREATE TABLE ddl for extra UNIQUE cols. */
export function extraUniqueColsFromDdl(ddl, pk) {
  const cols = [];
  for (const m of String(ddl || '').matchAll(/UNIQUE/g)) {
    const before = String(ddl).slice(0, m.index);
    const col = (before.match(/(\w+)\s+TEXT[^,(]*$/) || [])[1];
    if (col && col !== pk) cols.push(col);
  }
  return [...new Set(cols)];
}

async function d1ExtraUniqueCols(table, pk) {
  const ddl = (await d1Query(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`, [table])).results[0]?.sql || '';
  return extraUniqueColsFromDdl(ddl, pk);
}

// Size/param-aware chunking (D1 statement limits are conservative on blobs).
export function chunkRows(rows, colCount) {
  const chunks = [];
  let cur = [];
  let bytes = 0;
  const maxParams = Math.max(1, Math.floor(90 / Math.max(1, colCount)));
  for (const row of rows) {
    const size = JSON.stringify(row).length;
    const tooBig = (cur.length + 1) * colCount > 90 || bytes + size > 60_000;
    if (cur.length && (tooBig || cur.length >= maxParams)) {
      chunks.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(row);
    bytes += size;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

// ---------------------------------------------------------------------------
// R2 archive (S3 API, @aws-sdk/client-s3 is in package.json)
// ---------------------------------------------------------------------------
async function r2Upload(key, body) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    },
  });
  await client.send(new PutObjectCommand({
    Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: 'application/json',
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
// Main — only when executed as a script, so imports stay side-effect free.
async function main() {
  checkEnv();
  const probe = await supabaseProbe();
  console.log(`Supabase REST probe: HTTP ${probe}`);
  if (probe === 402) {
    console.log('still 402 (egress quota) — D-1 recovery stays parked, retry later. No writes performed.');
    process.exit(0);
  }
  if (probe !== 200) {
    console.error(`unexpected probe status ${probe} — aborting`);
    process.exit(1);
  }

  fs.mkdirSync(DUMP_DIR, { recursive: true });
  const summary = { date: TAG, tables: {}, probedAt: new Date().toISOString() };

  for (const { table, pk } of TABLES) {
    const rows = await supabaseAll(table, pk);
    fs.writeFileSync(path.join(DUMP_DIR, `${table}.json`), JSON.stringify(rows, null, 1));
    console.log(`\n== ${table}: dumped ${rows.length} rows from Supabase`);

    const schema = await d1Schema(table);
    const d1Cols = schema.map((c) => c.name);
    const sbCols = Object.keys(rows[0] || {});
    const cols = sbCols.filter((c) => d1Cols.includes(c));
    const sbOnlyCols = sbCols.filter((c) => !d1Cols.includes(c));
    // Guard: NOT NULL without default in D1 that the dump cannot supply.
    const unfillable = schema.filter((c) => c.notnull && c.dflt === null && !sbCols.includes(c.name));
    if (unfillable.length) {
      console.error(`  ABORT ${table}: D1 NOT NULL no-default cols absent from Supabase dump: ${unfillable.map((c) => c.name).join(', ')} — no values will be invented.`);
      summary.tables[table] = { dumped: rows.length, aborted: unfillable.map((c) => c.name) };
      continue;
    }

    const pkSet = new Set((await d1Query(`SELECT ${pk} FROM ${table}`)).results.map((r) => String(r[pk])));
    const missing = rows.filter((r) => !pkSet.has(String(r[pk])));
    const uniqueCols = await d1ExtraUniqueCols(table, pk);

    // Pre-classify by-design skips: unique-key value already owned by another
    // D1 row (canonical id). Those are never inserted and never counted lost.
    let skippedKeyCollision = [];
    if (uniqueCols.length) {
      const uc = uniqueCols[0];
      const vals = [...new Set(missing.map((r) => r[uc]).filter((v) => v !== null && v !== undefined))];
      const owners = vals.length
        ? await d1Query(`SELECT ${pk}, ${uc} FROM ${table} WHERE ${uc} IN (${vals.map(() => '?').join(',')})`, vals)
        : { results: [] };
      const ownerByVal = new Map(owners.results.map((o) => [o[uc], o[pk]]));
      skippedKeyCollision = missing
        .filter((r) => ownerByVal.has(r[uc]))
        .map((r) => ({ [pk]: r[pk], [uc]: r[uc], d1Owner: ownerByVal.get(r[uc]) }));
    }
    const insertable = missing.filter((r) => !skippedKeyCollision.some((s) => String(s[pk]) === String(r[pk])));
    console.log(`  D1 has ${pkSet.size}; missing by ${pk}: ${missing.length}${uniqueCols.length ? ` (unique-key skips: ${skippedKeyCollision.length})` : ''}${sbOnlyCols.length ? ` (dump-only cols ignored: ${sbOnlyCols.join(',')})` : ''}`);

    let inserted = 0;
    if (!DRY) {
      for (const chunk of chunkRows(insertable, cols.length)) {
        const valuesSql = chunk.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
        const params = chunk.flatMap((r) => cols.map((c) => toSqlValue(r[c])));
        const { meta } = await d1Query(`INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES ${valuesSql}`, params);
        inserted += Number(meta.changes || 0);
      }
    }

    // Verify: every not-inserted missing row must be an accounted skip.
    const pkSet2 = new Set((await d1Query(`SELECT ${pk} FROM ${table}`)).results.map((r) => String(r[pk])));
    const stillMissingRows = rows.filter((r) => !pkSet2.has(String(r[pk])));
    const accounted = new Set(skippedKeyCollision.map((s) => String(s[pk])));
    const unaccounted = stillMissingRows.filter((r) => !accounted.has(String(r[pk])));
    const finalCount = (await d1Query(`SELECT COUNT(*) AS n FROM ${table}`)).results[0].n;
    console.log(`  inserted=${DRY ? 0 : inserted} keySkips=${skippedKeyCollision.length} stillMissing=${stillMissingRows.length} (unaccounted=${unaccounted.length}) d1Count=${finalCount}`);
    if (!DRY && unaccounted.length > 0) throw new Error(`${table}: ${unaccounted.length} rows still missing and not accounted for by key skips`);
    const corruptNutrients = table === 'food_items'
      ? rows.filter((r) => String(r.nutrients_per_100g || '').includes('[object Object]')).length
      : 0;
    summary.tables[table] = { dumped: rows.length, d1Before: pkSet.size, missing: missing.length, inserted, keySkips: skippedKeyCollision.length, keySkipDetail: skippedKeyCollision.slice(0, 50), d1After: finalCount, stillMissing: stillMissingRows.length, unaccounted: unaccounted.length, sbOnlyCols, corruptNutrients };
  }

  fs.writeFileSync(path.join(DUMP_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  const totalInserted = Object.values(summary.tables).reduce((a, t) => a + (t.inserted || 0), 0);
  const totalMissing = Object.values(summary.tables).reduce((a, t) => a + (t.missing || 0), 0);
  console.log(`\nSummary: ${totalMissing} missing, ${DRY ? 0 : totalInserted} inserted${DRY ? ' (dry-run)' : ''}. Dump: ${DUMP_DIR}`);

  if (!DRY) {
    for (const f of [...TABLES.map((t) => `${t.table}.json`), 'summary.json']) {
      const key = `backlogs/supabase-recovery-${TAG}/${f}`;
      await r2Upload(key, fs.readFileSync(path.join(DUMP_DIR, f)));
      console.log(`  R2: ${key}`);
    }
    console.log('R2 archive complete.');
  }
}

const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((e) => {
    console.error('RECOVERY FAILED:', e.message);
    process.exit(1);
  });
}

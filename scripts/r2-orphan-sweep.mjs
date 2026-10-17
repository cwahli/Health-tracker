#!/usr/bin/env node
/**
 * D-10 R2 orphan sweep — audit, delete, retention.
 *
 * Usage:
 *   node scripts/r2-orphan-sweep.mjs audit [--manifest path] [--env-file path]
 *   node scripts/r2-orphan-sweep.mjs recheck-missing [--env-file path]
 *   node scripts/r2-orphan-sweep.mjs delete [--manifest path] [--execute] [--env-file path]
 *   node scripts/r2-orphan-sweep.mjs retention [--execute] [--older-than-days N] [--include-bugs] [--env-file path]
 *
 * Auth: R2 via S3 API (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_R2_BUCKET_NAME /
 * CLOUDFLARE_R2_ACCESS_KEY_ID / CLOUDFLARE_R2_SECRET_ACCESS_KEY), D1 via
 * Cloudflare REST (CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_API_TOKEN).
 * Pass --env-file (e.g. the deploy .env) or export them first. Never commit keys.
 *
 * Safety (pinned by scripts/assert-r2-delete-safety.test.mjs — do not weaken):
 *   - deletes ONLY under photos/ (delete mode) or the named retention prefixes;
 *     never golden/, never anything else, no matter the input;
 *   - every candidate is re-verified unreferenced against a FRESH D1 read
 *     immediately before deleting (a meal created between audit and delete wins);
 *   - tier3_hold and missing_referenced_absent keys are NEVER deleted;
 *   - 30-day grace: objects newer than 30 days are skipped, not deleted;
 *   - tier2 groups delete only when the keep key exists, or every group
 *     member is unreferenced;
 *   - without --execute every mode is a dry run that prints the plan and
 *     writes the manifest; nothing is deleted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, ListObjectsV2Command, HeadObjectCommand, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const CANDIDATES_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plan', 'R2_DELETE_CANDIDATES.json');
const GRACE_DAYS = 30;
const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;

/** A key is deletable by the photo sweep only under photos/. golden/ is never touched. */
export function isDeletablePhotoKey(key) {
  return typeof key === 'string' && key.startsWith('photos/') && !key.startsWith('photos/golden/');
}

/** Retention prefixes. bugs/ is evidence — report-only unless explicitly included. */
export function retentionPrefixes(includeBugs) {
  const prefixes = ['debug/', 'logs/', 'jobs/'];
  if (includeBugs) prefixes.push('bugs/');
  return prefixes;
}

/** Grace: objects newer than GRACE_DAYS are skipped. Missing timestamps are NOT deletable. */
export function pastGrace(lastModified, now = Date.now()) {
  if (!lastModified) return false;
  const t = new Date(lastModified).getTime();
  if (Number.isNaN(t)) return false;
  return now - t > GRACE_MS;
}

/** Partition tier2 groups: deletable only when keep exists or all members unreferenced. */
export function partitionTier2Group(group, exists, referenced) {
  const members = [group.keep?.key, ...(group.delete || [])].filter(Boolean);
  const keepExists = exists.has(group.keep?.key);
  const allUnreferenced = members.every((k) => !referenced.has(k));
  if (!keepExists && !allUnreferenced) return { deletes: [], reason: 'keep-missing-and-member-referenced' };
  return {
    deletes: (group.delete || []).filter((k) => isDeletablePhotoKey(k) && !referenced.has(k)),
    reason: keepExists ? 'keep-present' : 'all-unreferenced',
  };
}

function env(name) {
  return (process.env[name] || '').trim();
}

function s3() {
  const accountId = env('CLOUDFLARE_ACCOUNT_ID');
  const accessKeyId = env('CLOUDFLARE_R2_ACCESS_KEY_ID');
  const secretAccessKey = env('CLOUDFLARE_R2_SECRET_ACCESS_KEY');
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 env missing (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY)');
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function bucket() {
  const b = env('CLOUDFLARE_R2_BUCKET_NAME');
  if (!b) throw new Error('R2 env missing (CLOUDFLARE_R2_BUCKET_NAME)');
  return b;
}

async function d1(sql, params = []) {
  const accountId = env('CLOUDFLARE_ACCOUNT_ID');
  const databaseId = env('CLOUDFLARE_D1_DATABASE_ID');
  const token = env('CLOUDFLARE_API_TOKEN') || env('CLOUDFLARE_D1_API_TOKEN');
  if (!accountId || !databaseId || !token) throw new Error('D1 env missing');
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(json?.errors?.[0]?.message || `D1 HTTP ${res.status}`);
  const batch = Array.isArray(json.result) ? json.result[0] : json.result;
  return batch?.results || [];
}

function keyFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const idx = url.indexOf('/photos/');
  if (idx === -1) return null;
  return url.slice(idx + 1);
}

async function referencedPhotoKeys() {
  const referenced = new Set();
  const foods = await d1('SELECT image_urls FROM food_logs LIMIT 5000');
  for (const row of foods) {
    let urls = row.image_urls;
    if (typeof urls === 'string') {
      try { urls = JSON.parse(urls); } catch { urls = []; }
    }
    if (Array.isArray(urls)) for (const u of urls) { const k = keyFromUrl(u); if (k) referenced.add(k); }
  }
  const jobs = await d1('SELECT photo_url FROM agent_jobs LIMIT 5000');
  for (const job of jobs) { const k = keyFromUrl(job.photo_url); if (k) referenced.add(k); }
  return referenced;
}

async function listPrefix(client, Bucket, Prefix) {
  const out = [];
  let ContinuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
    for (const obj of page.Contents || []) {
      if (obj.Key) out.push({ key: obj.Key, size: obj.Size || 0, lastModified: obj.LastModified ? new Date(obj.LastModified).toISOString() : null });
    }
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return out;
}

async function headExists(client, Bucket, Key) {
  try {
    const r = await client.send(new HeadObjectCommand({ Bucket, Key }));
    return { exists: true, size: r.ContentLength || 0, lastModified: r.LastModified ? new Date(r.LastModified).toISOString() : null };
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || /NotFound|NoSuchKey/i.test(e?.name || '')) return { exists: false };
    throw e;
  }
}

async function auditRun(manifestPath) {
  const client = s3();
  const Bucket = bucket();
  const candidates = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8'));
  const [all, referenced] = await Promise.all([listPrefix(client, Bucket, 'photos/'), referencedPhotoKeys()]);
  const byKey = new Map(all.map((o) => [o.key, o]));
  const live = (k) => byKey.get(k) || null;

  const tier1 = candidates.tier1_delete.map(({ key }) => {
    const o = live(key);
    return { key, exists: Boolean(o), referenced: referenced.has(key), size: o?.size || 0, lastModified: o?.lastModified || null };
  });
  const tier2 = candidates.tier2_groups.map((g) => {
    const exists = new Set([...byKey.keys()]);
    const part = partitionTier2Group(g, exists, referenced);
    return { keep: g.keep.key, keepExists: exists.has(g.keep.key), deletes: part.deletes, reason: part.reason, groupSize: (g.delete || []).length };
  });
  const tier3 = candidates.tier3_hold.map(({ key }) => ({ key, exists: byKey.has(key), referenced: referenced.has(key), held: true }));
  const orphans = all.filter((o) => !referenced.has(o.key));
  const manifest = {
    at: new Date().toISOString(),
    bucket: Bucket,
    totals: { photos: all.length, referenced: referenced.size, orphans: orphans.length, orphanBytes: orphans.reduce((s, o) => s + o.size, 0) },
    tier1, tier2, tier3,
    missing: candidates.missing_referenced_absent,
  };
  if (manifestPath) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`manifest: ${manifestPath}`);
  }
  // Spec: the re-run dump lands in R2.
  const dumpKey = `backlogs/d10-audit-${new Date().toISOString().slice(0, 10)}.json`;
  await client.send(new PutObjectCommand({ Bucket, Key: dumpKey, Body: JSON.stringify(manifest), ContentType: 'application/json' }));
  console.log(`dump: r2://${Bucket}/${dumpKey}`);
  console.log(`photos=${all.length} referenced=${referenced.size} orphans=${orphans.length} ` +
    `tier1_exist_unref=${tier1.filter((t) => t.exists && !t.referenced).length}/96 ` +
    `tier2_deletable=${tier2.reduce((s, g) => s + g.deletes.length, 0)} tier3_held=${tier3.length}`);
  return manifest;
}

async function recheckMissing() {
  const client = s3();
  const Bucket = bucket();
  const candidates = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8'));
  for (const raw of candidates.missing_referenced_absent) {
    const key = String(raw);
    const broken = /\\$/.test(key) || /\\/.test(key);
    let head = { exists: false };
    if (!broken) head = await headExists(client, Bucket, key).catch((e) => ({ exists: false, error: e.message }));
    const like = await d1(
      "SELECT (SELECT COUNT(*) FROM food_logs WHERE image_urls LIKE ?) AS foods, (SELECT COUNT(*) FROM agent_jobs WHERE photo_url LIKE ?) AS jobs",
      [`%${key}%`, `%${key}%`],
    ).then((r) => r[0]).catch((e) => ({ error: e.message }));
    console.log(JSON.stringify({ key, brokenLiteral: broken, headExists: head.exists, d1Refs: like }));
  }
  console.log('missing keys are NEVER deleted by this script.');
}

async function deleteRun(manifestPath, execute, outPath) {
  const client = s3();
  const Bucket = bucket();
  const manifest = manifestPath
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : await auditRun(null);
  if (!Array.isArray(manifest.tier1) || !Array.isArray(manifest.tier2)) {
    throw new Error(`manifest ${manifestPath || '(fresh)'} has no tier1/tier2 arrays — refusing to plan blind`);
  }
  const referenced = await referencedPhotoKeys();
  const plan = [];
  for (const t of manifest.tier1 || []) {
    if (!isDeletablePhotoKey(t.key)) { plan.push({ key: t.key, action: 'skip', reason: 'guard-prefix' }); continue; }
    if (referenced.has(t.key)) { plan.push({ key: t.key, action: 'skip', reason: 'referenced-at-runtime' }); continue; }
    const head = await headExists(client, Bucket, t.key);
    if (!head.exists) { plan.push({ key: t.key, action: 'skip', reason: 'gone' }); continue; }
    if (!pastGrace(head.lastModified)) { plan.push({ key: t.key, action: 'skip', reason: 'grace-30d' }); continue; }
    plan.push({ key: t.key, action: 'delete', size: head.size });
  }
  const exists = new Set((await listPrefix(client, Bucket, 'photos/')).map((o) => o.key));
  for (const g of manifest.tier2 || []) {
    const src = (JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8')).tier2_groups || []).find((x) => x.keep?.key === g.keep);
    if (!src) continue;
    const part = partitionTier2Group(src, exists, referenced);
    for (const k of part.deletes) {
      const head = await headExists(client, Bucket, k);
      if (!head.exists) { plan.push({ key: k, action: 'skip', reason: 'gone' }); continue; }
      if (!pastGrace(head.lastModified)) { plan.push({ key: k, action: 'skip', reason: 'grace-30d' }); continue; }
      plan.push({ key: k, action: 'delete', size: head.size, group: g.keep });
    }
  }
  const toDelete = plan.filter((p) => p.action === 'delete');
  const toSkip = plan.filter((p) => p.action === 'skip');
  console.log(`plan: delete=${toDelete.length} skip=${toSkip.length} bytes=${toDelete.reduce((s, p) => s + (p.size || 0), 0)}`);
  for (const s of ['guard-prefix', 'referenced-at-runtime', 'gone', 'grace-30d']) {
    const n = toSkip.filter((p) => p.reason === s).length;
    if (n) console.log(`  skip/${s}: ${n}`);
  }
  const results = [];
  if (execute) {
    for (const p of toDelete) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket, Key: p.key }));
        results.push({ ...p, deleted: true });
      } catch (e) {
        results.push({ ...p, deleted: false, error: e?.message || String(e) });
      }
      if (results.length % 100 === 0) console.log(`  progress ${results.length}/${toDelete.length}`);
    }
    const ok = results.filter((r) => r.deleted).length;
    console.log(`done: deleted=${ok} failed=${results.length - ok}`);
  } else {
    console.log('dry run — pass --execute to delete. Nothing was deleted.');
  }
  const out = { at: new Date().toISOString(), execute: Boolean(execute), plan, results };
  const dest = outPath || 'd10-delete-manifest.json';
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(`delete manifest: ${dest}`);
  return out;
}

async function retentionRun(execute, olderThanDays, includeBugs) {
  const client = s3();
  const Bucket = bucket();
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const plan = [];
  for (const prefix of retentionPrefixes(includeBugs)) {
    const objs = await listPrefix(client, Bucket, prefix);
    for (const o of objs) {
      if (!o.lastModified) { plan.push({ key: o.key, action: 'skip', reason: 'no-timestamp' }); continue; }
      if (new Date(o.lastModified).getTime() > cutoff) { plan.push({ key: o.key, action: 'keep', reason: 'fresh' }); continue; }
      plan.push({ key: o.key, action: 'delete', size: o.size });
    }
    console.log(`${prefix}: listed=${objs.length}`);
  }
  const toDelete = plan.filter((p) => p.action === 'delete');
  console.log(`retention(>${olderThanDays}d): delete=${toDelete.length} bytes=${toDelete.reduce((s, p) => s + (p.size || 0), 0)}`);
  const results = [];
  if (execute) {
    for (const p of toDelete) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket, Key: p.key }));
        results.push({ ...p, deleted: true });
      } catch (e) {
        results.push({ ...p, deleted: false, error: e?.message || String(e) });
      }
    }
    console.log(`done: deleted=${results.filter((r) => r.deleted).length} failed=${results.filter((r) => !r.deleted).length}`);
  } else {
    console.log('dry run — pass --execute to delete. Nothing was deleted.');
  }
  fs.writeFileSync('d10-retention-manifest.json', JSON.stringify({ at: new Date().toISOString(), olderThanDays, includeBugs, execute: Boolean(execute), plan, results }, null, 2));
  return { plan, results };
}

async function main(argv = process.argv.slice(2)) {
  const envFile = argv.includes('--env-file') ? argv[argv.indexOf('--env-file') + 1] : null;
  if (envFile) {
    const { default: dotenv } = await import('dotenv');
    dotenv.config({ path: envFile });
  }
  const mode = argv.find((a) => !a.startsWith('--'));
  const execute = argv.includes('--execute');
  const manifest = argv.includes('--manifest') ? argv[argv.indexOf('--manifest') + 1] : null;
  const daysIdx = argv.indexOf('--older-than-days');
  const olderThanDays = daysIdx === -1 ? 90 : Number(argv[daysIdx + 1]) || 90;
  if (mode === 'audit') return auditRun(manifest);
  if (mode === 'recheck-missing') return recheckMissing();
  if (mode === 'delete') return deleteRun(manifest, execute, argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null);
  if (mode === 'retention') return retentionRun(execute, olderThanDays, argv.includes('--include-bugs'));
  console.error('usage: r2-orphan-sweep.mjs <audit|recheck-missing|delete|retention> [--execute] [--manifest p] [--older-than-days N] [--include-bugs] [--env-file p]');
  process.exit(1);
}

const invoked = (() => {
  try { return process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (invoked) main().catch((e) => { console.error(`r2-orphan-sweep: ${e.message}`); process.exit(1); });

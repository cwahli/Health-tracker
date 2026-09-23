#!/usr/bin/env node
/**
 * scripts/meal-audit-fetch.mjs
 *
 * Meal Flow & Debug Retrieval Helper for Meal-Audit Bot (Plan v3 / P1).
 * Locates a real job by Job ID, timestamp, or meal name — never invents IDs —
 * pulls the server-built CanonicalRunTree (real turns via buildTurnTimeline),
 * downloads turn photos to disk, and emits flow_skeleton.json for audit.
 *
 * Exit codes:
 *   0 success
 *   1 hard failure (server down, debug missing/expired, photo download failed)
 *   2 ambiguous or zero candidates (lists candidates on stdout as JSON)
 *
 * Usage:
 *   node scripts/meal-audit-fetch.mjs --job-id="job_..."
 *   node scripts/meal-audit-fetch.mjs --timestamp="2026-09-22 08:21" [--name="hotpot"]
 *   node scripts/meal-audit-fetch.mjs --name="Chicken Hotpot" [--uid=...]
 *   node scripts/meal-audit-fetch.mjs --list
 *   node scripts/meal-audit-fetch.mjs --debug-file=/path/to/debug.json --name="..."
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = (process.env.API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const TS_WINDOW_MS = 3 * 60 * 1000;

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    jobId: null,
    timestamp: null,
    name: null,
    uid: null,
    outputDir: null,
    debugFile: null,
    list: false,
    help: false,
  };
  for (const arg of args) {
    if (arg === '--list') options.list = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--job-id=')) options.jobId = arg.slice('--job-id='.length).trim();
    else if (arg.startsWith('--timestamp=')) options.timestamp = arg.slice('--timestamp='.length).trim();
    else if (arg.startsWith('--name=')) options.name = arg.slice('--name='.length).trim();
    else if (arg.startsWith('--uid=')) options.uid = arg.slice('--uid='.length).trim();
    else if (arg.startsWith('--output-dir=')) options.outputDir = arg.slice('--output-dir='.length).trim();
    else if (arg.startsWith('--debug-file=')) options.debugFile = arg.slice('--debug-file='.length).trim();
  }
  return options;
}

function usage() {
  console.log(`
Meal Audit Fetcher — locate a real meal job and rebuild its multi-turn flow.

Usage:
  node scripts/meal-audit-fetch.mjs --job-id="job_1787301189340_xxx" [--output-dir=...]
  node scripts/meal-audit-fetch.mjs --timestamp="2026-09-22 08:21" [--name="hotpot"]
  node scripts/meal-audit-fetch.mjs --name="Chicken Hotpot" [--uid=<firebaseUid>]
  node scripts/meal-audit-fetch.mjs --debug-file=/path/debug.json [--name="..."]
  node scripts/meal-audit-fetch.mjs --list

Notes:
  - Never invents job IDs. Zero/ambiguous matches exit 2 with a candidate list.
  - Photos are downloaded into <output-dir>/photos/ (local paths in the skeleton).
  - The skeleton carries empty dishes[] — the audit agent fills them after review.
`);
}

async function fetchJson(url, { allow404 = false } = {}) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404 && allow404) return { __status: 404 };
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/** Parse user timestamp into a window. Returns null if unparseable. */
function parseTimestampWindow(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let d = null;
  let hasTime = false;

  const iso = s.match(/^(\d{4}-\d{2}-\d{2})[T\s]+(\d{2}:\d{2})(?::(\d{2}))?/);
  const monDay = s.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,|\s)+(\d{4})?\s*(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  const timeOnly = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);

  if (iso) {
    d = new Date(`${iso[1]}T${iso[2]}:${iso[3] || '00'}`);
    hasTime = true;
  } else if (monDay) {
    const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
    const mKey = monDay[1].toLowerCase().slice(0, 3);
    const year = monDay[3] ? Number(monDay[3]) : new Date().getFullYear();
    let hour = Number(monDay[4]);
    const min = Number(monDay[5]);
    const ampm = (monDay[6] || '').toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    d = new Date(year, monthMap[mKey] ?? 0, Number(monDay[2]), hour, min, 0, 0);
    hasTime = true;
  } else if (timeOnly) {
    const now = new Date();
    let hour = Number(timeOnly[1]);
    const min = Number(timeOnly[2]);
    const ampm = (timeOnly[3] || '').toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, min, 0, 0);
    hasTime = true;
  } else {
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }

  if (!d || Number.isNaN(d.getTime())) return null;
  const ms = d.getTime();
  return { startMs: ms - TS_WINDOW_MS, endMs: ms + TS_WINDOW_MS, dateMs: ms, hasTime };
}

/** Job IDs embed epoch ms: job_<ms>_<rand>. Extract if present. */
function jobIdEpochMs(jobId) {
  const m = String(jobId || '').match(/(?:^|_)(\d{13})(?:_|$)/);
  return m ? Number(m[1]) : null;
}

function jobCreatedMs(job) {
  const fromId = jobIdEpochMs(job.id);
  const created = job.created_at ? Date.parse(job.created_at) : NaN;
  const updated = job.updated_at ? Date.parse(job.updated_at) : NaN;
  if (!Number.isNaN(created)) return created;
  if (fromId) return fromId;
  if (!Number.isNaN(updated)) return updated;
  return null;
}

function summarizeJob(job) {
  const cr = job.clean_result || {};
  const names = new Set();
  const dishes = cr.dishes || cr.scoutItems || (cr.pendingFoodLog && cr.pendingFoodLog.dishes) || [];
  for (const d of Array.isArray(dishes) ? dishes : []) {
    if (d && (d.dishName || d.name)) names.add(d.dishName || d.name);
  }
  if (typeof cr.message === 'string' && cr.message.length < 120) names.add(cr.message);
  return {
    jobId: job.id,
    status: job.status,
    kind: job.kind,
    createdAt: job.created_at || null,
    updatedAt: job.updated_at || null,
    createdMs: jobCreatedMs(job),
    userId: job.user_id || null,
    photoUrl: job.photo_url || null,
    debugUrl: job.debug_url || null,
    names: [...names].slice(0, 5),
  };
}

async function listJobs({ full = true } = {}) {
  const qs = full ? 'full=true' : '';
  try {
    const body = await fetchJson(`${BASE_URL}/api/jobs/status?${qs}`);
    return Array.isArray(body && body.jobs) ? body.jobs : [];
  } catch (err) {
    console.error(`[Fetch] Cannot list jobs from ${BASE_URL}: ${err.message}`);
    console.error(`[Fetch] Is the server running? (API_BASE_URL=${BASE_URL})`);
    process.exit(1);
  }
}

function filterCandidates(jobs, { timestampWindow, name }) {
  let out = jobs;
  if (timestampWindow) {
    out = out.filter((j) => {
      const ms = jobCreatedMs(j);
      if (ms == null) return false;
      if (timestampWindow.hasTime) return ms >= timestampWindow.startMs && ms <= timestampWindow.endMs;
      const d = new Date(ms);
      const dd = new Date(timestampWindow.dateMs);
      return d.getFullYear() === dd.getFullYear() && d.getMonth() === dd.getMonth() && d.getDate() === dd.getDate();
    });
  }
  if (name) {
    const q = name.toLowerCase();
    out = out.filter((j) => {
      const hay = JSON.stringify({
        id: j.id,
        clean_result: j.clean_result,
        status_message: j.status_message,
        photo_url: j.photo_url,
      }).toLowerCase();
      return hay.includes(q);
    });
  }
  return out;
}

function emitCandidatesAndExit(candidates, reason) {
  const list = candidates.map(summarizeJob);
  console.error(`[Fetch] ${reason}`);
  console.error(`[Fetch] ${list.length} candidate(s). Re-run with --job-id=<id>.`);
  process.stdout.write(`${JSON.stringify({ reason, candidates: list }, null, 2)}\n`);
  process.exit(2);
}

async function resolveJobId(options) {
  if (options.jobId) return options.jobId;

  const timestampWindow = parseTimestampWindow(options.timestamp);
  if (options.timestamp && !timestampWindow) {
    console.error(`[Fetch] Could not parse --timestamp="${options.timestamp}".`);
    console.error('[Fetch] Accepted: "2026-09-22 08:21", "Sept 22 08:21", "08:21", ISO-8601.');
    process.exit(2);
  }
  if (!timestampWindow && !options.name) {
    usage();
    process.exit(1);
  }

  const jobs = await listJobs({ full: true });
  const matches = filterCandidates(jobs, { timestampWindow, name: options.name });

  if (matches.length === 1) {
    const s = summarizeJob(matches[0]);
    console.error(`  ✓ Matched job ${s.jobId} (created=${s.createdAt || s.createdMs})`);
    return s.jobId;
  }
  if (matches.length === 0) {
    emitCandidatesAndExit([], `No job matched timestamp=${options.timestamp || '-'} name=${options.name || '-'} on ${BASE_URL}.`);
  }
  const windowNote = timestampWindow && !timestampWindow.hasTime
    ? 'date-only match'
    : `window=+/-${TS_WINDOW_MS / 60000}min`;
  emitCandidatesAndExit(matches, `Ambiguous match: ${matches.length} jobs for timestamp=${options.timestamp || '-'} name=${options.name || '-'} (${windowNote}).`);
}

async function fetchRunTree(jobId) {
  const url = `${BASE_URL}/api/jobs/debug?jobId=${encodeURIComponent(jobId)}`;
  console.error(`Fetching CanonicalRunTree: ${url}`);
  let body;
  try {
    body = await fetchJson(url, { allow404: true });
  } catch (err) {
    console.error(`[Fetch] Debug fetch failed for ${jobId}: ${err.message}`);
    process.exit(1);
  }
  if (body && body.__status === 404) {
    console.error(`[Fetch] Debug payload not found for ${jobId}.`);
    console.error('[Fetch] Retention window may have expired.');
    process.exit(1);
  }
  if (!body || body.error) {
    console.error(`[Fetch] Debug payload error for ${jobId}: ${JSON.stringify(body).slice(0, 400)}`);
    process.exit(1);
  }
  if (!Array.isArray(body.turns)) {
    console.error(`[Fetch] Response for ${jobId} has no turns[] — not a CanonicalRunTree.`);
    process.exit(1);
  }
  return body;
}

function loadDebugFile(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!Array.isArray(raw.turns)) {
    console.error(`[Fetch] ${file} has no turns[] — not a CanonicalRunTree export.`);
    process.exit(1);
  }
  return raw;
}

/**
 * True when a turn image entry is a real downloadable photo URL.
 * Rejects debug-contract placeholders produced by stripHeavyImages
 * ("[image omitted 20KB]"), data-URLs, empty strings, and non-URL junk.
 * Those placeholders used to be treated as relative paths
 * (`<BASE>/<placeholder>`), fetched as HTML error pages (1.4KB),
 * and saved as fake `_image_20omitted_200KB_.jpg` files.
 */
export function isDownloadablePhotoUrl(u) {
  if (typeof u !== 'string') return false;
  const s = u.trim();
  if (!s) return false;
  if (s.startsWith('data:')) return false;
  if (s.startsWith('[') || s.includes('image omitted') || s.includes('omitted_')) return false;
  if (/^https?:\/\//i.test(s)) return true;
  if (s.startsWith('/photos/') || s.startsWith('/')) return true;
  // R2 public hosts and site photo paths only; bare filenames from the
  // photos/ dir are downloadable via the proxy. Anything else is junk.
  if (/^photos\//i.test(s)) return true;
  if (/\.r2\.dev\/photos\//i.test(s)) return true;
  if (/\.(jpe?g|png|webp|gif|heic|heif)(\?.*)?$/i.test(s) && !/\s/.test(s)) return true;
  return false;
}

/**
 * True when a downloaded buffer looks like a real image.
 * Rejects HTML error pages / placeholders (start with "<", "<!DOCTYPE",
 * "<html") which the photo proxy returns for unknown keys.
 */
export function isImageBuffer(buf, contentType) {
  if (!buf || buf.length === 0) return false;
  if (typeof contentType === 'string' && /text\/html/i.test(contentType)) return false;
  const head = buf.subarray(0, Math.min(buf.length, 200)).toString('latin1').trimStart();
  if (head.startsWith('<')) return false;
  if (/^<!doctype\s+html/i.test(head) || /^<html/i.test(head)) return false;
  // Magic bytes: JPEG FF D8 FF, PNG 89 50 4E 47, GIF 47 49 46, WEBP RIFF....WEBP, HEIC ftyp, BMP 42 4D
  const b = buf;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
  if (b.length >= 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return true;
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return true;
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp') return true;
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return true;
  // Unknown binary (e.g. signed R2 bytes without a known header): accept as long
  // as it is not HTML/text. Content-type image/* already passed above.
  if (typeof contentType === 'string' && /^image\//i.test(contentType)) return true;
  // No content-type and no known magic: reject small text-like payloads only.
  if (b.length < 256) return false;
  return true;
}

/**
 * Collect unique downloadable photo URLs from a turn list.
 * Skips placeholders and data-URLs; preserves first-seen order.
 */
export function collectDownloadablePhotoUrls(turns) {
  const seen = new Set();
  const out = [];
  let skippedPlaceholders = 0;
  for (const t of turns || []) {
    const urls = [
      ...(Array.isArray(t.images) ? t.images : []),
      ...(Array.isArray(t.dispatches) ? t.dispatches.flatMap((d) => (Array.isArray(d.images) ? d.images : [])) : []),
    ];
    for (const u of urls) {
      if (typeof u !== 'string' || !u || u.startsWith('data:')) continue;
      if (!isDownloadablePhotoUrl(u)) {
        skippedPlaceholders++;
        continue;
      }
      if (!seen.has(u)) {
        seen.add(u);
        out.push(u);
      }
    }
  }
  return { urls: out, skippedPlaceholders };
}

/**
 * Per-turn remote URLs for the skeleton. A turn whose CanonicalRunTree
 * imageCount is 0 is text-only: it must get zero photos even when other
 * turns in the same job carry photos (no stale carry-over).
 */
export function turnRemoteUrls(t) {
  if (t && typeof t.imageCount === 'number' && t.imageCount === 0) return [];
  const remote = [
    ...(Array.isArray(t.images) ? t.images : []),
    ...(Array.isArray(t.dispatches) ? t.dispatches.flatMap((d) => (Array.isArray(d.images) ? d.images : [])) : []),
  ];
  return remote.filter(isDownloadablePhotoUrl);
}
/**
 * Rewrite R2 public URLs to the site's /photos/ proxy.
 * The raw *.r2.dev host often has an expired/mismatched cert; the Caddy-served
 * /photos/<key> endpoint serves the same bytes and trusts our CA chain.
 */
function resolvePhotoUrl(url) {
  if (typeof url === 'string' && /https?:\/\/[^/]*\.r2\.dev\/photos\//i.test(url)) {
    const idx = url.indexOf('/photos/');
    return `${BASE_URL}${url.slice(idx)}`;
  }
  if (url.startsWith('/')) return `${BASE_URL}${url}`;
  if (!/^https?:\/\//i.test(url)) return `${BASE_URL}/${url}`;
  return url;
}

async function downloadPhoto(url, photosDir) {
  const abs = resolvePhotoUrl(url);

  let nameFromUrl;
  try {
    const u = new URL(abs);
    const base = path.basename(u.pathname) || 'photo.jpg';
    nameFromUrl = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  } catch {
    nameFromUrl = `photo_${Buffer.from(url).toString('hex').slice(0, 16)}.jpg`;
  }
  const dest = path.join(photosDir, nameFromUrl);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    return { url, localPath: dest, bytes: fs.statSync(dest).size };
  }

  const res = await fetch(abs);
  if (!res.ok) throw new Error(`photo HTTP ${res.status}: ${abs}`);
  const contentType = res.headers ? res.headers.get('content-type') : null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`photo empty: ${abs}`);
  if (!isImageBuffer(buf, contentType)) {
    throw new Error(
      `photo not an image (content-type=${contentType || 'unknown'}, bytes=${buf.length}): ${abs} — placeholder/HTML error page, not a photo`
    );
  }
  fs.writeFileSync(dest, buf);
  return { url, resolvedUrl: abs, localPath: dest, bytes: buf.length, contentType };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    usage();
    process.exit(0);
  }

  if (options.list) {
    const jobs = await listJobs({ full: true });
    process.stdout.write(`${JSON.stringify(jobs.map(summarizeJob), null, 2)}\n`);
    process.exit(0);
  }

  console.error('Locating meal job...');
  let runTree;
  let targetJobId;

  if (options.debugFile) {
    targetJobId = options.jobId || path.basename(options.debugFile, '.json');
    console.error(`  Using local debug file ${options.debugFile}`);
    runTree = loadDebugFile(options.debugFile);
    targetJobId = runTree.jobId || targetJobId;
  } else {
    targetJobId = await resolveJobId(options);
    runTree = await fetchRunTree(targetJobId);
  }

  const turns = runTree.turns || [];
  if (turns.length === 0) {
    console.error(`[Fetch] Job ${targetJobId} reconstructed 0 turns — aborting (no placeholder skeleton).`);
    process.exit(1);
  }

  let mealTitle = options.name
    || (runTree.pendingFoodLog && (runTree.pendingFoodLog.title || runTree.pendingFoodLog.name))
    || null;
  if (!mealTitle) {
    for (const t of turns) {
      const ds = t.dispatches && t.dispatches[0] && t.dispatches[0].output && t.dispatches[0].output.dishes;
      if (Array.isArray(ds) && ds[0] && ds[0].dishName) {
        mealTitle = ds[0].dishName;
        break;
      }
    }
  }
  if (!mealTitle) mealTitle = 'Audited Meal';

  const bundleSlug = mealTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'meal';
  const outDir = options.outputDir || path.join(process.cwd(), 'artifacts', 'meal_audits', `Meal-${bundleSlug}-flow`);
  const photosDir = path.join(outDir, 'photos');
  fs.mkdirSync(photosDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, 'run_tree.json'), JSON.stringify(runTree, null, 2), 'utf-8');

  const { urls: photoUrls, skippedPlaceholders } = collectDownloadablePhotoUrls(turns);
  if (skippedPlaceholders > 0) {
    console.error(`[Fetch] Skipped ${skippedPlaceholders} placeholder/non-photo image entrie(s) ("[image omitted ...]", data-URLs).`);
  }

  const downloaded = [];
  const failed = [];
  for (const url of photoUrls) {
    try {
      downloaded.push(await downloadPhoto(url, photosDir));
    } catch (err) {
      failed.push({ url, error: err.message });
    }
  }
  if (failed.length > 0) {
    console.error(`[Fetch] ${failed.length} photo download(s) failed — aborting (fail-loud):`);
    for (const f of failed) console.error(`  - ${f.url}: ${f.error}`);
    process.exit(1);
  }
  const localByRemote = new Map(downloaded.map((d) => [d.url, path.relative(outDir, d.localPath)]));

  const passes = turns.map((t, idx) => {
    const remote = turnRemoteUrls(t);
    const addedPhotos = [...new Set(remote.map((u) => localByRemote.get(u)).filter(Boolean))];
    const turnNo = typeof t.turn === 'number' ? t.turn : idx + 1;
    return {
      turnIndex: turnNo,
      turnId: idx === 0 ? 'turn_1_initial' : `turn_${turnNo}_edit`,
      userPrompt: t.prompt || '',
      addedPhotos,
      imageCount: typeof t.imageCount === 'number' ? t.imageCount : addedPhotos.length,
      agentAnswer: typeof t.answer === 'string' ? t.answer : undefined,
      dishes: [],
      _needsAudit: true,
    };
  });

  const skeleton = {
    schemaVersion: '2.1.0',
    mealId: targetJobId,
    bundleName: `Meal-${bundleSlug}-01`,
    timestamp: runTree.exportedAt || new Date().toISOString(),
    title: mealTitle,
    mode: passes.length > 1 ? 'multi_turn_flow' : 'single_audit',
    retrievedFrom: {
      jobId: targetJobId,
      apiBase: BASE_URL,
      debugUrl: runTree.debugUrl || null,
      fetchedAt: new Date().toISOString(),
      photoCount: downloaded.length,
      sourcePhotos: downloaded.map((d) => ({
        remote: d.url,
        via: d.resolvedUrl !== d.url ? d.resolvedUrl : undefined,
        local: path.relative(outDir, d.localPath),
        bytes: d.bytes,
      })),
    },
    passes,
    notes: [
      'dishes[] intentionally empty — audit agent must fill after reviewing photos (no placeholder ground truth).',
      'Turn structure comes from the server CanonicalRunTree (buildTurnTimeline); do not re-parse invented event types.',
      'Photo truth: only downloadable http(s)//photos URLs are fetched; "[image omitted ...]" placeholders and data-URLs are skipped, HTML error pages are rejected (not saved as .jpg), and a turn with imageCount 0 stays photo-less (no carry-over from other turns).',
      'Audit rule: if a pass has zero usable photos, audit that pass from user text/debug only and say so — never borrow a photo from another turn or invent a Big Mac out of frame.',
    ],
  };

  const skeletonPath = path.join(outDir, 'flow_skeleton.json');
  fs.writeFileSync(skeletonPath, JSON.stringify(skeleton, null, 2), 'utf-8');

  console.error(`\nMeal flow retrieved for ${targetJobId}`);
  console.error(`Skeleton: ${skeletonPath}`);
  console.error(`Turns: ${passes.length} | Photos downloaded: ${downloaded.length}`);
  console.error('\nNext: audit photos and fill dishes[] per pass, then run:');
  console.error(`  node scripts/generate-meal-result.mjs --input="${skeletonPath}" --bundle-name="Meal-${bundleSlug}-01"`);
}

const isDirectCli = Boolean(
  process.argv[1] &&
  (import.meta.url === `file://${process.argv[1]}` ||
    (() => {
      try {
        return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
      } catch {
        return false;
      }
    })())
);

if (isDirectCli) {
  main().catch((err) => {
    console.error('[MealAuditFetch] Fatal:', err);
    process.exit(1);
  });
}

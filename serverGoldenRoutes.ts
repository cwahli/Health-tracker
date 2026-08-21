/**
 * Golden inbox API. Heavy blobs on R2. Tiny rows in golden_cases.
 * Replay does not call Gemini.
 */
import type { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import {
  buildScoreboard,
  deriveGoldenTitle,
  evaluateLogOutcomes,
  evaluateMealLines,
  extractMealLines,
  goldenSlug,
  journeyToOutcomes,
  scoreboardSummary,
  scoreGoldenRun,
  type GoldenAttempt,
  type GoldenMealLine,
  type GoldenOutcome,
  type GoldenScoreboard,
} from './src/utils/goldenScoreboard.js';
import { lookupCanonicalBaseFood } from './server_food_db.js';
import { catalogReplayGreen, replayScoutAgainstCatalog, shouldPersistReplayGreen } from './src/utils/goldenReplay.js';
import { compileGoldenMeal, formatLedgerBrief } from './src/utils/goldenLedger.js';
import { normalizeScoutItems } from './src/utils/goldenJourney.js';
import { d1Query } from './server_d1.js';
import { classifyStudioRed, studioLoopPlan, loopRedClass } from './src/utils/goldenStudio.js';
import {
  GOLDEN_LOOP_MAX_ITERS,
  GOLDEN_LOOP_TRANSPORT_RETRIES,
  decideLoop,
  emptyLoopState,
  fingerprintReds,
  loopRefusedPayload,
  loopStopMessage,
  nextLoopState,
  type GoldenLoopState,
} from './src/utils/goldenLoop.js';

function nowIso() {
  return new Date().toISOString();
}

function mapCaseRow(row: any) {
  if (!row) return row;
  return {
    ...row,
    all_green: row.all_green === 1 || row.all_green === true,
    pass_count: Number(row.pass_count || 0),
    fail_count: Number(row.fail_count || 0),
    iteration: Number(row.iteration || 0),
  };
}

async function gcInsert(fields: { tag_id?: string | null; job_id?: string | null; title: string; r2_prefix: string }) {
  const r = await d1Query<{ id: string }>(
    `INSERT INTO golden_cases (tag_id, job_id, title, status, r2_prefix, updated_at)
     VALUES (?, ?, ?, 'open', ?, ?)
     RETURNING id`,
    [fields.tag_id || null, fields.job_id || null, fields.title, fields.r2_prefix, nowIso()]
  );
  if (!r.success || !r.results[0]?.id) return { error: r.error || 'D1 insert failed', id: null as string | null };
  return { error: null as string | null, id: r.results[0].id };
}

async function gcGet(id: string) {
  const r = await d1Query(`SELECT * FROM golden_cases WHERE id = ? OR job_id = ? OR tag_id = ? LIMIT 1`, [id, id, id]);
  if (!r.success) return { error: r.error, data: null };
  return { error: null as string | null, data: r.results[0] ? mapCaseRow(r.results[0]) : null };
}

async function gcList(status?: string | null) {
  const r = status
    ? await d1Query(
        `SELECT id, tag_id, job_id, title, status, r2_prefix, pass_count, fail_count, iteration, all_green, last_replay_at, created_at, updated_at
         FROM golden_cases WHERE status = ? ORDER BY updated_at DESC LIMIT 50`,
        [status]
      )
    : await d1Query(
        `SELECT id, tag_id, job_id, title, status, r2_prefix, pass_count, fail_count, iteration, all_green, last_replay_at, created_at, updated_at
         FROM golden_cases ORDER BY updated_at DESC LIMIT 50`
      );
  if (!r.success) return { error: r.error, data: [] as any[] };
  return { error: null as string | null, data: r.results.map(mapCaseRow) };
}

async function gcListOpen() {
  const r = await d1Query(
    `SELECT * FROM golden_cases WHERE status IN ('open', 'in_progress') ORDER BY updated_at DESC LIMIT 1`
  );
  if (!r.success) return { error: r.error, data: null };
  return { error: null as string | null, data: r.results[0] ? mapCaseRow(r.results[0]) : null };
}

async function gcUpdate(id: string, patch: Record<string, any>) {
  const cols = Object.keys(patch);
  if (!cols.length) return { error: null as string | null };
  const sets = cols.map((c) => `${c} = ?`).join(', ');
  const vals = cols.map((c) => {
    const v = patch[c];
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
  const r = await d1Query(`UPDATE golden_cases SET ${sets} WHERE id = ?`, [...vals, id]);
  return { error: r.success ? null : r.error };
}

export type GoldenRouteDeps = {
  getS3Client?: () => any;
  bucketName?: string;
  publicUrlBase?: string;
};

function r2Base(deps: GoldenRouteDeps) {
  return (deps.publicUrlBase || process.env.CLOUDFLARE_R2_PUBLIC_URL || '').replace(/\/$/, '');
}

async function putR2(deps: GoldenRouteDeps, key: string, body: string | Buffer, contentType: string) {
  const client = deps.getS3Client?.();
  const bucket = deps.bucketName || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
  const url = `${r2Base(deps)}/${key}`;
  if (!client) return { key, url, ok: false };
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: payload, ContentType: contentType }));
  return { key, url, ok: true };
}

async function getR2Text(deps: GoldenRouteDeps, key: string): Promise<string | null> {
  const client = deps.getS3Client?.();
  const bucket = deps.bucketName || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
  if (!client) return null;
  try {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const stream = res.Body as any;
    if (stream?.transformToString) return await stream.transformToString();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks).toString('utf8');
  } catch {
    return null;
  }
}

async function getR2Bytes(deps: GoldenRouteDeps, key: string): Promise<{ body: Buffer; contentType: string } | null> {
  const client = deps.getS3Client?.();
  const bucket = deps.bucketName || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
  if (!client) return null;
  try {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const stream = res.Body as any;
    let body: Buffer;
    if (stream?.transformToByteArray) body = Buffer.from(await stream.transformToByteArray());
    else {
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      body = Buffer.concat(chunks);
    }
    return { body, contentType: String(res.ContentType || 'image/jpeg') };
  } catch {
    return null;
  }
}

export function r2KeyFromPhotoRef(ref: string): string | null {
  const raw = String(ref || '').trim();
  if (!raw || raw.startsWith('data:')) return null;
  const prefixes = /^(golden|photos|logs|debug|bugs|jobs)\//i;
  if (prefixes.test(raw) && !raw.includes('..')) return raw.replace(/^\/+/, '');
  try {
    const path = raw.startsWith('http') ? new URL(raw).pathname : raw;
    const cleaned = path.replace(/^\/+/, '').replace(/\.\./g, '');
    if (prefixes.test(cleaned)) return cleaned;
  } catch {
    /* ignore */
  }
  return null;
}

function unwrapFetchedLogs(body: string): string {
  const t = String(body || '');
  if (!t) return t;
  const trimmed = t.trim();
  if (trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(trimmed);
      const inner = j.backendLogs || j.result?.backendLogs || j.debug_payload?.backendLogs;
      if (inner && String(inner).length > 80) return String(inner);
    } catch {
      /* keep raw */
    }
  }
  return t;
}

function previewLogNeedsHydrate(logText: string): boolean {
  const t = String(logText || '');
  if (t.length < 800) return true;
  return !/\[Reconcile\]|\[Budget\]|\[CuratorAction\]/.test(t);
}

function casePrefix(id: string) {
  return `golden/${id}`;
}

function goldenMealRoot() {
  return path.join(process.cwd(), 'tests', 'Golden_meal');
}

function writeInboxIndex(root: string) {
  const inbox = path.join(root, 'inbox');
  if (!fs.existsSync(inbox)) return;
  const rows: string[] = ['# Golden inbox', '', '| Slug / folder | Title | Job | D1 |', '|---|---|---|---|'];
  let n = 0;
  for (const name of fs.readdirSync(inbox).sort()) {
    const casePath = path.join(inbox, name, 'case.json');
    if (!fs.existsSync(casePath)) continue;
    try {
      const c = JSON.parse(fs.readFileSync(casePath, 'utf-8'));
      rows.push(`| \`${name}\` | ${c.mealName || name} | \`${c.id || ''}\` | \`${c.d1Id || ''}\` |`);
      n += 1;
    } catch {
      /* skip */
    }
  }
  if (!n) {
    rows.push('', 'No open disk cases. The Golden Inbox UI reads D1 `golden_cases`, not this folder.');
  }
  fs.writeFileSync(path.join(inbox, 'INDEX.md'), `${rows.join('\n')}\n`);
}

function writeInboxCase(opts: {
  jobId: string;
  title: string;
  scout: any;
  journey: any[];
  d1Id: string;
}) {
  const jobId = opts.jobId || opts.d1Id;
  const slug = goldenSlug(opts.title, jobId);
  const dir = path.join(goldenMealRoot(), 'inbox', slug);
  fs.mkdirSync(dir, { recursive: true });
  const scoutOut = Array.isArray(opts.scout) ? { items: opts.scout } : opts.scout;
  if (scoutOut) {
    fs.writeFileSync(path.join(dir, 'scout.json'), JSON.stringify(scoutOut, null, 2));
  }
  const expectResolve = (opts.journey || [])
    .filter((j: any) => j.identityPass && j.matchId)
    .map((j: any) => ({ query: j.query, expectFdcId: String(j.matchId), foodName: j.matchName || null }));
  const neverMatch = (opts.journey || [])
    .filter((j: any) => j.phase === 'mismatch')
    .map((j: any) => ({
      query: j.query,
      forbiddenIds: j.matchId ? [String(j.matchId)] : [],
      forbiddenNames: j.matchName ? [j.matchName] : [],
    }));
  const spec = {
    id: jobId,
    status: 'open',
    mealName: opts.title,
    slug,
    d1Id: opts.d1Id,
    queries: (opts.journey || []).map((j: any) => j.query),
    expectResolve,
    neverMatch,
  };
  fs.writeFileSync(path.join(dir, 'case.json'), JSON.stringify(spec, null, 2));
  // Keep the raw job-id folder as a pointer so older scripts still find it.
  const alias = path.join(goldenMealRoot(), 'inbox', jobId);
  if (alias !== dir) {
    fs.mkdirSync(alias, { recursive: true });
    fs.writeFileSync(
      path.join(alias, 'case.json'),
      JSON.stringify({ ...spec, aliasOf: slug }, null, 2)
    );
    if (scoutOut) {
      fs.writeFileSync(path.join(alias, 'scout.json'), JSON.stringify(scoutOut, null, 2));
    }
  }
  writeInboxIndex(goldenMealRoot());
  return dir;
}

function promoteInboxToOfficial(jobId: string, title: string): { dir: string; goldenId: string } {
  const root = goldenMealRoot();
  const src = path.join(root, 'inbox', jobId);
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const nextNum = (manifest.goldens || []).length + 1;
  const slug = (title || jobId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  const dirName = `${nextNum}. ${slug}`;
  const dest = path.join(root, dirName);
  fs.mkdirSync(dest, { recursive: true });
  if (fs.existsSync(src)) {
    for (const name of fs.readdirSync(src)) {
      fs.copyFileSync(path.join(src, name), path.join(dest, name));
    }
  }
  const casePath = path.join(dest, 'case.json');
  const caseJson = fs.existsSync(casePath) ? JSON.parse(fs.readFileSync(casePath, 'utf-8')) : {};
  const expected = {
    id: `G${nextNum}`,
    title: title || caseJson.mealName || slug,
    mode: 'new_log',
    promotedFrom: jobId,
    passes: [{ id: 'replay', prompt: '', photos: [], kind: 'replay_scout' }],
    resolveLocks: caseJson.expectResolve || [],
    catalogGaps: [],
    neverMatch: caseJson.neverMatch || [],
    invariants: ['Promoted from golden inbox after catalog replay went green'],
  };
  fs.writeFileSync(path.join(dest, 'expected.json'), JSON.stringify(expected, null, 2));
  if (!fs.existsSync(path.join(dest, 'Instruction.md'))) {
    fs.writeFileSync(
      path.join(dest, 'Instruction.md'),
      `Promoted from inbox ${jobId}.\nReplay scout.json through the catalog. No Gemini.\n`
    );
  }
  manifest.goldens.push({
    id: `G${nextNum}`,
    dir: dirName,
    mode: 'new_log',
    title: expected.title,
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  if (fs.existsSync(src)) fs.rmSync(src, { recursive: true, force: true });
  return { dir: dirName, goldenId: `G${nextNum}` };
}

async function loadBoard(deps: GoldenRouteDeps, id: string): Promise<GoldenScoreboard | null> {
  const raw = await getR2Text(deps, `${casePrefix(id)}/scoreboard.json`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function loadAttempts(deps: GoldenRouteDeps, id: string): Promise<GoldenAttempt[]> {
  const raw = await getR2Text(deps, `${casePrefix(id)}/attempts.json`);
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

async function loadLoopState(deps: GoldenRouteDeps, id: string): Promise<GoldenLoopState> {
  const raw = await getR2Text(deps, `${casePrefix(id)}/loop-state.json`);
  if (!raw) return emptyLoopState();
  try {
    return { ...emptyLoopState(), ...JSON.parse(raw) };
  } catch {
    return emptyLoopState();
  }
}

async function saveLoopState(deps: GoldenRouteDeps, id: string, state: GoldenLoopState) {
  await putR2(deps, `${casePrefix(id)}/loop-state.json`, JSON.stringify(state, null, 2), 'application/json');
}

function analyzeBaseUrls(): string[] {
  // server.ts listens on 3000 (hardcoded). process.env.PORT is often 8080 in
  // hosted shells and would make a same-process fetch throw "fetch failed".
  const listenPort = '3000';
  const envPort = String(process.env.PORT || listenPort);
  const urls = [
    process.env.INTERNAL_BASE_URL,
    `http://127.0.0.1:${listenPort}`,
    `http://localhost:${listenPort}`,
    envPort !== listenPort ? `http://127.0.0.1:${envPort}` : '',
    envPort !== listenPort ? `http://localhost:${envPort}` : '',
  ]
    .map((u) => String(u || '').replace(/\/$/, ''))
    .filter(Boolean);
  return [...new Set(urls)];
}

async function photosToDataUrls(urls: string[]): Promise<string[]> {
  const out: string[] = [];
  const bases = analyzeBaseUrls();
  for (const raw of urls.slice(0, 8)) {
    const u = String(raw || '').trim();
    if (!u) continue;
    if (u.startsWith('data:image')) {
      out.push(u);
      continue;
    }
    const candidates = /^https?:\/\//i.test(u)
      ? [u]
      : bases.map((b) => `${b}${u.startsWith('/') ? u : `/${u}`}`);
    let ok = false;
    for (const href of candidates) {
      try {
        const r = await fetch(href);
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 80) continue;
        const ct = r.headers.get('content-type') || 'image/jpeg';
        const mime = ct.includes('png') ? 'image/png' : ct.includes('webp') ? 'image/webp' : 'image/jpeg';
        out.push(`data:${mime};base64,${buf.toString('base64')}`);
        ok = true;
        break;
      } catch {
        /* try next base */
      }
    }
    if (!ok) console.warn('[golden-analyze] could not fetch photo', u.slice(0, 120));
  }
  return out;
}

function extractScoutFromAnalyze(finalData: any, fallback: any): any {
  return (
    finalData?.scoutItems ||
    finalData?.agentResult?.scoutItems ||
    finalData?.data?.scoutItems ||
    finalData?.pendingFoodLog?.scoutItems ||
    fallback ||
    null
  );
}

async function runGoldenAnalyze(opts: {
  caseId: string;
  scout?: any;
  query?: string;
  images?: string[];
  skipScout: boolean;
  timeoutMs?: number;
}): Promise<{ ok: boolean; foodLog: any; logText: string; errorText: string; status: string; scout: any }> {
  const items = normalizeScoutItems(opts.scout);
  if (opts.skipScout && !items.length) {
    return { ok: false, foodLog: null, logText: '', errorText: 'No frozen scout', status: 'failed', scout: null };
  }
  if (!opts.skipScout && !(opts.images || []).length) {
    return { ok: false, foodLog: null, logText: '', errorText: 'No saved photos on this case', status: 'failed', scout: null };
  }
  const jobId = `golden_${opts.caseId.slice(0, 8)}_${Date.now()}`;
  const timeoutMs = opts.timeoutMs || (opts.skipScout ? 180_000 : 240_000);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Golden ${opts.skipScout ? 'pipeline' : 'analyze'} timed out after ${Math.round(timeoutMs / 1000)}s`)),
    timeoutMs
  );
  let lastErr = '';
  const bases = analyzeBaseUrls();
  for (let attempt = 0; attempt <= GOLDEN_LOOP_TRANSPORT_RETRIES; attempt++) {
    try {
      let res: globalThis.Response | null = null;
      let connectErr = '';
      for (const base of bases) {
        try {
          res = await fetch(`${base}/api/gemini/food-analyze?stream=true`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Session-ID': `server-job-${jobId}`,
            },
            body: JSON.stringify({
              jobId,
              message: opts.query || 'Analyze this meal photo.',
              text: opts.query || 'Analyze this meal photo.',
              skipScout: opts.skipScout === true,
              skipPortionClarify: true,
              userSelectedMode: 'review',
              ...(opts.skipScout
                ? { activeScoutItems: items, scoutItems: items, goldenReplay: true }
                : { images: opts.images, goldenAnalyze: true }),
            }),
            signal: controller.signal,
          });
          connectErr = '';
          break;
        } catch (e: any) {
          connectErr = e?.message || String(e);
        }
      }
      if (!res) {
        lastErr =
          `Could not reach the food engine (${connectErr || 'fetch failed'}). ` +
          `Restart the Node server (npm run dev).`;
        break;
      }
      if (!res.ok) {
        lastErr = `food-analyze HTTP ${res.status}`;
        if (res.status === 429 || res.status === 503) continue;
        break;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        lastErr = 'food-analyze stream not readable';
        break;
      }
      const decoder = new TextDecoder();
      let buffer = '';
      let finalData: any = null;
      const logs: string[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            if (parsed.error) {
              lastErr = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
            }
            if (parsed.type === 'log' && parsed.message) logs.push(String(parsed.message));
            if ((parsed.final === true || parsed.type === 'done') && parsed.result) finalData = parsed.result;
          } catch {
            /* incomplete SSE chunk */
          }
        }
      }
      clearTimeout(timer);
      const logText = String(finalData?.agentResult?.backendLogs || finalData?.backendLogs || logs.join('\n'));
      const foodLog = finalData?.data || finalData?.pendingFoodLog || finalData?.foodLog || null;
      if (!finalData) {
        lastErr = lastErr || 'Pipeline finished with no result';
        if (/429|RESOURCE_EXHAUSTED|503|stalled|timeout/i.test(lastErr) && attempt < GOLDEN_LOOP_TRANSPORT_RETRIES) {
          continue;
        }
        return { ok: false, foodLog: null, logText, errorText: lastErr, status: 'failed', scout: null };
      }
      return {
        ok: true,
        foodLog,
        logText,
        errorText: lastErr,
        status: 'succeeded',
        scout: extractScoutFromAnalyze(finalData, opts.scout),
      };
    } catch (e: any) {
      lastErr = e?.message || String(e);
      if (/429|RESOURCE_EXHAUSTED|503|stalled|timeout/i.test(lastErr) && attempt < GOLDEN_LOOP_TRANSPORT_RETRIES) {
        continue;
      }
    }
  }
  clearTimeout(timer);
  return { ok: false, foodLog: null, logText: '', errorText: lastErr || 'pipeline replay failed', status: 'failed', scout: null };
}

async function runSkipScoutPipeline(opts: {
  caseId: string;
  scout: any;
  query?: string;
}): Promise<{ ok: boolean; foodLog: any; logText: string; errorText: string; status: string }> {
  const r = await runGoldenAnalyze({ ...opts, skipScout: true });
  return { ok: r.ok, foodLog: r.foodLog, logText: r.logText, errorText: r.errorText, status: r.status };
}

function replayIdentity(outcomes: GoldenOutcome[]): GoldenOutcome[] {
  return outcomes.map((o) => {
    if (!o.enabled || o.kind !== 'identity' || !o.query || o.expected == null) return o;
    const hit = lookupCanonicalBaseFood(String(o.query));
    const actual = hit?.fdcId != null ? String(hit.fdcId) : null;
    return { ...o, actual, pass: actual === String(o.expected) };
  });
}

export function registerGoldenRoutes(app: Express, deps: GoldenRouteDeps = {}) {
  app.get('/api/golden/photo', async (req: Request, res: Response) => {
    const key = r2KeyFromPhotoRef(String(req.query.key || req.query.url || ''));
    if (!key) return res.status(400).send('key or url required');
    const hit = await getR2Bytes(deps, key);
    if (!hit) return res.status(404).send('Photo not found');
    res.setHeader('Content-Type', hit.contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(hit.body);
  });

  app.get('/api/golden/health', async (_req: Request, res: Response) => {
    const ping = await d1Query<{ n: number }>(`SELECT COUNT(*) AS n FROM golden_cases`);
    res.status(ping.success ? 200 : 500).json({
      d1: ping.success,
      rows: ping.results?.[0]?.n ?? null,
      error: ping.error || null,
      r2: Boolean(deps.getS3Client?.() && (deps.bucketName || process.env.CLOUDFLARE_R2_BUCKET_NAME)),
    });
  });

  app.post('/api/golden/preview', async (req: Request, res: Response) => {
    let logText = String(req.body?.logText || req.body?.backendLogs || '');
    let foodLog = req.body?.foodLog || req.body?.pendingFoodLog || null;
    let scout = req.body?.scout || req.body?.scoutItems || null;
    const pointer = logText.match(/\[Logs stored in R2:\s*(https?:\/\/\S+)\]/i);
    const extraUrl = String(req.body?.backendLogsUrl || req.body?.debugUrl || '');
    const jobId = String(req.body?.jobId || req.body?.job_id || '').trim();
    const url = pointer?.[1] || (/^https?:\/\//i.test(extraUrl) ? extraUrl : '');
    let needsHydrate = previewLogNeedsHydrate(logText);
    if (url && (pointer || needsHydrate)) {
      try {
        const fetched = await fetch(url);
        if (fetched.ok) {
          const body = unwrapFetchedLogs(await fetched.text());
          if (body && body.length > logText.length) logText = body;
        }
      } catch {
        /* keep short log */
      }
    }
    needsHydrate = previewLogNeedsHydrate(logText);
    if (needsHydrate) {
      const key = r2KeyFromPhotoRef(extraUrl) || r2KeyFromPhotoRef(url);
      if (key) {
        const text = await getR2Text(deps, key);
        if (text) {
          const body = unwrapFetchedLogs(text);
          if (body.length > logText.length) logText = body;
        }
      }
    }
    needsHydrate = previewLogNeedsHydrate(logText);
    if (jobId && (needsHydrate || !foodLog || !scout)) {
      try {
        const { fetchLogsFromR2, fetchDebugPayloadFromR2 } = await import('./src/utils/r2Storage.js');
        if (needsHydrate) {
          const logs = await fetchLogsFromR2(jobId);
          if (logs && logs.length > logText.length) logText = logs;
        }
        if (!foodLog || !scout || previewLogNeedsHydrate(logText)) {
          const payload = await fetchDebugPayloadFromR2(jobId);
          if (payload) {
            if (!foodLog) {
              foodLog =
                payload.pendingFoodLog ||
                payload.result?.pendingFoodLog ||
                payload.foodLog ||
                payload.foodData ||
                null;
            }
            if (!scout) {
              scout =
                payload.scoutItems ||
                payload.result?.scoutItems ||
                payload.scout ||
                payload.scoutSnapshot ||
                null;
            }
            const inner = payload.backendLogs || payload.result?.backendLogs;
            if (inner && String(inner).length > logText.length) logText = String(inner);
          }
        }
      } catch {
        /* keep what we have */
      }
    }
    const replayModeRaw = String(req.body?.replayMode || req.body?.mode || '');
    if (replayModeRaw === 'catalog' && !normalizeScoutItems(scout).length) {
      return res.status(409).json({
        error: 'No frozen scout on this card — Replay catalog cannot run.',
        replayMode: 'catalog',
      });
    }
    const board = buildScoreboard({
      logText,
      foodLog,
      scout,
      extraIssues: req.body?.extraIssues || [],
      errorText: req.body?.errorText || req.body?.error || '',
      jobStatus: req.body?.jobStatus || req.body?.status,
    });
    if (replayModeRaw === 'catalog') {
      const journey = replayScoutAgainstCatalog(scout, lookupCanonicalBaseFood);
      board.journey = journey;
      board.replayMode = 'catalog';
      board.invariants = [];
      board.outcomes = journeyToOutcomes(journey, []);
      board.ledger = compileGoldenMeal({
        foodLog,
        scout,
        replayMode: 'catalog',
      });
    }
    res.json(board);
  });

  app.post('/api/golden/cases', async (req: Request, res: Response) => {
    try {
      const jobId = String(req.body?.jobId || req.body?.job_id || '').trim() || null;
      const scoutEarly = req.body?.scout || req.body?.scoutItems || null;
      const foodLogEarly = req.body?.foodLog || req.body?.pendingFoodLog || null;
      const requestedTitle = String(req.body?.title || '').trim();
      const title = (
        requestedTitle && !/^golden\s+job_/i.test(requestedTitle) && !/^\[captured meal/i.test(requestedTitle)
          ? requestedTitle
          : deriveGoldenTitle({
              foodLog: foodLogEarly,
              scout: scoutEarly,
              jobId,
              fallback: requestedTitle,
            })
      ).slice(0, 120);
      const tagId = req.body?.tag_id || req.body?.tagId || null;
      let logText = String(req.body?.logText || req.body?.backendLogs || '');
      const r2Log = logText.match(/\[Logs stored in R2:\s*(https?:\/\/\S+)\]/i);
      if (r2Log) {
        try {
          const fetched = await fetch(r2Log[1]);
          if (fetched.ok) {
            const body = await fetched.text();
            if (body && body.length > 80) logText = body;
          }
        } catch {
          /* keep pointer */
        }
      }
      const jobStatus = req.body?.jobStatus || req.body?.status;
      const errExtra = String(req.body?.errorText || req.body?.error || '');
      if (errExtra && !logText.includes(errExtra) && !/stream stalled|no response from analysis engine/i.test(errExtra)) {
        logText = `${logText}\n[error] ${errExtra}`;
      }
      const scout = req.body?.scout || req.body?.scoutItems || null;
      const foodLog = req.body?.foodLog || req.body?.pendingFoodLog || null;
      const extraIssues: string[] = Array.isArray(req.body?.extraIssues) ? req.body.extraIssues : [];
      const errorText = errExtra;
      const expectedMeal: GoldenMealLine[] | undefined = req.body?.expectedMeal;
      const incomingQuery = String(req.body?.originalQuery || req.body?.query || '').trim();
      const incomingPhotos: string[] = Array.isArray(req.body?.photos) ? req.body.photos : [];

      const board = buildScoreboard({ logText, foodLog, extraIssues, scout, errorText, jobStatus });
      if (Array.isArray(expectedMeal) && expectedMeal.length) {
        board.expectedMeal = expectedMeal.map((l) => ({
          ...l,
          scored: l.scored || l.calories != null,
        }));
      } else {
        board.expectedMeal = board.expectedMeal.map((l) => ({
          ...l,
          scored: l.scored || l.calories != null,
        }));
      }
      if (Array.isArray(req.body?.outcomes) && req.body.outcomes.length) {
        board.outcomes = req.body.outcomes;
      }

      const pendingPrefix = `golden/pending-${Date.now()}`;
      const ins = await gcInsert({ tag_id: tagId, job_id: jobId, title, r2_prefix: pendingPrefix });
      if (ins.error || !ins.id) {
        return res.status(500).json({ error: ins.error || 'failed to insert golden_cases on D1' });
      }

      const id = ins.id;
      const prefix = casePrefix(id);
      await gcUpdate(id, { r2_prefix: prefix, updated_at: nowIso() });

      await putR2(deps, `${prefix}/scoreboard.json`, JSON.stringify(board, null, 2), 'application/json');
      if (scout) {
        await putR2(deps, `${prefix}/scout.json`, JSON.stringify(scout, null, 2), 'application/json');
      }
      if (logText) {
        await putR2(deps, `${prefix}/backend.log`, logText.slice(0, 400_000), 'text/plain');
      }
      if (foodLog) {
        await putR2(deps, `${prefix}/foodLog.json`, JSON.stringify(foodLog, null, 2), 'application/json');
      }

      const storedPhotos: string[] = [];
      for (let i = 0; i < incomingPhotos.slice(0, 8).length; i++) {
        const p = incomingPhotos[i];
        if (typeof p === 'string' && /^https?:\/\//i.test(p)) {
          storedPhotos.push(p);
          continue;
        }
        const m = typeof p === 'string' ? p.match(/^data:image\/([\w+]+);base64,(.+)$/) : null;
        if (!m) continue;
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1].replace('+', '');
        const key = `${prefix}/photos/${i}.${ext}`;
        const up = await putR2(deps, key, Buffer.from(m[2], 'base64'), `image/${m[1]}`);
        storedPhotos.push(up.url);
      }
      const fixture = {
        query: incomingQuery,
        photos: storedPhotos,
        photoUrl: storedPhotos[0] || null,
        jobId,
        capturedAt: new Date().toISOString(),
      };
      await putR2(deps, `${prefix}/fixture.json`, JSON.stringify(fixture, null, 2), 'application/json');
      // Q-6.4 item 6: do not mint tests/Golden_meal/inbox/ from D1 create/replay.
      // Official G* is Promote (deferred). Existing Inbox UI still reads D1 rows.
      await putR2(deps, `${prefix}/attempts.json`, '[]', 'application/json');
      await putR2(
        deps,
        `${prefix}/learnings.md`,
        `# ${title}\n\nJob: ${jobId || 'n/a'}\nCreated: ${new Date().toISOString()}\n\n## Attempts\n\n_(none yet)_\n`,
        'text/markdown'
      );

      const first = evaluateLogOutcomes(board.outcomes, logText);
      const meal = evaluateMealLines(board.expectedMeal, extractMealLines(foodLog));
      const ident = replayIdentity(first);
      const sum = scoreboardSummary(ident, meal.misses);
      await gcUpdate(id, {
        pass_count: sum.passCount,
        fail_count: sum.failCount,
        all_green: sum.allGreen,
        last_replay_at: nowIso(),
        updated_at: nowIso(),
      });

      res.json({
        id,
        r2_prefix: prefix,
        ...sum,
        outcomes: ident,
        mealMisses: meal.misses,
        tensions: board.tensions,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'create golden failed' });
    }
  });

  app.get('/api/golden/cases', async (req: Request, res: Response) => {
    try {
      const status = req.query.status ? String(req.query.status) : null;
      const { data, error } = await gcList(status);
      if (error) return res.status(500).json({ error });
      res.json({ cases: data || [] });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'list failed' });
    }
  });

  app.get('/api/golden/cases/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { data, error } = await gcGet(id);
      if (error || !data) return res.status(404).json({ error: error || 'not found' });
      const board = await loadBoard(deps, id);
      const attempts = await loadAttempts(deps, id);
      const learnings = await getR2Text(deps, `${casePrefix(id)}/learnings.md`);
      const fixtureRaw = await getR2Text(deps, `${casePrefix(id)}/fixture.json`);
      let fixture = null;
      try {
        fixture = fixtureRaw ? JSON.parse(fixtureRaw) : null;
      } catch {
        fixture = null;
      }
      if (board && !board.ledger) {
        const logText = (await getR2Text(deps, `${casePrefix(id)}/backend.log`)) || '';
        const foodRaw = await getR2Text(deps, `${casePrefix(id)}/foodLog.json`);
        const scoutRaw = await getR2Text(deps, `${casePrefix(id)}/scout.json`);
        let foodLog: any = null;
        let scout: any = null;
        try { foodLog = foodRaw ? JSON.parse(foodRaw) : null; } catch { foodLog = null; }
        try { scout = scoutRaw ? JSON.parse(scoutRaw) : null; } catch { scout = null; }
        board.ledger = compileGoldenMeal({
          logText,
          foodLog,
          scout,
          replayMode: board.replayMode,
        });
      }
      res.json({
        ...data,
        iteration: Math.max(Number(data.iteration || 0), (attempts || []).length || 1),
        board,
        attempts,
        learnings,
        fixture,
        logUrl: `${r2Base(deps)}/${casePrefix(id)}/backend.log`,
        scoutUrl: `${r2Base(deps)}/${casePrefix(id)}/scout.json`,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'get failed' });
    }
  });

  app.get('/api/golden/studio-brief', async (_req: Request, res: Response) => {
    try {
      const { data, error } = await gcListOpen();
      if (error) return res.status(500).json({ error });
      if (!data) return res.json({ empty: true, markdown: 'No open golden cases.' });
      const board = await loadBoard(deps, data.id);
      const attempts = await loadAttempts(deps, data.id);
      const learnings = await getR2Text(deps, `${casePrefix(data.id)}/learnings.md`);
      const fixtureRaw = await getR2Text(deps, `${casePrefix(data.id)}/fixture.json`);
      let fixture: any = null;
      try {
        fixture = fixtureRaw ? JSON.parse(fixtureRaw) : null;
      } catch {
        fixture = null;
      }
      const reds = (board?.outcomes || []).filter((o) => o.enabled && o.pass === false);
      const md = [
        `# Studio brief — ${data.title}`,
        '',
        `Case: ${data.id}`,
        `Job: ${data.job_id || 'n/a'}`,
        `Iteration: ${data.iteration}`,
        `Score: ${data.pass_count} pass / ${data.fail_count} fail`,
        '',
        '## Original user input (already captured — do not ask them to re-upload)',
        `Query: ${fixture?.query ? JSON.stringify(fixture.query) : '(empty prompt — photo-only)'}`,
        `Photos: ${(fixture?.photos || []).length}`,
        ...((fixture?.photos || []).map((u: string, i: number) => `- photo ${i + 1}: ${u}`)),
        `Scout JSON: ${r2Base(deps)}/${casePrefix(data.id)}/scout.json`,
        `Backend log: ${r2Base(deps)}/${casePrefix(data.id)}/backend.log`,
        '',
        '## Rules',
        '- Do NOT change expected meal numbers or delete outcome rows.',
        '- Do NOT claim COMPLETE. Replay decides pass/fail.',
        '- Read Attempts / Learnings before changing code. Do not retry a failed approach.',
        '- After edits: POST /api/golden/cases/' + data.id + '/attempt. Do NOT POST /loop.',
        '- Compiler: meal trial balance must agree. Catalog replay cannot promote.',
        '- Inner loop = unit test for the class. Two burned hypotheses → blocked_human.',
        '',
        '## Scout identity (auto — do not ask the user to re-list foods)',
        ...((board?.journey || []).length
          ? (board?.journey || []).map(
              (j) =>
                `- [${j.identityPass ? 'ok' : 'RED'}] ${j.dish} / ${j.query} → ${j.phase}${j.matchName ? ` (${j.matchName})` : ''}`
            )
          : ['- (no scout journey on this case)']),
        '',
        '## Auto invariants still red',
        ...((board?.invariants || []).filter((i) => !i.pass).length
          ? (board?.invariants || []).filter((i) => !i.pass).map((i) => `- [${i.group}] ${i.label}: ${i.actual}`)
          : ['- (none)']),
        '',
        '## Red outcomes',
        reds.length ? reds.map((o) => `- [${o.kind}] ${o.label} (expected ${o.expected}, actual ${o.actual ?? 'null'})`).join('\n') : '- (none marked fail — check meal lines / journey)',
        '',
        '## Expected meal (user-locked lines only)',
        ...(board?.expectedMeal || [])
          .filter((l) => l.scored)
          .map((l) => `- ${l.name}: ${l.weightGrams ?? '?'}g / ${l.calories ?? '—'} kcal`),
        '',
        '## Last attempts (do not repeat)',
        ...(attempts.slice(-8).map((a) => `- #${a.n} ${a.tried} → learned: ${a.learned}`)),
        '',
        '## Learnings',
        learnings || '(none)',
      ].join('\n');
      res.type('text/markdown').send(md);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'brief failed' });
    }
  });

  app.post('/api/golden/cases/:id/replay', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { data, error } = await gcGet(id);
      if (error || !data) return res.status(404).json({ error: error || 'not found' });
      const board = await loadBoard(deps, id);
      if (!board) return res.status(404).json({ error: 'scoreboard missing on R2' });

      const scoutRaw = await getR2Text(deps, `${casePrefix(id)}/scout.json`);
      let storedScout: any = null;
      try {
        storedScout = scoutRaw ? JSON.parse(scoutRaw) : null;
      } catch {
        storedScout = null;
      }
      if (!normalizeScoutItems(storedScout).length) {
        return res.status(409).json({
          error: 'No frozen scout on this case — job died before Vision Scout. Replay catalog cannot run. Fix quota/transport first.',
        });
      }

      const rawMode = String(req.body?.mode || 'log');
      const mode = rawMode === 'catalog' || rawMode === 'pipeline' ? rawMode : 'log';
      const agentCalls = mode === 'pipeline' ? 'possible' : 'none';
      console.log(`[golden-replay] case=${id} mode=${mode} agentCalls=${agentCalls}`);
      const freshFood = req.body?.foodLog || null;
      let foodLog: any = freshFood;
      if (!foodLog) {
        const storedFood = await getR2Text(deps, `${casePrefix(id)}/foodLog.json`);
        try {
          foodLog = storedFood ? JSON.parse(storedFood) : null;
        } catch {
          foodLog = null;
        }
      }

      let journey = board.journey || [];
      let invariants = board.invariants || [];
      let outcomes: GoldenOutcome[] = board.outcomes || [];
      let actualLines = board.observedMeal || [];
      let replayMode: GoldenScoreboard['replayMode'] = 'catalog';
      let pipelineError = '';

      if (mode === 'pipeline') {
        const fixtureRaw = await getR2Text(deps, `${casePrefix(id)}/fixture.json`);
        let fixture: any = null;
        try {
          fixture = fixtureRaw ? JSON.parse(fixtureRaw) : null;
        } catch {
          fixture = null;
        }
        const pipe = await runSkipScoutPipeline({
          caseId: id,
          scout: storedScout,
          query: fixture?.query,
        });
        pipelineError = pipe.errorText;
        if (pipe.ok && pipe.foodLog) {
          foodLog = pipe.foodLog;
          await putR2(deps, `${casePrefix(id)}/foodLog.json`, JSON.stringify(pipe.foodLog, null, 2), 'application/json');
        }
        if (pipe.logText) {
          await putR2(deps, `${casePrefix(id)}/backend.live.log`, pipe.logText.slice(0, 400_000), 'text/plain');
        }
        const extraIssues = (board.outcomes || [])
          .filter((o) => o.source === 'user')
          .map((o) => String(o.label || ''));
        const scored = scoreGoldenRun({
          logText: pipe.logText,
          foodLog: foodLog || { itemsBreakdown: board.observedMeal },
          scout: storedScout,
          expectedMeal: board.expectedMeal,
          extraIssues,
          errorText: pipe.ok ? '' : pipe.errorText,
          jobStatus: pipe.status,
          replayMode: 'pipeline',
          previousOutcomes: board.outcomes,
        });
        journey = scored.board.journey || [];
        invariants = scored.board.invariants || [];
        outcomes = scored.board.outcomes || [];
        actualLines = scored.board.observedMeal;
        replayMode = 'pipeline';
        board.outcomes = outcomes;
        board.observedMeal = actualLines;
        board.journey = journey;
        board.invariants = invariants;
        board.replayMode = 'pipeline';
        if (!pipe.ok) {
          return res.status(502).json({
            error: pipe.errorText || 'Pipeline replay failed',
            replayMode: 'pipeline',
            stopReason: /429|RESOURCE_EXHAUSTED|503|stalled|timeout/i.test(pipe.errorText)
              ? 'transport'
              : 'pipeline_failed',
          });
        }
      } else if (mode === 'log') {
        const logText = (await getR2Text(deps, `${casePrefix(id)}/backend.log`)) || '';
        const scored = scoreGoldenRun({
          logText,
          foodLog: foodLog || { itemsBreakdown: board.observedMeal },
          scout: storedScout,
          expectedMeal: board.expectedMeal,
          extraIssues: (board.outcomes || []).filter((o) => o.source === 'user').map((o) => String(o.label || '')),
          jobStatus: 'succeeded',
          replayMode: 'log',
          previousOutcomes: board.outcomes,
        });
        journey = scored.board.journey || [];
        invariants = scored.board.invariants || [];
        outcomes = scored.board.outcomes || [];
        actualLines = scored.board.observedMeal?.length ? scored.board.observedMeal : board.observedMeal;
        replayMode = 'log';
        board.outcomes = outcomes;
        board.observedMeal = actualLines;
        board.journey = journey;
        board.invariants = invariants;
        board.replayMode = replayMode;
      } else {
        // Frozen scout × current catalog. No Gemini.
        journey = replayScoutAgainstCatalog(storedScout, lookupCanonicalBaseFood);
        const sticky = (board.invariants || []).filter((i) => i.group !== 'identity' && i.group !== 'resolve');
        const identOutcomes = journeyToOutcomes(journey, [], { blockingOnly: true }).map((o) => {
          const row = journey.find((j) => j.id === o.id);
          return row?.identityPass ? { ...o, pass: true, actual: `${row.phase} ${row.matchId || ''}`.trim() } : o;
        });
        outcomes = identOutcomes.filter((o) => o.pass !== true);
        actualLines = foodLog
          ? extractMealLines(foodLog)
          : board.observedMeal && board.observedMeal.length > 0
            ? board.observedMeal
            : board.expectedMeal;
        board.outcomes = outcomes;
        board.observedMeal = actualLines;
        board.journey = journey;
        board.invariants = sticky;
        board.replayMode = 'catalog';
        replayMode = 'catalog';
      }

      const meal = evaluateMealLines(board.expectedMeal, actualLines);
      const identGreen = mode === 'catalog'
        ? catalogReplayGreen(journey)
        : journey.length > 0 && journey.every((j) => j.identityPass);
      const blockingReds = outcomes.filter(
        (o) => o.enabled && o.pass === false && loopRedClass(o.id, o.label) !== 'accept'
      );
      const plan = studioLoopPlan(outcomes);
      if (!board.ledger || mode === 'catalog') {
        board.ledger = compileGoldenMeal({
          foodLog,
          scout: storedScout,
          replayMode: mode,
        });
      }
      // Compiler: catalog replay cannot promote. Imbalance stays red.
      const allGreen = mode !== 'catalog' && identGreen && meal.pass && plan.promoteGreen && !!board.ledger?.mayPromote;
      const passCount = journey.filter((j) => j.identityPass).length + (meal.pass ? 1 : 0);
      const failCount =
        journey.filter((j) => !j.identityPass).length +
        (meal.pass ? 0 : 1) +
        blockingReds.filter((o) => o.kind !== 'identity' || /weight_anchor|label_merge/.test(o.id)).length;

      const persistGreen = shouldPersistReplayGreen(mode);
      const status = persistGreen
        ? allGreen
          ? 'green'
          : data.status === 'promoted'
            ? 'promoted'
            : 'open'
        : data.status;
      if (persistGreen) {
        await putR2(deps, `${casePrefix(id)}/scoreboard.json`, JSON.stringify(board, null, 2), 'application/json');
        const attempts = await loadAttempts(deps, id);
        const iteration = Math.max(data.iteration || 1, attempts.length || 1);
        await gcUpdate(id, {
          pass_count: passCount,
          fail_count: failCount,
          all_green: allGreen,
          iteration,
          status,
          last_replay_at: nowIso(),
          updated_at: nowIso(),
        });
      }

      res.json({
        id,
        replayMode,
        agentCalls,
        passCount,
        failCount,
        allGreen: persistGreen ? allGreen : !!data.all_green,
        mealMisses: meal.misses,
        outcomes,
        journey,
        status,
        pipelineError: pipelineError || undefined,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'replay failed' });
    }
  });

  app.post('/api/golden/cases/:id/analyze', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { data, error } = await gcGet(id);
      if (error || !data) return res.status(404).json({ error: error || 'not found' });
      const board = await loadBoard(deps, id);
      if (!board) return res.status(404).json({ error: 'scoreboard missing on R2' });

      const fixtureRaw = await getR2Text(deps, `${casePrefix(id)}/fixture.json`);
      let fixture: any = null;
      try {
        fixture = fixtureRaw ? JSON.parse(fixtureRaw) : null;
      } catch {
        fixture = null;
      }
      const photos = Array.isArray(fixture?.photos) ? fixture.photos.filter(Boolean) : [];
      if (!photos.length) {
        return res.status(409).json({
          error: 'No saved photos on this case. Snapshot again with “Save as golden meal” so photos are stored.',
        });
      }

      console.log(`[golden-analyze] case=${id} photos=${photos.length} query=${JSON.stringify(fixture?.query || '')}`);
      const images = await photosToDataUrls(photos);
      if (!images.length) {
        return res.status(502).json({
          error: 'Could not load the saved photos from storage. Check R2 / photo URLs.',
        });
      }

      const hadMerge = (board.outcomes || []).some(
        (o) => o.pass === false && /label_merge|merged into/.test(`${o.id} ${o.label}`)
      );

      const pipe = await runGoldenAnalyze({
        caseId: id,
        query: fixture?.query || 'Analyze this meal photo.',
        images,
        skipScout: false,
        timeoutMs: 240_000,
      });

      const oldScout = await getR2Text(deps, `${casePrefix(id)}/scout.json`);
      const oldLog = await getR2Text(deps, `${casePrefix(id)}/backend.log`);
      if (oldScout && !(await getR2Text(deps, `${casePrefix(id)}/scout.original.json`))) {
        await putR2(deps, `${casePrefix(id)}/scout.original.json`, oldScout, 'application/json');
      }
      if (oldLog && !(await getR2Text(deps, `${casePrefix(id)}/backend.original.log`))) {
        await putR2(deps, `${casePrefix(id)}/backend.original.log`, oldLog, 'text/plain');
      }

      const nextScout = pipe.scout;
      if (nextScout) {
        await putR2(deps, `${casePrefix(id)}/scout.json`, JSON.stringify(nextScout, null, 2), 'application/json');
      }
      if (pipe.ok && pipe.foodLog) {
        await putR2(deps, `${casePrefix(id)}/foodLog.json`, JSON.stringify(pipe.foodLog, null, 2), 'application/json');
      }
      if (pipe.logText) {
        await putR2(deps, `${casePrefix(id)}/backend.log`, pipe.logText.slice(0, 400_000), 'text/plain');
        await putR2(deps, `${casePrefix(id)}/backend.live.log`, pipe.logText.slice(0, 400_000), 'text/plain');
      }

      let expectedMeal = board.expectedMeal || [];
      const extraIssues = (board.outcomes || [])
        .filter((o) => o.source === 'user')
        .map((o) => String(o.label || ''));
      const scored = scoreGoldenRun({
        logText: pipe.logText,
        foodLog: pipe.foodLog || { itemsBreakdown: board.observedMeal },
        scout: nextScout,
        expectedMeal,
        extraIssues,
        errorText: pipe.ok ? '' : pipe.errorText,
        jobStatus: pipe.status,
        replayMode: 'analyze',
        previousOutcomes: board.outcomes,
      });
      const mergeGone = !(scored.board.invariants || []).some(
        (i) => !i.pass && /label_merge|merged into/.test(`${i.id} ${i.label}`)
      );
      if (hadMerge && mergeGone) {
        expectedMeal = expectedMeal.map((l) =>
          /serrano|gran reserva/i.test(l.name) ? { ...l, scored: false } : l
        );
        scored.board.expectedMeal = expectedMeal;
        const meal2 = evaluateMealLines(expectedMeal, scored.board.observedMeal);
        Object.assign(scored.summary, scoreboardSummary(scored.board.outcomes, meal2.misses));
        scored.meal = meal2;
      }

      board.outcomes = scored.board.outcomes;
      board.observedMeal = scored.board.observedMeal;
      board.journey = scored.board.journey;
      board.invariants = scored.board.invariants;
      board.expectedMeal = expectedMeal;
      board.replayMode = 'analyze';
      await putR2(deps, `${casePrefix(id)}/scoreboard.json`, JSON.stringify(board, null, 2), 'application/json');

      const plan = studioLoopPlan(scored.board.outcomes);
      const attempts = await loadAttempts(deps, id);
      const row: GoldenAttempt = {
        n: attempts.length + 1,
        at: new Date().toISOString(),
        actor: 'system',
        tried: `NEW Analyze from ${images.length} saved photo(s) + query ${JSON.stringify(fixture?.query || '')}. Vision Scout ran.`,
        learned: plan.promoteGreen
          ? 'Board is green after a new scout'
          : `Rescored. ${plan.instructions}`,
        next: plan.promoteGreen ? 'Promote if you agree' : plan.instructions,
        replaySummary: `analyze ${pipe.ok ? 'ok' : 'fail'} · ${scored.summary.passCount} pass / ${scored.summary.failCount} fail`,
      };
      await putR2(deps, `${casePrefix(id)}/attempts.json`, JSON.stringify([...attempts, row], null, 2), 'application/json');

      const status = plan.promoteGreen ? 'green' : pipe.ok ? 'open' : 'stalled';
      await gcUpdate(id, {
        pass_count: scored.summary.passCount,
        fail_count: scored.summary.failCount,
        all_green: plan.promoteGreen,
        iteration: Math.max(data.iteration || 1, attempts.length + 1),
        status,
        last_replay_at: nowIso(),
        updated_at: nowIso(),
      });

      if (!pipe.ok) {
        return res.status(502).json({
          error: pipe.errorText || 'NEW Analyze failed',
          stopReason: /429|RESOURCE_EXHAUSTED|503|stalled|timeout/i.test(pipe.errorText)
            ? 'transport'
            : 'analyze_failed',
          replayMode: 'analyze',
          agentCalls: 'vision_scout',
        });
      }

      res.json({
        id,
        replayMode: 'analyze',
        agentCalls: 'vision_scout',
        allGreen: plan.promoteGreen,
        passCount: scored.summary.passCount,
        failCount: scored.summary.failCount,
        mealMisses: scored.meal.misses,
        outcomes: scored.board.outcomes,
        journey: scored.board.journey,
        status,
        message: plan.instructions,
        studioMayClaim: plan.studioMayClaim,
        query: fixture?.query || '',
        photoCount: images.length,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'analyze failed' });
    }
  });

  app.post('/api/golden/cases/:id/ingest', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { data, error } = await gcGet(id);
      if (error || !data) return res.status(404).json({ error: error || 'not found' });
      const board = await loadBoard(deps, id);
      if (!board) return res.status(404).json({ error: 'scoreboard missing on R2' });

      const foodLog = req.body?.foodLog || null;
      const nextScout = req.body?.scout || null;
      let logText = String(req.body?.logText || '');
      const errorText = String(req.body?.errorText || '');
      const jobStatus = String(req.body?.jobStatus || 'succeeded');

      const oldScout = await getR2Text(deps, `${casePrefix(id)}/scout.json`);
      const oldLog = await getR2Text(deps, `${casePrefix(id)}/backend.log`);
      const incomingTooThin =
        logText.trim().length < 400 || /^\[Logs stored in R2:/i.test(logText.trim());
      if (incomingTooThin && (oldLog || '').length > 1000) {
        return res.status(409).json({
          error: 'Refusing to overwrite a full golden tape with an empty/pointer log. NEW Analyze must finish with a real backend log.',
        });
      }
      if (oldScout && !(await getR2Text(deps, `${casePrefix(id)}/scout.original.json`))) {
        await putR2(deps, `${casePrefix(id)}/scout.original.json`, oldScout, 'application/json');
      }
      if (oldLog && !(await getR2Text(deps, `${casePrefix(id)}/backend.original.log`))) {
        await putR2(deps, `${casePrefix(id)}/backend.original.log`, oldLog, 'text/plain');
      }
      if (nextScout) {
        await putR2(deps, `${casePrefix(id)}/scout.json`, JSON.stringify(nextScout, null, 2), 'application/json');
      }
      if (foodLog) {
        await putR2(deps, `${casePrefix(id)}/foodLog.json`, JSON.stringify(foodLog, null, 2), 'application/json');
      }
      if (logText) {
        await putR2(deps, `${casePrefix(id)}/backend.log`, logText.slice(0, 400_000), 'text/plain');
        await putR2(deps, `${casePrefix(id)}/backend.live.log`, logText.slice(0, 400_000), 'text/plain');
      }

      const hadMerge = (board.outcomes || []).some(
        (o) => o.pass === false && /label_merge|merged into/.test(`${o.id} ${o.label}`)
      );
      let expectedMeal = board.expectedMeal || [];
      const extraIssues = (board.outcomes || [])
        .filter((o) => o.source === 'user')
        .map((o) => String(o.label || ''));
      const scored = scoreGoldenRun({
        logText,
        foodLog: foodLog || { itemsBreakdown: board.observedMeal },
        scout: nextScout,
        expectedMeal,
        extraIssues,
        errorText,
        jobStatus,
        replayMode: 'analyze',
        previousOutcomes: board.outcomes,
      });
      const mergeGone = !(scored.board.invariants || []).some(
        (i) => !i.pass && /label_merge|merged into/.test(`${i.id} ${i.label}`)
      );
      if (hadMerge && mergeGone) {
        expectedMeal = expectedMeal.map((l) =>
          /serrano|gran reserva/i.test(l.name) ? { ...l, scored: false } : l
        );
        scored.board.expectedMeal = expectedMeal;
        const meal2 = evaluateMealLines(expectedMeal, scored.board.observedMeal);
        Object.assign(scored.summary, scoreboardSummary(scored.board.outcomes, meal2.misses));
        scored.meal = meal2;
      }

      board.outcomes = scored.board.outcomes;
      board.observedMeal = scored.board.observedMeal;
      board.journey = scored.board.journey;
      board.invariants = scored.board.invariants;
      board.expectedMeal = expectedMeal;
      board.replayMode = 'analyze';
      await putR2(deps, `${casePrefix(id)}/scoreboard.json`, JSON.stringify(board, null, 2), 'application/json');

      const plan = studioLoopPlan(scored.board.outcomes, {
        mealMisses: scored.meal.misses,
        replayMode: 'analyze',
      });
      const attempts = await loadAttempts(deps, id);
      const row: GoldenAttempt = {
        n: attempts.length + 1,
        at: new Date().toISOString(),
        actor: 'system',
        tried: `Ingested tracked food job ${req.body?.jobId || ''} into this golden. Full scout + resolve.`,
        learned: plan.promoteGreen ? 'Board is green after NEW Analyze' : plan.instructions,
        next: plan.promoteGreen ? 'Promote if you agree' : plan.instructions,
        replaySummary: `ingest ${jobStatus} · ${scored.summary.passCount} pass / ${scored.summary.failCount} fail`,
      };
      await putR2(deps, `${casePrefix(id)}/attempts.json`, JSON.stringify([...attempts, row], null, 2), 'application/json');
      await gcUpdate(id, {
        pass_count: scored.summary.passCount,
        fail_count: scored.summary.failCount,
        all_green: plan.promoteGreen,
        job_id: req.body?.jobId || data.job_id,
        iteration: Math.max(data.iteration || 1, attempts.length + 1),
        status: plan.promoteGreen ? 'green' : 'open',
        last_replay_at: nowIso(),
        updated_at: nowIso(),
      });

      res.json({
        id,
        replayMode: 'analyze',
        allGreen: plan.promoteGreen,
        passCount: scored.summary.passCount,
        failCount: scored.summary.failCount,
        mealMisses: scored.meal.misses,
        message: plan.instructions,
        studioMayClaim: plan.studioMayClaim,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'ingest failed' });
    }
  });

  app.post('/api/golden/cases/:id/loop', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { data, error } = await gcGet(id);
      if (error || !data) return res.status(404).json({ error: error || 'not found' });
      const board = await loadBoard(deps, id);
      const fixtureRaw = await getR2Text(deps, `${casePrefix(id)}/fixture.json`);
      let fixture: any = null;
      try {
        fixture = fixtureRaw ? JSON.parse(fixtureRaw) : null;
      } catch {
        fixture = null;
      }
      let filed: { tag_id?: string; public_n?: number } = {};
      try {
        const { tryAutoFileGolden } = await import('./serverBugAutoFile.js');
        const out = await tryAutoFileGolden({
          caseId: id,
          title: data.title,
          query: fixture?.query,
          jobId: data.job_id,
          debugUrl: `${r2Base(deps)}/${casePrefix(id)}/scout.json`,
          photoUrls: Array.isArray(fixture?.photos) ? fixture.photos : [],
          outcomes: board?.outcomes,
          mealMisses: (board?.outcomes || [])
            .filter((o) => o.pass === false && /missing item/i.test(String(o.label || '')))
            .map((o) => String(o.label || o.id || '')),
        });
        if (out?.tag_id) filed = { tag_id: out.tag_id, public_n: out.public_n };
      } catch (autoErr: any) {
        console.warn('[golden/loop] auto-file skipped:', autoErr?.message || autoErr);
      }
      return res.status(410).json(loopRefusedPayload(filed));
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'loop failed' });
    }
  });

  app.post('/api/golden/cases/:id/attempt', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { data, error } = await gcGet(id);
      if (error || !data) return res.status(404).json({ error: error || 'not found' });

      const attempts = await loadAttempts(deps, id);
      const n = attempts.length + 1;
      const row: GoldenAttempt = {
        n,
        at: new Date().toISOString(),
        actor: req.body?.actor === 'human' ? 'human' : 'studio',
        tried: String(req.body?.tried || '').slice(0, 2000),
        learned: String(req.body?.learned || '').slice(0, 2000),
        next: String(req.body?.next || '').slice(0, 2000),
        createdNewIssue: req.body?.createdNewIssue ? String(req.body.createdNewIssue).slice(0, 500) : undefined,
      };
      attempts.push(row);
      await putR2(deps, `${casePrefix(id)}/attempts.json`, JSON.stringify(attempts, null, 2), 'application/json');

      const prev = (await getR2Text(deps, `${casePrefix(id)}/learnings.md`)) || '';
      const block = [
        '',
        `## Attempt ${n} (${row.at})`,
        `- Actor: ${row.actor}`,
        `- Tried: ${row.tried}`,
        `- Learned: ${row.learned}`,
        `- Next: ${row.next}`,
        row.createdNewIssue ? `- Created new issue: ${row.createdNewIssue}` : '',
        n >= 5 && row.createdNewIssue
          ? `- **Do not retry this class of change** — past ${n} iterations already spawned a new bug.`
          : '',
      ]
        .filter(Boolean)
        .join('\n');
      await putR2(deps, `${casePrefix(id)}/learnings.md`, `${prev.trim()}\n${block}\n`, 'text/markdown');

      await gcUpdate(id, {
        iteration: n,
        status: data.all_green ? data.status || 'green' : 'in_progress',
        updated_at: nowIso(),
      });

      try {
        const loopState = await loadLoopState(deps, id);
        await saveLoopState(deps, id, {
          ...loopState,
          lastAttemptAt: row.at,
          locked: false,
          lastStop: loopState.lastStop === 'locked' || loopState.lastStop === 'no_progress' || loopState.lastStop === 'max_iterations'
            ? null
            : loopState.lastStop,
        });
      } catch {
        /* loop state optional */
      }

      res.json({ ok: true, attempt: row, iteration: n });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'attempt failed' });
    }
  });

  app.post('/api/golden/cases/:id/promote', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { data } = await gcGet(id);
      if (!data) return res.status(404).json({ error: 'not found' });
      const boardForPromote = await loadBoard(deps, id);
      if (!data.all_green || (boardForPromote?.ledger && !boardForPromote.ledger.mayPromote)) {
        return res.status(409).json({ error: 'Compiler will not promote (unbalanced books or catalog replay).' });
      }
      const jobId = data.job_id || id;
      let disk: { dir: string; goldenId: string } | null = null;
      try {
        disk = promoteInboxToOfficial(jobId, data.title);
      } catch (diskErr: any) {
        return res.status(500).json({ error: `Wrote D1 promoted flag skipped — disk promote failed: ${diskErr?.message}` });
      }
      await gcUpdate(id, { status: 'promoted', updated_at: nowIso() });
      res.json({ ok: true, status: 'promoted', goldenId: disk.goldenId, dir: disk.dir });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'promote failed' });
    }
  });

  app.get('/api/golden/cases/:id/studio-brief', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { data, error } = await gcGet(id);
      if (error || !data) return res.status(404).json({ error: error || 'not found' });
      const board = await loadBoard(deps, id);
      const attempts = await loadAttempts(deps, id);
      const learnings = await getR2Text(deps, `${casePrefix(id)}/learnings.md`);
      const fixtureRaw = await getR2Text(deps, `${casePrefix(id)}/fixture.json`);
      let fixture: any = null;
      try {
        fixture = fixtureRaw ? JSON.parse(fixtureRaw) : null;
      } catch {
        fixture = null;
      }
      const reds = (board?.outcomes || []).filter((o) => o.enabled && o.pass === false);
      const plan = studioLoopPlan(board?.outcomes);
      const md = [
        `# Studio brief — ${data.title}`,
        '',
        `Case: ${data.id}`,
        `Job: ${data.job_id || 'n/a'}`,
        `Replay: ${board?.replayMode || 'log'} (catalog replay = frozen scout, no Gemini)`,
        `Score: ${data.pass_count} pass / ${data.fail_count} fail`,
        '',
        '## Loop policy (read this first)',
        `- mayLoop: ${plan.mayLoop ? 'yes' : 'NO'}`,
        `- studioMayClaim: ${plan.studioMayClaim}`,
        `- ${plan.instructions}`,
        '- Accept rows are NOT fails. Do not hunt them. Do not invent printed macros.',
        '- If mayLoop is NO, do NOT POST /loop. That wastes quota and cannot un-merge scout.',
        '- COMPLETE is only allowed when studioMayClaim is complete.',
        '- pipeline_done_human_analyze = your resolve work is done; a human must NEW Analyze.',
        '',
        '## Original user input (already captured — do not ask them to re-upload)',
        `Query: ${fixture?.query ? JSON.stringify(fixture.query) : '(empty prompt — photo-only)'}`,
        `Photos: ${(fixture?.photos || []).length}`,
        ...((fixture?.photos || []).map((u: string, i: number) => `- photo ${i + 1}: ${u}`)),
        `Scout JSON: ${r2Base(deps)}/${casePrefix(id)}/scout.json`,
        `Backend log: ${r2Base(deps)}/${casePrefix(id)}/backend.log`,
        '',
        '## Rules',
        '- Do NOT change expected meal numbers or delete outcome rows.',
        '- Do NOT claim COMPLETE if studioMayClaim is not complete.',
        '- Do NOT retry a 429 by re-uploading photos into the same model.',
        '- After a class unit test is green: one Pipeline replay (skipScout). Do not POST /loop.',
        '- Catalog replay cannot promote. Unbalanced trial balance cannot promote.',
        '- If Next says NEW Analyze, do not Replay log and call it fixed.',
        '',
        board?.ledger ? formatLedgerBrief(board.ledger) : '',
        '',
        '## Scout identity',
        ...((board?.journey || []).length
          ? (board?.journey || []).map(
              (j) =>
                `- [${j.identityPass ? 'ok' : 'RED'}] ${j.dish} / ${j.query} → ${j.phase}${j.matchId ? ` (${j.matchId})` : ''}`
            )
          : ['- (no scout — transport failure)']),
        '',
        '## Auto invariants still red',
        ...((board?.invariants || []).filter((i) => !i.pass).length
          ? (board?.invariants || []).filter((i) => !i.pass).map((i) => `- [${i.group}] ${i.label}: ${i.actual}`)
          : ['- (none)']),
        '',
        '## How to clear each red (do this, not guess)',
        ...(reds.length
          ? reds.map((o) => {
              const c = classifyStudioRed(o.id, o.label);
              return `- ${o.label}\n  Next: ${c.next}${c.note ? `\n  Note: ${c.note}` : ''}`;
            })
          : ['- (none)']),
        '',
        '## Red outcomes',
        reds.length ? reds.map((o) => `- [${o.kind}] ${o.label}`).join('\n') : '- (none)',
        '',
        '## Last attempts (do not repeat)',
        ...(attempts.slice(-8).map((a) => `- #${a.n} ${a.tried} → learned: ${a.learned}`) || ['- (none)']),
        '',
        '## Learnings',
        learnings || '(none)',
      ].join('\n');
      res.type('text/markdown').send(md);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'brief failed' });
    }
  });

  app.delete('/api/golden/cases/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { data } = await gcGet(id);
      const targetId = data?.id || id;
      const candidates = [data?.id, data?.job_id, data?.tag_id, id].filter(Boolean) as string[];

      // Clean from D1
      await d1Query(`DELETE FROM golden_cases WHERE id = ? OR job_id = ? OR tag_id = ?`, [targetId, targetId, targetId]);

      // Clean up disk inbox directory if present
      const root = goldenMealRoot();
      const inbox = path.join(root, 'inbox');
      if (fs.existsSync(inbox)) {
        let diskChanged = false;
        for (const name of fs.readdirSync(inbox)) {
          for (const c of candidates) {
            if (name === c || (c.length > 5 && name.includes(c))) {
              try {
                fs.rmSync(path.join(inbox, name), { recursive: true, force: true });
                diskChanged = true;
              } catch (err) {
                console.warn('[golden-delete] disk delete error:', err);
              }
              break;
            }
          }
        }
        if (diskChanged) {
          writeInboxIndex(root);
        }
      }

      res.json({ ok: true });
    } catch (e: any) {
      console.error('[golden-delete] error:', e);
      res.status(500).json({ error: e?.message || 'delete failed' });
    }
  });
}

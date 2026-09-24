/**
 * Initiative K — Bug snapshot packs on R2 + brief API + triage digest.
 * Mount: registerBugSnapshotRoutes(app, { callUnifiedLLM, getS3Client, ... })
 */

import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import {
  bugTagR2Prefix,
  bugReportR2Prefix,
  bugShotKey,
  bugManifestKey,
  bugMetaKey,
  bugIdentifiedProblemsKey,
  cleanBugLogText,
  budgetPayloadForDigest,
  buildBugTriageSystemPrompt,
  buildBugTriageUserPrompt,
  briefFromTag,
  parseDataUrl,
  BUG_SNAPSHOT_MAX_SHOTS,
  BUG_SNAPSHOT_LOG,
  BUG_TRIAGE_LOG,
  AGENT_STRUCTURE_DEFAULT,
  TIER1_MAX_SHOTS,
  type BugSnapshotManifest,
} from './src/utils/bugSnapshot';
import { domainPackForAgent, buildOverviewMarkdown } from './src/utils/bugDomainPacks';
import { stripHeavyImages } from './src/utils/debugPayload';
import { findIssueTag, normalizeTagKey, normIssueTag } from './serverIssueBacklog.js';
import {
  appendEvidenceCommit,
  applySnapRemaining,
  applyAttempt,
  assignMissingPublicNs,
  assignPublicN,
  buildNow,
  buildStartPayload,
  hydrateWorkItem,
  pickQueueTag,
  prefillBug,
} from './src/utils/bugWorkItem';
import {
  bugState,
  projectBugState,
  validateDefect,
  validatePlan,
  validateRepro,
  validateVerify,
} from './src/utils/bugTicketState';
import { overlayAutoRemaining, planReanalyzeStages, restageBoardFromCatalog, failingAutoWorkLines } from './src/utils/bugTapeReview';
import { classifyGoldenReds, shouldHoldR2 } from './src/utils/bugAutoFile';
import { persistAutoFile, tryAutoFileGolden, tryAutoFileJob } from './serverBugAutoFile.js';
import { planInboxMigration } from './src/utils/bugInboxMigrate';
import type { NextFunction } from 'express';

/**
 * A-f5 — write-endpoint token guard (P3: X-Bug-Api-Token).
 * Allows: (1) matching BUG_API_TOKEN, (2) same-origin browser (Origin/Referer === Host),
 * (3) loopback when no token is configured (dev/tests). Everything else → 401.
 */
export function bugWriteGuard(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.BUG_API_TOKEN || '';
  const provided = String(req.headers['x-bug-api-token'] || '');
  if (expected && provided && provided === expected) return next();
  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    try {
      if (new URL(String(origin)).host === String(req.headers.host || '')) return next();
    } catch {
      /* fall through */
    }
  }
  if (!expected) {
    const ip = req.ip || (req.socket as any)?.remoteAddress || '';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
    return res.status(401).json({ error: 'unauthorized: BUG_API_TOKEN not configured' });
  }
  return res.status(401).json({ error: 'unauthorized: X-Bug-Api-Token required' });
}

async function loadJobTape(jobId: string): Promise<{ logText: string; foodLog: any; scout: any }> {
  let logText = '';
  let foodLog: any = null;
  let scout: any = null;
  const { fetchLogsFromR2, fetchDebugPayloadFromR2 } = await import('./src/utils/r2Storage.js');
  const logs = await fetchLogsFromR2(jobId);
  if (logs) logText = logs;
  const payload = await fetchDebugPayloadFromR2(jobId);
  if (payload) {
    foodLog = payload.pendingFoodLog || payload.result?.pendingFoodLog || null;
    scout = payload.scoutItems || payload.result?.scoutItems || null;
  }
  if (!foodLog || !scout) {
    // D-2: D1-only fallback (agent_jobs.clean_result is JSON text; d1GetJob parses).
    try {
      const { d1GetJob } = await import('./server_db_d1.js');
      const job = await d1GetJob(jobId);
      const cr = (job as any)?.clean_result || {};
      if (!foodLog) foodLog = cr.pendingFoodLog || null;
      if (!scout) scout = cr.scoutItems || null;
    } catch {
      /* R2-only tape */
    }
  }
  return { logText, foodLog, scout };
}

async function refreshTapeRemaining(item: ReturnType<typeof hydrateWorkItem>) {
  const jobId = item.current_evidence?.job_id;
  if (!jobId) return item;
  try {
    const tape = await loadJobTape(jobId);
    const { buildScoreboard } = await import('./src/utils/goldenScoreboard.js');
    const board = buildScoreboard({ logText: tape.logText, foodLog: tape.foodLog, scout: tape.scout });
    return overlayAutoRemaining(item, board);
  } catch {
    return item;
  }
}

async function persistMissingPublicNs(tags: any[]): Promise<any[]> {
  const assigned = assignMissingPublicNs(tags);
  for (const row of assigned) {
    await persistWorkItem(row.id, row.item);
    const hit = tags.find((t) => t.id === row.id);
    if (hit) hit.work_item = row.item;
  }
  return tags;
}

async function persistWorkItem(tagId: string, item: ReturnType<typeof hydrateWorkItem>): Promise<boolean> {
  try {
    const { d1Query } = await import('./server_d1.js');
    const res = await d1Query(`UPDATE issue_tags SET work_item = ?, updated_at = datetime('now') WHERE id = ?`, [
      JSON.stringify(item),
      tagId,
    ]);
    if (!res.success) {
      console.warn(`${BUG_SNAPSHOT_LOG} work_item persist skipped:`, res.error);
      return false;
    }
    return true;
  } catch (e: any) {
    console.warn(`${BUG_SNAPSHOT_LOG} work_item persist failed:`, e?.message || e);
    return false;
  }
}

async function findTagByParam(param: string): Promise<any | null> {
  return findIssueTag(param);
}

export type BugSnapshotDeps = {
  callUnifiedLLM?: (args: any) => Promise<any>;
  getS3Client?: () => any;
  bucketName?: string;
  publicUrlBase?: string;
  addDebugLog?: (msg: string, sessionId?: string) => void;
};

async function putR2Object(
  deps: BugSnapshotDeps,
  key: string,
  body: Buffer | string,
  contentType: string
): Promise<{ key: string; url: string; ok: boolean }> {
  const base = (deps.publicUrlBase || process.env.CLOUDFLARE_R2_PUBLIC_URL || '').replace(/\/$/, '');
  const url = base ? `${base}/${key}` : `r2://${key}`;
  const client = deps.getS3Client?.();
  const bucket = deps.bucketName || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
  if (!client) {
    console.warn(`${BUG_SNAPSHOT_LOG} R2 client missing; returning synthetic url key=${key}`);
    return { key, url, ok: false };
  }
  try {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buf,
        ContentType: contentType,
      })
    );
    return { key, url, ok: true };
  } catch (err: any) {
    console.error(`${BUG_SNAPSHOT_LOG} put failed key=${key}`, err?.message || err);
    return { key, url, ok: false };
  }
}

async function getR2ObjectText(deps: BugSnapshotDeps, key: string): Promise<string | null> {
  const client = deps.getS3Client?.();
  const bucket = deps.bucketName || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
  if (!client) return null;
  try {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const stream = res.Body as any;
    if (stream && typeof stream.transformToString === 'function') {
      return await stream.transformToString();
    }
    if (stream && typeof stream.transformToByteArray === 'function') {
      const bytes = await stream.transformToByteArray();
      return Buffer.from(bytes).toString('utf8');
    }
    return null;
  } catch {
    return null;
  }
}

/** Binary-safe variant for images — transformToString() corrupts JPEG/PNG bytes. */
async function getR2ObjectBuffer(deps: BugSnapshotDeps, key: string): Promise<Buffer | null> {
  const client = deps.getS3Client?.();
  const bucket = deps.bucketName || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
  if (!client) return null;
  try {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const stream = res.Body as any;
    if (stream && typeof stream.transformToByteArray === 'function') {
      const bytes = await stream.transformToByteArray();
      return Buffer.from(bytes);
    }
    if (stream && typeof stream.on === 'function') {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return Buffer.concat(chunks);
    }
    return null;
  } catch {
    return null;
  }
}

function contentTypeForArtifact(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.json')) return 'application/json';
  return 'text/plain';
}

async function deleteR2Object(deps: BugSnapshotDeps, key: string): Promise<boolean> {
  const client = deps.getS3Client?.();
  const bucket = deps.bucketName || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
  if (!client) return false;
  try {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Read identified_problems with column fallback into comments marker. */
function readIdentifiedProblems(tag: any): string {
  if (tag?.identified_problems && String(tag.identified_problems).trim()) {
    return String(tag.identified_problems);
  }
  const comments = Array.isArray(tag?.comments) ? tag.comments : [];
  const marker = comments.find((c: any) => c?.kind === 'identified_problems');
  return marker?.body ? String(marker.body) : '';
}

async function writeIdentifiedProblems(
  tagId: string,
  text: string,
  existing: any
): Promise<{ ok: boolean; via: string; tag?: any }> {
  // D-2: D1 issue_tags has no identified_problems column — persist as a
  // special comments marker (previously the Supabase fallback path).
  const trimmed = String(text || '').trim().slice(0, 50_000);
  try {
    const { d1Query } = await import('./server_d1.js');
    const comments = Array.isArray(existing?.comments) ? [...existing.comments] : [];
    const without = comments.filter((c: any) => c?.kind !== 'identified_problems');
    without.push({
      id: crypto.randomUUID(),
      kind: 'identified_problems',
      body: trimmed,
      created_at: new Date().toISOString(),
    });
    const upd = await d1Query(`UPDATE issue_tags SET comments = ? WHERE id = ?`, [JSON.stringify(without), tagId]);
    if (!upd.success) return { ok: false, via: 'failed' };
    const cur = await findIssueTag(tagId);
    return { ok: true, via: 'comments_fallback', tag: cur || undefined };
  } catch {
    return { ok: false, via: 'failed' };
  }
}

/** In-memory durable triage job status (survives until process restart; instance pack stays on R2). */
export type BugTriageJobState = {
  id: string;
  tagId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  modelId: string;
  reportId?: string;
  error?: string;
  identified_problems?: string;
  system_instruction?: string;
  prompt_text?: string;
  createdAt: string;
  updatedAt: string;
  ms?: number;
};

const triageJobs = new Map<string, BugTriageJobState>();

export function registerBugSnapshotRoutes(app: Express, deps: BugSnapshotDeps = {}) {
  const log = deps.addDebugLog || ((m: string) => console.log(m));

  async function executeTriageForTag(
    tagId: string,
    modelId: string,
    reportIds: string[] = [],
    jobId?: string
  ): Promise<{
    ok: boolean;
    identified_problems?: string;
    system_instruction?: string;
    prompt_text?: string;
    error?: string;
    ms?: number;
    via?: string;
    reports_used?: string[];
    preserved?: string;
  }> {
    const started = Date.now();
    const mark = (patch: Partial<BugTriageJobState>) => {
      if (!jobId) return;
      const cur = triageJobs.get(jobId);
      if (!cur) return;
      triageJobs.set(jobId, { ...cur, ...patch, updatedAt: new Date().toISOString() });
    };
    mark({ status: 'running' });

    if (!deps.callUnifiedLLM) {
      mark({ status: 'failed', error: 'callUnifiedLLM not wired' });
      return { ok: false, error: 'callUnifiedLLM not wired' };
    }

    const { d1Query } = await import('./server_d1.js');
    const tagRow = await findIssueTag(tagId);
    if (!tagRow) {
      mark({ status: 'failed', error: 'tag not found' });
      return { ok: false, error: 'tag not found' };
    }
    const tag = tagRow;

    const cat = tag.category || 'foodcart';
    const prior = readIdentifiedProblems(tag);
    const linkRes = await d1Query<any>(`SELECT issue_id FROM issue_tag_links WHERE tag_id = ?`, [tagId]);
    const issueIds = ((linkRes.results || []) as any[]).map((l: any) => l.issue_id);
    if (!issueIds.length) {
      mark({ status: 'failed', error: 'No reports linked' });
      return { ok: false, error: 'No reports linked to this bug', preserved: prior };
    }

    let issues: any[] = [];
    {
      const placeholders = issueIds.map(() => '?').join(', ');
      const issRes = await d1Query<any>(
        `SELECT id, user_note, payload, created_at FROM issue_backlog WHERE id IN (${placeholders}) ORDER BY created_at DESC LIMIT 5`,
        issueIds
      );
      issues = ((issRes.results || []) as any[]).map((r: any) => ({
        ...r,
        payload: typeof r.payload === 'string' ? (() => { try { return JSON.parse(r.payload); } catch { return {}; } })() : (r.payload || {}),
      }));
    }

    let selected = issues || [];
    if (reportIds.length) {
      selected = selected.filter(
        (i: any) => reportIds.includes(i.id) || reportIds.includes(i.payload?.reportId)
      );
      if (!selected.length) selected = (issues || []).slice(0, 2);
    } else {
      selected = selected.slice(0, 2);
    }

    let logs = '';
    let payloadJson = '';
    let domainPackJson = '';
    let domJson = '';
    let a11yText = '';
    let networkJson = '';
    let overviewMd = '';
    let nutritionTableMd = '';
    let debugJobJson = '';
    let env: any = null;
    let userSymptom = '';
    const usedReportIds: string[] = [];

    for (const iss of selected) {
      usedReportIds.push(iss.id);
      if (iss.user_note) userSymptom += (userSymptom ? '\n' : '') + iss.user_note;
      const p = iss.payload || {};
      env = env || p.env || null;
      if (p.dom) domJson = JSON.stringify(p.dom);
      if (p.a11y?.textOutline) a11yText = p.a11y.textOutline;
      if (p.domain_pack) domainPackJson = domainPackForAgent(p.domain_pack);
      if (p.network) networkJson = JSON.stringify(p.network);
      if (p.nutrition_table_md) nutritionTableMd = p.nutrition_table_md;
      if (p.debug_payload || p.debug_job) {
        debugJobJson = JSON.stringify(stripHeavyImages(p.debug_payload || p.debug_job), null, 2);
      }
      const rid = p.reportId;
      if (rid) {
        const prefix = bugReportR2Prefix(cat, tagId, rid);
        for (const a11yName of ['accessibility_tree.txt', 'a11y_tree.txt']) {
          const a11yR2 = await getR2ObjectText(deps, `${prefix}/${a11yName}`);
          if (a11yR2) {
            a11yText = a11yR2;
            break;
          }
        }
        const dpR2 = await getR2ObjectText(deps, `${prefix}/domain_pack.json`);
        if (dpR2) {
          try {
            domainPackJson = domainPackForAgent(JSON.parse(dpR2));
          } catch {
            domainPackJson = dpR2.slice(0, 10_000);
          }
        }
        const ovR2 = await getR2ObjectText(deps, `${prefix}/overview.md`);
        if (ovR2) overviewMd = ovR2;
        const fromR2 = await getR2ObjectText(deps, `${prefix}/console.logs.txt`) || await getR2ObjectText(deps, `${prefix}/logs.txt`);
        if (fromR2) logs += (logs ? '\n---\n' : '') + fromR2;
        const netR2 = await getR2ObjectText(deps, `${prefix}/network.recent.json`);
        if (netR2) networkJson = netR2;
        if (!domainPackJson) {
          const payR2 = await getR2ObjectText(deps, `${prefix}/payload.json`);
          if (payR2) payloadJson += (payloadJson ? '\n' : '') + budgetPayloadForDigest(payR2);
        }
        // Probe nutrition table markdown & debug job JSON from R2
        if (!nutritionTableMd) {
          const r2Files = Array.isArray(p.r2_files) ? p.r2_files : [];
          for (const f of r2Files) {
            if (f.name?.endsWith('.md') && f.name !== 'overview.md' && f.name !== 'identified_problems.md') {
              const md = await getR2ObjectText(deps, f.key || `${prefix}/${f.name}`);
              if (md) {
                nutritionTableMd = md;
                break;
              }
            }
          }
        }
        if (!debugJobJson) {
          const r2Files = Array.isArray(p.r2_files) ? p.r2_files : [];
          for (const f of r2Files) {
            if (f.name?.startsWith('debug-') && f.name?.endsWith('.json')) {
              const dbg = await getR2ObjectText(deps, f.key || `${prefix}/${f.name}`);
              if (dbg) {
                debugJobJson = dbg;
                break;
              }
            }
          }
        }
        if (!nutritionTableMd && (p.nutrition_table_md || (p as any).nutritionTableMd)) {
          nutritionTableMd = String(p.nutrition_table_md || (p as any).nutritionTableMd);
        }
        if (!debugJobJson && (p.debug_payload || p.debug_job)) {
          try {
            debugJobJson = JSON.stringify(p.debug_payload || p.debug_job, null, 2);
          } catch {
            /* ignore */
          }
        }
      }
      if (!domainPackJson && !payloadJson && p) {
        payloadJson += (payloadJson ? '\n' : '') + budgetPayloadForDigest(p);
      }
      if (!logs && (p.debugLogText || p.backendLogs)) {
        logs += cleanBugLogText(String(p.debugLogText || p.backendLogs || ''), 12000);
      }
    }

    const shotTotal = selected.reduce((n: number, i: any) => n + (i.payload?.shot_count || 0), 0);
    const system = buildBugTriageSystemPrompt();
    const user = buildBugTriageUserPrompt({
      tagTitle: tag.title,
      category: cat,
      userSymptom,
      priorIdentified: prior,
      stillOpen: tag.whats_still_open || '',
      env,
      logs,
      payloadJson,
      domainPackJson,
      domJson: a11yText ? undefined : domJson,
      a11yText,
      networkJson,
      overviewMd,
      nutritionTableMd,
      debugJson: debugJobJson,
      shotCount: Math.min(shotTotal, TIER1_MAX_SHOTS),
      reportIds: usedReportIds,
    });

    log(
      `${BUG_TRIAGE_LOG} model=${modelId} structure=${AGENT_STRUCTURE_DEFAULT} a11y=${a11yText ? 'yes' : 'no'} domain_pack=${domainPackJson ? 'yes' : 'no'} tag=${tagId} job=${jobId || 'sync'}`
    );

    let textOut = '';
    try {
      const result = await deps.callUnifiedLLM({
        modelId,
        systemInstruction: system,
        promptText: user,
        skipThinking: true,
        maxOutputTokens: 4096,
      });
      if (typeof result === 'string') textOut = result;
      else if (result?.text) textOut = result.text;
      else if (result?.response?.text) textOut = result.response.text;
      else if (typeof result?.candidates?.[0]?.content?.parts?.[0]?.text === 'string') {
        textOut = result.candidates[0].content.parts.map((p: any) => p.text || '').join('');
      } else textOut = String(result ?? '').slice(0, 8000);
    } catch (llmErr: any) {
      const msg = llmErr?.message || String(llmErr);
      log(`${BUG_TRIAGE_LOG} LLM failed: ${msg}`);
      mark({ status: 'failed', error: msg });
      return { ok: false, error: msg, preserved: prior, ms: Date.now() - started };
    }

    textOut = String(textOut || '').trim();
    if (!textOut) {
      mark({ status: 'failed', error: 'empty triage result' });
      return { ok: false, error: 'empty triage result', preserved: prior, ms: Date.now() - started };
    }

    const written = await writeIdentifiedProblems(tagId, textOut, tag);
    if (!written.ok) {
      mark({ status: 'failed', error: 'failed to save identified_problems' });
      return { ok: false, error: 'failed to save identified_problems', ms: Date.now() - started };
    }

    // summary.md + identified_problems.md (Tier-2 default)
    await putR2Object(deps, bugIdentifiedProblemsKey(cat, tagId), textOut, 'text/markdown');
    await putR2Object(
      deps,
      `${bugTagR2Prefix(cat, tagId)}/summary.md`,
      textOut,
      'text/markdown'
    );
    await putR2Object(
      deps,
      bugMetaKey(cat, tagId),
      JSON.stringify(
        {
          tagId,
          title: tag.title,
          category: cat,
          identified_problems: textOut,
          whats_still_open: tag.whats_still_open || '',
          updated_at: new Date().toISOString(),
          triage_model: modelId,
          r2_prefix: bugTagR2Prefix(cat, tagId),
          summary_path: `${bugTagR2Prefix(cat, tagId)}/summary.md`,
        },
        null,
        2
      ),
      'application/json'
    );

    const ms = Date.now() - started;
    mark({
      status: 'succeeded',
      identified_problems: textOut,
      system_instruction: system,
      prompt_text: user,
      ms,
    });
    log(`${BUG_TRIAGE_LOG} model=${modelId} ok via=${written.via} ms=${ms}`);
    return {
      ok: true,
      identified_problems: textOut,
      via: written.via,
      ms,
      reports_used: usedReportIds,
      system_instruction: system,
      prompt_text: user,
    };
  }

  /**
   * POST /api/bugs/snapshot
   * Body: { category, tag_id?, new_bug_title?, user_symptom?, shots: dataUrl[],
   *         payload?, logs?, dom?, env?, firebase_uid?, dish_query?, chain_key? }
   */
  app.post('/api/bugs/snapshot', bugWriteGuard, async (req: Request, res: Response) => {
    try {
      const {
        category = 'foodcart',
        tag_id,
        new_bug_title,
        user_symptom,
        shots = [],
        payload,
        logs,
        dom,
        env,
        firebase_uid,
        dish_query,
        chain_key,
        sessionId,
        domain_pack: domainPackBody,
        a11y: a11yBody,
        network: networkBody,
      } = req.body || {};

      const shotList = Array.isArray(shots) ? shots.slice(0, BUG_SNAPSHOT_MAX_SHOTS) : [];
      if (shotList.length === 0 && !payload && !logs && !domainPackBody && !a11yBody) {
        return res.status(400).json({
          error: 'Provide at least one screenshot, a11y, domain pack, payload, or logs',
        });
      }

      const { d1Query } = await import('./server_d1.js');
      const cat = String(category || 'foodcart');
      let tagId = tag_id && tag_id !== 'new_bug' ? String(tag_id) : null;
      let tagTitle = new_bug_title ? String(new_bug_title).trim() : null;

      if (!tagId && tagTitle) {
        const title_key = normalizeTagKey(tagTitle) || tagTitle.toLowerCase().slice(0, 160);
        const existRes = await d1Query<any>(`SELECT id, title FROM issue_tags WHERE title_key = ? LIMIT 1`, [title_key]);
        if (!existRes.success) {
          return res.status(500).json({ error: existRes.error || 'failed to look up bug tag' });
        }
        const existingTag = existRes.results?.[0];
        if (existingTag?.id) {
          tagId = existingTag.id;
          tagTitle = existingTag.title;
        } else {
          const freshId = `tag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
          const cIns = await d1Query(
            `INSERT INTO issue_tags (id, title, title_key, category, status, comments) VALUES (?, ?, ?, ?, 'to_fix', '[]')`,
            [freshId, tagTitle.slice(0, 200), title_key, cat]
          );
          if (!cIns.success) {
            return res.status(500).json({ error: cIns.error || 'failed to create bug tag' });
          }
          tagId = freshId;
        }
      }

      if (!tagId) {
        return res.status(400).json({ error: 'tag_id or new_bug_title required' });
      }

      const reportId = crypto.randomUUID();
      const symptom = user_symptom != null ? String(user_symptom).trim() : '';
      const safePayload = stripHeavyImages(payload && typeof payload === 'object' ? payload : {});
      const logText = cleanBugLogText(String(logs || ''), 180_000);
      const domObj = dom && typeof dom === 'object' ? dom : null;
      const a11yObj = a11yBody && typeof a11yBody === 'object' ? a11yBody : req.body?.a11y_tree || null;
      const domainPack =
        domainPackBody && typeof domainPackBody === 'object' ? domainPackBody : safePayload?.domain_pack || null;
      const networkObj = Array.isArray(networkBody) ? networkBody : req.body?.network || null;

      const issueId = `iss_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const snapshotPayload = {
        bug_snapshot: true,
        is_r2: true,
        reportId,
        tagId,
        category: cat,
        env: env || null,
        structure_default: AGENT_STRUCTURE_DEFAULT,
        r2_prefix: bugReportR2Prefix(cat, tagId!, reportId),
        shot_count: shotList.length,
        serverMeta: { receivedAt: new Date().toISOString(), sessionId: sessionId || null },
      };
      const insRes = await d1Query(
        `INSERT INTO issue_backlog (id, status, issue_type, severity, country_code, chain_key, dish_query, context, source_url, user_note, firebase_uid, resolution_note, ever_tagged, payload)
         VALUES (?, 'to_fix', 'general_bug', 'medium', NULL, ?, ?, 'bug_snapshot', NULL, ?, ?, NULL, 1, ?)`,
        [
          issueId,
          chain_key || null,
          dish_query || domainPack?.summaryLine || `snapshot ${new Date().toISOString().slice(0, 16)}`,
          symptom || null,
          firebase_uid || null,
          JSON.stringify(snapshotPayload),
        ]
      );
      if (!insRes.success) {
        return res.status(500).json({ error: insRes.error || 'insert report failed' });
      }
      const createdRes = await d1Query<any>(`SELECT id, created_at FROM issue_backlog WHERE id = ? LIMIT 1`, [issueId]);
      const issue = createdRes.results?.[0];
      if (!issue) {
        return res.status(500).json({ error: 'insert report failed' });
      }

      const linkId = `${tagId}::${issue.id}`;
      await d1Query(`INSERT OR IGNORE INTO issue_tag_links (id, tag_id, backlog_id, issue_id) VALUES (?, ?, ?, ?)`, [
        linkId,
        tagId,
        issue.id,
        issue.id,
      ]);

      // Upload artifacts to R2
      const shotMeta: BugSnapshotManifest['shots'] = [];
      const files: BugSnapshotManifest['files'] = [];

      for (let i = 0; i < shotList.length; i++) {
        const dataUrl = String(shotList[i] || '');
        const parsed = parseDataUrl(dataUrl);
        if (!parsed) continue;
        const ext = parsed.contentType.includes('png') ? 'png' : 'jpg';
        const key = bugShotKey(cat, tagId, reportId, i + 1, ext);
        const body = Buffer.from(parsed.base64, 'base64');
        const up = await putR2Object(deps, key, body, parsed.contentType);
        shotMeta.push({ key, bytes: body.length, contentType: parsed.contentType });
        if (!up.ok) log(`${BUG_SNAPSHOT_LOG} shot upload soft-fail key=${key}`);
      }

      // 1. Debug payload (e.g. debug-job_....json)
      const debugPayload =
        req.body?.debug_payload ||
        req.body?.debugPayload ||
        safePayload?.debug_payload ||
        safePayload?.debug_job ||
        null;
      if (debugPayload) {
        const debugJobId = String(debugPayload.jobId || reportId).replace(/[^a-zA-Z0-9_\-]/g, '_');
        const dbgKey = `${bugReportR2Prefix(cat, tagId, reportId)}/debug-${debugJobId}.json`;
        await putR2Object(deps, dbgKey, JSON.stringify(stripHeavyImages(debugPayload), null, 2), 'application/json');
        files.push({ name: `debug-${debugJobId}.json`, key: dbgKey });
      }

      // 2. Nutrition calculation table (e.g. 01_00 - <meal_name>.md / nutrition_table.md)
      const nutritionTableMd =
        req.body?.nutrition_table_md ||
        req.body?.nutritionTableMd ||
        safePayload?.nutrition_table_md ||
        null;
      const mealFileName = req.body?.meal_file_name || safePayload?.meal_file_name || 'nutrition_table.md';
      if (nutritionTableMd) {
        const cleanName = mealFileName.endsWith('.md') ? mealFileName : `${mealFileName}.md`;
        const mdKey = `${bugReportR2Prefix(cat, tagId, reportId)}/${cleanName}`;
        await putR2Object(deps, mdKey, String(nutritionTableMd), 'text/markdown');
        files.push({ name: cleanName, key: mdKey });
      }

      if (Object.keys(safePayload || {}).length > 0) {
        const key = `${bugReportR2Prefix(cat, tagId, reportId)}/payload.json`;
        const body = JSON.stringify(safePayload, null, 2);
        await putR2Object(deps, key, body, 'application/json');
        files.push({ name: 'payload.json', key });
      }
      if (logText) {
        const cKey = `${bugReportR2Prefix(cat, tagId, reportId)}/console.logs.txt`;
        await putR2Object(deps, cKey, logText, 'text/plain');
        files.push({ name: 'console.logs.txt', key: cKey });
      }
      if (domObj) {
        const key = `${bugReportR2Prefix(cat, tagId, reportId)}/dom.simplified.json`;
        await putR2Object(deps, key, JSON.stringify(domObj, null, 2), 'application/json');
        files.push({ name: 'dom.simplified.json', key });
      }
      if (a11yObj) {
        const outline =
          a11yObj.textOutline ||
          (typeof a11yObj === 'string' ? a11yObj : JSON.stringify(a11yObj).slice(0, 12_000));
        if (outline) {
          const txtKey = `${bugReportR2Prefix(cat, tagId, reportId)}/accessibility_tree.txt`;
          await putR2Object(deps, txtKey, String(outline), 'text/plain');
          files.push({ name: 'accessibility_tree.txt', key: txtKey });
        }
      }
      if (domainPack) {
        const dpKey = `${bugReportR2Prefix(cat, tagId, reportId)}/domain_pack.json`;
        await putR2Object(deps, dpKey, JSON.stringify(domainPack, null, 2), 'application/json');
        files.push({ name: 'domain_pack.json', key: dpKey });
      }
      if (networkObj && Array.isArray(networkObj) && networkObj.length > 0) {
        const netKey = `${bugReportR2Prefix(cat, tagId, reportId)}/network.recent.json`;
        await putR2Object(deps, netKey, JSON.stringify(networkObj, null, 2), 'application/json');
        files.push({ name: 'network.recent.json', key: netKey });
      }
      // overview.md — a11y-first checklist for all agents
      {
        const netFails = Array.isArray(networkObj)
          ? networkObj.filter((n: any) => n.error || (n.status && n.status >= 400)).length
          : 0;
        const overview = buildOverviewMarkdown({
          category: cat,
          tagId,
          reportId,
          userSymptom: symptom,
          env,
          domainPack,
          a11yOutline: a11yObj?.textOutline || '',
          shotCount: shotList.length,
          networkFailCount: netFails,
          hasLogs: !!logText,
        });
        const oKey = `${bugReportR2Prefix(cat, tagId, reportId)}/overview.md`;
        await putR2Object(deps, oKey, overview, 'text/markdown');
        files.push({ name: 'overview.md', key: oKey });
      }
      if (env) {
        const envKey = `${bugReportR2Prefix(cat, tagId, reportId)}/env.json`;
        await putR2Object(deps, envKey, JSON.stringify(env, null, 2), 'application/json');
        files.push({ name: 'env.json', key: envKey });
      }
      if (symptom) {
        const key = `${bugReportR2Prefix(cat, tagId, reportId)}/note.txt`;
        await putR2Object(deps, key, symptom, 'text/plain');
        files.push({ name: 'note.txt', key });
      }

      const manifest: BugSnapshotManifest = {
        version: 1,
        reportId,
        tagId,
        category: cat,
        createdAt: new Date().toISOString(),
        userSymptom: symptom || undefined,
        env: env || undefined,
        shots: shotMeta,
        files,
      };
      const mKey = bugManifestKey(cat, tagId, reportId);
      await putR2Object(deps, mKey, JSON.stringify(manifest, null, 2), 'application/json');
      files.push({ name: 'manifest.json', key: mKey });

      // Tag meta snapshot (brief pointers)
      const tagRow = await findIssueTag(tagId!);
      const meta = {
        tagId,
        title: tagRow?.title || tagTitle,
        category: cat,
        identified_problems: readIdentifiedProblems(tagRow),
        whats_still_open: tagRow?.whats_still_open || '',
        updated_at: new Date().toISOString(),
        last_report_id: reportId,
        r2_prefix: bugTagR2Prefix(cat, tagId!),
      };
      await putR2Object(deps, bugMetaKey(cat, tagId!), JSON.stringify(meta, null, 2), 'application/json');

      // Patch issue payload with R2 keys
      try {
        const curPayRes = await d1Query<any>(`SELECT payload FROM issue_backlog WHERE id = ? LIMIT 1`, [issueId]);
        const curPayRaw = curPayRes.results?.[0]?.payload;
        const curPay = typeof curPayRaw === 'string' ? (() => { try { return JSON.parse(curPayRaw); } catch { return {}; } })() : (curPayRaw || {});
        await d1Query(`UPDATE issue_backlog SET payload = ? WHERE id = ?`, [
          JSON.stringify({
            ...curPay,
            r2_manifest_key: mKey,
            r2_shots: shotMeta,
            r2_files: files,
          }),
          issueId,
        ]);
      } catch {
        /* ignore */
      }

      let snapNow: ReturnType<typeof buildNow> | null = null;
      if (tagRow) {
        let wi = hydrateWorkItem(tagRow);
        if (!wi.public_n) {
          const nRes = await d1Query<any>(`SELECT work_item FROM issue_tags`);
          const usedNs = ((nRes.results || []) as any[])
            .map((t: any) => {
              const parsed = typeof t.work_item === 'string' ? (() => { try { return JSON.parse(t.work_item); } catch { return {}; } })() : (t.work_item || {});
              return hydrateWorkItem({ work_item: parsed }).public_n;
            })
            .filter((n: number) => n > 0);
          wi = assignPublicN(wi, usedNs);
        }
        wi.bug = prefillBug(wi.bug, symptom || tagTitle || tagRow.title || '');
        const remainingIn = Array.isArray(req.body?.remaining) ? req.body.remaining : [];
        const remainingLines = Array.isArray(req.body?.remaining_lines) ? req.body.remaining_lines : [];
        wi = applySnapRemaining(wi, {
          remaining: remainingIn,
          remaining_lines: remainingLines,
          symptom,
        });
        const ev = {
          job_id:
            req.body?.job_id ||
            req.body?.jobId ||
            (safePayload as any)?.jobId ||
            (safePayload as any)?.job_id ||
            null,
          report_id: reportId,
          debug_url: req.body?.debug_url || (safePayload as any)?.debugUrl || null,
          photo_urls: shotMeta.map((s) => s.key),
          r2_prefix: bugReportR2Prefix(cat, tagId, reportId),
          hold: true,
          scout_url: req.body?.scout_url || (safePayload as any)?.backendLogsUrl || (safePayload as any)?.debugUrl || null,
          fixture_query: dish_query || (safePayload as any)?.query || null,
          expected_dishes: Array.isArray(req.body?.expected_dishes)
            ? req.body.expected_dishes.map(String)
            : undefined,
          line_photos: wi.current_evidence?.line_photos,
        };
        wi = appendEvidenceCommit(wi, {
          actor: 'you',
          kind: wi.commits.length ? 'retest' : 'snap',
          summary: (symptom || 'snapshot').slice(0, 200),
          evidence: ev,
          remaining: wi.remaining,
        });
        wi.hold_refs = [...new Set([...(wi.hold_refs || []), ev.job_id, ev.r2_prefix].filter(Boolean))] as string[];
        await persistWorkItem(tagId!, wi);
        if (tagRow.status === 'fixed' || wi.queue === 'ready') {
          await d1Query(`UPDATE issue_tags SET status = 'to_fix' WHERE id = ?`, [tagId]);
        }
        snapNow = buildNow({ ...tagRow, work_item: wi, id: tagId });
      }
      if (symptom && tagRow) {
        const prev = Array.isArray(tagRow.comments) ? [...tagRow.comments] : [];
        prev.push({
          id: crypto.randomUUID(),
          body: `[snapshot] ${symptom.slice(0, 500)}`,
          created_at: new Date().toISOString(),
        });
        await d1Query(`UPDATE issue_tags SET comments = ? WHERE id = ?`, [JSON.stringify(prev), tagId]);
      }

      // Archive older instances: mark previous linked reports; keep last 3 active
      try {
        const linkRes = await d1Query<any>(`SELECT issue_id FROM issue_tag_links WHERE tag_id = ?`, [tagId]);
        const otherIds = ((linkRes.results || []) as any[]).map((l: any) => l.issue_id).filter((id: string) => id !== issueId);
        if (otherIds.length) {
          const placeholders = otherIds.map(() => '?').join(', ');
          const othRes = await d1Query<any>(
            `SELECT id, payload, created_at FROM issue_backlog WHERE id IN (${placeholders}) ORDER BY created_at DESC`,
            otherIds
          );
          const list = ((othRes.results || []) as any[]).map((o: any) => ({
            ...o,
            payload: typeof o.payload === 'string' ? (() => { try { return JSON.parse(o.payload); } catch { return {}; } })() : (o.payload || {}),
          }));
          // First previous → archive pointer file
          for (let i = 0; i < list.length; i++) {
            const o = list[i];
            const p = o.payload || {};
            const archivedAt = new Date().toISOString();
            const nextPayload = {
              ...p,
              archived: true,
              archived_at: p.archived_at || archivedAt,
            };
            await d1Query(`UPDATE issue_backlog SET payload = ? WHERE id = ?`, [JSON.stringify(nextPayload), o.id]);
            if (i >= 3 && p.reportId) {
              // Cap: prune R2 for very old instances (beyond 3 previous) unless held
              const keys: string[] = [];
              if (Array.isArray(p.r2_shots)) for (const s of p.r2_shots) if (s?.key) keys.push(s.key);
              if (Array.isArray(p.r2_files)) for (const f of p.r2_files) if (f?.key) keys.push(f.key);
              const holdWi = hydrateWorkItem(tagRow);
              const held = shouldHoldR2(holdWi, [
                p.reportId,
                p.r2_prefix,
                p.jobId || p.job_id,
                ...keys,
              ]);
              if (held) {
                log(`${BUG_SNAPSHOT_LOG} hold skip prune report=${p.reportId}`);
                continue;
              }
              for (const k of keys) await deleteR2Object(deps, k);
              await d1Query(`UPDATE issue_backlog SET payload = ? WHERE id = ?`, [
                JSON.stringify({
                  ...nextPayload,
                  obsolete: true,
                  pruned_at: archivedAt,
                  r2_shots: [],
                  r2_files: [],
                }),
                o.id,
              ]);
            } else if (p.reportId) {
              const noteKey = `${bugTagR2Prefix(cat, tagId)}/archive/${archivedAt.slice(0, 19).replace(/[:.]/g, '-')}/${p.reportId}/ARCHIVED.txt`;
              await putR2Object(
                deps,
                noteKey,
                `Archived when new instance ${reportId} was created.\nOriginal prefix: ${p.r2_prefix || ''}\n`,
                'text/plain'
              );
            }
          }
        }
      } catch (archErr: any) {
        log(`${BUG_SNAPSHOT_LOG} archive soft-fail: ${archErr?.message || archErr}`);
      }

      log(`${BUG_SNAPSHOT_LOG} saved report=${issueId} tag=${tagId} shots=${shotMeta.length}`);

      // Optional auto-triage job (client may also call /triage)
      let triage_job_id: string | null = null;
      const autoTriage = req.body?.auto_triage === true || req.body?.auto_triage === '1';
      if (autoTriage && deps.callUnifiedLLM) {
        const modelId = String(req.body?.modelId || req.body?.model || 'gemini-3.5-flash-lite');
        triage_job_id = `triage_${tagId}_${Date.now()}`;
        triageJobs.set(triage_job_id, {
          id: triage_job_id,
          tagId,
          status: 'queued',
          modelId,
          reportId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        // Fire-and-forget; instance already durable
        setImmediate(() => {
          executeTriageForTag(tagId, modelId, [issueId], triage_job_id!).catch((e) => {
            log(`${BUG_TRIAGE_LOG} auto job failed: ${e?.message || e}`);
          });
        });
      }

      res.json({
        success: true,
        id: issueId,
        reportId,
        tag_id: tagId,
        r2_prefix: bugReportR2Prefix(cat, tagId, reportId),
        shots: shotMeta.length,
        files: files.map((f) => f.name),
        structure_default: AGENT_STRUCTURE_DEFAULT,
        domain: domainPack?.domain || null,
        capture_checklist: {
          a11y: !!a11yObj,
          domain_pack: !!domainPack,
          shots: shotMeta.length,
          logs: !!logText,
          network: Array.isArray(networkObj) ? networkObj.length : 0,
        },
        triage_job_id,
        public_id: snapNow?.public_id || null,
        now: snapNow,
      });
    } catch (err: any) {
      console.error(`${BUG_SNAPSHOT_LOG} exception`, err);
      res.status(500).json({ error: err?.message || 'snapshot failed' });
    }
  });

  /** GET /api/bugs/triage-jobs/:jobId — durable triage status for placeholder/retry UI */
  app.get('/api/bugs/triage-jobs/:jobId', (req: Request, res: Response) => {
    const job = triageJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'job not found (may have restarted server)' });
    res.json({ job });
  });

  /** GET /api/bugs/:tagId/triage-jobs — recent jobs for a tag */
  app.get('/api/bugs/:tagId/triage-jobs', (req: Request, res: Response) => {
    const tagId = req.params.tagId;
    const jobs = [...triageJobs.values()]
      .filter((j) => j.tagId === tagId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10);
    res.json({ jobs });
  });

  /** GET /api/bugs/open — brief-only list for coding agents */
  app.get('/api/bugs/open', async (_req: Request, res: Response) => {
    try {
      const { d1Query } = await import('./server_d1.js');
      // D-2: D1-only. Schema is expanded (title_key/category/resolution_note/
      // whats_still_open present) so no column-fallback chain is needed.
      const r = await d1Query<any>(
        `SELECT id, created_at, title, title_key, category, status, resolution_note, whats_still_open, comments, resolved_at, work_item
         FROM issue_tags WHERE status = 'to_fix' ORDER BY created_at DESC LIMIT 100`
      );
      if (!r.success) return res.status(500).json({ error: r.error });
      const tags = await persistMissingPublicNs(((r.results || []) as any[]).map(normIssueTag));

      const tagIds = (tags || []).map((t: any) => t.id);
      let links: any[] = [];
      if (tagIds.length) {
        const placeholders = tagIds.map(() => '?').join(', ');
        const linkRes = await d1Query<any>(`SELECT tag_id, issue_id FROM issue_tag_links WHERE tag_id IN (${placeholders})`, tagIds);
        links = linkRes.results || [];
      }

      const bugs = (tags || [])
        .filter((t: any) => hydrateWorkItem(t).queue !== 'done')
        .map((t: any) => {
          const linked = links.filter((l) => l.tag_id === t.id).length;
          return briefFromTag({
            ...t,
            identified_problems: readIdentifiedProblems(t),
            linked_count: linked,
          });
        });

      res.json({
        bugs,
        unmatched: bugs.filter((b: any) => b.unmatched),
        count: bugs.length,
        note: 'Brief only. Use GET /api/bugs/:tagId/artifacts for deep fetch. Prefer GET /api/bugs/next.',
        generated_at: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'bugs open failed' });
    }
  });

  /** GET /api/bugs/next — work bug (current). ?mode=next = next card. ?n=11 = that #. */
  app.get('/api/bugs/next', async (req: Request, res: Response) => {
    try {
      const { d1Query } = await import('./server_d1.js');
      // A-f1 fix: do NOT pre-slice on created_at before the semantic sort.
      // fetch a large window; pickQueueTag/sortReadyQueue applies occurrences → severity → oldest.
      const r = await d1Query<any>(
        `SELECT * FROM issue_tags WHERE status IN ('to_fix', 'in_progress') ORDER BY updated_at DESC LIMIT 1000`
      );
      if (!r.success) return res.status(500).json({ error: r.error });
      const tags = await persistMissingPublicNs(((r.results || []) as any[]).map(normIssueTag));
      const tag = pickQueueTag(tags, {
        mode: String(req.query?.mode || ''),
        n: req.query?.n as string | undefined,
      });
      if (!tag) {
        return res.json({ say: 'Next bug', empty: true, now: null, continue: null, note: 'No matching bug.' });
      }
      let item = hydrateWorkItem(tag);
      const taped = await refreshTapeRemaining(item);
      if (
        taped.remaining.join('\n') !== item.remaining.join('\n') ||
        JSON.stringify(taped.checks || []) !== JSON.stringify(item.checks || [])
      ) {
        await persistWorkItem(tag.id, taped);
        item = taped;
      }
      const start = buildStartPayload({ ...tag, work_item: item, id: tag.id });
      res.json({ empty: false, ...start });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'bugs next failed' });
    }
  });

  /** GET /api/bugs/unmatched — auto-file that could not fingerprint-merge */
  app.get('/api/bugs/unmatched', async (_req: Request, res: Response) => {
    try {
      const { d1Query } = await import('./server_d1.js');
      const r = await d1Query<any>(
        `SELECT * FROM issue_tags WHERE status IN ('to_fix', 'in_progress') LIMIT 200`
      );
      if (!r.success) return res.status(500).json({ error: r.error });
      const unmatched = ((r.results || []) as any[])
        .map((t: any) => briefFromTag({ ...normIssueTag(t), identified_problems: readIdentifiedProblems(normIssueTag(t)) }))
        .filter((b: any) => b.unmatched);
      res.json({ unmatched, count: unmatched.length });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'unmatched failed' });
    }
  });

  /** POST /api/bugs/auto-file — job finalize / golden reds */
  app.post('/api/bugs/auto-file', bugWriteGuard, async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const filed = body.caseId
        ? await tryAutoFileGolden({
            caseId: String(body.caseId),
            title: body.title,
            query: body.query || body.text,
            jobId: body.job_id || body.jobId,
            debugUrl: body.debug_url || body.debugUrl,
            photoUrls: body.photo_urls || body.photoUrls,
            outcomes: body.outcomes,
            mealMisses: body.mealMisses,
          })
        : await tryAutoFileJob({
            jobId: body.job_id || body.jobId,
            status: body.status,
            kind: body.kind,
            text: body.text,
            error: body.error,
            debugUrl: body.debug_url || body.debugUrl,
            photoUrls: body.photo_urls || body.photoUrls,
            pendingFoodLog: body.pendingFoodLog,
            result: body.result,
          });
      res.json(filed);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'auto-file failed' });
    }
  });

  /** POST /api/bugs/migrate-inbox — leftover D1 golden_cases → issue_tags #n. Not Promote. */
  app.post('/api/bugs/migrate-inbox', bugWriteGuard, async (_req: Request, res: Response) => {
    try {
      const { d1Query } = await import('./server_d1.js');
      const listed = await d1Query<{
        id: string;
        tag_id?: string | null;
        job_id?: string | null;
        title?: string | null;
        status?: string | null;
      }>(`SELECT id, tag_id, job_id, title, status FROM golden_cases ORDER BY updated_at DESC LIMIT 80`);
      const cases = listed.success ? listed.results || [] : [];
      if (!listed.success) {
        return res.json({ ok: true, skipped: true, reason: listed.error || 'd1 unavailable', linked: 0, created: 0 });
      }
      const tagRes = await d1Query<any>(`SELECT id, title, work_item, created_at, status FROM issue_tags LIMIT 200`);
      const tags = ((tagRes.results || []) as any[]).map(normIssueTag);
      const plan = planInboxMigration(cases, tags || []);
      const summary = { linked: 0, created: 0, skipped: 0, already: 0 };
      for (const row of plan) {
        if (row.action === 'already_linked') {
          summary.already += 1;
          continue;
        }
        if (row.action === 'skip_promoted') {
          summary.skipped += 1;
          continue;
        }
        if (row.action === 'link_existing' && row.tagId) {
          await d1Query(`UPDATE golden_cases SET tag_id = ?, updated_at = ? WHERE id = ?`, [
            row.tagId,
            new Date().toISOString(),
            row.caseId,
          ]);
          summary.linked += 1;
          continue;
        }
        if (row.action === 'create_tag') {
          const candidate = classifyGoldenReds({
            caseId: row.caseId,
            title: row.title,
            jobId: row.jobId || undefined,
            outcomes: [
              {
                id: 'inbox_leftover',
                label: row.remaining?.[0] || row.title || 'Inbox leftover',
                pass: false,
                enabled: true,
              },
            ],
          });
          if (!candidate) {
            summary.skipped += 1;
            continue;
          }
          const persisted = await persistAutoFile(candidate);
          if (persisted.ok && persisted.tag_id) {
            await d1Query(`UPDATE golden_cases SET tag_id = ?, updated_at = ? WHERE id = ?`, [
              persisted.tag_id,
              new Date().toISOString(),
              row.caseId,
            ]);
            summary.created += 1;
          } else {
            summary.skipped += 1;
          }
        }
      }
      res.json({ ok: true, ...summary, planned: plan.length });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'migrate failed' });
    }
  });

  /** POST /api/bugs/:tagId/reanalyze — catalog restage, then one skipScout if auto remaining. Same card. */
  app.post('/api/bugs/:tagId/reanalyze', bugWriteGuard, async (req: Request, res: Response) => {
    try {
      const tag = await findTagByParam(req.params.tagId);
      if (!tag) return res.status(404).json({ error: 'not found' });
      let item = hydrateWorkItem(tag);
      const priorBurns = (item.burns || []).length;
      const priorAttempts = (item.commits || []).length;
      const jobId = String(item.current_evidence?.job_id || '').trim();
      if (!jobId) {
        return res.status(409).json({ error: 'No saved job_id on this card — cannot restage.' });
      }
      const { tapeJobCandidatesFromDetail } = await import('./src/utils/bugTapeReplay.js');
      let tape = await loadJobTape(jobId);
      const { normalizeScoutItems } = await import('./src/utils/goldenJourney.js');
      if (!normalizeScoutItems(tape.scout).length) {
        const fallbackId = tapeJobCandidatesFromDetail({
          work_item: item,
          commits: item.commits,
          now: { current_evidence: item.current_evidence },
        }).find((id) => id !== jobId && /^job_/i.test(id));
        if (fallbackId) tape = await loadJobTape(fallbackId);
      }
      if (!normalizeScoutItems(tape.scout).length) {
        return res.status(409).json({ error: 'No frozen scout on this card — cannot restage.' });
      }
      const { buildScoreboard } = await import('./src/utils/goldenScoreboard.js');
      const { replayScoutAgainstCatalog } = await import('./src/utils/goldenReplay.js');
      const logBoard = buildScoreboard({
        logText: tape.logText,
        foodLog: tape.foodLog,
        scout: tape.scout,
      });
      const catalogJourney = replayScoutAgainstCatalog(tape.scout);
      let board = restageBoardFromCatalog({ ...logBoard, scout: tape.scout }, catalogJourney);
      item = overlayAutoRemaining(item, board);
      item = appendEvidenceCommit(item, {
        actor: 'system',
        kind: 'retest',
        summary: `Catalog restage (no LLM) · ${failingAutoWorkLines(board).length} auto remaining`,
        evidence: {
          ...(item.current_evidence || {}),
          job_id: jobId,
          scout_url: item.current_evidence?.scout_url || null,
        },
      });
      const stages: string[] = ['catalog'];
      let pipelineError = '';
      const wantPipeline = planReanalyzeStages(board).pipeline && req.body?.catalogOnly !== true;
      if (wantPipeline) {
        const { runGoldenAnalyze } = await import('./serverGoldenRoutes.js');
        const pipe = await runGoldenAnalyze({
          caseId: String(tag.id),
          scout: tape.scout,
          query: item.current_evidence?.fixture_query || item.bug || 'Re-analyze frozen scout (skipScout).',
          skipScout: true,
        });
        stages.push('pipeline');
        if (pipe.ok && (pipe.foodLog || pipe.logText)) {
          board = buildScoreboard({
            logText: pipe.logText,
            foodLog: pipe.foodLog || tape.foodLog,
            scout: pipe.scout || tape.scout,
          });
          item = overlayAutoRemaining(item, board);
          const nextJob = pipe.jobId || jobId;
          try {
            const { uploadLogsToR2 } = await import('./src/utils/r2Storage.js');
            const { uploadDebugPayloadToR2Direct } = await import('./server_routes_r2.js');
            if (pipe.logText) await uploadLogsToR2(nextJob, pipe.logText);
            await uploadDebugPayloadToR2Direct(nextJob, {
              jobId: nextJob,
              source: 'bug-reanalyze-skipScout',
              pendingFoodLog: pipe.foodLog || tape.foodLog,
              scoutItems: pipe.scout || tape.scout,
              backendLogs: pipe.logText || '',
              result: {
                pendingFoodLog: pipe.foodLog || tape.foodLog,
                scoutItems: pipe.scout || tape.scout,
                backendLogs: pipe.logText || '',
              },
            });
          } catch (persistErr: any) {
            console.warn(`${BUG_SNAPSHOT_LOG} skipScout tape persist skipped:`, persistErr?.message || persistErr);
          }
          item = appendEvidenceCommit(item, {
            actor: 'system',
            kind: 'retest',
            summary: `skipScout pipeline ${pipe.status} · job ${nextJob} · ${failingAutoWorkLines(board).length} auto remaining`,
            evidence: {
              ...(item.current_evidence || {}),
              job_id: nextJob,
              debug_url: `debug/${nextJob}.json`,
            },
          });
        } else {
          pipelineError = pipe.errorText || 'skipScout pipeline failed';
          item = appendEvidenceCommit(item, {
            actor: 'system',
            kind: 'note',
            summary: `skipScout pipeline failed: ${pipelineError}`,
            evidence: item.current_evidence || { job_id: jobId },
          });
        }
      }
      if ((item.burns || []).length < priorBurns) {
        item = { ...item, burns: hydrateWorkItem(tag).burns };
      }
      await persistWorkItem(tag.id, item);
      const start = buildStartPayload({ ...tag, work_item: item, id: tag.id });
      res.json({
        board: { ...board, checks: item.checks || [] },
        work_item: item,
        stages,
        pipelineError: pipelineError || null,
        catalogOnly: !wantPipeline,
        now: start.now,
        commits: start.commits,
        burns_kept: (item.burns || []).length,
        attempts_before: priorAttempts,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'reanalyze failed' });
    }
  });

  /** GET /api/bugs/queue?state=&assignee=&surface= — ready queue + blocked_by.
   * Registered BEFORE /api/bugs/:tagId so "queue" is not captured as a tagId. */
  app.get('/api/bugs/queue', async (req: Request, res: Response) => {
    try {
      const { d1Query } = await import('./server_d1.js');
      const r = await d1Query<any>(
        `SELECT * FROM issue_tags WHERE status IN ('to_fix', 'in_progress') ORDER BY updated_at DESC LIMIT 1000`
      );
      if (!r.success) return res.status(500).json({ error: r.error });
      const tags = await persistMissingPublicNs(((r.results || []) as any[]).map(normIssueTag));
      const wantState = req.query.state ? String(req.query.state) : null;
      const wantAssignee = req.query.assignee ? String(req.query.assignee) : null;
      const wantSurface = req.query.surface ? String(req.query.surface) : null;
      const rows = tags
        .map((t) => {
          const item = hydrateWorkItem(t);
          const ticket = bugState(item);
          return {
            tag_id: t.id,
            public_n: item.public_n,
            title: t.title,
            bug: item.bug,
            class: item.class,
            state: ticket.state,
            flags: ticket.flags,
            queue: ticket.queue,
            assignee: item.assignee,
            surface: item.surface,
            occurrences: item.occurrences,
            blocked_by: item.blocked_by || [],
            updated_at: t.updated_at,
            created_at: t.created_at,
          };
        })
        .filter((row) => {
          if (wantState && row.state !== wantState) return false;
          if (wantAssignee && row.assignee !== wantAssignee) return false;
          if (wantSurface && row.surface !== wantSurface) return false;
          return true;
        })
        .sort((a, b) => {
          if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
          return String(a.created_at || '').localeCompare(String(b.created_at || ''));
        });
      res.json({ queue: rows, count: rows.length, generated_at: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'queue failed' });
    }
  });

  /** GET /api/bugs/:tagId — NOW + commits + report manifests */
  app.get('/api/bugs/:tagId', async (req: Request, res: Response) => {
    try {
      const { d1Query } = await import('./server_d1.js');
      const tag = await findTagByParam(req.params.tagId);
      if (!tag) return res.status(404).json({ error: 'not found' });
      const tagId = tag.id;

      const linkRes = await d1Query<any>(`SELECT issue_id FROM issue_tag_links WHERE tag_id = ?`, [tagId]);
      const issueIds = ((linkRes.results || []) as any[]).map((l: any) => l.issue_id);
      let reports: any[] = [];
      if (issueIds.length) {
        const placeholders = issueIds.map(() => '?').join(', ');
        const issRes = await d1Query<any>(
          `SELECT id, created_at, status, dish_query, user_note, context, payload FROM issue_backlog WHERE id IN (${placeholders}) ORDER BY created_at DESC`,
          issueIds
        );
        reports = ((issRes.results || []) as any[]).map((i: any) => {
          const p = typeof i.payload === 'string' ? (() => { try { return JSON.parse(i.payload); } catch { return {}; } })() : (i.payload || {});
          return {
            id: i.id,
            created_at: i.created_at,
            status: i.status,
            dish_query: i.dish_query,
            user_note: i.user_note,
            context: i.context,
            reportId: p?.reportId || null,
            r2_prefix: p?.r2_prefix || null,
            r2_manifest_key: p?.r2_manifest_key || null,
            shot_count: p?.shot_count ?? p?.r2_shots?.length ?? 0,
            obsolete: p?.obsolete === true,
          };
        });
      }

      const item = hydrateWorkItem({ ...tag, linked_count: reports.length });
      const start = buildStartPayload({ ...tag, work_item: item, id: tag.id });
      res.json({
        bug: briefFromTag({
          ...tag,
          identified_problems: readIdentifiedProblems(tag) || item.bug,
          linked_count: reports.length,
        }),
        now: start.now,
        commits: start.commits,
        how_to_end: start.how_to_end,
        say: start.say,
        reports,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'bug get failed' });
    }
  });

  /** POST /api/bugs/:tagId/attempts — required end of every agent loop */
  app.post('/api/bugs/:tagId/attempts', bugWriteGuard, async (req: Request, res: Response) => {
    try {
      const { d1Query } = await import('./server_d1.js');
      const tag = await findTagByParam(req.params.tagId);
      if (!tag) return res.status(404).json({ error: 'not found' });
      const body = req.body || {};
      const item = hydrateWorkItem(tag);
      const { item: next, rejected } = applyAttempt(item, {
        actor: String(body.actor || 'agent'),
        hyp: String(body.hyp || ''),
        file: String(body.file || ''),
        test: String(body.test || ''),
        result: String(body.result || ''),
        burned: body.burned !== false && !/green|pass/i.test(String(body.result || '')),
        note: body.note ? String(body.note) : undefined,
        line: body.line ? String(body.line) : undefined,
      });
      if (rejected === 'already_burned') {
        return res.status(409).json({ error: 'already_burned', now: buildStartPayload({ ...tag, work_item: next }).now });
      }
      if (body.bug && String(body.bug).trim()) {
        next.bug = String(body.bug).trim();
      }
      if (body.applied === true || body.applied === false) {
        const commits = next.commits.map((c, i) =>
          i === next.commits.length - 1 && c.attempt ? { ...c, attempt: { ...c.attempt, applied: body.applied === true } } : c
        );
        next.commits = commits;
      }
      const projected = projectBugState(next);
      const taped = await refreshTapeRemaining(projected.item);
      const finalProjected = projectBugState(taped);
      await persistWorkItem(tag.id, finalProjected.item);
      if (finalProjected.ticket.queue === 'blocked') {
        await d1Query(`UPDATE issue_tags SET status = 'to_fix' WHERE id = ?`, [tag.id]);
      }
      if (finalProjected.ticket.queue === 'done') {
        await d1Query(`UPDATE issue_tags SET status = 'fixed', resolved_at = ? WHERE id = ?`, [new Date().toISOString(), tag.id]);
      }
      const start = buildStartPayload({ ...tag, work_item: finalProjected.item, id: tag.id });
      const pubN = finalProjected.item.public_n || start?.now?.public_id;
      if (rejected) {
        return res.status(409).json({
          ok: false,
          error: rejected,
          rejected,
          state: finalProjected.ticket.state,
          flags: finalProjected.ticket.flags,
          public_n: finalProjected.item.public_n,
          ...start,
        });
      }
      res.json({
        ok: true,
        rejected: null,
        state: finalProjected.ticket.state,
        flags: finalProjected.ticket.flags,
        public_n: finalProjected.item.public_n,
        ...start,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'attempt failed' });
    }
  });

  /** PATCH /api/bugs/:tagId — update Bug field, class, remaining, or unblock */
  app.patch('/api/bugs/:tagId', bugWriteGuard, async (req: Request, res: Response) => {
    try {
      const { d1Query } = await import('./server_d1.js');
      const tag = await findTagByParam(req.params.tagId);
      if (!tag) return res.status(404).json({ error: 'not found' });
      const item = hydrateWorkItem(tag);
      const nextBug = String(req.body?.bug ?? '').trim();
      if (nextBug) item.bug = nextBug;
      if (req.body?.class !== undefined) item.class = req.body.class ? String(req.body.class) : undefined;
      if (req.body?.queue && ['ready', 'in_progress', 'blocked', 'done'].includes(req.body.queue)) {
        item.queue = req.body.queue;
      }
      if (req.body?.reset_burns || req.body?.resetBurns) {
        item.burns = item.burns.map((b) => ({ ...b, burned: false }));
        if (item.parked.length) {
          item.remaining = [...item.remaining, ...item.parked];
          item.parked = [];
        }
        if (item.queue === 'blocked') item.queue = 'ready';
        delete item.blocked_reason;
      }
      if (Array.isArray(req.body?.remaining)) item.remaining = req.body.remaining.map(String);
      if (Array.isArray(req.body?.done)) item.done = req.body.done.map(String);
      if (Array.isArray(req.body?.parked)) item.parked = req.body.parked.map(String);
      if (Array.isArray(req.body?.checks)) item.checks = req.body.checks;
      // V-30.1 field updates (never a state setter — state stays derived)
      if (req.body?.assignee !== undefined) {
        if (req.body.assignee === null || req.body.assignee === '') delete item.assignee;
        else item.assignee = req.body.assignee;
      }
      if (req.body?.surface !== undefined) {
        if (req.body.surface === null || req.body.surface === '') delete item.surface;
        else item.surface = req.body.surface;
      }
      if (req.body?.source !== undefined) {
        if (req.body.source === null || req.body.source === '') delete item.source;
        else item.source = req.body.source;
      }
      if (req.body?.blocked_reason !== undefined) {
        if (req.body.blocked_reason === null || req.body.blocked_reason === '') delete item.blocked_reason;
        else item.blocked_reason = String(req.body.blocked_reason);
      }
      if (req.body?.blocked_by !== undefined) {
        if (Array.isArray(req.body.blocked_by)) item.blocked_by = req.body.blocked_by.map(String);
        else if (req.body.blocked_by === null) delete item.blocked_by;
      }
      if (req.body?.duplicate_of !== undefined) {
        if (req.body.duplicate_of === null || req.body.duplicate_of === '') delete item.duplicate_of;
        else item.duplicate_of = String(req.body.duplicate_of);
      }
      if (req.body?.reply_to !== undefined && req.body.reply_to && typeof req.body.reply_to === 'object') {
        item.reply_to = req.body.reply_to;
      }
      if (req.body?.idem_key !== undefined) {
        if (req.body.idem_key === null || req.body.idem_key === '') delete item.idem_key;
        else item.idem_key = String(req.body.idem_key);
      }
      const projected = projectBugState(item);
      await persistWorkItem(tag.id, projected.item);
      if (projected.ticket.queue === 'done') {
        await d1Query(`UPDATE issue_tags SET status = 'fixed', resolved_at = ? WHERE id = ?`, [new Date().toISOString(), tag.id]);
      } else {
        await d1Query(`UPDATE issue_tags SET status = 'to_fix' WHERE id = ?`, [tag.id]);
      }
      res.json({
        ...buildStartPayload({ ...tag, work_item: projected.item, id: tag.id }),
        state: projected.ticket.state,
        flags: projected.ticket.flags,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'patch failed' });
    }
  });

  /** POST /api/bugs/:tagId/attach — Flag / Snap Open #n (auto-match failed) */
  app.post('/api/bugs/:tagId/attach', bugWriteGuard, async (req: Request, res: Response) => {
    try {
      const { d1Query } = await import('./server_d1.js');
      const { d1GetJob } = await import('./server_db_d1.js');
      const tag = await findTagByParam(req.params.tagId);
      if (!tag) return res.status(404).json({ error: 'not found' });
      const body = req.body || {};
      const jobId = String(body.job_id || body.jobId || '').trim() || null;
      let debugUrl = body.debug_url || body.debugUrl || null;
      let photoUrls: string[] = Array.isArray(body.photo_urls || body.photoUrls)
        ? (body.photo_urls || body.photoUrls).map(String)
        : [];
      if (jobId && !debugUrl) {
        const job = await d1GetJob(jobId);
        const cr = (job as any)?.clean_result || {};
        debugUrl = (job as any)?.debug_url || cr?.debugUrl || debugUrl;
        if (!photoUrls.length && (job as any)?.photo_url) photoUrls = [(job as any).photo_url];
      }
      let item = hydrateWorkItem(tag);
      item = appendEvidenceCommit(item, {
        actor: 'you',
        kind: 'snap',
        summary: String(body.summary || jobId || 'attached evidence').slice(0, 200),
        evidence: {
          job_id: jobId,
          debug_url: debugUrl,
          photo_urls: photoUrls,
          hold: true,
        },
        remaining: Array.isArray(body.remaining) ? body.remaining.map(String) : undefined,
      });
      item.unmatched = false;
      if (jobId) item.hold_refs = [...new Set([...(item.hold_refs || []), jobId, debugUrl].filter(Boolean))] as string[];
      await persistWorkItem(tag.id, item);
      if (tag.status === 'fixed' || item.queue === 'ready') {
        await d1Query(`UPDATE issue_tags SET status = 'to_fix' WHERE id = ?`, [tag.id]);
      }
      res.json(buildStartPayload({ ...tag, work_item: item, id: tag.id }));
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'attach failed' });
    }
  });

  /**
   * GET /api/bugs/:tagId/artifacts?reportId=&name=
   * name: manifest.json | logs.txt | payload.json | dom.simplified.json | note.txt | shot-01.jpg
   */
  app.get('/api/bugs/:tagId/artifacts', async (req: Request, res: Response) => {
    try {
      const { d1Query } = await import('./server_d1.js');
      const tag = await findTagByParam(req.params.tagId);
      if (!tag) return res.status(404).json({ error: 'tag not found' });
      const tagId = tag.id;
      let reportId = String(req.query.reportId || '');
      let name = String(req.query.name || 'manifest.json');
      if (!reportId) return res.status(400).json({ error: 'reportId required' });

      // Dashboard used to pass issue_backlog.id; R2 folders use snapshot reportId.
      const issueRes = await d1Query<any>(`SELECT id, payload FROM issue_backlog WHERE id = ? LIMIT 1`, [reportId]);
      const issueRow = issueRes.results?.[0];
      const issuePayload = typeof issueRow?.payload === 'string'
        ? (() => { try { return JSON.parse(issueRow.payload); } catch { return {}; } })()
        : (issueRow?.payload || {});
      if (issuePayload?.reportId) reportId = String(issuePayload.reportId);

      const cat = tag.category || 'foodcart';
      if (name === 'logs.txt') name = 'console.logs.txt';

      let key = `${bugReportR2Prefix(cat, tagId, reportId)}/${name.replace(/\.\./g, '')}`;
      // Allow full key if provided
      if (String(req.query.key || '').startsWith('bugs/')) {
        key = String(req.query.key);
      }

      const isImage = /\.(jpg|jpeg|png)$/i.test(name) || /\.(jpg|jpeg|png)$/i.test(key);
      if (isImage) {
        const buf = await getR2ObjectBuffer(deps, key);
        if (!buf) return res.status(404).json({ error: 'artifact not found or R2 unavailable', key });
        res.set('Cache-Control', 'private, max-age=3600');
        return res.type(contentTypeForArtifact(name)).send(buf);
      }

      const text = await getR2ObjectText(deps, key);
      if (text == null) {
        return res.status(404).json({ error: 'artifact not found or R2 unavailable', key });
      }
      if (name.endsWith('.json') || key.endsWith('.json')) {
        try {
          return res.json({ key, data: JSON.parse(text) });
        } catch {
          return res.json({ key, text });
        }
      }
      res.type('text/plain').send(text);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'artifact failed' });
    }
  });

  /** POST /api/bugs/:tagId/triage — digest agent → identified_problems (+ summary.md) */
  app.post('/api/bugs/:tagId/triage', bugWriteGuard, async (req: Request, res: Response) => {
    try {
      const tagId = req.params.tagId;
      const modelId = String(req.body?.modelId || req.body?.model || 'gemini-3.5-flash-lite');
      const reportIds: string[] = Array.isArray(req.body?.reportIds) ? req.body.reportIds : [];
      const asyncMode = req.body?.async === true || req.body?.async === '1';

      const jobId = `triage_${tagId}_${Date.now()}`;
      triageJobs.set(jobId, {
        id: jobId,
        tagId,
        status: 'queued',
        modelId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      if (asyncMode) {
        setImmediate(() => {
          executeTriageForTag(tagId, modelId, reportIds, jobId).catch((e) => {
            log(`${BUG_TRIAGE_LOG} async failed: ${e?.message || e}`);
          });
        });
        return res.json({
          success: true,
          async: true,
          triage_job_id: jobId,
          status: 'queued',
          message: 'Triage started; poll GET /api/bugs/triage-jobs/:jobId',
        });
      }

      const result = await executeTriageForTag(tagId, modelId, reportIds, jobId);
      if (!result.ok) {
        return res.status(500).json({
          error: result.error || 'triage failed',
          preserved_identified_problems: result.preserved,
          triage_job_id: jobId,
        });
      }
      res.json({
        success: true,
        tag_id: tagId,
        modelId,
        via: result.via,
        identified_problems: result.identified_problems,
        system_instruction: result.system_instruction,
        prompt_text: result.prompt_text,
        ms: result.ms,
        reports_used: result.reports_used,
        triage_job_id: jobId,
        summary_path: `bugs/.../summary.md`,
      });
    } catch (err: any) {
      console.error(`${BUG_TRIAGE_LOG} exception`, err);
      res.status(500).json({ error: err?.message || 'triage failed' });
    }
  });

  /** POST /api/bugs/:tagId/reports/:issueId/prune — mark obsolete + delete R2 keys */
  app.post('/api/bugs/:tagId/reports/:issueId/prune', bugWriteGuard, async (req: Request, res: Response) => {
    try {
      const { tagId, issueId } = req.params;
      const { d1Query } = await import('./server_d1.js');
      const issueRes = await d1Query<any>(`SELECT id, payload FROM issue_backlog WHERE id = ? LIMIT 1`, [issueId]);
      const issue = issueRes.results?.[0];
      if (!issue) return res.status(404).json({ error: 'report not found' });

      const tagRes = await d1Query<any>(`SELECT id, category, work_item, status FROM issue_tags WHERE id = ? LIMIT 1`, [tagId]);
      const tag = tagRes.results?.[0];
      const cat = tag?.category || 'foodcart';
      const p = typeof issue.payload === 'string'
        ? (() => { try { return JSON.parse(issue.payload); } catch { return {}; } })()
        : (issue.payload || {});
      const keys: string[] = [];
      if (Array.isArray(p.r2_shots)) {
        for (const s of p.r2_shots) if (s?.key) keys.push(s.key);
      }
      if (Array.isArray(p.r2_files)) {
        for (const f of p.r2_files) if (f?.key) keys.push(f.key);
      }
      if (p.r2_manifest_key) keys.push(p.r2_manifest_key);
      if (p.reportId) {
        keys.push(bugManifestKey(cat, tagId, p.reportId));
      }

      const holdWi = hydrateWorkItem(tag || {});
      if (
        shouldHoldR2(holdWi, [
          p.reportId,
          p.r2_prefix,
          p.jobId || p.job_id,
          issueId,
          ...keys,
        ])
      ) {
        return res.status(409).json({
          error: 'held',
          message: 'R2 stay until the work item is done. Do not prune while held.',
          public_id: holdWi.public_n ? `#${holdWi.public_n}` : null,
        });
      }

      let deleted = 0;
      for (const k of [...new Set(keys)]) {
        if (await deleteR2Object(deps, k)) deleted++;
      }

      await d1Query(`UPDATE issue_backlog SET payload = ? WHERE id = ?`, [
        JSON.stringify({
          ...p,
          obsolete: true,
          pruned_at: new Date().toISOString(),
          r2_shots: [],
          r2_files: [],
        }),
        issueId,
      ]);

      log(`${BUG_SNAPSHOT_LOG} pruned issue=${issueId} deleted=${deleted}`);
      res.json({ success: true, deleted, issueId });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'prune failed' });
    }
  });

  /** POST /api/bugs/:tagId/make-golden — 1-click Bug to Golden Case Ingest */
  app.post('/api/bugs/:tagId/make-golden', bugWriteGuard, async (req: Request, res: Response) => {
    try {
      const tag = await findTagByParam(req.params.tagId);
      if (!tag) return res.status(404).json({ error: 'tag not found' });

      const item = hydrateWorkItem(tag);
      const fs = await import('fs');
      const path = await import('path');
      const { fileURLToPath } = await import('url');
      const curDir = path.dirname(fileURLToPath(import.meta.url));
      const goldenInboxDir = path.join(curDir, 'tests', 'Golden_meal', 'inbox');

      const pub = item.public_n ? `bug_${item.public_n}` : `bug_${tag.id.slice(0, 8)}`;
      const safeTitle = (tag.title || 'unnamed').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
      const slug = `${pub}_${safeTitle}`;
      const targetDir = path.join(goldenInboxDir, slug);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Try to find scout or job context
      const jobId = item.current_evidence?.job_id || item.commits.find(c => c.evidence?.job_id)?.evidence?.job_id || null;
      let scoutData: any = null;
      if (jobId) {
        try {
          const { d1GetJob } = await import('./server_db_d1.js');
          const jobRow = await d1GetJob(jobId);
          if ((jobRow as any)?.clean_result) {
            scoutData = (jobRow as any).clean_result;
          }
        } catch {
          /* R2/file fallback below */
        }
      }

      const expectedSpec = {
        id: slug,
        title: tag.title,
        mode: tag.category === 'foodcart' ? 'A' : 'D',
        bug_id: tag.id,
        public_id: pub,
        class: item.class || 'FALSE_FRIEND',
        passes: [
          {
            id: 'pass_1',
            prompt: tag.title,
            photos: item.current_evidence?.photo_urls || [],
          }
        ],
        symptom: tag.identified_problems || tag.title,
        remaining: item.remaining,
      };

      fs.writeFileSync(path.join(targetDir, 'expected.json'), JSON.stringify(expectedSpec, null, 2));
      if (scoutData) {
        fs.writeFileSync(path.join(targetDir, 'scout.json'), JSON.stringify(scoutData, null, 2));
      }
      fs.writeFileSync(
        path.join(targetDir, 'Instruction.md'),
        `# Golden Case from ${pub}: ${tag.title}\n\n## Symptom\n${tag.identified_problems || tag.title}\n\n## What to verify\n- ${item.remaining?.join('\n- ') || 'Verify accurate food identification'}\n`
      );

      res.json({
        success: true,
        slug,
        dir: targetDir,
        expectedSpec,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'make-golden failed' });
    }
  });

  // ─── V-30.1 ticket store: create + artifacts + queue + packet ─────────────
  // State is ALWAYS derived via bugState() — there is no agent-settable state route.

  async function applyAndRespond(req: Request, res: Response, mutate: (item: ReturnType<typeof hydrateWorkItem>) => void | Promise<void>) {
    const tag = await findTagByParam(req.params.tagId || String(req.body?.tag_id || ''));
    if (!tag) return res.status(404).json({ error: 'not found' });
    const item = hydrateWorkItem(tag);
    await mutate(item);
    const projected = projectBugState(item);
    await persistWorkItem(tag.id, projected.item);
    const { d1Query } = await import('./server_d1.js');
    if (projected.ticket.legacy_status === 'fixed') {
      await d1Query(`UPDATE issue_tags SET status = 'fixed', resolved_at = ? WHERE id = ?`, [
        new Date().toISOString(),
        tag.id,
      ]);
    } else {
      await d1Query(`UPDATE issue_tags SET status = 'to_fix' WHERE id = ?`, [tag.id]);
    }
    return res.json({
      ok: true,
      tag_id: tag.id,
      public_n: projected.item.public_n,
      state: projected.ticket.state,
      flags: projected.ticket.flags,
      queue: projected.ticket.queue,
      legacy_status: projected.ticket.legacy_status,
      work_item: projected.item,
    });
  }

  /** POST /api/bugs — create a raw card (state=new until a defect is posted). */
  app.post('/api/bugs', bugWriteGuard, async (req: Request, res: Response) => {
    try {
      const { d1Query } = await import('./server_d1.js');
      const body = req.body || {};
      const title = String(body.title || body.bug || '').trim();
      if (!title) return res.status(400).json({ error: 'title (or bug) required' });
      const category = String(body.category || 'foodcart');
      const title_key = normalizeTagKey(title) || title.toLowerCase().slice(0, 160);
      const existing = await d1Query<any>(`SELECT id, title FROM issue_tags WHERE title_key = ? LIMIT 1`, [title_key]);
      if (existing.success && existing.results?.[0]?.id) {
        const tag = existing.results[0];
        const item = hydrateWorkItem(tag);
        const projected = projectBugState(item);
        return res.status(200).json({
          ok: true,
          existing: true,
          tag_id: tag.id,
          public_n: projected.item.public_n,
          state: projected.ticket.state,
          flags: projected.ticket.flags,
          work_item: projected.item,
        });
      }
      const freshId = `tag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const ins = await d1Query(
        `INSERT INTO issue_tags (id, title, title_key, category, status, comments) VALUES (?, ?, ?, ?, 'to_fix', '[]')`,
        [freshId, title.slice(0, 200), title_key, category]
      );
      if (!ins.success) return res.status(500).json({ error: ins.error || 'create failed' });
      const created = await findTagByParam(freshId);
      let item = hydrateWorkItem(created);
      item.bug = title;
      if (body.surface) item.surface = body.surface;
      if (body.source) item.source = body.source;
      if (body.assignee) item.assignee = body.assignee;
      if (body.class) item.class = String(body.class);
      if (body.idem_key) item.idem_key = String(body.idem_key);
      if (body.reply_to && typeof body.reply_to === 'object') item.reply_to = body.reply_to;
      // assign public_n from existing max
      const all = await d1Query<any>(`SELECT work_item FROM issue_tags`);
      const used = ((all.results || []) as any[]).map((r) => {
        try {
          return Number(JSON.parse(r.work_item || '{}').public_n || 0);
        } catch {
          return 0;
        }
      });
      const maxN = used.reduce((m, n) => Math.max(m, n), 0);
      if (!item.public_n) item.public_n = maxN + 1;
      const projected = projectBugState(item);
      await persistWorkItem(freshId, projected.item);
      res.status(201).json({
        ok: true,
        existing: false,
        tag_id: freshId,
        public_n: projected.item.public_n,
        state: projected.ticket.state,
        flags: projected.ticket.flags,
        work_item: projected.item,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'create failed' });
    }
  });

  /** POST /api/bugs/:tagId/defect — packer posts the atomic defect (→ packed). */
  app.post('/api/bugs/:tagId/defect', bugWriteGuard, async (req: Request, res: Response) => {
    try {
      const v = validateDefect(req.body || {});
      if (v.ok === false) {
        return res.status(400).json({ error: v.error });
      }
      const defect = v.value;
      return applyAndRespond(req, res, (item) => {
        item.defect = defect;
        if (req.body?.class) item.class = String(req.body.class);
        if (req.body?.surface) item.surface = req.body.surface;
        if (req.body?.fingerprint) item.fingerprint = String(req.body.fingerprint);
        if (req.body?.assignee) item.assignee = req.body.assignee;
        if (req.body?.source) item.source = req.body.source;
        if (req.body?.idem_key) item.idem_key = String(req.body.idem_key);
        if (!item.bug) item.bug = defect.observed;
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'defect failed' });
    }
  });

  /** POST /api/bugs/:tagId/repro — QA posts the repro verdict. */
  app.post('/api/bugs/:tagId/repro', bugWriteGuard, async (req: Request, res: Response) => {
    try {
      const v = validateRepro(req.body || {});
      if (v.ok === false) {
        return res.status(400).json({ error: v.error });
      }
      const repro = v.value;
      return applyAndRespond(req, res, (item) => {
        item.repro = repro;
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'repro failed' });
    }
  });

  /** POST /api/bugs/:tagId/plan — orchestrator posts the plan block. */
  app.post('/api/bugs/:tagId/plan', bugWriteGuard, async (req: Request, res: Response) => {
    try {
      const v = validatePlan(req.body || {});
      if (v.ok === false) {
        return res.status(400).json({ error: v.error });
      }
      const plan = v.value;
      return applyAndRespond(req, res, (item) => {
        item.plan = plan;
        if (req.body?.assignee) item.assignee = req.body.assignee;
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'plan failed' });
    }
  });

  /** POST /api/bugs/:tagId/verify — verifier posts the named-gate result (green → done). */
  app.post('/api/bugs/:tagId/verify', bugWriteGuard, async (req: Request, res: Response) => {
    try {
      const v = validateVerify(req.body || {});
      if (v.ok === false) {
        return res.status(400).json({ error: v.error });
      }
      const verify = v.value;
      return applyAndRespond(req, res, (item) => {
        item.verify = verify;
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'verify failed' });
    }
  });

  /** GET /api/bugs/:tagId/packet?format=json|text — full ticket packet for dispatch. */
  app.get('/api/bugs/:tagId/packet', async (req: Request, res: Response) => {
    try {
      const tag = await findTagByParam(req.params.tagId);
      if (!tag) return res.status(404).json({ error: 'not found' });
      const item = hydrateWorkItem(tag);
      const ticket = bugState(item);
      const packet = {
        tag_id: tag.id,
        public_n: item.public_n,
        title: tag.title,
        bug: item.bug,
        class: item.class,
        fingerprint: item.fingerprint,
        surface: item.surface,
        source: item.source,
        assignee: item.assignee,
        state: ticket.state,
        flags: ticket.flags,
        queue: ticket.queue,
        legacy_status: ticket.legacy_status,
        defect: item.defect || null,
        repro: item.repro || null,
        plan: item.plan || null,
        verify: item.verify || null,
        remaining: item.remaining,
        parked: item.parked,
        done: item.done,
        burns: item.burns,
        commits: item.commits,
        occurrences: item.occurrences,
        blocked_by: item.blocked_by || [],
        duplicate_of: item.duplicate_of || null,
        blocked_reason: item.blocked_reason || null,
        reply_to: item.reply_to || null,
        current_evidence: item.current_evidence,
        created_at: tag.created_at,
        updated_at: tag.updated_at,
      };
      if (String(req.query.format || '').toLowerCase() === 'text') {
        const lines = [
          `# Bug ${item.public_n ? `#${item.public_n}` : tag.id}`,
          `Title: ${tag.title || ''}`,
          `State: ${ticket.state}${ticket.flags.blocked_reason ? ` (blocked: ${ticket.flags.blocked_reason})` : ''}`,
          `Class: ${item.class || '—'} · Surface: ${item.surface || '—'} · Assignee: ${item.assignee || '—'}`,
          item.duplicate_of ? `Duplicate of: ${item.duplicate_of}` : '',
          '',
          item.defect
            ? `## Defect\nComponent: ${item.defect.component}\nObserved: ${item.defect.observed}\nExpected: ${item.defect.expected}\nCriteria: ${item.defect.criteria}`
            : '## Defect\n(not packed yet)',
          item.repro ? `\n## Repro (${item.repro.status})\nCommand: ${item.repro.command || '—'}\nExit: ${item.repro.exit_code ?? '—'}\nLog: ${item.repro.run_log ? String(item.repro.run_log).slice(0, 500) : '—'}` : '',
          item.plan ? `\n## Plan\nHypothesis: ${item.plan.hypothesis}\nFiles: ${item.plan.files.join(', ')}\nGates: ${item.plan.gates.join(', ')}` : '',
          item.verify ? `\n## Verify (${item.verify.result})\nCommand: ${item.verify.command}\nEvidence: ${item.verify.evidence.join(', ') || '—'}` : '',
          `\n## Remaining (${item.remaining.length})\n${item.remaining.map((r) => `- [ ] ${r}`).join('\n') || '(none)'}`,
          `\nBurns: ${item.burns.filter((b) => b.burned).length}/${2}`,
        ].filter(Boolean);
        return res.type('text/plain').send(lines.join('\n'));
      }
      res.json(packet);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'packet failed' });
    }
  });

  /** GET /api/bugs/:tagId/state — read the derived state (never a setter). */
  app.get('/api/bugs/:tagId/state', async (req: Request, res: Response) => {
    try {
      const tag = await findTagByParam(req.params.tagId);
      if (!tag) return res.status(404).json({ error: 'not found' });
      const item = hydrateWorkItem(tag);
      const ticket = bugState(item);
      res.json({
        tag_id: tag.id,
        public_n: item.public_n,
        state: ticket.state,
        flags: ticket.flags,
        queue: ticket.queue,
        legacy_status: ticket.legacy_status,
        assignee: item.assignee,
        surface: item.surface,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'state failed' });
    }
  });
}

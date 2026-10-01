#!/usr/bin/env node
/**
 * scripts/meal-audit-loop.mjs
 *
 * Phase 3 of the meal QA loop — the ITERATION DRIVER.
 *
 * Closes the loop the other phases opened:
 *   resolve saved meals (Phase 1) -> audit them -> isolated replay -> compare
 *     PASS       -> record a green pass, move on
 *     DIVERGED   -> file cards (Phase 2) -> dispatch a coder -> wait for deploy
 *                   -> RE-RUN THE SAME COMPARISON (this is the re-verify)
 *                     PASS   -> card closes
 *                     FAIL   -> next attempt, escalate the model ladder
 *                   -> attempts exhausted -> block the card, escalate to a human
 *
 * This is a bounded, resumable PASS, not a daemon. Each invocation does one
 * sweep over a selection and exits with a machine-readable summary. That matters
 * for three reasons:
 *
 *   1. AUTHOR != VERIFIER. The fix is produced by a coder in a dispatch worktree;
 *      the re-verify runs here, against the live site, in the QA lane. A loop
 *      that verified its own output would be marking its own homework — that
 *      invariant is non-negotiable (BUG_PIPELINE.md, and run-coding-dispatch.sh
 *      which refuses to post verify for the same reason).
 *
 *   2. HARD ATTEMPT CAP (default 3). Unattended retry is how you burn a free-model
 *      quota and leave a dirty worktree. Past the cap the card is BLOCKED with a
 *      reason, and a human decides. Burned hypotheses belong in the card, not in
 *      scrollback.
 *
 *   3. ONE DEFECT PER PASS. A comparison usually shows several drifts. The bridge
 *      already splits them into separate cards; this driver never bundles them and
 *      never re-runs the whole set as one task.
 *
 * State lives in specs/meal-qa-loop/state.json (committed — artifacts/ is
 * gitignored, so an untracked state file would silently reset the attempt cap on
 * every deploy and turn the cap into a suggestion).
 *
 * Exit codes:
 *   0  the sweep completed (green passes and/or cards filed/dispatched)
 *   1  a stage failed hard (bad bundle, comparator crash, dispatch refused)
 *   2  dry-run completed with at least one finding
 *   3  usage / config error
 *
 * Usage:
 *   node scripts/meal-audit-loop.mjs --latest=3 --dry-run
 *   node scripts/meal-audit-loop.mjs --latest=3 --no-dispatch
 *   node scripts/meal-audit-loop.mjs --bundle=artifacts/meal_audits/Meal-X-01 --dry-run
 *   node scripts/meal-audit-loop.mjs --status
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The hand-off to the meal-audit agent. Imported (not shelled out) so the
// loop's own gate can assert the handshake without a subprocess, and so a
// queued request is visible in the loop's summary.
import {
  enqueue as handoffEnqueue,
  status as handoffStatus,
  notifyAgent as handoffNotify,
} from './meal-audit-handoff.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const STATE_DIR = path.join(REPO_ROOT, 'specs', 'meal-qa-loop');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

export const MAX_ATTEMPTS = 3;
export const DEPLOY_WAIT_SECONDS = 45;

/**
 * Escalation ladder. Only FREE models are safe defaults on this box: the Zen
 * balance is depleted and `agy` is geo-blocked. Attempt 1 is the cheap default;
 * later attempts trade cost for reasoning depth.
 */
export const ESCALATION_LADDER = [
  { thinking: 'low', model: 'nemotron-3.5-lightning-free' },
  { thinking: 'high', model: 'nemotron-3.5-lightning-free' },
  { thinking: 'high', model: 'space-bunny-free' },
];

export function parseArgs(argv) {
  const o = {
    latest: null, bundle: null, dryRun: false, noDispatch: false,
    status: false, json: false, help: false, maxAttempts: MAX_ATTEMPTS,
    deployWait: DEPLOY_WAIT_SECONDS, actual: null, reset: false, notifyAgent: false,
  };
  for (const a of argv) {
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--no-dispatch') o.noDispatch = true;
    else if (a === '--notify-agent') o.notifyAgent = true;
    else if (a === '--status') o.status = true;
    else if (a === '--json') o.json = true;
    else if (a === '--reset') o.reset = true;
    else if (a.startsWith('--latest=')) o.latest = parseInt(a.slice('--latest='.length), 10);
    else if (a.startsWith('--max-attempts=')) o.maxAttempts = parseInt(a.slice('--max-attempts='.length), 10);
    else if (a.startsWith('--deploy-wait=')) o.deployWait = parseInt(a.slice('--deploy-wait='.length), 10);
    else if (a.startsWith('--bundle=')) o.bundle = a.slice('--bundle='.length).trim();
    else if (a.startsWith('--actual=')) o.actual = a.slice('--actual='.length).trim();
    else { console.error(`Unknown argument: ${a}`); process.exit(3); }
  }
  return o;
}

function usage() {
  console.log(`
Meal Audit Loop — bounded, resumable, author != verifier.

Usage:
  node scripts/meal-audit-loop.mjs --latest=3 --dry-run
  node scripts/meal-audit-loop.mjs --latest=3 --no-dispatch        # file cards, do not dispatch
  node scripts/meal-audit-loop.mjs --bundle=<dir> --dry-run
  node scripts/meal-audit-loop.mjs --status

Guarantees:
  - The fix is authored by a coder in a dispatch worktree; the re-verify here
    runs against the live site in the QA lane. Never the same actor.
  - Attempts are capped (default ${MAX_ATTEMPTS}). Past the cap the card is BLOCKED
    for a human, never retried forever.
  - One defect per card. Never bundled.
  - State is committed (specs/meal-qa-loop/state.json) so the cap survives deploys.

Options:
  --dry-run        plan only: no store writes, no dispatch, no sleeps
  --no-dispatch    file cards, but do not start a coder
  --max-attempts=N override the attempt cap
  --deploy-wait=N  seconds to wait for the rebuild before re-verifying
  --reset          clear loop state before running
`);
}

// --- state --------------------------------------------------------------------

export function emptyState() {
  return { version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), cards: {} };
}

export function loadState() {
  if (!fs.existsSync(STATE_FILE)) return emptyState();
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!s || typeof s !== 'object' || !s.cards) return emptyState();
    return s;
  } catch {
    console.error('[Loop] state.json unreadable — starting fresh (attempt caps reset).');
    return emptyState();
  }
}

export function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  return STATE_FILE;
}

export function recordAttempt(state, idemKey, extra = {}) {
  const cur = state.cards[idemKey] || { attempts: 0, history: [] };
  cur.attempts = (cur.attempts || 0) + 1;
  cur.updatedAt = new Date().toISOString();
  cur.history = cur.history || [];
  cur.history.push({ at: new Date().toISOString(), ...extra });
  state.cards[idemKey] = cur;
  return cur;
}

export function attemptsFor(state, idemKey) {
  return state.cards[idemKey]?.attempts || 0;
}

/** The escalation rung for a given 1-based attempt number. */
export function rungFor(attempt) {
  const idx = Math.min(Math.max(attempt, 1), ESCALATION_LADDER.length) - 1;
  return ESCALATION_LADDER[idx];
}

export function isCapped(state, idemKey, maxAttempts = MAX_ATTEMPTS) {
  return attemptsFor(state, idemKey) >= maxAttempts;
}

// --- stage runners ------------------------------------------------------------

function run(cmd, args, { cwd = REPO_ROOT, allowFail = true, timeout = 15 * 60 * 1000 } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd, timeout });
  return {
    status: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    ok: r.status === 0,
    ...(allowFail ? {} : {}),
  };
}

function runNode(script, args, opts) {
  return run('node', [path.join(REPO_ROOT, 'scripts', script), ...args], opts);
}

/**
 * Stage 1 — resolve the selection. Returns the meal records to audit.
 */
export function selectMeals({ latest, bundle, dryRun }) {
  if (bundle) {
    return [{
      mealId: path.basename(path.resolve(bundle)),
      bundleDir: path.resolve(bundle),
      provenance: 'prebuilt',
      source: 'cli',
    }];
  }
  const args = [`--latest=${latest}`];
  if (dryRun) args.push('--list');
  const r = runNode('meal-audit-resolve.mjs', args, { timeout: 120000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* handled by caller */ }
  if (!parsed || !Array.isArray(parsed.meals)) {
    console.error(`[Loop] resolve failed (exit ${r.status}): ${r.stderr || r.stdout}`);
    return [];
  }
  return parsed.meals.filter((m) => m.provenance !== 'unreproducible').map((m) => ({
    mealId: m.mealId,
    name: m.name,
    provenance: m.provenance,
    jobId: m.jobId,
    photoCount: m.photoCount,
    bundleDir: null,
  }));
}

/** Every image the fetcher/resolve wrote into a bundle, as absolute paths. */
export function listBundlePhotos(bundleDir) {
  const photosDir = path.join(bundleDir, 'photos');
  if (!fs.existsSync(photosDir)) return [];
  try {
    return fs.readdirSync(photosDir)
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .map((f) => path.join(photosDir, f));
  } catch {
    return [];
  }
}

/**
 * Photo references from a skeleton, resolved to absolute paths when they are
 * server-relative (`/photos/x.jpg`), and passed through when already absolute.
 * A photo_only request with no resolvable image is an action the agent cannot
 * take, so the route's answer is what the agent will have to work from.
 */
export function readSkeletonPhotos(skeletonPath) {
  const out = [];
  let skel = null;
  try { skel = JSON.parse(fs.readFileSync(skeletonPath, 'utf8')); } catch { return out; }
  const base = (process.env.API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  for (const pass of (skel.passes || [])) {
    for (const p of (pass.addedPhotos || [])) {
      if (typeof p !== 'string' || !p.trim()) continue;
      out.push(p.startsWith('http') ? p : `${base}${p.startsWith('/') ? '' : '/'}${p}`);
    }
  }
  return out;
}

/**
 * Stage 2 — obtain an auditable bundle for a meal. Full multi-turn bundles are
 * delegated to the existing fetcher (it owns debug-payload retrieval and photo
 * download). Photo-only meals need the audit agent to fill dishes[]; this driver
 * cannot invent ground truth, so it reports them as `needs_audit` instead of
 * fabricating a bundle.
 */
export function obtainBundle(meal, { outputDir, dryRun }) {
  if (meal.bundleDir) return { ok: true, bundleDir: meal.bundleDir, note: 'prebuilt bundle' };

  // An audited bundle the agent already produced wins over re-fetching. Without
  // this the loop rebuilt an empty skeleton every sweep, so the agent's work was
  // never compared and the meal stayed needs_audit forever — the hand-off
  // completed and the loop ignored it.
  const done = handoffStatus().rows.find((r) => r.mealId === meal.mealId);
  if (done && done.state === 'done' && done.bundle && fs.existsSync(done.bundle)) {
    return {
      ok: true,
      bundleDir: done.bundle,
      audited: true,
      photos: listBundlePhotos(done.bundle),
      note: 'audited bundle from the meal-audit agent (handoff complete)',
    };
  }

  if (meal.provenance === 'debug_payload' && meal.jobId) {
    const dir = path.join(outputDir, `${meal.mealId}`);
    const r = runNode('meal-audit-fetch.mjs', [`--job-id=${meal.jobId}`, `--output-dir=${dir}`], { timeout: 300000 });
    if (r.ok && fs.existsSync(path.join(dir, 'flow_skeleton.json'))) {
      return {
        ok: true,
        bundleDir: dir,
        needsAudit: true, // the audit agent must fill dishes[] before compare
        // The fetcher downloads the turn photos locally. The hand-off must carry
        // those paths, or the audit agent gets a request naming a skeleton and no
        // images — a request it cannot possibly act on.
        photos: listBundlePhotos(dir),
        note: 'skeleton fetched; awaiting meal-audit-engine analysis',
      };
    }
    return { ok: false, error: r.stderr || r.stdout || `fetch exit ${r.status}` };
  }

  if (meal.provenance === 'photo_only') {
    const dir = path.join(outputDir, `${meal.mealId}`);
    const r = runNode('meal-audit-resolve.mjs', [`--meal-id=${meal.mealId}`, '--emit-skeletons', `--output-dir=${dir}`], { timeout: 120000 });
    if (r.ok) {
      // locate the emitted skeleton
      const stack = [dir];
      let found = null;
      while (stack.length && !found) {
        const cur = stack.pop();
        let entries = [];
        try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
          const p = path.join(cur, e.name);
          if (e.isDirectory()) stack.push(p);
          else if (e.name === 'flow_skeleton.json') { found = p; break; }
        }
      }
      if (found) {
        return {
          ok: true,
          bundleDir: path.dirname(found),
          skeleton: found,
          needsAudit: true,
          // A photo_only meal's photos are referenced by the skeleton's
          // addedPhotos, which may be server-relative rather than downloaded.
          // Pass both so the agent can resolve either form.
          photos: readSkeletonPhotos(found),
          note: 'photo_only skeleton emitted; single-turn ground truth, no edit history',
        };
      }
    }
    return { ok: false, error: r.stderr || r.stdout || `photo-only resolve exit ${r.status}` };
  }

  return { ok: false, error: `provenance ${meal.provenance} has no bundle path` };
}

/**
 * Stage 3 — the RE-VERIFY. Re-runs the comparator against the live site for the
 * SAME bundle. This is the step the generic journey re-test cannot do: it scores
 * the actual 32-nutrient ledger, not just "did the page render".
 *
 * Returns { verdict, comparisonPath, failures }.
 */
export function runComparison(bundleDir, { actualPath, skip = false } = {}) {
  const comparisonPath = path.join(bundleDir, 'comparison.json');
  const expected = path.join(bundleDir, 'meal_result.json');
  if (skip) {
    // Dry-run reads whatever comparison already exists. Crucially, an ABSENT
    // comparison is not a verdict: it means the bundle has not been audited yet.
    // Reporting it as UNKNOWN would let it fall through to the ticket stage and
    // try to file a bug for a meal that was simply never analysed.
    let existing = null;
    try { existing = JSON.parse(fs.readFileSync(comparisonPath, 'utf8')); } catch { /* none */ }
    if (!existing || !existing.verdict) {
      const hasGroundTruth = fs.existsSync(expected);
      return {
        skipped: true,
        verdict: hasGroundTruth ? 'NOT_COMPARED' : 'NO_GROUND_TRUTH',
        comparisonPath,
        failures: [],
        error: hasGroundTruth
          ? 'bundle is audited but not yet compared against a live capture'
          : 'meal_result.json absent — bundle not audited yet',
      };
    }
    return { skipped: true, verdict: existing.verdict, comparisonPath, failures: existing.failures || [] };
  }

  if (!fs.existsSync(expected)) {
    return { skipped: true, verdict: 'NO_GROUND_TRUTH', comparisonPath, failures: [], error: 'meal_result.json absent — bundle not audited yet' };
  }
  if (!actualPath || !fs.existsSync(actualPath)) {
    return {
      skipped: true,
      verdict: 'NO_ACTUAL',
      comparisonPath,
      failures: [],
      error: `no live actual payload at ${actualPath || '(unset)'} — the journey must capture one`,
    };
  }

  const r = runNode('meal-audit-compare.mjs', [`--bundle=${bundleDir}`, `--actual=${actualPath}`, '--write'], { timeout: 300000 });
  let cmp = null;
  try { cmp = JSON.parse(fs.readFileSync(comparisonPath, 'utf8')); } catch { /* reported below */ }
  if (!cmp) {
    return { skipped: true, verdict: 'COMPARE_ERROR', comparisonPath, failures: [], error: r.stderr || r.stdout };
  }
  return {
    skipped: false,
    verdict: cmp.verdict,
    comparisonPath,
    failures: cmp.failures || [],
    // 0 = PASS, 1 = FAIL, 2 = DIVERGED
    exitCode: r.status,
  };
}

/** Stage 4 — file cards via the Phase 2 bridge. */
export function fileTickets(bundleDir, { actualPath, dryRun }) {
  const args = [`--bundle=${bundleDir}`, '--json'];
  if (actualPath) args.push(`--actual=${actualPath}`);
  if (dryRun) args.push('--dry-run');
  const r = runNode('meal-audit-ticket.mjs', args, { timeout: 180000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* handled */ }
  return { ok: r.status === 0 || r.status === 2, status: r.status, plan: parsed, stderr: r.stderr, stdout: r.stdout };
}

/**
 * Stage 4b — post the PLAN so the comparator becomes the card's real gate.
 *
 * Without this the dispatcher falls back to a generic gate
 * (`npx vitest run src/utils/bug*.test.ts`), which knows nothing about meals.
 * The card's own `criteria` text does reach the coder prompt, but a prompt is
 * not a gate: the dispatcher resolves TICKET_GATES from `plan.gates`, and that
 * is what a verifier later runs to close the card. So a meal-audit card would be
 * "verified" green by a bug-utils vitest that never touches the 32-nutrient
 * ledger — the loop would close cards on evidence that proves nothing.
 */
export function postPlan(publicN, { bundleDir, actualPath, taxonomy, key, dryRun }) {
  if (!publicN) return { ok: false, error: 'no card number to plan' };
  const actualArg = actualPath ? ` --actual="${actualPath}"` : '';
  // The gate is the exact comparator invocation for THIS bundle. Note the
  // absolute path: the coder runs in a separate dispatch worktree, and a
  // relative artifacts/ path would not resolve there.
  const gate = `node scripts/meal-audit-compare.mjs --bundle="${bundleDir}"${actualArg}`;
  if (dryRun) return { ok: true, dryRun: true, gate, command: `bugctl plan --id=${publicN} --gates="${gate}"` };
  const r = runNode('bugctl.mjs', [
    'plan', `--id=${publicN}`,
    `--hyp=${taxonomy} on ${key}: the ${taxonomy} path in this pipeline disagrees with audited ground truth; correct the class, not this one number`,
    '--files=server_meal_edit.ts,server_food_analyze_run_finalize.ts,server_meal_compiler.ts',
    `--gates=${gate}`,
    '--by=orchestrator',
  ], { timeout: 60000 });
  return { ok: r.status === 0, status: r.status, gate, stderr: r.stderr, stdout: r.stdout };
}

/**
 * Hand a meal the loop cannot audit itself to the meal-audit agent.
 *
 * This is the hand-off the user asked for and the one that was missing. The loop
 * can resolve, compare, file and re-verify, but it cannot look at a photo and
 * declare the dishes — that is the meal-audit agent's job. So the loop's duty
 * stops at making the work legible to that agent: a durable request it can claim,
 * and (optionally) a Telegram ping so nobody has to poll.
 *
 * It reports what the queue already knows, so a second sweep does not re-ask:
 *   created         this sweep queued new work
 *   already_pending someone else's sweep already queued it
 *   already_done    the agent already audited it; the next sweep proceeds
 *   claimed         an agent has it in progress
 */
export function handOffToAuditAgent(meal, bundle, { dryRun = false, notify = false } = {}) {
  if (dryRun) {
    return { action: 'dry_run', state: 'would_enqueue', mealId: meal.mealId, notify: false };
  }
  // A completed audit is the unblock: prefer the bundle the agent recorded over
  // re-resolving, so the loop moves on to compare instead of re-queueing.
  const done = handoffStatus().rows.find((r) => r.mealId === meal.mealId);
  if (done && done.state === 'done' && done.bundle && fs.existsSync(done.bundle)) {
    return { action: 'already_done', state: 'done', mealId: meal.mealId, bundle: done.bundle };
  }
  if (done && (done.state === 'pending' || done.state === 'claimed')) {
    return { action: 'already_pending', state: done.state, mealId: meal.mealId, by: done.by || null };
  }

  const photos = [
    ...(Array.isArray(bundle.photos) ? bundle.photos : []),
    ...(Array.isArray(meal.photos) ? meal.photos : []),
  ].filter((p, i, a) => typeof p === 'string' && p && a.indexOf(p) === i);
  const res = handoffEnqueue({
    mealId: meal.mealId,
    name: meal.name || meal.mealId,
    provenance: meal.provenance || 'unknown',
    photos,
    skeleton: bundle.skeleton || (bundle.bundleDir ? path.join(bundle.bundleDir, 'flow_skeleton.json') : null),
    by: 'meal-audit-loop',
  });
  if (!res.ok) return { action: 'error', error: res.error };

  let ping = null;
  if (notify && res.action === 'created') ping = handoffNotify(res.request);
  return {
    action: res.action,
    state: res.request?.status || 'pending',
    mealId: meal.mealId,
    request: path.relative(REPO_ROOT, res.path || ''),
    notify: ping || null,
  };
}

/** The keys the comparator scores as CORE drift. If one of these has no source in
 *  the ground-truth bundle, the comparison is measuring the audit's gaps rather
 *  than the product, and any card filed from it describes the audit, not a bug. */
const CORE_NUTRIENT_KEYS = [
  'calories', 'protein', 'carbohydrates', 'totalFat', 'saturatedFat',
  'sugar', 'addedSugar', 'totalFibre', 'sodium',
];

/**
 * May this bundle be used to dispatch a coder?
 *
 * The audit is allowed to be partial — that is the point of refusing to guess a
 * weight. But a partial audit must not start a coder. Driving a real meal
 * (meal_1790784308630) produced 14 "failures" of which most were the audit's own
 * incompleteness: the salad had no sourceable weight so it was left out, and
 * `addedSugar` was unsourced, yet the loop would have handed all of it to a coder
 * as product defects. A fix verified against a knowingly-incomplete ground truth
 * is not a fix, and re-verifying it can never go green, so the loop would burn
 * its whole attempt cap on cards it invented.
 *
 * Micronutrients are NOT required: the catalog is thin and a missing vitamin is
 * normal. Only the core keys are, because only they are scored.
 */
/**
 * Capture the app's own ledger for this meal, so compare has an actual to score.
 *
 * Nothing produced one before. `qa-runner.mjs` has no actual-capture, so a sweep
 * reached runComparison with `actualPath` unset and stopped at NO_ACTUAL — the
 * last mile of compare could only be walked by hand, which is exactly what an
 * unattended sweep cannot do. The meal id is right here, and
 * meal-audit-capture-actual.mjs turns it into the payload from the live store.
 *
 * Best effort by design: a meal with no debug payload simply has no actual yet,
 * and that must read as NO_ACTUAL rather than as a hard failure.
 */
export function captureActualForMeal(mealId, { apiBase = null, outDir = null } = {}) {
  if (!mealId) return { ok: false, reason: 'no meal id' };
  const out = outDir
    ? path.join(outDir, `actual_${mealId}.json`)
    : path.join(REPO_ROOT, 'qa-evidence', `actual_${mealId}.json`);
  const args = [`--meal-id=${mealId}`, `--out=${out}`];
  if (apiBase) args.push(`--api-base=${apiBase}`);
  const r = runNode('meal-audit-capture-actual.mjs', args, { timeout: 120000 });
  if (r.status !== 0 || !fs.existsSync(out)) {
    return { ok: false, reason: (r.stderr || r.stdout || `exit ${r.status}`).trim().split('\n').pop() || 'capture produced nothing' };
  }
  return { ok: true, path: out };
}

export function auditIsDispatchable(bundleDir) {
  if (!bundleDir) return { ok: false, reason: 'no bundle to judge' };
  const payload = path.join(bundleDir, 'audit_payload.json');
  const result = path.join(bundleDir, 'meal_result.json');
  const src = fs.existsSync(payload) ? payload : (fs.existsSync(result) ? result : null);
  if (!src) return { ok: false, reason: 'bundle has no audit_payload.json or meal_result.json' };

  let doc;
  try { doc = JSON.parse(fs.readFileSync(src, 'utf8')); } catch (e) {
    return { ok: false, reason: `bundle json unreadable: ${e.message}` };
  }

  const unsourced = new Set(doc.unsourcedNutrients || []);
  for (const p of doc.passes || []) for (const d of p.dishes || []) {
    for (const k of d.unsourcedNutrients || []) unsourced.add(k);
  }
  const coreGaps = CORE_NUTRIENT_KEYS.filter((k) => unsourced.has(k));
  if (coreGaps.length) {
    return {
      ok: false,
      coreGaps,
      reason: `ground truth is incomplete for core nutrient(s) ${coreGaps.join(', ')} — `
        + 'a coder would be fixing the audit, not the product',
    };
  }
  return { ok: true, unsourcedCount: unsourced.size };
}

/** Stage 5 — dispatch a coder. The AUTHOR. Never verifies its own work. */
export function dispatchCard(publicN, { attempt, dryRun }) {
  if (!publicN) return { ok: false, error: 'no public card number to dispatch' };
  const rung = rungFor(attempt);
  const args = [
    `--ticket=#${publicN}`,
    `--tool=opencode`,
    `--model=${rung.model}`,
    `--thinking=${rung.thinking}`,
    '--category=meal',
    '--profile=orchestrator',
  ];
  if (dryRun) return { ok: true, dryRun: true, command: `run-coding-dispatch.sh ${args.join(' ')}`, rung };
  const r = run('bash', [path.join(REPO_ROOT, 'scripts', 'run-coding-dispatch.sh'), ...args], { timeout: 120000 });
  return { ok: r.status === 0, status: r.status, stdout: r.stdout, stderr: r.stderr, rung };
}

function sleepSeconds(n) {
  if (!(n > 0)) return;
  const end = Date.now() + n * 1000;
  while (Date.now() < end) {
    // Synchronous wait: this driver is a single bounded sweep, and a blocking
    // sleep is honest about that. Cron invokes it; it is not a daemon.
    spawnSync('sleep', ['2']);
  }
}

// --- the sweep ----------------------------------------------------------------

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { usage(); process.exit(0); }

  if (o.status) {
    const s = loadState();
    const rows = Object.entries(s.cards).map(([k, v]) => ({ idemKey: k, attempts: v.attempts, updatedAt: v.updatedAt }));
    console.log(JSON.stringify({ stateFile: STATE_FILE, tracked: rows.length, cards: rows }, null, 2));
    process.exit(0);
  }

  if (o.latest == null && !o.bundle) { usage(); process.exit(3); }
  if (!Number.isFinite(o.maxAttempts) || o.maxAttempts < 1) {
    console.error('[Loop] --max-attempts must be >= 1');
    process.exit(3);
  }

  let state = o.reset ? emptyState() : loadState();
  if (o.reset) saveState(state);

  const outputDir = path.join(REPO_ROOT, 'artifacts', 'meal_audits', 'loop');
  const meals = selectMeals({ latest: o.latest, bundle: o.bundle, dryRun: o.dryRun });

  if (meals.length === 0) {
    console.error('[Loop] no resolvable meals in the selection — nothing to audit.');
    const summary = { generatedAt: new Date().toISOString(), dryRun: o.dryRun, selected: 0, results: [], note: 'no resolvable meals' };
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    process.exit(0);
  }

  console.error(`[Loop] ${meals.length} meal(s) selected (dryRun=${o.dryRun}, dispatch=${!o.noDispatch && !o.dryRun}).`);

  const results = [];
  let hardFailure = false;

  for (const meal of meals) {
    const rec = { mealId: meal.mealId, name: meal.name, provenance: meal.provenance, stages: {} };

    // --- obtain a bundle
    const bundle = obtainBundle(meal, { outputDir, dryRun: o.dryRun });
    if (!bundle.ok) {
      rec.error = `bundle: ${bundle.error}`;
      console.error(`[Loop] ${meal.mealId} -> bundle FAILED: ${bundle.error}`);
      hardFailure = true;
      results.push(rec);
      continue;
    }
    rec.bundleDir = bundle.bundleDir;
    rec.stages.bundle = bundle.note;
    console.error(`[Loop] ${meal.mealId} -> ${bundle.note}`);

    // --- compare (or, in dry-run, read whatever comparison exists)
    // An explicit --actual wins. Otherwise capture the app's own ledger for this
    // meal, which is what lets an unattended sweep reach a real verdict instead of
    // stopping at NO_ACTUAL on every meal.
    let actualPath = o.actual || null;
    if (!actualPath && !o.dryRun) {
      const cap = captureActualForMeal(meal.mealId, { apiBase: process.env.API_BASE_URL || null });
      rec.stages.captureActual = cap.ok ? { path: cap.path } : { skipped: true, reason: cap.reason };
      if (cap.ok) actualPath = cap.path;
    }
    const cmp = runComparison(bundle.bundleDir, { actualPath, skip: o.dryRun });
    rec.stages.compare = { verdict: cmp.verdict, skipped: !!cmp.skipped, failures: (cmp.failures || []).length, error: cmp.error || null };

    if (cmp.verdict === 'PASS') {
      rec.outcome = 'green';
      console.error(`[Loop] ${meal.mealId} -> PASS (no action needed)`);
      results.push(rec);
      continue;
    }

    if (['NO_GROUND_TRUTH', 'NO_ACTUAL', 'NOT_COMPARED'].includes(cmp.verdict)) {
      // Not a defect — the corpus is not audited yet, or no live capture exists.
      // Recording this as a failure would be a lie that the attempt cap then counts,
      // and filing a card for it would be a bug against a meal nobody has checked.
      rec.outcome = {
        NO_GROUND_TRUTH: 'needs_audit',
        NO_ACTUAL: 'needs_actual',
        NOT_COMPARED: 'needs_compare',
      }[cmp.verdict];
      console.error(`[Loop] ${meal.mealId} -> ${rec.outcome} (${cmp.error})`);

      // The hand-off. A meal with no ground truth is a job for the meal-audit
      // agent, and the loop's job is to put it in front of that agent rather
      // than log a line and wait for a human to notice. This is the step that
      // was missing: without it the loop reported needs_audit forever and no
      // work was ever queued for the agent that does the auditing.
      if (rec.outcome === 'needs_audit') {
        const hand = handOffToAuditAgent(meal, bundle, { dryRun: o.dryRun, notify: o.notifyAgent });
        rec.stages.handoff = hand;
        if (hand.error) {
          // A failed hand-off is a real failure, not a quiet no-op: the meal is
          // stuck with nobody auditing it and the loop would look healthy.
          rec.error = `handoff: ${hand.error}`;
          hardFailure = true;
        } else {
          console.error(`[Loop] ${meal.mealId} -> hand-off ${hand.action} (${hand.state || 'pending'})`);
        }
      }
      results.push(rec);
      continue;
    }

    if (cmp.verdict === 'COMPARE_ERROR') {
      rec.error = `compare: ${cmp.error}`;
      hardFailure = true;
      results.push(rec);
      continue;
    }

    // --- DIVERGED / FAIL: file one card per finding
    const filed = fileTickets(bundle.bundleDir, { actualPath: o.actual, dryRun: o.dryRun });
    rec.stages.tickets = { ok: filed.ok, status: filed.status, posted: filed.plan?.posted?.length || 0 };
    if (!filed.ok) {
      rec.error = `tickets: ${filed.stderr || `exit ${filed.status}`}`;
      hardFailure = true;
      results.push(rec);
      continue;
    }

    const posted = filed.plan?.posted || [];
    rec.cards = posted.map((p) => ({ idemKey: p.idemKey, publicN: p.publicN, class: p.class, key: p.key, deduped: p.deduped }));

    // Cap check per card, BEFORE spending another attempt.
    const capped = [];
    const dispatchable = [];
    for (const p of posted) {
      const used = attemptsFor(state, p.idemKey);
      if (used >= o.maxAttempts) capped.push(p);
      else dispatchable.push(p);
    }
    rec.capped = capped.map((p) => ({ idemKey: p.idemKey, publicN: p.publicN, attempts: attemptsFor(state, p.idemKey) }));

    if (capped.length > 0) {
      console.error(`[Loop] ${capped.length} card(s) at the attempt cap (${o.maxAttempts}) -> escalate to human, no further dispatch.`);
      for (const p of capped) {
        if (!o.dryRun) {
          const blk = runNode('bugctl.mjs', ['block', `--id=${p.publicN}`, `--reason=meal-audit-loop: ${o.maxAttempts} attempts exhausted without a green compare; needs human triage`], { timeout: 60000 });
          if (blk.ok) recordAttempt(state, p.idemKey, { outcome: 'capped', at: new Date().toISOString() });
        }
      }
    }

    if (o.noDispatch || o.dryRun) {
      rec.outcome = 'diverged_no_dispatch';
      results.push(rec);
      continue;
    }

    // --- dispatch the PRIMARY card only (one defect per pass)
    const primary = dispatchable[0];
    if (!primary) {
      rec.outcome = 'all_capped';
      results.push(rec);
      continue;
    }

    // Post the plan FIRST: this is what makes the comparator the card's gate
    // rather than a generic bug-utils vitest that never reads the ledger.
    const planned = postPlan(primary.publicN, {
      bundleDir: bundle.bundleDir,
      actualPath: o.actual,
      taxonomy: primary.class,
      key: primary.key,
      dryRun: false,
    });
    rec.stages.plan = { posted: planned.ok, gate: planned.gate || null, stderr: planned.stderr || null };
    if (!planned.ok) {
      // Without a real gate the card would be closed on irrelevant evidence, so
      // refuse to dispatch rather than ship a loop that verifies the wrong thing.
      rec.error = `plan: ${planned.stderr || `exit ${planned.status}`}`;
      hardFailure = true;
      results.push(rec);
      continue;
    }
    const attempt = attemptsFor(state, primary.idemKey) + 1;
    // An incomplete audit must not start a coder: its cards would describe the
    // audit's own gaps, and re-verify could never go green against ground truth
    // that is missing the very keys it is scored on.
    const judge = auditIsDispatchable(bundle.bundleDir);
    if (!judge.ok) {
      rec.stages.dispatch = { card: primary.publicN, attempt, refused: true, reason: judge.reason };
      rec.error = `dispatch refused: ${judge.reason}`;
      results.push(rec);
      continue;
    }
    const d = dispatchCard(primary.publicN, { attempt, dryRun: false });
    rec.stages.dispatch = { card: primary.publicN, attempt, rung: d.rung, ok: d.ok, dryRun: !!d.dryRun };
    if (!d.ok) {
      rec.error = `dispatch: ${d.stderr || `exit ${d.status}`}`;
      if (attempt >= o.maxAttempts) {
        // Exhausted the ladder without a green verify — do not keep trying.
        runNode('bugctl.mjs', ['block', `--id=${primary.publicN}`, `--reason=meal-audit-loop: dispatch failed at attempt ${attempt}/${o.maxAttempts}`], { timeout: 60000 });
      }
      hardFailure = true;
      results.push(rec);
      continue;
    }

    recordAttempt(state, primary.idemKey, { attempt, publicN: primary.publicN, rung: d.rung, outcome: 'dispatched', at: new Date().toISOString() });
    rec.outcome = 'diverged_dispatched';

    // --- RE-VERIFY: wait for deploy, then re-score the SAME bundle.
    // The coder is the author; this is the independent QA lane.
    console.error(`[Loop] ${meal.mealId} -> dispatched #${primary.publicN} (attempt ${attempt}); waiting ${o.deployWait}s for rebuild.`);
    sleepSeconds(o.deployWait);
    const recheck = runComparison(bundle.bundleDir, { actualPath: o.actual, skip: false });
    rec.stages.reverify = { verdict: recheck.verdict, skipped: !!recheck.skipped, error: recheck.error || null };

    if (recheck.verdict === 'PASS') {
      rec.outcome = 'fixed';
      if (!o.dryRun) {
        // Only a non-author may post this; the loop never authored the fix.
        // The command posted is the SAME gate the plan recorded, so the card
        // closes on the evidence it was opened with.
        const v = runNode('bugctl.mjs', [
          'verify', `--id=${primary.publicN}`, '--result=green',
          `--command=${planned.gate}`,
          `--evidence=comparison.json`, '--by=qa_meal',
        ], { timeout: 60000 });
        rec.stages.verify = { posted: v.ok, status: v.status, stderr: v.stderr };
      }
      console.error(`[Loop] ${meal.mealId} -> FIXED and re-verified green.`);
    } else {
      rec.outcome = 'still_failing';
      console.error(`[Loop] ${meal.mealId} -> still ${recheck.verdict} after attempt ${attempt}. Next run escalates the ladder.`);
      if (attempt >= o.maxAttempts) {
        runNode('bugctl.mjs', ['block', `--id=${primary.publicN}`, `--reason=meal-audit-loop: ${attempt} attempts exhausted, still ${recheck.verdict}`], { timeout: 60000 });
        rec.blocked = true;
      }
    }
    results.push(rec);
  }

  if (!o.dryRun) saveState(state);

  const summary = {
    generatedAt: new Date().toISOString(),
    dryRun: o.dryRun,
    dispatch: !o.noDispatch && !o.dryRun,
    maxAttempts: o.maxAttempts,
    selected: meals.length,
    results,
    tally: results.reduce((a, r) => {
      const k = r.outcome || (r.error ? 'error' : 'unknown');
      a[k] = (a[k] || 0) + 1;
      return a;
    }, {}),
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  process.exit(hardFailure ? 1 : (o.dryRun && results.some((r) => r.outcome && r.outcome.startsWith('diverged')) ? 2 : 0));
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((e) => { console.error('[Loop] fatal:', e?.message || e); process.exit(3); });
}

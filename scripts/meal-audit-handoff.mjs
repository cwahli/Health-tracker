#!/usr/bin/env node
/**
 * scripts/meal-audit-handoff.mjs
 *
 * The MISSING MIDDLE of the meal QA loop.
 *
 * The loop resolves a saved meal, discovers it has no ground truth yet, and
 * reports `needs_audit`. Before this script that was where it stopped: nothing
 * told the meal-audit agent a meal was waiting, and nothing recorded that the
 * agent had finished. A human had to notice the log line and forward it. The
 * user asked for the loop to pass the meal to the audit agent for verification;
 * that handoff did not exist, and this is it.
 *
 * The design is a FILE queue with a claim/complete handshake, not a shared
 * in-memory step, because the loop and the agent run as separate processes at
 * different times (cron sweep vs a Telegram reply minutes later). A request is
 * durable, the agent can be woken by a push, and neither side can lose the
 * other's work if the other is mid-turn.
 *
 *   specs/meal-aa-loop/requests/<mealId>.request.json   what the agent must audit
 *   specs/meal-aa-loop/requests/<mealId>.claimed.json   agent took it (with at)
 *   specs/meal-aa-loop/requests/<mealId>.done.json      agent finished it
 *
 * Why under specs/ and not artifacts/: artifacts/ is gitignored (see
 * debugLogRetention's notes on it), so a request written there would be lost on
 * the next deploy and the loop would re-ask forever. specs/ is committed, so
 * every handoff is a durable record — the same reason the loop's attempt state
 * lives there.
 *
 * Three commands, one per actor:
 *
 *   enqueue   the LOOP writes a request for a meal it cannot audit itself
 *   claim     the AGENT marks it in-progress, so a second sweep will not re-ask
 *   complete  the AGENT records the finished bundle; the next sweep proceeds
 *
 * Plus `status`, because "is anything waiting on the agent" is the question a
 * human actually asks.
 *
 * Exit codes:
 *   0  the command did its job (for enqueue: a request is now pending)
 *   1  the command could not do its job (missing meal, bad path, not claimable)
 *   2  nothing to do — queue empty, or the request is already known
 *   3  usage error
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const QUEUE_DIR = path.join(REPO_ROOT, 'specs', 'meal-qa-loop', 'requests');

export const QUEUE_REL = 'specs/meal-qa-loop/requests';
/** A claim older than this is treated as abandoned, so a crashed agent does not
 *  strand a meal forever. Chosen to be far longer than one audit turn. */
export const CLAIM_TTL_MS = 6 * 60 * 60 * 1000;

export function requestPath(mealId) {
  return path.join(QUEUE_DIR, `${mealId}.request.json`);
}
export function claimPath(mealId) {
  return path.join(QUEUE_DIR, `${mealId}.claimed.json`);
}
export function donePath(mealId) {
  return path.join(QUEUE_DIR, `${mealId}.done.json`);
}

export function ensureQueueDir() {
  fs.mkdirSync(QUEUE_DIR, { recursive: true });
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function writeJson(p, obj) {
  ensureQueueDir();
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
  return p;
}

function nowIso() { return new Date().toISOString(); }

export function parseArgs(argv) {
  const o = {
    cmd: null, mealId: null, name: null, photos: null, skeleton: null,
    provenance: null, bundle: null, verdict: null, by: 'meal_audit',
    reason: null, notify: false, json: false, help: false, dir: null,
  };
  const first = argv[0];
  if (first && !first.startsWith('-')) o.cmd = first;
  for (const a of argv.slice(o.cmd ? 1 : 0)) {
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--json') o.json = true;
    else if (a === '--notify') o.notify = true;
    else if (a.startsWith('--meal-id=')) o.mealId = a.slice('--meal-id='.length).trim();
    else if (a.startsWith('--name=')) o.name = a.slice('--name='.length).trim();
    else if (a.startsWith('--photos=')) o.photos = a.slice('--photos='.length).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--skeleton=')) o.skeleton = a.slice('--skeleton='.length).trim();
    else if (a.startsWith('--provenance=')) o.provenance = a.slice('--provenance='.length).trim();
    else if (a.startsWith('--bundle=')) o.bundle = a.slice('--bundle='.length).trim();
    else if (a.startsWith('--verdict=')) o.verdict = a.slice('--verdict='.length).trim();
    else if (a.startsWith('--by=')) o.by = a.slice('--by='.length).trim();
    else if (a.startsWith('--reason=')) o.reason = a.slice('--reason='.length).trim();
    else { console.error(`Unknown argument: ${a}`); process.exit(3); }
  }
  return o;
}

function usage() {
  console.log(`
meal-audit-handoff — the loop's hand-off to the meal-audit agent.

  # LOOP: record a meal the audit agent must analyse
  node scripts/meal-audit-handoff.mjs enqueue --meal-id=meal_123 --name="Steak Salad" \\
    --provenance=photo_only --photos=/photos/a.jpg,/photos/b.jpg --skeleton=/abs/skeleton.json

  # AGENT: take it, then finish it
  node scripts/meal-audit-handoff.mjs claim    --meal-id=meal_123 --by=meal_audit
  node scripts/meal-audit-handoff.mjs complete --meal-id=meal_123 \\
    --bundle=/abs/artifacts/meal_audits/Meal-Salad-01 --verdict=audited --by=meal_audit

  # ANYONE: what is waiting?
  node scripts/meal-audit-handoff.mjs status [--json]

Notes:
  - Durable: requests live under ${QUEUE_REL} (committed). artifacts/ is
    gitignored, so a request written there would be lost on the next deploy and
    the loop would re-ask for the same meal forever.
  - Idempotent: enqueue on an already-pending meal is a no-op, not a duplicate.
  - A claim older than ${CLAIM_TTL_MS / 3600000}h is treated as abandoned, so a
    crashed agent cannot strand a meal.
  - --notify pings the agent on Telegram (requires scripts/telegram-send.sh).
`);
}

/**
 * Write a request for a meal. Returns { ok, action, path, request } where action
 * is 'created' | 'already_pending' | 'already_done'.
 */
export function enqueue(args) {
  const mealId = String(args.mealId || '').trim();
  if (!mealId) return { ok: false, error: '--meal-id required' };
  if (!/^[A-Za-z0-9_.-]+$/.test(mealId)) return { ok: false, error: `--meal-id has unsafe characters: ${mealId}` };

  if (fs.existsSync(donePath(mealId))) {
    return { ok: true, action: 'already_done', request: readJson(requestPath(mealId)) };
  }
  const existing = readJson(requestPath(mealId));
  if (existing) {
    return { ok: true, action: 'already_pending', request: existing, path: requestPath(mealId) };
  }

  const request = {
    schema: 'meal-audit-request/1',
    mealId,
    name: args.name || mealId,
    provenance: args.provenance || 'unknown',
    photos: args.photos || [],
    skeleton: args.skeleton || null,
    requestedAt: nowIso(),
    requestedBy: args.by || 'meal-audit-loop',
    status: 'pending',
    // The agent's contract, restated per request so it does not depend on having
    // read the SKILL: fill dishes[], keep the 32 nutrients, run the generator.
    instructions: [
      'Audit this meal and produce a ground-truth bundle.',
      'For each dish: dishName, weightGrams, boundingBox2D (0-1000, required because photos exist), and all 32 nutrient keys.',
      'Weight must come from the catalog (scripts/meal-audit-assist.mjs api:<query>) or a scale, never an eyeball estimate.',
      'Run scripts/generate-meal-result.mjs to write meal_result.json, then report the bundle path with `complete`.',
      'If the catalog cannot source a nutrient, the audit is INCOMPLETE: say so rather than filling zeros.',
      args.provenance === 'photo_only'
        ? 'PHOTO_ONLY: there is no edit history for this meal. Do NOT file turn_mismatch or edit_not_applied.'
        : null,
    ].filter(Boolean),
  };
  const p = writeJson(requestPath(mealId), request);
  return { ok: true, action: 'created', path: p, request };
}

/** Mark a pending request as in-progress. Fails loudly if it is not claimable. */
export function claim(args) {
  const mealId = String(args.mealId || '').trim();
  if (!mealId) return { ok: false, error: '--meal-id required' };
  if (!fs.existsSync(requestPath(mealId))) return { ok: false, error: `no request for ${mealId} — nothing to claim` };
  if (fs.existsSync(donePath(mealId))) return { ok: false, error: `${mealId} is already done` };

  const prior = readJson(claimPath(mealId));
  if (prior) {
    const age = Date.now() - Date.parse(prior.claimedAt || 0);
    if (Number.isFinite(age) && age < CLAIM_TTL_MS) {
      return { ok: false, error: `${mealId} is already claimed by ${prior.by} (${Math.round(age / 1000)}s ago)`, claim: prior };
    }
    // Abandoned: fall through and re-claim, but record why.
  }
  const claimed = { mealId, by: args.by || 'meal_audit', claimedAt: nowIso(), reclaimed: !!prior };
  const p = writeJson(claimPath(mealId), claimed);
  return { ok: true, action: prior ? 'reclaimed' : 'claimed', path: p, claim: claimed };
}

/**
 * Record a finished audit. `bundle` must exist on disk: a completion marker
 * pointing at a missing bundle would unblock the loop into a compare that cannot
 * run, which is worse than staying needs_audit.
 */
export function complete(args) {
  const mealId = String(args.mealId || '').trim();
  if (!mealId) return { ok: false, error: '--meal-id required' };
  if (!fs.existsSync(requestPath(mealId))) return { ok: false, error: `no request for ${mealId} — nothing to complete` };
  if (args.bundle && !fs.existsSync(args.bundle)) {
    return { ok: false, error: `--bundle does not exist: ${args.bundle}` };
  }
  const done = {
    mealId,
    by: args.by || 'meal_audit',
    bundle: args.bundle || null,
    verdict: args.verdict || 'audited',
    reason: args.reason || null,
    completedAt: nowIso(),
  };
  const p = writeJson(donePath(mealId), done);
  // The claim is spent; leaving it would make `status` look busy forever.
  try { fs.unlinkSync(claimPath(mealId)); } catch { /* already gone */ }
  return { ok: true, action: 'completed', path: p, done };
}

/** Everything waiting, in-progress, or finished. */
export function status() {
  ensureQueueDir();
  const files = fs.readdirSync(QUEUE_DIR).filter((f) => f.endsWith('.request.json'));
  const rows = files.map((f) => {
    const mealId = f.replace(/\.request\.json$/, '');
    const req = readJson(path.join(QUEUE_DIR, f)) || {};
    const claim = readJson(claimPath(mealId));
    const done = readJson(donePath(mealId));
    let state = 'pending';
    if (done) state = 'done';
    else if (claim) {
      const age = Date.now() - Date.parse(claim.claimedAt || 0);
      state = Number.isFinite(age) && age > CLAIM_TTL_MS ? 'abandoned' : 'claimed';
    }
    return { mealId, name: req.name || mealId, provenance: req.provenance, state, by: (claim && claim.by) || (done && done.by) || null, bundle: (done && done.bundle) || null };
  });
  const tally = rows.reduce((a, r) => { a[r.state] = (a[r.state] || 0) + 1; return a; }, {});
  return { dir: QUEUE_REL, counts: tally, total: rows.length, rows };
}

/**
 * Best-effort Telegram nudge so the agent does not have to be polled by a human.
 * Returns { sent, reason } — never throws, because a missing token must not fail
 * the loop's sweep: the durable request file is the actual hand-off, the ping is
 * only a convenience.
 */
export function notifyAgent(request) {
  const script = path.join(REPO_ROOT, 'scripts', 'telegram-send.sh');
  if (!fs.existsSync(script)) return { sent: false, reason: 'telegram-send.sh not present' };
  const text = [
    '🔬 *Meal audit request queued*',
    `• Meal: ${request.name} (${request.mealId})`,
    `• Provenance: ${request.provenance}`,
    `• Photos: ${(request.photos || []).length}`,
    `• Request: ${path.relative(REPO_ROOT, requestPath(request.mealId))}`,
    '',
    'Claim it, audit it, then report the bundle:',
    `node scripts/meal-audit-handoff.mjs claim --meal-id=${request.mealId}`,
  ].join('\n');
  const r = spawnSync('bash', [script, '--profile=meal_audit', `--text=${text}`], {
    encoding: 'utf8', cwd: REPO_ROOT, timeout: 30000,
  });
  if (r.status !== 0) {
    return { sent: false, reason: `telegram-send exit ${r.status}: ${(r.stderr || r.stdout || '').slice(0, 200)}` };
  }
  return { sent: true };
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !o.cmd) { usage(); process.exit(o.cmd ? 0 : 3); }

  let res;
  switch (o.cmd) {
    case 'enqueue': res = enqueue(o); break;
    case 'claim': res = claim(o); break;
    case 'complete': res = complete(o); break;
    case 'status': res = { ok: true, ...status() }; break;
    default:
      console.error(`Unknown command '${o.cmd}'. Try enqueue | claim | complete | status.`);
      process.exit(3);
  }

  if (!res.ok) {
    if (o.json) console.log(JSON.stringify(res, null, 2));
    else console.error(`[handoff] ${res.error}`);
    process.exit(1);
  }

  if (o.json) console.log(JSON.stringify(res, null, 2));
  else if (o.cmd === 'status') {
    console.log(`[handoff] ${res.total} request(s) in ${res.dir}`);
    for (const r of res.rows) console.log(`  ${r.state.padEnd(10)} ${r.mealId}  ${r.name}${r.bundle ? '  -> ' + r.bundle : ''}`);
  } else if (o.cmd === 'enqueue') {
    console.log(`[handoff] ${res.action}: ${res.request ? res.request.mealId : ''}`);
    if (o.notify && res.action === 'created') {
      const n = notifyAgent(res.request);
      console.log(`[handoff] agent ping: ${n.sent ? 'sent' : 'skipped — ' + n.reason}`);
    }
  } else {
    console.log(`[handoff] ${res.action}: ${o.mealId}`);
  }

  if (o.cmd === 'status' && res.total === 0) process.exit(2);
  if (o.cmd === 'enqueue' && res.action !== 'created') process.exit(2);
  process.exit(0);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();

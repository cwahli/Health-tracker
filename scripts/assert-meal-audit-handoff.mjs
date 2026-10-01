#!/usr/bin/env node
/**
 * scripts/assert-meal-audit-handoff.mjs
 *
 * Hashimoto ratchet for the hand-off to the meal-audit agent.
 *
 * The regression this prevents is the one the user named: the loop reporting
 * `needs_audit` forever with nothing queued for the agent that does the
 * auditing. Before this existed, `meal-audit-loop.mjs` stopped at a log line and
 * a human had to notice it and forward the meal by hand. The loop's own gate
 * could not catch that, because the missing hand-off made the loop look correct
 * — it just never progressed past needs_audit.
 *
 * So the assertions are about the handshake, not about nutrition:
 *   - a needs_audit meal ALWAYS produces a durable request
 *   - the request is idempotent, so a second sweep does not re-ask
 *   - a claim blocks a second agent from taking the same meal
 *   - completion is refused when the bundle does not exist
 *   - a completed hand-off makes the loop USE the audited bundle rather than
 *     re-fetching an empty skeleton (the bug that made completion useless)
 *   - the request carries the photos, so the agent can actually see the meal
 *
 * Exit 0 = pass. Offline: no network, no Playwright, no dispatch.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

let pass = 0;
let fail = 0;
const failures = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meal-handoff-'));

// Point the queue at scratch space BEFORE the module is loaded, hence the
// dynamic import. The queue under specs/ is live state: real meals, waiting on a
// real audit. These fixtures used to be written straight into it and then cleared
// wholesale, so running this file deleted whatever was genuinely queued — which
// is how three pending meals disappeared from an otherwise healthy run and looked
// like a queue defect. QUEUE_REL is still exported and asserted below, so the
// scratch directory proves nothing about where the real queue lives.
let SCRATCH_QUEUE = path.join(tmp, 'queue');
fs.mkdirSync(SCRATCH_QUEUE, { recursive: true });
process.env.MEAL_QA_QUEUE_DIR = SCRATCH_QUEUE;

const {
  enqueue, claim, complete, status,
  QUEUE_REL, CLAIM_TTL_MS,
} = await import('./meal-audit-handoff.mjs');
const { handOffToAuditAgent, listBundlePhotos, readSkeletonPhotos, obtainBundle } = await import('./meal-audit-loop.mjs');

function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, message: e?.message || String(e) });
    console.log(`  FAIL ${name}\n       ${e?.message || e}`);
  }
}

function clearQueue() {
  // Scratch only, and it refuses to run against the real queue even if the env
  // override is ever dropped. A test that silently empties production state is
  // worse than no test, so this is the one place allowed to delete anything.
  const real = path.join(REPO_ROOT, QUEUE_REL);
  if (path.resolve(SCRATCH_QUEUE) === path.resolve(real)) {
    throw new Error(`refusing to clear the real queue at ${real} — set MEAL_QA_QUEUE_DIR`);
  }
  if (!fs.existsSync(SCRATCH_QUEUE)) return;
  for (const f of fs.readdirSync(SCRATCH_QUEUE)) fs.unlinkSync(path.join(SCRATCH_QUEUE, f));
}

console.log('assert-meal-audit-handoff — the loop hands off to the audit agent\n');

// --- durability ---------------------------------------------------------------

check('requests live under specs/, not artifacts/ (artifacts is gitignored)', () => {
  assert.ok(!QUEUE_REL.includes('artifacts/'),
    'a request under artifacts/ would be lost on the next deploy and the loop would re-ask forever');
  const ignored = spawnSync('git', ['check-ignore', '-q', 'artifacts/meal_audits/x.json'],
    { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(ignored.status, 0, 'expected artifacts/ to be gitignored in this repo');
});

// --- enqueue ------------------------------------------------------------------

check('enqueue writes a request with the audit contract inlined', () => {
  clearQueue();
  const r = enqueue({ mealId: 'meal_gate_1', name: 'Gate Salad', provenance: 'photo_only', photos: ['/photos/a.jpg'] });
  assert.equal(r.ok, true);
  assert.equal(r.action, 'created');
  assert.ok(fs.existsSync(r.path), 'request file must exist on disk');
  const req = r.request;
  assert.equal(req.schema, 'meal-audit-request/1');
  assert.equal(req.status, 'pending');
  // The agent must be able to act from the request alone, without having read
  // the SKILL, so the hard requirements are stated inline.
  const text = req.instructions.join(' ');
  assert.match(text, /boundingBox2D/, 'bbox requirement must be in the request');
  assert.match(text, /32 nutrient/, 'the 32-nutrient contract must be in the request');
  assert.match(text, /PHOTO_ONLY|no edit history/i,
    'a photo_only request must bar edit-history findings');
});

check('enqueue is idempotent — a second sweep does not re-ask', () => {
  clearQueue();
  const a = enqueue({ mealId: 'meal_gate_2', name: 'X', provenance: 'debug_payload' });
  const b = enqueue({ mealId: 'meal_gate_2', name: 'X', provenance: 'debug_payload' });
  assert.equal(a.action, 'created');
  assert.equal(b.action, 'already_pending');
});

check('enqueue refuses a meal id with path separators (no traversal)', () => {
  const r = enqueue({ mealId: '../../etc/passwd' });
  assert.equal(r.ok, false);
  assert.match(r.error, /unsafe characters/);
});

check('enqueue on an already-audited meal reports already_done', () => {
  clearQueue();
  const dir = path.join(tmp, 'bundle_done');
  fs.mkdirSync(dir, { recursive: true });
  enqueue({ mealId: 'meal_gate_3', name: 'X', provenance: 'debug_payload' });
  complete({ mealId: 'meal_gate_3', bundle: dir });
  const r = enqueue({ mealId: 'meal_gate_3', name: 'X', provenance: 'debug_payload' });
  assert.equal(r.action, 'already_done');
});

// --- claim --------------------------------------------------------------------

check('claim succeeds once and then blocks a second agent', () => {
  clearQueue();
  enqueue({ mealId: 'meal_gate_4', name: 'X', provenance: 'debug_payload' });
  const a = claim({ mealId: 'meal_gate_4', by: 'agentA' });
  const b = claim({ mealId: 'meal_gate_4', by: 'agentB' });
  assert.equal(a.ok, true);
  assert.equal(a.action, 'claimed');
  assert.equal(b.ok, false, 'a second agent must not take the same meal');
  assert.match(b.error, /already claimed by agentA/);
});

check('claim fails loudly for a meal nobody queued', () => {
  const r = claim({ mealId: 'meal_never_queued_xyz' });
  assert.equal(r.ok, false);
  assert.match(r.error, /nothing to claim/);
});

check('an abandoned claim is reclaimable (a crashed agent must not strand a meal)', () => {
  clearQueue();
  enqueue({ mealId: 'meal_gate_5', name: 'X', provenance: 'debug_payload' });
  claim({ mealId: 'meal_gate_5', by: 'crashed' });
  // Backdate the claim past the TTL rather than waiting six hours.
  const p = path.join(SCRATCH_QUEUE, 'meal_gate_5.claimed.json');
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  c.claimedAt = new Date(Date.now() - CLAIM_TTL_MS - 60000).toISOString();
  fs.writeFileSync(p, JSON.stringify(c, null, 2));
  const r = claim({ mealId: 'meal_gate_5', by: 'fresh' });
  assert.equal(r.ok, true);
  assert.equal(r.action, 'reclaimed');
});

check('status reports an expired claim as abandoned, not busy', () => {
  const row = status().rows.find((r) => r.mealId === 'meal_gate_5');
  assert.ok(row, 'the claimed meal must appear in status');
  assert.ok(['claimed', 'abandoned'].includes(row.state), `unexpected state ${row.state}`);
});

// --- complete -----------------------------------------------------------------

check('complete is REFUSED when the bundle does not exist', () => {
  clearQueue();
  enqueue({ mealId: 'meal_gate_6', name: 'X', provenance: 'debug_payload' });
  const r = complete({ mealId: 'meal_gate_6', bundle: '/no/such/bundle' });
  assert.equal(r.ok, false,
    'a completion pointing at a missing bundle would unblock the loop into a compare that cannot run');
  assert.match(r.error, /does not exist/);
});

check('complete records the bundle and spends the claim', () => {
  clearQueue();
  const dir = path.join(tmp, 'bundle_ok');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meal_result.json'), '{}');
  enqueue({ mealId: 'meal_gate_7', name: 'X', provenance: 'debug_payload' });
  claim({ mealId: 'meal_gate_7', by: 'meal_audit' });
  const r = complete({ mealId: 'meal_gate_7', bundle: dir, verdict: 'audited' });
  assert.equal(r.ok, true);
  const row = status().rows.find((x) => x.mealId === 'meal_gate_7');
  assert.equal(row.state, 'done');
  assert.equal(row.bundle, dir);
  // The claim file must be gone, or status would look busy forever.
  assert.ok(!fs.existsSync(path.join(SCRATCH_QUEUE, 'meal_gate_7.claimed.json')),
    'a spent claim must be cleared');
});

// --- the loop integration (the regression the user actually hit) --------------

check('a needs_audit meal is handed off, not just logged', () => {
  clearQueue();
  const meal = { mealId: 'meal_gate_8', name: 'Gate Meal', provenance: 'debug_payload', photos: [] };
  const bundle = { bundleDir: path.join(tmp, 'b8'), skeleton: null, photos: [] };
  const h = handOffToAuditAgent(meal, bundle, { dryRun: false, notify: false });
  assert.equal(h.ok, undefined);
  assert.equal(h.action, 'created', `expected a queued request, got ${JSON.stringify(h)}`);
  const row = status().rows.find((r) => r.mealId === 'meal_gate_8');
  assert.ok(row, 'the meal must appear in the queue');
  assert.equal(row.state, 'pending');
});

check('a second sweep reports already_pending instead of re-queueing', () => {
  const meal = { mealId: 'meal_gate_8', name: 'Gate Meal', provenance: 'debug_payload', photos: [] };
  const h = handOffToAuditAgent(meal, { bundleDir: path.join(tmp, 'b8'), photos: [] }, { dryRun: false });
  assert.equal(h.action, 'already_pending');
  assert.equal(h.state, 'pending');
});

check('dry-run never writes a request', () => {
  clearQueue();
  const h = handOffToAuditAgent(
    { mealId: 'meal_gate_9', name: 'Dry', provenance: 'debug_payload' },
    { bundleDir: path.join(tmp, 'b9'), photos: [] },
    { dryRun: true }
  );
  assert.equal(h.action, 'dry_run');
  assert.equal(status().total, 0, 'a dry-run must leave the queue empty');
});

check('REGRESSION: a completed hand-off makes the loop USE the audited bundle', () => {
  // This is the bug that made the hand-off useless: the loop rebuilt an empty
  // skeleton every sweep, so the agent's finished audit was never compared and
  // the meal reported needs_audit forever.
  clearQueue();
  const audited = path.join(tmp, 'bundle_audited');
  fs.mkdirSync(audited, { recursive: true });
  fs.writeFileSync(path.join(audited, 'meal_result.json'), '{"passes":[{"dishes":[]}]}');
  enqueue({ mealId: 'meal_gate_10', name: 'Audited', provenance: 'debug_payload' });
  complete({ mealId: 'meal_gate_10', bundle: audited });

  const b = obtainBundle({ mealId: 'meal_gate_10', provenance: 'debug_payload', jobId: 'job_x' }, {
    outputDir: path.join(tmp, 'out10'), dryRun: false,
  });
  assert.equal(b.ok, true);
  assert.equal(b.bundleDir, audited, 'the loop must adopt the agent\'s bundle');
  assert.equal(b.audited, true);
  assert.match(b.note, /meal-audit agent/);
});

check('an unfinished hand-off does NOT short-circuit the fetch', () => {
  clearQueue();
  enqueue({ mealId: 'meal_gate_11', name: 'Pending', provenance: 'photo_only' });
  // No bundle recorded, so the loop must still do its own resolution work.
  const h = handOffToAuditAgent(
    { mealId: 'meal_gate_11', name: 'Pending', provenance: 'photo_only' },
    { bundleDir: path.join(tmp, 'b11'), photos: [] },
    { dryRun: false }
  );
  assert.equal(h.action, 'already_pending');
  assert.notEqual(h.action, 'already_done');
});

// --- the request must be actionable ------------------------------------------

check('the request carries the photos, or the agent cannot see the meal', () => {
  clearQueue();
  // listBundlePhotos scans a bundle's photos/ subdirectory, which is where both
  // the fetcher and the photo-only resolver put downloaded images.
  const bundleDir = path.join(tmp, 'bundle_photos');
  const photoDir = path.join(bundleDir, 'photos');
  fs.mkdirSync(photoDir, { recursive: true });
  fs.writeFileSync(path.join(photoDir, 'a.jpg'), 'x');
  const found = listBundlePhotos(bundleDir);
  assert.equal(found.length, 1, 'downloaded photos must be discovered');
  assert.ok(found[0].startsWith('/'), 'photo paths must be absolute');
  assert.ok(fs.existsSync(found[0]), 'the discovered photo must exist on disk');
});

check('skeleton-relative photos are resolved to fetchable URLs', () => {
  const skelPath = path.join(tmp, 'skel.json');
  fs.writeFileSync(skelPath, JSON.stringify({
    passes: [{ addedPhotos: ['/photos/x.jpg', 'https://pub-x.r2.dev/photos/y.jpg'] }],
  }));
  const out = readSkeletonPhotos(skelPath);
  assert.equal(out.length, 2);
  assert.ok(out[0].startsWith('http'), 'a server-relative photo must become a URL');
  assert.ok(out[1].startsWith('https://pub-x.r2.dev/'), 'an absolute photo must pass through');
});

// --- CLI ----------------------------------------------------------------------

check('CLI status on an empty queue exits 2 (nothing waiting, not an error)', () => {
  clearQueue();
  const r = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'meal-audit-handoff.mjs'), 'status'],
    { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 2, `expected 2, got ${r.status}`);
});

check('CLI claim on an unknown meal exits 1 and says why', () => {
  const r = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'meal-audit-handoff.mjs'),
    'claim', '--meal-id=meal_nope_xyz'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /nothing to claim/);
});

check('the loop script exposes the hand-off (it is wired, not orphaned)', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'meal-audit-loop.mjs'), 'utf8');
  assert.match(src, /from '\.\/meal-audit-handoff\.mjs'/, 'the loop must import the handoff');
  assert.match(src, /handOffToAuditAgent/, 'the loop must call it');
  // And it must be called at the needs_audit point, not somewhere unreachable.
  // Search from the needs_audit branch onward so the helper's own `export
  // function` definition above the sweep cannot be mistaken for the call site.
  const needsIdx = src.indexOf("NO_GROUND_TRUTH: 'needs_audit'");
  assert.ok(needsIdx > -1, 'the needs_audit branch must exist');
  const callIdx = src.indexOf('handOffToAuditAgent(meal, bundle', needsIdx);
  assert.ok(callIdx > -1, 'the hand-off must be called after the needs_audit branch');
  // Guard the whole point: the call must be conditional on needs_audit, so it
  // cannot fire for a meal that already has ground truth.
  const between = src.slice(needsIdx, callIdx);
  assert.match(between, /if \(rec\.outcome === 'needs_audit'\)/,
    'the hand-off must be guarded by the needs_audit outcome');
});

// The test suite must not be able to destroy live queue state. This is the
// regression that made three pending meals vanish mid-run: the gate wrote its
// fixtures into the real queue and clearQueue() unlinked every file in it,
// including .gitkeep, so the directory stopped existing in git at all.
check('the gate runs against a SCRATCH queue, never the live one', () => {
  const real = path.join(REPO_ROOT, QUEUE_REL);
  assert.notEqual(path.resolve(SCRATCH_QUEUE), path.resolve(real),
    'the fixtures must not share the production queue directory');
  assert.equal(process.env.MEAL_QA_QUEUE_DIR, SCRATCH_QUEUE,
    'MEAL_QA_QUEUE_DIR must be set before the handoff module is imported');
  assert.ok(!SCRATCH_QUEUE.startsWith(real + path.sep),
    'scratch queue must live outside the real queue entirely');
});

check('clearQueue refuses to run against the real queue', () => {
  const real = path.join(REPO_ROOT, QUEUE_REL);
  const original = process.env.MEAL_QA_QUEUE_DIR;
  // Prove the guard is live by pointing the scratch dir at the real queue and
  // calling the helper: it must throw rather than empty it.
  const prevScratch = SCRATCH_QUEUE;
  try {
    // eslint-disable-next-line no-global-assign
    SCRATCH_QUEUE = real;
    assert.throws(() => clearQueue(), /refusing to clear the real queue/,
      'clearQueue must refuse the production queue');
  } finally {
    SCRATCH_QUEUE = prevScratch;
    process.env.MEAL_QA_QUEUE_DIR = original;
  }
});

// The durability claim, checked against git rather than against intent.
//
// The queue lives under specs/ precisely because artifacts/ is gitignored: a
// request written there is lost on the next deploy and the loop re-asks for the
// same meal forever. That is only true while specs/meal-qa-loop/requests/ is
// itself TRACKED. It was not — state.json was committed, but the requests
// directory held no tracked file, so a fresh checkout had no queue at all and a
// `git clean` erased live requests in place. Three queued meals vanished that way
// mid-run on 2026-09-30, which looked exactly like a queue bug.
check('the queue DIRECTORY is tracked by git, so the durability claim is real', () => {
  const out = spawnSync('git', ['ls-files', 'specs/meal-qa-loop/requests/'], {
    cwd: REPO_ROOT, encoding: 'utf8',
  });
  const tracked = (out.stdout || '').trim();
  assert.equal(out.status, 0, 'git ls-files must run');
  assert.ok(tracked.length > 0,
    'specs/meal-qa-loop/requests/ has no tracked file, so a fresh checkout has no queue '
    + 'and a git clean deletes live requests — the reason it lives under specs/');
});

clearQueue();
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
process.exit(0);

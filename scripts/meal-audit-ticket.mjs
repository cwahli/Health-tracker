#!/usr/bin/env node
/**
 * scripts/meal-audit-ticket.mjs
 *
 * Phase 2 of the meal QA loop — the MISSING MIDDLE.
 *
 * Today `meal-audit-compare.mjs --ledger` writes a FAIL row into
 * artifacts/meal_audits/issue_ledger.jsonl ... and then nothing consumes it. The
 * meal-audit-engine SKILL says to "append a line to issue_ledger.jsonl and (if
 * asked) hand a V-29 ticket to @Orchestrator" — prose only. `grep` confirms no
 * script ever calls bugctl from the ledger, so every divergence between ground
 * truth and the live site stops at a JSONL file nobody reads. That is the single
 * structural gap that makes a closed loop impossible.
 *
 * This is the bridge. It turns comparison.json findings into canonical bug cards
 * via the existing `bugctl` CLI, which remains the only writer to the D1 store.
 * It does not talk to D1 directly and it does not invent a second state owner.
 *
 * Design rules honoured:
 *   - ONE defect per card. A comparison typically carries several drifts; they are
 *     split into N cards, never bundled. (bot-pack looksBundled would reject a
 *     bundle anyway — this makes that structural rather than incidental.)
 *   - `criteria` is a MECHANICAL named gate, not prose: the exact
 *     meal-audit-compare.mjs invocation that must exit 0 on that bundle.
 *   - Idempotent on (bundle, taxonomy, key) via --idem-key, so re-running after a
 *     failed fix reuses the card instead of spamming duplicates.
 *   - photo_only bundles never emit turn_mismatch / edit_not_applied cards: that
 *     provenance structurally cannot observe edit history.
 *
 * Exit codes:
 *   0  at least one card created or reused
 *   1  a card failed bugctl validation (nothing posted)
 *   2  nothing to file (PASS, or no failures)
 *   3  usage / config error
 *
 * Usage:
 *   node scripts/meal-audit-ticket.mjs --bundle=artifacts/meal_audits/Meal-X-01
 *   node scripts/meal-audit-ticket.mjs --bundle=... --actual=qa-evidence/actual_meal.json
 *   node scripts/meal-audit-ticket.mjs --bundle=... --dry-run
 *   node scripts/meal-audit-ticket.mjs --plan-from=artifacts/meal_audits/Meal-X-01
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packCheck, fingerprint } from './lib/bug-pack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

/**
 * taxonomy code -> the component area that owns it. These mirror the 8 codes in
 * the meal-audit SKILL taxonomy and map onto real pipeline stages.
 */
export const TAXONOMY_COMPONENT = {
  name_mismatch: 'Vision/Scout Pipeline',
  ocr_error: 'Vision/Scout Pipeline',
  portion_bias: 'Vision/Scout Pipeline',
  bbox_drift: 'Vision/Scout Pipeline',
  core_nutrient_drift: 'Dietitian/Nutrient Compiler',
  micro_nutrient_drift: 'Dietitian/Nutrient Compiler',
  edit_not_applied: 'Meal Edit Pipeline',
  turn_mismatch: 'Job Session Turn Timeline',
};

/**
 * Component used when the comparator emits a code this bridge does not know yet.
 * A new taxonomy code must still become a card rather than vanishing.
 */
export const FALLBACK_COMPONENT = 'Meal Audit Pipeline (unmapped taxonomy)';

/**
 * Codes that require observable multi-turn edit history. A photo_only bundle has
 * none, so filing these would be an unfalsifiable claim.
 */
export const EDIT_HISTORY_CODES = new Set(['edit_not_applied', 'turn_mismatch']);

/** Severity ordering — most structural first, mirroring the comparator's primaryCode. */
export const CODE_ORDER = [
  'turn_mismatch',
  'edit_not_applied',
  'name_mismatch',
  'ocr_error',
  'core_nutrient_drift',
  'portion_bias',
  'bbox_drift',
  'micro_nutrient_drift',
];

export function parseArgs(argv) {
  const o = { bundle: null, actual: null, dryRun: false, planFrom: null, json: false, help: false };
  for (const a of argv) {
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--json') o.json = true;
    else if (a.startsWith('--bundle=')) o.bundle = a.slice('--bundle='.length).trim();
    else if (a.startsWith('--actual=')) o.actual = a.slice('--actual='.length).trim();
    else if (a.startsWith('--plan-from=')) o.planFrom = a.slice('--plan-from='.length).trim();
    else { console.error(`Unknown argument: ${a}`); process.exit(3); }
  }
  return o;
}

function usage() {
  console.log(`
Meal Audit Ticket Bridge — comparison.json findings -> canonical bug cards.

Usage:
  node scripts/meal-audit-ticket.mjs --bundle=<bundleDir>
  node scripts/meal-audit-ticket.mjs --bundle=<bundleDir> --actual=<actual.json>
  node scripts/meal-audit-ticket.mjs --plan-from=<bundleDir>
  node scripts/meal-audit-ticket.mjs --bundle=<bundleDir> --dry-run

Notes:
  - ONE defect per card (V-29). Multiple findings are split, never bundled.
  - criteria is the exact meal-audit-compare.mjs command that must exit 0.
  - Idempotent per (bundle, taxonomy, key); re-runs reuse the existing card.
  - photo_only bundles never file turn_mismatch / edit_not_applied.
  - Exit 2 = nothing to file (PASS or zero failures); not an error.
`);
}

export function readComparison(bundleDir) {
  const p = path.join(bundleDir, 'comparison.json');
  if (!fs.existsSync(p)) throw new Error(`comparison.json not found in ${bundleDir} — run meal-audit-compare.mjs first.`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function bundleProvenance(bundleDir) {
  // A photo_only skeleton writes mode=photo_only_single_turn; the generator copies
  // it onto the bundle. Fall back to Instruction.md if the ledger omits it.
  const mr = path.join(bundleDir, 'meal_result.json');
  if (fs.existsSync(mr)) {
    try {
      const j = JSON.parse(fs.readFileSync(mr, 'utf8'));
      const mode = j.mode || (j.passes && j.passes.length === 1 ? 'single_audit' : 'multi_turn_flow');
      if (String(mode).includes('photo_only')) return 'photo_only';
      if (j.passes && j.passes.length <= 1) return 'single_turn';
      return 'multi_turn';
    } catch { /* fall through */ }
  }
  return 'unknown';
}

function fmt(v) {
  if (v === null || v === undefined) return 'absent';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

/**
 * Turn ONE comparator failure into exactly one card payload.
 * Kept pure so the gate can assert single-defect discipline without a store.
 */
export function failureToCard(failure, { bundleDir, bundleName, provenance, actualPath }) {
  const taxonomy = String(failure.taxonomy || 'other');
  const key = String(failure.key || 'unknown');
  // A new comparator code must never be silently dropped: fall back to a
  // generic component so the finding still becomes a card and gets triaged.
  const component = TAXONOMY_COMPONENT[taxonomy] || FALLBACK_COMPONENT;

  const deltaTxt = failure.deltaPct == null
    ? 'n/a'
    : `${Number(failure.deltaPct).toFixed(1)}% drift vs ${Number(failure.tolerance)}% tolerance`;

  // One observed sentence, one expected sentence. No lists — looksBundled rejects
  // enumerated text, and that is the point.
  const observed = `${taxonomy} on ${key}: ground truth ${fmt(failure.expected)}, live site produced ${fmt(failure.actual)} (${deltaTxt}) in bundle ${bundleName}.`;
  const expected = `${key} matches the audited ground truth ${fmt(failure.expected)} within the ${fmt(failure.tolerance)}% tolerance for this taxonomy.`;

  // The mechanical exit condition for this ticket.
  const actualArg = actualPath ? ` --actual="${actualPath}"` : '';
  const criteria = `node scripts/meal-audit-compare.mjs --bundle="${bundleDir}"${actualArg} exits 0 with zero ${taxonomy} findings on ${key}`;

  const idemKey = `meal-audit|${bundleName}|${taxonomy}|${key}`;

  return {
    title: `[meal-audit] ${taxonomy} on ${key} in ${bundleName}`,
    component,
    observed,
    expected,
    criteria,
    class: taxonomy,
    surface: 'meal',
    source: 'meal-audit',
    idemKey,
    fingerprint: fingerprint(taxonomy, `${bundleName} ${key}`),
    taxonomy,
    key,
  };
}

/** Order findings most-structural-first so the primary card is the useful one. */
export function orderFailures(failures) {
  return [...(failures || [])].sort(
    (a, b) => CODE_ORDER.indexOf(a.taxonomy) - CODE_ORDER.indexOf(b.taxonomy)
  );
}

export function planCards(comparison, { bundleDir, provenance, actualPath }) {
  const bundleName = (comparison?.harness?.bundleName) || path.basename(path.resolve(bundleDir));
  const all = Array.isArray(comparison?.failures) ? comparison.failures : [];

  const suppressed = [];
  const eligible = [];
  for (const f of orderFailures(all)) {
    const taxonomy = String(f.taxonomy || 'other');
    if (provenance === 'photo_only' && EDIT_HISTORY_CODES.has(taxonomy)) {
      // Structurally unobservable here. Filing it would be a claim we cannot test.
      suppressed.push({
        taxonomy,
        key: f.key,
        reason: 'photo_only bundle has no edit history — turn_mismatch/edit_not_applied is not observable and must not be filed from it',
      });
      continue;
    }
    eligible.push(f);
  }

  const cards = eligible.map((f) => failureToCard(f, { bundleDir, bundleName, provenance, actualPath }));
  return { bundleName, provenance, cards, suppressed, failureCount: all.length };
}

function runBugctl(args, { dryRun }) {
  if (dryRun) return { status: 0, stdout: '{}', stderr: '', dryRun: true };
  const r = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'bugctl.mjs'), ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', dryRun: false };
}

function parseJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { usage(); process.exit(0); }

  const bundleDir = o.planFrom || o.bundle;
  if (!bundleDir) { usage(); process.exit(3); }
  const absBundle = path.resolve(bundleDir);
  if (!fs.existsSync(absBundle)) {
    console.error(`[Ticket] bundle not found: ${absBundle}`);
    process.exit(3);
  }

  let comparison;
  try { comparison = readComparison(absBundle); } catch (e) {
    console.error(`[Ticket] ${e.message}`);
    process.exit(3);
  }

  const provenance = bundleProvenance(absBundle);
  const actualPath = o.actual || null;
  const plan = planCards(comparison, { bundleDir: absBundle, provenance, actualPath });

  if (plan.suppressed.length > 0) {
    console.error(`[Ticket] suppressed ${plan.suppressed.length} finding(s) not observable in a ${provenance} bundle:`);
    for (const s of plan.suppressed) console.error(`  - ${s.taxonomy} on ${s.key}: ${s.reason}`);
  }

  if (plan.cards.length === 0) {
    const verdict = comparison.verdict || 'UNKNOWN';
    console.error(`[Ticket] nothing to file (verdict=${verdict}, findings=${plan.failureCount}).`);
    if (o.json) process.stdout.write(JSON.stringify({ ...plan, posted: [] }, null, 2) + '\n');
    process.exit(2);
  }

  // Validate every card locally BEFORE posting anything, so a malformed payload
  // cannot half-file a bundle of defects.
  const invalid = [];
  for (const c of plan.cards) {
    const chk = packCheck(c);
    if (!chk.ok) invalid.push({ title: c.title, error: chk.error });
  }
  if (invalid.length > 0) {
    console.error('[Ticket] packCheck rejected the generated cards — nothing posted:');
    for (const i of invalid) console.error(`  - ${i.title}: ${i.error}`);
    process.exit(1);
  }

  const posted = [];
  for (const c of plan.cards) {
    const created = runBugctl([
      'create',
      `--title=${c.title}`,
      `--surface=${c.surface}`,
      `--class=${c.class}`,
      '--assignee=orchestrator',
      `--source=${c.source}`,
      `--idem-key=${c.idemKey}`,
    ], { dryRun: o.dryRun });

    let createdJson = parseJson(created.stdout);
    const id = createdJson?.tag_id || createdJson?.id || createdJson?.public_n;

    if (created.status !== 0 && !id) {
      console.error(`[Ticket] create failed for ${c.idemKey}: ${created.stderr || created.stdout}`);
      posted.push({ ...c, created: false, error: created.stderr || created.stdout });
      continue;
    }

    // Idempotency: bugctl returns an existing tag when the idem-key was seen.
    const reused = createdJson?.deduped || createdJson?.existing === true;
    let packed = null;
    if (!reused || o.dryRun) {
      const packRes = runBugctl([
        'pack',
        `--id=${id}`,
        `--component=${c.component}`,
        `--observed=${c.observed}`,
        `--expected=${c.expected}`,
        `--criteria=${c.criteria}`,
        `--class=${c.class}`,
        `--surface=${c.surface}`,
        `--idem-key=${c.idemKey}`,
      ], { dryRun: o.dryRun });
      packed = parseJson(packRes.stdout);
      if (packRes.status !== 0) {
        console.error(`[Ticket] pack failed for ${c.idemKey}: ${packRes.stderr || packRes.stdout}`);
      }
    }

    posted.push({
      ...c,
      created: true,
      id,
      publicN: createdJson?.public_n ?? null,
      deduped: !!reused,
      packed: !!packed,
      next: `bash scripts/run-coding-dispatch.sh --ticket=#${createdJson?.public_n ?? id} --profile=orchestrator`,
    });
    console.error(
      `[Ticket] ${reused ? 'reused' : 'created'} ${c.idemKey} -> ${createdJson?.public_n ?? id}` +
      (o.dryRun ? ' (dry-run)' : '')
    );
  }

  const result = { ...plan, dryRun: o.dryRun, posted };
  if (o.json || !o.dryRun) process.stdout.write(JSON.stringify(result, null, 2) + '\n');

  const anyCreated = posted.some((p) => p.created);
  process.exit(anyCreated ? 0 : 1);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((e) => { console.error('[Ticket] fatal:', e?.message || e); process.exit(3); });
}

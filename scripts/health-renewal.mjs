#!/usr/bin/env node
/**
 * health-renewal.mjs — the monthly renewal of the brief's four documents.
 *
 * The charter promises the four living documents renew on a monthly cadence.
 * Nothing scheduled that: they only ever refreshed when someone asked in
 * Telegram. This runner is the schedule, and it is deliberately NOT a second
 * publisher — it decides whether a renewal is due and, when it is, calls the
 * one refresh path that already exists (`runHealthRefresh`), which verifies
 * first, publishes in place by doc id, and records its usual receipt
 * (`result/health-refresh.json` + `result/health-refresh.md`).
 *
 * WHEN IT RENEWS, AND WHY THAT IS THE WHOLE RULE
 * ----------------------------------------------
 * A renewal is due when a **current snapshot has not been published**:
 *
 *   - the snapshot (the verify artifact) is **inside the renewal window** —
 *     the publisher's own `STALE_AFTER_DAYS` (31). A snapshot past that window
 *     is stale: republishing it would stamp documents whose analysis is
 *     withheld, and the honest next step is `/health verify` (the user's gate),
 *     never a timer. Outside the window this runner does nothing at all.
 *   - and the last refresh receipt did **not** already publish this snapshot
 *     (`receipt.verify.at < artifact.at`, or no receipt at all). A snapshot
 *     already published is a no-change run: the runner writes nothing — no
 *     document, no receipt — so a timer firing on a quiet day leaves the
 *     workspace byte-identical. A dry run's receipt is not evidence of a
 *     renewal: it wrote nothing.
 *
 * The monthly cadence falls out of that: `/health verify` is what moves the
 * snapshot, the charter says verify monthly, and each new current snapshot is
 * published once, automatically. A second run over the same snapshot is the
 * no-change case, and a snapshot that aged past the window waits for the gate
 * rather than being republished stale.
 *
 * The refresh path keeps its own idempotence: a run whose rendered documents
 * are unchanged plans `skip` for all four and writes no document at all.
 *
 * Usage:
 *   node scripts/health-renewal.mjs                 # decide, and renew when due
 *   node scripts/health-renewal.mjs --json          # the decision, as JSON
 *   node scripts/health-renewal.mjs --workspace=<dir> --project=<id>
 *
 * Exit codes: 0 renewed or honestly skipped; 3 a renewal was due and the
 * publisher refused (the reason is printed); 1 the run itself threw.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runHealthRefresh, healthPaths } from './health-runner.mjs';
import { gateFromArtifact, STALE_AFTER_DAYS, REFRESH_FILE } from './lib/health/docs.mjs';
import { readHealthVerify } from './lib/health-group.mjs';

export const RENEWAL_PROJECT = 'external-health';

const shortStamp = (iso) => String(iso || '').slice(0, 16).replace('T', ' ');

/** The last refresh receipt, or null when it is absent or does not read. */
function readReceipt(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Is a renewal due? Pure: snapshot + receipt + clock in, a decision out.
 *
 * `due` is the only thing the caller acts on; `reason` is what the journal
 * prints, and every skip names the honest next step rather than just "no".
 */
export function renewalDecision({ artifact, receipt, now = new Date(), staleAfterDays = STALE_AFTER_DAYS } = {}) {
  if (!artifact) {
    return {
      due: false,
      action: 'skip',
      reason: 'no verify snapshot in the workspace — run /health verify first',
      snapshotAt: '',
      publishedAt: '',
      ageDays: null,
    };
  }
  const gate = gateFromArtifact(artifact, { now, staleAfterDays });
  const snapshotAt = String(artifact.at || '');
  // A dry run publishes nothing, so it is not evidence that this snapshot was
  // renewed — only a real refresh receipt is.
  const publishedAt = receipt && receipt.dryRun !== true ? String(receipt.verify?.at || '') : '';
  if (gate.stale) {
    return {
      due: false,
      action: 'skip',
      reason: `the snapshot is ${gate.ageDays === null ? 'undated' : `${gate.ageDays} day(s) old`} — past the ${staleAfterDays}-day renewal window; run /health verify, then the timer renews`,
      snapshotAt,
      publishedAt,
      ageDays: gate.ageDays,
    };
  }
  if (publishedAt && snapshotAt && Date.parse(publishedAt) >= Date.parse(snapshotAt)) {
    return {
      due: false,
      action: 'skip',
      reason: `already renewed from this snapshot (${shortStamp(snapshotAt)}) — nothing changed`,
      snapshotAt,
      publishedAt,
      ageDays: gate.ageDays,
    };
  }
  return {
    due: true,
    action: 'renew',
    reason: publishedAt
      ? `a newer snapshot (${shortStamp(snapshotAt)}) has not been published since ${shortStamp(publishedAt)}`
      : `the snapshot (${shortStamp(snapshotAt)}) has never been published`,
    snapshotAt,
    publishedAt,
    ageDays: gate.ageDays,
  };
}

/**
 * One renewal check. `refresh` is injectable so the sensor drives the decision
 * and the real publisher with fixtures and no network; the CLI uses the
 * default, which is the one publisher that already exists.
 */
export async function runHealthRenewal({
  projectId = RENEWAL_PROJECT,
  workspace = '',
  env = process.env,
  envFile = '',
  botId = '',
  now = new Date(),
  refresh = null,
  staleAfterDays = STALE_AFTER_DAYS,
} = {}) {
  const paths = workspace
    ? { workspace, result: path.join(workspace, 'result') }
    : healthPaths(projectId, { env });
  const artifact = readHealthVerify(paths.workspace);
  const receipt = readReceipt(path.join(paths.result, REFRESH_FILE));
  const decision = renewalDecision({ artifact, receipt, now, staleAfterDays });
  if (!decision.due) return { ok: true, action: 'skipped', decision };
  const run = typeof refresh === 'function'
    ? refresh
    : () => runHealthRefresh({ projectId, workspace: paths.workspace, env, envFile, botId });
  const result = await run();
  if (!result || result.ok !== true) {
    return {
      ok: false,
      action: 'refused',
      decision,
      stage: result?.stage || '',
      error: result?.error || 'the refresh did not finish',
      result,
    };
  }
  return { ok: true, action: 'renewed', decision, result };
}

/** The journal line(s) one run prints — plain text, no markup. */
export function formatRenewalText(res) {
  const d = res.decision || {};
  if (res.action === 'renewed') {
    const a = res.result.artifact;
    return [
      `Health renewal — ${a.projectId}`,
      `renewed: ${d.reason}`,
      `created ${a.counts.created} · updated ${a.counts.updated} · skipped ${a.counts.skipped} · failed ${a.counts.failed}`,
      `receipt: result/${REFRESH_FILE} (+ result/health-refresh.md)`,
    ].join('\n');
  }
  if (res.action === 'refused') return `Health renewal refused at ${res.stage || 'refresh'}: ${res.error}`;
  return `No renewal: ${d.reason}`;
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const args = { project: RENEWAL_PROJECT, workspace: '', envFile: '', json: false };
  for (const raw of argv) {
    if (raw === '--json') { args.json = true; continue; }
    const m = raw.match(/^--([a-z-]+)=(.*)$/);
    if (!m) continue;
    if (m[1] === 'project') args.project = m[2];
    if (m[1] === 'workspace') args.workspace = m[2];
    if (m[1] === 'env-file') args.envFile = m[2];
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2));
  const run = async () => {
    const res = await runHealthRenewal({
      projectId: args.project,
      workspace: args.workspace,
      envFile: args.envFile,
    });
    console.log(args.json ? JSON.stringify(res, null, 1) : formatRenewalText(res));
    if (res.action === 'refused') process.exit(3);
  };
  run().catch((err) => {
    console.error(`health renewal failed: ${err.message}`);
    process.exit(1);
  });
}

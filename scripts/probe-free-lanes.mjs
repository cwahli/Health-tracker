#!/usr/bin/env node
/**
 * Single-ping free-lane allowance probe (canonical, shared by all bots).
 *
 * Zero-burn by default: catalog presence (opencode models cache / live
 * GET /provider when reachable) + shared ledger overlay (live router state
 * → pref-doc fallback). No quota is burned in this mode — it answers
 * "is the lane still exposed and not marked depleted", which is today's
 * /freemodel reality (43 entries: 4 cline, 4 gemini-api, 35 opencode).
 *
 * Opt-in burn ping (exactly one, early-kill on first text):
 *   node scripts/probe-free-lanes.mjs --burn-ping --lane 3
 *   node scripts/probe-free-lanes.mjs --burn-ping --first-available
 * Never loops all lanes with burns — pass --all-burn explicitly to do so.
 * Cline burn pings are off by default (daily caps are precious); add
 * --include-cline to allow them.
 *
 * Stamping: on quota proof the router state (session.quota +
 * free-lane-table.json) is updated via the shared sync helper, unless
 * --dry-run. Pref order is never touched.
 *
 * Usage:
 *   node scripts/probe-free-lanes.mjs                      # catalog + ledger map
 *   node scripts/probe-free-lanes.mjs --lane 10             # one lane detail
 *   node scripts/probe-free-lanes.mjs --burn-ping --lane 3  # one minimal ping
 *   node scripts/probe-free-lanes.mjs --burn-ping --first-available
 *   node scripts/probe-free-lanes.mjs --new-candidates      # catalog vs pref drift
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  loadFreeLaneLedger,
  annotateFreemodelEntries,
  laneMatchesRoute,
  liveRecForLane,
  freemodelRefToRoute,
  formatResetIn,
} from './lib/free-lanes.mjs';
import { buildFreeModelList } from './lib/freemodels.mjs';
import { isQuotaOrLimitError, parseRetryAfter, runOpencode, extractLogError } from './lib/agent-opencode.mjs';

const args = new Set(process.argv.slice(2));
function argVal(name) {
  const i = process.argv.findIndex((a) => a === `--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  const kv = process.argv.find((a) => a.startsWith(`--${name}=`));
  return kv ? kv.slice(name.length + 3) : null;
}
const DRY = args.has('--dry-run');
const LANE = argVal('lane');
const BURN = args.has('--burn-ping');
const FIRST = args.has('--first-available');
const ALL_BURN = args.has('--all-burn');
const WITH_CLINE = args.has('--include-cline');
const TIMEOUT = Number(argVal('timeout') || 90000);

const now = Date.now();
const { table, session, source, tablePath } = loadFreeLaneLedger({});
if (!table) {
  console.error('no shared free-lane ledger found (router state + pref doc missing)');
  process.exit(2);
}
const entries = buildFreeModelList();
const annotated = annotateFreemodelEntries(entries, table, session, { now });

// Catalog vs pref drift: today's opencode frees not yet in the 17-lane pref.
function normCore(s) {
  return String(s || '').toLowerCase().replace(/^[^/]+\//, '').replace(/:free$|-free$|_free$/i, '').replace(/[^a-z0-9]/g, '');
}
function prefModels() {
  return new Set((table.lanes || []).map((l) => normCore(l.model)));
}
function newCandidates() {
  const known = prefModels();
  const out = [];
  for (const e of entries) {
    if (e.selectable === false) continue;
    if (!known.has(normCore(e.ref))) out.push(e.ref);
  }
  return out;
}

if (args.has('--new-candidates') || (!BURN && !LANE)) {
  const fresh = newCandidates();
  console.log(`ledger source: ${source} (${tablePath})`);
  console.log(`location: ${entries[0]?.location || 'unknown'}`);
  console.log(`freemodel today: ${entries.length} (cline ${entries.filter((e) => e.provider === 'cline' && e.selectable !== false).length}, tokenharbor ${entries.filter((e) => e.provider === 'tokenharbor' && e.selectable !== false).length}, gemini-through-opencode ${entries.filter((e) => /^opencode\/gemini-/i.test(e.ref)).length}, opencode ${entries.filter((e) => e.tool === 'opencode' && e.provider !== 'tokenharbor' && !/^opencode\/gemini-/i.test(e.ref) && e.selectable !== false).length}, pending ${entries.filter((e) => e.status === 'pending-signin').length}, terminal-only ${entries.filter((e) => e.selectable === false && e.status !== 'pending-signin').length})`);
  console.log(`pref lanes: ${(table.lanes || []).length}, depleted now: ${annotated.filter((a) => a.depleted).length}`);
  for (const a of annotated.filter((x) => x.depleted)) {
    console.log(`  ❌ ${a.ref} — reset in ${a.resetIn}`);
  }
  console.log(`catalog-vs-pref: ${fresh.length} opencode free(s) not in pref (tap-into candidates):`);
  for (const r of fresh.slice(0, 30)) console.log(`  + ${r}`);
  if (!BURN && !LANE) {
    console.log('\nzero-burn map done (no quota spent). Add --burn-ping --lane N for one minimal ping.');
  }
  if (!BURN || args.has('--new-candidates')) process.exit(0);
}

// Resolve burn targets: one lane, or first-available walk, or explicit all-burn.
function laneByPref(n) {
  return (table.lanes || []).find((l) => Number(l.pref) === Number(n)) || null;
}
let targets = [];
if (LANE) {
  const lane = laneByPref(LANE);
  if (!lane) { console.error(`no pref lane ${LANE}`); process.exit(2); }
  targets = [lane];
} else if (FIRST) {
  const ordered = [...(table.lanes || [])].sort((a, b) => (a.pref || 0) - (b.pref || 0));
  const next = ordered.find((l) => {
    if (l.tg === false) return false;
    if (String(l.status || '').toLowerCase() === 'depleted' && l.nextResetAt && Date.parse(l.nextResetAt) > now) return false;
    if (liveRecForLane(l, session, now)) return false;
    if (!WITH_CLINE && String(l.provider || '').toLowerCase() === 'cline') return false;
    return true;
  });
  if (!next) { console.log('no burn target: every TG lane is marked depleted (nothing to ping — saves quota)'); process.exit(0); }
  targets = [next];
} else if (ALL_BURN) {
  targets = (table.lanes || []).filter((l) => l.tg !== false && (WITH_CLINE || String(l.provider || '').toLowerCase() !== 'cline'));
} else {
  console.error('burn mode needs --lane N, --first-available, or --all-burn');
  process.exit(2);
}
if (!BURN) {
  for (const l of targets) {
    const dep = liveRecForLane(l, session, now);
    console.log(`pref ${l.pref} ${l.label || l.model}: ${dep ? `DEPLETED (reset in ${formatResetIn(dep.rec.depletedUntil, now)})` : (l.status || 'available')} — catalog-present, zero-burn`);
  }
  process.exit(0);
}

// Exactly-one-ping guard (unless --all-burn was explicit).
if (targets.length > 1 && !ALL_BURN) {
  console.error(`refusing to burn ${targets.length} lanes without --all-burn (single-ping policy)`);
  process.exit(2);
}

const workspace = process.cwd();
for (const lane of targets) {
  const provider = String(lane.provider || 'opencode');
  const model = String(lane.model || '');
  if (DRY) {
    console.log(`dry-run: would ping pref ${lane.pref} ${provider}/${model} once ("Reply with exactly: ok", timeout ${TIMEOUT}ms) — no quota burned, ledger untouched`);
    continue;
  }
  console.log(`ping pref ${lane.pref} ${provider}/${model} (timeout ${TIMEOUT}ms)…`);
  if (provider === 'cline' && !WITH_CLINE) {
    console.log('  skip: cline burn ping needs --include-cline (daily cap protection)');
    continue;
  }
  if (provider === 'freebuff') {
    console.log('  skip: freebuff is terminal-only (no chat burn path)');
    continue;
  }
  let result;
  try {
    let child = null;
    result = await runOpencode({
      prompt: 'Reply with exactly: ok',
      model: `${provider}/${model}`.replace(/^opencode\/opencode\//, 'opencode/'),
      workspace,
      thinking: false,
      timeoutMs: TIMEOUT,
      onSpawn: (c) => { child = c; },
      onEvent: (ev) => {
        // True early-kill on first text: lane is alive, stop the run now
        // instead of burning the full agent turn.
        if (child && ev && ev.kind === 'text' && String(ev.text || '').trim()) {
          try { child.kill('SIGKILL'); } catch {}
        }
      },
    });
  } catch (e) {
    result = { code: -1, finalText: '', lastError: String(e?.message || e) };
  }
  const text = String(result?.finalText || '').trim();
  // Classify on the small=true-filtered error (cosmetic title-agent failures
  // like gpt-5.4-nano "Insufficient account funds" must never deplete a lane —
  // the primary run can still answer normally after one).
  const filtered = extractLogError(result?.stderr || '') || String(result?.lastError || '');
  const err = filtered;
  if (text && !isQuotaOrLimitError(err)) {
    console.log(`  ✅ alive — first text: ${JSON.stringify(text.slice(0, 80))} (early-kill, minimal burn)`);
    continue;
  }
  if (isQuotaOrLimitError(err)) {
    const hint = parseRetryAfter(err);
    console.log(`  ❌ quota proof: ${err.slice(0, 160)}${hint ? ` [retry hint: ${hint}]` : ''}`);
    // Stamp the live ledger (session.quota + table overlay, pref untouched).
    const { syncFreeLaneTableFromSession, quotaKeysForLane } = await import('./lib/free-lanes.mjs');
    const isPrefFallback = tablePath && tablePath.includes('free-lane-preference');
    const sPath = isPrefFallback ? null : path.join(path.dirname(tablePath || ''), 'session.json');
    if (!sPath) {
      console.log('  stamp: pref fallback — no live session to stamp; record the countdown manually');
      continue;
    }
    try {
      const until = Date.now() + 6 * 3600 * 1000; // default TTL when vendor gives no countdown
      const sess = JSON.parse(fs.readFileSync(sPath, 'utf8'));
      sess.quota = sess.quota || {};
      for (const key of quotaKeysForLane(lane)) {
        sess.quota[key] = {
          depletedUntil: until,
          lastError: err.slice(0, 300),
          scope: key.startsWith('bucket:') ? 'shared' : 'per-model',
          depletedObservedAt: new Date().toISOString(),
          countdownParsed: false,
          kind: 'limit-unknown',
        };
      }
      fs.writeFileSync(sPath, JSON.stringify(sess, null, 2));
      const sync = syncFreeLaneTableFromSession({ tablePath, session: sess });
      console.log(`  stamped ${sPath} (${quotaKeysForLane(lane).join(', ')}) + table sync: ${sync.updated ? `${(sync.changes || []).length} lane change(s)` : sync.reason}`);
    } catch (e) {
      console.log(`  stamp failed: ${String(e?.message || e).slice(0, 160)} — ledger untouched`);
    }
    continue;
  }
  console.log(`  ⚠️ inconclusive (code ${result?.code}): ${(err || 'no text, no quota error').slice(0, 200)} — ledger untouched (no deplete stamp without quota proof)`);
}

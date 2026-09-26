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
  withCatalogLanes,
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
const LOCATION = argVal('--location') || 'vps';
const BOT_ID = argVal('--bot') || process.env.HTBOT_ID || 'vm2';
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
  console.log(`freemodel today: ${entries.length} (cline ${entries.filter((e) => e.provider === 'cline' && e.selectable !== false).length}, tokenharbor ${entries.filter((e) => e.provider === 'tokenharbor' && e.selectable !== false).length}, gemini-through-opencode ${entries.filter((e) => /^(?:opencode|google)\/gemini-/i.test(e.ref)).length}, opencode ${entries.filter((e) => e.tool === 'opencode' && e.provider !== 'tokenharbor' && !/^(?:opencode|google)\/gemini-/i.test(e.ref) && e.selectable !== false).length}, pending ${entries.filter((e) => e.status === 'pending-signin').length}, terminal-only ${entries.filter((e) => e.selectable === false && e.status !== 'pending-signin').length})`);
  console.log(`pref lanes: ${(table.lanes || []).length}, depleted now: ${annotated.filter((a) => a.depleted).length}`);
  for (const a of annotated.filter((x) => x.depleted)) {
    console.log(`  ❌ ${a.ref} — reset in ${a.resetIn}`);
  }
  console.log(`catalog-vs-pref: ${fresh.length} opencode free(s) not in pref (tap-into candidates):`);
  for (const r of fresh.slice(0, 30)) console.log(`  + ${r}`);
  if (!BURN && !LANE) {
    // The zero-burn path is the one QS-5 asks for, so the host capability table
    // belongs here rather than after the burn branch's exit.
    await hostCapabilityProbe();
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

// R-16 QS-5 wants a probe table per host: installed tools, the local binary and
// whether it is authenticated, the provider catalog, and the credentials for the
// hosted providers — because the claim under test is that /freemodel and
// /allowance show exactly what this host supports and nothing inferred from
// another host. This block is the independent half of that comparison: it reads
// the filesystem and the environment, not the ledger those two commands render
// from, so a row that the ledger claims but the host cannot run shows up here.
async function hostCapabilityProbe() {
  // The service reads its credentials from ~/.config/bot-host/{common,<id>}.env, so
  // a probe run from a plain shell would report "NO CREDENTIAL" for providers the
  // live bot is using, and QS-5's comparison would be against the wrong host
  // state. The same files are read here, quotes stripped the way systemd's
  // EnvironmentFile does, and the sources are printed so the output says which
  // env it judged.
  const home = os.homedir();
  const env = { ...process.env };
  const envSources = ['process env'];
  for (const file of [`${home}/.config/bot-host/common.env`, `${home}/.config/bot-host/${BOT_ID}.env`]) {
    let text = '';
    try {
      if (!fs.existsSync(file)) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    envSources.push(path.basename(file));
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const value = m[2].trim().replace(/^["'](.*)["']$/, '$1');
      if (value) {
        env[m[1]] = value;
        // The catalog is read by spawning `opencode models`, which inherits
        // process.env — not this local object. Without this the probe loaded the
        // service's Gemini key and still got a `pending:gemini` placeholder back,
        // and reported a host state the live bot does not have.
        process.env[m[1]] = value;
      }
    }
  }
  const where = (...p) => p.find((f) => { try { return fs.existsSync(f); } catch { return false; } }) || null;
  const has = (...keys) => keys.some((k) => {
    const v = env[k];
    return typeof v === 'string' && v.replace(/^["']|["']$/g, '').trim().length > 0;
  });
  const catalog = buildFreeModelList({ location: LOCATION, env }) || [];
  // A catalogued model reached through OpenCode carries tool=opencode and
  // provider=cloudflare / gemini, so counting only `tool` reported 0 rows for two
  // providers the live /allowance shows working.
  const rowsOf = (...tools) => catalog.filter((e) => tools.includes(String(e?.tool || '').toLowerCase()) || tools.includes(String(e?.provider || '').toLowerCase())).length;
  // Token Harbor, Cloudflare and the Freebuff row are ledger lanes, not OpenCode
  // catalog entries: they are reached through a hosted provider, so the honest
  // count for them is the ledger's, and the catalog count is always zero.
  // The row count has to come from the same table the live commands read, which is
  // the router's live state with the pref document as fallback — not a per-bot
  // ledger directory. Counting the per-bot copy made Cloudflare read 0 rows while
  // /allowance showed two, and a probe that contradicts the thing it is checking
  // is worse than no probe.
  // Counting the raw ledger still read Cloudflare as 0 rows, because its lanes
  // exist only after the catalog is folded in — which is the table /allowance
  // actually renders. So the probe counts the folded table, the same fold, or the
  // probe and the commands are reading two different worlds.
  let ledgerRows = () => 0;
  let hostedRows = () => 0;
  let ledgerSource = 'unavailable';
  let laneCount = 0;
  try {
    const loaded = loadFreeLaneLedger({});
    const folded = withCatalogLanes(loaded?.table, catalog).table || loaded?.table;
    const lanes = folded?.lanes || [];
    laneCount = lanes.length;
    ledgerSource = `${loaded?.source || 'unknown'}${folded && folded !== loaded?.table ? ' + catalog fold' : ''}`;
    ledgerRows = (provider) => lanes.filter((l) => String(l?.provider || '').toLowerCase() === provider).length;
    // Cloudflare and Gemini lanes are OpenCode-hosted: their provider is
    // `opencode` and the execution owner is in the model id (`@cf/…`, `google/…`).
    // Counting by provider alone reported 0 for two providers /allowance lists as
    // working, which is the exact "inferred from the wrong place" mistake the row
    // forbids.
    // The owner is a *segment* of the model id, not its head: Cloudflare lanes are
    // `cloudflare/@cf/<ns>/<model>` reached through OpenCode, so a startsWith('@cf/')
    // test found 0 of the two rows /allowance shows.
    hostedRows = (prefix) => lanes.filter((l) => {
      const segs = String(l?.model || '').toLowerCase().split('/');
      return segs.includes(prefix) || String(l?.model || '').toLowerCase().startsWith(prefix);
    }).length;
  } catch {
    ledgerRows = () => 0;
    hostedRows = () => 0;
  }
  const rows = [
    ['OpenCode', where(`${home}/.opencode/bin/opencode`, '/usr/local/bin/opencode', '/usr/bin/opencode') ? 'binary present' : 'NO BINARY', has('OPENCODE_API_KEY') ? 'OPENCODE_API_KEY set' : 'no OPENCODE_API_KEY', `${rowsOf('opencode', 'opencode-go')} catalog rows`],
    // cline lives under the npm global prefix, which is not on the service PATH;
    // a probe that missed it would claim Cline is unavailable while /allowance
    // shows four working Cline rows.
    ['Cline', where(`${home}/.npm-global/bin/cline`, `${home}/.local/bin/cline`, '/usr/local/bin/cline', '/usr/bin/cline') ? 'binary present' : 'NO BINARY', where(`${home}/.config/cline/data/settings/providers.json`, `${home}/.cline/data/settings/providers.json`, `${home}/.cline/auth.json`) ? 'auth file present' : 'NO AUTH FILE', `${rowsOf('cline')} catalog rows, ${ledgerRows('cline')} ledger rows`],
    ['Token Harbor', 'remote API', has('TOKEN_HARBOR_API_KEY', 'TOKENHARBOR_API_KEY') ? 'credential set' : 'NO CREDENTIAL', `${ledgerRows('tokenharbor')} ledger rows`],
    ['Cloudflare Workers AI', 'remote API', has('CLOUDFLARE_WORKERS_AI_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN') ? 'credential set' : 'NO CREDENTIAL', `${ledgerRows('cloudflare')} ledger rows, ${hostedRows('@cf')} @cf lanes`],
    ['Gemini via OpenCode', 'via OpenCode', has('GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY') ? 'credential set' : 'NO CREDENTIAL', `${rowsOf('gemini')} catalog rows, ${ledgerRows('gemini')} ledger rows, ${hostedRows('google')} google lanes`],
    ['Freebuff', where(`${home}/.local/bin/freebuff`, '/usr/local/bin/freebuff', '/usr/bin/freebuff') ? 'binary present' : 'NO BINARY', has('FREEBUFF_API_KEY', 'FREEBUFF_TOKEN') ? 'credential set' : 'no credential', `${ledgerRows('freebuff')} ledger rows (terminal-only on this host)`],
  ];
  console.log(`\nhost capability probe (zero burn) — env from: ${envSources.join(', ')}; ledger: ${ledgerSource} (${laneCount} lanes)`);
  const w = [0, 1, 2].map((i) => Math.max(...rows.map((r) => String(r[i]).length)));
  for (const r of rows) console.log(`  ${String(r[0]).padEnd(w[0])}  ${String(r[1]).padEnd(w[1])}  ${String(r[2]).padEnd(w[2])}  ${r[3]}`);
  console.log('  a provider with NO CREDENTIAL above must appear in /allowance as needing setup, never as selectable');
  return rows;
}


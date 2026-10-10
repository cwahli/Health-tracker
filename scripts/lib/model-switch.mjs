/**
 * model-switch — ONE implementation of the free-model pool selection rules and
 * the in-job quota switch, shared by every transport.
 *
 * Why this module exists (ticket: model-parity / unified system, 2026-10-10):
 * the three pools (/model_light_free, /model_free, /model_go) were one bot
 * feature and the box's tmux workers each re-implemented a version of "which
 * model next" (ht-run's pick_model, ht-watch's stamp + next_lane). Two
 * implementations of one rule drift, and the box's copy crossed pools on a
 * quota hit while the bot's did not. This module is the single source:
 *
 *   - pool membership and order: `MODEL_POOLS` / `poolOfLane` /
 *     `sortFreemodelTierRows` / `freemodelRatingOf` stay in free-lanes.mjs (the
 *     canonical list); `orderPoolLanes` here is the walk's own within-pool order
 *     and is what bot-host's selectTurnLanes now uses, byte for byte.
 *   - the quota switch: `quotaHitPlan` stamps the ledger through the same core
 *     the router and the allowance watcher use (`depletionUntilFromText` for
 *     the reset timer, `stampDepleted` for the shared-bucket stamp), then picks
 *     the next usable lane IN THE SAME POOL. `applyQuotaHit` is the same plan
 *     with the ledger files read and written atomically.
 *
 * Transports:
 *   - Telegram bots (bot-host family): import orderPoolLanes / poolNoteLines
 *     (the turn walk and the pool keyboard notes).
 *   - Non-TG CLI/tmux workers (repo tools/telegram-provider-router/bin/ht-run,
 *     ht-watch; the box's /home/box/bin copies): a thin bash wrapper calls the
 *     repo CLI scripts/ht-model.mjs, which is a thin wrapper over this module.
 *   - The box CLI `ht-model` (pool print, pick, allowance, quota-hit).
 *
 * Must be require()-able on Node >= 22.12 (require(esm)) so the CJS tmux
 * scripts can load it without a build step; no top-level await, no Telegram,
 * no provider calls. Pure file reads plus writes when asked.
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { readFileSync, writeFileSync, renameSync } from 'fs';
import {
  MODEL_POOLS,
  poolOfLane,
  poolOfRef,
  poolForCommand,
  poolDisplayName,
  canonicalAllowanceLanes,
  groupRowsByTier,
  sortFreemodelTierRows,
  poolRows,
  poolOfRow,
  projectLanes,
  loadFreeLaneLedger,
  soonestResetAmongDepleted,
  formatResetIn,
  freemodelRatingOf,
  planCodeForLane,
  freemodelRefToRoute,
  readJson,
} from './free-lanes.mjs';
import { POOL_EXIT_NOTE } from './commands.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const CORE_DEFAULT = join(REPO_ROOT, 'tools', 'telegram-provider-router', 'src', 'allowance-watch-core.cjs');
const require = createRequire(import.meta.url);

let coreCache = null;

/**
 * The shared quota core (same one the router and ht-allowance-watch use).
 * HT_CORE_PATH overrides it the way the box watcher's own loader does, so a
 * test can point at a fixture copy without touching the live one.
 */
export function switchCore() {
  if (coreCache) return coreCache;
  for (const p of [process.env.HT_CORE_PATH, CORE_DEFAULT]) {
    if (!p) continue;
    try {
      coreCache = require(p);
      return coreCache;
    } catch {
      // try the next candidate — a missing path is the normal case, not an error
    }
  }
  throw new Error('model-switch: allowance-watch-core.cjs not found (set HT_CORE_PATH)');
}

// ---------------------------------------------------------------------------
// Pool identity, order and tool mapping
// ---------------------------------------------------------------------------

/** Pool id for a bare chat ref (`cline:cline-free/x`, `opencode-go/y`). */
export function poolForRef(ref) {
  return poolOfRef(ref);
}

/** The pools object, re-exported so a transport imports one module. */
export { MODEL_POOLS, poolForCommand, poolDisplayName, freemodelRefToRoute };

/**
 * The walk's within-pool order: keyed (non-free) lanes last, then the list's
 * own rating order — benchmark AA desc, catalog rank asc, pref asc. This is the
 * bot's bySameTier; bot-host imports it so the keyboard, the walk and every
 * worker read one order.
 */
export function orderPoolLanes(lanes, pool, { ratingOf = freemodelRatingOf } = {}) {
  const keyedRankOf = (l) => (l?.plan === 'GM' ? 1 : 0);
  return (lanes || [])
    .filter((l) => poolOfLane({ provider: l?.provider, model: l?.model }) === pool)
    .sort((a, b) => {
      const keyed = keyedRankOf(a) - keyedRankOf(b);
      if (keyed) return keyed;
      const ra = ratingOf(a?.model || '');
      const rb = ratingOf(b?.model || '');
      if (rb.aa !== ra.aa) return rb.aa - ra.aa;
      if (ra.rank !== rb.rank) return ra.rank - rb.rank;
      return (Number(a?.pref) || 0) - (Number(b?.pref) || 0);
    });
}

/**
 * Which ht-run tool runs a lane. The box launches opencode/cline/freebuff;
 * every non-cline, non-freebuff lane (opencode, tokenharbor, cloudflare,
 * gemini-through-opencode) executes through the opencode runner.
 */
export function laneTool(lane) {
  const p = String(lane?.provider || '').toLowerCase();
  if (p === 'cline') return 'cline';
  if (p === 'freebuff') return 'freebuff';
  return 'opencode';
}

/**
 * Tools that allow only ONE CLI session per login and cannot take a model or
 * be probed for credit (Freebuff). An automated in-job switch must never move
 * a worker onto one: several workers hitting quota at once would all pile
 * onto the same single session (2026-10-10 incident: 3 jobs -> 1 Freebuff
 * login with 12 Freebucks left). Only an explicit launch may use them.
 */
export const SINGLE_SESSION_TOOLS = Object.freeze(['freebuff']);

/** The same mapping for a chat ref (`cline:...` / `freebuff/...` / else). */
export function toolOfRef(ref) {
  const s = String(ref || '');
  if (s.startsWith('cline:')) return 'cline';
  if (s.startsWith('freebuff')) return 'freebuff';
  return 'opencode';
}

/** The two strings that name one route: `provider/model`, surface-aware tails. */
const routeTail = (v) => String(v || '').replace(/^[^/]+\//, '').replace(/:free$/i, '');

function sameRouteText(lane, ref) {
  const current = freemodelRefToRoute(ref || '');
  if (!current.provider || !current.model) return false;
  return lane.model === current.model
    || (lane.provider === current.provider && routeTail(lane.model) === routeTail(current.model));
}

// ---------------------------------------------------------------------------
// Notes the keyboard cannot render (pool name / usable / what a quota hit does)
// ---------------------------------------------------------------------------

/**
 * The pool note line(s) — moved here from bot-host so the box CLI prints the
 * same header the keyboard carries, instead of inventing a second wording.
 */
export function poolNoteLines({ pool, location, total, usable, soonest = '' } = {}) {
  const loc = String(location || 'vps');
  const name = poolDisplayName(pool, loc);
  const move = pool === 'go'
    ? 'the Go plan is paid, so this lane never moves on its own'
    : 'a quota hit moves inside this pool only';
  if (!total) {
    return [`${name} — no lane of this pool is on ${loc} right now${soonest ? `; soonest reset in ${soonest}` : ''}. ${move}. ${POOL_EXIT_NOTE}`];
  }
  const out = [`${name} · ${total} lane${total === 1 ? '' : 's'} on ${loc} · ${usable} usable — ${move}. ${POOL_EXIT_NOTE}`];
  if (!usable) out.push(`Nothing in this pool is usable right now${soonest ? ` — soonest reset in ${soonest}` : ''}.`);
  return out;
}

/** Soonest reset held by one pool's own rows, as a countdown (bot parity). */
export function soonestPoolReset(rows, pool, now = Date.now()) {
  let best = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || poolOfRow(r) !== pool) continue;
    const at = Number(r.resetAt) || Date.parse(String(r.resetIn || '')) || null;
    if (!Number.isFinite(at) || at === null) continue;
    if (best === null || at < best) best = at;
  }
  return best === null ? '' : formatResetIn(best, now);
}

// ---------------------------------------------------------------------------
// Ledger load (explicit, router-ledger-shaped)
// ---------------------------------------------------------------------------

/**
 * Load the live router ledger (or an explicit pair of files). Pass
 * `routerDir` (HT_ROUTER_DIR) for the box's live state; tablePath/sessionPath
 * win over it so a test/fixture can point anywhere.
 */
export function loadSwitchLedger({ routerDir = null, tablePath = null, sessionPath = null, catalogEntries = null } = {}) {
  const dir = routerDir || process.env.HT_ROUTER_DIR || null;
  const stateDir = dir ? join(dir, 'state') : (process.env.TG_ROUTER_STATE_DIR || null);
  const tPath = tablePath || (stateDir ? join(stateDir, 'free-lane-table.json') : null);
  const sPath = sessionPath || (stateDir ? join(stateDir, 'session.json') : null);
  return loadFreeLaneLedger({ stateDir, tablePath: tPath, sessionPath: sPath, catalogEntries });
}

// ---------------------------------------------------------------------------
// Pool selection (the same projection the turn path reads)
// ---------------------------------------------------------------------------

/** Selectable lanes of every pool, plus the skipped verdicts, as lane structs. */
export function poolWalkLanes({ table, session = null, now = Date.now(), location = '', readiness = null } = {}) {
  const projection = projectLanes(table, session || {}, { now, location, readiness });
  const lanes = projection.filter((r) => r.selectable).map((r) => ({
    provider: r.provider, model: r.model, pref: r.pref, family: r.family, label: r.label, plan: r.plan, ref: r.ref,
  }));
  const skipped = projection.filter((r) => !r.selectable).map((r) => ({
    provider: r.provider, model: r.model, label: r.label, why: r.reason, until: r.resetAt, resetLabel: r.resetLabel,
  }));
  return { lanes, skipped };
}

/**
 * The single lane a launch/turn would run for a pool.
 *
 * `tool` (opencode|cline|freebuff) narrows to lanes that tool can execute — the
 * box's launch constraint; the bot itself is tool-agnostic and takes the first
 * lane of the ordered pool. `currentModel` keeps the current lane when it is
 * usable and in the pool (bot parity); `excludeModel` drops one route (the lane
 * that just died). An exhausted pool returns `exhausted: true` and the pool's
 * own `soonest` reset, never a lane from the other pool (decision D3).
 */
export function pickPoolLane({
  table, session = null, pool, tool = null, currentModel = null, excludeModel = '',
  now = Date.now(), location = '', readiness = null, avoidTools = [],
} = {}) {
  const { lanes, skipped } = poolWalkLanes({ table, session, now, location, readiness });
  const avoid = new Set((avoidTools || []).map((t) => String(t).toLowerCase()));
  const toolOk = (l) => (!tool || laneTool(l) === tool) && !avoid.has(laneTool(l));
  const notExcluded = (l) => !excludeModel || !sameRouteText(l, excludeModel);
  const inPool = (l) => poolOfLane({ provider: l.provider, model: l.model }) === pool;
  const current = currentModel ? lanes.find((l) => inPool(l) && sameRouteText(l, currentModel)) : null;
  if (current && toolOk(current) && notExcluded(current)) {
    return { lane: current, model: current.model, ref: current.ref, tool: laneTool(current), pool, exhausted: false, skipped };
  }
  const ordered = orderPoolLanes(lanes.filter((l) => inPool(l) && toolOk(l) && notExcluded(l)), pool);
  if (ordered.length) {
    return { lane: ordered[0], model: ordered[0].model, ref: ordered[0].ref, tool: laneTool(ordered[0]), pool, exhausted: false, skipped };
  }
  const soonest = soonestResetAmongDepleted(table, session || {}, { now, pool })
    || soonestResetAmongDepleted(table, session || {}, { now });
  return { lane: null, model: null, ref: null, tool: null, pool, exhausted: true, skipped, soonest };
}

// ---------------------------------------------------------------------------
// In-job quota switch (the bot's "a quota hit moves inside this pool only")
// ---------------------------------------------------------------------------

function findLedgerLane(table, provider, model) {
  const wantProvider = String(provider || '').toLowerCase();
  const wantModel = String(model || '');
  return (table?.lanes || []).find((l) => {
    const lp = String(l.provider || '').toLowerCase();
    if (lp && wantProvider && lp !== wantProvider) return false;
    const lm = String(l.model || '');
    return lm === wantModel || routeTail(lm) === routeTail(wantModel);
  }) || null;
}

function writeJsonAtomic(filePath, obj) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(obj, null, 2));
    renameSync(tmp, filePath);
  } catch {
    try {
      writeFileSync(filePath, JSON.stringify(obj, null, 2));
    } catch {
      // leave the ledger as it was rather than corrupting it
    }
  }
}

/**
 * Stamp one quota hit on the ledger (in memory) and choose the next lane in
 * the SAME pool. The reset timer and the shared-bucket stamp come from the
 * shared core, so the router, the allowance watcher and every worker write one
 * shape. Pure over the two objects it is given.
 *
 * Returns:
 *   laneFound  — the depleted lane was matched in the table
 *   pool       — the pool the hit stays inside (lane's own pool; override with `pool`)
 *   untilIso / kind / bucketId / stamped — what the stamp wrote
 *   next       — { provider, model, tool, ref } or null
 *   exhausted  — the whole pool is empty (the ONLY case a worker may exit QUOTA)
 *   soonest    — the pool's soonest reset (bot parity)
 */
export function quotaHitPlan({
  table, session = null, provider = '', model = '', reason = '', now = Date.now(), pool = null,
  avoidTools = SINGLE_SESSION_TOOLS,
} = {}) {
  if (!table || !Array.isArray(table.lanes)) {
    return { laneFound: false, pool, untilIso: null, kind: null, bucketId: null, stamped: [], next: null, exhausted: true, soonest: null };
  }
  const core = switchCore();
  const sess = session || {};
  const lane = findLedgerLane(table, provider, model);
  const effectivePool = pool || (lane ? poolOfLane(lane) : null);
  let untilIso = null;
  let kind = null;
  let bucketId = null;
  let stamped = [];
  let before = null;
  if (lane) {
    before = { status: lane.status, nextResetAt: lane.nextResetAt || null };
    // ONE reset-timer policy for every stamper: CF 4006 daily neurons → next
    // 00:00 UTC; vendor countdown honoured; Token Harbor $0 bar → +7d; plain
    // rate-limit → 45m; unknown → 6h.
    const d = core.depletionUntilFromText(reason, now);
    bucketId = core.sharedBucketIdFor(lane);
    const lanes = bucketId ? table.lanes.filter((l) => core.sharedBucketIdFor(l) === bucketId) : [lane];
    core.stampDepleted(table, sess, lanes, bucketId, {
      until: d.until,
      hint: d.hint,
      kind: d.kind,
      lastError: reason,
      source: 'model-switch quota switch',
    });
    table.updatedAt = core.isoZ(now);
    untilIso = core.isoZ(d.until);
    kind = d.kind;
    stamped = lanes.map((l) => `${l.provider}/${l.model}`);
  }
  const pick = effectivePool
    ? pickPoolLane({ table, session: sess, pool: effectivePool, excludeModel: lane ? lane.model : '', now, avoidTools })
    : { lane: null, exhausted: true, soonest: null };
  return {
    laneFound: Boolean(lane),
    provider, model, pool: effectivePool,
    untilIso, kind, bucketId, stamped, before,
    next: pick.lane ? { provider: pick.lane.provider, model: pick.lane.model, tool: laneTool(pick.lane), ref: pick.lane.ref } : null,
    exhausted: Boolean(pick.exhausted),
    soonest: pick.soonest || null,
  };
}

/**
 * quotaHitPlan + the file writes: read the live ledger, stamp it, choose the
 * next lane, write both files back atomically. This is the one call the tmux
 * wrappers make on a quota hit.
 */
export function applyQuotaHit({
  tablePath, sessionPath, provider = '', model = '', reason = '', now = Date.now(), pool = null,
  avoidTools = SINGLE_SESSION_TOOLS,
} = {}) {
  const table = tablePath ? readJson(tablePath) : null;
  if (!table || !Array.isArray(table.lanes)) {
    return { error: `no readable table at ${tablePath}`, laneFound: false, pool, next: null, exhausted: true, soonest: null };
  }
  const session = (sessionPath && readJson(sessionPath)) || {};
  const plan = quotaHitPlan({ table, session, provider, model, reason, now, pool, avoidTools });
  if (tablePath) writeJsonAtomic(tablePath, table);
  if (sessionPath) writeJsonAtomic(sessionPath, session);
  return { ...plan, tablePath, sessionPath };
}

/**
 * Next usable lane in the pool for a lane that failed WITHOUT being stamped
 * (DIED/STALLED under --auto-failover). Same pool, same order, current route
 * excluded; null when the pool is empty. `model` may be a lane id: the pool
 * is resolved the way the lane table names it (sameRouteText), so a caller
 * that only knows the ht-run model arg still lands in the right pool.
 */
export function nextPoolLane({ table, session = null, pool = null, model = '', now = Date.now(), location = '', readiness = null, avoidTools = SINGLE_SESSION_TOOLS } = {}) {
  const effectivePool = pool || poolForLaneModel(table, model);
  if (!effectivePool) return null;
  const pick = pickPoolLane({ table, session, pool: effectivePool, excludeModel: model, now, location, readiness, avoidTools });
  return pick.lane ? { provider: pick.lane.provider, model: pick.lane.model, tool: laneTool(pick.lane), ref: pick.lane.ref } : null;
}

/** The pool of a model id as the lane table names it (exact, then route tail). */
function poolForLaneModel(table, model) {
  if (!model) return null;
  const exact = (table?.lanes || []).find((l) => sameRouteText({ provider: l.provider, model: l.model }, model));
  if (exact) return poolOfLane({ provider: exact.provider, model: exact.model });
  // Unknown id: no lane to anchor a pool to. Returning null keeps the worker
  // on the failed lane's own retry path instead of inventing a pool walk
  // (default-tier fallback would send an explicit-override failure into the
  // light pool — the crossing the pools exist to remove).
  return null;
}

// ---------------------------------------------------------------------------
// Print surface (the box CLI's rows, built from the bot's own primitives)
// ---------------------------------------------------------------------------

/**
 * One pool's rows in the keyboard's own order: tier groups (high, unlisted,
 * light — the catalog's labels) each sorted by sortFreemodelTierRows, then the
 * keyed fallback group last, exactly the displayGroups the /model_* keyboard
 * builds. Returns { rows, groups } where groups carry the tier title and its
 * count so a terminal print and the keyboard cannot disagree.
 */
export function poolPickerRows({ table, session = null, pool, now = Date.now(), location = '', readiness = null } = {}) {
  const canonical = canonicalAllowanceLanes({ table, session: session || {}, readiness, location, now });
  const canonicalRows = poolRows(canonical, pool);
  const tierGroups = groupRowsByTier(canonicalRows).map((g) => ({ ...g, rows: sortFreemodelTierRows(g.rows) }));
  const isKeyedRow = (r) => (r.plan || (r.lane ? planCodeForLane(r.lane) : '')) === 'GM';
  const keyedFallback = [];
  const displayGroups = tierGroups
    .map((g) => ({
      ...g,
      rows: (g.rows || []).filter((r) => {
        if (isKeyedRow(r)) { keyedFallback.push(r); return false; }
        return true;
      }),
    }))
    .filter((g) => (g.rows || []).length > 0);
  if (keyedFallback.length) displayGroups.push({ tier: 'keyed', label: 'Keyed fallback', rows: keyedFallback });
  return { canonical, groups: displayGroups, rows: displayGroups.flatMap((g) => g.rows) };
}

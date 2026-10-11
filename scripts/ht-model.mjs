#!/usr/bin/env node
/**
 * ht-model — the box/worker CLI for the shared model-switch API.
 *
 * Thin wrapper: every decision comes from the repo's shared modules. The pool
 * rows are built and ordered by bot-host's own `formatFreemodelWithDepletion`
 * (the Telegram keyboard's formatter, so the terminal print is the keyboard
 * minus the buttons), the pick comes from `scripts/lib/model-switch.mjs` (the
 * same `orderPoolLanes` the bot's turn walk uses), the allowance text is
 * `buildAllowanceTextForBots` (the same renderer /allowance sends), and a quota
 * hit stamps through the shared core with the router's one reset-timer policy.
 * No logic lives here that a bot does not already run.
 *
 * Usage:
 *   ht-model light_free [--tool opencode|cline|freebuff]   pool rows + status
 *   ht-model free       [--tool ...]                       (coding pool, AA >= 35)
 *   ht-model go         [--tool ...]                       (paid Go plan)
 *   ht-model pick free --tool opencode                     one model, or exit 3
 *   ht-model allowance                                     the /allowance text
 *   ht-model list [--tool ...]                             every usable lane now
 *   ht-model quota-hit --model M --reason "..." [--provider P] [--pool P] [--json]
 *
 * Env: HT_ROUTER_DIR (router dir; default ~/.config/telegram-opencode/router),
 *      TG_ROUTER_STATE_DIR (fallback state dir), HT_LOCATION (display name,
 *      default "box"), HT_CORE_PATH (quota core override).
 *
 * Exit codes: 0 ok · 1 usage/ledger error · 3 pool exhausted (nothing to run).
 */
import { dirname } from 'path';
import { formatFreemodelWithDepletion } from './bot-host.mjs';
import {
  MODEL_POOLS,
  poolDisplayName,
  loadSwitchLedger,
  poolNoteLines,
  soonestPoolReset,
  pickPoolLane,
  orderPoolLanes,
  laneTool,
  toolOfRef,
  applyQuotaHit,
  poolWalkLanes,
} from './lib/model-switch.mjs';
import { buildAllowanceTextForBots, canonicalAllowanceLanes } from './lib/free-lanes.mjs';

const LOCATION = process.env.HT_LOCATION || 'box';

function usage(msg) {
  if (msg) console.error(`ht-model: ${msg}`);
  console.error('usage: ht-model <light_free|free|go|list|allowance> [--tool T]\n'
    + '       ht-model pick <light_free|free|go> --tool T\n'
    + '       ht-model quota-hit --model M --reason TEXT [--provider P] [--pool P] [--json]');
  process.exit(1);
}

/** `light_free` → `light`, `free` → `coding`, `go` → `go`; ids pass through. */
export function resolvePoolName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (n === 'light_free' || n === 'light') return 'light';
  if (n === 'free' || n === 'coding' || n === 'model_free') return 'coding';
  if (n === 'go' || n === 'model_go') return 'go';
  return null;
}

function parseArgs(argv) {
  const out = { tool: null, provider: null, model: null, reason: null, pool: null, json: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tool') out.tool = String(argv[++i] || '').toLowerCase() || null;
    else if (a === '--provider') out.provider = String(argv[++i] || '') || null;
    else if (a === '--model') out.model = String(argv[++i] || '') || null;
    else if (a === '--reason') out.reason = String(argv[++i] || '') || null;
    else if (a === '--pool') out.pool = String(argv[++i] || '') || null;
    else if (a === '--json') out.json = true;
    else if (a.startsWith('--')) usage(`unknown flag ${a}`);
    else out.rest.push(a);
  }
  return out;
}

function ledgerOrDie() {
  let ledger;
  try {
    ledger = loadSwitchLedger({});
  } catch (e) {
    console.error(`ht-model: cannot load ledger (${String(e?.message || e)})`);
    process.exit(1);
  }
  if (!ledger.table) {
    console.error('ht-model: no free-lane ledger found (HT_ROUTER_DIR / TG_ROUTER_STATE_DIR)');
    process.exit(1);
  }
  return ledger;
}

/**
 * One pool's rows, printed with the bot's own picker formatter — the same
 * canonical list, pool filter, tier grouping, rating order and row copy the
 * Telegram keyboard carries. `--tool` narrows to lanes that tool can run.
 */
function cmdPool(poolName, opts) {
  const pool = resolvePoolName(poolName);
  if (!pool) usage(`unknown pool "${poolName}"`);
  const { table, session, source } = ledgerOrDie();
  const canonical = canonicalAllowanceLanes({ table, session, location: LOCATION });
  const res = formatFreemodelWithDepletion([], [], {
    current: '', location: LOCATION, canonical, tableLanes: table.lanes || [], pool,
  });
  const note = poolNoteLines({
    pool, location: LOCATION, total: res.rows.length, usable: res.usable.length,
    soonest: soonestPoolReset(res.rows, pool),
  });
  const buttons = res.buttons.filter((b) => b && !b.header && b.data !== 'noop'
    && (!opts.tool || toolOfRef(b.data || b.ref) === opts.tool));
  const lines = [...note];
  if (opts.tool) lines.push(`tool ${opts.tool}: ${buttons.length} of ${res.rows.length} rows run on it`);
  if (source === 'pref-doc-fallback') lines.push('(pref order only — the ledger has no stamps yet)');
  lines.push('');
  for (const b of buttons) lines.push(b.text);
  if (!buttons.length) lines.push('(nothing in this pool is visible right now)');
  console.log(lines.join('\n'));
  return 0;
}

/** One model: the same order/rating walk the bot's turn path runs. */
function cmdPick(poolName, opts) {
  const pool = resolvePoolName(poolName);
  if (!pool) usage(`unknown pool "${poolName}"`);
  const { table, session } = ledgerOrDie();
  const pick = pickPoolLane({ table, session, pool, tool: opts.tool, location: LOCATION });
  if (!pick.lane) {
    const soon = pick.soonest?.label ? `soonest reset ${pick.soonest.label}` : 'no reset known';
    console.error(`ht-model: ${poolDisplayName(pool, LOCATION)} is empty — ${soon}`);
    process.exit(3);
  }
  if (opts.json) {
    console.log(JSON.stringify({
      model: pick.model, ref: pick.ref, tool: laneTool(pick.lane), pool,
      pref: pick.lane.pref, label: pick.lane.label,
    }));
  } else {
    console.log(pick.model);
  }
  return 0;
}

/** Every usable lane right now, all pools, in each pool's walk order. */
function cmdList(opts) {
  const { table, session } = ledgerOrDie();
  const { lanes } = poolWalkLanes({ table, session, location: LOCATION });
  let n = 0;
  for (const pool of Object.keys(MODEL_POOLS)) {
    const use = orderPoolLanes(opts.tool ? lanes.filter((l) => laneTool(l) === opts.tool) : lanes, pool);
    if (!use.length) continue;
    console.log(poolDisplayName(pool, LOCATION));
    for (const l of use) {
      n++;
      console.log(`  ${laneTool(l).padEnd(8)} ${String(l.model).padEnd(44)} pref ${String(l.pref).padEnd(3)} ${l.label || ''}`);
    }
  }
  if (!n) {
    console.error('ht-model: no usable lane in any pool');
    process.exit(3);
  }
  return 0;
}

/** The /allowance text, rendered by the bots' own helper. */
function cmdAllowance() {
  const { tablePath } = loadSwitchLedger({});
  const stateDir = tablePath ? dirname(tablePath) : null;
  const html = buildAllowanceTextForBots({ stateDir, location: LOCATION });
  console.log(stripCode(html));
  return 0;
}

/** Minimal HTML→text for the one <code> block /allowance sends. */
function stripCode(html) {
  return String(html)
    .replace(/^<code>/, '').replace(/<\/code>$/, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Stamp + move: the shared in-job quota switch (same call the tmux watcher makes). */
function cmdQuotaHit(opts) {
  if (!opts.model || !opts.reason) usage('quota-hit needs --model and --reason');
  const { tablePath, sessionPath } = loadSwitchLedger({});
  const pool = opts.pool ? resolvePoolName(opts.pool) : null;
  const plan = applyQuotaHit({
    tablePath, sessionPath, provider: opts.provider || '', model: opts.model,
    reason: opts.reason, pool,
  });
  const out = {
    laneFound: plan.laneFound,
    pool: plan.pool,
    until: plan.untilIso,
    kind: plan.kind,
    bucket: plan.bucketId,
    stamped: plan.stamped,
    next: plan.next,
    exhausted: plan.exhausted,
    soonest: plan.soonest?.label || null,
  };
  if (opts.json) console.log(JSON.stringify(out));
  else if (plan.next) console.log(`stamped ${plan.bucketId ? `bucket:${plan.bucketId}` : `${plan.provider}/${plan.model}`} until ${plan.untilIso}; next ${plan.next.tool} ${plan.next.model}`);
  else console.log(`stamped until ${plan.untilIso}; pool ${plan.pool || '?'} EMPTY${plan.soonest?.label ? ` (soonest reset ${plan.soonest.label})` : ''}`);
  return plan.next ? 0 : 3;
}

const argv = process.argv.slice(2);
const [cmd, ...tail] = argv;
const opts = parseArgs(tail);
switch (cmd) {
  case 'light_free':
  case 'free':
  case 'go':
    process.exit(cmdPool(cmd, opts));
    break;
  case 'pick':
    if (!opts.rest.length) usage('pick needs a pool name');
    process.exit(cmdPick(opts.rest[0], opts));
    break;
  case 'list':
    process.exit(cmdList(opts));
    break;
  case 'allowance':
    process.exit(cmdAllowance());
    break;
  case 'quota-hit':
    process.exit(cmdQuotaHit(opts));
    break;
  case undefined:
  case '--help':
  case '-h':
    usage();
    break;
  default:
    if (resolvePoolName(cmd)) process.exit(cmdPool(cmd, opts));
    usage(`unknown command "${cmd}"`);
}

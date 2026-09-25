#!/usr/bin/env node
/**
 * scripts/probe-tool-allowance.mjs
 *
 * Active allowance ping across the coding-tool pool (opencode / cline / grok /
 * agy) — the counterpart to `scripts/probe-free-lanes.mjs`, which probes
 * per-model lanes. Answers "how much of each tool's allowance is left?" by
 * classifying one minimal ping per tool and stamping BOTH ledgers:
 *
 *   - ~/.hermes/tool_allowances.json via scripts/tool-allowance.mjs reportResult
 *   - the shared free-lane ledger via scripts/lib/free-lanes.mjs stampDepleted
 *     (only when the tool's default model maps to an opencode lane)
 *
 * Zero-burn by default: prints the current state of both ledgers (tool status
 * + depleted lanes + reset clocks) without spending any quota.
 *
 * Burn policy (single-ping by default, mirrors probe-free-lanes.mjs):
 *   node scripts/probe-tool-allowance.mjs --ping                    # one ping: highest-priority healthy tool
 *   node scripts/probe-tool-allowance.mjs --ping --tool=cline       # one ping: that tool only
 *   node scripts/probe-tool-allowance.mjs --ping-all                # every healthy tool (explicit opt-in)
 *
 * Never loops retries, never pings depleted/unavailable/cooldown tools (their
 * state is already proven — burning quota there is waste), and never depletes
 * a tool without vendor quota proof (doc-noise and empty errors are refused by
 * the shared stamp helper).
 *
 * --dry-run prints what would be pinged/stamped and touches nothing.
 */
import path from 'node:path';
import {
  loadState,
  refreshCooldowns,
  reportResult,
  isBinaryInstalled,
} from './tool-allowance.mjs';
import {
  classifyPingResult,
  buildPingSummary,
  pickPingTargets,
  laneRouteForTool,
  PING_PROMPT,
} from './lib/tool-allowance-ping.mjs';
import { extractLogError } from './lib/agent-opencode.mjs';
import { runOpencode } from './lib/agent-opencode.mjs';
import { runCline } from './lib/agent-cline.mjs';
import { stampDepleted, loadFreeLaneLedger } from './lib/free-lanes.mjs';
import { listFreeOpenCode } from './lib/freemodels.mjs';

const args = process.argv.slice(2);
const argVal = (name) => {
  const i = args.findIndex((a) => a === `--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  const kv = args.find((a) => a.startsWith(`--${name}=`));
  return kv ? kv.slice(name.length + 3) : null;
};
const DRY = args.includes('--dry-run');
const PING = args.includes('--ping');
const PING_ALL = args.includes('--ping-all');
const TOOL = argVal('tool');
const TIMEOUT = Number(argVal('timeout') || 90000);

if (TOOL && !PING && !PING_ALL) {
  console.error('--tool only makes sense with --ping');
  process.exit(2);
}
if (PING_ALL && TOOL) {
  console.error('--ping-all and --tool are mutually exclusive');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Zero-burn map: both ledgers, no pings.
// ---------------------------------------------------------------------------
const state = loadState();
refreshCooldowns(state);
console.log('=== Tool allowance (state + free-lane ledger, zero-burn) ===');
for (const [key, tool] of Object.entries(state.tools)) {
  const installed = isBinaryInstalled(key);
  const cooldown = tool.cooldown_until && new Date(tool.cooldown_until).getTime() > Date.now();
  console.log(
    `- ${tool.name} (${key}): Installed=${installed}, Status=${tool.status}, Allowance=${tool.allowance_level}` +
      `${cooldown ? ` (cooldown until ${tool.cooldown_until})` : ''}`
  );
}
const ledger = loadFreeLaneLedger({});
const depletedLanes = (ledger.table?.lanes || []).filter((l) => {
  if (l.status !== 'depleted') return false;
  return !l.nextResetAt || Date.parse(l.nextResetAt) > Date.now();
});
console.log(`Free-lane ledger (${ledger.source}): ${depletedLanes.length} lane(s) currently depleted`);
for (const lane of depletedLanes) {
  const resetIn = lane.nextResetAt
    ? Math.max(0, Math.round((Date.parse(lane.nextResetAt) - Date.now()) / 60000))
    : null;
  console.log(`  ❌ ${lane.label || lane.model} — reset in ${resetIn != null ? `${resetIn}m` : 'unknown'}`);
}
if (!PING && !PING_ALL) {
  console.log('\nzero-burn map done (no quota spent). Add --ping for one minimal allowance ping.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Burn pings (opt-in).
// ---------------------------------------------------------------------------
const targets = pickPingTargets(state, { tool: TOOL });
if (!targets.length) {
  console.log('no ping target: every tool is depleted, unavailable, in cooldown, or not installed (nothing to ping — saves quota)');
  process.exit(0);
}
if (!PING_ALL && targets.length > 1) targets.length = 1; // single-ping policy

const workspace = process.cwd();
const results = [];
for (const target of targets) {
  const runner = pickRunner(target.tool);
  if (!runner) {
    console.log(`skip ${target.tool}: no local burn path (probe state only)`);
    results.push({ tool: target.tool, verdict: 'inconclusive', reason: 'no ping runner for tool' });
    continue;
  }
  console.log(`ping ${target.tool}${target.defaultModel ? ` (${target.defaultModel})` : ''} — "${PING_PROMPT}", timeout ${TIMEOUT}ms…`);
  if (DRY) {
    console.log('  dry-run: would send one minimal ping; ledger untouched');
    results.push({ tool: target.tool, verdict: 'inconclusive', reason: 'dry-run' });
    continue;
  }
  let result;
  try {
    result = await runner({ target, timeoutMs: TIMEOUT, workspace });
  } catch (e) {
    result = { code: -1, finalText: '', lastError: String(e?.message || e), stderr: '' };
  }
  const filtered = extractLogError(result?.stderr || '') || String(result?.lastError || '');
  const verdict = classifyPingResult({ ...result, filteredError: filtered });
  results.push({ tool: target.tool, ...verdict });
  console.log(`  ${verdict.verdict === 'alive' ? '✅' : verdict.verdict === 'depleted' ? '❌' : '⚠️'} ${verdict.verdict}: ${verdict.reason.slice(0, 160)}${verdict.retryHint ? ` [${verdict.retryHint}]` : ''}`);

  // Stamp tool ledger (passive vocabulary, same as dispatch failures).
  if (verdict.verdict === 'alive') {
    reportResult(target.tool, 'success', { reason: 'allowance ping' });
    console.log(`  stamped tool ledger: ${target.tool} → success`);
  } else if (verdict.verdict === 'depleted') {
    reportResult(target.tool, 'rate_limited', { reason: verdict.reason.slice(0, 160) });
    console.log(`  stamped tool ledger: ${target.tool} → rate_limited (cooldown)`);
    // Stamp the shared free-lane ledger too when the default model maps to a lane.
    const lane = laneRouteForTool(target);
    if (lane) {
      const stamped = stampDepleted({
        stateDir: path.dirname(ledger.tablePath || ''),
        provider: lane.provider,
        model: lane.model,
        errText: verdict.reason,
        depletedUntil: null, // default TTL; vendor countdown parsed upstream
      });
      console.log(`  lane stamp: ${stamped.stamped ? `${lane.provider}/${lane.model} (${stamped.keys.join(', ')})` : stamped.reason}`);
    }
  } else {
    console.log('  ledger untouched (no deplete stamp without quota proof)');
  }
}

const summary = buildPingSummary(results);
console.log(`\nSummary: ${summary.counts.alive} alive, ${summary.counts.depleted} depleted, ${summary.counts.inconclusive} inconclusive`);

/**
 * Location-scoped model resolution (BOT-24 rule: trust this host's catalog,
 * never another host's list). Returns { model, swapped } — the recorded
 * default when the local OpenCode catalog exposes it, otherwise the first
 * locally-catalogued free model. When no catalog is readable the recorded
 * default is kept and the ping will simply classify honestly.
 */
function resolvePingModel(target) {
  if (target.tool !== 'opencode') return { model: target.defaultModel, swapped: false };
  let refs = [];
  try {
    refs = listFreeOpenCode();
  } catch {
    refs = [];
  }
  if (!refs.length) return { model: target.defaultModel, swapped: false };
  const want = String(target.defaultModel || '');
  const bare = want.replace(/^opencode\//, '');
  if (want && (refs.includes(want) || refs.includes(`opencode/${bare}`))) {
    return { model: want, swapped: false };
  }
  return { model: refs[0], swapped: true };
}

/**
 * Pre-burn failure: opencode could not resolve the model at all (stale disk
 * cache vs live server catalog), so no quota was spent and one retry with the
 * next locally-catalogued model is still single-ping policy. Matches the
 * router's "pending-expose" / "pick again from /freemodel" vocabulary.
 */
function isModelNotFoundError(errText) {
  return /ProviderModelNotFoundError|Model not found|model list may be stale/i.test(String(errText || ''));
}

function pickRunner(tool) {
  if (tool === 'opencode') {
    return async ({ target, timeoutMs, workspace: ws }) => {
      const { model, swapped } = resolvePingModel(target);
      if (swapped) {
        console.log(`  catalog swap: recorded default '${target.defaultModel}' not on this host — pinging locally-catalogued '${model}' (BOT-24 location rule)`);
      }
      // OpenCode resolves full provider/model refs (probe-free-lanes builds
      // `${provider}/${model}` the same way); a bare id 404s pre-burn.
      const modelRef = (m) => (String(m || '').includes('/') ? m : `opencode/${m}`);
      let child = null;
      const pingOnce = (m) => runOpencode({
        prompt: PING_PROMPT,
        model: modelRef(m),
        workspace: ws,
        thinking: false,
        timeoutMs,
        onSpawn: (c) => { child = c; },
        onEvent: (ev) => {
          // Minimal-burn early-kill: the lane is proven alive on first text, so
          // stop the run instead of burning the full agent turn (same policy as
          // scripts/probe-free-lanes.mjs).
          if (child && ev && ev.kind === 'text' && String(ev.text || '').trim()) {
            try { child.kill('SIGKILL'); } catch {}
          }
        },
      });
      const first = await pingOnce(model);
      const firstFiltered = extractLogError(first?.stderr || '') || String(first?.lastError || '');
      if (!String(first?.finalText || '').trim() && isModelNotFoundError(firstFiltered)) {
        // Pre-burn failure (model never resolved): retry once on the next
        // locally-catalogued free model — never on quota/timeout errors.
        let refs = [];
        try { refs = listFreeOpenCode().filter((r) => r !== model && r !== `opencode/${String(model || '').replace(/^opencode\//, '')}`); } catch {}
        const next = refs[0];
        if (!next) return first;
        console.log(`  stale catalog: '${model}' not exposed by the live server — one retry on '${next}' (first attempt never reached the provider)`);
        return pingOnce(next);
      }
      return first;
    };
  }
  if (tool === 'cline') {
    return async ({ timeoutMs, workspace: ws }) =>
      runCline({
        prompt: PING_PROMPT,
        model: 'deepseek',
        workspace: ws,
        timeoutMs,
      });
  }
  return null; // grok/agy: no safe non-interactive one-shot burn path yet
}

/**
 * Agnostic lane contract for BOT-17.
 *
 * A bot id is a place. The runner for a message is a surface, not an agent.
 * A model is a backend. There is no Cline agent and no Gemini agent.
 *
 * Each backend lane declares what it can honor. A lane that cannot honor
 * session, memory, the typed ticket, or the crash receipt is marked
 * degraded — callers must route around the gap instead of assuming it.
 * An API-only backend declares no tools and no session.
 *
 * The dev is a transient process the dispatch script spawns — never a bot,
 * never a registry row. Any backend may fill the Specify, Implement, or
 * Verify role; the card, packet, and gates do not change per backend.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROLES = ['specify', 'implement', 'verify'];

/**
 * Lane table. `degraded` lists the capabilities the lane cannot honor:
 * session (resume/continuation), memory, ticket (typed work_item), receipt
 * (crash receipt). `apiOnly` lanes additionally declare no tools.
 */
export const LANES = {
  opencode: {
    kind: 'cli', apiOnly: false, tools: true, session: true,
    degraded: [], roles: [...ROLES],
  },
  cline: {
    kind: 'cli', apiOnly: false, tools: true, session: false,
    degraded: ['resume'],
    degradedReason: 'Cline CLI 3.0.65 headless-resume is broken (--id forces interactive mode); every run starts fresh.',
    roles: [...ROLES],
  },
  grok: {
    kind: 'cli', apiOnly: false, tools: true, session: false,
    degraded: ['resume'],
    degradedReason: 'Grok Build CLI runs headless prompts with no session resume.',
    roles: [...ROLES],
  },
  agy: {
    kind: 'cli', apiOnly: false, tools: true, session: false,
    degraded: ['resume'],
    degradedReason: 'Antigravity CLI is location-blocked on VPS/cloud IPs; phone-only.',
    roles: [...ROLES],
  },
  gemini: {
    kind: 'api', apiOnly: true, tools: false, session: false,
    degraded: ['resume', 'tools', 'plan'],
    degradedReason: 'Single-shot answers only — no tools, no session resume, no plan mode, no variants.',
    roles: [...ROLES],
  },
  freebuff: {
    kind: 'api', apiOnly: true, tools: false, session: false,
    degraded: ['resume', 'tools', 'plan'],
    degradedReason: 'Single-shot Freebuff API answers only — no tools, no session resume, no plan mode, no variants.',
    roles: [...ROLES],
  },
  human: {
    kind: 'person', apiOnly: false, tools: true, session: true,
    degraded: [], roles: [...ROLES],
  },
};

/** Bot ids that would mistake an agent, model, or process for a place. */
export const FORBIDDEN_BOT_IDS = [
  'dev', 'dispatch', 'coder', 'agent',
  'cline', 'gemini', 'opencode', 'grok', 'antigravity', 'agy', 'freebuff',
];

/**
 * Legacy exception, locked by the gate below: registry id "opencode" is the
 * VPS interactive door (a place since BOT-1, plan/BOT_ROLES.md §0), not a
 * backend claim. The list must never grow — no new agent-named rows.
 */
export const GRANDFATHERED_IDS = ['opencode'];

/** Registry runtimes that are surfaces (places), never backends. */
export const SURFACE_RUNTIMES = new Set(['bot-host', 'device', 'hermes', 'collab', 'tg-provider-router']);

/** Describe a backend lane. Throws on unknown lane. */
export function laneFor(backend) {
  const lane = LANES[String(backend ?? '').toLowerCase()];
  if (!lane) throw new Error(`lane-contract: unknown backend "${backend}"`);
  return { backend: String(backend).toLowerCase(), ...lane };
}

/** True when the lane cannot honor the capability. Unknown lane throws. */
export function isDegraded(backend, capability) {
  return laneFor(backend).degraded.includes(String(capability));
}

/** True when the lane may fill the role. Unknown lane throws. */
export function canFill(backend, role) {
  return laneFor(backend).roles.includes(String(role));
}

/**
 * Validate one registry bot row against the contract. Returns violations[].
 * - id must be a place, never an agent/model/process name;
 * - runtime must be a known surface;
 * - the dev process must never appear as a registry row.
 */
export function checkBotRow(bot = {}) {
  const violations = [];
  const id = String(bot.id ?? '');
  if (!id) {
    violations.push('bot row has no id');
    return violations;
  }
  if (FORBIDDEN_BOT_IDS.includes(id.toLowerCase()) && !GRANDFATHERED_IDS.includes(id)) {
    violations.push(`bot id "${id}" names an agent/model/process, not a place`);
  }
  const runtime = bot.runtime || 'bot-host';
  if (!SURFACE_RUNTIMES.has(runtime)) {
    violations.push(`bot "${id}" runtime "${runtime}" is not a known surface`);
  }
  return violations;
}

/** Validate a whole registry object. Returns violations[]. Never throws. */
export function checkRegistry(registry = {}) {
  const violations = [];
  for (const bot of registry.bots || []) {
    for (const v of checkBotRow(bot)) violations.push(v);
  }
  return violations;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

function printUsage() {
  console.log('usage: lane-contract.mjs <lane|check-bot|check-registry> [options]');
  console.log('  lane --backend=X');
  console.log('  check-bot --id=X [--runtime=Y]');
  console.log('  check-registry [--registry=PATH]');
}

async function cli(argv) {
  const { default: fs } = await import('node:fs');
  const [cmd, ...rest] = argv;
  const opts = {};
  for (const a of rest) {
    const m = a.match(/^--([^=]+)=(.*)$/s);
    if (m) opts[m[1]] = m[2];
    else if (a.startsWith('--')) opts[a.slice(2)] = '1';
  }
  switch (cmd) {
    case 'lane': {
      console.log(JSON.stringify(laneFor(opts.backend), null, 2));
      break;
    }
    case 'check-bot': {
      const violations = checkBotRow({ id: opts.id, runtime: opts.runtime });
      console.log(JSON.stringify({ ok: violations.length === 0, violations }, null, 2));
      process.exitCode = violations.length ? 1 : 0;
      break;
    }
    case 'check-registry': {
      const { resolveRegistryPath, loadRegistry } = await import('./registry.mjs');
      const repoRoot = path.resolve(HERE, '..', '..');
      const registry = loadRegistry(resolveRegistryPath(opts.registry, repoRoot));
      const violations = checkRegistry(registry);
      console.log(JSON.stringify({ ok: violations.length === 0, violations }, null, 2));
      process.exitCode = violations.length ? 1 : 0;
      break;
    }
    default:
      printUsage();
      process.exitCode = 2;
  }
}

const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedAs === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).catch((err) => {
    console.error(`lane-contract: ${err.message}`);
    process.exit(1);
  });
}

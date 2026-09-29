#!/usr/bin/env node
/**
 * assert-bot-clone.mjs — the registry clone contract.
 *
 * WHY THIS EXISTS
 * ---------------
 * `bots/registry.json` declares a `master` (`vm`), and `scripts/lib/registry.mjs`
 * `applyMasterDefaults()` merges that master's `agent` / `progress` / `session`
 * onto every bot of the same runtime, with `extends` naming a specific parent
 * and `agent.skills` adding to the inherited shared skills. That inheritance is
 * the reason "a new bot is a duplicate of the VM bot" is true at all: a bot row
 * declares only what is genuinely its own, and it cannot lose a feature the
 * fleet already has.
 *
 * Nothing verified it. A hand-copied `agent` block resolves identically the day
 * it is written and diverges silently the day the master moves: the master gets
 * a new model, a new shared skill, a tighter progress budget, and the copy
 * keeps the old value. The bot still boots, still answers, and has quietly
 * stopped being a clone. That is the exact failure the plan calls "features
 * shouldn't be lost" — and it is invisible without a gate, because the config
 * is still *valid*.
 *
 * WHAT IT ASSERTS (per same-runtime bot)
 * --------------------------------------
 *   1. no hand-copied block — a raw row may restate only the declared per-bot
 *      allowlist below; restating anything the master already supplies is a
 *      copy, not a clone
 *   2. no undeclared override — a raw value that differs from the master's must
 *      be allowlisted, so an inherited surface cannot be forked by accident
 *   3. no resolved drift — after inheritance every non-allowlisted leaf equals
 *      the master's
 *   4. no lost skills — resolved `agent.sharedSkills` is a superset of the
 *      master's (a clone may add skills, never drop them)
 *   5. no forked command surface — the registry may not re-declare commands;
 *      `scripts/lib/commands.mjs` (+ `bots/capabilities.json`) own that, and
 *      `scripts/assert-command-scope.mjs` is their gate
 *   6. no shared token — one Telegram token = one `getUpdates` poller
 *
 * Foreign-runtime rows (`hermes`, `collab`, `device`, a pointer runtime) are
 * self-contained in `applyMasterDefaults` by design: they are reported as
 * declared exemptions, never silently skipped.
 *
 * Usage:
 *   node scripts/assert-bot-clone.mjs
 *   node scripts/assert-bot-clone.mjs --json
 *   node scripts/assert-bot-clone.mjs --registry=/path/to/registry.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRegistry, resolveRegistryPath } from './lib/registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/**
 * The only keys a bot-host bot may declare for itself. Everything else comes
 * from the master, so that one edit to `vm` reaches the whole fleet. This list
 * is deliberately short and reviewed: adding a path here is the deliberate act
 * that a per-bot difference is supposed to require.
 */
export const PER_BOT_KEYS = new Set([
  // Identity and lifecycle.
  'id',
  'name',
  'runtime',
  'enabled',
  'extends',
  'notes',
  // Foreign-runtime pointers document themselves and are never started here.
  'hermes',
  'path',
  // Its own Telegram token (mandatory) and its own access list.
  'telegram',
  // Where this bot writes screenshots, which checkout it edits, which host
  // binary it calls. Per-bot facts, not fleet policy.
  'agent.playwrightOutputDir',
  'agent.workspace',
  'agent.opencodeBin',
  'agent.clineBin',
  // The documented way to add a skill: additive onto the inherited list.
  'agent.skills',
]);

/**
 * Paths owned by a more specific check below. `agent.sharedSkills` is the
 * additive surface: `agent.skills` on a child appends to it, so it is ALLOWED to
 * differ from the master — check 4 bounds it with a superset rule instead.
 */
const CHECKED_ELSEWHERE = new Set(['agent.sharedSkills']);

/** Surfaces the registry must never fork — their owners are named in the error. */
const FORBIDDEN_REGISTRY_KEYS = {
  commands: 'scripts/lib/commands.mjs (+ bots/capabilities.json `ui-commands`)',
  telegramCommands: 'scripts/lib/commands.mjs (+ bots/capabilities.json `ui-commands`)',
};

/** Every scalar leaf path in an object, so a nested copy is still a copy. */
export function leafPaths(value, prefix = '') {
  if (value === null || typeof value !== 'object') return prefix ? [prefix] : [];
  if (Array.isArray(value)) return prefix ? [prefix] : [];
  const out = [];
  for (const key of Object.keys(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    out.push(...leafPaths(value[key], next));
  }
  return out;
}

function readLeaf(obj, dotPath) {
  return dotPath.split('.').reduce((acc, key) => (acc === undefined || acc === null ? undefined : acc[key]), obj);
}

const shown = (v) => (typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v ?? null));

/**
 * The whole gate as a pure function, so the sensor can drive it with fixtures
 * (including registries that are supposed to fail) instead of the real tree.
 *
 * @param {{ raw: {master?: string, bots: object[]}, resolved: {master?: string, bots: object[]} }} input
 */
export function audit({ raw = {}, resolved = {} }) {
  const failures = [];
  const passes = [];
  const exemptions = [];

  const rawBots = Array.isArray(raw.bots) ? raw.bots : [];
  const resolvedBots = Array.isArray(resolved.bots) ? resolved.bots : [];
  const masterId = resolved.master || raw.master || rawBots[0]?.id || '';

  const resolvedById = new Map(resolvedBots.map((b) => [b.id, b]));
  const master = resolvedById.get(masterId);
  if (!master) {
    failures.push({ kind: 'no-master', bot: masterId || '(none)', path: 'master', detail: 'registry master does not resolve to a bot row' });
    return { ok: false, masterId, failures, passes, exemptions };
  }
  const rawMaster = rawBots.find((b) => b.id === masterId);
  if (rawMaster?.extends) {
    failures.push({ kind: 'master-extends', bot: masterId, path: 'extends', detail: `master must not extend another bot (declares "${rawMaster.extends}")` });
  }
  const masterRuntime = master.runtime || 'bot-host';

  // 6. one token, one poller — checked on the raw rows, before inheritance can
  // hide a duplicate behind a merge.
  const byToken = new Map();
  for (const bot of rawBots) {
    const tokenEnv = bot?.telegram?.tokenEnv;
    if (!tokenEnv) continue;
    byToken.set(tokenEnv, [...(byToken.get(tokenEnv) || []), bot.id]);
  }
  for (const [tokenEnv, ids] of byToken) {
    if (ids.length > 1) {
      failures.push({ kind: 'shared-token', bot: ids.join(' + '), path: `telegram.tokenEnv`, detail: `${tokenEnv} is shared by ${ids.length} bots — one token is one poller` });
    }
  }

  // 5. the command surface is global; a registry row that declares commands is
  // a fork of scripts/lib/commands.mjs.
  for (const bot of [...rawBots, ...resolvedBots]) {
    for (const key of Object.keys(FORBIDDEN_REGISTRY_KEYS)) {
      if (bot && Object.prototype.hasOwnProperty.call(bot, key)) {
        failures.push({ kind: 'command-fork', bot: bot.id || '(unknown)', path: key, detail: `the command surface is owned by ${FORBIDDEN_REGISTRY_KEYS[key]}` });
      }
    }
  }

  const masterLeaves = new Set(leafPaths(master));

  for (const botRow of rawBots) {
    const id = botRow?.id || '(unknown)';
    const resolvedBot = resolvedById.get(id);
    if (!resolvedBot) continue;
    const runtime = resolvedBot.runtime || 'bot-host';

    if (runtime !== masterRuntime) {
      exemptions.push({ bot: id, runtime, reason: `runtime "${runtime}" is not the master runtime ("${masterRuntime}") — self-contained by applyMasterDefaults` });
      continue;
    }
    if (id === masterId) {
      passes.push({ bot: id, detail: 'master (inheritance source)' });
      continue;
    }

    const botFailures = [];

    // 1 + 2. What the row restates, and whether that is legitimate.
    for (const dotPath of leafPaths(botRow)) {
      if (PER_BOT_KEYS.has(dotPath)) continue;
      // A parent path may be allowlisted as a whole subtree (e.g. `telegram`).
      const coveredBySubtree = [...PER_BOT_KEYS].some((allowed) => dotPath === allowed || dotPath.startsWith(`${allowed}.`));
      if (coveredBySubtree) continue;
      const own = readLeaf(botRow, dotPath);
      const inherited = readLeaf(master, dotPath);
      if (masterLeaves.has(dotPath) && JSON.stringify(own) === JSON.stringify(inherited)) {
        botFailures.push({ kind: 'hand-copied-block', bot: id, path: dotPath, detail: `restates the master's value (${shown(own)}) — delete it, the master supplies it` });
      } else {
        botFailures.push({ kind: 'undeclared-override', bot: id, path: dotPath, detail: `differs from the master (${shown(own)} vs ${shown(inherited)}) and is not an allowlisted per-bot key` });
      }
    }

    // 3. After inheritance, every non-allowlisted leaf must equal the master's.
    for (const dotPath of leafPaths(resolvedBot)) {
      if (PER_BOT_KEYS.has(dotPath) || CHECKED_ELSEWHERE.has(dotPath)) continue;
      const coveredBySubtree = [...PER_BOT_KEYS].some((allowed) => dotPath === allowed || dotPath.startsWith(`${allowed}.`));
      if (coveredBySubtree) continue;
      const mine = readLeaf(resolvedBot, dotPath);
      const inherited = readLeaf(master, dotPath);
      if (JSON.stringify(mine) !== JSON.stringify(inherited)) {
        botFailures.push({ kind: 'resolved-drift', bot: id, path: dotPath, detail: `resolves to ${shown(mine)}, master resolves to ${shown(inherited)}` });
      }
    }

    // 4. A clone may add skills; dropping one is how a bot silently loses a feature.
    const masterSkills = Array.isArray(master.agent?.sharedSkills) ? master.agent.sharedSkills : [];
    const botSkills = Array.isArray(resolvedBot.agent?.sharedSkills) ? resolvedBot.agent.sharedSkills : [];
    for (const skill of masterSkills) {
      if (!botSkills.includes(skill)) {
        botFailures.push({ kind: 'skills-lost', bot: id, path: 'agent.sharedSkills', detail: `does not inherit "${skill}" — a clone never drops a master skill` });
      }
    }

    if (botFailures.length) failures.push(...botFailures);
    else {
      passes.push({
        bot: id,
        detail: `thin row (extends ${botRow.extends || masterId}), ${botSkills.length}/${masterSkills.length} shared skills`,
      });
    }
  }

  return { ok: failures.length === 0, masterId, failures, passes, exemptions };
}

/* ------------------------------------------------------------------ CLI -- */

function parseArgs(argv) {
  const args = { json: false, registry: '' };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg.startsWith('--registry=')) args.registry = arg.slice('--registry='.length);
  }
  return args;
}

/** Load a registry off disk and audit it. The sensor calls this on the real tree. */
export function run({ registry = '' } = {}) {
  const registryPath = resolveRegistryPath(registry || null, ROOT);
  const raw = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const resolved = loadRegistry(registryPath);
  const result = audit({ raw, resolved });
  return { registryPath, ...result };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = run({ registry: args.registry });

  if (args.json) {
    console.log(JSON.stringify({ registry: result.registryPath, ...result }, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  console.log(`assert-bot-clone — registry clone contract (master: ${result.masterId})\n`);
  for (const p of result.passes) console.log(`  PASS   ${p.bot}: ${p.detail}`);
  for (const e of result.exemptions) console.log(`  exempt ${e.bot}: ${e.reason}`);
  for (const f of result.failures) console.log(`  FAIL   ${f.bot} [${f.kind}] ${f.path}: ${f.detail}`);

  console.log(`\n${result.passes.length} pass, ${result.failures.length} fail, ${result.exemptions.length} exempt.`);
  if (result.failures.length) {
    console.log('\nA new bot is a thin row: id, name, runtime, enabled, telegram.tokenEnv,');
    console.log('extends: "vm", plus only the allowlisted per-bot keys (scripts/add-bot.mjs does this).');
    process.exitCode = 1;
    return;
  }
  console.log('✅ every same-runtime bot is a clone of the master.');
}

const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedAs === fileURLToPath(import.meta.url)) main();

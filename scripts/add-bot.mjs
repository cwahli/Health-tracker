#!/usr/bin/env node
/**
 * add-bot.mjs — scaffold a new bot as a THIN registry row.
 *
 * THE CONTRACT
 * ------------
 * `bots/registry.json` names a `master` (`vm`). `scripts/lib/registry.mjs`
 * `applyMasterDefaults()` merges that master's `agent` / `progress` / `session`
 * onto every bot of the same runtime, `extends` names a specific parent, and
 * `agent.skills` adds to the inherited shared skills.
 *
 * So a new bot is not a copy of the VM bot — it is the VM bot plus a name, a
 * token and (at most) a screenshot directory. That is what keeps the features
 * already built for this fleet from being lost one bot at a time: there is only
 * ever one place a shared surface is written, and `scripts/assert-bot-clone.mjs`
 * fails the build if a row restates or drifts from it.
 *
 * This script writes exactly that row and refuses to write one that would break
 * the contract. It does NOT mint a token (only @BotFather can) and does not
 * start the service — it prints those steps.
 *
 * Usage:
 *   node scripts/add-bot.mjs --id=vm3 --name="VM3 Bot" --token-env=VM3_BOT_TOKEN
 *   node scripts/add-bot.mjs --id=vm3 --name="VM3 Bot" --dry-run
 *   node scripts/add-bot.mjs --id=vm3 --name="VM3 Bot" [--extends=vm]
 *                            [--playwright-output-dir=/tmp/bot-host-shots-vm3]
 *                            [--json]
 *
 * The bot is written `enabled: false` on purpose: it stays dark until one live
 * reply proves it, which is the rule `bots/TOKENS.md` already states.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyMasterDefaults } from './lib/registry.mjs';
import { audit, PER_BOT_KEYS } from './assert-bot-clone.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REGISTRY_PATH = path.join(ROOT, 'bots', 'registry.json');

const ID_RE = /^[a-z][a-z0-9_]{1,30}$/;

/** A bot id is a place, not a model or a process: lowercase, short, stable. */
export function validateId(id) {
  if (!id) return 'an --id is required';
  if (!ID_RE.test(id)) return `"${id}" must match ${ID_RE} (a lowercase place name, e.g. vm3)`;
  return '';
}

/** The master's own key derivation is a convention, not a secret: VM3_BOT_TOKEN. */
export function tokenEnvFor(id) {
  return `${String(id).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_BOT_TOKEN`;
}

/**
 * Build the thin row. Nothing here may restate an inherited surface: the whole
 * value of the row is that it declares only what is genuinely this bot's own.
 */
export function buildThinRow({ id, name, tokenEnv, extendsId, playwrightOutputDir = '' }) {
  const row = {
    id,
    name,
    runtime: 'bot-host',
    enabled: false,
    extends: extendsId,
    notes: 'Thin clone of the registry master (scripts/add-bot.mjs): agent/progress/session are inherited. Add a per-bot difference only by allowlisting the key in scripts/assert-bot-clone.mjs.',
    telegram: { tokenEnv },
  };
  if (playwrightOutputDir) row.agent = { playwrightOutputDir };
  return row;
}

/** Every leaf path the row declares that the contract does not allow. */
export function disallowedKeys(row) {
  const walk = (value, prefix = '') => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return prefix ? [prefix] : [];
    return Object.keys(value).flatMap((k) => walk(value[k], prefix ? `${prefix}.${k}` : k));
  };
  return walk(row).filter((dotPath) => {
    if (PER_BOT_KEYS.has(dotPath)) return false;
    return ![...PER_BOT_KEYS].some((allowed) => dotPath.startsWith(`${allowed}.`));
  });
}

function parseArgs(argv) {
  const args = { dryRun: false, json: false, id: '', name: '', tokenEnv: '', extendsId: '', playwrightOutputDir: '' };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--json') args.json = true;
    else if (arg.startsWith('--id=')) args.id = arg.slice('--id='.length).trim();
    else if (arg.startsWith('--name=')) args.name = arg.slice('--name='.length).trim();
    else if (arg.startsWith('--token-env=')) args.tokenEnv = arg.slice('--token-env='.length).trim();
    else if (arg.startsWith('--extends=')) args.extendsId = arg.slice('--extends='.length).trim();
    else if (arg.startsWith('--playwright-output-dir=')) args.playwrightOutputDir = arg.slice('--playwright-output-dir='.length).trim();
  }
  return args;
}

/**
 * Plan a scaffold against a parsed registry without touching disk, so the
 * caller can validate before writing and tests can drive it with fixtures.
 */
export function planAddBot({ registry, id, name, tokenEnv = '', extendsId = '', playwrightOutputDir = '' }) {
  const problem = validateId(id);
  if (problem) return { ok: false, reason: problem };
  if (!name) return { ok: false, reason: '--name is required (what the bot calls itself)' };
  if ((registry.bots || []).some((b) => b.id === id)) return { ok: false, reason: `bot "${id}" is already in the registry` };

  const masterId = registry.master || registry.bots?.[0]?.id || '';
  const master = (registry.bots || []).find((b) => b.id === masterId);
  if (!master) return { ok: false, reason: `registry master "${masterId}" is missing` };
  const parentId = extendsId || masterId;
  if (!(registry.bots || []).some((b) => b.id === parentId)) return { ok: false, reason: `--extends="${parentId}" is not a registry bot` };

  const token = tokenEnv || tokenEnvFor(id);
  if ((registry.bots || []).some((b) => b.telegram?.tokenEnv === token)) {
    return { ok: false, reason: `tokenEnv "${token}" is already used — one Telegram token is one poller` };
  }

  const row = buildThinRow({ id, name, tokenEnv: token, extendsId: parentId, playwrightOutputDir });

  const stray = disallowedKeys(row);
  if (stray.length) return { ok: false, reason: `the scaffold declares non-per-bot keys: ${stray.join(', ')}` };

  // The row is only correct if the real inheritance engine resolves it into a
  // clone. Audit the prospective registry before anything is written.
  const next = { ...registry, bots: [...registry.bots, row] };
  const result = audit({ raw: next, resolved: applyMasterDefaults(structuredClone(next)) });
  if (!result.ok) {
    return { ok: false, reason: 'the scaffold would fail the clone contract', failures: result.failures };
  }
  return { ok: true, masterId: parentId, row, next };
}

function printNextSteps({ id, tokenEnv, masterId }) {
  console.log('\nNext steps (none of these can be done from here):');
  console.log(`  1. mint the token:  @BotFather → /newbot → copy the token`);
  console.log(`  2. master token:    add ${tokenEnv}=<token> to ~/.config/bot-host/tokens.env`);
  console.log(`  3. propagate:       node scripts/sync-bot-tokens.mjs --check   (then without --check)`);
  console.log(`  4. supervise:       systemctl --user enable --now bot-host@${id}`);
  console.log(`  5. prove it:        one live reply, then set "enabled": true in bots/registry.json`);
  console.log(`\n${id} inherits agent/progress/session from "${masterId}" — do not restate them.`);
  console.log('Verify with: node scripts/assert-bot-clone.mjs');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const plan = planAddBot({ registry, ...args });

  if (!plan.ok) {
    if (args.json) console.log(JSON.stringify({ ok: false, reason: plan.reason, failures: plan.failures || [] }, null, 2));
    else {
      console.error(`add-bot: ${plan.reason}`);
      if (plan.failures) for (const f of plan.failures) console.error(`  ${f.bot} [${f.kind}] ${f.path}: ${f.detail}`);
    }
    process.exitCode = 1;
    return;
  }

  if (args.dryRun) {
    if (args.json) console.log(JSON.stringify({ ok: true, dryRun: true, row: plan.row, master: plan.masterId }, null, 2));
    else console.log(JSON.stringify(plan.row, null, 2));
    return;
  }

  fs.writeFileSync(REGISTRY_PATH, `${JSON.stringify(plan.next, null, 2)}\n`);
  if (args.json) console.log(JSON.stringify({ ok: true, wrote: REGISTRY_PATH, row: plan.row, master: plan.masterId }, null, 2));
  else {
    console.log(`scaffolded "${plan.row.id}" as a thin clone of "${plan.masterId}" in bots/registry.json (enabled: false)`);
    printNextSteps({ id: plan.row.id, tokenEnv: plan.row.telegram.tokenEnv, masterId: plan.masterId });
  }
}

const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedAs === fileURLToPath(import.meta.url)) main();

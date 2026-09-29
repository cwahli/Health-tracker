#!/usr/bin/env node
/**
 * Command-scope gate: the command popup must be true on every bot class.
 *
 * WHY THIS EXISTS
 * ---------------
 * `/tui` did not work on the Grok TG computer bot, and nothing failed. The
 * cause was a missing DECLARE step, not a bug: RELIABILITY.md §14.7 step 4
 * requires a capability row per class, but `bots/capabilities.json` had no
 * `tui` row at all, so step 5 (DISTRIBUTE) never ran and the router was never
 * given the command. The failure was silent because the propagation checker
 * validates STRUCTURE (rows, files, vendor drift) and never reads what a bot
 * actually publishes.
 *
 * The deeper defect is a forked source of truth. `scripts/lib/commands.mjs`
 * is canonical for the bot-host family, and the router carries its own
 * private BOT_COMMANDS copy at src/index.js — which ALIGNMENT.md:6 forbids
 * ("must not fork") and which the `ui-commands` notes actively contradict
 * ("Single BOT_COMMANDS source"). Two lists, no cross-check, so any drift is
 * invisible until a user taps a command that does nothing.
 *
 * WHAT IT ASSERTS
 * ---------------
 *   1. every canonical command has an explicit `grok_tg` verdict in the
 *      `ui-commands` matrix — so "we forgot" can never look like "no"
 *   2. every command the router publishes is either canonical-and-declared
 *      for grok_tg, or listed as a deliberate router-only extension
 *   3. the router's popup and the router's handlers are the same set — a
 *      published command that is not handled is a dead button in the chat
 *
 * Structural propagation stays owned by check-capability-propagation.mjs.
 * This gate is specifically about the user-visible command surface.
 *
 * Usage: node scripts/assert-command-scope.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL = path.join(ROOT, 'scripts', 'lib', 'commands.mjs');
const CAPS = path.join(ROOT, 'bots', 'capabilities.json');
const ROUTER = path.join(ROOT, 'tools', 'telegram-provider-router', 'src', 'index.js');

const CLASSES = ['hermes', 'vps', 'mobile', 'grok_tg', 'collab'];

/** Canonical commands + per-class matrix live together in one registry row. */
export function readRegistry() {
  const caps = JSON.parse(fs.readFileSync(CAPS, 'utf8'));
  const row = caps.capabilities.find((c) => c.id === 'ui-commands');
  if (!row) throw new Error('bots/capabilities.json has no `ui-commands` row');
  if (!row.commands || typeof row.commands !== 'object') {
    throw new Error('ui-commands has no `commands` matrix — add one command per entry');
  }
  return row;
}

/** Canonical command names, straight from the bot-host source of truth. */
export function readCanonicalCommands(src = fs.readFileSync(CANONICAL, 'utf8')) {
  const block = src.match(/export const BOT_COMMANDS = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error('could not find BOT_COMMANDS in scripts/lib/commands.mjs');
  return [...block[1].matchAll(/command:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

/** What the router publishes to Telegram, and what it actually handles. */
export function readRouterSurface(src = fs.readFileSync(ROUTER, 'utf8')) {
  const block = src.match(/const BOT_COMMANDS = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error('could not find the router BOT_COMMANDS copy');
  const published = [...block[1].matchAll(/command:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
  const handled = [...src.matchAll(/bot\.command\("([a-z0-9_]+)"/g)].map((m) => m[1]);
  return {
    published: [...new Set(published)].sort(),
    handled: [...new Set(handled)].sort(),
  };
}

/**
 * The whole gate as a pure function so the test can drive it with fixtures
 * instead of the real tree.
 */
export function audit({ canonical, published, handled, matrix, routerOnly = [], aliases = [] }) {
  const failures = [];
  const canonicalSet = new Set(canonical);

  // 1. every canonical command has an explicit grok_tg verdict.
  for (const cmd of canonical) {
    const verdict = matrix[cmd];
    if (verdict === undefined) {
      failures.push({
        kind: 'undeclared-command',
        command: cmd,
        detail: `/${cmd} is canonical but has no grok_tg verdict in ui-commands.commands — ` +
          'an undeclared command is how /tui went missing silently. Declare it true or false.',
      });
    } else if (typeof verdict !== 'boolean') {
      failures.push({
        kind: 'bad-verdict',
        command: cmd,
        detail: `/${cmd} has a non-boolean grok_tg verdict (${JSON.stringify(verdict)}). ` +
          'Use true/false; per-class glue belongs in notes.',
      });
    }
  }

  // 2. nothing published is undeclared, and router-only extras are deliberate.
  for (const cmd of published) {
    if (routerOnly.includes(cmd)) continue;
    if (!canonicalSet.has(cmd)) {
      failures.push({
        kind: 'orphan-published',
        command: cmd,
        detail: `router publishes /${cmd}, which is not canonical — add it to ` +
          'ui-commands.commands.routerOnly if it is a deliberate router extension.',
      });
    } else if (matrix[cmd] !== true) {
      failures.push({
        kind: 'published-but-excluded',
        command: cmd,
        detail: `router publishes /${cmd} but ui-commands declares grok_tg=false. ` +
          'Either implement it on the router or stop publishing it.',
      });
    }
  }

  // 3. a published command that is not handled is a dead button.
  for (const cmd of published) {
    if (!handled.includes(cmd)) {
      failures.push({
        kind: 'published-not-handled',
        command: cmd,
        detail: `router publishes /${cmd} in the Telegram popup but registers no ` +
          'bot.command handler for it — users see it and tapping does nothing.',
      });
    }
  }
  for (const cmd of handled) {
    // A declared alias is intentionally handled-but-unpublished: it stays
    // reachable for existing muscle memory without cluttering the popup.
    if (aliases.includes(cmd)) continue;
    if (!published.includes(cmd)) {
      failures.push({
        kind: 'handled-not-published',
        command: cmd,
        detail: `router handles /${cmd} but does not publish it — it is invisible ` +
          'in the popup and undiscoverable. Publish it, or declare it in ' +
          'ui-commands.commands.aliases if it is a deliberate hidden alias.',
      });
    }
  }

  // An alias must actually be handled, and must not also be published.
  for (const cmd of aliases) {
    if (!handled.includes(cmd)) {
      failures.push({
        kind: 'alias-not-handled',
        command: cmd,
        detail: `/${cmd} is declared a hidden alias but the router registers no handler for it.`,
      });
    }
    if (published.includes(cmd)) {
      failures.push({
        kind: 'alias-is-published',
        command: cmd,
        detail: `/${cmd} is declared a hidden alias but is also in the popup — ` +
          'publish the canonical name instead.',
      });
    }
  }

  return { ok: failures.length === 0, failures };
}

export function run({ root = ROOT } = {}) {
  const row = readRegistry();
  const routerOnly = Array.isArray(row.commands.routerOnly) ? row.commands.routerOnly : [];
  const aliases = Array.isArray(row.commands.aliases) ? row.commands.aliases : [];
  const { published, handled } = readRouterSurface();
  const matrix = {};
  for (const [cmd, verdict] of Object.entries(row.commands)) {
    if (cmd === 'routerOnly' || cmd === 'aliases') continue;
    matrix[cmd] = verdict;
  }
  const result = audit({
    canonical: readCanonicalCommands(),
    published,
    handled,
    matrix,
    routerOnly,
    aliases,
  });
  return {
    ...result,
    published,
    handled,
    canonical: Object.keys(matrix).length,
    routerOnly,
    aliases,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const asJson = process.argv.includes('--json');
  let out;
  try {
    out = run();
  } catch (e) {
    console.error(`command-scope gate could not run: ${e.message}`);
    process.exit(2);
  }
  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
  } else if (out.ok) {
    console.log(
      `command-scope OK — ${out.canonical} canonical commands, router publishes ${out.published.length} ` +
      `(${out.routerOnly.length} router-only) and handles the same set`,
    );
  } else {
    console.error(`command-scope FAILED — ${out.failures.length} problem(s):\n`);
    for (const f of out.failures) console.error(`  [${f.kind}] ${f.detail}`);
  }
  process.exit(out.ok ? 0 : 1);
}

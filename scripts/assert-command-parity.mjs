#!/usr/bin/env node
/**
 * Command-parity gate: menu popup, /help text, and handlers stay one surface.
 *
 * WHY THIS EXISTS
 * ---------------
 * `/help` was a hand-maintained string separate from BOT_COMMANDS, so new
 * commands (/free, /tax) shipped in the autocomplete popup with no help line —
 * and the drift was invisible until a user asked. Separately, the autocomplete
 * itself can be shadowed: Telegram resolves the narrowest setMyCommands scope
 * first, so a stale `all_private_chats` list (this happened on vm: an old
 * 27-command list with `abort`/`watch`/`project_external_*` hid /forge in
 * every private chat) silently overrides the default scope the bot publishes
 * on boot. helpText() is now generated from BOT_COMMANDS so inclusion is
 * structural; this gate makes the rest structural too.
 *
 * WHAT IT ASSERTS
 * ---------------
 *   1. every BOT_COMMANDS entry has a `case` in bot-host.mjs handleCommand
 *   2. every handled command is published or declared in HIDDEN_COMMANDS
 *   3. every BOT_COMMANDS entry has a HELP_USAGE line (no description fallback)
 *   4. helpText() output contains every /command and no removed one
 *   5. BOT_COMMANDS passes assertValidCommands (shape Telegram accepts)
 *
 * Scope shadowing (stale per-scope menus) is a live-Telegram condition, not a
 * repo condition — repair it with deleteMyCommands for the stale scope (one
 * call; the default scope then applies everywhere) rather than a second
 * published copy that can drift again.
 *
 * Usage: node scripts/assert-command-parity.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOT_COMMANDS,
  COMMAND_NAMES,
  HIDDEN_COMMANDS,
  HELP_USAGE,
  assertValidCommands,
  helpText,
  toTelegramCommands,
} from './lib/commands.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REMOVED = ['abort', 'watch'];

/** Extract the `case 'x':` names inside handleCommand's switch body. */
export function readHandledCommands(src = fs.readFileSync(path.join(ROOT, 'scripts', 'bot-host.mjs'), 'utf8')) {
  const start = src.indexOf('async function handleCommand');
  if (start < 0) throw new Error('could not find handleCommand in scripts/bot-host.mjs');
  const switchAt = src.indexOf('switch (route)', start);
  if (switchAt < 0) throw new Error('could not find handleCommand switch in scripts/bot-host.mjs');
  // The switch runs to the end of handleCommand; brace-match from its opening.
  const openAt = src.indexOf('{', switchAt);
  let depth = 0;
  let end = -1;
  for (let i = openAt; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error('could not find end of handleCommand switch');
  const body = src.slice(openAt, end);
  return [...new Set([...body.matchAll(/case '([a-z0-9_]+)'/g)].map((m) => m[1]))].sort();
}

export function audit({ canonical, handled, hidden, usage, help } = {}) {
  const failures = [];
  const canonicalSet = new Set(canonical);
  for (const cmd of canonical) {
    if (!handled.includes(cmd)) {
      failures.push({ kind: 'published-not-handled', command: cmd, detail: `/${cmd} is in the menu popup but handleCommand has no case for it — tapping it falls through to "Unknown command".` });
    }
  }
  for (const cmd of handled) {
    if (canonicalSet.has(cmd)) continue;
    if (Object.hasOwn(hidden, cmd)) continue;
    failures.push({ kind: 'handled-not-declared', command: cmd, detail: `/${cmd} is handled but neither published nor in HIDDEN_COMMANDS — publish it or declare it hidden with a reason.` });
  }
  for (const cmd of canonical) {
    const entry = usage[cmd];
    if (!entry || !String(entry.text || '').trim()) {
      failures.push({ kind: 'missing-usage', command: cmd, detail: `/${cmd} has no HELP_USAGE line — it renders with the bare menu description until one is written.` });
    }
  }
  for (const cmd of canonical) {
    if (!help.includes(`/${cmd}`)) {
      failures.push({ kind: 'help-missing', command: cmd, detail: `helpText() output does not contain /${cmd} — the generated help drifted from the menu.` });
    }
  }
  for (const cmd of REMOVED) {
    if (help.includes(`/${cmd}`) || canonicalSet.has(cmd)) {
      failures.push({ kind: 'removed-resurfaced', command: cmd, detail: `/${cmd} was removed from the surface but is back in the menu or help.` });
    }
  }
  if (canonical.length !== new Set(canonical).size) {
    failures.push({ kind: 'duplicate-command', command: '', detail: 'BOT_COMMANDS contains a duplicate entry.' });
  }
  return failures;
}

const asJson = process.argv.includes('--json');
const failures = (() => {
  try {
    assertValidCommands(BOT_COMMANDS);
  } catch (err) {
    return [{ kind: 'invalid-commands', command: '', detail: String(err?.message || err) }];
  }
  if (COMMAND_NAMES.join(',') !== BOT_COMMANDS.map((c) => c.command).join(',')) {
    return [{ kind: 'names-drift', command: '', detail: 'COMMAND_NAMES drifted from BOT_COMMANDS — both must derive from the one list.' }];
  }
  const help = helpText({ name: 'parity-probe', agent: {} }, {});
  const shim = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'bot-commands.mjs'), 'utf8');
  const extra = [];
  for (const name of ['HELP_USAGE', 'HIDDEN_COMMANDS']) {
    if (!shim.includes(name)) extra.push({ kind: 'shim-drift', command: '', detail: `bot-commands.mjs shim does not re-export ${name} — a second source of truth by omission.` });
  }
  // toTelegramCommands must be the same set (the popup IS the menu list).
  const published = toTelegramCommands().map((c) => c.command).sort();
  if (published.join(',') !== [...COMMAND_NAMES].sort().join(',')) {
    extra.push({ kind: 'popup-drift', command: '', detail: 'toTelegramCommands() drifted from BOT_COMMANDS — the popup is no longer the menu list.' });
  }
  return [...extra, ...audit({
    canonical: [...COMMAND_NAMES],
    handled: readHandledCommands(),
    hidden: HIDDEN_COMMANDS,
    usage: HELP_USAGE,
    help,
  })];
})();

if (asJson) console.log(JSON.stringify({ ok: failures.length === 0, failures }, null, 2));
else if (failures.length) {
  console.error(`command-parity FAILED (${failures.length}):`);
  for (const f of failures) console.error(`- [${f.kind}] ${f.command ? `/${f.command} ` : ''}${f.detail}`);
} else {
  console.log(`command-parity OK — ${COMMAND_NAMES.length} menu commands, ${Object.keys(HIDDEN_COMMANDS).length} declared hidden, help generated from the one list.`);
}
process.exit(failures.length ? 1 : 0);

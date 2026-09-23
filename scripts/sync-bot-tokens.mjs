#!/usr/bin/env node
/**
 * sync-bot-tokens.mjs
 *
 * Master -> per-system token distribution for ALL bots (bot-host + hermes).
 *
 * Edit ONE file:  ~/.config/bot-host/tokens.env
 * Run this:       node scripts/sync-bot-tokens.mjs [--restart]
 *
 * Reads bots/registry.json and, for each bot, writes the token for that bot's
 * `telegram.tokenEnv` into the env file its runtime actually reads:
 *   runtime "bot-host" -> ~/.config/bot-host/<id>.env   as <tokenEnv>=<value>
 *   runtime "hermes"   -> ~/.hermes[ /profiles/<p>]/.env as TELEGRAM_BOT_TOKEN
 *   runtime "device"   -> skipped (phone owns the token; not synced from here)
 *   runtime "collab"   -> ~/.config/bot-host/<id>.env   as <tokenEnv>=<value>
 * Hermes env files keep all their other keys; only the token line is touched.
 *
 * The master file is never read by a running bot — it is the single place you edit.
 *
 * Usage:
 *   node scripts/sync-bot-tokens.mjs [--check] [--restart] [--list]
 *        [--tokens=<path>] [--dir=<configDir>] [--registry=<path>]
 *
 *   --check    report what would change, write nothing
 *   --restart  restart bot-host@<id>.service for changed bot-host bots
 *              (Hermes changes need a gateway restart; this only prints a hint)
 *   --list     print the unified bot inventory and exit
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { loadRegistry, resolveRegistryPath } from './lib/registry.mjs';

function parseArgs(argv) {
  const args = { check: false, restart: false, list: false };
  for (const arg of argv) {
    if (arg === '--check') args.check = true;
    else if (arg === '--restart') args.restart = true;
    else if (arg === '--list') args.list = true;
    else if (arg.startsWith('--tokens=')) args.tokens = arg.slice('--tokens='.length);
    else if (arg.startsWith('--dir=')) args.dir = arg.slice('--dir='.length);
    else if (arg.startsWith('--registry=')) args.registry = arg.slice('--registry='.length);
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

/** Replace (or append) a single KEY=value line, preserving everything else. */
function upsertEnvVar(text, name, value) {
  const lines = text.split('\n');
  let found = false;
  const out = lines.map((line) => {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && m[1] === name) {
      found = true;
      return `${name}=${value}`;
    }
    return line;
  });
  if (!found) {
    if (out.length && out[out.length - 1] !== '') out.push('');
    out.push(`${name}=${value}`);
  }
  return out.join('\n');
}

function hermesEnvPath(profile) {
  const home = os.homedir();
  if (!profile || profile === 'default') return path.join(home, '.hermes', '.env');
  return path.join(home, '.hermes', 'profiles', profile, '.env');
}

function restartUnit(id) {
  const unit = `bot-host@${id}.service`;
  const active = spawnSync('systemctl', ['is-active', '--quiet', unit]).status === 0;
  if (!active) {
    console.log(`  . ${unit} not running — skipped restart`);
    return;
  }
  const res = spawnSync('sudo', ['-n', 'systemctl', 'restart', unit], { stdio: 'inherit' });
  if (res.status !== 0) {
    console.log(`  ! could not restart ${unit}; run: sudo systemctl restart ${unit}`);
  } else {
    console.log(`  ✓ restarted ${unit}`);
  }
}

function printInventory(registry, tokens) {
  const rows = registry.bots.map((b) => ({
    id: b.id,
    runtime: b.runtime || 'bot-host',
    name: b.name || b.id,
    username: b.hermes?.username || '',
    tokenEnv: b.telegram?.tokenEnv || '',
    hasToken: tokens[b.telegram?.tokenEnv] ? 'yes' : 'no',
    enabled: b.enabled !== false ? 'on' : 'off',
  }));
  const cols = ['id', 'runtime', 'name', 'username', 'tokenEnv', 'hasToken', 'enabled'];
  const width = Object.fromEntries(
    cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c]).length))]),
  );
  const line = (r) => cols.map((c) => String(r[c]).padEnd(width[c])).join('  ');
  console.log(line(Object.fromEntries(cols.map((c) => [c, c]))));
  console.log(cols.map((c) => '-'.repeat(width[c])).join('  '));
  for (const r of rows) console.log(line(r));
}

function printHelp() {
  console.log(`sync-bot-tokens — distribute master tokens to bot-host + hermes env files

  node scripts/sync-bot-tokens.mjs [--check] [--restart] [--list]
       [--tokens=<path>] [--dir=<configDir>] [--registry=<path>]

Master file (edit this):  ~/.config/bot-host/tokens.env
  bot-host output:        ~/.config/bot-host/<id>.env
  hermes output:          ~/.hermes[ /profiles/<p>]/.env  (token line only)
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const registryPath = resolveRegistryPath(args.registry, repoRoot);
  const registry = loadRegistry(registryPath);

  const configDir = args.dir || path.join(os.homedir(), '.config', 'bot-host');
  const tokensPath = args.tokens || process.env.BOT_HOST_TOKENS || path.join(configDir, 'tokens.env');

  if (!fs.existsSync(tokensPath)) {
    throw new Error(
      `Master token file not found: ${tokensPath}\n` +
        `Create it with one line per bot, e.g. VM_BOT_TOKEN=123:abc`,
    );
  }

  const tokens = parseEnv(fs.readFileSync(tokensPath, 'utf8'));

  if (args.list) return printInventory(registry, tokens);

  console.log(`master:   ${tokensPath}`);
  console.log(`config:   ${configDir}`);
  console.log(`registry: ${registryPath}\n`);

  let written = 0;
  let hermesChanged = 0;
  const missing = [];

  for (const bot of registry.bots) {
    const envName = bot.telegram?.tokenEnv;
    const value = tokens[envName];
    if (!value) {
      missing.push(`${bot.id} (${envName})`);
      continue;
    }

    const runtime = bot.runtime || 'bot-host';

    if (runtime === 'device') {
      // Runs on the phone (Termux/proot), not this host — token is owned there.
      console.log(`- ${bot.id.padEnd(20)} device-owned — not synced from this host`);
      continue;
    }

    if (runtime === 'hermes') {
      const profile = bot.hermes?.profile || bot.id;
      const target = hermesEnvPath(profile);
      const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
      const next = upsertEnvVar(existing, 'TELEGRAM_BOT_TOKEN', value);
      if (existing === next) {
        console.log(`= ${bot.id.padEnd(20)} unchanged (${target})`);
        continue;
      }
      if (args.check) {
        console.log(`~ ${bot.id.padEnd(20)} would update token line in ${target}`);
        hermesChanged += 1;
        continue;
      }
      if (!fs.existsSync(target)) {
        console.log(`! ${bot.id.padEnd(20)} no env file at ${target} — skipped`);
        continue;
      }
      fs.writeFileSync(target, next, { mode: 0o600 });
      fs.chmodSync(target, 0o600);
      console.log(`+ ${bot.id.padEnd(20)} updated token line in ${target}`);
      hermesChanged += 1;
      continue;
    }

    // runtime bot-host
    const target = path.join(configDir, `${bot.id}.env`);
    const content = `${envName}=${value}\n`;
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;

    if (existing === content) {
      console.log(`= ${bot.id.padEnd(20)} unchanged`);
      continue;
    }
    if (args.check) {
      console.log(`~ ${bot.id.padEnd(20)} would write ${target}`);
      written += 1;
      continue;
    }

    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(target, content, { mode: 0o600 });
    fs.chmodSync(target, 0o600);
    console.log(`+ ${bot.id.padEnd(20)} wrote ${target}`);
    written += 1;
    if (args.restart) restartUnit(bot.id);
  }

  console.log('');
  if (missing.length) {
    console.log(`No token in master (left existing files untouched): ${missing.join(', ')}`);
  }
  if (hermesChanged && !args.check) {
    console.log('Hermes token(s) changed — restart the gateway to apply (do NOT do it unattended).');
  }
  console.log(
    args.check
      ? `Check done: ${written} bot-host + ${hermesChanged} hermes file(s) would change.`
      : `Done: ${written} bot-host + ${hermesChanged} hermes file(s) written.`,
  );
}

try {
  main();
} catch (err) {
  console.error(`sync-bot-tokens fatal: ${err.message}`);
  process.exit(1);
}

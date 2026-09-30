#!/usr/bin/env node
/**
 * bot-forge.mjs — type a name, get a working bot.
 *
 * THE ONE PATH
 * ------------
 * Everything that creates a bot goes through `runForge()` here: the CLI, and the
 * Mini App backend (which injects it into `createForgeServer`). There is no
 * second creation path to keep in step, which is the only reason the receipt can
 * be trusted.
 *
 * The pipeline, in order, each step leaving a receipt:
 *   plan          — name/id/token validation and the refusals
 *   token         — pasted, or minted through @BotFather by the userbot
 *   registry      — the thin row, written by scripts/add-bot.mjs (one writer)
 *   master-token  — the line in ~/.config/bot-host/tokens.env (mode 600)
 *   sync          — scripts/sync-bot-tokens.mjs writes the runtime env files
 *   supervision   — the user-scope unit, generated from the repo's system unit
 *                   and checked against the env file `sync` just wrote
 *   publish       — getMe (the token is real) + setMyCommands (the menu is live)
 *   enable        — flips the registry row to enabled, only after publish
 *
 * A step that fails stops the pipeline and says which one. Nothing after it runs,
 * so a half-created bot cannot be reported as created.
 *
 * Usage:
 *   node scripts/bot-forge.mjs --create --name="VM3 Bot" --token=123456789:AA…
 *   node scripts/bot-forge.mjs --create --name="VM3 Bot"          # userbot path
 *   node scripts/bot-forge.mjs --create --name="VM3 Bot" --dry-run
 *   node scripts/bot-forge.mjs --attach=pm --token=123456789:AA…  # finish an existing row
 *   node scripts/bot-forge.mjs --serve [--port=8787]              # the Mini App
 *   node scripts/bot-forge.mjs --state                            # what this host can do
 *   node scripts/bot-forge.mjs userbot-login                      # the one-time login
 *
 * Scope flags (defaults are the live host; tests point them at a scratch tree):
 *   --registry=PATH --tokens=PATH --config-dir=DIR --unit-dir=DIR
 *   --bot-host-root=DIR --api-base=URL --no-start --json
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { PIPELINE_STEPS, planForge, slugifyName, summarizeRun, tokenEnvFor, tokenOwnershipConflict, validateToken } from './lib/bot-forge-core.mjs';
import { toTelegramCommands, assertValidCommands } from './lib/commands.mjs';
import { loadRegistry, resolveRegistryPath } from './lib/registry.mjs';
import { forgePageHtml, createForgeServer } from './lib/bot-forge-server.mjs';
import { createBot as createBotViaUserbot } from './lib/tg-userbot.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

export const DEFAULT_API_BASE = 'https://api.telegram.org';
export const DEFAULT_BOT_HOST_ROOT = '/home/ubuntu/bot-host';

const STEP_BY_ID = new Map(PIPELINE_STEPS.map((s) => [s.id, s]));

function step(id, status, detail = '') {
  const meta = STEP_BY_ID.get(id) || { id, title: id };
  return { id, title: meta.title, status, detail };
}

/** Where a run reads and writes. Every path is overridable so a test can use a scratch tree. */
export function resolvePaths({ registry = '', tokens = '', configDir = '', unitDir = '', botHostRoot = '', env = process.env } = {}) {
  const home = os.homedir();
  const resolvedConfigDir = configDir || path.join(home, '.config', 'bot-host');
  return {
    registryPath: resolveRegistryPath(registry || null, ROOT),
    tokensPath: tokens || env.BOT_HOST_TOKENS || path.join(resolvedConfigDir, 'tokens.env'),
    configDir: resolvedConfigDir,
    unitDir: unitDir || path.join(home, '.config', 'systemd', 'user'),
    botHostRoot: botHostRoot || DEFAULT_BOT_HOST_ROOT,
    repoRoot: ROOT,
  };
}

/** The master token file as a plain map. A missing file is an empty map, not an error. */
export function readMasterTokens(tokensPath) {
  if (!fs.existsSync(tokensPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(tokensPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Write one KEY=value line, preserving everything else, mode 600. */
export function upsertMasterToken(tokensPath, name, value) {
  const existing = fs.existsSync(tokensPath) ? fs.readFileSync(tokensPath, 'utf8') : '';
  const lines = existing.split('\n');
  let found = false;
  const next = lines.map((line) => {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && m[1] === name) {
      found = true;
      return `${name}=${value}`;
    }
    return line;
  });
  if (!found) {
    while (next.length && next[next.length - 1] === '') next.pop();
    next.push(`${name}=${value}`, '');
  }
  fs.mkdirSync(path.dirname(tokensPath), { recursive: true });
  fs.writeFileSync(tokensPath, next.join('\n'), { mode: 0o600 });
  fs.chmodSync(tokensPath, 0o600);
  return { created: !found };
}

/**
 * Render the user-scope unit from the repo's OWN system unit.
 *
 * One source: `systemd/bot-host@.service` is what the live VM runs, and the
 * user-scope copy is a mechanical transform of it (target, no User/Group, the
 * local deploy root, the config dir the token sync writes). Hand-writing a second
 * unit is how two supervisors drift apart.
 */
export function renderUserUnit({ systemUnitText, botHostRoot = DEFAULT_BOT_HOST_ROOT, configDir }) {
  const lines = String(systemUnitText)
    .replaceAll(DEFAULT_BOT_HOST_ROOT, botHostRoot)
    .split('\n')
    .filter((line) => !/^(User|Group)=/.test(line))
    .map((line) => {
      if (/^WantedBy=multi-user\.target$/.test(line)) return 'WantedBy=default.target';
      if (/^Documentation=/.test(line)) return `Documentation=file://${botHostRoot}/bots/registry.json`;
      if (/^EnvironmentFile=/.test(line)) {
        // The system unit relies on a fixed absolute config dir; the user-scope
        // copy states the one this forge actually wrote, so the check below is
        // about a real file rather than a hope.
        return line.replace(/(^EnvironmentFile=-?).*/, `$1${configDir}/%i.env`);
      }
      return line;
    });
  const text = `${lines.join('\n').replace(/\n+$/, '')}\n`;
  return {
    text,
    // The one line the whole supervision story hangs on: the file the unit reads
    // must be the file the token sync wrote.
    environmentFile: `${configDir}/%i.env`,
    execStart: (text.match(/^ExecStart=(.*)$/m) || [])[1] || '',
  };
}

/** Call one Bot API method. Injected `fetchImpl` keeps the tests off the network. */
async function telegramCall({ apiBase, token, method, payload, fetchImpl = globalThis.fetch, timeoutMs = 15_000 }) {
  const url = `${apiBase.replace(/\/+$/, '')}/bot${token}/${method}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, reason: `${method} answered non-JSON (${res.status}): ${text.slice(0, 160)}` };
    }
    if (!json.ok) return { ok: false, reason: `${method} refused: ${json.description || res.status}` };
    return { ok: true, result: json.result };
  } catch (err) {
    const why = err.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : err.message;
    return { ok: false, reason: `${method} unreachable at ${apiBase} (${why})` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The pipeline. Returns the receipt the CLI prints and the Mini App renders.
 *
 * `io` carries the seams: `fetchImpl` (network), `createBot` (the userbot),
 * `spawn` (child scripts) and `systemctl`. Defaults are the real ones.
 */
export async function runForge(input = {}, io = {}) {
  const {
    env = process.env,
    fetchImpl = globalThis.fetch,
    createBot = null,
    spawn = spawnSync,
    systemctl = null,
    allowStart = null,
    dryRun = false,
    onStep = null,
  } = io;

  const name = String(input.name ?? '').trim();
  const tokenSource = String(input.token ?? '').trim() ? 'paste' : 'userbot';
  // One way to say it, from both callers: the CLI computes `mode` from --attach,
  // the Mini App posts it in the body.
  const mode = input.mode ? String(input.mode) : 'create';
  const paths = input.paths || resolvePaths({ env });
  const apiBase = input.apiBase || DEFAULT_API_BASE;
  const steps = [];
  const hostCommands = [];
  const record = (entry) => {
    steps.push(entry);
    if (typeof onStep === 'function') onStep(entry);
    return entry;
  };
  const refuse = (id, reason) => {
    record(step(id, 'failed', reason));
    return { ok: false, reason, failedStep: id, steps, hostCommands, summary: summarizeRun(steps) };
  };

  const registry = JSON.parse(fs.readFileSync(paths.registryPath, 'utf8'));

  // 1. plan — the cheap refusal, before anything is written.
  const planned = planForge({
    registry,
    mode,
    name,
    id: input.id || '',
    token: input.token || '',
    tokenEnv: input.tokenEnv || '',
    tokenSource,
  });
  if (!planned.ok) return refuse('plan', planned.reason);
  const plan = planned.plan;
  record(step('plan', 'done', `${plan.id} → ${plan.tokenEnv}, ${plan.tokenSource}`));

  if (dryRun) {
    record(step('token', 'skipped', 'dry run'));
    if (plan.attached) record(step('registry', 'done', `${plan.id} is already in the registry (attach)`));
    return {
      ok: true,
      dryRun: true,
      bot: { id: plan.id, name: plan.name, tokenEnv: plan.tokenEnv, attached: Boolean(plan.attached) },
      plan,
      steps,
      hostCommands,
      summary: summarizeRun(steps),
    };
  }

  // 2. token — pasted (already validated) or minted through @BotFather.
  let token = plan.token;
  if (tokenSource === 'userbot') {
    if (typeof createBot !== 'function') return refuse('token', 'no userbot transport is available in this process');
    const minted = await createBot({ name: plan.name, username: input.username || '', env });
    if (!minted.ok) {
      const refusal = { ...minted, hostCommands: [...(minted.hostCommands || []), ...hostCommands] };
      record(step('token', 'failed', minted.reason));
      return {
        ok: false,
        reason: minted.reason,
        failedStep: 'token',
        hostCommands: refusal.hostCommands,
        steps,
        summary: summarizeRun(steps),
      };
    }
    token = minted.token;
  }
  const shaped = validateToken(token);
  if (!shaped.ok) return refuse('token', shaped.reason);
  record(step('token', 'done', tokenSource === 'paste' ? 'pasted token shape-checked' : 'minted through @BotFather'));

  // The master file is the fleet's token record; a value already in it belongs to
  // another bot even when that bot is not in the registry.
  const masterTokens = readMasterTokens(paths.tokensPath);
  const conflict = tokenOwnershipConflict(masterTokens, { token, tokenEnv: plan.tokenEnv });
  if (conflict) return refuse('plan', conflict);

  // 3. registry — create writes the thin row through the one writer, which
  //    re-checks the contract (a row that would drift from the master is refused
  //    there). Attach keeps the row it found: the row was never the missing
  //    surface, the token was, and rewriting it would restate what the fleet
  //    already owns. `planForge` proved the row exists, so this step is done
  //    either way — a receipt that said "skipped" would misreport the run.
  if (plan.attached) {
    record(step('registry', 'done', `${plan.id} is already in the registry and is kept as it is (attach writes no row)`));
  } else {
    const addBotArgs = [
      path.join(paths.repoRoot, 'scripts', 'add-bot.mjs'),
      `--id=${plan.id}`,
      `--name=${plan.name}`,
      `--registry=${paths.registryPath}`,
      `--token-env=${plan.tokenEnv}`,
      `--playwright-output-dir=/tmp/bot-host-shots-${plan.id}`,
    ];
    const rowRun = spawn(process.execPath, addBotArgs, { cwd: paths.repoRoot, encoding: 'utf8' });
    if (rowRun.status !== 0) {
      return refuse('registry', `scripts/add-bot.mjs refused: ${String(rowRun.stderr || rowRun.stdout || '').trim().slice(0, 400)}`);
    }
    record(step('registry', 'done', `thin row for ${plan.id} written (inherits ${plan.masterId})`));
  }

  // 4. master token line.
  const wrote = upsertMasterToken(paths.tokensPath, plan.tokenEnv, token);
  record(step('master-token', 'done', `${plan.tokenEnv} ${wrote.created ? 'added to' : 'updated in'} ${paths.tokensPath} (mode 600)`));

  // 5. sync — the real script, so the env files are written the same way the
  //    host writes them (and the phone/devices keep their own tokens).
  const syncRun = spawn(
    process.execPath,
    [
      path.join(paths.repoRoot, 'scripts', 'sync-bot-tokens.mjs'),
      `--registry=${paths.registryPath}`,
      `--tokens=${paths.tokensPath}`,
      `--dir=${paths.configDir}`,
    ],
    { cwd: paths.repoRoot, encoding: 'utf8' },
  );
  const envFile = path.join(paths.configDir, `${plan.id}.env`);
  if (syncRun.status !== 0) {
    return refuse('sync', `scripts/sync-bot-tokens.mjs failed: ${String(syncRun.stderr || syncRun.stdout || '').trim().slice(0, 400)}`);
  }
  if (!fs.existsSync(envFile) || !fs.readFileSync(envFile, 'utf8').includes(`${plan.tokenEnv}=`)) {
    return refuse('sync', `sync ran but ${envFile} does not carry ${plan.tokenEnv}`);
  }
  record(step('sync', 'done', `${envFile} carries ${plan.tokenEnv}`));

  // 6. supervision — the unit, generated from the repo's own system unit, and
  //    checked against the env file the sync just wrote.
  const systemUnitPath = path.join(paths.repoRoot, 'systemd', 'bot-host@.service');
  const unit = renderUserUnit({
    systemUnitText: fs.readFileSync(systemUnitPath, 'utf8'),
    botHostRoot: paths.botHostRoot,
    configDir: paths.configDir,
  });
  const unitPath = path.join(paths.unitDir, 'bot-host@.service');
  fs.mkdirSync(paths.unitDir, { recursive: true });
  fs.writeFileSync(unitPath, unit.text);
  const wiredEnvFile = unit.environmentFile.replace('%i', plan.id);
  if (!fs.existsSync(wiredEnvFile)) {
    return refuse('supervision', `${unitPath} reads ${unit.environmentFile}, but ${wiredEnvFile} does not exist — the unit would boot with no token`);
  }
  if (!unit.execStart.includes('bot-host.mjs')) {
    return refuse('supervision', `the generated unit does not start bot-host.mjs (ExecStart=${unit.execStart})`);
  }
  const startCommand = `systemctl --user enable --now bot-host@${plan.id}`;
  const lingerCommand = `loginctl enable-linger ${os.userInfo().username}   # once per host, needs root`;
  let supervisionDetail = `unit written to ${unitPath}; reads ${unit.environmentFile} (exists)`;
  const canStart = allowStart === null ? hasSystemdUser() : Boolean(allowStart);
  if (canStart) {
    const start = (systemctl || defaultSystemctl)(['--user', 'enable', '--now', `bot-host@${plan.id}.service`]);
    if (start.ok) {
      supervisionDetail += `; started bot-host@${plan.id} (user scope)`;
    } else {
      supervisionDetail += `; start failed (${start.reason})`;
      hostCommands.push(startCommand);
    }
  } else {
    hostCommands.push(startCommand);
  }
  record(step('supervision', 'done', supervisionDetail));

  // 7. publish — the token is real and the menu is live. This is the step that
  //    makes "usable" a fact instead of a claim, so it gates the enable below.
  const me = await telegramCall({ apiBase, token, method: 'getMe', payload: {}, fetchImpl });
  if (!me.ok) {
    hostCommands.push(`re-run publish once the bot can reach Telegram: node scripts/bot-forge.mjs --create --name="${plan.name}"`);
    return refuse('publish', me.reason);
  }
  const telegramBotId = String(me.result?.id ?? '');
  if (telegramBotId && plan.telegramBotId && telegramBotId !== plan.telegramBotId) {
    return refuse('publish', `the token says bot ${plan.telegramBotId} but Telegram answered ${telegramBotId} — wrong token`);
  }
  const commands = toTelegramCommands();
  assertValidCommands(commands);
  const menu = await telegramCall({ apiBase, token, method: 'setMyCommands', payload: { commands }, fetchImpl });
  if (!menu.ok) return refuse('publish', menu.reason);
  record(step('publish', 'done', `getMe ok (@${me.result?.username || 'unknown'}), ${commands.length} commands published`));

  // 8. enable — only now. A disabled row that already replies is a smaller lie
  //    than an enabled row that does not.
  const enableRun = spawn(
    process.execPath,
    [path.join(paths.repoRoot, 'scripts', 'add-bot.mjs'), `--enable=${plan.id}`, `--registry=${paths.registryPath}`],
    { cwd: paths.repoRoot, encoding: 'utf8' },
  );
  if (enableRun.status !== 0) {
    return refuse('enable', `add-bot.mjs --enable refused: ${String(enableRun.stderr || enableRun.stdout || '').trim().slice(0, 300)}`);
  }
  record(step('enable', 'done', plan.attached && plan.wasEnabled ? `${plan.id} was already enabled (token rotated)` : `${plan.id} enabled in the registry`));

  return {
    ok: true,
    bot: {
      id: plan.id,
      name: plan.name,
      tokenEnv: plan.tokenEnv,
      username: me.result?.username || '',
      telegramBotId,
      tokenSource,
      masterId: plan.masterId,
      attached: Boolean(plan.attached),
    },
    steps,
    hostCommands,
    summary: summarizeRun(steps),
  };
}

function hasSystemdUser() {
  if (process.platform !== 'linux') return false;
  const probe = spawnSync('systemctl', ['--user', 'is-system-running'], { encoding: 'utf8' });
  // 'degraded' and 'running' both mean the user manager answers.
  return probe.status === 0 || /running|degraded/.test(String(probe.stdout || ''));
}

function defaultSystemctl(args) {
  const res = spawnSync('systemctl', args, { encoding: 'utf8' });
  if (res.status === 0) return { ok: true };
  return { ok: false, reason: String(res.stderr || res.stdout || `exit ${res.status}`).trim().slice(0, 200) };
}

/* ------------------------------------------------------------------ CLI -- */

/** Flags are `--name` (true), `--name=value`, and the one negated pair `--start/--no-start`. */
export function parseArgs(argv) {
  const args = { _: [] };
  const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  for (const arg of argv) {
    if (!String(arg).startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq === -1) {
      const name = arg.slice(2);
      if (name === 'no-start') args.start = false;
      else if (name === 'start') args.start = true;
      else args[camel(name)] = true;
      continue;
    }
    args[camel(arg.slice(2, eq))] = arg.slice(eq + 1);
  }
  return args;
}

function printHelp() {
  console.log(`bot-forge — type a name, get a working bot

  node scripts/bot-forge.mjs --create --name="VM3 Bot" --token=123456789:AA…
  node scripts/bot-forge.mjs --create --name="VM3 Bot"           # userbot mints it
  node scripts/bot-forge.mjs --attach=pm --token=123456789:AA…   # finish a row that exists
  node scripts/bot-forge.mjs --create --name="VM3 Bot" --dry-run
  node scripts/bot-forge.mjs --serve [--port=8787] [--allow-local]
  node scripts/bot-forge.mjs --state
  node scripts/bot-forge.mjs userbot-login

Scope flags (defaults are the live host):
  --registry=PATH --tokens=PATH --config-dir=DIR --unit-dir=DIR
  --bot-host-root=DIR --api-base=URL [--start|--no-start] [--json]
`);
}

async function cmdState(args) {
  const paths = resolvePaths(args);
  const registry = JSON.parse(fs.readFileSync(paths.registryPath, 'utf8'));
  const { userbotState } = await import('./lib/tg-userbot.mjs');
  const userbot = await userbotState(process.env);
  const view = {
    ok: true,
    master: registry.master || '',
    bots: (registry.bots || []).map((b) => ({ id: b.id, enabled: b.enabled !== false, runtime: b.runtime || 'bot-host' })),
    paths,
    userbot: { configured: userbot.configured, reason: userbot.reason, hostCommands: userbot.hostCommands },
  };
  if (args.json) return console.log(JSON.stringify(view, null, 2));
  console.log(`master bot:   ${view.master}`);
  console.log(`registry:     ${paths.registryPath}`);
  console.log(`master token: ${paths.tokensPath}${fs.existsSync(paths.tokensPath) ? '' : ' (missing)'}`);
  console.log(`bot-host root:${paths.botHostRoot}`);
  console.log(`unit dir:     ${paths.unitDir}`);
  console.log(`bots:         ${view.bots.map((b) => b.id).join(', ')}`);
  console.log(`userbot:      ${userbot.configured ? 'ready' : `not configured — ${userbot.reason}`}`);
  if (!userbot.configured) for (const line of userbot.hostCommands) console.log(`              ${line}`);
}

async function cmdServe(args) {
  const paths = resolvePaths(args);
  const registry = JSON.parse(fs.readFileSync(paths.registryPath, 'utf8'));
  const allowLocal = args.allowLocal !== false;
  const server = createForgeServer({
    env: process.env,
    registry,
    allowLocal,
    log: (line) => console.log(line),
    runCreate: (input) =>
      runForge(
        { ...input, paths, apiBase: args.apiBase || DEFAULT_API_BASE },
        { env: process.env, createBot: createBotViaUserbot, allowStart: args.start === undefined ? null : args.start },
      ),
  });
  const port = Number(args.port || 8787);
  const host = String(args.host || '127.0.0.1');
  await new Promise((resolve) => server.listen(port, host, resolve));
  console.log(`bot forge on http://${host}:${server.address().port}`);
  console.log(allowLocal && host === '127.0.0.1' ? 'loopback requests are admitted without initData (dev/single-host)' : 'Telegram initData is required');
  console.log('In Telegram, open this through the bot\'s web_app button so initData is present.');
  return server;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h || args._.includes('help')) return printHelp();

  if (args._[0] === 'userbot-login') {
    const { login } = await import('./lib/tg-userbot.mjs');
    const result = await login({ env: process.env });
    console.log(result.ok ? `userbot ready: ${result.sessionFile}` : `userbot login not completed: ${result.reason}`);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (args.state) return cmdState(args);

  if (args.serve) {
    await cmdServe(args);
    return;
  }

  const attachId = typeof args.attach === 'string' ? args.attach : '';
  const mode = attachId || args.attach === true || args.mode === 'attach' ? 'attach' : 'create';
  if (!args.create && mode !== 'attach') {
    printHelp();
    process.exitCode = 2;
    return;
  }

  const paths = resolvePaths(args);
  const { createBot } = await import('./lib/tg-userbot.mjs');
  const result = await runForge(
    {
      mode,
      name: args.name || '',
      id: attachId || args.id || '',
      token: args.token || '',
      username: args.username || '',
      tokenEnv: args.tokenEnv || (args.id ? tokenEnvFor(args.id) : ''),
      paths,
      apiBase: args.apiBase || DEFAULT_API_BASE,
    },
    {
      env: process.env,
      createBot,
      allowStart: args.start === undefined ? null : args.start,
      dryRun: Boolean(args.dryRun),
      onStep: (entry) => {
        if (!args.json) {
          const mark = entry.status === 'done' ? '✓' : entry.status === 'failed' ? '✗' : '·';
          console.log(`  ${mark} ${entry.id.padEnd(13)} ${entry.detail}`);
        }
      },
    },
  );

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // The receipt names the parent it cloned, on both the dry run and the run.
    const plan = result.plan || { masterId: result.bot?.masterId || '' };
    console.log('');
    if (result.dryRun) {
      console.log(result.bot.attached
        ? `dry run: would attach a token to ${result.bot.id} (${result.bot.tokenEnv}) and keep its row. Nothing was written.`
        : `dry run: would create ${result.bot.id} (${result.bot.tokenEnv}) as a clone of "${result.plan.masterId}". Nothing was written.`);
    } else if (result.ok && result.bot.attached) {
      console.log(`attached the token to ${result.bot.id} (@${result.bot.username || 'unknown'}) — its registry row was already there and was left alone.`);
      console.log('Its token answered getMe and its command menu is published. Send it /help in Telegram.');
    } else if (result.ok) {
      console.log(`created ${result.bot.id} (@${result.bot.username || 'unknown'}) — a thin clone of "${plan.masterId}" in the registry.`);
      console.log('Its token answered getMe and its command menu is published. Send it /help in Telegram.');
    } else {
      console.log(`stopped at "${result.failedStep}": ${result.reason}`);
      console.log('Nothing after that step ran, so the bot is not being reported as created.');
    }
    if (result.hostCommands && result.hostCommands.length) {
      console.log('\nOnly you can run these (host-only):');
      for (const line of result.hostCommands) console.log(`  ${line}`);
    }
  }
  process.exitCode = result.ok ? 0 : 1;
}

const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedAs === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`bot-forge fatal: ${err.message}`);
    process.exit(1);
  });
}

export { forgePageHtml };

#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TelegramApi, TelegramError, chunkText } from './lib/tg-api.mjs';
import { Throttle } from './lib/tg-throttle.mjs';
import { compressReasoning } from './lib/reasoning-compress.mjs';
import { runOpencode, listModels } from './lib/agent-opencode.mjs';
import { loadRegistry, getBot, resolveToken, resolveRegistryPath } from './lib/registry.mjs';
import { parseCommand, helpText, statusText, formatModelList } from './lib/commands.mjs';

const HOME = os.homedir();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const args = { dryRun: false, checkConfig: false, help: false };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--check-config') args.checkConfig = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--id=')) args.id = arg.slice('--id='.length);
    else if (arg.startsWith('--registry=')) args.registry = arg.slice('--registry='.length);
    else if (arg.startsWith('--prompt=')) args.prompt = arg.slice('--prompt='.length);
    else if (arg.startsWith('--simulate=')) args.simulate = arg.slice('--simulate='.length);
  }
  return args;
}

function printHelp() {
  console.log(`opencode-bot - Telegram bridge for opencode (config-driven)

Usage:
  node scripts/opencode-bot.mjs [--id=<botId>] [--registry=<path>]
  node scripts/opencode-bot.mjs --check-config [--id=<botId>]
  node scripts/opencode-bot.mjs --dry-run [--id=<botId>] [--prompt="..."]

Bots are defined in bots/registry.json. Add a new bot by appending an entry,
exporting its token env var, and starting opencode-bot@<id>. No code changes.
`);
}

function normalizeConfig(bot) {
  return {
    id: bot.id,
    name: bot.name || bot.id,
    telegram: {
      tokenEnv: bot.telegram?.tokenEnv,
      allowedUserIds: (bot.telegram?.allowedUserIds || []).map(Number),
    },
    agent: {
      kind: bot.agent?.kind || 'opencode',
      model: bot.agent?.model,
      variant: bot.agent?.variant,
      workspace: bot.agent?.workspace || REPO_ROOT,
      timeoutMs: bot.agent?.timeoutMs ?? 900000,
      thinking: bot.agent?.thinking !== false,
      opencodeBin: bot.agent?.opencodeBin,
    },
    progress: {
      mode: bot.progress?.mode || 'concise',
      editIntervalMs: bot.progress?.editIntervalMs ?? 2500,
      maxEdits: bot.progress?.maxEdits ?? 40,
      maxChars: bot.progress?.maxChars ?? 220,
    },
    session: { mode: bot.session?.mode || 'per-chat' },
  };
}

function printConfig(config, registryPath) {
  console.log(`registry: ${registryPath}`);
  console.log(JSON.stringify(config, null, 2));
}

function stateDir(id) {
  const dir = path.join(HOME, '.local', 'state', 'opencode-bot', id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function loadMap(id, file) {
  return new Map(Object.entries(readJson(path.join(stateDir(id), file), {})));
}

function saveMap(id, file, map) {
  writeJson(path.join(stateDir(id), file), Object.fromEntries(map));
}

const loadSessions = (id) => loadMap(id, 'sessions.json');
const saveSessions = (id, sessions) => saveMap(id, 'sessions.json', sessions);
const loadPrefs = (id) => loadMap(id, 'prefs.json');
const savePrefs = (id, prefs) => saveMap(id, 'prefs.json', prefs);

function loadOffset(id) {
  return Number(readJson(path.join(stateDir(id), 'offset.json'), { offset: 0 }).offset) || 0;
}

function saveOffset(id, offset) {
  writeJson(path.join(stateDir(id), 'offset.json'), { offset });
}

function effectiveModel(config, prefs, chatId) {
  return prefs.get(chatId)?.model || config.agent.model;
}

class ProgressRenderer {
  constructor({ api = null, throttle = null, chatId, mode, maxChars, maxEdits, dryRun = false }) {
    this.api = api;
    this.throttle = throttle;
    this.chatId = chatId;
    this.mode = mode;
    this.maxChars = maxChars;
    this.maxEdits = maxEdits;
    this.dryRun = dryRun;
    this.messageId = null;
    this.edits = 0;
    this.thinking = '';
    this.tool = '';
    this.status = 'starting';
  }

  _render() {
    const lines = [];
    if (this.thinking) lines.push(`Thinking: ${this.thinking}`);
    if (this.tool) lines.push(`Tool: ${this.tool}`);
    lines.push(`Status: ${this.status}`);
    return lines.join('\n');
  }

  async start() {
    if (this.dryRun) {
      console.log(`[progress] ${this._render().replace(/\n/g, ' | ')}`);
      this.messageId = 1;
      return;
    }
    const result = await this._guarded(() => this.api.sendMessage(this.chatId, this._render()));
    this.messageId = result?.message_id ?? null;
  }

  onEvent(event) {
    if (event.kind === 'reasoning' && event.text) {
      const gist = compressReasoning(event.text, { maxChars: this.maxChars });
      if (gist) {
        this.thinking = gist;
        this.status = 'thinking';
        this._schedule();
      }
    } else if (event.kind === 'tool') {
      this.tool = `${event.tool} (${event.status})`;
      this.status = 'working';
      this._schedule();
    } else if (event.kind === 'step_finish') {
      this.status = 'working';
      this._schedule();
    }
  }

  _schedule() {
    if (this.dryRun) {
      console.log(`[progress] ${this._render().replace(/\n/g, ' | ')}`);
      return;
    }
    if (this.messageId == null || this.edits >= this.maxEdits) return;
    this.edits += 1;
    this.throttle
      .submit(() => this._guarded(() => this.api.editMessageText(this.chatId, this.messageId, this._render())))
      .catch(() => {});
  }

  async _guarded(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof TelegramError && err.isRateLimit) {
        this.throttle?.pause(err.retryAfter);
        return null;
      }
      if (err instanceof TelegramError && /not modified/i.test(err.description || '')) {
        return null;
      }
      throw err;
    }
  }

  async deliver(text) {
    const body = String(text ?? '').trim();
    if (!body) return;
    if (this.dryRun) {
      console.log(`[final] ${body}`);
      return;
    }
    for (const part of chunkText(body)) {
      await this._send(part);
    }
  }

  async _send(part) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.api.sendMessage(this.chatId, part);
        return;
      } catch (err) {
        if (err instanceof TelegramError && err.isRateLimit) {
          const wait = Math.min(err.retryAfter || 5, 60);
          this.throttle?.pause(err.retryAfter);
          await sleep(wait * 1000);
          continue;
        }
        throw err;
      }
    }
  }

  async finish(result) {
    if (result.lastError && !result.finalText) {
      this.status = 'failed';
      this._schedule();
      const tail = result.stderr ? `\n${result.stderr.trim().slice(0, 400)}` : '';
      await this.deliver(`Error: ${result.lastError}${tail}`);
      return;
    }
    this.status = 'done';
    this._schedule();
    if (!result.finalText) {
      const code = result.code === 0 ? '' : ` (exit ${result.code})`;
      await this.deliver(`Done${code}, but the model returned no text output.`);
      return;
    }
    await this.deliver(result.finalText);
  }
}

async function sendChunked(api, chatId, text) {
  for (const part of chunkText(text)) {
    await api.sendMessage(chatId, part);
  }
}

async function handleCommand({ api, config, sessions, prefs, running, chatId, cmd }) {
  const model = effectiveModel(config, prefs, chatId);

  switch (cmd.name) {
    case 'start':
    case 'help':
      await api.sendMessage(chatId, helpText(config, { model }));
      return;

    case 'status':
      await api.sendMessage(chatId, statusText(config, { sessionId: sessions.get(chatId), model }));
      return;

    case 'new':
      sessions.delete(chatId);
      saveSessions(config.id, sessions);
      await api.sendMessage(chatId, 'Started a fresh session.');
      return;

    case 'model': {
      if (!cmd.args) {
        await api.sendMessage(
          chatId,
          [
            `Current model: ${model}`,
            `Default model: ${config.agent.model}`,
            '',
            'Usage:',
            '/model <provider/model>  switch model for this chat',
            '/model reset             back to the default',
            '/models                  list available models',
          ].join('\n'),
        );
        return;
      }
      if (cmd.args === 'reset') {
        const current = prefs.get(chatId) || {};
        delete current.model;
        if (Object.keys(current).length) prefs.set(chatId, current);
        else prefs.delete(chatId);
        savePrefs(config.id, prefs);
        await api.sendMessage(chatId, `Model reset to ${config.agent.model}.`);
        return;
      }
      const target = cmd.args;
      const models = await listModels({ opencodeBin: config.agent.opencodeBin });
      if (models.length && !models.includes(target)) {
        await api.sendMessage(chatId, `Unknown model: ${target}\nUse /models to see options.`);
        return;
      }
      prefs.set(chatId, { ...(prefs.get(chatId) || {}), model: target });
      savePrefs(config.id, prefs);
      const note = models.length ? '' : '\n(note: could not verify against the model list)';
      await api.sendMessage(chatId, `Model set to ${target} for this chat.${note}`);
      return;
    }

    case 'models': {
      const models = await listModels({ opencodeBin: config.agent.opencodeBin });
      await sendChunked(api, chatId, formatModelList(models));
      return;
    }

    case 'abort': {
      const active = running.get(chatId);
      if (!active) {
        await api.sendMessage(chatId, 'Nothing is running.');
        return;
      }
      active.aborted = true;
      try {
        active.child.kill('SIGTERM');
        setTimeout(() => {
          try {
            active.child.kill('SIGKILL');
          } catch {
            // already gone
          }
        }, 3000);
      } catch {
        // already gone
      }
      await api.sendMessage(chatId, 'Aborting the running request...');
      return;
    }

    default:
      await api.sendMessage(chatId, `Unknown command: /${cmd.name}\n\n${helpText(config, { model })}`);
  }
}

async function handleMessage({ api, config, throttle, sessions, prefs, running, busy, message }) {
  const chatId = message.chat.id;
  const userId = Number(message.from?.id);
  if (!config.telegram.allowedUserIds.includes(userId)) {
    console.warn(`[${config.id}] ignored message from unauthorized user ${userId}`);
    return;
  }
  const text = (message.text || '').trim();
  if (!text) return;

  const cmd = parseCommand(text);
  if (cmd) {
    await handleCommand({ api, config, sessions, prefs, running, chatId, cmd });
    return;
  }

  if (busy.has(chatId)) {
    await api.sendMessage(chatId, 'Still working on the previous request. Send /abort to cancel or /new to reset.');
    return;
  }

  busy.add(chatId);
  const renderer = new ProgressRenderer({ api, throttle, chatId, ...config.progress });
  try {
    await renderer.start();
    const extraArgs = [];
    const sessionId = sessions.get(chatId);
    if (sessionId) extraArgs.push('--session', sessionId);

    const result = await runOpencode({
      prompt: text,
      model: effectiveModel(config, prefs, chatId),
      variant: config.agent.variant,
      workspace: config.agent.workspace,
      thinking: config.agent.thinking,
      timeoutMs: config.agent.timeoutMs,
      opencodeBin: config.agent.opencodeBin,
      onEvent: (event) => renderer.onEvent(event),
      onSpawn: (child) => running.set(chatId, { child, aborted: false }),
      extraArgs,
    });

    if (result.sessionID) {
      sessions.set(chatId, result.sessionID);
      saveSessions(config.id, sessions);
    }

    if (running.get(chatId)?.aborted) {
      renderer.status = 'aborted';
      await renderer.deliver('Aborted.');
    } else {
      await renderer.finish(result);
    }
  } catch (err) {
    await api.sendMessage(chatId, `Error: ${err.message}`).catch(() => {});
  } finally {
    running.delete(chatId);
    busy.delete(chatId);
  }
}

async function runLoop({ api, config }) {
  const throttle = new Throttle({ minIntervalMs: config.progress.editIntervalMs });
  const sessions = loadSessions(config.id);
  const prefs = loadPrefs(config.id);
  const running = new Map();
  const busy = new Set();
  let offset = loadOffset(config.id);
  let running_ = true;

  const stop = () => {
    running_ = false;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (running_) {
    let updates;
    try {
      updates = await api.getUpdates({ offset, timeout: 30 });
    } catch (err) {
      if (err instanceof TelegramError && err.isRateLimit) throttle.pause(err.retryAfter);
      console.error(`[${config.id}] getUpdates failed: ${err.message}`);
      await sleep(2000);
      continue;
    }
    for (const update of updates) {
      offset = update.update_id + 1;
      saveOffset(config.id, offset);
      if (!update.message) continue;
      handleMessage({ api, config, throttle, sessions, prefs, running, busy, message: update.message }).catch(
        (err) => {
          console.error(`[${config.id}] handler error: ${err.message}`);
        },
      );
    }
  }
}

async function simulate(config, args) {
  const cmd = parseCommand(args.simulate);
  if (!cmd) {
    console.log(`[simulate] not a command; would run opencode with: ${args.simulate}`);
    return;
  }
  const api = {
    sendMessage: async (chatId, text) => {
      console.log(`[reply]\n${text}`);
      return { message_id: 1 };
    },
  };
  await handleCommand({
    api,
    config,
    sessions: new Map(),
    prefs: new Map(),
    running: new Map(),
    chatId: 'sim',
    cmd,
  });
}

async function dryRun(config, args) {
  const prompt = args.prompt || 'Say hello in one short sentence.';
  const renderer = new ProgressRenderer({ chatId: 'dry-run', dryRun: true, ...config.progress });
  await renderer.start();
  const result = await runOpencode({
    prompt,
    model: config.agent.model,
    variant: config.agent.variant,
    workspace: config.agent.workspace,
    thinking: config.agent.thinking,
    timeoutMs: config.agent.timeoutMs,
    opencodeBin: config.agent.opencodeBin,
    onEvent: (event) => renderer.onEvent(event),
  });
  await renderer.finish(result);
  console.log(`\n[dry-run] session=${result.sessionID} code=${result.code} error=${result.lastError || 'none'}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const registryPath = resolveRegistryPath(args.registry, REPO_ROOT);
  const registry = loadRegistry(registryPath);
  const bot = getBot(registry, args.id);
  const config = normalizeConfig(bot);

  if (args.checkConfig) {
    printConfig(config, registryPath);
    try {
      resolveToken(bot);
      console.log('token: present');
    } catch (err) {
      console.log(`token: MISSING -> ${err.message}`);
    }
    return;
  }

  if (args.simulate) {
    await simulate(config, args);
    return;
  }

  if (args.dryRun) {
    await dryRun(config, args);
    return;
  }

  const token = resolveToken(bot);
  const api = new TelegramApi(token);
  const me = await api.getMe();
  await api.deleteWebhook();
  console.log(`[${config.id}] connected as @${me.username}`);
  await runLoop({ api, config });
}

main().catch((err) => {
  console.error(`opencode-bot fatal: ${err.message}`);
  process.exit(1);
});

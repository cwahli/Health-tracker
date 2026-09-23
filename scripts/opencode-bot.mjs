#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TelegramApi, TelegramError, chunkText, isSendableMedia } from './lib/tg-api.mjs';
import { Throttle } from './lib/tg-throttle.mjs';
import { compressReasoning } from './lib/reasoning-compress.mjs';
import {
  runOpencode,
  listModels,
  listAgents,
  listModelsVerbose,
  buildOpencodeEnv,
} from './lib/agent-opencode.mjs';
import { loadRegistry, getBot, resolveToken, resolveRegistryPath, normalizeConfig } from './lib/registry.mjs';
import {
  parseCommand,
  parseAgentList,
  parseModelsVerbose,
  modelKeyboard,
  agentKeyboard,
  variantKeyboard,
  decodeCallback,
  helpText,
  statusText,
  formatModelList,
  formatUsage,
  extractMedia,
} from './lib/commands.mjs';

const HOME = os.homedir();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

// Lock path is lazy so tests can point it at a temp dir without touching ~/.hermes.
function dispatchLockPath() {
  return process.env.OPENCODE_BOT_DISPATCH_LOCK || path.join(HOME, '.hermes', 'dispatch_lock');
}

// True only while this process actually holds the lock for a live run.
// Lets acquireDispatchLock tell a stale self-lock (deadlock after crash/release
// failure) apart from "another chat in this same bot is running right now".
let activeDispatchRun = false;

export function beginDispatchRun() {
  activeDispatchRun = true;
}

export function endDispatchRun() {
  activeDispatchRun = false;
}

export function lockHolder() {
  let info = '';
  try {
    info = fs.readFileSync(dispatchLockPath(), 'utf8').trim();
  } catch {
    return null;
  }
  const splitAt = info.indexOf(':');
  if (splitAt < 1) return null;
  const pid = Number(info.slice(0, splitAt));
  const bug = info.slice(splitAt + 1) || 'unknown';
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
  } catch {
    return null;
  }
  return { pid, bug };
}

export function acquireDispatchLock() {
  const lockPath = dispatchLockPath();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    const holder = lockHolder();
    if (holder) {
      // Our own pid but no run in flight = stale self-lock (release failed or
      // the process restarted). Reclaim instead of rejecting every message
      // forever. With a run in flight it is a real concurrent chat — keep it.
      if (holder.pid === process.pid && !activeDispatchRun) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // another writer removed it
        }
        continue;
      }
      return holder;
    }
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, `${process.pid}:opencode-chat\n`);
      fs.closeSync(fd);
      return null;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (!lockHolder()) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // another writer removed it
        }
      }
    }
  }
  return lockHolder() || { pid: 0, bug: 'unknown' };
}

export function releaseDispatchLock() {
  try {
    const info = fs.readFileSync(dispatchLockPath(), 'utf8');
    if (info.startsWith(`${process.pid}:`)) fs.unlinkSync(dispatchLockPath());
  } catch {
    // already gone
  }
}

/** Raw run failures → one line a human can act on (never raw ms). */
export function humanizeRunError(raw) {
  const s = String(raw || '');
  const timeout = s.match(/timed out after (\d+)ms/);
  if (timeout) {
    const ms = Number(timeout[1]);
    const dur = ms >= 60000 ? `${Math.round(ms / 60000)}m` : `${Math.round(ms / 1000)}s`;
    return `Timed out after ${dur} — the model didn't finish. Send /new to reset the session, or /model to pick a faster model, then retry.`;
  }
  return s;
}

export function isTimeoutError(raw) {
  return /timed out after \d+ms/.test(String(raw || ''));
}

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
  node scripts/opencode-bot.mjs --simulate="/model" [--id=<botId>]

Bots are defined in bots/registry.json. Add a new bot by appending an entry,
exporting its token env var, and starting opencode-bot@<id>. No code changes.
`);
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

function effective(config, prefs, chatId) {
  const p = prefs.get(chatId) || {};
  return {
    model: p.model || config.agent.model,
    agent: p.agent || config.agent.defaultAgent,
    variant: p.variant || config.agent.variant,
  };
}

function makeCaches() {
  return { models: null, verbose: null, agents: null };
}

function opencodeEnv(config) {
  return buildOpencodeEnv(config.agent);
}

function chatEnv(api, chatId) {
  if (!api?.token) return {};
  return { TELEGRAM_BOT_TOKEN: api.token, TELEGRAM_CHAT_ID: String(chatId) };
}

async function getModels(config, caches) {
  if (!caches.models) {
    caches.models = await listModels({ opencodeBin: config.agent.opencodeBin, env: opencodeEnv(config) });
  }
  return caches.models;
}

async function getVariants(config, caches, modelId) {
  if (!caches.verbose) {
    caches.verbose = parseModelsVerbose(
      await listModelsVerbose({ opencodeBin: config.agent.opencodeBin, env: opencodeEnv(config) }),
    );
  }
  const entry = caches.verbose.find((m) => m.id === modelId);
  return entry?.variants || [];
}

async function getContextLimit(config, caches, modelId) {
  if (!caches.verbose) {
    caches.verbose = parseModelsVerbose(
      await listModelsVerbose({ opencodeBin: config.agent.opencodeBin, env: opencodeEnv(config) }),
    );
  }
  const entry = caches.verbose.find((m) => m.id === modelId);
  return entry?.context || 0;
}

async function getAgents(config, caches) {
  if (!caches.agents) {
    caches.agents = parseAgentList(
      await listAgents({ opencodeBin: config.agent.opencodeBin, env: opencodeEnv(config) }),
    ).filter((a) => a.type === 'primary');
  }
  return caches.agents;
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
    this.typingTimer = null;
    this.typingIntervalMs = 4000;
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
      console.log('[progress] typing...');
      this.messageId = 1;
      return;
    }
    this._startTyping();
  }

  _startTyping() {
    if (this.dryRun || typeof this.api?.sendChatAction !== 'function') return;
    const tick = () => {
      Promise.resolve(this.api.sendChatAction(this.chatId, 'typing')).catch(() => {});
    };
    tick();
    this.typingTimer = setInterval(tick, this.typingIntervalMs);
    if (typeof this.typingTimer.unref === 'function') this.typingTimer.unref();
  }

  stopTyping() {
    if (this.typingTimer) {
      clearInterval(this.typingTimer);
      this.typingTimer = null;
    }
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
    if (this.messageId == null) {
      if (!this.thinking && !this.tool) return;
      this.throttle
        .submit(async () => {
          const result = await this._guarded(() => this.api.sendMessage(this.chatId, this._render()));
          if (result?.message_id != null) this.messageId = result.message_id;
        })
        .catch(() => {});
      return;
    }
    if (this.edits >= this.maxEdits) return;
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

  async finish(result, { footer = '' } = {}) {
    this.stopTyping();
    const withFooter = (body) => (footer ? `${body}\n\n${footer}` : body);
    if (result.lastError && !result.finalText) {
      this.status = 'failed';
      if (this.messageId != null) this._schedule();
      const tail = result.stderr ? `\n${result.stderr.trim().slice(0, 400)}` : '';
      const friendly = humanizeRunError(result.lastError);
      const prefix = friendly === result.lastError ? 'Error: ' : '⏱ ';
      await this.deliver(`${prefix}${friendly}${tail}`);
      return;
    }
    this.status = 'done';
    if (this.messageId != null) this._schedule();
    if (!result.finalText) {
      const code = result.code === 0 ? '' : ` (exit ${result.code})`;
      await this.deliver(withFooter(`Done${code}, but the model returned no text output.`));
      return;
    }
    const { text: body, media } = extractMedia(withFooter(result.finalText));
    const timeoutNote = isTimeoutError(result.lastError)
      ? `\n\n⏱ ${humanizeRunError(result.lastError)}`
      : '';
    await this.deliver(body + timeoutNote);
    await this.deliverMedia(media);
  }

  async deliverMedia(paths) {
    for (const raw of paths) {
      if (!isSendableMedia(raw)) {
        console.warn(`[media] skipped (missing or not absolute): ${raw}`);
        continue;
      }
      if (this.dryRun) {
        console.log(`[media] ${raw}`);
        continue;
      }
      try {
        await this.api.sendMediaFile(this.chatId, raw);
      } catch (err) {
        if (err instanceof TelegramError && err.isRateLimit) {
          this.throttle?.pause(err.retryAfter);
        }
        await this.deliver(`Could not send ${raw}: ${err.message}`).catch(() => {});
      }
    }
  }
}

async function sendChunked(api, chatId, text) {
  for (const part of chunkText(text)) {
    await api.sendMessage(chatId, part);
  }
}

const CLEAR_KEYBOARD = { inline_keyboard: [] };

async function handleCommand({ api, config, sessions, prefs, caches, running, lastUsage, chatId, cmd }) {
  const eff = effective(config, prefs, chatId);

  switch (cmd.name) {
    case 'start':
    case 'help':
      await api.sendMessage(chatId, helpText(config, eff));
      return;

    case 'status':
      await api.sendMessage(
        chatId,
        statusText(config, { sessionId: sessions.get(chatId), ...eff, usage: lastUsage?.get(chatId) }),
      );
      return;

    case 'build':
    case 'plan':
      prefs.set(chatId, { ...(prefs.get(chatId) || {}), agent: cmd.name });
      savePrefs(config.id, prefs);
      await api.sendMessage(chatId, `Agent set to ${cmd.name} for this chat.`);
      return;

    case 'new':
      sessions.delete(chatId);
      saveSessions(config.id, sessions);
      await api.sendMessage(chatId, 'Started a fresh session.');
      return;

    case 'model': {
      if (!cmd.args) {
        const models = await getModels(config, caches);
        if (!models.length) {
          await api.sendMessage(chatId, 'Could not read the model list from opencode.');
          return;
        }
        await api.sendMessage(chatId, `Select a model (current: ${eff.model}):`, {
          reply_markup: modelKeyboard(models),
        });
        return;
      }
      if (cmd.args === 'reset') {
        const current = prefs.get(chatId) || {};
        delete current.model;
        delete current.variant;
        if (Object.keys(current).length) prefs.set(chatId, current);
        else prefs.delete(chatId);
        savePrefs(config.id, prefs);
        await api.sendMessage(chatId, `Model reset to ${config.agent.model}.`);
        return;
      }
      const target = cmd.args;
      const models = await getModels(config, caches);
      if (models.length && !models.includes(target)) {
        await api.sendMessage(chatId, `Unknown model: ${target}\nUse /model to pick from the list.`);
        return;
      }
      prefs.set(chatId, { ...(prefs.get(chatId) || {}), model: target });
      savePrefs(config.id, prefs);
      await api.sendMessage(chatId, `Model set to ${target} for this chat.`);
      return;
    }

    case 'models': {
      const models = await getModels(config, caches);
      await sendChunked(api, chatId, formatModelList(models));
      return;
    }

    case 'agent': {
      const agents = await getAgents(config, caches);
      if (!cmd.args) {
        if (!agents.length) {
          await api.sendMessage(chatId, 'Could not read the agent list from opencode.');
          return;
        }
        await api.sendMessage(chatId, `Select an agent (current: ${eff.agent}):`, {
          reply_markup: agentKeyboard(agents),
        });
        return;
      }
      const target = cmd.args;
      if (agents.length && !agents.some((a) => a.name === target)) {
        await api.sendMessage(chatId, `Unknown agent: ${target}\nUse /agent to pick from the list.`);
        return;
      }
      prefs.set(chatId, { ...(prefs.get(chatId) || {}), agent: target });
      savePrefs(config.id, prefs);
      await api.sendMessage(chatId, `Agent set to ${target} for this chat.`);
      return;
    }

    case 'thinking': {
      const variants = await getVariants(config, caches, eff.model);
      if (!cmd.args) {
        if (!variants.length) {
          await api.sendMessage(chatId, `No thinking levels exposed for ${eff.model}.`);
          return;
        }
        await api.sendMessage(chatId, `Thinking level for ${eff.model} (current: ${eff.variant || 'default'}):`, {
          reply_markup: variantKeyboard(variants),
        });
        return;
      }
      const target = cmd.args;
      if (variants.length && !variants.includes(target)) {
        await api.sendMessage(chatId, `Unknown level: ${target}\nUse /thinking to pick from the list.`);
        return;
      }
      prefs.set(chatId, { ...(prefs.get(chatId) || {}), variant: target });
      savePrefs(config.id, prefs);
      await api.sendMessage(chatId, `Thinking level set to ${target}.`);
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
      await api.sendMessage(chatId, `Unknown command: /${cmd.name}\n\n${helpText(config, eff)}`);
  }
}

async function handleCallback({ api, config, prefs, caches, query }) {
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const userId = Number(query.from?.id);
  if (!config.telegram.allowedUserIds.includes(userId) || !chatId) {
    await api.answerCallbackQuery(query.id).catch(() => {});
    return;
  }
  const { kind, value } = decodeCallback(query.data);
  try {
    if (kind === 'noop') {
      await api.answerCallbackQuery(query.id);
      return;
    }
    if (kind === 'mp') {
      const models = await getModels(config, caches);
      const eff = effective(config, prefs, chatId);
      await api.editMessageText(chatId, messageId, `Select a model (current: ${eff.model}):`, {
        reply_markup: modelKeyboard(models, { page: Number(value) || 0 }),
      });
      await api.answerCallbackQuery(query.id);
      return;
    }
    if (kind === 'm') {
      const models = await getModels(config, caches);
      const model = models[Number(value)];
      if (!model) {
        await api.answerCallbackQuery(query.id, { text: 'Expired, run /model again' });
        return;
      }
      prefs.set(chatId, { ...(prefs.get(chatId) || {}), model });
      savePrefs(config.id, prefs);
      const variants = await getVariants(config, caches, model);
      if (variants.length) {
        await api.editMessageText(chatId, messageId, `Model: ${model}\nPick a thinking level:`, {
          reply_markup: variantKeyboard(variants),
        });
      } else {
        await api.editMessageText(chatId, messageId, `Model set to ${model}.`, {
          reply_markup: CLEAR_KEYBOARD,
        });
      }
      await api.answerCallbackQuery(query.id, { text: model });
      return;
    }
    if (kind === 'a') {
      const agents = await getAgents(config, caches);
      const agent = agents[Number(value)];
      if (!agent) {
        await api.answerCallbackQuery(query.id, { text: 'Expired, run /agent again' });
        return;
      }
      prefs.set(chatId, { ...(prefs.get(chatId) || {}), agent: agent.name });
      savePrefs(config.id, prefs);
      await api.editMessageText(chatId, messageId, `Agent set to ${agent.name}.`, {
        reply_markup: CLEAR_KEYBOARD,
      });
      await api.answerCallbackQuery(query.id, { text: agent.name });
      return;
    }
    if (kind === 'v') {
      const eff = effective(config, prefs, chatId);
      const variants = await getVariants(config, caches, eff.model);
      const variant = variants[Number(value)];
      if (!variant) {
        await api.answerCallbackQuery(query.id, { text: 'Expired, run /thinking again' });
        return;
      }
      prefs.set(chatId, { ...(prefs.get(chatId) || {}), variant });
      savePrefs(config.id, prefs);
      await api.editMessageText(chatId, messageId, `Thinking level set to ${variant} for ${eff.model}.`, {
        reply_markup: CLEAR_KEYBOARD,
      });
      await api.answerCallbackQuery(query.id, { text: variant });
      return;
    }
    await api.answerCallbackQuery(query.id);
  } catch (err) {
    console.error(`[${config.id}] callback error: ${err.message}`);
    await api.answerCallbackQuery(query.id).catch(() => {});
  }
}

async function handleMessage({ api, config, throttle, sessions, prefs, caches, running, lastUsage, busy, message }) {
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
    await handleCommand({ api, config, sessions, prefs, caches, running, lastUsage, chatId, cmd });
    return;
  }

  if (busy.has(chatId)) {
    await api.sendMessage(chatId, 'Still working on the previous request. Send /abort to cancel or /new to reset.');
    return;
  }

  const holder = acquireDispatchLock();
  if (holder) {
    const selfBusy = holder.pid === process.pid;
    await api.sendMessage(
      chatId,
      selfBusy
        ? `Still working on an earlier request in this bot (pid ${holder.pid}). Send /abort to cancel it, or wait for it to finish.`
        : `The repo is busy with ${holder.bug} (pid ${holder.pid}). Wait until that finishes. A second coding agent would overwrite the same tree.`,
    );
    return;
  }
  beginDispatchRun();

  busy.add(chatId);
  const renderer = new ProgressRenderer({ api, throttle, chatId, ...config.progress });
  try {
    await renderer.start();
    const eff = effective(config, prefs, chatId);
    const extraArgs = [];
    const sessionId = sessions.get(chatId);
    if (sessionId) extraArgs.push('--session', sessionId);
    if (eff.agent) extraArgs.push('--agent', eff.agent);

    const result = await runOpencode({
      prompt: text,
      model: eff.model,
      variant: eff.variant,
      workspace: config.agent.workspace,
      thinking: config.agent.thinking,
      timeoutMs: config.agent.timeoutMs,
      opencodeBin: config.agent.opencodeBin,
      onEvent: (event) => renderer.onEvent(event),
      onSpawn: (child) => running.set(chatId, { child, aborted: false }),
      extraArgs,
      env: { ...opencodeEnv(config), ...chatEnv(api, chatId) },
    });

    if (result.sessionID) {
      sessions.set(chatId, result.sessionID);
      saveSessions(config.id, sessions);
    }
    if (running.get(chatId)?.aborted) {
      renderer.status = 'aborted';
      await renderer.deliver('Aborted.');
    } else {
      let contextLimit = 0;
      try {
        contextLimit = await getContextLimit(config, caches, eff.model);
      } catch {
        // usage is best-effort; never fail the answer over it
      }
      const usageText = formatUsage({
        tokens: result.usage?.tokens,
        cost: result.usage?.cost,
        contextLimit,
        agent: eff.agent,
      });
      if (usageText) lastUsage.set(chatId, usageText);
      await renderer.finish(result, { footer: usageText });
    }
  } catch (err) {
    await api.sendMessage(chatId, `Error: ${err.message}`).catch(() => {});
  } finally {
    renderer.stopTyping();
    running.delete(chatId);
    busy.delete(chatId);
    endDispatchRun();
    releaseDispatchLock();
  }
}

async function runLoop({ api, config }) {
  const throttle = new Throttle({ minIntervalMs: config.progress.editIntervalMs });
  const sessions = loadSessions(config.id);
  const prefs = loadPrefs(config.id);
  const caches = makeCaches();
  const running = new Map();
  const busy = new Set();
  const lastUsage = new Map();
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
      updates = await api.getUpdates({ offset, timeout: 30, allowedUpdates: ['message', 'callback_query'] });
    } catch (err) {
      if (err instanceof TelegramError && err.isRateLimit) throttle.pause(err.retryAfter);
      console.error(`[${config.id}] getUpdates failed: ${err.message}`);
      await sleep(2000);
      continue;
    }
    for (const update of updates) {
      offset = update.update_id + 1;
      saveOffset(config.id, offset);
      if (update.callback_query) {
        handleCallback({ api, config, prefs, caches, query: update.callback_query }).catch((err) => {
          console.error(`[${config.id}] callback handler error: ${err.message}`);
        });
      } else if (update.message) {
        handleMessage({ api, config, throttle, sessions, prefs, caches, running, lastUsage, busy, message: update.message }).catch(
          (err) => {
            console.error(`[${config.id}] handler error: ${err.message}`);
          },
        );
      }
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
    sendMessage: async (chatId, text, extra) => {
      console.log(`[reply]\n${text}`);
      if (extra?.reply_markup) console.log(`[keyboard] ${JSON.stringify(extra.reply_markup.inline_keyboard)}`);
      return { message_id: 1 };
    },
  };
  const caches = makeCaches();
  await handleCommand({
    api,
    config,
    sessions: new Map(),
    prefs: new Map(),
    caches,
    running: new Map(),
    lastUsage: new Map(),
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
    env: opencodeEnv(config),
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
  const config = normalizeConfig(bot, { defaultWorkspace: REPO_ROOT });
  if (config.agent.playwrightOutputDir) {
    fs.mkdirSync(config.agent.playwrightOutputDir, { recursive: true });
  }

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
  // Phone/proot network drops often; never fatal-exit on a down link at
  // startup — retry the handshake in-process instead of hot-looping proot.
  let me = null;
  for (let attempt = 1; ; attempt += 1) {
    try {
      me = await api.getMe();
      break;
    } catch (err) {
      if (attempt % 6 === 1) console.error(`[${config.id}] getMe failed (attempt ${attempt}): ${err.message} - retrying`);
      await sleep(5000);
    }
  }
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await api.deleteWebhook();
      break;
    } catch (err) {
      console.error(`[${config.id}] deleteWebhook failed (attempt ${attempt}): ${err.message}`);
      if (attempt === 5) console.error(`[${config.id}] continuing; getUpdates may 409 if a webhook is set`);
      else await sleep(5000);
    }
  }
  console.log(`[${config.id}] connected as @${me.username}`);
  await runLoop({ api, config });
}

// Run main() only when executed as a CLI (node scripts/opencode-bot.mjs),
// not when imported by a test.
function isDirectRun() {
  try {
    if (!process.argv[1]) return false;
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(`opencode-bot fatal: ${err.message}`);
    process.exit(1);
  });
}

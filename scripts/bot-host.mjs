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
import { runCline, CLINE_THINKING_LEVELS } from './lib/agent-cline.mjs';
import {
  parseModelRef,
  buildFreeModelList,
  formatFreeModelText,
  formatFreeLabel,
  CLINE_FREE_MODELS,
  toModelRef,
} from './lib/freemodels.mjs';
import { loadRegistry, getBot, resolveToken, resolveRegistryPath, normalizeConfig } from './lib/registry.mjs';
import {
  parseCommand,
  BOT_COMMANDS,
  toTelegramCommands,
  assertValidCommands,
  isFreeModel,
  parseAgentList,
  parseModelsVerbose,
  modelKeyboard,
  sortModelsFreeFirst,
  agentKeyboard,
  variantKeyboard,
  decodeCallback,
  helpText,
  formatModelList,
  formatUsage,
  extractMedia,
  extractCodeBlocks,
} from './lib/commands.mjs';
import {
  buildStatusSnapshot,
  formatStatusPlain,
  COMPACT_SUMMARY_PROMPT,
} from './lib/bot-status.mjs';
import {
  selectInboundMedia,
  sanitizeFileName,
  inboundMediaDir,
  buildInboundPrompt,
} from './lib/inbound-media.mjs';

const HOME = os.homedir();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const DISPATCH_LOCK = path.join(HOME, '.hermes', 'dispatch_lock');

function lockHolder() {
  let info = '';
  try {
    info = fs.readFileSync(DISPATCH_LOCK, 'utf8').trim();
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

function acquireDispatchLock() {
  fs.mkdirSync(path.dirname(DISPATCH_LOCK), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    const holder = lockHolder();
    if (holder) return holder;
    try {
      const fd = fs.openSync(DISPATCH_LOCK, 'wx');
      fs.writeFileSync(fd, `${process.pid}:opencode-chat\n`);
      fs.closeSync(fd);
      return null;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (!lockHolder()) {
        try {
          fs.unlinkSync(DISPATCH_LOCK);
        } catch {
          // another writer removed it
        }
      }
    }
  }
  return lockHolder() || { pid: 0, bug: 'unknown' };
}

function releaseDispatchLock() {
  try {
    const info = fs.readFileSync(DISPATCH_LOCK, 'utf8');
    if (info.startsWith(`${process.pid}:`)) fs.unlinkSync(DISPATCH_LOCK);
  } catch {
    // already gone
  }
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
  console.log(`bot-host - Telegram bridge for bots (config-driven)

Usage:
  node scripts/bot-host.mjs [--id=<botId>] [--registry=<path>]
  node scripts/bot-host.mjs --check-config [--id=<botId>]
  node scripts/bot-host.mjs --dry-run [--id=<botId>] [--prompt="..."]
  node scripts/bot-host.mjs --simulate="/model" [--id=<botId>]

Bots are defined in bots/registry.json. Add a new bot by appending an entry,
exporting its token env var, and starting bot-host@<id>. No code changes.
`);
}

function printConfig(config, registryPath) {
  console.log(`registry: ${registryPath}`);
  console.log(JSON.stringify(config, null, 2));
}

function stateDir(id) {
  const dir = path.join(HOME, '.local', 'state', 'bot-host', id);
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
const loadTotals = (id) => loadMap(id, 'totals.json');
const saveTotals = (id, totals) => saveMap(id, 'totals.json', totals);

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
  return { models: null, verbose: null, agents: null, free: null };
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
    caches.models = sortModelsFreeFirst(
      await listModels({ opencodeBin: config.agent.opencodeBin, env: opencodeEnv(config) }),
    );
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

async function getFreeModels(caches) {
  if (!caches.free) {
    caches.free = buildFreeModelList();
  }
  return caches.free;
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
      await this.deliver(`Error: ${result.lastError}${tail}`);
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
    await this.deliver(body);
    await this.deliverMedia(media);
    const blocks = extractCodeBlocks(result.finalText);
    if (blocks.length) await this.deliver(blocks.join('\n\n'));
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

async function noteUsage({ chatId, result, eff, config, caches, totals, lastUsage }) {
  let contextLimit = 0;
  try {
    contextLimit = await getContextLimit(config, caches, eff.model);
  } catch {
    // usage is best-effort; never fail the answer over it
  }
  const raw = {
    tokens: result.usage?.tokens ?? null,
    cost: Number(result.usage?.cost) || 0,
    contextLimit,
    agent: eff.agent,
  };
  lastUsage.set(chatId, raw);
  const prev = totals.get(chatId) || { runs: 0, tokens: 0, cost: 0 };
  prev.runs += 1;
  prev.tokens += Number(result.usage?.tokens?.total) || 0;
  prev.cost += raw.cost;
  totals.set(chatId, prev);
  saveTotals(config.id, totals);
  return formatUsage(raw);
}

async function handleCommand({ api, config, sessions, prefs, caches, running, lastUsage, totals, health, bootedAt, chatId, cmd }) {
  const eff = effective(config, prefs, chatId);

  switch (cmd.name) {
    case 'start':
    case 'help':
      await api.sendMessage(chatId, helpText(config, eff));
      return;

    case 'status': {
      const snap = buildStatusSnapshot({
        bot: { id: config.id, name: config.name },
        platform: config.agent.kind || 'opencode',
        capabilities: { compact: true, costTracking: true, backends: false },
        effective: eff,
        session: sessions.get(chatId) ? { id: sessions.get(chatId) } : null,
        handoff: Boolean((prefs.get(chatId) || {}).handoff),
        usage: lastUsage?.get(chatId) || null,
        totals: totals?.get(chatId) || null,
        runtime: {
          bootedAt,
          taskState: running.get(chatId) ? 'running' : 'idle',
          lock: lockHolder(),
        },
        health,
      });
      await api.sendMessage(chatId, formatStatusPlain(snap));
      return;
    }

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

    case 'compact': {
      if (running.get(chatId)) {
        await api.sendMessage(chatId, 'A request is already running. Send /abort to cancel it first.');
        return;
      }
      const compactSessionId = sessions.get(chatId);
      if (!compactSessionId) {
        await api.sendMessage(chatId, 'Nothing to compact — no active session in this chat yet.');
        return;
      }
      await api.sendMessage(chatId, 'Compacting — summarizing this session, then starting fresh…');
      try {
        const result = await runOpencode({
          prompt: COMPACT_SUMMARY_PROMPT,
          model: eff.model,
          variant: eff.variant,
          workspace: config.agent.workspace,
          thinking: config.agent.thinking,
          timeoutMs: config.agent.timeoutMs,
          opencodeBin: config.agent.opencodeBin,
          onSpawn: (child) => running.set(chatId, { child, aborted: false }),
          extraArgs: ['--session', compactSessionId],
          env: { ...opencodeEnv(config), ...chatEnv(api, chatId) },
        });
        if (running.get(chatId)?.aborted) {
          await api.sendMessage(chatId, 'Aborted — session kept as-is.');
        } else if (result.code !== 0 || !result.finalText?.trim()) {
          await api.sendMessage(chatId, `Compact failed (${result.lastError || `exit ${result.code}`}) — session kept as-is.`);
        } else {
          const brief = result.finalText.trim().slice(0, 2000);
          prefs.set(chatId, { ...(prefs.get(chatId) || {}), handoff: brief });
          savePrefs(config.id, prefs);
          sessions.delete(chatId);
          saveSessions(config.id, sessions);
          const compactUsage = await noteUsage({ chatId, result, eff, config, caches, totals, lastUsage });
          await api.sendMessage(
            chatId,
            `Compacted. Fresh session starts on your next message; the brief below carries over once.\n\n${brief}${compactUsage ? `\n\n${compactUsage}` : ''}`,
          );
        }
      } catch (err) {
        await api.sendMessage(chatId, `Compact failed: ${err.message} — session kept as-is.`).catch(() => {});
      } finally {
        running.delete(chatId);
      }
      return;
    }

    case 'model': {
      if (!cmd.args) {
        const models = await getModels(config, caches);
        if (!models.length) {
          await api.sendMessage(chatId, 'Could not read the model list from opencode.');
          return;
        }
        await api.sendMessage(chatId, `Select a model (current: ${eff.model}):\nTip: /freemodel lists free models from opencode + cline.`, {
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
      const ref = parseModelRef(cmd.args);
      if (ref.surface === 'cline') {
        if (!CLINE_FREE_MODELS.includes(ref.id)) {
          await api.sendMessage(chatId, `Unknown cline model: ${ref.id}\nUse /freemodel to pick from the free list.`);
          return;
        }
        const stored = toModelRef('cline', ref.id);
        prefs.set(chatId, { ...(prefs.get(chatId) || {}), model: stored });
        savePrefs(config.id, prefs);
        await api.sendMessage(chatId, `Model set to ${formatFreeLabel(stored)} for this chat.`);
        return;
      }
      const models = await getModels(config, caches);
      let target = ref.id;
      if (models.length && !models.includes(target) && !target.includes('/')) {
        const hit = models.find((m) => m.split('/').pop() === target);
        if (hit) target = hit;
      }
      if (models.length && !models.includes(target)) {
        await api.sendMessage(chatId, `Unknown model: ${cmd.args}\nUse /model to pick from the list or /freemodel for free models.`);
        return;
      }
      prefs.set(chatId, { ...(prefs.get(chatId) || {}), model: target });
      savePrefs(config.id, prefs);
      await api.sendMessage(chatId, `Model set to ${target} for this chat.`);
      return;
    }

    case 'free': {
      const models = await getModels(config, caches);
      const free = models.filter(isFreeModel);
      if (!models.length) {
        await api.sendMessage(chatId, 'Could not read the model list from opencode.');
        return;
      }
      if (!free.length) {
        await api.sendMessage(chatId, 'No free models found.');
        return;
      }
      await sendChunked(api, chatId, formatModelList(sortModelsFreeFirst(free).slice(0, free.length)));
      return;
    }

    case 'models': {
      const models = await getModels(config, caches);
      await sendChunked(api, chatId, formatModelList(models));
      return;
    }

    case 'freemodel': {
      const entries = await getFreeModels(caches);
      if (!entries.length) {
        await api.sendMessage(chatId, 'No free models found (opencode cache unreadable).');
        return;
      }
      await api.sendMessage(chatId, formatFreeModelText(entries, { current: eff.model }), {
        reply_markup: modelKeyboard(
          entries.map((entry) => entry.label),
          { kind: 'fm' },
        ),
      });
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
      const ref = parseModelRef(eff.model);
      const variants =
        ref.surface === 'cline' ? CLINE_THINKING_LEVELS : await getVariants(config, caches, eff.model);
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
      let models = await getModels(config, caches);
      // New buttons carry the full id (`m:opencode/...`); old keyboards
      // carry an index (`m:0`). Support both so already-shown keyboards keep
      // working.
      let model = models.includes(value) ? value : models[Number(value)];
      if (!model) {
        caches.models = null;
        models = await getModels(config, caches);
        model = models.includes(value) ? value : models[Number(value)];
      }
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
    if (kind === 'fmp') {
      const entries = await getFreeModels(caches);
      const eff = effective(config, prefs, chatId);
      await api.editMessageText(chatId, messageId, formatFreeModelText(entries, { current: eff.model }), {
        reply_markup: modelKeyboard(
          entries.map((entry) => entry.label),
          { page: Number(value) || 0, kind: 'fm' },
        ),
      });
      await api.answerCallbackQuery(query.id);
      return;
    }
    if (kind === 'fm') {
      const entries = await getFreeModels(caches);
      const entry =
        entries.find((e) => e.label === value || e.ref === value) || entries[Number(value)];
      if (!entry) {
        await api.answerCallbackQuery(query.id, { text: 'Expired, run /freemodel again' });
        return;
      }
      prefs.set(chatId, { ...(prefs.get(chatId) || {}), model: entry.ref });
      savePrefs(config.id, prefs);
      if (entry.surface === 'opencode') {
        const variants = await getVariants(config, caches, entry.ref);
        if (variants.length) {
          await api.editMessageText(chatId, messageId, `Model: ${entry.ref}\nPick a thinking level:`, {
            reply_markup: variantKeyboard(variants),
          });
          await api.answerCallbackQuery(query.id, { text: entry.ref });
          return;
        }
      }
      await api.editMessageText(chatId, messageId, `Model set to ${entry.label}.`, {
        reply_markup: CLEAR_KEYBOARD,
      });
      await api.answerCallbackQuery(query.id, { text: entry.ref });
      return;
    }
    if (kind === 'a') {
      let agents = await getAgents(config, caches);
      // New buttons carry the name (`a:build`); old keyboards carry an index
      // (`a:0`). Support both so already-shown keyboards keep working.
      let agent = agents.find((a) => a.name === value) || agents[Number(value)];
      if (!agent) {
        caches.agents = null;
        agents = await getAgents(config, caches);
        agent = agents.find((a) => a.name === value) || agents[Number(value)];
      }
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
      const ref = parseModelRef(eff.model);
      // Cline models expose fixed thinking levels, not opencode model variants.
      let variants =
        ref.surface === 'cline' ? CLINE_THINKING_LEVELS : await getVariants(config, caches, eff.model);
      // New buttons carry the name (`v:high`); old keyboards carry an index
      // (`v:0`). Support both so already-shown keyboards keep working.
      let variant = variants.includes(value) ? value : variants[Number(value)];
      if (!variant && ref.surface !== 'cline') {
        caches.verbose = null;
        variants = await getVariants(config, caches, eff.model);
        variant = variants.includes(value) ? value : variants[Number(value)];
      }
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

async function collectInboundMedia(api, message, config) {
  const items = selectInboundMedia(message);
  if (!items.length) return [];
  const dir = inboundMediaDir({
    workspace: config.agent.workspace,
    chatId: message.chat?.id,
    allowExternalDirectory: config.agent.allowExternalDirectory,
  });
  const saved = [];
  for (const item of items) {
    const dest = path.join(dir, `${Date.now()}-${sanitizeFileName(item.name)}`);
    try {
      await api.downloadFileById(item.fileId, dest);
      saved.push(dest);
      console.log(`[${config.id}] [media] inbound ${item.kind} saved: ${dest}`);
    } catch (err) {
      console.error(`[${config.id}] [media] inbound ${item.kind} download failed: ${err.message}`);
    }
  }
  return saved;
}

async function handleMessage({ api, config, throttle, sessions, prefs, caches, running, lastUsage, totals, health, bootedAt, busy, message }) {
  const chatId = message.chat.id;
  const userId = Number(message.from?.id);
  if (!config.telegram.allowedUserIds.includes(userId)) {
    console.warn(`[${config.id}] ignored message from unauthorized user ${userId}`);
    return;
  }
  const text = (message.text || message.caption || '').trim();
  const hasMedia = selectInboundMedia(message).length > 0;
  if (!text && !hasMedia) return;

  const cmd = text ? parseCommand(text) : null;
  if (cmd) {
    await handleCommand({ api, config, sessions, prefs, caches, running, lastUsage, totals, health, bootedAt, chatId, cmd });
    return;
  }

  if (busy.has(chatId)) {
    await api.sendMessage(chatId, 'Still working on the previous request. Send /abort to cancel or /new to reset.');
    return;
  }

  const holder = acquireDispatchLock();
  if (holder) {
    await api.sendMessage(
      chatId,
      `The repo is busy with ${holder.bug} (pid ${holder.pid}). Wait until that finishes. A second coding agent would overwrite the same tree.`,
    );
    return;
  }

  busy.add(chatId);
  const renderer = new ProgressRenderer({ api, throttle, chatId, ...config.progress });
  try {
    await renderer.start();
    const eff = effective(config, prefs, chatId);
    const handoff = prefs.get(chatId)?.handoff || '';
    const prompt = handoff ? `Prior session brief:\n${handoff}\n\nNew request:\n${text}` : text;
    const extraArgs = [];
    const sessionId = sessions.get(chatId);
    if (sessionId) extraArgs.push('--session', sessionId);
    if (eff.agent) extraArgs.push('--agent', eff.agent);

    const media = await collectInboundMedia(api, message, config);
    const promptWithMedia = media.length ? buildInboundPrompt(prompt, media) : prompt;

    const ref = parseModelRef(eff.model);
    const result =
      ref.surface === 'cline'
        ? await runCline({
            prompt: promptWithMedia,
            model: ref.id,
            variant: eff.variant,
            plan: eff.agent === 'plan',
            workspace: config.agent.workspace,
            timeoutMs: config.agent.timeoutMs,
            clineBin: config.agent.clineBin,
            onEvent: (event) => renderer.onEvent(event),
            onSpawn: (child) => running.set(chatId, { child, aborted: false }),
            env: chatEnv(api, chatId),
          })
        : await runOpencode({
            prompt: promptWithMedia,
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
      const usageText = await noteUsage({ chatId, result, eff, config, caches, totals, lastUsage });
      if (handoff) {
        const kept = prefs.get(chatId) || {};
        delete kept.handoff;
        prefs.set(chatId, kept);
        savePrefs(config.id, prefs);
      }
      await renderer.finish(result, { footer: usageText });
    }
  } catch (err) {
    await api.sendMessage(chatId, `Error: ${err.message}`).catch(() => {});
  } finally {
    renderer.stopTyping();
    running.delete(chatId);
    busy.delete(chatId);
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
  const totals = loadTotals(config.id);
  const bootedAt = Date.now();
  const health = { okAt: 0, errAt: 0, err: '' };
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
      health.okAt = Date.now();
      health.errAt = 0;
      health.err = '';
    } catch (err) {
      if (err instanceof TelegramError && err.isRateLimit) throttle.pause(err.retryAfter);
      console.error(`[${config.id}] getUpdates failed: ${err.message}`);
      health.errAt = Date.now();
      health.err = err.message;
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
        handleMessage({ api, config, throttle, sessions, prefs, caches, running, lastUsage, totals, health, bootedAt, busy, message: update.message }).catch(
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
    totals: new Map(),
    health: null,
    bootedAt: Date.now(),
    chatId: 'sim',
    cmd,
  });
}

async function dryRun(config, args) {
  const prompt = args.prompt || 'Say hello in one short sentence.';
  const renderer = new ProgressRenderer({ chatId: 'dry-run', dryRun: true, ...config.progress });
  await renderer.start();
  const ref = parseModelRef(config.agent.model);
  const result =
    ref.surface === 'cline'
      ? await runCline({
          prompt,
          model: ref.id,
          variant: config.agent.variant,
          workspace: config.agent.workspace,
          timeoutMs: config.agent.timeoutMs,
          clineBin: config.agent.clineBin,
          onEvent: (event) => renderer.onEvent(event),
          env: opencodeEnv(config),
        })
      : await runOpencode({
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
  if (config.runtime !== 'bot-host') {
    throw new Error(
      `Bot "${config.id}" has runtime "${config.runtime}" — it is not run by bot-host`,
    );
  }
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
  try {
    assertValidCommands(BOT_COMMANDS);
    await api.call('setMyCommands', { commands: toTelegramCommands() });
    console.log(`[${config.id}] published ${BOT_COMMANDS.length} bot commands`);
  } catch (err) {
    console.error(`[${config.id}] setMyCommands failed (non-fatal): ${err.message}`);
  }
  await runLoop({ api, config });
}

main().catch((err) => {
  console.error(`bot-host fatal: ${err.message}`);
  process.exit(1);
});

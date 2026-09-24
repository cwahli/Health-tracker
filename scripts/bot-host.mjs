#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TelegramApi, TelegramError, isSendableMedia } from './lib/tg-api.mjs';
import { chunkForTelegram } from './lib/tg-copy-code.mjs';
import { formatWorkingHeadline, ctxLimitFor } from './lib/tg-progress.mjs';
import { Throttle } from './lib/tg-throttle.mjs';
import {
  sessionKey,
  resolveSession,
  setTx,
  statusForTelegram,
  tmuxSessionFor,
} from './lib/work-session.mjs';
import { checkRegistry } from './lib/lane-contract.mjs';
import { compressReasoning } from './lib/reasoning-compress.mjs';
import { recordFailure } from './lib/failure-log.mjs';
import {
  runOpencode,
  runWithModelFailover,
  failoverModels,
  listModels,
  listAgents,
  listModelsVerbose,
  buildOpencodeEnv,
  humanizeRunError,
  isTimeoutError,
} from './lib/agent-opencode.mjs';
import { runCline, CLINE_THINKING_LEVELS } from './lib/agent-cline.mjs';
import { runGemini } from './lib/agent-gemini.mjs';
import { runFreebuff } from './lib/agent-freebuff.mjs';
import {
  parseModelRef,
  buildFreeModelList,
  formatFreeModelText,
  formatFreeLabel,
  CLINE_FREE_MODELS,
  GEMINI_MODELS,
  FREEBUFF_MODELS,
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
import { claimFiles, releaseFiles, listLocks, extractFiles } from './lib/file-locks.mjs';

const HOME = os.homedir();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

/**
 * Per-file advisory locks for concurrent agents.
 *
 * Chat is NEVER blocked: a second agent may always be messaged. A coder run
 * claims the files it expects to touch for the run's duration, so another run
 * can see which files are owned and route around them. Same-file overlap
 * warns; it never refuses. Store: ~/.hermes/file_locks/*.json
 * (scripts/lib/file-locks.mjs).
 */
function liveClaims() {
  return listLocks();
}

/** Warn-line when text names files another agent currently holds. */
function claimWarning(text) {
  const claims = liveClaims();
  if (!claims.length) return '';
  const lower = String(text ?? '').toLowerCase();
  const hits = claims.filter((c) => c.file && lower.includes(String(c.file).toLowerCase()));
  if (!hits.length) return '';
  const names = [...new Set(hits.map((h) => `${h.file} (by ${h.bugId || 'another run'})`))].slice(0, 5);
  return `\n⚠️ Another agent is editing: ${names.join(', ')}. Chat away — a fix here will route around those files.`;
}

/** Kept for the /status read path; the legacy global lock is gone. */
function lockHolder() {
  return null;
}

function acquireDispatchLock() {
  // Chat must never block. Locking happens per file at coder-run start.
  return null;
}

function releaseDispatchLock() {
  // No global lock to release anymore.
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

export const loadLeases = (id) => loadMap(id, 'leases.json');
export const saveLeases = (id, leases) => saveMap(id, 'leases.json', leases);

export function recordRunStart(id, { chatId, messageId = null, startedAt = Date.now(), pid = process.pid }) {
  const leases = loadLeases(id);
  leases.set(String(chatId), { chatId, messageId, startedAt, pid });
  saveLeases(id, leases);
}

export function recordRunFinish(id, chatId) {
  const leases = loadLeases(id);
  if (leases.delete(String(chatId))) {
    saveLeases(id, leases);
  }
}

export async function sweepOrphanedLeases({ api, config, bootTime = Date.now() }) {
  const leases = loadLeases(config.id);
  if (leases.size === 0) return 0;
  let swept = 0;
  for (const [key, lease] of Array.from(leases.entries())) {
    if (lease.startedAt <= bootTime || lease.pid !== process.pid) {
      if (lease.messageId != null && api && typeof api.editMessageText === 'function') {
        try {
          await api.editMessageText(lease.chatId, lease.messageId, 'restarted mid-run — send it again');
        } catch (err) {
          console.warn(`[${config.id}] sweep editMessageText failed for chat ${lease.chatId}: ${err.message}`);
        }
      }
      recordFailure({
        bot: config.id,
        lane: config.agent?.model || 'unknown',
        kind: 'crash-pending',
        hint: `restarted mid-run for chat ${lease.chatId} (pid ${lease.pid})`,
      });
      leases.delete(key);
      swept += 1;
    }
  }
  if (swept > 0) {
    saveLeases(config.id, leases);
    console.log(`[${config.id}] swept ${swept} orphaned run lease(s) to crash-pending`);
  }
  return swept;
}

export function buildQuotedPrompt(text, replyToMessage) {
  const prompt = String(text ?? '');
  const quotedText = String(replyToMessage?.text || replyToMessage?.caption || '').trim();
  if (!quotedText) return prompt;
  return `[Quoted Telegram message]\n${quotedText}\n\n[New message]\n${prompt}`;
}

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

export class ProgressRenderer {
  constructor({ api = null, throttle = null, chatId, mode, maxChars, maxEdits, dryRun = false, providerLabel = '', modelLabel = '', thinking = '', onMessageId = null }) {
    this.api = api;
    this.throttle = throttle;
    this.chatId = chatId;
    this.mode = mode;
    this.maxChars = maxChars;
    this.maxEdits = maxEdits;
    this.dryRun = dryRun;
    this.providerLabel = providerLabel;
    this.modelLabel = modelLabel;
    this.thinkingLevel = thinking;
    this.onMessageId = onMessageId;
    this.startedAt = null;
    this.usedTokens = null;
    this.messageId = null;
    this.edits = 0;
    this.creating = false;
    this.createRetryAt = 0;
    this.thinking = '';
    this.tool = '';
    this.status = 'starting';
    this.typingTimer = null;
    this.typingIntervalMs = 4000;
  }

  setHeadline({ providerLabel, modelLabel, thinking } = {}) {
    if (providerLabel != null) this.providerLabel = providerLabel;
    if (modelLabel != null) this.modelLabel = modelLabel;
    if (thinking != null) this.thinkingLevel = thinking;
  }

  _render() {
    const lines = [];
    const elapsedSec = this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
    lines.push(
      formatWorkingHeadline({
        providerLabel: this.providerLabel || 'Agent',
        modelLabel: this.modelLabel,
        thinking: this.thinkingLevel,
        elapsedSec,
        used: this.usedTokens,
        ctxLimit: ctxLimitFor(this.modelLabel),
        detail: this.status,
      }),
    );
    if (this.thinking) lines.push(`Thinking: ${this.thinking}`);
    if (this.tool) lines.push(`Tool: ${this.tool}`);
    return lines.join('\n');
  }

  async start() {
    if (this.dryRun) {
      console.log('[progress] typing...');
      this.messageId = 1;
      return;
    }
    this.startedAt = Date.now();
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
      // Drop compressor fragments (".", "/", "check", "at", ":") and repeats:
      // each accepted gist would otherwise become its own chat message.
      const clean = gist.trim();
      if (!clean || clean.length < 8 || clean === this.thinking) return;
      this.thinking = gist;
      this.status = 'thinking';
      this._schedule();
    } else if (event.kind === 'tool') {
      this.tool = `${event.tool} (${event.status})`;
      this.status = 'working';
      this._schedule();
    } else if (event.kind === 'step_finish') {
      if (event.tokens != null && Number.isFinite(Number(event.tokens))) {
        this.usedTokens = (this.usedTokens || 0) + Number(event.tokens);
      }
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
      // One progress message per run: never queue a second create while the
      // first is in flight, and back off after a failed create (rate-limit
      // returns null) instead of spawning a new message per event.
      if (this.creating || Date.now() < this.createRetryAt) return;
      this.creating = true;
      this.throttle
        .submit(async () => {
          try {
            const result = await this._guarded(() => this.api.sendMessage(this.chatId, this._render()));
            if (result?.message_id != null) {
              this.messageId = result.message_id;
              if (typeof this.onMessageId === 'function') {
                try { this.onMessageId(this.messageId); } catch {}
              }
            } else {
              this.createRetryAt = Date.now() + 5000;
            }
          } finally {
            this.creating = false;
          }
        })
        .catch(() => {
          this.creating = false;
        });
      return;
    }
    if (this.edits >= this.maxEdits) return;
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
    const payloads = chunkForTelegram(body);
    if (this.dryRun) {
      for (const p of payloads) console.log(`[final] ${p.text}`);
      return;
    }
    for (const p of payloads) {
      await this._send(p.text, p.extra);
    }
  }

  async _send(part, extra = {}) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.api.sendMessage(this.chatId, part, extra);
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
    const partial = String(result.finalText || '').trim();
    const errText = String(result.lastError || '').trim();
    const errTail = result.stderr ? `\n${String(result.stderr).trim().slice(0, 400)}` : '';
    const stderrBlank = !String(result.stderr || '').trim();
    // Killed before producing anything (SIGKILL on bot restart/redeploy, OOM):
    // close code is null, no error event, empty stderr. Nothing was computed.
    const killedNoOutput = result.code == null && !errText && stderrBlank && !partial;
    if (killedNoOutput) {
      this.status = 'failed';
      if (this.messageId != null) this._schedule();
      await this.deliver(
        withFooter(
          'Interrupted before the model produced output (the bot process restarted mid-run). Nothing was computed — just send your request again.',
        ),
      );
      return;
    }
    if (errText && !partial) {
      this.status = 'failed';
      if (this.messageId != null) this._schedule();
      const friendly = humanizeRunError(errText);
      let hint = '';
      let lead = `Error: ${friendly}`;
      if (isTimeoutError(errText)) {
        lead = `⏱ ${friendly}`;
        hint =
          '\nTip: retry with /thinking medium, a smaller ask, /model for a faster model, or /new for a fresh session.';
      }
      await this.deliver(`${lead}${errTail}${hint}`);
      return;
    }
    this.status = 'done';
    if (this.messageId != null) this._schedule();
    if (!partial) {
      const code = result.code === 0 ? '' : ` (exit ${result.code})`;
      await this.deliver(withFooter(`Done${code}, but the model returned no text output.`));
      return;
    }
    const { text: body, media } = extractMedia(withFooter(partial));
    await this.deliver(body);
    await this.deliverMedia(media);
    const blocks = extractCodeBlocks(partial);
    if (blocks.length) await this.deliver(blocks.join('\n\n'));
    if (errText) {
      // Partial output arrived but the run still errored (e.g. a late timeout):
      // never swallow the error silently.
      await this.deliver(`(Finished with an error after partial output: ${humanizeRunError(errText)})`);
    }
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
  for (const p of chunkForTelegram(text)) {
    await api.sendMessage(chatId, p.text, p.extra);
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

/**
 * BOT-19 live /tx wiring: shared work-view toggle per (location, chat,
 * workspace) session. Exported for unit tests; the `tx` command case below
 * delegates here. Replies are plain text (already secret-scrubbed by
 * statusForTelegram).
 */
export function workLocation() {
  if (process.env.BOT_LOCATION) return process.env.BOT_LOCATION;
  return os.homedir() === '/root' ? 'mobile' : 'vps';
}

export async function handleTxCommand({ api, config, chatId, arg }) {
  const location = workLocation();
  const id = sessionKey({ location, chat: String(chatId), workspace: config.agent.workspace });
  const sub = String(arg || '').trim().toLowerCase();
  if (sub === 'on' || sub === 'off') {
    resolveSession({ location, chat: String(chatId), workspace: config.agent.workspace, lane: config.agent.kind || 'opencode' });
    setTx(id, sub === 'on');
  } else if (sub !== '' && sub !== 'status') {
    await api.sendMessage(chatId, 'Usage: /tx on|off|status — shared work-view for this chat.');
    return;
  }
  const view = statusForTelegram(id);
  if (!view) {
    await api.sendMessage(chatId, 'No work session for this chat yet — send a message first, then /tx.');
    return;
  }
  const lines = [
    `*Shared work view:* ${view.tx ? 'ON 📺' : 'OFF'}`,
    `Session: \`${view.id}\``,
    `Lane: \`${view.lane}\` (${view.state})`,
    `Attach: \`tmux attach -t ${tmuxSessionFor(location)}\``,
    `Terminal: ${view.probe?.attach ? 'attached' : 'not attached'}`,
  ];
  await api.sendMessage(chatId, lines.join('\n'));
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
        await api.sendMessage(chatId, `Select a model (current: ${eff.model}):\nTip: /freemodel lists free models from opencode + cline + gemini + freebuff.`, {
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
      if (ref.surface === 'gemini') {
        if (!GEMINI_MODELS.includes(ref.id)) {
          await api.sendMessage(chatId, `Unknown gemini model: ${ref.id}\nUse /freemodel to pick from the free list.`);
          return;
        }
        const stored = toModelRef('gemini', ref.id);
        prefs.set(chatId, { ...(prefs.get(chatId) || {}), model: stored });
        savePrefs(config.id, prefs);
        await api.sendMessage(chatId, `Model set to ${formatFreeLabel(stored)} for this chat.`);
        return;
      }
      if (ref.surface === 'freebuff') {
        if (!FREEBUFF_MODELS.includes(ref.id)) {
          await api.sendMessage(chatId, `Unknown freebuff model: ${ref.id}\nUse /freemodel to pick from the free list.`);
          return;
        }
        const stored = toModelRef('freebuff', ref.id);
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
      // Gemini is single-shot: no variants, no opencode verbose lookup.
      const variants =
        ref.surface === 'cline' ? CLINE_THINKING_LEVELS : ref.surface === 'gemini' || ref.surface === 'freebuff' ? [] : await getVariants(config, caches, eff.model);
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

    case 'tx': {
      await handleTxCommand({ api, config, chatId, arg: cmd.args });
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
      // Gemini exposes none (single-shot lane).
      let variants =
        ref.surface === 'cline' ? CLINE_THINKING_LEVELS : ref.surface === 'gemini' || ref.surface === 'freebuff' ? [] : await getVariants(config, caches, eff.model);
      // New buttons carry the name (`v:high`); old keyboards carry an index
      // (`v:0`). Support both so already-shown keyboards keep working.
      let variant = variants.includes(value) ? value : variants[Number(value)];
      if (!variant && ref.surface !== 'cline' && ref.surface !== 'gemini' && ref.surface !== 'freebuff') {
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

/**
 * BOT-9 live failover wiring for the main message path: run the prompt on
 * the chat's effective model, falling back to the bot default on retryable
 * failures (quota/unfunded/5xx — never timeout/abort, per defaultIsRetryable).
 * The switch posts a user-visible line. A single-model chain behaves exactly
 * like a direct runOpencode call. Exported for unit tests.
 */
export async function runOpencodeWithFailover({ api, chatId, prompt, models, onSwitchNotify, ...runArgs }) {
  const { result } = await runWithModelFailover({
    models,
    makeRun: (model) => runOpencode({ prompt, model, ...runArgs }),
    onSwitch: ({ from, to, reason }) => {
      const line = `🔀 *${from}* failed (${String(reason || 'error').slice(0, 200)}) — switching to *${to}*…`;
      try {
        if (typeof onSwitchNotify === 'function') {
          onSwitchNotify(line);
        } else {
          const p = api.sendMessage(chatId, line);
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } catch {
        // a UI hiccup must never break failover
      }
    },
  });
  return result;
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

  // Parallel by design: chat never waits on another agent. Advisory per-file
  // claims warn when the request names a file someone else is editing.
  const warn = claimWarning(text);
  if (warn) {
    await api.sendMessage(chatId, `Heads up:${warn}`).catch(() => {});
  }

  const claimId = `chat-${chatId}`;
  const claimed = claimFiles(extractFiles(text), {
    bugId: claimId,
    tool: 'opencode',
    pid: process.pid,
    worktree: config.agent.workspace,
  }).claimed;

  busy.add(chatId);
  const runStartedAt = Date.now();
  recordRunStart(config.id, { chatId, messageId: null, startedAt: runStartedAt, pid: process.pid });
  const renderer = new ProgressRenderer({
    api,
    throttle,
    chatId,
    ...config.progress,
    onMessageId: (msgId) => {
      recordRunStart(config.id, { chatId, messageId: msgId, startedAt: runStartedAt, pid: process.pid });
    },
  });
  try {
    await renderer.start();
    const eff = effective(config, prefs, chatId);
    // One shared working headline (provider + model + elapsed + usage) for
    // every bot-host agent — same line shape as the Grok TG router.
    const ref = parseModelRef(eff.model);
    const kind = config.agent.kind || 'opencode';
    renderer.setHeadline({
      providerLabel: ref.surface === 'cline' ? 'Cline' : ref.surface === 'gemini' ? 'Gemini' : ref.surface === 'freebuff' ? 'Freebuff' : kind === 'cline' ? 'Cline' : kind === 'gemini' ? 'Gemini' : 'OpenCode',
      modelLabel: eff.model || '',
    });
    const handoff = prefs.get(chatId)?.handoff || '';
    const quotedPrompt = buildQuotedPrompt(text, message.reply_to_message);
    const basePrompt = handoff ? `Prior session brief:\n${handoff}\n\nNew request:\n${quotedPrompt}` : quotedPrompt;
    const blocked = liveClaims()
      .filter((c) => c.bugId !== claimId && !claimed.includes(c.file))
      .map((c) => c.file);
    const routeNote = blocked.length
      ? `\n\n[PARALLEL AGENTS] Another agent is editing: ${blocked.slice(0, 10).join(', ')}. Do not modify those files; work only on the rest.`
      : '';
    const prompt = basePrompt + routeNote;
    const extraArgs = [];
    const sessionId = sessions.get(chatId);
    if (sessionId) extraArgs.push('--session', sessionId);
    if (eff.agent) extraArgs.push('--agent', eff.agent);

    const media = await collectInboundMedia(api, message, config);
    const promptWithMedia = media.length ? buildInboundPrompt(prompt, media) : prompt;

    // Gemini is a keyed single-shot lane (no tools/session/plan/agent): same
    // prompt and renderer, no workspace wiring.
    const result =
      ref.surface === 'gemini'
        ? await runGemini({
            prompt: promptWithMedia,
            model: ref.id,
            timeoutMs: config.agent.timeoutMs,
            env: { ...opencodeEnv(config), ...chatEnv(api, chatId) },
          })
        : ref.surface === 'cline'
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
          : ref.surface === 'freebuff'
            ? await runFreebuff({
                prompt: promptWithMedia,
                model: ref.id,
                timeoutMs: config.agent.timeoutMs,
                env: { ...process.env, ...opencodeEnv(config), ...chatEnv(api, chatId) },
              })
            : await runOpencodeWithFailover({
            api,
            chatId,
            prompt: promptWithMedia,
            models: failoverModels(eff.model, config.agent.model),
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
    releaseFiles(claimed, claimId);
    recordRunFinish(config.id, chatId);
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
  // In-flight update handlers. On SIGTERM (service restart/redeploy) we stop
  // polling for NEW updates but let running requests finish (bounded) so a
  // restart no longer kills runs into "exit null, no text output".
  const inflight = new Set();
  const DRAIN_MS = 60000;

  const stop = () => {
    running_ = false;
  };
  const track = (promise) => {
    inflight.add(promise);
    promise.finally(() => inflight.delete(promise));
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
      if (err instanceof TelegramError && (err.status === 409 || err.isConflict)) {
        console.error(`[${config.id}] Telegram 409 Conflict: another poller is active for this token. Exiting.`);
        process.exit(1);
      }
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
        track(
          handleCallback({ api, config, prefs, caches, query: update.callback_query }).catch((err) => {
            console.error(`[${config.id}] callback handler error: ${err.message}`);
          }),
        );
      } else if (update.message) {
        track(
          handleMessage({ api, config, throttle, sessions, prefs, caches, running, lastUsage, totals, health, bootedAt, busy, message: update.message }).catch(
            (err) => {
              console.error(`[${config.id}] handler error: ${err.message}`);
            },
          ),
        );
      }
    }
  }
  if (inflight.size > 0) {
    console.log(`[${config.id}] shutting down: draining ${inflight.size} in-flight request(s) (up to ${DRAIN_MS}ms)`);
    await Promise.race([Promise.allSettled([...inflight]), sleep(DRAIN_MS)]);
    if (inflight.size > 0) console.log(`[${config.id}] shutdown: ${inflight.size} request(s) still running; exiting anyway`);
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
    ref.surface === 'gemini'
      ? await runGemini({
          prompt,
          model: ref.id,
          timeoutMs: config.agent.timeoutMs,
          env: opencodeEnv(config),
        })
      : ref.surface === 'cline'
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
        : ref.surface === 'freebuff'
          ? await runFreebuff({
              prompt,
              model: ref.id,
              timeoutMs: config.agent.timeoutMs,
              env: { ...process.env, ...opencodeEnv(config) },
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
  // BOT-17 lane contract enforced at startup: a registry that names an
  // agent/model/process as a bot must never boot a poller. Fail loud.
  const laneViolations = checkRegistry(registry);
  if (laneViolations.length) {
    console.error(`[bot-host] lane-contract violations:\n- ${laneViolations.join('\n- ')}\nRefusing to start.`);
    process.exit(1);
  }
  const bot = getBot(registry, args.id);
  const config = normalizeConfig(bot, { defaultWorkspace: REPO_ROOT });
  if (config.runtime !== 'bot-host' && config.runtime !== 'device') {
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
      if (err instanceof TelegramError && (err.status === 409 || err.isConflict)) {
        console.error(`[${config.id}] deleteWebhook hit Telegram 409 Conflict. Exiting.`);
        process.exit(1);
      }
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
  await sweepOrphanedLeases({ api, config });
  await runLoop({ api, config });
}

// Import-safe: vitest and other tooling import ProgressRenderer without booting the bot.
const invokedAsCli = (() => {
  try {
    return process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (invokedAsCli) {
  main().catch((err) => {
    console.error(`bot-host fatal: ${err.message}`);
    process.exit(1);
  });
}

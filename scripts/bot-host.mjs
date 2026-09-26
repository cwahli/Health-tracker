#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { TelegramApi, TelegramError, isSendableMedia } from './lib/tg-api.mjs';
import { chunkForTelegram } from './lib/tg-copy-code.mjs';
import { formatWorkingHeadline, ctxLimitFor } from './lib/tg-progress.mjs';
import { Throttle } from './lib/tg-throttle.mjs';
import {
  sessionKey,
  projectIdForWorkspace,
  resolveSession,
  getSession,
  setTx,
  setWorkView,
  handoffSession,
  abortSession,
  checkpointSession,
  statusForTelegram,
  defaultTmuxRunner,
  ensureTmuxWorkView,
  disableTmuxObserver,
  createObserver,
  WORK_VIEW_SESSION,
  workViewTarget,
  repointWorkView,
} from './lib/work-session.mjs';
import { checkRegistry } from './lib/lane-contract.mjs';
import { compressReasoning } from './lib/reasoning-compress.mjs';
import { recordFailure, loadFailures } from './lib/failure-log.mjs';
import { providerReadiness, setupGaps, setServiceUnit } from './lib/setup-gaps.mjs';
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
  isQuotaOrLimitError,
  extractLogError,
  parseRetryAfter,
} from './lib/agent-opencode.mjs';
import { ensureOpencodeTui, abortOpencodeSession, opencodeServerHealthy } from './lib/opencode-tui.mjs';
import { KNOWN_HOSTS, workerStatus, isLocalHost } from './lib/worker-presence.mjs';
import { getBlockedLocation, setBlockedLocation, clearBlockedLocation } from './lib/location-state.mjs';
import { appendRow, retrieve } from './lib/memory-stores.mjs';
import { enqueueJob, awaitJob, requeueJob, getJob, DEFAULT_LEASE_MS } from './lib/worker-jobs.mjs';
import { preflightWorkerTurn, classifyWorkerFailure, retryDelayMs, preflightSummary, relayUrl } from './lib/swap-guards.mjs';
import { routeState, routeFor, armRoute, confirmRoute, rollbackRoute, validateCanaryResult } from './lib/worker-routing.mjs';
import { acquirePollerLease, releasePollerLease, renewPollerLease } from './lib/poller-lease.mjs';
import { buildPack, packWithContents } from './lib/swap-pack.mjs';
import { runCline, CLINE_THINKING_LEVELS } from './lib/agent-cline.mjs';
import { runGemini } from './lib/agent-gemini.mjs';
import { parseRetryHintMs } from './lib/tool-allowance-ping.mjs';
import { recordError, noteHealthy } from './lib/error-log.mjs';
import {
  parseModelRef,
  buildFreeModelList,
  formatFreeModelText,
  formatFreeLabel,
  CLINE_FREE_MODELS,
  clineReady,
  GEMINI_MODELS,
  GEMINI_TO_OPENCODE,
  toModelRef,
} from './lib/freemodels.mjs';
import {
  loadFreeLaneLedger,
  annotateFreemodelEntries,
  isFreemodelEntryDepleted,
  buildAllowanceTextForBots,
  withCatalogLanes,
  entriesFromLanes,
  effectiveProviderOf,
  planCodeForLane,
  canonicalAllowanceLanes,
  formatResetIn,
  renderFreeLaneTableHtml,
  ensureBotLedger,
  stampDepleted,
  freemodelRefToRoute,
  usableTurnLanes,
  projectLanes,
  soonestResetAmongDepleted,
  isConnectionFailure,
  stampCooldown,
  CONNECTION_FAILED_COOLDOWN_MS,
} from './lib/free-lanes.mjs';
// R-16: the score on a button is the bakeoff ledger's own verdict, and the tier
// is the catalog's. Both live in the catalogs, so there is no ratings table here
// to drift from them. A model with no ledger row renders "unranked".
import { scoreLabelFor, walkTierRank, tierForModel } from './lib/free-catalogs.mjs';
import { loadRegistry, getBot, resolveToken, resolveRegistryPath, normalizeConfig } from './lib/registry.mjs';
import {
  parseCommand,
  BOT_COMMANDS,
  toTelegramCommands,
  assertValidCommands,
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
import {
  KNOWN_PROJECTS,
  getChatProject,
  getChatRole,
  switchChatProject,
  switchChatRole,
  resetChatRole,
  checkRoleDetails,
  getProjectRoles,
  addProjectRole,
  removeProjectRole,
  composeExternalPrompt,
  formatProjectsSummary,
} from './lib/project-registry.mjs';
import { runFullCouncil, runCouncilStage, getCouncilStatus } from './council-runner.mjs';

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

/**
 * A chat's stored prefs, whichever way the key was written.
 *
 * JSON object keys are always strings, so every map rebuilt by loadMap is
 * keyed "6218257274", while the code looks the row up with the numeric chatId.
 * Inside one process the numeric key it just wrote still matches; after a
 * restart it does not, and the chat silently falls back to the bot default
 * model. That is how @VM_19485_bot ran opencode/nemotron for a chat that had
 * chosen Cline. Same for the setter, so the next write does not fork the row.
 */
function prefFor(prefs, chatId) {
  if (!prefs) return {};
  return prefs.get(chatId) || prefs.get(String(chatId)) || {};
}
function setPref(prefs, chatId, patch) {
  const next = { ...prefFor(prefs, chatId), ...patch };
  for (const key of [...prefs.keys()]) {
    if (String(key) === String(chatId)) prefs.delete(key);
  }
  prefs.set(chatId, next);
  return next;
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
  const p = prefFor(prefs, chatId);
  const storedModel = p.model || config.agent.model;
  const legacyGemini = String(storedModel || '').startsWith('gemini:')
    ? GEMINI_TO_OPENCODE[String(storedModel).slice('gemini:'.length)]
    : null;
  return {
    model: legacyGemini || storedModel,
    agent: p.agent || config.agent.defaultAgent,
    variant: p.variant || config.agent.variant,
  };
}

/**
 * Provider label follows the chat's EFFECTIVE model surface, never the bot's
 * registry default: after `/freemodel` switches a chat to Cline, status and
 * progress headlines must say Cline, not OpenCode.
 */
export function providerLabelForModel(model) {
  const surface = parseModelRef(model).surface;
  if (surface === 'cline') return 'Cline';
  if (surface === 'gemini') return 'Gemini';
  return 'OpenCode';
}

function shortProviderModel(model) {
  const { surface, id } = parseModelRef(model);
  if (surface === 'cline') return String(id).replace(/^cline-free\//, '');
  return id;
}

function extractEmbeddedMessage(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  try {
    const parsed = JSON.parse(s);
    const message = parsed?.message || parsed?.error?.message || parsed?.error;
    if (typeof message === 'string' && message.trim()) return message.trim();
  } catch {
    // not a JSON envelope — use the raw text below
  }
  return s;
}

/**
 * One user-actionable line for a non-OpenCode lane failure. Cline reports
 * quota hits as a raw `INFERENCE_CAP_ERROR` JSON blob plus a JSON stderr
 * tail; the chat should instead see the limit, the vendor retry hint, and
 * the next step — never the raw envelope.
 */
export function formatProviderFailure({ surface, model, lastError, stderr } = {}) {
  const provider = surface === 'cline' ? 'Cline' : surface === 'gemini' ? 'Gemini' : 'OpenCode';
  const combined = `${lastError || ''} ${stderr || ''}`;
  const hint = parseRetryAfter(combined);
  if (isQuotaOrLimitError(combined)) {
    const daily = /daily free|free limit|free_tier_limit|free usage/i.test(combined);
    const head = daily
      ? `${provider} daily free limit reached for ${shortProviderModel(model)}`
      : `${provider} quota/rate limit hit for ${shortProviderModel(model)}`;
    return {
      message: `${head}.${hint ? ` ${hint}` : ''} Pick another lane from /freemodel or wait for reset.`,
      stderr: '',
    };
  }
  const detail = extractEmbeddedMessage(lastError)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  return {
    message: `${provider} error for ${shortProviderModel(model)}: ${detail || 'unknown error'}`,
    stderr: String(stderr || ''),
  };
}

function makeCaches() {
  return { models: null, verbose: null, agents: null, free: null, readiness: null };
}

/**
 * Which providers this host can actually use, and what is missing for the rest.
 * Cached with the model list: credentials do not change between turns, and the
 * check is local (env var, binary, auth file) so it costs nothing to repeat.
 */
export function hostReadiness(caches, botId = 'vm') {
  // The fix text names the service to restart, so it must name THIS bot's.
  setServiceUnit(botId);
  if (caches.readiness) return caches.readiness;
  caches.readiness = providerReadiness({
    env: process.env,
    location: workLocation(),
    clineReady,
  });
  return caches.readiness;
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

async function getFreeModels(caches, config) {
  const location = workLocation();
  if (!caches.free || caches.freeLocation !== location) {
    caches.free = buildFreeModelList({
      location,
      env: process.env,
      opencodeBin: config?.agent?.opencodeBin,
      clineBin: config?.agent?.clineBin,
    });
    caches.freeLocation = location;
  }
  return caches.free;
}

/**
 * Per-bot free-lane ledger (consolidated from the Grok router tracker).
 * Each bot id owns its dir — quota is per-account/host, so bot A never
 * reads bot B's stamps. Seeded from the repo pref doc on first use.
 * Never throws; falls back to pref order when the ledger is missing.
 */
function getLedger(botId) {
  try {
    const ensured = ensureBotLedger(botId || 'default');
    const loaded = loadFreeLaneLedger({ stateDir: ensured.dir });
    if (loaded.table) return { ...loaded, dir: ensured.dir };
    return { table: null, session: {}, tablePath: null, sessionPath: null, source: 'empty', dir: ensured.dir };
  } catch {
    return { table: null, session: {}, tablePath: null, sessionPath: null, source: 'empty', dir: null };
  }
}

function getAnnotatedFreeModels(caches, botId) {
  const catalog = caches.free || buildFreeModelList({ location: workLocation() });
  caches.free = catalog;
  // The table is folded with the catalog first, so a model the catalog knows but
  // the table predates (every Gemini row) gets a lane row and a verdict here
  // instead of being reported as "not in this ledger" and marked selectable. The
  // fold then runs again over the union, so a model that lives only in the ledger
  // — the Token Harbor, Cloudflare and Freebuff rows, none of which are in the
  // OpenCode models cache the catalog reads — is offered here too. One list.
  const loaded = getLedger(botId);
  let merged = withCatalogLanes(loaded.table, catalog).table;
  if (!merged) return { entries: catalog, annotated: catalog.map((e) => ({ ...e, depleted: false })), source: 'empty' };
  const base = [
    // A "pending setup/sign-in" placeholder for a provider the ledger already has
    // rows for is simply wrong: those models exist and are reachable, they are just
    // reached through a different surface than the OpenCode models cache. It showed
    // up as "tokenharbor (pending setup/sign-in)" on a host whose Token Harbor key
    // worked and whose /allowance listed five Token Harbor models.
    ...catalog.filter((e) => {
      if (!e || e.status !== 'pending-signin') return true;
      const tool = String(e.tool || '').toLowerCase();
      return !merged.lanes.some((l) => String(l.provider || '').toLowerCase() === tool || String(effectiveProviderOf(l) || '').toLowerCase() === tool);
    }),
    ...entriesFromLanes(merged, catalog),
  ];
  merged = withCatalogLanes(merged, base).table;
  return {
    entries: base,
    annotated: annotateFreemodelEntries(base, merged, loaded.session, { location: workLocation(), readiness: hostReadiness(caches) }),
    table: merged,
    session: loaded.session,
    source: loaded.source,
  };
}

/**
 * Auto-track: stamp a run's quota failure into the bot's OWN ledger (the
 * automation behind "empty/rate-limit stamps Reset"). Uses the
 * small=true-filtered error so cosmetic title-agent failures never deplete
 * a lane. Best-effort — never throws, never blocks the chat.
 */
/**
 * Keep a lane out of the walk for a few minutes after a transport failure.
 * Never throws: a stamp that fails must not cost the chat its answer.
 */
export function stampLaneCooldown({ botId, model, errText, now = Date.now() } = {}) {
  try {
    const { provider, model: m } = freemodelRefToRoute(model || '');
    if (!provider || !m) return null;
    const { dir } = ensureBotLedger(botId || 'default');
    const stamped = stampCooldown({ stateDir: dir, provider, model: m, errText, now });
    if (stamped.stamped) {
      console.log(`[${botId}] connection cooldown on ${provider}/${m} until ${new Date(now + CONNECTION_FAILED_COOLDOWN_MS).toISOString()}`);
    }
    return stamped;
  } catch {
    return null;
  }
}

/**
 * Why an attempt failed. runOpencode puts provider text in lastError, but a
 * transport failure from the CLI often only reaches stderr, so both are read.
 * This is the same order trackRunQuota uses.
 */
export function attemptFailureText(result) {
  const parsed = String(extractLogError(result?.stderr || '') || '').trim();
  if (parsed) return parsed;
  const lastError = String(result?.lastError || '').trim();
  if (lastError) return lastError;
  // Not every surface logs with level=ERROR. A transport failure that only
  // shows up as the last stderr line still has to be recognisable, or the
  // cooldown silently never happens.
  const lines = String(result?.stderr || '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

/**
 * Run this turn on the host the location names, if that host has a worker
 * connected. The worker runs the prompt on its own machine and stamps its own
 * ledger; the VM poller does not call trackRunQuota for it, so the VM's ledger
 * and the worker's stay separate facts.
 *
 * The job carries the conversation (sessionId) and the workspace as a project
 * id, because the worker resolves both on its own machine. A turn handed to a
 * notebook continues the thread the VM started instead of answering blank.
 *
 * Runs the turn on that machine and returns its result — or a named failure.
 * It never falls back to running locally: the caller decides whether to hold
 * the turn (guard 5) rather than silently spending this machine's allowance.
 */
export async function runOnWorker({ host, prompt, model, project = '', role = '', workspace = '', sessionId = '', envMode = 'project', timeoutMs = 900000, canary = false, relay = '', preflightFull = false, attempts = 3, packRoot = '' } = {}) {
  // Guard 4: presence → relay → workspace → session, each named, first failure
  // wins, so a bad target is caught before a job exists — not after a worker
  // has claimed it.
  const preflight = await preflightWorkerTurn({ host, workspace, sessionId, relay, full: preflightFull });
  if (!preflight.ok) {
    console.log(`[${host}] preflight failed at ${preflight.failed}: ${preflight.reason}`);
    return { text: '', code: 1, model, error: `preflight failed (${preflight.failed}): ${preflight.reason}`, remote: true, preflight, failed: preflight.failed };
  }
  // Guard 9: on a swap the files this conversation has been editing travel
  // with it, so the worker does not run the turn against its own copy.
  let packId = '';
  if (packRoot) {
    const built = buildPack(packRoot);
    if (!built.ok) {
      console.log(`[${host}] pack refused: ${built.reason} (the turn runs without it)`);
    } else {
      const payload = packWithContents(built);
      if (!payload.ok) console.log(`[${host}] pack not built: ${payload.reason} (the turn runs without it)`);
      else {
        const res = await fetch(`${relayUrl({ url: relay })}/packs/${encodeURIComponent(payload.id)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          packId = payload.id;
          console.log(`[${host}] pack ${payload.id} uploaded (${payload.files.length} file(s), ${payload.totalBytes} bytes)`);
        } else {
          console.log(`[${host}] pack upload refused with ${res.status} (the turn runs without it)`);
        }
      }
    }
  }
  const job = enqueueJob({ host, prompt, model, project, role, workspace, sessionId, envMode, canary, packId });
  console.log(`[${host}] handed ${job.id} to the connected worker${sessionId ? ` (session ${sessionId})` : ''}${canary ? ' (canary)' : ''}`);
  const deadline = Date.now() + timeoutMs;
  const budget = Math.max(1000, Math.ceil(timeoutMs / Math.max(1, attempts)));
  let lastError = `worker ${host} did not answer in time`;
  let lastFailed = 'timeout';
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const done = await awaitJob(job.id, { timeoutMs: Math.min(budget, remaining) });
    if (done?.result) {
      return { ...done.result, remote: true, jobId: job.id, ledger: done.result.ledger || null, attempts: attempt };
    }
    // No result by the deadline. Classify it: only a transient failure may be
    // retried, and only while the worker is still alive and its claim is not
    // somebody else's work in progress.
    const cls = classifyWorkerFailure(lastError);
    lastFailed = cls.code;
    const presence = workerStatus(host);
    const row = getJob(job.id);
    const claimedAt = row?.claimedAt ? Date.parse(row.claimedAt) : 0;
    const claimFresh = claimedAt > 0 && Date.now() - claimedAt < DEFAULT_LEASE_MS;
    const canRetry = cls.retryable && presence.reachable && !claimFresh && attempt < Math.max(1, attempts) && deadline - Date.now() > 1000;
    if (!canRetry) {
      const failed = !presence.reachable ? 'presence' : claimFresh ? 'timeout' : cls.code;
      const why = !presence.reachable
        ? `worker ${host} is gone (${presence.reason})`
        : claimFresh
          ? `worker ${host} is still working on ${job.id}`
          : cls.code === 'timeout'
            ? `worker ${host} did not answer in time`
            : cls.code;
      return { text: '', code: 1, model, error: why, remote: true, jobId: job.id, failed };
    }
    // Guard 8: same job id, bounded by the overall deadline, backoff between.
    requeueJob(job.id, { reason: cls.code });
    console.log(`[${host}] transient ${cls.code} on ${job.id}; requeued (attempt ${attempt + 1}/${attempts})`);
    await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
  }
  return { text: '', code: 1, model, error: lastError, remote: true, jobId: job.id, failed: lastFailed };
}

/** Where the "we already hit this" notes are kept, so a note is written once. */
function deadEndMarkerPath() {
  return path.join(os.homedir(), '.hermes', 'dead-end-notes.json');
}

function readDeadEndMarkers() {
  try {
    return JSON.parse(fs.readFileSync(deadEndMarkerPath(), 'utf8'));
  } catch {
    return {};
  }
}

/** A short, stable key for "this lane failed this way". */
export function failureSignature({ lane = '', errText = '' } = {}) {
  const err = String(errText || '').toLowerCase();
  const kind = isQuotaOrLimitError(err)
    ? 'quota'
    : isConnectionFailure(err)
      ? 'connection'
      : /not found|no such model|unknown model|unknown gemini model/.test(err)
        ? 'unknown-model'
        : 'other';
  const laneId = String(lane || '').trim().toLowerCase() || 'unknown';
  return `${kind}::${laneId}`;
}

/**
 * The second copy of a signature is worth one line. A note is written once per
 * signature, not once per failure, and the note is text a later turn can read.
 * The model never rewrites its own instructions; this only records what
 * happened.
 */
export function noteDeadEnd({ lane = '', errText = '', botId = '', home = os.homedir() } = {}) {
  try {
    const sig = failureSignature({ lane, errText });
    const markers = readDeadEndMarkers();
    if (markers[sig]) return { signature: sig, written: false, reason: 'already noted' };
    const rows = loadFailures().filter((r) => failureSignature({ lane: r.lane, errText: `${r.kind} ${r.hint}` }) === sig);
    if (rows.length < 2) return { signature: sig, written: false, reason: `only ${rows.length} sighting(s)` };
    const text = `${lane || 'unknown lane'}: ${String(errText || '').replace(/\s+/g, ' ').trim().slice(0, 200)}`;
    appendRow('dead-ends', { ticket: `r14-${botId || 'bot'}`, text }, { home });
    markers[sig] = new Date().toISOString();
    fs.mkdirSync(path.dirname(deadEndMarkerPath()), { recursive: true });
    fs.writeFileSync(deadEndMarkerPath(), `${JSON.stringify(markers, null, 2)}\n`, 'utf8');
    console.log(`[dead-ends] noted ${sig} after ${rows.length} sightings`);
    return { signature: sig, written: true, sightings: rows.length };
  } catch (err) {
    return { signature: '', written: false, reason: String(err?.message || err).slice(0, 120) };
  }
}

/**
 * Which turn this is, for the gated retrieval. Only build/investigate turns
 * read notes; anything else is gated to nothing, which is the safe default.
 */
export function turnKindFor(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(investigate|diagnos|debug|why did|root cause|trace|logs?)\b/.test(t)) return 'investigate';
  if (/\b(build|implement|fix|add|write|refactor|patch|ship|make)\b/.test(t)) return 'build';
  return '';
}

/** Notes for this request, or nothing. */
export function deadEndNotesFor(text, { home = os.homedir(), limit = 3 } = {}) {
  const turn = turnKindFor(text);
  if (!turn) return [];
  const { rows } = retrieve(text, { turn, stores: ['dead-ends'], limit, home });
  return rows;
}

export function trackRunQuota({ botId, modelRef, result }) {
  try {
    if (!result || result.aborted) return null;
    const text = String(result.finalText || '').trim();
    const filtered = extractLogError(result.stderr || '') || String(result.lastError || '');
    if (text || !filtered || !isQuotaOrLimitError(filtered)) return null;
    const { provider, model } = freemodelRefToRoute(modelRef || '');
    if (!provider || !model || provider === 'gemini') return null;
    const { dir } = ensureBotLedger(botId || 'default');
    // Carry the vendor's own retry countdown into the stamp: a Cline daily
    // cap ("try again in 22h") must not decay to the 6h default TTL, or the
    // lane shows available while it is still dead.
    const hint = parseRetryAfter(filtered);
    const until = parseRetryHintMs(hint);
    const stamped = stampDepleted({
      stateDir: dir,
      provider,
      model,
      errText: filtered,
      ...(until ? { depletedUntil: until, countdownHint: hint } : {}),
    });
    if (stamped.stamped) console.log(`[free-lanes] ${botId}: stamped ${stamped.keys.join(', ')} from quota error`);
    return stamped.stamped ? stamped : null;
  } catch {
    return null;
  }
}

/** Send raw HTML (router parity for the <code> grid) — NOT via the markdown converter. */
async function sendHtml(api, chatId, html) {
  const body = String(html || '');
  if (body.length <= 4000) {
    await api.sendMessage(chatId, body, { parse_mode: 'HTML' });
    return;
  }
  let i = 0;
  while (i < body.length) {
    await api.sendMessage(chatId, body.slice(i, i + 4000), { parse_mode: 'HTML' });
    i += 4000;
  }
}

/**
 * The /freemodel reply, in the router's shape.
 *
 * The router already solved this and its source says why: the per-model list is
 * the KEYBOARD, the message is a short header plus one total line, and anything
 * unavailable is "one short footer line — never a second per-model list". This
 * command was doing the opposite: 49 bullets in the body, the same 49 as
 * buttons, then a footer repeating the counts — a second list of the same models
 * in a different wording, with catalog labels on one side and the table's labels
 * on the other, so /freemodel and /allowance showed the same models as two
 * different lists.
 *
 * So the models are the buttons (one row each, labelled exactly as /allowance
 * labels them, ❌ when the row cannot be used, and still tappable so a tap can
 * answer "depleted, pick this instead" the way the router's do), and the body is
 * a header, a total, and at most one footer line for what has no credential.
 * `returns.buttons` is the keyboard, built from the same projection /allowance
 * renders, so the two commands cannot disagree about a row.
 */
function formatFreemodelWithDepletion(entries, annotated, { current, location, canonical = null, tableLanes = [] } = {}) {
  const byRef = new Map((annotated || []).map((a) => [a.ref, a]));
  const verdictOf = (e) => {
    const a = byRef.get(e?.ref);
    if (a) return a;
    return { ...e, selectable: e?.selectable !== false, depleted: false, ended: false, terminalOnly: false, inLedger: false, reason: 'not in this ledger' };
  };
  // The rows are canonicalAllowanceLanes() — the same list /allowance renders, with
  // the same Token Harbor collapse and the same no-credential exclusion. This
  // command used to run its own dedupe over the catalog, and two notions of "the
  // same model" drifted by one row for four rounds. One list, one count.
  const rows = canonical || [];
  // A catalogued model with no lane row AT ALL is still reported, never dropped.
  // The test is against the TABLE, not against the canonical list: a superseded
  // model (an older version whose family now has a newer one) is in the table and
  // deliberately absent from the list, and re-adding it from here put 13 models
  // back — /freemodel said 49 rows while /allowance said 30.
  const inTable = new Set((tableLanes || []).map((l) => String(l?.model || '').toLowerCase().split('/').filter(Boolean).pop()).filter(Boolean));
  for (const e of entries || []) {
    const v = verdictOf(e);
    // A real model always has a lane once the catalog is folded in, so the only
    // thing left without one is a provider placeholder ("pending:gemini") — not a
    // model, and the header already counts those. Anything else that shows up here
    // means the fold missed a model, and it is reported rather than dropped.
    if (String(v.ref || '').startsWith('pending:')) continue;
    const m = String(v.lane?.model || '').toLowerCase().split('/').filter(Boolean).pop();
    if (m && !inTable.has(m)) rows.push(v);
  }
  // A lane whose provider has no credential on this host leaves the count, the same
  // way /allowance drops it from its table and names the variable underneath. It was
  // six rows here, which is why the two commands disagreed about the total even with
  // one canonical list.
  const needsSetup = rows.filter((r) => r.needsSetup);
  const listed = rows.filter((r) => !r.needsSetup);
  const unusableOf = (r) => r.selectable === false || r.depleted || r.ended || r.terminalOnly;
  const usable = listed.filter((r) => !unusableOf(r));
  const unusable = listed.filter(unusableOf);
  const noCredential = listed.filter((r) => r.inLedger === false);
  const location0 = location ? ` at ${location}` : '';
  // The same compact reset /allowance prints ("reset in 12h 34"), not the long
  // label. The projection's resetLabel spells out the vendor countdown and an
  // absolute timestamp with a timezone, which is a paragraph inside a one-line
  // footer.
  const now = Date.now();
  const why = (r) => (r.ended
    ? 'promotion ended'
    : r.terminalOnly
      ? 'terminal only'
      : r.depleted
        ? `depleted${(() => {
            const compact = r.resetAt ? formatResetIn(r.resetAt, now) : '';
            const at = compact && compact !== '-' ? compact : (r.resetIn && r.resetIn !== '-' ? r.resetIn : '');
            return at ? ` (reset in ${at})` : '';
          })()}`
        : r.reason || 'not available');
  const lines = [
    `Free models${location0} — tap a button below (❌ = not usable right now; the first message auto-fails over to the next free lane).`,
    'Depleted lanes are marked ❌ and stay tappable, so a tap can tell you what to use instead.',
    'Token Harbor / Cloudflare / Gemini taps run through OpenCode. Freebuff is terminal-only — no chat turn.',
    '',
    listed.length
      ? `Total: ${listed.length} · ${usable.length} usable${unusable.length ? ` · ${unusable.length} not usable ❌` : ''}${noCredential.length ? ` · ${noCredential.length} with no ledger row` : ''}${needsSetup.length ? ` · ${needsSetup.length} need setup` : ''} · current: ${current || 'default'}`
      : 'No free models are installed and authenticated on this host.',
  ];
  // One short footer line — never a second per-model list.
  const footer = [];
  if (noCredential.length) {
    footer.push(`no ledger row: ${noCredential.slice(0, 4).map((r) => r.label).join(', ')}${noCredential.length > 4 ? `, +${noCredential.length - 4} more` : ''}`);
  }
  if (needsSetup.length) {
    footer.push(`needs setup: ${needsSetup.slice(0, 3).map((r) => `${r.label} (${r.setupReason || r.reason || 'provider not set up'})`).join('; ')}${needsSetup.length > 3 ? `; +${needsSetup.length - 3} more` : ''}`);
  }
  if (unusable.length) {
    footer.push(`not usable: ${unusable.slice(0, 4).map((r) => `${r.label} (${why(r)})`).join('; ')}${unusable.length > 4 ? `; +${unusable.length - 4} more` : ''}`);
  }
  if (footer.length) lines.push(footer.join(' — '));
  // One button per row, the way the router builds its /freemodel keyboard: a
  // provider tag, the model's own name, and ❌ when the row cannot be used. The tag
  // is the same plan code /allowance prints in its Plan column, which is what makes
  // the two read as one list rather than two vocabularies — a bare "big pickle"
  // button next to a "big pickle OC" table row is the mismatch.
  //
  // The router also collapses the two Token Harbor paths (the OpenCode tools lane
  // and the chat-only lane) onto one button, because they are the same shared
  // `tokenharbor-free` bar. Two buttons saying the same thing is the same
  // double-list problem one level down.
  const seen = new Set();
  const buttons = [];
  for (const r of rows) {
    const label = r.laneLabel || r.label;
    const tag = r.plan || (r.lane ? planCodeForLane(r.lane) : '');
    // The benchmark score rides on the button, so the choice is made with the number
    // in front of you rather than from memory. Unscored models get nothing — the
    // scorecard covers about half the reachable free models, and a missing number is
    // honest where a borrowed one would not be.
    const rated = `${tag ? tag + ': ' : ''}${label} · ${scoreLabelFor(r.lane?.model || r.model || r.ref || '')}`;
    const key = `${tag}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // text for the reader, data for the tap: the row's route, so a label that
    // grows (a bakeoff label, a plan tag) can never invalidate the keyboard.
    const route = r.ref || r.lane?.ref || r.model || '';
    buttons.push({ text: `${unusableOf(r) ? '❌ ' : ''}${rated}`, data: route, ref: route });
  }
  return { text: lines.join('\n'), buttons, rows, usable, unusable };
}

/** Usable rows the ledger has no record for: honest, not hidden. */
function missingCount(rows) {
  return rows.filter((r) => r.inLedger === false).length;
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

export async function handleTxCommand({ api, config, chatId, arg, lane: requestedLane, tmux = defaultTmuxRunner, ensureTui = ensureOpencodeTui }) {
  const location = workLocation();
  const id = sessionKey({ location, chat: String(chatId), workspace: config.agent.workspace, project: projectIdForWorkspace(config.agent.workspace) });
  const sub = String(arg || '').trim().toLowerCase();
  if (sub === 'on') {
    const lane = requestedLane || config.agent.kind || 'opencode';
    let session = resolveSession({ location, chat: String(chatId), workspace: config.agent.workspace, project: projectIdForWorkspace(config.agent.workspace), lane });
    if (session.lane !== lane) session = handoffSession(id, lane) || session;
    if (lane === 'opencode') {
      let tui;
      try {
        tui = await ensureTui({
          serverUrl: session.serverUrl,
          opencodeSessionId: session.opencodeSessionId,
          workspace: config.agent.workspace,
          title: `Health-tracker ${location} ${chatId}`,
          env: opencodeEnv(config),
          opencodeBin: config.agent.opencodeBin,
        });
      } catch (error) {
        await api.sendMessage(chatId, `Interactive OpenCode TUI unavailable: ${error.message}`);
        return;
      }
      session = setWorkView(id, {
        tx: true,
        viewMode: 'tui',
        viewCommand: tui.command,
        serverUrl: tui.serverUrl,
        serverPid: tui.serverPid ?? session.serverPid ?? null,
        opencodeSessionId: tui.opencodeSessionId,
      });
    } else {
      session = setWorkView(id, { tx: true, viewMode: 'observer', viewCommand: null });
    }
    const created = ensureTmuxWorkView(session, { tmux, solo: lane === 'opencode', sessionName: WORK_VIEW_SESSION });
    if (!created.ok) {
      await api.sendMessage(chatId, `Interactive work view unavailable: could not create \`${created.target}\` without replacing an existing tmux session.`);
      return;
    }
    if (lane !== 'opencode') setTx(id, true);
  } else if (sub === 'off') {
    const session = getSession(id);
    if (session) disableTmuxObserver(session, { tmux, sessionName: WORK_VIEW_SESSION });
    setTx(id, false);
  } else if (sub === 'help') {
    await api.sendMessage(chatId, 'Usage: /tx on|off|status|debug|help — shared work-view for this chat.');
    return;
  } else if (sub !== '' && sub !== 'status' && sub !== 'debug') {
    await api.sendMessage(chatId, 'Usage: /tx on|off|status|debug|help — shared work-view for this chat.');
    return;
  }
  const view = statusForTelegram(id, { tmux, sessionName: WORK_VIEW_SESSION });
  if (!view) {
    await api.sendMessage(chatId, 'No work session for this chat yet — use /tx on first.');
    return;
  }
  const observer = view.viewMode === 'tui'
    ? view.probe?.observerLive
      ? `Interactive TUI: live on \`${view.probe.target}\``
      : 'Interactive TUI: unavailable — use /tx on to create it'
    : view.probe?.observerLive
      ? `Observer: live on \`${view.probe.target}\``
      : view.probe?.surface === 'terminal'
        ? 'Observer: unavailable — use /tx on to create the live observer'
        : 'Live attach: unavailable for this execution surface';
  const lines = [
    `*Shared work view:* ${view.tx ? 'ON' : 'OFF'}`,
    `Session: \`${view.id}\``,
    `Lane: \`${view.lane}\` (${view.state})`,
    `View: ${view.viewMode === 'tui' ? 'interactive OpenCode TUI' : 'structured observer'}`,
    observer,
  ];
  if (sub === 'debug') {
    lines.push(`Events: ${view.probe?.events ? 'structured observer stream available' : 'unavailable'}`);
    lines.push(`Debug: ${view.probe?.observerLive ? 'live pane verified' : 'no verified observer pane'}`);
  } else if (view.probe?.attach) {
    lines.push(`Attach: \`tmux attach -t ${view.probe.target}\``);
  }
  await api.sendMessage(chatId, lines.join('\n'));
}

/**
 * Keep the `tx` view honest when the effective lane changes AFTER `/tx on`.
 * `/tx on` picks the view for the lane active at that moment, but a later
 * `/freemodel` switch leaves the old OpenCode TUI pane behind while Cline
 * runs outside it. Reconciling on every message means:
 * - opencode lane -> (re)ensure the interactive TUI attach view;
 * - any other lane -> drop a stale TUI pane and fall back to the structured
 *   observer tail, which is the only live view Cline/Gemini can feed.
 * Only touches tmux when the chat already has tx on; never throws — the run
 * must continue on the observer log even if the TUI cannot be built.
 */
export async function reconcileWorkViewForLane({ session, lane, workspace, tmux = defaultTmuxRunner, ensureTui = ensureOpencodeTui, env = {}, opencodeBin } = {}) {
  if (!session) return null;
  if (lane === 'opencode') {
    // A live TUI is not automatically the right one: a swap (or a resume onto
    // another thread) changes which conversation the pane should be showing.
    // Rebinding keeps the view, changes what it points at.
    if (session.viewMode === 'tui' && session.serverUrl && session.opencodeSessionId) {
      return rebindWorkView(session, { tmux, ensureTui, workspace, env, opencodeBin });
    }
    try {
      const tui = await ensureTui({
        serverUrl: session.serverUrl,
        opencodeSessionId: session.opencodeSessionId,
        workspace,
        title: `Health-tracker ${session.location} ${session.chat}`,
        env,
        opencodeBin,
      });
      const updated = setWorkView(session.id, {
        viewMode: 'tui',
        viewCommand: tui.command,
        serverUrl: tui.serverUrl,
        serverPid: tui.serverPid ?? session.serverPid ?? null,
        opencodeSessionId: tui.opencodeSessionId,
      });
      ensureTmuxWorkView(updated, { tmux, solo: true, sessionName: WORK_VIEW_SESSION });
      return updated;
    } catch {
      const updated = setWorkView(session.id, { viewMode: 'observer', viewCommand: null });
      ensureTmuxWorkView(updated, { tmux, sessionName: WORK_VIEW_SESSION });
      return updated;
    }
  }
  if (session.viewMode === 'tui') {
    try { disableTmuxObserver(session, { tmux, sessionName: WORK_VIEW_SESSION }); } catch {
      // stale pane cleanup is best-effort; the metadata downgrade below is the fix
    }
  }
  const updated = setWorkView(session.id, { viewMode: 'observer', viewCommand: null });
  ensureTmuxWorkView(updated, { tmux, sessionName: WORK_VIEW_SESSION });
  return updated;
}

/**
 * The turn path's canary verdict as one function: validate, then confirm the
 * route — or roll it back and say why. The conversation row is the caller's
 * to move, and only when this returns `ok`.
 *
 * Exported so the swap drill decides exactly the way the live turn decides,
 * instead of mirroring it: one implementation, one order, one reason string.
 */
export function settleCanary({ host, result = {}, sessionId = '', jobId = '', home } = {}) {
  const routeOpts = home ? { home } : {};
  const verdict = validateCanaryResult({ host, requestedSessionId: sessionId, result });
  if (!verdict.ok) {
    const route = rollbackRoute(host, { jobId: jobId || result?.jobId || '', reason: verdict.reasons.join('; '), ...routeOpts });
    return { ok: false, reason: verdict.reasons.join('; '), reasons: verdict.reasons, route };
  }
  const route = confirmRoute(host, { jobId: jobId || result?.jobId || '', ...routeOpts });
  return { ok: true, reason: '', reasons: [], route };
}

/**
 * The view follows the conversation. The record names the thread that ran;
 * when it names a different one than the pane was built for, the command is
 * rebuilt and the pane is re-pointed in place — same `work-view` session, same
 * pane, current tool. Nothing stale means nothing is touched.
 */
async function rebindWorkView(session, { tmux, ensureTui, workspace, env = {}, opencodeBin } = {}) {
  try {
    const tui = await ensureTui({
      serverUrl: session.serverUrl,
      opencodeSessionId: session.opencodeSessionId,
      workspace,
      title: `Health-tracker ${session.location} ${session.chat}`,
      env,
      opencodeBin,
    });
    if (!tui?.command || tui.command === session.viewCommand) return session;
    const updated = setWorkView(session.id, {
      viewCommand: tui.command,
      serverUrl: tui.serverUrl ?? session.serverUrl,
      serverPid: tui.serverPid ?? session.serverPid ?? null,
      opencodeSessionId: tui.opencodeSessionId ?? session.opencodeSessionId,
    });
    const outcome = repointWorkView({ target: workViewTarget(updated.id), command: updated.viewCommand, tmux });
    console.log(`[rebind] ${updated.id} -> ${outcome.method || 'no pane'} (${outcome.ok ? 'verified' : 'not verified'})`);
    return updated;
  } catch (err) {
    console.log(`[rebind] ${session.id} left as it was: ${err?.message || err}`);
    return session;
  }
}

// V-30.5 /resume — prints the current ticket packet straight from the bug
// store (bugctl queue → packet). Read-only: no second state store, no chat
// scrollback. `/resume n` = card #n; bare /resume = the queue's next open card.
const execFileP = promisify(execFile);
const BUGCTL_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bugctl.mjs');

async function runBugctl(args) {
  const { stdout } = await execFileP(process.execPath, [BUGCTL_BIN, ...args], {
    timeout: 8000,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  return String(stdout || '');
}

async function resumePacketText(rawArg) {
  const wanted = String(rawArg || '').replace(/^#/, '').trim();
  let id = wanted;
  if (!id) {
    let queue;
    try {
      queue = JSON.parse(await runBugctl(['queue', '--json']));
    } catch (e) {
      return 'Bug store unreachable (bug API down or not local to this host). /resume needs the store — retry later or use /resume <n> once it is back.';
    }
    const rows = Array.isArray(queue?.rows) ? queue.rows : [];
    if (!rows.length) return 'Bug queue is empty — no open ticket to resume. Use /resume <n> for a specific card.';
    id = String(rows[0].public_n ?? '').trim();
    if (!id) return 'Queue returned a card without a number — use /resume <n>.';
  }
  let packet;
  try {
    packet = (await runBugctl(['packet', `--id=#${id}`, '--format=text'])).trim();
  } catch (e) {
    return `Bug store unreachable for #${id} (bug API down or not local to this host). ${String(e?.message || '').slice(0, 120)}`;
  }
  if (!packet) return `No packet content for #${id}.`;
  return `Current ticket packet — #${id}\n\n${packet}\n\n/resume ${id} reprints this packet.`;
}

async function handleCommand({ api, config, sessions, prefs, caches, running, lastUsage, totals, health, bootedAt, chatId, cmd }) {
  const eff = effective(config, prefs, chatId);

  switch (cmd.name) {
    case 'start':
    case 'help':
      await api.sendMessage(chatId, helpText(config, eff));
      return;

    case 'status': {
      const location = workLocation();
      const workId = sessionKey({ location, chat: String(chatId), workspace: config.agent.workspace, project: projectIdForWorkspace(config.agent.workspace) });
      const work = statusForTelegram(workId, { sessionName: WORK_VIEW_SESSION });
      const effSurface = parseModelRef(eff.model).surface;
      const snap = buildStatusSnapshot({
        bot: { id: config.id, name: config.name },
        platform: effSurface || 'opencode',
        capabilities: { compact: true, costTracking: true, backends: false },
        effective: eff,
        session: sessions.get(chatId) ? { id: sessions.get(chatId) } : null,
        handoff: Boolean((prefFor(prefs, chatId)).handoff),
        usage: lastUsage?.get(chatId) || null,
        totals: totals?.get(chatId) || null,
        runtime: {
          bootedAt,
          taskState: running.get(chatId) ? 'running' : 'idle',
          lock: lockHolder(),
        },
        health,
        extras: work
          ? [
              `work session: ${work.id} (${work.state})`,
              `observer: ${work.probe?.observerLive ? 'live' : work.probe?.surface === 'terminal' ? 'offline' : 'unavailable'}`,
              `controller: ${effSurface || 'opencode'}`,
              `debug: ${work.probe?.events ? 'structured events' : 'unavailable'}`,
            ]
          : ['work session: none', 'observer: unavailable', `controller: ${effSurface || 'opencode'}`, 'debug: structured events'],
      });
      await api.sendMessage(chatId, formatStatusPlain(snap));
      return;
    }

    case 'build':
    case 'plan':
      setPref(prefs, chatId, { agent: cmd.name });
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
        // Compact the session the chat is actually on. On an external project
        // that is the external folder, with the same restricted child env as
        // a normal turn, not the website checkout.
        const compactProject = getChatProject(chatId);
        const compactExternal = compactProject.type === 'external';
        const result = await runOpencode({
          prompt: COMPACT_SUMMARY_PROMPT,
          model: eff.model,
          variant: eff.variant,
          workspace: compactExternal ? compactProject.workspace : config.agent.workspace,
          thinking: config.agent.thinking,
          timeoutMs: config.agent.timeoutMs,
          opencodeBin: config.agent.opencodeBin,
          onSpawn: (child) => running.set(chatId, { child, aborted: false }),
          extraArgs: ['--session', compactSessionId],
          env: { ...opencodeEnv(config), ...chatEnv(api, chatId) },
          envMode: compactExternal ? 'project' : 'inherit',
        });
        if (running.get(chatId)?.aborted) {
          await api.sendMessage(chatId, 'Aborted — session kept as-is.');
        } else if (result.code !== 0 || !result.finalText?.trim()) {
          await api.sendMessage(chatId, `Compact failed (${result.lastError || `exit ${result.code}`}) — session kept as-is.`);
        } else {
          const brief = result.finalText.trim().slice(0, 2000);
          setPref(prefs, chatId, { handoff: brief });
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
        await api.sendMessage(chatId, `Select a model (current: ${eff.model}):\nTip: /freemodel lists this host's locally available free models.`, {
          reply_markup: modelKeyboard(models),
        });
        return;
      }
      if (cmd.args === 'reset') {
        const current = prefFor(prefs, chatId);
        delete current.model;
        delete current.variant;
        setPref(prefs, chatId, current);
        if (Object.keys(prefFor(prefs, chatId)).length === 0) prefs.delete(chatId);
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
        setPref(prefs, chatId, { model: stored });
        savePrefs(config.id, prefs);
        await api.sendMessage(chatId, `Model set to ${formatFreeLabel(stored)} for this chat.`);
        return;
      }
      if (ref.surface === 'gemini') {
        const migrated = GEMINI_TO_OPENCODE[ref.id];
        if (!GEMINI_MODELS.includes(ref.id) || !migrated) {
          await api.sendMessage(chatId, `Unknown gemini model: ${ref.id}\nUse /freemodel to pick a locally available model.`);
          return;
        }
        setPref(prefs, chatId, { model: migrated });
        savePrefs(config.id, prefs);
        await api.sendMessage(chatId, `Model set to ${formatFreeLabel(migrated)} for this chat.`);
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
      setPref(prefs, chatId, { model: target });
      savePrefs(config.id, prefs);
      await api.sendMessage(chatId, `Model set to ${target} for this chat.`);
      return;
    }

    case 'free': {
      const entries = await getFreeModels(caches, config);
      if (!entries.length) {
        await api.sendMessage(chatId, 'No locally available free models found on this host.');
        return;
      }
      await sendChunked(api, chatId, formatFreeModelText(entries, { current: eff.model, location: workLocation() }));
      return;
    }

    case 'models': {
      const models = await getModels(config, caches);
      await sendChunked(api, chatId, formatModelList(models));
      return;
    }

    case 'freemodel': {
      // The union, not the raw catalog: getAnnotatedFreeModels folds the ledger's
      // own rows in, and those are the Token Harbor / Cloudflare / Freebuff models.
      // Rendering the catalog alone listed 42 models and none of them were the ones
      // /allowance was showing for those providers.
      const { entries, annotated, table: fmTable, session: fmSession } = getAnnotatedFreeModels(caches, config.id);
      if (!entries.length) {
        await api.sendMessage(chatId, 'No free models found (opencode cache unreadable).');
        return;
      }
      // Every row is a button, including the ones that cannot be used right now:
      // the router keeps a depleted lane tappable so the tap can answer with what
      // to use instead. Filtering them out of the keyboard is what made /freemodel
      // and /allowance list different things.
      // The table getAnnotatedFreeModels already folded the catalog into — the same
      // one the annotation was computed against and the same one /allowance renders.
      // Folding the union again here produced a different table (46 lanes against
      // 48) and six models came back that the real list has dropped.
      const body = formatFreemodelWithDepletion(entries, annotated, {
        current: eff.model,
        location: workLocation(),
        canonical: canonicalAllowanceLanes({ table: fmTable, session: fmSession, readiness: hostReadiness(caches), location: workLocation() }),
        tableLanes: (fmTable && fmTable.lanes) || [],
      });
      // One keyboard with every model, no paging, and the router's cancel row.
      await api.sendMessage(chatId, body.text, {
        reply_markup: modelKeyboard(body.buttons, {
          kind: 'fm',
          all: true,
          footer: { text: 'Cancel — keep current model', callback_data: 'noop' },
        }),
      });
      return;
    }

    case 'allowance': {
      const arg = String(cmd.args || '').trim().toLowerCase();
      const route = freemodelRefToRoute(eff.model || '');
      if (arg === 'table' || arg === 'html' || arg === 'grid') {
        try {
          const { tablePath, sessionPath, table, dir } = getLedger(config.id);
          if (!table) {
            await api.sendMessage(chatId, 'Allowance: no free-lane ledger found. Use /freemodel to list free models.');
            return;
          }
          const outDir = path.join(os.tmpdir(), `bot-host-allowance-${config.id}`);
          const render = renderFreeLaneTableHtml({ tablePath, sessionPath, outDir });
          await api.sendMessage(chatId, `Free-lane allowance table — ${render.lanes} lanes, ${render.buckets} buckets (per-bot ledger). Sending HTML grid…`);
          await api.sendMediaFile(chatId, render.htmlPath);
          return;
        } catch (e) {
          const route2 = freemodelRefToRoute(eff.model || '');
          await sendHtml(api, chatId, buildAllowanceTextForBots({ stateDir: getLedger(config.id).dir, provider: route2.provider, model: route2.model, location: workLocation(), readiness: hostReadiness(caches), catalogEntries: await getFreeModels(caches, config) }));
          return;
        }
      }
      // Router parity: raw HTML grid text (screenshot), NOT the markdown converter.
      // The sortable grid the router sends as its primary allowance view is one
      // argument away (`/allowance table`) and is now named here, so the text table
      // and the grid are discoverable as the same list rather than two features.
      const text = buildAllowanceTextForBots({
        stateDir: getLedger(config.id).dir, provider: route.provider, model: route.model, location: workLocation(),
        readiness: hostReadiness(caches), catalogEntries: await getFreeModels(caches, config),
      });
      await sendHtml(api, chatId, `${text}\n\nSortable grid: /allowance table`);
      return;
    }

    case 'setup': {
      // The allowance surfaces now say a lane "needs TOKEN_HARBOR_API_KEY".
      // This is where that turns into the command that fixes it.
      caches.readiness = null;
      const readiness = hostReadiness(caches, config.id);
      const gaps = setupGaps(readiness);
      const host = workLocation();
      if (!gaps.length) {
        const lines = [`✅ Every provider this bot uses is ready on ${host}. Nothing to set up.`];
        // "Ready" is not the same as "a turn will run". Token Harbor's balance is
        // not API-visible and a $0 account 402s every completion, so the all-clear
        // must not be the last thing the user hears about it.
        if (readiness.tokenharbor && readiness.tokenharbor.ready && readiness.tokenharbor.note) {
          lines.push(`⚠️ ${readiness.tokenharbor.note}`);
        }
        await api.sendMessage(chatId, lines.join("\n"));
        return;
      }
      const lines = [`*Setup gaps on ${host}* — ${gaps.length} provider(s) cannot run here:`, ''];
      for (const g of gaps) {
        lines.push(`• *${g.provider}* — needs ${g.needs}`);
        if (g.fix) lines.push(`  fix: ${g.fix}`);
        if (g.command) lines.push(`  or ask me: ${g.command}`);
        if (g.note) lines.push(`  (${g.note})`);
        lines.push('');
      }
      lines.push('Lanes for these providers are shown as ⏸ in /allowance and are not offered in /freemodel until the credential is present.');
      await api.sendMessage(chatId, lines.join('\n'));
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
      setPref(prefs, chatId, { agent: target });
      savePrefs(config.id, prefs);
      await api.sendMessage(chatId, `Agent set to ${target} for this chat.`);
      return;
    }

    case 'thinking': {
      const ref = parseModelRef(eff.model);
      // Gemini is single-shot: no variants, no opencode verbose lookup.
      const variants =
        ref.surface === 'cline' ? CLINE_THINKING_LEVELS : ref.surface === 'gemini' ? [] : await getVariants(config, caches, eff.model);
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
      setPref(prefs, chatId, { variant: target });
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
      await abortOpencodeSession({ serverUrl: active.serverUrl, sessionId: active.opencodeSessionId }).catch(() => false);
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
      const workId = sessionKey({ location: workLocation(), chat: String(chatId), workspace: config.agent.workspace, project: projectIdForWorkspace(config.agent.workspace) });
      abortSession(workId, { transcriptRef: sessions.get(chatId) || null });
      return;
    }

    case 'debug': {
      const location = workLocation();
      const workId = sessionKey({ location, chat: String(chatId), workspace: config.agent.workspace, project: projectIdForWorkspace(config.agent.workspace) });
      const view = statusForTelegram(workId, { sessionName: WORK_VIEW_SESSION });
      if (!view) {
        await api.sendMessage(chatId, 'No work session for this chat yet — use /tx on first.');
        return;
      }
      await api.sendMessage(chatId, [
        `Work session: \`${view.id}\``,
        `Lane: \`${view.lane}\` (${view.state})`,
        `Observer: ${view.probe?.observerLive ? `live on \`${view.probe.target}\`` : view.probe?.surface === 'terminal' ? 'not running' : 'unavailable'}`,
        'Events: structured observer stream',
        'Controller: existing agent child',
      ].join('\n'));
      return;
    }

    case 'handoff': {
      if (running.get(chatId)) {
        await api.sendMessage(chatId, 'A request is running. Finish or /abort it before checkpointing the work session.');
        return;
      }
      const location = workLocation();
      const workId = sessionKey({ location, chat: String(chatId), workspace: config.agent.workspace, project: projectIdForWorkspace(config.agent.workspace) });
      const session = resolveSession({ location, chat: String(chatId), workspace: config.agent.workspace, project: projectIdForWorkspace(config.agent.workspace), lane: config.agent.kind || 'opencode' });
      const checkpoint = checkpointSession(workId, { handoffRef: 'manual' });
      if (!checkpoint) {
        await api.sendMessage(chatId, 'Could not checkpoint the work session.');
        return;
      }
      await api.sendMessage(chatId, `Handoff checkpoint saved for \`${session.id}\`. The workspace and session were preserved.`);
      return;
    }

    case 'tx': {
      await handleTxCommand({ api, config, chatId, arg: cmd.args, lane: parseModelRef(eff.model).surface });
      return;
    }

    case 'resume': {
      if (running.get(chatId)) {
        await api.sendMessage(chatId, 'A request is running. Finish or /abort it before resuming a ticket.');
        return;
      }
      await api.sendMessage(chatId, await resumePacketText(cmd.args));
      return;
    }

    case 'project': {
      if (!cmd.args) {
        await api.sendMessage(chatId, formatProjectsSummary(chatId), { parse_mode: 'Markdown' });
        return;
      }
      try {
        const proj = switchChatProject(chatId, cmd.args);
        sessions.delete(chatId);
        saveSessions(config.id, sessions);
        const roleInfo =
          proj.type === 'external'
            ? '\n• *Council:* Use `/role <name>` (e.g. `/role legal`) or `/council run` for full council review.'
            : '';
        await api.sendMessage(
          chatId,
          `✅ *Switched to Project:* \`${proj.name}\`\n• *Type:* ${proj.type === 'external' ? '🌐 External Workspace' : '💻 Health-Tracker'}\n• *Workspace:* \`${proj.workspace}\`${proj.gdriveFolder ? `\n• *Google Drive:* \`${proj.gdriveFolder}\`` : ''}${roleInfo}`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        await api.sendMessage(chatId, `❌ Project error: ${err.message}`);
      }
      return;
    }

    case 'council': {
      const activeProj = getChatProject(chatId);
      if (activeProj.type !== 'external') {
        await api.sendMessage(chatId, 'The Multi-Agent Council is designed for external projects. First switch via `/project external 1`.');
        return;
      }
      const sub = (cmd.args || '').trim().toLowerCase();
      if (sub === 'audit' || sub === 'defense' || sub === 'finalize') {
        if (running.get(chatId)) {
          await api.sendMessage(chatId, 'A task is already running. Please /abort it first.');
          return;
        }
        await api.sendMessage(
          chatId,
          `⚖️ *Running Council Stage: ${sub.toUpperCase()}...*`,
          { parse_mode: 'Markdown' }
        );
        try {
          const res = await runCouncilStage(sub, activeProj.id);
          await api.sendMessage(chatId, res.nextStepMsg || 'Stage completed.', { parse_mode: 'Markdown' });
        } catch (err) {
          await api.sendMessage(chatId, `❌ Council stage failed: ${err.message}`);
        }
        return;
      }
      if (sub === 'run') {
        if (running.get(chatId)) {
          await api.sendMessage(chatId, 'A task is already running. Please /abort it first.');
          return;
        }
        await api.sendMessage(
          chatId,
          `⚖️ *Initiating Multi-Agent Council for "${activeProj.name}"...*\nRunning 6-phase review: Accuracy ➔ Defense ➔ Red-Team ➔ Legal ➔ Arbitrator ➔ Final Dossier.`,
          { parse_mode: 'Markdown' }
        );
        try {
          const res = await runFullCouncil(activeProj.id);
          const reply = `✅ *Council Review Completed!*\n• *Workspace:* \`${res.workspace}\`\n• *Artifacts Generated:* 6 phases\n• *Executive Deliverables:* Ready in Google Drive mirror.\n\nType \`/role builder\` to inspect the final talking points or \`/status\` to review.`;
          await api.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
        } catch (err) {
          await api.sendMessage(chatId, `❌ Council run failed: ${err.message}`);
        }
        return;
      }

      const status = getCouncilStatus(activeProj.id);
      const phasesText = (status.phases || []).map((p) => `• ${p.title}: ${p.completed ? '✅ Done' : '⏳ Pending'}`).join('\n');
      const reply = `🏛️ *[Council Status — ${status.name}]*\n• *Workspace:* \`${status.workspace}\`\n• *Google Drive:* \`${status.gdriveFolder}\`\n• *Evidence Ledger:* ${status.hasEvidenceLedger ? '✅ Attached' : '⚠️ Missing'}\n\n*Review Phases:*\n${phasesText}\n\n*Staged Checkpoints (Human-in-the-Loop):*\n• \`/council audit\` — Phase 1: Audit facts & flag missing receipts\n• \`/council defense\` — Phases 2 & 3: Defense arguments & Manager simulation\n• \`/council finalize\` — Phases 4-6: Legal review, arbitrator ruling & final dossier\n• \`/council run\` — Unattended full pipeline`;
      await api.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
      return;
    }

    case 'role': {
      const activeProj = getChatProject(chatId);
      const currentRoles = getProjectRoles(activeProj.id);
      if (!cmd.args) {
        const rolesList = (currentRoles || []).map((r) => `• \`/role ${r.id.split('_')[0]}\` — *${r.name}*`).join('\n');
        await api.sendMessage(
          chatId,
          `👥 *[Active Project Roles — ${activeProj.name}]*\n\n${rolesList || '• None declared.'}\n\n• \`/role check <name>\` — Inspect role mandate & instructions\n• \`/role add <id> <name> : <instructions>\` — Add a new dynamic role\n• \`/role remove <id>\` — Delete a role\n• \`/role reset\` — Return to general collaborative mode`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      if (cmd.args === 'reset') {
        resetChatRole(chatId);
        await api.sendMessage(chatId, `Role reset. Operating in general collaborative mode for \`${activeProj.name}\`.`);
        return;
      }
      if (cmd.args.startsWith('add ')) {
        const payload = cmd.args.replace(/^add\s+/, '').trim();
        const parts = payload.split(':');
        const header = parts[0].trim().split(/\s+/);
        const roleId = header[0];
        const roleName = header.slice(1).join(' ') || roleId;
        const instructions = parts[1] ? parts.slice(1).join(':').trim() : `You are the ${roleName}. Follow project guidelines.`;
        try {
          const added = addProjectRole(activeProj.id, { id: roleId, name: roleName, instructions });
          await api.sendMessage(
            chatId,
            `✅ *Role Added to ${activeProj.name}:* \`${added.name}\` (\`${added.id}\`)\nInstructions saved to \`roles/${added.id}.md\`. Type \`/role ${added.id}\` to activate it.`,
            { parse_mode: 'Markdown' }
          );
        } catch (err) {
          await api.sendMessage(chatId, `❌ Failed to add role: ${err.message}`);
        }
        return;
      }
      if (cmd.args.startsWith('remove ') || cmd.args.startsWith('delete ')) {
        const targetRole = cmd.args.replace(/^(remove|delete)\s+/, '').trim();
        try {
          const ok = removeProjectRole(activeProj.id, targetRole);
          if (ok) {
            await api.sendMessage(chatId, `🗑️ *Role Removed:* \`${targetRole}\` has been removed from ${activeProj.name}.`);
          } else {
            await api.sendMessage(chatId, `⚠️ Role "${targetRole}" was not found or could not be removed.`);
          }
        } catch (err) {
          await api.sendMessage(chatId, `❌ Failed to remove role: ${err.message}`);
        }
        return;
      }
      if (cmd.args.startsWith('check ') || cmd.args.startsWith('inspect ')) {
        const targetRole = cmd.args.replace(/^(check|inspect)\s+/, '').trim();
        const details = checkRoleDetails(activeProj.id, targetRole);
        if (!details) {
          await api.sendMessage(chatId, `❌ Role "${targetRole}" not found in ${activeProj.name}.`);
          return;
        }
        const checkMsg = [
          `🔍 *[Role Inspection: ${details.name}]*`,
          `• *Project:* \`${details.projectName}\``,
          `• *Role ID:* \`${details.roleId}\``,
          `• *Description:* ${details.description}`,
          `\n📜 *Assigned Instructions:*`,
          `\`\`\`\n${(details.instructions || 'Standard operating instructions.').trim()}\n\`\`\``,
          `\nType \`/role ${details.roleId.split('_')[0]}\` to assign this role to the active agent.`,
        ].join('\n');
        await api.sendMessage(chatId, checkMsg, { parse_mode: 'Markdown' });
        return;
      }
      try {
        const role = switchChatRole(chatId, cmd.args);
        await api.sendMessage(
          chatId,
          `🎭 *Assumed Role:* \`${role.name}\`\nRelevant instructions for this role have been loaded and assigned. Future requests in this chat will execute under this persona.\nType \`/role reset\` to return to general mode.`
        );
      } catch (err) {
        await api.sendMessage(chatId, `❌ Role error: ${err.message}`);
      }
      return;
    }

    case 'location': {
      const loc = workLocation();
      if (!cmd.args) {
        const poolMsg = [
          '🌐 *[Compute Location & Quota Pool]*',
          `• *Host Location:* \`${loc}\` (${loc === 'mobile' ? '📱 Mobile Termux' : '🖥️ Cloud VPS'})`,
          `• *Active Model Lane:* \`${eff.model}\``,
          `• *Provider:* \`${parseModelRef(eff.model).surface}\``,
          '\n*Available Compute & Allowance Pools:*',
          '• `vps` / `mobile` — switch execution host profile',
          '• `zen` — OpenCode Zen Free tier (Nemotron, Muse, Ling)',
          '• `tokenharbor` — Token Harbor rolling free allowance',
          '• `cloudflare` — Cloudflare Workers AI free neurons',
          '• `gemini` — Google Gemini 2.0 Flash API',
          '• `colab` — Google Colab GPU tunnel',
          '\n*Commands:*',
          '• `/location mobile` or `/location vps`',
          '• `/allowance` — inspect live free lane table',
        ].join('\n');
        await api.sendMessage(chatId, poolMsg, { parse_mode: 'Markdown' });
        return;
      }
      const target = cmd.args.trim().toLowerCase();
      if (KNOWN_HOSTS.includes(target)) {
        // A location is a host with a connected worker, not a variable. Setting
        // BOT_LOCATION is not a connection: the turn would still run here.
        const status = workerStatus(target);
        if (status.reachable) {
          process.env.BOT_LOCATION = target;
          clearBlockedLocation(chatId);
          // Arm the route: the first turn on a host is a canary (guard 6) and
          // gets the full preflight, so a swap onto a machine that cannot hold
          // this conversation fails before the job exists. Re-arming on every
          // request keeps that true for repeat switches back to a host.
          if (!isLocalHost(target)) {
            const route = armRoute(target, { previous: loc });
            console.log(`[${config.id}] route to ${target} armed (${route.state})`);
          }
          // The lease follows the location it is held for, so the next
          // starter sees which host the poller is currently on.
          renewPollerLease({ key: config.id, host: target, pid: process.pid });
          await api.sendMessage(
            chatId,
            `✅ *Compute location set to:* \`${target}\`\n${status.reason}. The next turn runs on ${target}${isLocalHost(target) ? '' : ' — its first turn is a canary (checked, then confirmed as active)'}.`
          );
          return;
        }
        setBlockedLocation(chatId, target, status.reason);
        await api.sendMessage(
          chatId,
          `⚠️ *Host \`${target}\` is unreachable:* ${status.reason}.\nThe location was **not** changed and the turn was **not** run. The next message will not start work on this machine either — send \`/location vps\` to run here, or retry once the ${target} worker connects.`
        );
        return;
      }
      await api.sendMessage(chatId, `ℹ️ Known hosts: ${KNOWN_HOSTS.map((h) => `\`${h}\``).join(', ')}. Use \`/location <host>\` or \`/switch <backend>\`.`);
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
      setPref(prefs, chatId, { model });
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
      const entries = await getFreeModels(caches, config);
      const eff = effective(config, prefs, chatId);
      const { annotated } = getAnnotatedFreeModels(caches, config.id);
      const selectable = annotated.filter((a) => a.selectable !== false);
      const available = selectable.filter((a) => !a.depleted);
      await api.editMessageText(chatId, messageId, formatFreemodelWithDepletion(entries, annotated, { current: eff.model, location: workLocation() }), {
        reply_markup: modelKeyboard(
          (available.length ? available : selectable).map((entry) => ({ text: entry.label, data: entry.ref })),
          { page: Number(value) || 0, kind: 'fm' },
        ),
      });
      await api.answerCallbackQuery(query.id);
      return;
    }
    if (kind === 'fm') {
      // The button text is the label /allowance gives the row, which for a folded or
      // ledger-only model is NOT the catalog's label ("big pickle", not
      // "opencode:big-pickle (free)"). So the tap is resolved against the annotated
      // rows, which carry that label, and then back to the entry by ref.
      const wanted = String(value || '').replace(/^❌\s*/, '').trim();
      const bundle = getAnnotatedFreeModels(caches, config.id);
      // `#<n>` is the position in the keyboard this handler just rendered, for a
      // route too long for Telegram's 64-byte callback_data. Everything else is a
      // route identity or a label; a route is what a tap should resolve.
      const byPosition = String(value || '').startsWith('#')
        ? (() => {
            const rows = bundle.annotated || [];
            const selectable = rows.filter((a) => a.selectable !== false);
            const available = selectable.filter((a) => !a.depleted);
            return (available.length ? available : selectable)[Number(wanted.slice(1))] || null;
          })()
        : null;
      const hit = byPosition || (bundle.annotated || []).find(
        (a) => a.ref === value || a.laneLabel === wanted || a.label === wanted || a.ref === wanted,
      );
      const entries = bundle.entries?.length ? bundle.entries : await getFreeModels(caches, config);
      const entry = hit
        ? entries.find((e) => e.ref === hit.ref) || hit
        : entries.find((e) => e.label === wanted || e.ref === value) || entries[Number(value)];
      if (!entry) {
        await api.answerCallbackQuery(query.id, { text: 'Expired, run /freemodel again' });
        return;
      }
      const { table, session, dir } = getLedger(config.id);
      if (table && isFreemodelEntryDepleted(entry, table, session)) {
        const { annotated } = getAnnotatedFreeModels(caches, config.id);
        const hit = annotated.find((a) => a.ref === entry.ref);
        const next = annotated.find((a) => a.selectable !== false && !a.depleted);
        await api.answerCallbackQuery(query.id, { text: `Depleted (reset in ${hit?.resetIn || 'unknown'}) — pick ${next?.label || 'another lane'}` });
        const route = freemodelRefToRoute(entry.ref);
        await sendHtml(api, chatId, `That lane is depleted (reset in ${hit?.resetIn || 'unknown'}).\nNext up: ${next ? `${next.label} (${next.ref})` : 'none — wait for reset'}\n\n${buildAllowanceTextForBots({ stateDir: dir, provider: route.provider, model: route.model, location: workLocation(), readiness: hostReadiness(caches) })}`);
        return;
      }
      setPref(prefs, chatId, { model: entry.ref });
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
      setPref(prefs, chatId, { agent: agent.name });
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
        ref.surface === 'cline' ? CLINE_THINKING_LEVELS : ref.surface === 'gemini' ? [] : await getVariants(config, caches, eff.model);
      // New buttons carry the name (`v:high`); old keyboards carry an index
      // (`v:0`). Support both so already-shown keyboards keep working.
      let variant = variants.includes(value) ? value : variants[Number(value)];
      if (!variant && ref.surface !== 'cline' && ref.surface !== 'gemini') {
        caches.verbose = null;
        variants = await getVariants(config, caches, eff.model);
        variant = variants.includes(value) ? value : variants[Number(value)];
      }
      if (!variant) {
        await api.answerCallbackQuery(query.id, { text: 'Expired, run /thinking again' });
        return;
      }
      setPref(prefs, chatId, { variant });
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
 * The lanes this turn may use, in order, from this host's own ledger.
 *
 * The old chain was [chat model, bot default]: two fixed entries, so a lane the
 * ledger already knew was spent got retried, and a lane that had ended could
 * still be offered. Now the ledger decides. The chat's model still goes first
 * when it is usable; otherwise the caller is told which lane it moved to and why
 * the old one was skipped. A host with no ledger yet keeps the old two-entry
 * chain, so a fresh install behaves exactly as before.
 */
export function selectTurnLanes({ botId, model, fallback, now = Date.now(), readiness = null } = {}) {
  const legacy = failoverModels(model, fallback);
  let ledger;
  try {
    ledger = loadFreeLaneLedger({ stateDir: ensureBotLedger(botId || 'default').dir });
  } catch {
    return { models: legacy, skipped: [], fromLedger: false };
  }
  const table = ledger?.table;
  if (!table || !Array.isArray(table.lanes) || !table.lanes.length) {
    return { models: legacy, skipped: [], fromLedger: false };
  }
  // The same projection /allowance and /freemodel read, so the walk can only
  // offer what those two surfaces call selectable.
  const projection = projectLanes(table, ledger.session || {}, { now, location: botId, readiness });
  const lanes = projection.filter((r) => r.selectable).map((r) => ({ provider: r.provider, model: r.model, pref: r.pref, family: r.family, label: r.label }));
  const skipped = projection.filter((r) => !r.selectable).map((r) => ({
    provider: r.provider,
    model: r.model,
    label: r.label,
    why: r.reason,
    until: r.resetAt,
    resetLabel: r.resetLabel,
  }));

  // The registry owns what to run; the ledger owns what may be tried next. A
  // configured model the ledger has never heard of is still the first choice —
  // an earlier version dropped it and silently ran the ledger's top lane
  // instead, which broke a live turn on 2026-09-25. The ledger only removes the
  // current lane when it says that lane is depleted or ended.
  const current = freemodelRefToRoute(model || '');
  const sameRoute = (row) => {
    if (!current.provider || !current.model) return false;
    const tail = (v) => String(v || '').replace(/^[^/]+\//, '').replace(/:free$/i, '');
    return row.model === current.model || (row.provider === current.provider && tail(row.model) === tail(current.model));
  };
  const currentSkipped = skipped.find(sameRoute);
  const fallbackLanes = lanes.filter((l) => !sameRoute(l));

  // Coding lanes first, light ones last. The bot exists to write code, so a turn
  // that fails over from a coding model must not land on a light one while a coding
  // lane is still free — the list was ordered by pref alone, and a light model with
  // a low pref number would take over the turn. Light lanes stay reachable as a last
  // resort, because failing a turn outright is worse than a weaker answer, and
  // `degradedToLight` says when that is what happened.
  // Tier order comes from the catalog (QS-6): high first, then models the
  // catalog does not rank, then light. Light lanes stay reachable as a last
  // resort, and the reply says so when a coding turn ends up on one.
  const rank = (l) => walkTierRank(l.model);
  const orderedLanes = [...fallbackLanes].sort((a, b) => rank(a) - rank(b) || (Number(a.pref) || 0) - (Number(b.pref) || 0));
  const currentGroup = (tierForModel(freemodelRefToRoute(model).model || model).tier) || 'unlisted';
  const codingLeft = orderedLanes.filter((l) => rank(l) === 0).length;
  const lightLeft = orderedLanes.filter((l) => rank(l) === 2).length;

  if (!model && !orderedLanes.length) {
    const soonest = soonestResetAmongDepleted(table, ledger.session || {}, { now });
    return { models: [], skipped, fromLedger: true, exhausted: true, displaced: null, chose: null, soonest };
  }
  if (model && currentSkipped && !orderedLanes.length) {
    const soonest = soonestResetAmongDepleted(table, ledger.session || {}, { now });
    return {
      models: [],
      skipped,
      fromLedger: true,
      exhausted: true,
      displaced: currentSkipped,
      chose: null,
      soonest,
    };
  }

  const models = [];
  if (model && !currentSkipped) models.push(model);
  for (const lane of orderedLanes) models.push(toModelRef(lane.provider, lane.model));
  if (!models.length) models.push(fallback);
  const unique = [...new Set(models.filter(Boolean))];
  return {
    models: unique,
    skipped,
    fromLedger: true,
    exhausted: false,
    displaced: currentSkipped || null,
    chose: models[0] || null,
    // A coding turn that can only be served by a light lane, and the chat's own
    // group, so the failover notice can say what happened instead of the reader
    // wondering why the answer got worse.
    currentGroup,
    degradedToLight: currentGroup === 'high' && codingLeft === 0 && unique.length > 1,
    codingAvailable: codingLeft,
    lightAvailable: lightLeft,
  };
}

/**
 * BOT-9 live failover wiring for the main message path: run the prompt on
 * the chat's effective model, falling back to the bot default on retryable
 * failures (quota/unfunded/5xx — never timeout/abort, per defaultIsRetryable).
 * The switch posts a user-visible line. A single-model chain behaves exactly
 * like a direct runOpencode call. Exported for unit tests.
 */
export function fanoutProgressEvent({ renderer, observer, event, context = {} }) {
  try { renderer?.onEvent(event); } catch {}
  try { observer?.onEvent(event, context); } catch {}
}

export async function runOpencodeWithFailover({ api, config, chatId, prompt, models, runModel = null, onSwitchNotify, onAttemptStart, onAttemptComplete, isAborted = () => false, onCooldown = null, ...runArgs }) {
  let attempt = 0;
  const { result } = await runWithModelFailover({
    models,
    makeRun: async (model) => {
      attempt += 1;
      if (typeof onAttemptStart === 'function') {
        try { onAttemptStart({ model, attempt }); } catch {}
      }
      const runOnce = async () => (runModel
        ? await runModel(model)
        : await runOpencode({ prompt, model, ...runArgs }));
      // runModel lets one failover chain span surfaces (cline quota-hit ->
      // opencode fallback and back). Without it every candidate runs through
      // the OpenCode CLI, exactly as before.
      let attemptResult = await runOnce();
      // One retry, and only for a transport failure. A quota answer is final
      // for that lane and the ledger stamp already says so. Two ECONNREFUSEDs
      // in a row is not a blip, so the lane gets a short cooldown and the walk
      // moves on; without this the next message tried the same dead lane again.
      let connectionRetries = 0;
      while (
        connectionRetries < 1 &&
        !String(attemptResult?.finalText || '').trim() &&
        isConnectionFailure(attemptFailureText(attemptResult)) &&
        !isAborted()
      ) {
        connectionRetries += 1;
        attempt += 1;
        attemptResult = await runOnce();
        if (typeof onAttemptStart === 'function') {
          try { onAttemptStart({ model, attempt, retry: connectionRetries }); } catch {}
        }
      }
      if (
        !String(attemptResult?.finalText || '').trim() &&
        isConnectionFailure(attemptFailureText(attemptResult)) &&
        !isAborted()
      ) {
        const errText = attemptFailureText(attemptResult);
        const stamp = stampLaneCooldown({ botId: config?.id, model, errText });
        if (typeof onCooldown === 'function') {
          try { onCooldown({ model, errText, stamp }); } catch {}
        }
      }
      if (typeof onAttemptComplete === 'function') {
        try { onAttemptComplete({ model, attempt, result: attemptResult, aborted: Boolean(isAborted()) }); } catch {}
      }
      if (!String(attemptResult?.finalText || '').trim() && attemptFailureText(attemptResult)) {
        noteDeadEnd({ lane: model, errText: attemptFailureText(attemptResult), botId: config?.id });
      }
      return attemptResult;
    },
    onSwitch: ({ from, to, reason }) => {
      const raw = String(reason || 'error');
      // Quota envelopes (Cline's INFERENCE_CAP_ERROR JSON) stay in the
      // ledger/observer log; the chat line carries the short verdict only.
      const short = isQuotaOrLimitError(raw)
        ? `free limit hit${parseRetryAfter(raw) ? ` (${parseRetryAfter(raw)})` : ''}`
        : raw.slice(0, 200);
      const line = `🔀 *${from}* failed (${short.slice(0, 200)}) — switching to *${to}*…`;
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

  // A location request that no worker answered holds the turn instead of
  // quietly running it here. No lane is chosen, so no ledger is touched.
  const heldLocation = getBlockedLocation(chatId);
  if (heldLocation) {
    const status = workerStatus(heldLocation.requested);
    if (status.reachable) {
      process.env.BOT_LOCATION = status.host;
      clearBlockedLocation(chatId);
    } else {
      await api.sendMessage(
        chatId,
        `⏸ Held: you asked for \`${heldLocation.requested}\` and it is still unreachable (${status.reason}). Nothing was run and no allowance was spent. Send \`/location vps\` to run here, or retry when the worker connects.`
      );
      return;
    }
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
  let observer = null;
  let observerContext = null;
  let observerTerminalWritten = false;
  try {
    await renderer.start();
    const eff = effective(config, prefs, chatId);
    // One shared working headline (provider + model + elapsed + usage) for
    // every bot-host agent — same line shape as the Grok TG router. The
    // provider follows the chat's effective model, not the registry default.
    renderer.setHeadline({
      providerLabel: providerLabelForModel(eff.model),
      modelLabel: eff.model || '',
    });
    const handoff = prefFor(prefs, chatId).handoff || '';
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
    if (eff.agent) extraArgs.push('--agent', eff.agent);

    const media = await collectInboundMedia(api, message, config);
    const promptWithMedia = media.length ? buildInboundPrompt(prompt, media) : prompt;

    const activeProject = getChatProject(chatId);
    const activeRole = getChatRole(chatId);
    const isExternalTurn = activeProject.type === 'external';
    const effectiveWorkspace = isExternalTurn ? activeProject.workspace : config.agent.workspace;
    // An external folder's child is built from a list, so it never holds the
    // website's git or deploy credentials. Project 1 keeps inheriting them.
    const turnEnvMode = isExternalTurn ? 'project' : 'inherit';
    // Every project composes through the same path: an assigned role is
    // prepended for project 1 too, and composeExternalPrompt returns the
    // prompt untouched when the chat has no role.
    let finalPrompt = composeExternalPrompt({ chatId, prompt: promptWithMedia, activeProject, activeRole });
    // Notes this turn should read: one line each, above the request, and only
    // for build/investigate turns. Gated retrieval returns nothing otherwise.
    const deadEnds = deadEndNotesFor(text);
    if (deadEnds.length) {
      finalPrompt = `[KNOWN DEAD ENDS — do not repeat these]\n${deadEnds.map((r) => `- ${r.text}`).join('\n')}\n\n${finalPrompt}`;
      console.log(`[${config.id}] injected ${deadEnds.length} dead-end note(s) into a ${turnKindFor(text)} turn`);
    }

    const ref = parseModelRef(eff.model);
    const location = workLocation();
    const workId = sessionKey({ location, chat: String(chatId), workspace: effectiveWorkspace, project: activeProject.id });
    const workLane = ref.surface === 'cline' ? 'cline' : ref.surface === 'gemini' ? 'gemini' : 'opencode';
    let workSession = resolveSession({ location, chat: String(chatId), workspace: effectiveWorkspace, project: activeProject.id, lane: workLane });
    if (workSession.lane !== workLane) workSession = handoffSession(workId, workLane) || workSession;
    // A recorded TUI server can die while the session row lives on. Attaching
    // to it makes every turn fail in about two seconds with "Session not
    // found", which is what happened to @VM_19485_bot all afternoon on
    // 2026-09-25: one stale row from 11:14, thousands of nothing. Ask the
    // server first, and drop the dead view instead of attaching to it.
    if (workSession.viewMode === 'tui' && workSession.serverUrl) {
      const live = await opencodeServerHealthy(workSession.serverUrl);
      if (!live) {
        console.log(`[${config.id}] tui server ${workSession.serverUrl} is not answering; dropping the stale view`);
        workSession = setWorkView(workSession.id, { viewMode: 'headless', serverUrl: null, state: 'stale' }) || workSession;
      }
    }
    // A `/freemodel` switch after `/tx on` must move the live view with the
    // lane: stale OpenCode TUI panes are dropped for Cline/Gemini and the TUI
    // is re-ensured when the lane comes back to OpenCode.
    if (workSession.tx) {
      try {
        workSession = await reconcileWorkViewForLane({
          session: workSession,
          lane: workLane,
          workspace: config.agent.workspace,
          tmux: defaultTmuxRunner,
          env: opencodeEnv(config),
          opencodeBin: config.agent.opencodeBin,
        }) || workSession;
      } catch {
        // view reconcile is best-effort — the run continues on the observer log
      }
    }
    if (workSession.viewMode !== 'tui' && sessions.get(chatId)) extraArgs.push('--session', sessions.get(chatId));
    try { observer = createObserver(workSession); } catch {}
    observerContext = { model: eff.model, attempt: 1, surface: ref.surface, provider: ref.surface };
    const onObserverEvent = (event) => fanoutProgressEvent({ renderer, observer, event, context: observerContext });
    let lastAttemptModel = eff.model;
    const runSurfaceModel = (model) => {
      const candidate = parseModelRef(model);
      if (candidate.surface === 'cline') {
        return runCline({
          prompt: finalPrompt,
          model: candidate.id,
          variant: eff.variant,
          plan: eff.agent === 'plan',
          workspace: effectiveWorkspace,
          timeoutMs: config.agent.timeoutMs,
          clineBin: config.agent.clineBin,
          onEvent: onObserverEvent,
          onSpawn: (child) => running.set(chatId, { child, aborted: false }),
          env: chatEnv(api, chatId),
          envMode: turnEnvMode,
        });
      }
      if (candidate.surface === 'gemini') {
        return runGemini({
          prompt: finalPrompt,
          model: candidate.id,
          timeoutMs: config.agent.timeoutMs,
          env: { ...opencodeEnv(config), ...chatEnv(api, chatId) },
        });
      }
      return runOpencode({
        prompt: finalPrompt,
        model,
        variant: eff.variant,
        workspace: effectiveWorkspace,
        thinking: config.agent.thinking,
        timeoutMs: config.agent.timeoutMs,
        opencodeBin: config.agent.opencodeBin,
        attachUrl: workSession.viewMode === 'tui' ? workSession.serverUrl : undefined,
        sessionId: workSession.viewMode === 'tui' ? workSession.opencodeSessionId : undefined,
        onEvent: onObserverEvent,
        onSpawn: (child) => running.set(chatId, { child, aborted: false, serverUrl: workSession.serverUrl, opencodeSessionId: workSession.opencodeSessionId }),
        onAbort: () => abortOpencodeSession({ serverUrl: workSession.serverUrl, sessionId: workSession.opencodeSessionId }).catch(() => false),
        extraArgs,
        env: { ...opencodeEnv(config), ...chatEnv(api, chatId) },
        envMode: turnEnvMode,
      });
    };

    // The ledger picks the walk. A lane it already stamped is not retried, an
    // ended lane is never offered, and a terminal-only row is never chosen.
    const laneChoice = selectTurnLanes({
      botId: config.id,
      model: eff.model,
      fallback: config.agent.model,
    });
    if (laneChoice.exhausted) {
      const when = laneChoice.soonest?.label ? ` Soonest reset: ${laneChoice.soonest.label}.` : '';
      await api.sendMessage(
        chatId,
        `🛑 No lane on ${location} has allowance right now.${when}\nNothing was run and nothing was spent. Send \`/allowance\` for the ledger.`
      ).catch(() => {});
      return;
    }
    if (laneChoice.displaced) {
      const why = laneChoice.displaced.resetLabel
        ? `${laneChoice.displaced.why} until ${laneChoice.displaced.resetLabel}`
        : laneChoice.displaced.why;
      console.log(`[${config.id}] lane ${eff.model} not selectable (${why}); using ${laneChoice.chose}`);
      // A coding turn that can only be served by a light model is said out loud.
      // Silently answering with a weaker model is how a coding task starts failing
      // in ways nobody notices until the code is wrong.
      if (laneChoice.degradedToLight) {
        console.log(`[${config.id}] no coding lane left; degraded to a light model (${laneChoice.chose})`);
        await api.sendMessage(
          chatId,
          `⚠️ \`${eff.model}\` is ${laneChoice.displaced.why}, and no coding lane is free right now — this turn runs on the light model \`${laneChoice.chose}\`. Code may be weaker than usual.`
        ).catch(() => {});
      }
    }
    // A location that names another machine runs there, on that machine's
    // allowance. This VM does not stamp for it.
    const remoteStatus = workerStatus(location);
    if (!isLocalHost(location)) {
      const route = routeState(location);
      // Guard 5: hold, never fall through to this machine. A held turn is
      // recorded so the user sees why nothing ran, and no allowance is spent.
      if (!remoteStatus.reachable) {
        setBlockedLocation(chatId, location, remoteStatus.reason);
        await api.sendMessage(
          chatId,
          `⏸ *Held:* \`${location}\` is unreachable (${remoteStatus.reason}).\nNothing ran and no allowance was sent. Send \`/location vps\` to run here, or wait for the ${location} worker to connect.`
        );
        return;
      }
      if (route === 'failed') {
        const row = routeFor(location);
        await api.sendMessage(
          chatId,
          `⏸ *Held:* the route to \`${location}\` was rolled back after a failed canary (${row?.failedReason || 'unknown reason'}).\nNothing ran here either. Send \`/location ${location}\` to arm it again (the first turn is re-checked), or \`/location vps\` to run on this machine.`
        );
        return;
      }
      const wantCanary = route !== 'active';
      const handed = await runOnWorker({
        host: location,
        prompt: finalPrompt,
        model: eff.model,
        project: isExternalTurn ? activeProject.id : 'health-tracker',
        role: activeRole || '',
        workspace: effectiveWorkspace,
        sessionId: sessions.get(chatId) || '',
        envMode: turnEnvMode,
        canary: wantCanary,
        preflightFull: wantCanary,
        packRoot: wantCanary ? effectiveWorkspace : '',
      });
      if (handed?.preflight) {
        setBlockedLocation(chatId, location, `${handed.preflight.failed}: ${handed.preflight.reason}`);
        await api.sendMessage(
          chatId,
          `⏸ *Held:* preflight failed for \`${location}\` — \`${handed.preflight.failed}\`: ${handed.preflight.reason}\n${preflightSummary(handed.preflight.checks)}\nNothing ran and no allowance was sent.`
        );
        return;
      }
      if (wantCanary) {
        // Guard 6: one turn decides whether the route becomes active. The
        // session row is never touched until it passes, so a bad canary costs
        // nothing but the canary. settleCanary is the same function the swap
        // drill runs, so what is proven there is what happens here.
        const settled = settleCanary({ host: location, result: handed, sessionId: sessions.get(chatId) || '', jobId: handed.jobId || '' });
        if (!settled.ok) {
          const back = settled.route?.previous || 'vps';
          await api.sendMessage(
            chatId,
            `⚠️ *Canary failed on \`${location}\`:* ${settled.reason}\nRoute rolled back to \`${back}\`; the conversation row was left untouched.${handed.text ? `\n\n${handed.text}` : ''}`
          );
          return;
        }
        console.log(`[${config.id}] canary passed on ${location} (job ${handed.jobId}); route active`);
      }
      // The thread id the worker ran is now ours too, so the next turn —
      // here or there — resumes the same conversation.
      if (handed.sessionID) {
        sessions.set(chatId, handed.sessionID);
        // The view is built from this record, so the record has to name the
        // thread that just ran — otherwise /tx keeps showing the conversation
        // from the previous host until something else rewrites it.
        workSession = setWorkView(workSession.id, { opencodeSessionId: handed.sessionID }) || workSession;
        if (workSession.tx) {
          try {
            workSession = await reconcileWorkViewForLane({
              session: workSession,
              lane: workLane,
              workspace: config.agent.workspace,
              tmux: defaultTmuxRunner,
              env: opencodeEnv(config),
              opencodeBin: config.agent.opencodeBin,
            }) || workSession;
          } catch {
            // view rebind is best-effort; the answer is already on its way
          }
        }
      }
      console.log(`[${config.id}] turn ran on ${location} (job ${handed.jobId}, ledger ${handed.ledger || 'worker'}${handed.sessionID ? `, session ${handed.sessionID}` : ''})`);
      await renderer.finish(
        { finalText: handed.text || '', lastError: handed.error || '', code: handed.code },
        { footer: `host: ${location}${wantCanary ? ' (canary)' : ''}` }
      ).catch(() => {});
      return;
    }

    const result = await runOpencodeWithFailover({
      api,
      config,
      chatId,
      prompt: finalPrompt,
      models: laneChoice.models.length ? laneChoice.models : failoverModels(eff.model, config.agent.model),
      onCooldown: ({ model, errText }) => {
        console.log(`[${config.id}] ${model} connection-failed twice; cooling it down instead of retrying it next message`);
      },
      runModel: runSurfaceModel,
      onAttemptStart: ({ model, attempt }) => {
        lastAttemptModel = model;
        observerTerminalWritten = false;
        const candidate = parseModelRef(model);
        observerContext = { model, attempt, surface: candidate.surface, provider: candidate.surface };
        if (observer) observer.write('run_start', {}, observerContext);
      },
      onAttemptComplete: ({ result: attemptResult, aborted }) => {
        observerTerminalWritten = true;
        if (observer) observer.write(aborted ? 'aborted' : attemptResult?.finalText ? 'run_complete' : 'failed', attemptResult || {}, observerContext);
        // Stamp a quota-hit lane even when the fallback succeeds, so
        // /freemodel + /allowance show the depletion instead of hiding it.
        if (!aborted && attemptResult && !String(attemptResult.finalText || '').trim()) {
          trackRunQuota({ botId: config.id, modelRef: lastAttemptModel, result: attemptResult });
        }
      },
      isAborted: () => Boolean(running.get(chatId)?.aborted),
    });
    // The OpenCode surface already reports through onAttemptComplete. Other
    // surfaces (Cline, Gemini) report nothing, so their terminal state is
    // written here. The old call was writeObserverTerminal(result), which does
    // not exist in this file: every Cline turn ended in
    // "Error: writeObserverTerminal is not defined" and the chat never saw the
    // model's answer, which is the lane @VM_19485_bot is pinned to.
    if (workLane !== 'opencode' && observer) {
      try {
        observer.write(
          running.get(chatId)?.aborted ? 'aborted' : String(result?.finalText || '').trim() ? 'run_complete' : 'failed',
          result || {},
          observerContext || {}
        );
      } catch {
        // an observer hiccup must never cost the chat its answer
      }
    }

    if (result.sessionID) {
      sessions.set(chatId, result.sessionID);
      saveSessions(config.id, sessions);
    }
    // Auto-track (screenshot footer): a quota/rate-limit failure stamps Reset
    // into this bot's OWN free-lane ledger so /allowance goes ❌ with a time.
    trackRunQuota({ botId: config.id, modelRef: eff.model, result });
    // Non-OpenCode lanes used to dump raw provider envelopes (Cline's
    // INFERENCE_CAP_ERROR JSON + stderr tail) into the chat. Summarize them
    // into one actionable line; usage/ledger tracking above keeps the raw result.
    let displayResult = result;
    const finalSurface = parseModelRef(lastAttemptModel).surface;
    if (!String(result?.finalText || '').trim() && String(result?.lastError || '').trim() && finalSurface !== 'opencode') {
      const summary = formatProviderFailure({
        surface: finalSurface,
        model: lastAttemptModel,
        lastError: result.lastError,
        stderr: result.stderr,
      });
      displayResult = { ...result, lastError: summary.message, stderr: summary.stderr };
    }
    // BOT-25 error log: a terminal lane failure opens (or bumps) a record;
    // the next clean run on the lane auto-closes it. Operator aborts are
    // never errors. Best-effort — never breaks the chat.
    try {
      if (!running.get(chatId)?.aborted) {
        if (String(result?.finalText || '').trim()) {
          noteHealthy({ lane: finalSurface, bot: config.id });
        } else if (String(result?.lastError || '').trim()) {
          recordError({
            lane: finalSurface,
            bot: config.id,
            raw: `${result.lastError || ''} ${result.stderr || ''}`,
            hint: String(displayResult.lastError || '').slice(0, 200),
          });
        }
      }
    } catch {
      // error-log writes must never break message delivery
    }
    if (running.get(chatId)?.aborted) {
      renderer.status = 'aborted';
      await renderer.deliver('Aborted.');
    } else {
      const usageText = await noteUsage({ chatId, result, eff, config, caches, totals, lastUsage });
      if (handoff) {
        const kept = prefFor(prefs, chatId);
        delete kept.handoff;
        setPref(prefs, chatId, kept);
        savePrefs(config.id, prefs);
      }
      await renderer.finish(displayResult, { footer: usageText });
    }
  } catch (err) {
    if (observer && !observerTerminalWritten) {
      observerTerminalWritten = true;
      observer.write('failed', {}, observerContext || {});
    }
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

  // Guard 10: one live poller per bot id. A second process with the same id —
  // exactly what a move creates while the old host is still up — is refused
  // by name instead of both answering the same chat. The move is drain (the
  // old poller stops claiming), release (SIGTERM gives the lease back), start
  // (the new host acquires it).
  const lease = acquirePollerLease({ key: config.id, host: workLocation(), pid: process.pid });
  if (!lease.ok) {
    console.error(`[bot-host] refusing to start: ${lease.reason}`);
    process.exit(1);
  }
  if (lease.row?.takenOverFrom) {
    console.log(`[${config.id}] took the poller lease from pid ${lease.row.takenOverFrom.pid} (no longer running)`);
  }
  const giveLeaseBack = () => {
    releasePollerLease({ key: config.id, pid: process.pid });
  };
  process.once('SIGTERM', giveLeaseBack);
  process.once('SIGINT', giveLeaseBack);
  setInterval(() => renewPollerLease({ key: config.id, host: workLocation(), pid: process.pid }), 60_000).unref();

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
